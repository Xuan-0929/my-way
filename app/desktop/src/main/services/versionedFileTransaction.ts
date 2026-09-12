import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative } from 'node:path'

export interface ConditionalWrite {
  path: string
  content: string
  expectedRevision: string
}

export interface VersionedFileTransactionHooks {
  beforePrepare?: (path: string) => Promise<void>
  afterClaim?: (path: string) => Promise<void>
  publishJournal?: (path: string, publish: () => Promise<void>) => Promise<void>
  beforeCreateInstall?: (path: string) => Promise<void>
  beforeInstall?: (path: string) => Promise<void>
  beforeBackupCleanup?: (path: string) => Promise<void>
}

export type VersionedFileTransactionPathGuard = (path: string) => Promise<void>

interface ClaimedWrite {
  write: ConditionalWrite
  inputIndex: number
  temporaryPath: string
  backupPath: string
  backupExists: boolean
  installed: boolean
}

interface TransactionJournalEntry {
  path: string
  temporaryPath: string
  backupPath: string
  expectedRevision: string
  nextRevision: string
}

interface TransactionJournal {
  schemaVersion: 1
  id: string
  state: 'installing' | 'committed'
  entries: TransactionJournalEntry[]
}

interface JournalRecoveryEntry {
  entry: TransactionJournalEntry
  currentRevision: string | null
  backupRevision: string | null
  temporaryRevision: string | null
}

export const revisionOf = (content: string): string => createHash('sha256').update(content).digest('hex')

const pathLockTails = new Map<string, Promise<void>>()
const activeBackupPaths = new Set<string>()
const activeTemporaryPaths = new Set<string>()
const activeJournalPaths = new Set<string>()
const activeJournalTemporaryPaths = new Set<string>()
let journalRecoveryTail = Promise.resolve()

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
const TRANSACTION_BACKUP_NAME = new RegExp(`^\\.(.+)\\.swap-([1-9]\\d*)-(${UUID_PATTERN})-(${UUID_PATTERN})\\.bak$`, 'i')
const TRANSACTION_TEMPORARY_NAME = new RegExp(`^\\.(.+)\\.([1-9]\\d*)\\.(${UUID_PATTERN})\\.tmp$`, 'i')
const TRANSACTION_JOURNAL_NAME = new RegExp(`^\\.my-way-transaction-([1-9]\\d*)-(${UUID_PATTERN})\\.json$`, 'i')
const TRANSACTION_JOURNAL_TEMPORARY_NAME = new RegExp(`^\\.my-way-transaction-([1-9]\\d*)-(${UUID_PATTERN})\\.json\\.(${UUID_PATTERN})\\.tmp$`, 'i')

interface OwnedTransactionArtifactName {
  ownerPid: number
}

export interface TransactionArtifactName {
  targetBasename: string
  ownerPid: number
}

const parsedOwner = (match: RegExpExecArray | null, ownerPidIndex: number): OwnedTransactionArtifactName | null => {
  if (!match) return null
  const ownerPid = Number(match[ownerPidIndex])
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) return null
  return { ownerPid }
}

const parsedArtifact = (match: RegExpExecArray | null): TransactionArtifactName | null => {
  if (!match) return null
  const ownerPid = Number(match[2])
  if (!Number.isSafeInteger(ownerPid) || ownerPid <= 0) return null
  return { targetBasename: match[1], ownerPid }
}

export const parseTransactionBackupName = (name: string): TransactionArtifactName | null => (
  parsedArtifact(TRANSACTION_BACKUP_NAME.exec(name))
)

export const parseTransactionTemporaryName = (name: string): TransactionArtifactName | null => (
  parsedArtifact(TRANSACTION_TEMPORARY_NAME.exec(name))
)

const parseTransactionJournalName = (name: string): OwnedTransactionArtifactName | null => (
  parsedOwner(TRANSACTION_JOURNAL_NAME.exec(name), 1)
)

const parseTransactionJournalTemporaryName = (name: string): OwnedTransactionArtifactName | null => (
  parsedOwner(TRANSACTION_JOURNAL_TEMPORARY_NAME.exec(name), 1)
)

