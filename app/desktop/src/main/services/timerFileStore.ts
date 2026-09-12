import { lstat, mkdir, readFile, readdir, realpath, stat } from 'node:fs/promises'
import { dirname, isAbsolute, posix, relative, sep } from 'node:path'
import type { TimerStateFile } from '../../shared/timerTypes'
import type { VersionedFile } from '../../shared/types'
import {
  emptyTimerLedger,
  emptyTimerState,
  parseTimerLedger,
  parseTimerState,
  serializeTimerLedger,
  serializeTimerState,
  type TimerLedgerDocument
} from '../domain/timerFiles'
import { resolveSafePath } from './workspaceService'
import {
  VersionedFileTransaction,
  parseTransactionBackupName,
  revisionOf,
  type VersionedFileTransactionHooks
} from './versionedFileTransaction'

const STATE_RELATIVE_PATH = 'data/timer/state.json'
const TIMER_DIRECTORY = 'data/timer'
const YEAR_NAME = /^\d{4}$/
const LEDGER_NAME = /^(\d{4}-\d{2}-\d{2})\.md$/

export type TimerFileStoreHooks = VersionedFileTransactionHooks

interface WorkspaceRootIdentity {
  path: string
  entryDevice: bigint
  entryInode: bigint
  targetDevice: bigint
  targetInode: bigint
}

const sameWorkspaceIdentity = (left: WorkspaceRootIdentity, right: WorkspaceRootIdentity): boolean => (
  left.path === right.path &&
  left.entryDevice === right.entryDevice &&
  left.entryInode === right.entryInode &&
  left.targetDevice === right.targetDevice &&
  left.targetInode === right.targetInode
)

const assertDate = (date: string): void => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`无效日期：${date}`)
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`无效日期：${date}`)
  }
}

const ledgerRelativePath = (date: string): string => {
  assertDate(date)
  return `${TIMER_DIRECTORY}/${date.slice(0, 4)}/${date}.md`
}

const missingFile = (error: unknown): boolean => (
  (error as NodeJS.ErrnoException).code === 'ENOENT'
)

export class TimerFileStore {
  private readonly files: VersionedFileTransaction
  private readonly workspaceIdentity: Promise<WorkspaceRootIdentity>

  constructor(
    private readonly workspaceRoot: string,
    private readonly now: () => Date = () => new Date(),
    hooks: TimerFileStoreHooks = {}
  ) {
    this.workspaceIdentity = this.captureWorkspaceIdentity()
    void this.workspaceIdentity.catch(() => undefined)
    this.files = new VersionedFileTransaction(
      now,
      hooks,
      workspaceRoot,
      async (path) => this.revalidateTransactionPath(path)
    )
  }

  async state(): Promise<VersionedFile<TimerStateFile>> {
    const existing = await this.readState()
    if (existing) return existing

    const value = emptyTimerState(this.now())
    const content = serializeTimerState(value)
    const path = await this.prepareCreatePath(STATE_RELATIVE_PATH)
    const created = await this.files.create(path, content)
    const authoritative = await this.readState()
    if (authoritative) return authoritative
    throw new Error(`${created ? '无法读取刚创建的' : '并发创建后找不到'}计时状态文件：${path}`)
  }

  async saveState(file: VersionedFile<TimerStateFile>): Promise<VersionedFile<TimerStateFile>> {
    const path = await this.exactFilePath(file.path, STATE_RELATIVE_PATH)
    await this.files.recover(path)
    const content = serializeTimerState(file.value)
    await this.files.replace(path, content, file.revision)
    const authoritative = await this.readState()
    if (!authoritative) throw new Error(`保存后找不到计时状态文件：${path}`)
    return authoritative
  }

  async ledger(date: string, create: boolean): Promise<VersionedFile<TimerLedgerDocument> | null> {
    const relativePath = ledgerRelativePath(date)
    const existing = await this.readLedger(relativePath, date)
    if (existing || !create) return existing

    const value = emptyTimerLedger(date, this.now())
    const content = serializeTimerLedger(value)
    const path = await this.prepareCreatePath(relativePath)
    const created = await this.files.create(path, content)
    const authoritative = await this.readLedger(relativePath, date)
    if (authoritative) return authoritative
    throw new Error(`${created ? '无法读取刚创建的' : '并发创建后找不到'}计时台账：${path}`)
  }

