import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { TimerStateFile } from '../../shared/timerTypes'
import {
  emptyTimerLedger,
  emptyTimerState,
  parseTimerLedger,
  parseTimerState,
  serializeTimerLedger,
  serializeTimerState
} from '../domain/timerFiles'
import { TimerFileStore } from './timerFileStore'
import { RevisionConflictError, revisionOf } from './versionedFileTransaction'

const instant = new Date('2026-08-17T08:00:00.000Z')
const now = (): Date => new Date(instant)

const writeText = async (path: string, content: string): Promise<void> => {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, content)
}

const escapingDirectorySwap = (path: string, outside: string): {
  movedPath: string
  swap: () => Promise<void>
  restore: () => Promise<void>
} => {
  const movedPath = `${path}.safe-parent`
  let moved = false
  let linked = false
  return {
    movedPath,
    swap: async () => {
      await rename(path, movedPath)
      moved = true
      await symlink(outside, path)
      linked = true
    },
    restore: async () => {
      if (linked) await rm(path, { force: true })
      if (moved) await rename(movedPath, path)
    }
  }
}

const outsideSentinel = 'outside-sentinel'
const STRICT_STATE_TEMPORARY = /^\.state\.json\.\d+\.[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.tmp$/i

const swapAndMirrorStateArtifacts = async (
  directorySwap: ReturnType<typeof escapingDirectorySwap>,
  outside: string
): Promise<string[]> => {
  await directorySwap.swap()
  const names = (await readdir(directorySwap.movedPath)).filter((name) => name.startsWith('.state.json.'))
  for (const name of names) await writeFile(join(outside, name), outsideSentinel)
  return names
}

const expectOutsideArtifactsUntouched = async (outside: string, names: string[]): Promise<void> => {
  expect(names.length).toBeGreaterThan(0)
  for (const name of names) await expect(readFile(join(outside, name), 'utf8')).resolves.toBe(outsideSentinel)
  await expect(readFile(join(outside, 'state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
}

const expectNoStrictStateTemporary = async (directory: string): Promise<void> => {
  expect((await readdir(directory)).filter((name) => STRICT_STATE_TEMPORARY.test(name))).toEqual([])
}

describe('TimerFileStore', () => {
  let root = ''

  beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-files-'))) })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  it('creates the initial state exactly once with valid content and its content revision', async () => {
    let createInstalls = 0
    const store = new TimerFileStore(root, now, {
      beforeCreateInstall: async () => { createInstalls += 1 }
    })

    const first = await store.state()
    const second = await store.state()
    const source = await readFile(first.path, 'utf8')

    expect(first.path).toBe(join(root, 'data/timer/state.json'))
    expect(first.value).toEqual(emptyTimerState(instant))
    expect(parseTimerState(source, first.path)).toEqual(first.value)
    expect(first.revision).toBe(revisionOf(source))
    expect(second).toEqual(first)
    expect(createInstalls).toBe(1)
  })

  it('converges concurrent first state reads on one valid authoritative file', async () => {
    const stores = Array.from({ length: 8 }, () => new TimerFileStore(root, now))

    const files = await Promise.all(stores.map((store) => store.state()))
    const source = await readFile(join(root, 'data/timer/state.json'), 'utf8')

    expect(new Set(files.map((file) => file.revision))).toEqual(new Set([revisionOf(source)]))
    expect(files.every((file) => file.path === join(root, 'data/timer/state.json'))).toBe(true)
    expect(parseTimerState(source, files[0].path)).toEqual(emptyTimerState(instant))
    await expect(readdir(join(root, 'data/timer'))).resolves.toEqual(['state.json'])
  })

  it('revalidates a newly created state parent after beforePrepare before installing', async () => {
    const timerDirectory = join(root, 'data/timer')
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-state-race-')))
    const directorySwap = escapingDirectorySwap(timerDirectory, outside)
    const store = new TimerFileStore(root, now, { beforePrepare: directorySwap.swap })

    try {
      await expect(store.state()).rejects.toThrow(/符号链接/)
      await expect(readdir(outside)).resolves.toEqual([])
    } finally {
      await directorySwap.restore()
      await rm(outside, { recursive: true, force: true })
    }
    await expect(readFile(join(timerDirectory, 'state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('replaces state with CAS and preserves the newer content after a stale save', async () => {
    const store = new TimerFileStore(root, now)
    const original = await store.state()
    const newerValue: TimerStateFile = {
      ...original.value,
      updatedAt: '2026-08-17T08:01:00.000Z'
    }
    const saved = await store.saveState({ ...original, value: newerValue })
    const staleValue: TimerStateFile = {
      ...original.value,
      updatedAt: '2026-08-17T08:02:00.000Z'
    }

    await expect(store.saveState({ ...original, value: staleValue })).rejects.toBeInstanceOf(RevisionConflictError)

    const source = await readFile(original.path, 'utf8')
    expect(saved).toEqual({ path: original.path, revision: revisionOf(source), value: newerValue })
    expect(source).toBe(serializeTimerState(newerValue))
  })

  it('revalidates a state replace target after beforePrepare', async () => {
    const original = await new TimerFileStore(root, now).state()
    const timerDirectory = dirname(original.path)
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-save-race-')))
    const directorySwap = escapingDirectorySwap(timerDirectory, outside)
    const store = new TimerFileStore(root, now, { beforePrepare: directorySwap.swap })
    const value = { ...original.value, updatedAt: '2026-08-17T08:01:00.000Z' }

    try {
      await expect(store.saveState({ ...original, value })).rejects.toThrow(/符号链接/)
      await expect(readdir(outside)).resolves.toEqual([])
    } finally {
      await directorySwap.restore()
      await rm(outside, { recursive: true, force: true })
    }
    await expect(readFile(original.path, 'utf8')).resolves.toBe(serializeTimerState(original.value))
  })

  it('does not roll back through an outside parent after afterClaim', async () => {
    const original = await new TimerFileStore(root, now).state()
    const timerDirectory = dirname(original.path)
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-after-claim-')))
    const directorySwap = escapingDirectorySwap(timerDirectory, outside)
    let mirroredNames: string[] = []
    const store = new TimerFileStore(root, now, {
      afterClaim: async () => { mirroredNames = await swapAndMirrorStateArtifacts(directorySwap, outside) }
    })
    const value = { ...original.value, updatedAt: '2026-08-17T08:01:00.000Z' }

    try {
      await expect(store.saveState({ ...original, value })).rejects.toThrow()
      await expectOutsideArtifactsUntouched(outside, mirroredNames)
    } finally {
      await directorySwap.restore()
      await rm(outside, { recursive: true, force: true })
    }
    const recovered = await new TimerFileStore(root, now).state()
    expect(recovered.value).toEqual(original.value)
    await expectNoStrictStateTemporary(timerDirectory)
  })

  it('does not delete outside artifacts after beforeCreateInstall loses containment', async () => {
    const timerDirectory = join(root, 'data/timer')
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-before-create-install-')))
    const directorySwap = escapingDirectorySwap(timerDirectory, outside)
    let mirroredNames: string[] = []
    const store = new TimerFileStore(root, now, {
      beforeCreateInstall: async () => { mirroredNames = await swapAndMirrorStateArtifacts(directorySwap, outside) }
    })

    try {
      await expect(store.state()).rejects.toThrow()
      await expectOutsideArtifactsUntouched(outside, mirroredNames)
    } finally {
      await directorySwap.restore()
      await rm(outside, { recursive: true, force: true })
    }
    const malformedTemporary = join(timerDirectory, '.state.json.crash.tmp')
    await writeFile(malformedTemporary, 'malformed-noise')
    await expect(new TimerFileStore(root, now).state()).resolves.toMatchObject({ value: emptyTimerState(instant) })
    await expectNoStrictStateTemporary(timerDirectory)
    await expect(readFile(malformedTemporary, 'utf8')).resolves.toBe('malformed-noise')
  })

  it('does not roll back through an outside parent after beforeInstall', async () => {
    const original = await new TimerFileStore(root, now).state()
    const timerDirectory = dirname(original.path)
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-before-install-')))
    const directorySwap = escapingDirectorySwap(timerDirectory, outside)
    let mirroredNames: string[] = []
    const store = new TimerFileStore(root, now, {
      beforeInstall: async () => { mirroredNames = await swapAndMirrorStateArtifacts(directorySwap, outside) }
    })
    const value = { ...original.value, updatedAt: '2026-08-17T08:01:00.000Z' }

    try {
      await expect(store.saveState({ ...original, value })).rejects.toThrow()
      await expectOutsideArtifactsUntouched(outside, mirroredNames)
    } finally {
      await directorySwap.restore()
      await rm(outside, { recursive: true, force: true })
    }
    const recovered = await new TimerFileStore(root, now).state()
    expect(recovered.value).toEqual(original.value)
    await expectNoStrictStateTemporary(timerDirectory)
  })

  it('reports a post-commit containment loss and leaves cleanup artifacts recoverable', async () => {
    const original = await new TimerFileStore(root, now).state()
    const timerDirectory = dirname(original.path)
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-before-cleanup-')))
    const directorySwap = escapingDirectorySwap(timerDirectory, outside)
    let mirroredNames: string[] = []
    const store = new TimerFileStore(root, now, {
      beforeBackupCleanup: async () => { mirroredNames = await swapAndMirrorStateArtifacts(directorySwap, outside) }
    })
    const value = { ...original.value, updatedAt: '2026-08-17T08:01:00.000Z' }

    try {
      await expect(store.saveState({ ...original, value })).rejects.toThrow()
      await expectOutsideArtifactsUntouched(outside, mirroredNames)
    } finally {
      await directorySwap.restore()
      await rm(outside, { recursive: true, force: true })
    }
    const recovered = await new TimerFileStore(root, now).state()
    expect(recovered.value).toEqual(value)
    expect((await readdir(timerDirectory)).some((name) => name.startsWith('state.conflict-external-'))).toBe(true)
    await expectNoStrictStateTemporary(timerDirectory)
  })

  it('rejects journal publication after the selected workspace root is replaced', async () => {
    const store = new TimerFileStore(root, now)
    const state = await store.state()
    const ledger = await store.ledger('2026-08-17', true)
    if (!ledger) throw new Error('expected ledger')
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-journal-root-swap-')))
    const rootSwap = escapingDirectorySwap(root, outside)
    const outsideSentinelPath = join(outside, 'outside-sentinel.txt')
    await writeFile(outsideSentinelPath, outsideSentinel)
    let journalPath = ''
    const guardedStore = new TimerFileStore(root, now, {
      publishJournal: async (path, publish) => {
        journalPath = path
        await rootSwap.swap()
        await publish()
      }
    })
    const nextState = serializeTimerState({ ...state.value, updatedAt: '2026-08-17T08:01:00.000Z' })
    const nextLedger = serializeTimerLedger({
      ...ledger.value,
      ledger: { ...ledger.value.ledger, updatedAt: '2026-08-17T08:01:00.000Z' }
    })

    try {
      await expect(guardedStore.transaction().replaceMany([
        { path: state.path, content: nextState, expectedRevision: state.revision },
        { path: ledger.path, content: nextLedger, expectedRevision: ledger.revision }
      ])).rejects.toThrow(/工作区根目录已被替换/)
      expect(journalPath).not.toBe('')
      await expect(readdir(outside)).resolves.toEqual(['outside-sentinel.txt'])
      await expect(readFile(outsideSentinelPath, 'utf8')).resolves.toBe(outsideSentinel)
    } finally {
      await rootSwap.restore()
      await rm(outside, { recursive: true, force: true })
    }

    const recoveredStore = new TimerFileStore(root, now)
    await expect(recoveredStore.state()).resolves.toMatchObject({ value: state.value })
    await expect(recoveredStore.ledger('2026-08-17', false)).resolves.toMatchObject({ value: ledger.value })
  })

  it('returns null for a missing ledger and converges concurrent creation', async () => {
    const store = new TimerFileStore(root, now)

    await expect(store.ledger('2026-08-17', false)).resolves.toBeNull()
    const files = await Promise.all(Array.from({ length: 8 }, () => store.ledger('2026-08-17', true)))
    const path = join(root, 'data/timer/2026/2026-08-17.md')
    const source = await readFile(path, 'utf8')

    expect(files.every((file) => file?.path === path)).toBe(true)
    expect(new Set(files.map((file) => file?.revision))).toEqual(new Set([revisionOf(source)]))
    expect(parseTimerLedger(source, path)).toEqual(emptyTimerLedger('2026-08-17', instant))
    await expect(readdir(dirname(path))).resolves.toEqual(['2026-08-17.md'])
  })

  it('revalidates a newly created ledger parent after beforePrepare before installing', async () => {
    const yearDirectory = join(root, 'data/timer/2026')
    const outside = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-ledger-race-')))
    const directorySwap = escapingDirectorySwap(yearDirectory, outside)
    const store = new TimerFileStore(root, now, { beforePrepare: directorySwap.swap })

    try {
      await expect(store.ledger('2026-08-17', true)).rejects.toThrow(/符号链接/)
      await expect(readdir(outside)).resolves.toEqual([])
    } finally {
      await directorySwap.restore()
      await rm(outside, { recursive: true, force: true })
    }
    await expect(readFile(join(yearDirectory, '2026-08-17.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('preserves the ledger body and replaces it with revision CAS', async () => {
    const store = new TimerFileStore(root, now)
    const original = await store.ledger('2026-08-17', true)
    if (!original) throw new Error('expected ledger')
    const next = {
      ...original,
      value: {
        ledger: { ...original.value.ledger, updatedAt: '2026-08-17T08:01:00.000Z' },
        body: '# Timer sessions  \n\nA custom note with spaces.   \n'
      }
    }

    const saved = await store.saveLedger(next)
    await expect(store.saveLedger(original)).rejects.toBeInstanceOf(RevisionConflictError)

    const source = await readFile(original.path, 'utf8')
    expect(saved.revision).toBe(revisionOf(source))
    expect(parseTimerLedger(source, original.path)).toEqual(next.value)
    expect(parseTimerLedger(source, original.path).body).toBe(next.value.body)
  })

  it('lists only canonical ledgers in ascending date order', async () => {
    const canonicalDates = ['2025-12-31', '2026-01-02', '2026-08-17']
    for (const date of [...canonicalDates].reverse()) {
      const path = join(root, `data/timer/${date.slice(0, 4)}/${date}.md`)
      await writeText(path, serializeTimerLedger(emptyTimerLedger(date, instant)))
    }
    await writeText(join(root, 'data/timer/state.json'), serializeTimerState(emptyTimerState(instant)))
    await writeText(join(root, 'data/timer/2026/.2026-08-18.md.123.tmp'), 'noise')
    await writeText(join(root, 'data/timer/2026/.2026-08-18.md.swap-999-dead.bak'), 'noise')
    await writeText(join(root, 'data/timer/2026/2026-08-18.conflict.md'), 'noise')
    await writeText(join(root, 'data/timer/2026/2026-08-18.json'), 'noise')
    await writeText(join(root, 'data/timer/2026/2026-02-30.md'), 'noise')
    await writeText(join(root, 'data/timer/2025/2026-08-18.md'), 'noise')
    await writeText(join(root, 'data/timer/misc/2026-08-18.md'), 'noise')
    await writeText(join(root, 'data/timer/2026/nested/2026-08-18.md'), 'noise')

    const files = await new TimerFileStore(root, now).listLedgers()

    expect(files.map((file) => file.value.ledger.date)).toEqual(canonicalDates)
    expect(files.map((file) => file.path)).toEqual(canonicalDates.map(
      (date) => join(root, `data/timer/${date.slice(0, 4)}/${date}.md`)
    ))
  })

  it('recovers a canonical ledger that exists only as a realistic crash backup before listing', async () => {
    const date = '2026-08-17'
    const directory = join(root, 'data/timer/2026')
    const path = join(directory, `${date}.md`)
    const document = {
      ...emptyTimerLedger(date, instant),
      ledger: {
        ...emptyTimerLedger(date, instant).ledger,
        sessions: [{
          id: 'pending-session',
          mode: 'elapsed' as const,
          startedAt: '2026-08-17T08:00:00.000Z',
          endedAt: '2026-08-17T08:01:00.000Z',
          durationSeconds: 60,
          status: 'pending' as const
        }],
        updatedAt: '2026-08-17T08:01:00.000Z'
      }
    }
    const source = serializeTimerLedger(document)
    const backup = join(directory, `.${date}.md.swap-99999999-${randomUUID()}-${randomUUID()}.bak`)
    const temporary = join(directory, `.${date}.md.${process.pid}.${randomUUID()}.tmp`)
    const malformedBackup = join(directory, `.${date}.md.swap-zzzz.bak`)
    await writeText(backup, source)
    await writeText(temporary, source)
    await writeText(malformedBackup, 'malformed-later-backup')

    const files = await new TimerFileStore(root, now).listLedgers()

    expect(files).toHaveLength(1)
    expect(files[0].path).toBe(path)
    expect(files[0].value.ledger.sessions).toEqual(document.ledger.sessions)
    await expect(readFile(path, 'utf8')).resolves.toBe(source)
    await expect(readFile(backup, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(malformedBackup, 'utf8')).resolves.toBe('malformed-later-backup')
  })

  it('rejects a corrupt canonical ledger by exact path instead of skipping it', async () => {
    const corruptPath = join(root, 'data/timer/2026/2026-08-17.md')
    await writeText(corruptPath, '---\nschemaVersion: [\n---\n')

    await expect(new TimerFileStore(root, now).listLedgers()).rejects.toThrow(corruptPath)
  })

  it('rejects a canonical ledger layout that escapes through a year symlink', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'my-way-timer-list-outside-'))
    try {
      await mkdir(join(root, 'data/timer'), { recursive: true })
      await writeFile(join(outside, '2026-08-17.md'), serializeTimerLedger(emptyTimerLedger('2026-08-17', instant)))
      await symlink(outside, join(root, 'data/timer/2026'))

      await expect(new TimerFileStore(root, now).listLedgers()).rejects.toThrow(/符号链接/)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it.each([
    ['bad YAML', '---\nschemaVersion: [\n---\n'],
    ['unknown ledger schema', "---\nschemaVersion: 2\ndate: '2026-08-17'\nsessions: []\nupdatedAt: '2026-08-17T08:00:00.000Z'\n---\n"]
  ])('reports and preserves the exact canonical ledger path for %s', async (_label, source) => {
    const path = join(root, 'data/timer/2026/2026-08-17.md')
    await writeText(path, source)

    await expect(new TimerFileStore(root, now).ledger('2026-08-17', true)).rejects.toThrow(path)
    await expect(readFile(path, 'utf8')).resolves.toBe(source)
  })

  it('reports and preserves the exact state path for malformed JSON', async () => {
    const path = join(root, 'data/timer/state.json')
    await writeText(path, '{')

    await expect(new TimerFileStore(root, now).state()).rejects.toThrow(path)
    await expect(readFile(path, 'utf8')).resolves.toBe('{')
  })

  it('normalizes safe timer paths and rejects traversal, outside paths, and escaping symlinks', async () => {
    const store = new TimerFileStore(root, now)
    const state = await store.state()
    const ledger = await store.ledger('2026-08-17', true)
    if (!ledger) throw new Error('expected ledger')

    await expect(store.relativeTimerPath(state.path)).resolves.toBe('data/timer/state.json')
    await expect(store.relativeTimerPath(ledger.path)).resolves.toBe('data/timer/2026/2026-08-17.md')
    await expect(store.relativeTimerPath('data\\timer\\2026\\2026-08-17.md')).resolves.toBe(
      'data/timer/2026/2026-08-17.md'
    )
    await expect(store.relativeTimerPath('data/timer/../state.json')).rejects.toThrow()
    await expect(store.relativeTimerPath(join(tmpdir(), 'outside-state.json'))).rejects.toThrow()
    await expect(store.relativeTimerPath('data/daily/2026/2026-08-17.md')).rejects.toThrow()

    const outside = await mkdtemp(join(tmpdir(), 'my-way-timer-outside-'))
    const escapedPath = join(root, 'data/timer/2027/2027-01-01.md')
    try {
      await writeFile(join(outside, '2027-01-01.md'), 'outside')
      await symlink(outside, join(root, 'data/timer/2027'))
      await expect(store.relativeTimerPath(escapedPath)).rejects.toThrow(/符号链接/)
    } finally {
      await rm(outside, { recursive: true, force: true })
    }
  })

  it('rejects invalid calendar dates before deriving a ledger path', async () => {
    const store = new TimerFileStore(root, now)

    await expect(store.ledger('2026-02-30', true)).rejects.toThrow('2026-02-30')
    await expect(store.ledger('2026-2-03', true)).rejects.toThrow('2026-2-03')
    await expect(readdir(root)).resolves.toEqual([])
  })

  it('validates save paths against the exact canonical state and ledger paths', async () => {
    const store = new TimerFileStore(root, now)
    const state = await store.state()
    const ledger = await store.ledger('2026-08-17', true)
    if (!ledger) throw new Error('expected ledger')

    await expect(store.saveState({ ...state, path: ledger.path })).rejects.toThrow()
    await expect(store.saveLedger({ ...ledger, path: state.path })).rejects.toThrow()
    await expect(store.saveLedger({
      ...ledger,
      value: { ...ledger.value, ledger: { ...ledger.value.ledger, date: '2026-08-18' } }
    })).rejects.toThrow()
  })

  it('runs workspace-root transaction journal recovery before reads return', async () => {
    const statePath = join(root, 'data/timer/state.json')
    const ledgerPath = join(root, 'data/timer/2026/2026-08-17.md')
    const stateV1 = serializeTimerState(emptyTimerState(instant))
    const stateV2 = serializeTimerState({ ...emptyTimerState(instant), updatedAt: '2026-08-17T08:01:00.000Z' })
    const ledgerV1 = serializeTimerLedger(emptyTimerLedger('2026-08-17', instant))
    const ledgerV2 = serializeTimerLedger({
      ...emptyTimerLedger('2026-08-17', instant),
      ledger: { ...emptyTimerLedger('2026-08-17', instant).ledger, updatedAt: '2026-08-17T08:01:00.000Z' }
    })
    const transactionId = `99999999-${randomUUID()}`
    const stateBackup = join(dirname(statePath), `.state.json.swap-${transactionId}-${randomUUID()}.bak`)
    const ledgerBackup = join(dirname(ledgerPath), `.2026-08-17.md.swap-${transactionId}-${randomUUID()}.bak`)
    const stateTemporary = join(dirname(statePath), `.state.json.99999999.${randomUUID()}.tmp`)
    const ledgerTemporary = join(dirname(ledgerPath), `.2026-08-17.md.99999999.${randomUUID()}.tmp`)
    await writeText(statePath, stateV2)
    await writeText(ledgerPath, ledgerV2)
    await writeText(stateBackup, stateV1)
    await writeText(ledgerBackup, ledgerV1)
    await writeText(stateTemporary, stateV2)
    await writeText(ledgerTemporary, ledgerV2)
    await writeFile(join(root, `.my-way-transaction-${transactionId}.json`), JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [
        {
          path: statePath,
          temporaryPath: stateTemporary,
          backupPath: stateBackup,
          expectedRevision: revisionOf(stateV1),
          nextRevision: revisionOf(stateV2)
        },
        {
          path: ledgerPath,
          temporaryPath: ledgerTemporary,
          backupPath: ledgerBackup,
          expectedRevision: revisionOf(ledgerV1),
          nextRevision: revisionOf(ledgerV2)
        }
      ]
    }))

    const state = await new TimerFileStore(root, now).state()

    expect(state.value.updatedAt).toBe(instant.toISOString())
    await expect(readFile(statePath, 'utf8')).resolves.toBe(stateV1)
    await expect(readFile(ledgerPath, 'utf8')).resolves.toBe(ledgerV1)
    expect((await readdir(root)).filter((name) => name.startsWith('.my-way-transaction-'))).toEqual([])
  })

  it('exposes explicit workspace-root transaction recovery', async () => {
    const statePath = join(root, 'data/timer/state.json')
    const ledgerPath = join(root, 'data/timer/2026/2026-08-17.md')
    const stateV1 = serializeTimerState(emptyTimerState(instant))
    const stateV2 = serializeTimerState({ ...emptyTimerState(instant), updatedAt: '2026-08-17T08:01:00.000Z' })
    const ledgerV1 = serializeTimerLedger(emptyTimerLedger('2026-08-17', instant))
    const ledgerV2 = serializeTimerLedger({
      ...emptyTimerLedger('2026-08-17', instant),
      ledger: { ...emptyTimerLedger('2026-08-17', instant).ledger, updatedAt: '2026-08-17T08:01:00.000Z' }
    })
    const transactionId = `99999999-${randomUUID()}`
    const stateBackup = join(dirname(statePath), `.state.json.swap-${transactionId}-${randomUUID()}.bak`)
    const ledgerBackup = join(dirname(ledgerPath), `.2026-08-17.md.swap-${transactionId}-${randomUUID()}.bak`)
    const stateTemporary = join(dirname(statePath), `.state.json.99999999.${randomUUID()}.tmp`)
    const ledgerTemporary = join(dirname(ledgerPath), `.2026-08-17.md.99999999.${randomUUID()}.tmp`)
    await writeText(statePath, stateV2)
    await writeText(ledgerPath, ledgerV2)
    await writeText(stateBackup, stateV1)
    await writeText(ledgerBackup, ledgerV1)
    await writeText(stateTemporary, stateV2)
    await writeText(ledgerTemporary, ledgerV2)
    await writeFile(join(root, `.my-way-transaction-${transactionId}.json`), JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [
        {
          path: statePath,
          temporaryPath: stateTemporary,
          backupPath: stateBackup,
          expectedRevision: revisionOf(stateV1),
          nextRevision: revisionOf(stateV2)
        },
        {
          path: ledgerPath,
          temporaryPath: ledgerTemporary,
          backupPath: ledgerBackup,
          expectedRevision: revisionOf(ledgerV1),
          nextRevision: revisionOf(ledgerV2)
        }
      ]
    }))

    const store = new TimerFileStore(root, now)
    expect(store.transaction()).toBe(store.transaction())
    await store.recoverAll()

    await expect(readFile(statePath, 'utf8')).resolves.toBe(stateV1)
    await expect(readFile(ledgerPath, 'utf8')).resolves.toBe(ledgerV1)
    expect((await readdir(root)).filter((name) => name.startsWith('.my-way-transaction-'))).toEqual([])
  })
})