const withJournalRecoveryLock = async <T>(operation: () => Promise<T>): Promise<T> => {
  const previous = journalRecoveryTail
  let release = (): void => undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  journalRecoveryTail = previous.then(() => gate)
  await previous
  try {
    return await operation()
  } finally {
    release()
  }
}

const artifactBelongsToLiveTransaction = (
  artifact: OwnedTransactionArtifactName,
  path: string,
  activePaths: Set<string>
): boolean => {
  if (activePaths.has(path)) return true
  if (artifact.ownerPid === process.pid) return false
  try {
    process.kill(artifact.ownerPid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

const acquirePathLocks = async (paths: string[]): Promise<() => void> => {
  const releases: Array<() => void> = []
  for (const path of [...new Set(paths)].sort()) {
    const previous = pathLockTails.get(path) ?? Promise.resolve()
    let releaseGate = (): void => undefined
    const gate = new Promise<void>((resolve) => { releaseGate = resolve })
    const tail = previous.then(() => gate)
    pathLockTails.set(path, tail)
    await previous
    releases.push(() => {
      releaseGate()
      void tail.finally(() => { if (pathLockTails.get(path) === tail) pathLockTails.delete(path) })
    })
  }
  return () => { for (const release of releases.reverse()) release() }
}

export class RevisionConflictError extends Error {
  readonly currentRevision: string

  constructor(currentRevision: string) {
    super('文件已在外部发生变化，禁止覆盖')
    this.name = 'RevisionConflictError'
    this.currentRevision = currentRevision
  }
}

export class VersionedFilePathGuardError extends Error {
  readonly path: string

  constructor(path: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause)
    super(`${path}: ${message}`, { cause })
    this.name = 'VersionedFilePathGuardError'
    this.path = path
  }
}

export class VersionedFileTransaction {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly hooks: VersionedFileTransactionHooks = {},
    private readonly journalRoot?: string,
    private readonly pathGuard?: VersionedFileTransactionPathGuard
  ) {}

  private async guardPath(path: string): Promise<void> {
    if (!this.pathGuard) return
    try {
      await this.pathGuard(path)
    } catch (error) {
      if (error instanceof VersionedFilePathGuardError) throw error
      throw new VersionedFilePathGuardError(path, error)
    }
  }

  private async guardPaths(paths: string[]): Promise<void> {
    for (const path of paths) await this.guardPath(path)
  }

  async create(path: string, content: string): Promise<boolean> {
    await this.recoverJournals()
    const releaseLocks = await acquirePathLocks([path])
    let temporaryPath = ''
    let keepRecoveryArtifacts = false
    try {
      await this.hooks.beforePrepare?.(path)
      temporaryPath = await this.prepareTemporary(path, content)
      await this.hooks.beforeCreateInstall?.(path)
      await this.guardPaths([temporaryPath, path])
      await link(temporaryPath, path)
      return true
    } catch (error) {
      if (error instanceof VersionedFilePathGuardError) keepRecoveryArtifacts = true
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false
      throw error
    } finally {
      try {
        if (temporaryPath && !keepRecoveryArtifacts) {
          await this.guardPath(temporaryPath)
          await rm(temporaryPath, { force: true })
        }
      } finally {
        if (temporaryPath) activeTemporaryPaths.delete(temporaryPath)
        releaseLocks()
      }
    }
  }

  async replace(path: string, content: string, expectedRevision: string): Promise<string> {
    return (await this.replaceMany([{ path, content, expectedRevision }]))[0]
  }

  async replaceMany(writes: ConditionalWrite[]): Promise<string[]> {
    if (new Set(writes.map((write) => write.path)).size !== writes.length) throw new Error('文件事务不能重复写入同一路径')
    if (!writes.length) return []

    if (writes.length > 1 && !this.journalRoot) throw new Error('多文件事务必须配置恢复日志目录')
    await this.recoverJournals()
    const releaseLocks = await acquirePathLocks(writes.map((write) => write.path))
    const claimed: ClaimedWrite[] = []
    const transactionId = `${process.pid}-${randomUUID()}`
    const journalPath = writes.length > 1 ? join(this.journalRoot as string, `.my-way-transaction-${transactionId}.json`) : ''
    let journal: TransactionJournal | null = null
    let keepRecoveryArtifacts = false
    let committed = false
    try {
      await Promise.all(writes.map((write) => this.recoverUnlocked(write.path)))
      for (const [inputIndex, write] of writes.entries()) {
        await this.hooks.beforePrepare?.(write.path)
        const temporaryPath = await this.prepareTemporary(write.path, write.content)
        claimed.push({
          write,
          inputIndex,
          temporaryPath,
          backupPath: join(dirname(write.path), `.${basename(write.path)}.swap-${transactionId}-${randomUUID()}.bak`),
          backupExists: false,
          installed: false
        })
      }
      claimed.sort((left, right) => left.write.path.localeCompare(right.write.path))
      if (journalPath) {
        journal = {
          schemaVersion: 1,
          id: transactionId,
          state: 'installing',
          entries: claimed.map((item) => ({
            path: item.write.path,
            temporaryPath: item.temporaryPath,
            backupPath: item.backupPath,
            expectedRevision: item.write.expectedRevision,
            nextRevision: revisionOf(item.write.content)
          }))
        }
        await this.guardPath(journalPath)
        activeJournalPaths.add(journalPath)
        const journalSource = JSON.stringify(journal)
        let journalOwned = false
        const publishJournal = async (): Promise<void> => {
          await this.guardPath(journalPath)
          await writeFile(journalPath, journalSource, { encoding: 'utf8', flag: 'wx' })
          journalOwned = true
        }
        try {
          if (this.hooks.publishJournal) await this.hooks.publishJournal(journalPath, publishJournal)
          else await publishJournal()
        } catch (error) {
          if (journalOwned || (!(error instanceof VersionedFilePathGuardError) && (error as NodeJS.ErrnoException).code !== 'EEXIST')) {
            try {
              await this.guardPath(journalPath)
              await rm(journalPath, { force: true })
            } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], `事务恢复日志发布失败，且无法安全清理：${journalPath}`)
            }
          }
          throw error
        }
      }

      try {
        for (const item of claimed) {
          try {
            await this.guardPaths([item.write.path, item.backupPath])
            await rename(item.write.path, item.backupPath)
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new RevisionConflictError('missing')
            throw error
          }
          item.backupExists = true
          activeBackupPaths.add(item.backupPath)
          await this.hooks.afterClaim?.(item.write.path)
          await this.guardPaths([item.write.path, item.backupPath])
          const claimedRevision = revisionOf(await readFile(item.backupPath, 'utf8'))
          if (claimedRevision !== item.write.expectedRevision) throw new RevisionConflictError(claimedRevision)
        }

        for (const item of claimed) {
          await this.hooks.beforeInstall?.(item.write.path)
          await this.guardPaths([item.temporaryPath, item.write.path])
          try {
            await link(item.temporaryPath, item.write.path)
            item.installed = true
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
            throw new RevisionConflictError(revisionOf(await readFile(item.write.path, 'utf8')))
          }
        }

        if (journal) {
          journal = { ...journal, state: 'committed' }
          await this.replaceJournal(journalPath, journal)
        }
        committed = true
        let cleanupComplete = true
        for (const item of claimed) {
          try {
            await this.hooks.beforeBackupCleanup?.(item.write.path)
            await this.guardPath(item.backupPath)
            await rm(item.backupPath, { force: true })
            item.backupExists = false
          } catch {
            try {
              await this.guardPaths([item.write.path, item.backupPath])
            } catch (guardError) {
              keepRecoveryArtifacts = true
              throw guardError
            }
            // The new files are already committed. A leftover backup is safer than
            // rolling only part of a multi-file transaction back.
            cleanupComplete = false
          }
        }
        if (journalPath && cleanupComplete) {
          await this.guardPath(journalPath)
          await rm(journalPath, { force: true })
        }
        keepRecoveryArtifacts = Boolean(journalPath && !cleanupComplete)
        return writes.map((write) => revisionOf(write.content))
      } catch (primaryError) {
        if (committed || primaryError instanceof VersionedFilePathGuardError) {
          keepRecoveryArtifacts = true
          throw primaryError
        }
        try {
          await this.guardPaths(claimed.flatMap((item) => [item.write.path, item.temporaryPath, item.backupPath]))
        } catch (guardError) {
          keepRecoveryArtifacts = true
          throw guardError
        }
        const rollbackErrors: unknown[] = []
        for (const item of [...claimed].reverse()) {
          if (!item.backupExists) continue
          try {
            await this.guardPaths([item.write.path, item.temporaryPath, item.backupPath])
            if (item.installed) {
              const installedContent = await readFile(item.write.path, 'utf8')
              if (revisionOf(installedContent) === revisionOf(item.write.content)) {
                await this.guardPath(item.write.path)
                await rm(item.write.path, { force: true })
              } else {
                await this.preserveBackup(item.write.path, item.backupPath)
                item.backupExists = false
                continue
              }
            }
            await this.restoreClaimedFile(item.write.path, item.backupPath)
            item.backupExists = false
          } catch (rollbackError) {
            rollbackErrors.push(rollbackError)
          }
        }
        if (rollbackErrors.length) {
          keepRecoveryArtifacts = true
          throw new AggregateError([primaryError, ...rollbackErrors], '文件事务失败，且部分文件需要从冲突副本恢复')
        }
        if (journalPath) {
          await this.guardPath(journalPath)
          await rm(journalPath, { force: true })
        }
        throw primaryError
      }
    } finally {
      try {
        if (!keepRecoveryArtifacts) {
          for (const item of claimed) {
            await this.guardPath(item.temporaryPath)
            await rm(item.temporaryPath, { force: true })
          }
        }
      } finally {
        for (const item of claimed) activeBackupPaths.delete(item.backupPath)
        for (const item of claimed) activeTemporaryPaths.delete(item.temporaryPath)
        if (journalPath) activeJournalPaths.delete(journalPath)
        releaseLocks()
      }
    }
  }

  async recover(path: string): Promise<void> {
    await this.recoverJournals()
    const releaseLocks = await acquirePathLocks([path])
    try {
      await this.recoverUnlocked(path)
    } finally {
      releaseLocks()
    }
  }

  async recoverAll(): Promise<void> {
    await this.recoverJournals()
  }

  private async recoverJournals(): Promise<void> {
    if (!this.journalRoot) return
    await withJournalRecoveryLock(async () => {
      let names: string[]
      try {
        names = await readdir(this.journalRoot as string)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      const journalTemporaries = names.flatMap((name) => {
        const artifact = parseTransactionJournalTemporaryName(name)
        return artifact ? [{ artifact, path: join(this.journalRoot as string, name) }] : []
      })
      for (const temporary of journalTemporaries) {
        if (artifactBelongsToLiveTransaction(temporary.artifact, temporary.path, activeJournalTemporaryPaths)) continue
        await this.guardPath(temporary.path)
        await rm(temporary.path, { force: true })
      }
      const journals = names.flatMap((name) => {
        const artifact = parseTransactionJournalName(name)
        return artifact ? [{ artifact, name }] : []
      }).sort((left, right) => left.name.localeCompare(right.name))
      for (const journal of journals) {
        const { artifact, name } = journal
        const path = join(this.journalRoot as string, name)
        if (artifactBelongsToLiveTransaction(artifact, path, activeJournalPaths)) continue
        await this.recoverJournal(path)
      }
    })
  }

  private async recoverJournal(journalPath: string): Promise<void> {
    let source: string
    try {
      source = await readFile(journalPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const journal = await this.parseJournal(source, journalPath)
    const releaseLocks = await acquirePathLocks(journal.entries.map((entry) => entry.path))
    try {
      const recoveryEntries = await Promise.all(journal.entries.map(async (entry): Promise<JournalRecoveryEntry> => {
        await this.guardPaths([entry.path, entry.temporaryPath, entry.backupPath])
        const currentRevision = await this.readRevision(entry.path)
        const backupRevision = await this.readRevision(entry.backupPath)
        const temporaryRevision = journal.state === 'committed' && currentRevision === null
          ? await this.readRevision(entry.temporaryPath)
          : null
        return { entry, currentRevision, backupRevision, temporaryRevision }
      }))

      for (const recovery of recoveryEntries) {
        const { entry, currentRevision, backupRevision, temporaryRevision } = recovery
        if (journal.state === 'installing') {
          if (currentRevision !== null && currentRevision !== entry.expectedRevision && currentRevision !== entry.nextRevision) throw new RevisionConflictError(currentRevision)
          if (backupRevision !== null && backupRevision !== entry.expectedRevision) throw new Error(`事务恢复备份校验失败：${entry.backupPath}`)
          if (currentRevision !== entry.expectedRevision && backupRevision === null) throw new Error(`无法恢复未完成事务中的文件：${entry.path}`)
        } else {
          if (currentRevision !== null && currentRevision !== entry.nextRevision) throw new RevisionConflictError(currentRevision)
          if (currentRevision === null && temporaryRevision !== entry.nextRevision) throw new Error(`无法完成已提交事务中的文件：${entry.path}`)
          if (backupRevision !== null && backupRevision !== entry.expectedRevision) throw new Error(`事务恢复备份校验失败：${entry.backupPath}`)
        }
      }

      for (const recovery of recoveryEntries) {
        const { entry, currentRevision, backupRevision } = recovery
        if (journal.state === 'installing') {
          if (currentRevision !== entry.expectedRevision) {
            if (currentRevision === entry.nextRevision) {
              await this.guardPath(entry.path)
              await rm(entry.path, { force: true })
            }
            await this.guardPaths([entry.backupPath, entry.path])
            await link(entry.backupPath, entry.path)
          }
        } else if (currentRevision === null) {
          await this.guardPaths([entry.temporaryPath, entry.path])
          await link(entry.temporaryPath, entry.path)
        }
        if (backupRevision !== null) {
          await this.guardPath(entry.backupPath)
          await rm(entry.backupPath, { force: true })
        }
        await this.guardPath(entry.temporaryPath)
        await rm(entry.temporaryPath, { force: true })
      }
      await this.guardPath(journalPath)
      await rm(journalPath, { force: true })
    } finally {
      releaseLocks()
    }
  }

  private async parseJournal(source: string, journalPath: string): Promise<TransactionJournal> {
    const value = JSON.parse(source) as Partial<TransactionJournal>
    if (value.schemaVersion !== 1 || typeof value.id !== 'string' || (value.state !== 'installing' && value.state !== 'committed') || !Array.isArray(value.entries) || !value.entries.length) {
      throw new Error(`事务恢复日志格式无效：${journalPath}`)
    }
    const root = await realpath(this.journalRoot as string)
    const entries = await Promise.all(value.entries.map(async (candidate) => {
      if (!candidate || typeof candidate.path !== 'string' || typeof candidate.temporaryPath !== 'string' || typeof candidate.backupPath !== 'string' || typeof candidate.expectedRevision !== 'string' || typeof candidate.nextRevision !== 'string') {
        throw new Error(`事务恢复日志条目无效：${journalPath}`)
      }
      if (!isAbsolute(candidate.path) || dirname(candidate.temporaryPath) !== dirname(candidate.path) || dirname(candidate.backupPath) !== dirname(candidate.path)) {
        throw new Error(`事务恢复日志路径越界：${journalPath}`)
      }
      const canonicalDirectory = await realpath(dirname(candidate.path))
      const canonicalPath = join(canonicalDirectory, basename(candidate.path))
      const relativePath = relative(root, canonicalPath)
      if (relativePath.startsWith('..') || isAbsolute(relativePath)) throw new Error(`事务恢复日志路径越界：${journalPath}`)
      const targetBasename = basename(candidate.path)
      const temporary = parseTransactionTemporaryName(basename(candidate.temporaryPath))
      const backup = parseTransactionBackupName(basename(candidate.backupPath))
      if (temporary?.targetBasename !== targetBasename || backup?.targetBasename !== targetBasename) {
        throw new Error(`事务恢复日志辅助路径无效：${journalPath}`)
      }
      return {
        ...candidate,
        path: canonicalPath,
        temporaryPath: join(canonicalDirectory, basename(candidate.temporaryPath)),
        backupPath: join(canonicalDirectory, basename(candidate.backupPath))
      } as TransactionJournalEntry
    }))
    const recoveryPaths = entries.flatMap((entry) => [entry.path, entry.temporaryPath, entry.backupPath])
    if (new Set(recoveryPaths).size !== recoveryPaths.length) throw new Error(`事务恢复日志包含重复路径：${journalPath}`)
    return { schemaVersion: 1, id: value.id, state: value.state, entries }
  }

  private async replaceJournal(path: string, journal: TransactionJournal): Promise<void> {
    const temporaryPath = `${path}.${randomUUID()}.tmp`
    await this.guardPaths([path, temporaryPath])
    activeJournalTemporaryPaths.add(temporaryPath)
    try {
      await this.guardPath(temporaryPath)
      await writeFile(temporaryPath, JSON.stringify(journal), { encoding: 'utf8', flag: 'wx' })
      await this.guardPaths([temporaryPath, path])
      await rename(temporaryPath, path)
    } finally {
      try {
        await this.guardPath(temporaryPath)
        await rm(temporaryPath, { force: true })
      } finally {
        activeJournalTemporaryPaths.delete(temporaryPath)
      }
    }
  }

  private async readRevision(path: string): Promise<string | null> {
    try {
      return revisionOf(await readFile(path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw error
    }
  }

  private async recoverUnlocked(path: string): Promise<void> {
    await this.guardPath(path)
    let names: string[]
    try {
      names = await readdir(dirname(path))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const targetBasename = basename(path)
    const backups = names.flatMap((name) => {
      const artifact = parseTransactionBackupName(name)
      return artifact?.targetBasename === targetBasename ? [{ artifact, name, path: join(dirname(path), name) }] : []
    }).sort((left, right) => left.name.localeCompare(right.name))
    const temporaries = names.flatMap((name) => {
      const artifact = parseTransactionTemporaryName(name)
      return artifact?.targetBasename === targetBasename ? [{ artifact, path: join(dirname(path), name) }] : []
    })
    await this.guardPaths([...backups.map((item) => item.path), ...temporaries.map((item) => item.path)])
    for (const temporary of temporaries) {
      if (artifactBelongsToLiveTransaction(temporary.artifact, temporary.path, activeTemporaryPaths)) continue
      await this.guardPath(temporary.path)
      await rm(temporary.path, { force: true })
    }
    if (!backups.length) return
    if (backups.some((item) => artifactBelongsToLiveTransaction(item.artifact, item.path, activeBackupPaths))) return

    let pathExists = true
    try {
      await this.guardPath(path)
      await readFile(path)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') pathExists = false
      else throw error
    }
    if (pathExists) {
      for (const backup of backups) await this.preserveBackup(path, backup.path)
      return
    }

    const newest = backups.at(-1) as (typeof backups)[number]
    let restored = false
    try {
      await this.guardPaths([newest.path, path])
      await link(newest.path, path)
      restored = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
    if (restored) {
      await this.guardPath(newest.path)
      await rm(newest.path, { force: true })
      for (const backup of backups) {
        if (backup.path !== newest.path) await this.preserveBackup(path, backup.path)
      }
    } else {
      for (const backup of backups) await this.preserveBackup(path, backup.path)
    }
  }

  private async prepareTemporary(path: string, content: string): Promise<string> {
    await this.guardPath(path)
    await mkdir(dirname(path), { recursive: true })
    const temporaryPath = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`)
    await this.guardPath(temporaryPath)
    await writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' })
    activeTemporaryPaths.add(temporaryPath)
    return temporaryPath
  }

  private async restoreClaimedFile(path: string, backupPath: string): Promise<void> {
    await this.guardPaths([path, backupPath])
    try {
      await link(backupPath, path)
      await this.guardPath(backupPath)
      await rm(backupPath, { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      await this.preserveBackup(path, backupPath)
    }
  }

  private async preserveBackup(path: string, backupPath: string): Promise<string> {
    const extension = extname(path)
    const stem = basename(path, extension)
    const stamp = this.now().toISOString().replace(/[-:.]/g, '')
    const preservedPath = join(dirname(path), `${stem}.conflict-external-${stamp}-${randomUUID()}${extension}`)
    await this.guardPaths([path, backupPath, preservedPath])
    await rename(backupPath, preservedPath)
    return preservedPath
  }
}