  async saveLedger(file: VersionedFile<TimerLedgerDocument>): Promise<VersionedFile<TimerLedgerDocument>> {
    const relativePath = ledgerRelativePath(file.value.ledger.date)
    const path = await this.exactFilePath(file.path, relativePath)
    await this.files.recover(path)
    const content = serializeTimerLedger(file.value)
    await this.files.replace(path, content, file.revision)
    const authoritative = await this.readLedger(relativePath, file.value.ledger.date)
    if (!authoritative) throw new Error(`保存后找不到计时台账：${path}`)
    return authoritative
  }

  async listLedgers(): Promise<Array<VersionedFile<TimerLedgerDocument>>> {
    await this.files.recoverAll()
    const timerDirectory = await this.intendedPath(TIMER_DIRECTORY)
    let years
    try {
      years = await readdir(timerDirectory, { withFileTypes: true })
    } catch (error) {
      if (missingFile(error)) return []
      throw error
    }

    const recoveryTargets = new Set<string>()
    for (const year of years) {
      if ((!year.isDirectory() && !year.isSymbolicLink()) || !YEAR_NAME.test(year.name)) continue
      const yearRelativePath = `${TIMER_DIRECTORY}/${year.name}`
      const yearDirectory = await this.intendedPath(yearRelativePath)
      const names = await readdir(yearDirectory, { withFileTypes: true })
      for (const entry of names) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        const artifact = parseTransactionBackupName(entry.name)
        const match = artifact ? LEDGER_NAME.exec(artifact.targetBasename) : null
        if (!match || match[1].slice(0, 4) !== year.name) continue
        try {
          assertDate(match[1])
        } catch {
          continue
        }
        recoveryTargets.add(`${yearRelativePath}/${match[1]}.md`)
      }
    }
    for (const relativePath of [...recoveryTargets].sort()) {
      await this.files.recover(await this.intendedPath(relativePath))
    }
    if (recoveryTargets.size) years = await readdir(timerDirectory, { withFileTypes: true })

    const matches: Array<{ date: string; relativePath: string }> = []
    for (const year of years) {
      if ((!year.isDirectory() && !year.isSymbolicLink()) || !YEAR_NAME.test(year.name)) continue
      const yearRelativePath = `${TIMER_DIRECTORY}/${year.name}`
      const yearDirectory = await this.intendedPath(yearRelativePath)
      const names = await readdir(yearDirectory, { withFileTypes: true })
      for (const entry of names) {
        if (!entry.isFile() && !entry.isSymbolicLink()) continue
        const match = LEDGER_NAME.exec(entry.name)
        if (!match) continue
        const date = match[1]
        try {
          assertDate(date)
        } catch {
          continue
        }
        if (date.slice(0, 4) !== year.name) continue
        matches.push({ date, relativePath: `${yearRelativePath}/${entry.name}` })
      }
    }

