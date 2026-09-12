import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { RevisionConflictError, VersionedFileTransaction, revisionOf } from './versionedFileTransaction'

const crashEntryPaths = (root: string, name: string, transactionId: string) => ({
  path: join(root, name),
  backupPath: join(root, `.${name}.swap-${transactionId}-${randomUUID()}.bak`),
  temporaryPath: join(root, `.${name}.99999999.${randomUUID()}.tmp`)
})

const directorySnapshot = async (root: string): Promise<Record<string, string>> => {
  const snapshot: Record<string, string> = {}
  for (const name of (await readdir(root)).sort()) snapshot[name] = await readFile(join(root, name), 'utf8')
  return snapshot
}

describe('VersionedFileTransaction', () => {
  let root = ''

  beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'my-way-transaction-')) })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  it('conditionally replaces two files and returns revisions in input order', async () => {
    const day = join(root, 'day.md')
    const week = join(root, 'week.md')
    await writeFile(day, 'day-v1')
    await writeFile(week, 'week-v1')

    const result = await new VersionedFileTransaction(undefined, {}, root).replaceMany([
      { path: day, content: 'day-v2', expectedRevision: revisionOf('day-v1') },
      { path: week, content: 'week-v2', expectedRevision: revisionOf('week-v1') }
    ])

    expect(result).toEqual([revisionOf('day-v2'), revisionOf('week-v2')])
    await expect(readFile(day, 'utf8')).resolves.toBe('day-v2')
    await expect(readFile(week, 'utf8')).resolves.toBe('week-v2')
  })

  it('restores every claimed file when the second revision is stale', async () => {
    const day = join(root, 'day.md')
    const week = join(root, 'week.md')
    await writeFile(day, 'day-v1')
    await writeFile(week, 'week-external')

    await expect(new VersionedFileTransaction(undefined, {}, root).replaceMany([
      { path: day, content: 'day-v2', expectedRevision: revisionOf('day-v1') },
      { path: week, content: 'week-v2', expectedRevision: revisionOf('week-v1') }
    ])).rejects.toBeInstanceOf(RevisionConflictError)

    await expect(readFile(day, 'utf8')).resolves.toBe('day-v1')
    await expect(readFile(week, 'utf8')).resolves.toBe('week-external')
  })

  it('preserves an external recreation and the original backup', async () => {
    const day = join(root, 'day.md')
    const week = join(root, 'week.md')
    await writeFile(day, 'day-v1')
    await writeFile(week, 'week-v1')
    const transaction = new VersionedFileTransaction(() => new Date('2026-08-17T08:00:00.000Z'), {
      afterClaim: async (path) => { if (path === week) await writeFile(week, 'week-external') }
    }, root)

    await expect(transaction.replaceMany([
      { path: day, content: 'day-v2', expectedRevision: revisionOf('day-v1') },
      { path: week, content: 'week-v2', expectedRevision: revisionOf('week-v1') }
    ])).rejects.toThrow()

    await expect(readFile(week, 'utf8')).resolves.toBe('week-external')
    expect((await readdir(root)).some((name) => name.startsWith('week.conflict-external-'))).toBe(true)
  })

  it('preserves a crash backup when another program recreated the target', async () => {
    const day = join(root, 'day.md')
    const backup = join(root, `.day.md.swap-99999999-${randomUUID()}-${randomUUID()}.bak`)
    await writeFile(day, 'external-version')
    await writeFile(backup, 'original-version')

    await new VersionedFileTransaction(() => new Date('2026-08-17T08:00:00.000Z')).recover(day)

    await expect(readFile(day, 'utf8')).resolves.toBe('external-version')
    const conflict = (await readdir(root)).find((name) => name.startsWith('day.conflict-external-'))
    expect(conflict).toBeTruthy()
    await expect(readFile(join(root, conflict as string), 'utf8')).resolves.toBe('original-version')
  })

  it('does not roll back installed files when backup cleanup fails after commit', async () => {
    const day = join(root, 'day.md')
    const week = join(root, 'week.md')
    await writeFile(day, 'day-v1')
    await writeFile(week, 'week-v1')
    const transaction = new VersionedFileTransaction(() => new Date('2026-08-17T08:00:00.000Z'), {
      beforeBackupCleanup: async (path) => { if (path === week) throw new Error('simulated cleanup failure') }
    }, root)

    await expect(transaction.replaceMany([
      { path: day, content: 'day-v2', expectedRevision: revisionOf('day-v1') },
      { path: week, content: 'week-v2', expectedRevision: revisionOf('week-v1') }
    ])).resolves.toEqual([revisionOf('day-v2'), revisionOf('week-v2')])

    await expect(readFile(day, 'utf8')).resolves.toBe('day-v2')
    await expect(readFile(week, 'utf8')).resolves.toBe('week-v2')
    expect((await readdir(root)).some((name) => name.startsWith('.week.md.swap-'))).toBe(true)

    await new VersionedFileTransaction(undefined, {}, root).recover(day)
    await expect(readFile(day, 'utf8')).resolves.toBe('day-v2')
    await expect(readFile(week, 'utf8')).resolves.toBe('week-v2')
    expect((await readdir(root)).some((name) => name.startsWith('.my-way-transaction-') || name.startsWith('.week.md.swap-'))).toBe(false)
  })

  it('rolls back every file from a journal after a crash between installs', async () => {
    const day = join(root, 'day.md')
    const week = join(root, 'week.md')
    const transactionId = `99999999-${randomUUID()}`
    const dayBackup = join(root, `.day.md.swap-${transactionId}-${randomUUID()}.bak`)
    const weekBackup = join(root, `.week.md.swap-${transactionId}-${randomUUID()}.bak`)
    const dayTemporary = join(root, `.day.md.99999999.${randomUUID()}.tmp`)
    const weekTemporary = join(root, `.week.md.99999999.${randomUUID()}.tmp`)
    await writeFile(day, 'day-v2')
    await writeFile(dayBackup, 'day-v1')
    await writeFile(weekBackup, 'week-v1')
    await writeFile(dayTemporary, 'day-v2')
    await writeFile(weekTemporary, 'week-v2')
    await writeFile(join(root, `.my-way-transaction-${transactionId}.json`), JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [
        { path: day, temporaryPath: dayTemporary, backupPath: dayBackup, expectedRevision: revisionOf('day-v1'), nextRevision: revisionOf('day-v2') },
        { path: week, temporaryPath: weekTemporary, backupPath: weekBackup, expectedRevision: revisionOf('week-v1'), nextRevision: revisionOf('week-v2') }
      ]
    }))

    await new VersionedFileTransaction(undefined, {}, root).recover(day)

    await expect(readFile(day, 'utf8')).resolves.toBe('day-v1')
    await expect(readFile(week, 'utf8')).resolves.toBe('week-v1')
    expect((await readdir(root)).filter((name) => name.includes('transaction-') || name.endsWith('.tmp') || name.endsWith('.bak'))).toEqual([])
  })

  it.each([
    ['installed canonical with missing backup', 'next', 'missing'],
    ['installed canonical with corrupt backup', 'next', 'corrupt'],
    ['missing canonical with missing backup', 'missing', 'missing'],
    ['missing canonical with corrupt backup', 'missing', 'corrupt']
  ] as const)('preflights every installing entry before mutation: %s', async (_label, currentState, backupState) => {
    const transactionId = `99999999-${randomUUID()}`
    const valid = crashEntryPaths(root, 'day.md', transactionId)
    const invalid = crashEntryPaths(root, 'week.md', transactionId)
    const journalPath = join(root, `.my-way-transaction-${transactionId}.json`)
    await writeFile(valid.path, 'day-v2')
    await writeFile(valid.backupPath, 'day-v1')
    await writeFile(valid.temporaryPath, 'day-v2')
    if (currentState === 'next') await writeFile(invalid.path, 'week-v2')
    if (backupState === 'corrupt') await writeFile(invalid.backupPath, 'week-corrupt')
    await writeFile(invalid.temporaryPath, 'week-v2')
    await writeFile(journalPath, JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [
        { ...valid, expectedRevision: revisionOf('day-v1'), nextRevision: revisionOf('day-v2') },
        { ...invalid, expectedRevision: revisionOf('week-v1'), nextRevision: revisionOf('week-v2') }
      ]
    }))
    const before = await directorySnapshot(root)

    await expect(new VersionedFileTransaction(undefined, {}, root).recoverAll()).rejects.toThrow()

    expect(await directorySnapshot(root)).toEqual(before)
  })

  it('supports every legitimate installing-journal state after global preflight', async () => {
    const transactionId = `99999999-${randomUUID()}`
    const untouched = crashEntryPaths(root, 'untouched.md', transactionId)
    const claimed = crashEntryPaths(root, 'claimed.md', transactionId)
    const installed = crashEntryPaths(root, 'installed.md', transactionId)
    const expectedWithBackup = crashEntryPaths(root, 'expected-with-backup.md', transactionId)
    const journalPath = join(root, `.my-way-transaction-${transactionId}.json`)
    await writeFile(untouched.path, 'untouched-v1')
    await writeFile(untouched.temporaryPath, 'untouched-v2')
    await writeFile(claimed.backupPath, 'claimed-v1')
    await writeFile(claimed.temporaryPath, 'claimed-v2')
    await writeFile(installed.path, 'installed-v2')
    await writeFile(installed.backupPath, 'installed-v1')
    await writeFile(installed.temporaryPath, 'installed-v2')
    await writeFile(expectedWithBackup.path, 'expected-v1')
    await writeFile(expectedWithBackup.backupPath, 'expected-v1')
    await writeFile(expectedWithBackup.temporaryPath, 'expected-v2')
    const fixtures = [
      [untouched, 'untouched-v1', 'untouched-v2'],
      [claimed, 'claimed-v1', 'claimed-v2'],
      [installed, 'installed-v1', 'installed-v2'],
      [expectedWithBackup, 'expected-v1', 'expected-v2']
    ] as const
    await writeFile(journalPath, JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: fixtures.map(([paths, expected, next]) => ({
        ...paths,
        expectedRevision: revisionOf(expected),
        nextRevision: revisionOf(next)
      }))
    }))

    await new VersionedFileTransaction(undefined, {}, root).recoverAll()

    for (const [paths, expected] of fixtures) await expect(readFile(paths.path, 'utf8')).resolves.toBe(expected)
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp') || name.endsWith('.bak') || name.startsWith('.my-way-transaction-'))).toEqual([])
  })

  it.each([
    ['untouched canonical without backup', true, false],
    ['claimed canonical with backup', false, true],
    ['installed canonical with backup', true, true]
  ] as const)('recovers a no-op installing entry represented as %s', async (_label, canonicalExists, backupExists) => {
    const transactionId = `99999999-${randomUUID()}`
    const entry = crashEntryPaths(root, 'day.md', transactionId)
    const journalPath = join(root, `.my-way-transaction-${transactionId}.json`)
    if (canonicalExists) await writeFile(entry.path, 'same-content')
    if (backupExists) await writeFile(entry.backupPath, 'same-content')
    await writeFile(entry.temporaryPath, 'same-content')
    const revision = revisionOf('same-content')
    await writeFile(journalPath, JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [{ ...entry, expectedRevision: revision, nextRevision: revision }]
    }))

    await new VersionedFileTransaction(undefined, {}, root).recoverAll()

    await expect(readFile(entry.path, 'utf8')).resolves.toBe('same-content')
    for (const artifact of [entry.backupPath, entry.temporaryPath, journalPath]) {
      await expect(readFile(artifact, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    }
  })

  it('keeps a no-op canonical while rolling back a changed entry in the same journal', async () => {
    const transactionId = `99999999-${randomUUID()}`
    const noOp = crashEntryPaths(root, 'day.md', transactionId)
    const changed = crashEntryPaths(root, 'week.md', transactionId)
    const journalPath = join(root, `.my-way-transaction-${transactionId}.json`)
    await writeFile(noOp.path, 'day-same')
    await writeFile(noOp.temporaryPath, 'day-same')
    await writeFile(changed.path, 'week-v2')
    await writeFile(changed.backupPath, 'week-v1')
    await writeFile(changed.temporaryPath, 'week-v2')
    await writeFile(journalPath, JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [
        { ...noOp, expectedRevision: revisionOf('day-same'), nextRevision: revisionOf('day-same') },
        { ...changed, expectedRevision: revisionOf('week-v1'), nextRevision: revisionOf('week-v2') }
      ]
    }))

    await new VersionedFileTransaction(undefined, {}, root).recoverAll()

    await expect(readFile(noOp.path, 'utf8')).resolves.toBe('day-same')
    await expect(readFile(changed.path, 'utf8')).resolves.toBe('week-v1')
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp') || name.endsWith('.bak') || name.startsWith('.my-way-transaction-'))).toEqual([])
  })

  it('rejects duplicate recovery entries before mutating their shared artifacts', async () => {
    const transactionId = `99999999-${randomUUID()}`
    const entry = crashEntryPaths(root, 'day.md', transactionId)
    const journalPath = join(root, `.my-way-transaction-${transactionId}.json`)
    await writeFile(entry.path, 'day-v2')
    await writeFile(entry.backupPath, 'day-v1')
    await writeFile(entry.temporaryPath, 'day-v2')
    const journalEntry = { ...entry, expectedRevision: revisionOf('day-v1'), nextRevision: revisionOf('day-v2') }
    await writeFile(journalPath, JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [journalEntry, journalEntry]
    }))
    const before = await directorySnapshot(root)

    await expect(new VersionedFileTransaction(undefined, {}, root).recoverAll()).rejects.toThrow(/重复路径/)

    expect(await directorySnapshot(root)).toEqual(before)
  })

  it('preflights committed backup integrity before deleting any recovery artifact', async () => {
    const transactionId = `99999999-${randomUUID()}`
    const entry = crashEntryPaths(root, 'day.md', transactionId)
    const journalPath = join(root, `.my-way-transaction-${transactionId}.json`)
    await writeFile(entry.path, 'day-v2')
    await writeFile(entry.backupPath, 'day-corrupt')
    await writeFile(entry.temporaryPath, 'day-v2')
    await writeFile(journalPath, JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'committed',
      entries: [{ ...entry, expectedRevision: revisionOf('day-v1'), nextRevision: revisionOf('day-v2') }]
    }))
    const before = await directorySnapshot(root)

    await expect(new VersionedFileTransaction(undefined, {}, root).recoverAll()).rejects.toThrow()

    expect(await directorySnapshot(root)).toEqual(before)
  })

  it('reaps only strict dead-owner journal temporary files', async () => {
    const dead = join(root, `.my-way-transaction-99999999-${randomUUID()}.json.${randomUUID()}.tmp`)
    const live = join(root, `.my-way-transaction-1-${randomUUID()}.json.${randomUUID()}.tmp`)
    const malformed = join(root, '.my-way-transaction-99999999-crash.json.crash.tmp')
    const generic = join(root, 'notes.tmp')
    await writeFile(dead, 'dead')
    await writeFile(live, 'live')
    await writeFile(malformed, 'malformed')
    await writeFile(generic, 'generic')

    await new VersionedFileTransaction(undefined, {}, root).recoverAll()

    await expect(readFile(dead, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(live, 'utf8')).resolves.toBe('live')
    await expect(readFile(malformed, 'utf8')).resolves.toBe('malformed')
    await expect(readFile(generic, 'utf8')).resolves.toBe('generic')
  })

  it('does not reap an active journal temporary file during publication', async () => {
    const day = join(root, 'day.md')
    const week = join(root, 'week.md')
    await writeFile(day, 'day-v1')
    await writeFile(week, 'week-v1')
    let notifyPublished = (): void => undefined
    let releasePublication = (): void => undefined
    const published = new Promise<void>((resolve) => { notifyPublished = resolve })
    const holdPublication = new Promise<void>((resolve) => { releasePublication = resolve })
    let journalTemporaryGuardCount = 0
    const journalTemporaryName = new RegExp(`^\\.my-way-transaction-${process.pid}-[0-9a-f-]+\\.json\\.[0-9a-f-]+\\.tmp$`, 'i')
    const writer = new VersionedFileTransaction(undefined, {}, root, async (path) => {
      if (!journalTemporaryName.test(basename(path))) return
      journalTemporaryGuardCount += 1
      if (journalTemporaryGuardCount === 3) {
        notifyPublished()
        await holdPublication
      }
    })
    const writing = writer.replaceMany([
      { path: day, content: 'day-v2', expectedRevision: revisionOf('day-v1') },
      { path: week, content: 'week-v2', expectedRevision: revisionOf('week-v1') }
    ])
    await published

    await new VersionedFileTransaction(undefined, {}, root).recoverAll()
    releasePublication()
    await writing

    await expect(readFile(day, 'utf8')).resolves.toBe('day-v2')
    await expect(readFile(week, 'utf8')).resolves.toBe('week-v2')
    expect((await readdir(root)).filter((name) => name.startsWith('.my-way-transaction-'))).toEqual([])
  })

  it('rejects recovery journals that point outside the configured workspace', async () => {
    const outside = join(tmpdir(), `outside-${Date.now()}.md`)
    const target = join(root, 'day.md')
    const transactionId = `99999999-${randomUUID()}`
    await writeFile(target, 'day-v1')
    await writeFile(outside, 'outside')
    await writeFile(join(root, `.my-way-transaction-${transactionId}.json`), JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [{
        path: outside,
        temporaryPath: `${outside}.tmp`,
        backupPath: `${outside}.bak`,
        expectedRevision: revisionOf('outside'),
        nextRevision: revisionOf('forged')
      }]
    }))

    await expect(new VersionedFileTransaction(undefined, {}, root).recover(target)).rejects.toThrow(/路径越界/)
    await expect(readFile(outside, 'utf8')).resolves.toBe('outside')
    await rm(outside, { force: true })
  })

  it('serializes transactions that target the same live backup', async () => {
    const day = join(root, 'day.md')
    await writeFile(day, 'day-v1')
    let notifyClaimed = (): void => undefined
    let releaseClaim = (): void => undefined
    const claimed = new Promise<void>((resolve) => { notifyClaimed = resolve })
    const holdClaim = new Promise<void>((resolve) => { releaseClaim = resolve })
    const first = new VersionedFileTransaction(undefined, {
      afterClaim: async () => { notifyClaimed(); await holdClaim }
    }).replace(day, 'day-v2', revisionOf('day-v1'))
    await claimed
    const second = new VersionedFileTransaction().replace(day, 'day-v3', revisionOf('day-v1'))
    releaseClaim()
    await expect(first).resolves.toBe(revisionOf('day-v2'))
    await expect(second).rejects.toBeInstanceOf(RevisionConflictError)
    await expect(readFile(day, 'utf8')).resolves.toBe('day-v2')
  })

  it('does not recover a live journal published by the current process', async () => {
    const day = join(root, 'day.md')
    const week = join(root, 'week.md')
    await writeFile(day, 'day-v1')
    await writeFile(week, 'week-v1')
    const recovery = new VersionedFileTransaction(undefined, {}, root)
    const writer = new VersionedFileTransaction(undefined, {
      publishJournal: async (_path, publish) => {
        await publish()
        await recovery.recoverAll()
      }
    }, root)

    await expect(writer.replaceMany([
      { path: day, content: 'day-v2', expectedRevision: revisionOf('day-v1') },
      { path: week, content: 'week-v2', expectedRevision: revisionOf('week-v1') }
    ])).resolves.toEqual([revisionOf('day-v2'), revisionOf('week-v2')])

    await expect(readFile(day, 'utf8')).resolves.toBe('day-v2')
    await expect(readFile(week, 'utf8')).resolves.toBe('week-v2')
  }, 1_000)

  it('cleans a failed journal publication without leaving an active recovery marker', async () => {
    const day = join(root, 'day.md')
    const week = join(root, 'week.md')
    await writeFile(day, 'day-v1')
    await writeFile(week, 'week-v1')
    let journalPath = ''
    const writer = new VersionedFileTransaction(undefined, {
      publishJournal: async (path, publish) => {
        journalPath = path
        await publish()
        throw Object.assign(new Error('simulated publication failure'), { code: 'EEXIST' })
      }
    }, root)

    await expect(writer.replaceMany([
      { path: day, content: 'day-v2', expectedRevision: revisionOf('day-v1') },
      { path: week, content: 'week-v2', expectedRevision: revisionOf('week-v1') }
    ])).rejects.toThrow('simulated publication failure')
    expect(journalPath).not.toBe('')
    expect((await readdir(root)).filter((name) => name.endsWith('.tmp') || name.endsWith('.bak') || name.startsWith('.my-way-transaction-'))).toEqual([])

    const transactionId = basename(journalPath).replace(/^\.my-way-transaction-/, '').replace(/\.json$/, '')
    const backupPath = join(root, `.day.md.swap-${transactionId}-${randomUUID()}.bak`)
    const temporaryPath = join(root, `.day.md.${process.pid}.${randomUUID()}.tmp`)
    await writeFile(day, 'day-v2')
    await writeFile(backupPath, 'day-v1')
    await writeFile(temporaryPath, 'day-v2')
    await writeFile(journalPath, JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [{
        path: day,
        temporaryPath,
        backupPath,
        expectedRevision: revisionOf('day-v1'),
        nextRevision: revisionOf('day-v2')
      }]
    }))

    await new VersionedFileTransaction(undefined, {}, root).recoverAll()

    await expect(readFile(day, 'utf8')).resolves.toBe('day-v1')
    await expect(readFile(journalPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('removes already prepared temporary files if a later preparation fails', async () => {
    const day = join(root, 'day.md')
    const week = join(root, 'week.md')
    await writeFile(day, 'day-v1')
    await writeFile(week, 'week-v1')
    const transaction = new VersionedFileTransaction(undefined, {
      beforePrepare: async (path) => { if (path === week) throw new Error('simulated preparation failure') }
    }, root)

    await expect(transaction.replaceMany([
      { path: day, content: 'day-v2', expectedRevision: revisionOf('day-v1') },
      { path: week, content: 'week-v2', expectedRevision: revisionOf('week-v1') }
    ])).rejects.toThrow('simulated preparation failure')

    expect((await readdir(root)).filter((name) => name.endsWith('.tmp'))).toEqual([])
    await expect(readFile(day, 'utf8')).resolves.toBe('day-v1')
    await expect(readFile(week, 'utf8')).resolves.toBe('week-v1')
  })
})