    matches.sort((left, right) => left.date.localeCompare(right.date))
    const ledgers: Array<VersionedFile<TimerLedgerDocument>> = []
    for (const match of matches) {
      const file = await this.readLedger(match.relativePath, match.date)
      if (!file) {
        const path = await this.intendedPath(match.relativePath)
        throw new Error(`计时台账在枚举后消失：${path}`)
      }
      ledgers.push(file)
    }
    return ledgers
  }

  transaction(): VersionedFileTransaction {
    return this.files
  }

  async relativeTimerPath(path: string): Promise<string> {
    if (!path) throw new Error('计时文件路径不能为空')
    const root = await this.stableWorkspaceRoot()
    const slashPath = path.replaceAll('\\', '/')
    let relativePath: string
    if (isAbsolute(path)) {
      const fromRoot = relative(root, path)
      if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
        throw new Error('路径越界：计时文件不在工作区内')
      }
      relativePath = fromRoot.split(sep).join('/')
    } else {
      relativePath = slashPath
    }

    if (relativePath.split('/').includes('..')) throw new Error('路径越界：不允许使用 ..')
    const normalized = posix.normalize(relativePath)
    if (normalized !== relativePath || (normalized !== TIMER_DIRECTORY && !normalized.startsWith(`${TIMER_DIRECTORY}/`))) {
      throw new Error('只能使用规范的 data/timer 路径')
    }
    await resolveSafePath(root, normalized, false)
    await this.stableWorkspaceRoot()
    return normalized
  }

  async recoverAll(): Promise<void> {
    await this.stableWorkspaceRoot()
    await this.files.recoverAll()
    await this.stableWorkspaceRoot()
  }

  private async intendedPath(relativePath: string): Promise<string> {
    const root = await this.stableWorkspaceRoot()
    const path = await resolveSafePath(root, relativePath, false)
    await this.stableWorkspaceRoot()
    return path
  }

  private async prepareCreatePath(relativePath: string): Promise<string> {
    const path = await this.intendedPath(relativePath)
    await mkdir(dirname(path), { recursive: true })
    return this.intendedPath(relativePath)
  }

  private async revalidateTransactionPath(path: string): Promise<void> {
    if (!isAbsolute(path)) throw new Error('文件事务路径必须是绝对路径')
    const root = await this.stableWorkspaceRoot()
    const fromRoot = relative(root, path)
    if (!fromRoot || fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new Error('路径越界：文件事务目标不在工作区内')
    }
    const relativePath = fromRoot.split(sep).join('/')
    const safePath = await resolveSafePath(root, relativePath, false)
    await this.stableWorkspaceRoot()
    if (safePath !== path) throw new Error('文件事务目标必须使用工作区内的规范绝对路径')
  }

  private async captureWorkspaceIdentity(): Promise<WorkspaceRootIdentity> {
    const selected = await this.readWorkspaceIdentity()
    const confirmed = await this.readWorkspaceIdentity()
    if (!sameWorkspaceIdentity(selected, confirmed)) throw new Error('工作区根目录在初始化期间已被替换')
    return selected
  }

  private async stableWorkspaceRoot(): Promise<string> {
    const selected = await this.workspaceIdentity
    let current: WorkspaceRootIdentity
    try {
      current = await this.readWorkspaceIdentity()
    } catch (error) {
      if (error instanceof Error && error.message.includes('工作区根目录')) throw error
      throw new Error('工作区根目录已被替换', { cause: error })
    }
    if (!sameWorkspaceIdentity(selected, current)) throw new Error('工作区根目录已被替换')
    return selected.path
  }

  private async readWorkspaceIdentity(): Promise<WorkspaceRootIdentity> {
    const entryBefore = await lstat(this.workspaceRoot, { bigint: true })
    const path = await realpath(this.workspaceRoot)
    const target = await stat(path, { bigint: true })
    const entryAfter = await lstat(this.workspaceRoot, { bigint: true })
    if (entryBefore.dev !== entryAfter.dev || entryBefore.ino !== entryAfter.ino) {
      throw new Error('工作区根目录已被替换')
    }
    return {
      path,
      entryDevice: entryAfter.dev,
      entryInode: entryAfter.ino,
      targetDevice: target.dev,
      targetInode: target.ino
    }
  }

  private async exactFilePath(path: string, expectedRelativePath: string): Promise<string> {
    const relativePath = await this.relativeTimerPath(path)
    if (relativePath !== expectedRelativePath) {
      throw new Error(`计时文件路径必须是 ${expectedRelativePath}`)
    }
    return this.intendedPath(expectedRelativePath)
  }

  private async readState(): Promise<VersionedFile<TimerStateFile> | null> {
    const path = await this.intendedPath(STATE_RELATIVE_PATH)
    await this.files.recover(path)
    await this.intendedPath(STATE_RELATIVE_PATH)
    try {
      const content = await readFile(path, 'utf8')
      return { path, revision: revisionOf(content), value: parseTimerState(content, path) }
    } catch (error) {
      if (missingFile(error)) return null
      throw error
    }
  }

  private async readLedger(
    relativePath: string,
    expectedDate: string
  ): Promise<VersionedFile<TimerLedgerDocument> | null> {
    const path = await this.intendedPath(relativePath)
    await this.files.recover(path)
    await this.intendedPath(relativePath)
    try {
      const content = await readFile(path, 'utf8')
      const value = parseTimerLedger(content, path)
      if (value.ledger.date !== expectedDate) {
        throw new Error(`${path}: 台账日期与规范路径不一致`)
      }
      return { path, revision: revisionOf(content), value }
    } catch (error) {
      if (missingFile(error)) return null
      throw error
    }
  }
}
