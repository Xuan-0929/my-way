import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ZodError } from 'zod'
import type { TimerSession } from '../../shared/timerTypes'
import type { FileChangeEvent } from '../../shared/api'
import {
  emptyTimerLedger,
  emptyTimerState,
  parseTimerLedger,
  parseTimerState,
  serializeTimerLedger,
  serializeTimerState
} from '../domain/timerFiles'
import { parseDailyRecord, serializeDailyRecord } from '../domain/dailyRecord'
import { elapsedSeconds, localDateAt } from '../domain/timerMath'
import { DailyFileService } from './dailyFileService'
import { TimerFileStore } from './timerFileStore'
import { revisionOf } from './versionedFileTransaction'
import {
  TimerService,
  type TimerRuntime
} from './timerService'

const instant = new Date('2026-08-17T08:00:00.000Z')

class FakeRuntime implements TimerRuntime {
  current = new Date(instant)
  readonly scheduled: Array<{ handle: object; callback: () => void; milliseconds: number; cleared: boolean }> = []

  now = (): Date => new Date(this.current)

  setTimeout = (callback: () => void, milliseconds: number): unknown => {
    const entry = { handle: {}, callback, milliseconds, cleared: false }
    this.scheduled.push(entry)
    return entry.handle
  }

  clearTimeout = (handle: unknown): void => {
    const entry = this.scheduled.find((candidate) => candidate.handle === handle)
    if (entry) entry.cleared = true
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds)
  }
}

const ledgerSession = (id: string) => ({
  id,
  mode: 'elapsed' as const,
  status: 'pending' as const,
  startedAt: '2026-08-17T08:00:00.000Z',
  endedAt: '2026-08-17T08:01:00.000Z',
  durationSeconds: 60
})

const writeLedger = async (root: string, date: string, ids: string[]): Promise<string> => {
  const path = join(root, `data/timer/${date.slice(0, 4)}/${date}.md`)
  await mkdir(join(root, `data/timer/${date.slice(0, 4)}`), { recursive: true })
  const document = emptyTimerLedger(date, instant)
  document.ledger.sessions = ids.map(ledgerSession)
  await writeFile(path, serializeTimerLedger(document))
  return path
}

const writeSessions = async (
  root: string,
  date: string,
  sessions: TimerSession[],
  body = '# preserved timer notes\n'
): Promise<string> => {
  const path = join(root, `data/timer/${date.slice(0, 4)}/${date}.md`)
  await mkdir(join(root, `data/timer/${date.slice(0, 4)}`), { recursive: true })
  const document = emptyTimerLedger(date, instant)
  document.ledger.sessions = sessions
  document.body = body
  await writeFile(path, serializeTimerLedger(document))
  return path
}

const pendingSession = (
  id: string,
  endedAt = '2026-08-17T08:01:00.000Z',
  durationSeconds = 60
): TimerSession => ({
  id,
  mode: 'elapsed',
  status: 'pending',
  startedAt: new Date(Date.parse(endedAt) - durationSeconds * 1000).toISOString(),
  endedAt,
  durationSeconds
})

const changed = (path: string, kind: FileChangeEvent['kind'] = 'changed'): FileChangeEvent => ({
  kind,
  path,
  at: '2026-08-20T00:00:00.000Z'
})

const createDayTask = async (
  root: string,
  runtime: FakeRuntime,
  date = '2026-08-17',
  actualMinutes = 10
): Promise<{ days: DailyFileService; path: string }> => {
  const days = new DailyFileService(root, runtime.now)
  const opened = await days.open(date, { create: true })
  if (!opened) throw new Error('expected day')
  opened.file.value.tasks.push({
    id: 'task-1',
    date,
    originalDate: date,
    category: 'nlp',
    title: 'Read transformer paper',
    plannedMinutes: 90,
    deliverable: 'notes',
    actualMinutes,
    status: 'in_progress',
    evidence: [],
    notes: 'keep',
    outcomes: 'keep'
  })
  const saved = await days.save(opened.file.path, opened.file.value, opened.file.revision)
  return { days, path: saved.path }
}

describe('TimerService', () => {
  let root = ''
  let defaultDays: DailyFileService

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-service-')))
    await mkdir(join(root, '00-dashboard/weeks'), { recursive: true })
    defaultDays = new DailyFileService(root, () => new Date(instant))
  })
  afterEach(async () => rm(root, { recursive: true, force: true }))

  it.each(['elapsed', 'countdown'] as const)('retargets %s without restarting its segment', async (mode) => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), new DailyFileService(root, runtime.now), runtime)
    const initial = await service.start(mode === 'elapsed'
      ? { sessionId: 'retarget', mode } : { sessionId: 'retarget', mode, countdownMinutes: 25 })
    runtime.advance(65_000)
    const taskIntent = { date: localDateAt(runtime.now()), taskId: 'fitness', taskTitle: '力量训练' }
    const next = await service.setTaskIntent({ sessionId: 'retarget', taskIntent })
    expect(next.active).toEqual({ ...initial.active, taskIntent, updatedAt: runtime.now().toISOString() })
    expect(elapsedSeconds(next.active!, runtime.now())).toBe(65)
    const cleared = await service.setTaskIntent({ sessionId: 'retarget', taskIntent: null })
    expect(cleared.active?.taskIntent).toBeUndefined()
    expect(elapsedSeconds(cleared.active!, runtime.now())).toBe(65)
    const ended = await service.end()
    expect(ended.session.durationSeconds).toBe(65)
    expect(ended.session.status).toBe('pending')
    await expect(service.setTaskIntent({ sessionId: 'retarget', taskIntent: null })).rejects.toThrow('没有计时器')
    await service.dispose()
  })

  it('preserves paused timing and recovers the last successfully saved intent', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const days = new DailyFileService(root, runtime.now)
    const service = new TimerService(store, days, runtime)
    await service.start({ sessionId: 'retarget', mode: 'elapsed' })
    runtime.advance(12_000)
    const before = await service.pause()
    const taskIntent = { date: localDateAt(runtime.now()), taskId: 'a', taskTitle: '任务 A' }
    runtime.advance(10_000)
    const after = await service.setTaskIntent({ sessionId: 'retarget', taskIntent })
    expect(after.active).toEqual({ ...before.active, taskIntent, updatedAt: runtime.now().toISOString() })
    await service.resume()
    await service.dispose()
    const reopened = new TimerService(store, days, runtime)
    expect((await reopened.load()).active).toMatchObject({ status: 'paused', taskIntent, pauseReason: 'recovered_after_interruption' })
    expect((await reopened.end()).session.taskIntent).toEqual(taskIntent)
    await reopened.dispose()
  })

  it('rejects a stale session and yesterday intent after midnight without changing the timer', async () => {
    const runtime = new FakeRuntime()
    runtime.current = new Date(2026, 8, 2, 23, 59, 59)
    const service = new TimerService(new TimerFileStore(root, runtime.now), new DailyFileService(root, runtime.now), runtime)
    const before = await service.start({ sessionId: 'retarget', mode: 'elapsed' })
    const taskIntent = { date: localDateAt(runtime.now()), taskId: 'a', taskTitle: '任务 A' }
    runtime.advance(2000)
    await expect(service.setTaskIntent({ sessionId: 'stale', taskIntent: null })).rejects.toThrow('会话已变化')
    await expect(service.setTaskIntent({ sessionId: 'retarget', taskIntent })).rejects.toThrow('日期已变化')
    expect((await service.get()).active).toEqual(before.active)
    await service.dispose()
  })

  it('lets the countdown deadline win over a late intent update', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), new DailyFileService(root, runtime.now), runtime)
    await service.start({ sessionId: 'retarget', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(60_000)
    const result = await service.setTaskIntent({ sessionId: 'retarget', taskIntent: null })
    expect(result.active).toBeNull()
    expect(result.completion?.sessionId).toBe('retarget')
    await service.dispose()
  })

  it('never overwrites an external timer edit when retargeting', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), new DailyFileService(root, runtime.now), runtime)
    await service.start({ sessionId: 'retarget', mode: 'elapsed' })
    const statePath = join(root, 'data/timer/state.json')
    const external = (await readFile(statePath, 'utf8')) + '\n'
    await writeFile(statePath, external)
    await expect(service.setTaskIntent({ sessionId: 'retarget', taskIntent: null })).rejects.toThrow()
    expect(await readFile(statePath, 'utf8')).toBe(external)
    await service.dispose()
  })

  it('loads an idle state with an immutable snapshot captured at the runtime clock', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(
      new TimerFileStore(root, () => new Date(instant)),
      defaultDays,
      runtime
    )

    const snapshot = await service.load()

    expect(snapshot).toEqual({ active: null, capturedAt: instant.toISOString() })
    expect(Object.isFrozen(snapshot)).toBe(true)
  })

  it('atomically ends an elapsed timer into the local-date pending ledger', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    await service.start({ sessionId: 'ended-elapsed', mode: 'elapsed' })
    runtime.advance(125_000)

    const result = await service.end()

    expect(result).toMatchObject({
      proposedMinutes: 2,
      session: {
        id: 'ended-elapsed',
        mode: 'elapsed',
        status: 'pending',
        startedAt: instant.toISOString(),
        endedAt: runtime.now().toISOString(),
        durationSeconds: 125
      }
    })
    expect((await store.state()).value.active).toBeNull()
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions).toEqual([result.session])
  })

  it('persists a task intent from start through the pending ledger session', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    const taskIntent = {
      date: '2026-08-17',
      taskId: 'nlp-01',
      taskTitle: 'Read the Transformer paper'
    }

    const started = await service.start({ sessionId: 'task-focused', mode: 'elapsed', taskIntent })
    expect(started.active).toMatchObject({ taskIntent })

    runtime.advance(125_000)
    const result = await service.end()

    expect(result.session).toMatchObject({ id: 'task-focused', status: 'pending', taskIntent })
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions).toEqual([result.session])
  })

  it('automatically ends a due countdown through the same durable accounting path', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    const delivered: Array<{ completion?: { sessionId: string; endedAt: string } }> = []
    service.subscribe((snapshot) => { delivered.push(snapshot) })
    await service.start({ sessionId: 'auto-ended', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(75_000)

    runtime.scheduled[0].callback()
    await service.get()

    const ledger = await store.ledger('2026-08-17', false)
    expect(ledger?.value.ledger.sessions).toMatchObject([{
      id: 'auto-ended',
      durationSeconds: 60,
      targetSeconds: 60,
      endedAt: '2026-08-17T08:01:00.000Z',
      status: 'pending'
    }])
    expect((await store.state()).value.active).toBeNull()
    expect(delivered.at(-1)?.completion).toEqual({
      sessionId: 'auto-ended',
      endedAt: '2026-08-17T08:01:00.000Z'
    })
    expect(delivered.filter(({ completion }) => completion !== undefined)).toHaveLength(1)
  })

  it('settles an already-expired countdown at its exact due instant when End wins the callback race', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    const delivered: Array<{ completion?: { sessionId: string; endedAt: string } }> = []
    service.subscribe((snapshot) => { delivered.push(snapshot) })
    await service.start({ sessionId: 'end-after-zero', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(75_000)

    const result = await service.end()

    expect(result.session).toMatchObject({
      id: 'end-after-zero',
      durationSeconds: 60,
      targetSeconds: 60,
      endedAt: '2026-08-17T08:01:00.000Z'
    })
    expect(delivered.filter(({ completion }) => completion !== undefined)).toEqual([{
      active: null,
      capturedAt: '2026-08-17T08:01:15.000Z',
      completion: { sessionId: 'end-after-zero', endedAt: '2026-08-17T08:01:00.000Z' }
    }])
  })

  it.each([1, 2, 25, 50, 90, 120, 180])(
    'durably caps an automatic %i-minute countdown at its exact target',
    async (minutes) => {
      const runtime = new FakeRuntime()
      const store = new TimerFileStore(root, runtime.now)
      const service = new TimerService(store, defaultDays, runtime)
      await service.start({ sessionId: `auto-${minutes}`, mode: 'countdown', countdownMinutes: minutes })
      runtime.advance(minutes * 60_000 + 30_000)

      runtime.scheduled[0].callback()
      await service.get()

      expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions[0]).toMatchObject({
        id: `auto-${minutes}`,
        targetSeconds: minutes * 60,
        durationSeconds: minutes * 60,
        endedAt: new Date(instant.getTime() + minutes * 60_000).toISOString()
      })
    }
  )

  it('settles a resumed countdown from accumulated segments without counting paused time', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'resumed-auto', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(10_000)
    await service.pause()
    runtime.advance(90_000)
    await service.resume()
    runtime.advance(50_000)

    runtime.scheduled[1].callback()
    await service.get()

    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions[0]).toMatchObject({
      id: 'resumed-auto',
      durationSeconds: 60,
      endedAt: runtime.now().toISOString()
    })
  })

  it.each(['beforePrepare', 'afterClaim', 'beforeInstall'] as const)(
    'keeps active state and ledger atomic when due settlement fails at %s',
    async (phase) => {
      const runtime = new FakeRuntime()
      let armed = false
      const hook = async (): Promise<void> => {
        if (armed) throw new Error(`due ${phase} failure`)
      }
      const store = new TimerFileStore(root, runtime.now, { [phase]: hook })
      const service = new TimerService(store, defaultDays, runtime)
      await service.start({ sessionId: `due-${phase}`, mode: 'countdown', countdownMinutes: 1 })
      armed = true
      runtime.advance(60_000)

      await expect(service.pause()).rejects.toThrow(`due ${phase} failure`)

      expect((await store.state()).value.active?.id).toBe(`due-${phase}`)
      expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions ?? []).toEqual([])
    }
  )

  it('cannot bypass durable automatic accounting through a constructor callback', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    let bypassCalls = 0
    const bypass = async (): Promise<void> => { bypassCalls += 1 }
    const service = new TimerService(store, bypass as unknown as DailyFileService, runtime)
    await service.start({ sessionId: 'no-accounting-bypass', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(60_000)

    runtime.scheduled[0].callback()
    await service.get()

    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions.map(({ id }) => id))
      .toEqual(['no-accounting-bypass'])
    expect(bypassCalls).toBe(0)
  })

  it('lists the requested day and all cross-date pending sessions newest first', async () => {
    const runtime = new FakeRuntime()
    await writeSessions(root, '2026-08-16', [pendingSession('older', '2026-08-16T23:59:00.000Z')])
    await writeSessions(root, '2026-08-17', [pendingSession('today', '2026-08-17T00:01:00.000Z')])
    const service = new TimerService(
      new TimerFileStore(root, runtime.now),
      new DailyFileService(root, runtime.now),
      runtime
    )

    const result = await service.list({ date: '2026-08-17' })

    expect(result.today.map((session) => session.id)).toEqual(['today'])
    expect(result.pending.map((session) => session.id)).toEqual(['today', 'older'])
  })

  it('uses the durable ledger date for assignment after the process timezone changes', async () => {
    const runtime = new FakeRuntime()
    const date = '2026-08-16'
    await writeSessions(root, date, [pendingSession('travelled', '2026-08-16T23:30:00.000Z')])
    const { days } = await createDayTask(root, runtime, date)
    const service = new TimerService(new TimerFileStore(root, runtime.now), days, runtime)

    const options = await service.assignmentOptions('travelled')

    expect(options.date).toBe(date)
    expect(options.tasks.map(({ id }) => id)).toEqual(['task-1'])
  })

  it('assigns one pending session to its original day atomically', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const days = new DailyFileService(root, runtime.now)
    const opened = await days.open('2026-08-17', { create: true })
    if (!opened) throw new Error('expected day')
    opened.file.value.tasks.push({
      id: 'task-1',
      date: '2026-08-17',
      originalDate: '2026-08-17',
      category: 'nlp',
      title: 'Read transformer paper',
      plannedMinutes: 90,
      deliverable: 'notes',
      actualMinutes: 10,
      status: 'in_progress',
      evidence: [],
      notes: 'keep',
      outcomes: 'keep'
    })
    await days.save(opened.file.path, opened.file.value, opened.file.revision)
    await writeLedger(root, '2026-08-17', ['pending-assign'])
    const service = new TimerService(store, days, runtime)

    const result = await service.assign({
      requestId: 'assign-1',
      sessionId: 'pending-assign',
      taskId: 'task-1',
      creditedMinutes: 5
    })

    expect(result.session).toMatchObject({
      status: 'assigned',
      assignment: { taskId: 'task-1', taskTitle: 'Read transformer paper', creditedMinutes: 5 }
    })
    expect(result.day.value.tasks[0]).toMatchObject({
      actualMinutes: 15,
      status: 'in_progress',
      notes: 'keep',
      outcomes: 'keep'
    })
    const dailySource = await readFile(result.day.path, 'utf8')
    expect(parseDailyRecord(dailySource, result.day.path).tasks[0].actualMinutes).toBe(15)
    const ledgerPath = join(root, 'data/timer/2026/2026-08-17.md')
    expect(parseTimerLedger(await readFile(ledgerPath, 'utf8'), ledgerPath).ledger.sessions[0].status).toBe('assigned')
  })

  it('ends an early countdown at its actual duration while preserving its target', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    await service.start({ sessionId: 'early', mode: 'countdown', countdownMinutes: 25 })
    runtime.advance(91_900)

    const result = await service.end()

    expect(result).toMatchObject({
      proposedMinutes: 2,
      session: { id: 'early', durationSeconds: 91, targetSeconds: 1500, endedAt: runtime.now().toISOString() }
    })
  })

  it('chooses the ledger from the injected clock local date across local midnight', async () => {
    const runtime = new FakeRuntime()
    runtime.current = new Date(2026, 7, 17, 23, 59, 30)
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    await service.start({ sessionId: 'midnight', mode: 'elapsed' })
    runtime.advance(90_000)

    await service.end()

    expect(await store.ledger('2026-08-18', false)).not.toBeNull()
    expect(await store.ledger('2026-08-17', false)).toBeNull()
  })

  it('serializes duplicate end calls and timeout races without duplicating the durable session', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    await service.start({ sessionId: 'end-race', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(60_000)

    runtime.scheduled[0].callback()
    const results = await Promise.all([service.end(), service.end()])

    expect(results[0]).toEqual(results[1])
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions).toHaveLength(1)
  })

  it('returns the last successful end retry without a second filesystem write', async () => {
    const runtime = new FakeRuntime()
    let installs = 0
    const store = new TimerFileStore(root, runtime.now, { beforeInstall: async () => { installs += 1 } })
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    await service.start({ sessionId: 'end-retry', mode: 'elapsed' })
    runtime.advance(60_000)
    const first = await service.end()
    installs = 0

    const retry = await service.end()

    expect(retry).toEqual(first)
    expect(installs).toBe(0)
  })

  it('rolls back both state and ledger when the end transaction revision conflicts', async () => {
    const runtime = new FakeRuntime()
    let conflictInjected = false
    let armed = false
    const statePath = join(root, 'data/timer/state.json')
    const store = new TimerFileStore(root, runtime.now, {
      beforePrepare: async (path) => {
        if (armed && !conflictInjected && path === statePath) {
          conflictInjected = true
          const current = parseTimerState(await readFile(path, 'utf8'), path)
          await writeFile(path, serializeTimerState({ ...current, updatedAt: new Date(runtime.now().getTime() + 1).toISOString() }))
        }
      }
    })
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    await service.start({ sessionId: 'end-conflict', mode: 'elapsed' })
    runtime.advance(60_000)
    armed = true

    await expect(service.end()).rejects.toThrow(/外部发生变化|revision|changed|conflict|版本/i)

    expect((await store.state()).value.active?.id).toBe('end-conflict')
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions).toEqual([])
  })

  it('recovers a committed end with leftover cleanup artifacts as one complete transaction', async () => {
    const runtime = new FakeRuntime()
    let blockCleanup = false
    const store = new TimerFileStore(root, runtime.now, {
      beforeBackupCleanup: async () => {
        if (blockCleanup) throw new Error('simulate crash after commit')
      }
    })
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    await service.start({ sessionId: 'committed-recovery', mode: 'elapsed' })
    runtime.advance(60_000)
    blockCleanup = true
    await service.end()
    blockCleanup = false

    const recovered = new TimerFileStore(root, runtime.now)
    await recovered.recoverAll()

    expect((await recovered.state()).value.active).toBeNull()
    expect((await recovered.ledger('2026-08-17', false))?.value.ledger.sessions.map(({ id }) => id))
      .toEqual(['committed-recovery'])
  })

  it('recovers a real partially installed end journal to the old active state and empty ledger', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, new DailyFileService(root, runtime.now), runtime)
    await service.start({ sessionId: 'installing-recovery', mode: 'elapsed' })
    runtime.advance(60_000)
    const state = await store.state()
    const ledger = await store.ledger('2026-08-17', true)
    if (!ledger) throw new Error('expected ledger')
    const stateOld = await readFile(state.path, 'utf8')
    const ledgerOld = await readFile(ledger.path, 'utf8')
    const endedAt = runtime.now().toISOString()
    const stateNext = serializeTimerState({ schemaVersion: 1, active: null, updatedAt: endedAt })
    const ledgerNext = serializeTimerLedger({
      ledger: {
        ...ledger.value.ledger,
        sessions: [pendingSession('installing-recovery', endedAt)],
        updatedAt: endedAt
      },
      body: ledger.value.body
    })
    const transactionId = `99999999-${randomUUID()}`
    const stateBackup = join(root, `data/timer/.state.json.swap-${transactionId}-${randomUUID()}.bak`)
    const ledgerBackup = join(root, `data/timer/2026/.2026-08-17.md.swap-${transactionId}-${randomUUID()}.bak`)
    const stateTemporary = join(root, `data/timer/.state.json.99999999.${randomUUID()}.tmp`)
    const ledgerTemporary = join(root, `data/timer/2026/.2026-08-17.md.99999999.${randomUUID()}.tmp`)
    await writeFile(state.path, stateNext)
    await writeFile(stateBackup, stateOld)
    await rm(ledger.path)
    await writeFile(ledgerBackup, ledgerOld)
    await writeFile(stateTemporary, stateNext)
    await writeFile(ledgerTemporary, ledgerNext)
    await writeFile(join(root, `.my-way-transaction-${transactionId}.json`), JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [
        {
          path: state.path,
          temporaryPath: stateTemporary,
          backupPath: stateBackup,
          expectedRevision: revisionOf(stateOld),
          nextRevision: revisionOf(stateNext)
        },
        {
          path: ledger.path,
          temporaryPath: ledgerTemporary,
          backupPath: ledgerBackup,
          expectedRevision: revisionOf(ledgerOld),
          nextRevision: revisionOf(ledgerNext)
        }
      ]
    }))

    const recovered = new TimerFileStore(root, runtime.now)
    await recovered.recoverAll()

    expect((await recovered.state()).value.active?.id).toBe('installing-recovery')
    expect((await recovered.ledger('2026-08-17', false))?.value.ledger.sessions).toEqual([])
  })

  it('uses durable original-date assignment options and creates a missing day', async () => {
    const runtime = new FakeRuntime()
    const end = new Date(2026, 7, 18, 12, 0, 0).toISOString()
    await writeSessions(root, '2026-08-18', [pendingSession('options', end)])
    const days = new DailyFileService(root, runtime.now)
    const service = new TimerService(new TimerFileStore(root, runtime.now), days, runtime)

    const options = await service.assignmentOptions('options')

    expect(options).toMatchObject({ session: { id: 'options' }, date: '2026-08-18', tasks: [] })
    expect(await days.open('2026-08-18', { create: false })).not.toBeNull()
  })

  it('makes exact assignment retries durable and rejects changed retries without double credit', async () => {
    const runtime = new FakeRuntime()
    const { days } = await createDayTask(root, runtime)
    await writeSessions(root, '2026-08-17', [pendingSession('assign-retry')])
    const service = new TimerService(new TimerFileStore(root, runtime.now), days, runtime)
    const request = { requestId: 'request-1', sessionId: 'assign-retry', taskId: 'task-1', creditedMinutes: 7 }

    const first = await service.assign(request)
    const cached = await service.assign(request)
    await service.dispose()
    const restarted = new TimerService(
      new TimerFileStore(root, runtime.now),
      new DailyFileService(root, runtime.now),
      runtime
    )
    const durable = await restarted.assign({ ...request, requestId: 'request-2' })

    expect(cached).toEqual(first)
    expect(durable.session).toEqual(first.session)
    expect(durable.day.value.tasks[0].actualMinutes).toBe(17)
    await expect(restarted.assign({ ...request, requestId: 'request-3', creditedMinutes: 8 }))
      .rejects.toThrow(/不同任务|已分配/)
    await expect(restarted.assign({ ...request, requestId: 'request-4', taskId: 'another-task' }))
      .rejects.toThrow(/不同任务|已分配/)
  })

  it.each([
    ['deleted task', 10, async (path: string) => {
      const record = parseDailyRecord(await readFile(path, 'utf8'), path)
      await writeFile(path, serializeDailyRecord({ ...record, tasks: [] }))
    }, /不存在/],
    ['minute overflow', 1439, async () => undefined, /1440/]
  ])('does not write either file for %s assignment validation', async (_label, actual, mutate, error) => {
    const runtime = new FakeRuntime()
    const { days, path } = await createDayTask(root, runtime, '2026-08-17', actual)
    await mutate(path)
    const ledgerPath = await writeSessions(root, '2026-08-17', [pendingSession(`invalid-${actual}`)])
    const beforeLedger = await readFile(ledgerPath, 'utf8')
    const service = new TimerService(new TimerFileStore(root, runtime.now), days, runtime)

    await expect(service.assign({
      requestId: `invalid-${actual}`,
      sessionId: `invalid-${actual}`,
      taskId: 'task-1',
      creditedMinutes: 2
    })).rejects.toThrow(error)

    expect(await readFile(ledgerPath, 'utf8')).toBe(beforeLedger)
  })

  it('rejects aggregate daily overflow before serializing or writing either assignment file', async () => {
    const runtime = new FakeRuntime()
    const { days, path } = await createDayTask(root, runtime, '2026-08-17', 700)
    const opened = await days.open('2026-08-17')
    if (!opened) throw new Error('expected day')
    const secondTask = { ...opened.file.value.tasks[0], id: 'task-2', title: 'Second task', actualMinutes: 700 }
    await days.save(path, { ...opened.file.value, tasks: [...opened.file.value.tasks, secondTask] }, opened.file.revision)
    const ledgerPath = await writeSessions(root, '2026-08-17', [pendingSession('aggregate-overflow')])
    const beforeDay = await readFile(path, 'utf8')
    const beforeLedger = await readFile(ledgerPath, 'utf8')
    const service = new TimerService(new TimerFileStore(root, runtime.now), days, runtime)

    await expect(service.assign({
      requestId: 'aggregate-overflow',
      sessionId: 'aggregate-overflow',
      taskId: 'task-1',
      creditedMinutes: 50
    })).rejects.toThrow('该日实际学习时间不能超过 1440 分钟')

    expect(await readFile(path, 'utf8')).toBe(beforeDay)
    expect(await readFile(ledgerPath, 'utf8')).toBe(beforeLedger)
  })

  it('keeps a missing newly-created day uncredited when the later assignment transaction conflicts', async () => {
    const runtime = new FakeRuntime()
    const ledgerPath = await writeSessions(root, '2026-08-17', [pendingSession('missing-day-conflict')])
    let injected = false
    const store = new TimerFileStore(root, runtime.now, {
      beforePrepare: async (path) => {
        if (!injected && path === ledgerPath) {
          injected = true
          const source = await readFile(path, 'utf8')
          await writeFile(path, source.replace('# preserved', '# externally changed'))
        }
      }
    })
    const days = new DailyFileService(root, runtime.now)
    const service = new TimerService(store, days, runtime)

    const options = await service.assignmentOptions('missing-day-conflict')
    expect(options.tasks).toEqual([])
    const opened = await days.open('2026-08-17', { create: false })
    if (!opened) throw new Error('expected created day')
    opened.file.value.tasks.push({
      id: 'task-1',
      date: '2026-08-17',
      originalDate: '2026-08-17',
      category: 'nlp',
      title: 'Created after missing-day open',
      plannedMinutes: 30,
      deliverable: 'notes',
      actualMinutes: 0,
      status: 'planned',
      evidence: [],
      notes: '',
      outcomes: ''
    })
    await days.save(opened.file.path, opened.file.value, opened.file.revision)
    await expect(service.assign({
      requestId: 'missing-day-request',
      sessionId: 'missing-day-conflict',
      taskId: 'task-1',
      creditedMinutes: 5
    })).rejects.toThrow(/外部发生变化|revision|changed|conflict|版本/i)
    const current = parseTimerLedger(await readFile(ledgerPath, 'utf8'), ledgerPath)
    expect(current.ledger.sessions[0].status).toBe('pending')
    expect((await days.open('2026-08-17', { create: false }))?.file.value.tasks[0].actualMinutes).toBe(0)
  })

  it('discards pending sessions idempotently and refuses assigned sessions', async () => {
    const runtime = new FakeRuntime()
    const assigned: TimerSession = {
      ...pendingSession('assigned'),
      status: 'assigned',
      assignment: {
        taskId: 'task-1',
        taskTitle: 'Task',
        creditedMinutes: 5,
        assignedAt: instant.toISOString()
      }
    }
    await writeSessions(root, '2026-08-17', [pendingSession('discard-me'), assigned])
    const service = new TimerService(
      new TimerFileStore(root, runtime.now),
      new DailyFileService(root, runtime.now),
      runtime
    )
    const request = { requestId: 'discard-request', sessionId: 'discard-me' }

    const first = await service.discard(request)
    const retry = await service.discard(request)

    expect(first).toEqual(retry)
    expect(first.today.map(({ id }) => id)).toEqual(['assigned'])
    await expect(service.discard({ requestId: 'assigned-request', sessionId: 'assigned' })).rejects.toThrow(/不能丢弃/)
  })

  it('makes list fail closed with both ledger paths when a session ID is duplicated across dates', async () => {
    const runtime = new FakeRuntime()
    const first = await writeSessions(root, '2026-08-16', [pendingSession('list-duplicate', '2026-08-16T08:01:00.000Z')])
    const second = await writeSessions(root, '2026-08-17', [pendingSession('list-duplicate')])
    const service = new TimerService(
      new TimerFileStore(root, runtime.now),
      new DailyFileService(root, runtime.now),
      runtime
    )

    await expect(service.list({ date: '2026-08-17' })).rejects.toThrow(/duplicate/)
    const snapshot = await service.get()

    expect(snapshot.readOnlyError?.message).toContain(first)
    expect(snapshot.readOnlyError?.message).toContain(second)
  })

  it('closes Task 5 commands after disposal', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(
      new TimerFileStore(root, runtime.now),
      new DailyFileService(root, runtime.now),
      runtime
    )
    await service.dispose()

    const commands = [
      service.end(),
      service.list({ date: '2026-08-17' }),
      service.assignmentOptions('session'),
      service.assign({ requestId: 'assign', sessionId: 'session', taskId: 'task', creditedMinutes: 1 }),
      service.discard({ requestId: 'discard', sessionId: 'session' })
    ]
    for (const command of commands) await expect(command).rejects.toThrow(/released|disposed/i)
  })

  it('starts an elapsed timer with the supplied durable ID and persists one running state', async () => {
    const runtime = new FakeRuntime()
    let writes = 0
    const store = new TimerFileStore(root, runtime.now, { beforeInstall: async () => { writes += 1 } })
    const service = new TimerService(store, defaultDays, runtime)
    await service.load()

    const snapshot = await service.start({ sessionId: 'session-1', mode: 'elapsed' })

    expect(snapshot.active).toEqual({
      id: 'session-1',
      mode: 'elapsed',
      status: 'running',
      createdAt: instant.toISOString(),
      segmentStartedAt: instant.toISOString(),
      accumulatedSeconds: 0,
      updatedAt: instant.toISOString()
    })
    expect(writes).toBe(1)
    expect(parseTimerState(await readFile(join(root, 'data/timer/state.json'), 'utf8'), 'state.json').active)
      .toEqual(snapshot.active)
    expect(runtime.scheduled).toHaveLength(0)
  })

  it.each([25, 50, 1, 180])('starts a %i minute countdown and schedules its authoritative remainder', async (minutes) => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    await service.load()

    const snapshot = await service.start({ sessionId: `countdown-${minutes}`, mode: 'countdown', countdownMinutes: minutes })

    expect(snapshot.active).toMatchObject({ mode: 'countdown', targetSeconds: minutes * 60 })
    expect(runtime.scheduled).toHaveLength(1)
    expect(runtime.scheduled[0].milliseconds).toBe(minutes * 60 * 1000)
  })

  it.each([
    { sessionId: 'invalid-zero', mode: 'countdown', countdownMinutes: 0 },
    { sessionId: 'invalid-high', mode: 'countdown', countdownMinutes: 181 },
    { sessionId: 'invalid-elapsed-shape', mode: 'elapsed', countdownMinutes: 1 },
    { sessionId: 'invalid-extra', mode: 'elapsed', extra: true },
    { sessionId: '   ', mode: 'elapsed' },
    { sessionId: 'x'.repeat(101), mode: 'elapsed' },
    { sessionId: 'invalid-mode', mode: 'unknown' }
  ])('rejects invalid start input at the command boundary without touching timer state: $sessionId', async (input) => {
    const runtime = new FakeRuntime()
    let writes = 0
    const store = new TimerFileStore(root, runtime.now, { beforeInstall: async () => { writes += 1 } })
    const service = new TimerService(store, defaultDays, runtime)
    const before = await service.start({ sessionId: 'existing', mode: 'countdown', countdownMinutes: 1 })
    writes = 0

    await expect(service.start(input as never)).rejects.toBeInstanceOf(ZodError)

    const after = await service.get()
    expect(after.active).toEqual(before.active)
    expect(after.readOnlyError).toBeUndefined()
    expect(writes).toBe(0)
    expect(runtime.scheduled).toHaveLength(1)
    expect(runtime.scheduled[0].cleared).toBe(false)
  })

  it('rejects a second start while running or paused', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    await service.start({ sessionId: 'first', mode: 'elapsed' })
    await expect(service.start({ sessionId: 'second', mode: 'elapsed' })).rejects.toThrow(/已有计时器/)
    await service.pause()

    await expect(service.start({ sessionId: 'third', mode: 'elapsed' })).rejects.toThrow(/已有计时器/)
  })

  it('serializes concurrent starts so exactly one durable session wins', async () => {
    const runtime = new FakeRuntime()
    let writes = 0
    const service = new TimerService(
      new TimerFileStore(root, runtime.now, { beforeInstall: async () => { writes += 1 } }),
      defaultDays,
      runtime
    )

    const results = await Promise.allSettled([
      service.start({ sessionId: 'winner', mode: 'elapsed' }),
      service.start({ sessionId: 'loser', mode: 'elapsed' })
    ])

    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected'])
    expect((await service.get()).active?.id).toBe('winner')
    expect(writes).toBe(1)
  })

  it('captures a start request before it waits in the serialized queue', async () => {
    const runtime = new FakeRuntime()
    let releaseCreate = (): void => undefined
    let markEntered = (): void => undefined
    const entered = new Promise<void>((resolve) => { markEntered = resolve })
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
    const store = new TimerFileStore(root, runtime.now, {
      beforeCreateInstall: async () => {
        markEntered()
        await createGate
      }
    })
    const service = new TimerService(store, defaultDays, runtime)
    const loading = service.load()
    await entered
    const request = { sessionId: ' captured ', mode: 'countdown' as const, countdownMinutes: 1 }
    const starting = service.start(request)
    request.sessionId = 'mutated-after-call'
    request.countdownMinutes = 181
    releaseCreate()

    await loading
    const snapshot = await starting

    expect(snapshot.active?.id).toBe('captured')
    expect(snapshot.active).toMatchObject({ mode: 'countdown', targetSeconds: 60 })
  })

  it('does not write for get and pauses an elapsed segment exactly once', async () => {
    const runtime = new FakeRuntime()
    let writes = 0
    const store = new TimerFileStore(root, runtime.now, { beforeInstall: async () => { writes += 1 } })
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'session-1', mode: 'elapsed' })
    writes = 0
    runtime.advance(3_999)

    await service.get()
    const paused = await service.pause()
    const pausedAgain = await service.pause()

    expect(paused.active).toEqual({
      id: 'session-1',
      mode: 'elapsed',
      status: 'paused',
      createdAt: instant.toISOString(),
      accumulatedSeconds: 3,
      pauseReason: 'user',
      updatedAt: runtime.now().toISOString()
    })
    expect(pausedAgain.active).toEqual(paused.active)
    expect(writes).toBe(1)
  })

  it('resumes manually with a fresh segment and persists exactly once', async () => {
    const runtime = new FakeRuntime()
    let writes = 0
    const store = new TimerFileStore(root, runtime.now, { beforeInstall: async () => { writes += 1 } })
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'session-1', mode: 'elapsed' })
    runtime.advance(2_000)
    await service.pauseFor('system_suspend')
    writes = 0
    runtime.advance(5_000)

    const resumed = await service.resume()
    const resumedAgain = await service.resume()

    expect(resumed.active).toMatchObject({
      status: 'running',
      accumulatedSeconds: 2,
      segmentStartedAt: runtime.now().toISOString(),
      updatedAt: runtime.now().toISOString()
    })
    expect(resumed.active).not.toHaveProperty('pauseReason')
    expect(resumedAgain.active).toEqual(resumed.active)
    expect(writes).toBe(1)
  })

  it.each(['app_close', 'system_suspend'] as const)('pauseFor records %s and cancels a countdown schedule', async (reason) => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    await service.start({ sessionId: 'session-1', mode: 'countdown', countdownMinutes: 1 })

    const paused = await service.pauseFor(reason)

    expect(paused.active).toMatchObject({ status: 'paused', pauseReason: reason })
    expect(runtime.scheduled[0].cleared).toBe(true)
  })

  it('treats lifecycle pause as a no-op after a fresh idle restart', async () => {
    const runtime = new FakeRuntime()
    await new TimerFileStore(root, runtime.now).state()
    const restarted = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)

    await expect(restarted.pauseFor('app_close')).resolves.toMatchObject({ active: null })
  })

  it('recovers a persisted running timer without counting offline time and writes exactly once', async () => {
    const runtime = new FakeRuntime()
    const seed = new TimerFileStore(root, runtime.now)
    const original = await seed.state()
    await seed.saveState({
      ...original,
      value: {
        schemaVersion: 1,
        active: {
          id: 'interrupted',
          mode: 'elapsed',
          status: 'running',
          createdAt: instant.toISOString(),
          segmentStartedAt: instant.toISOString(),
          accumulatedSeconds: 12,
          updatedAt: instant.toISOString()
        },
        updatedAt: instant.toISOString()
      }
    })
    runtime.advance(86_400_000)
    let writes = 0
    const service = new TimerService(
      new TimerFileStore(root, runtime.now, { beforeInstall: async () => { writes += 1 } }),
      defaultDays,
      runtime
    )

    const snapshot = await service.load()

    expect(snapshot.active).toEqual({
      id: 'interrupted',
      mode: 'elapsed',
      status: 'paused',
      createdAt: instant.toISOString(),
      accumulatedSeconds: 12,
      pauseReason: 'recovered_after_interruption',
      updatedAt: runtime.now().toISOString()
    })
    expect(writes).toBe(1)
  })

  it('does not treat a running timer already owned by this service as a startup interruption on reload', async () => {
    const runtime = new FakeRuntime()
    let writes = 0
    const store = new TimerFileStore(root, runtime.now, { beforeInstall: async () => { writes += 1 } })
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'owned', mode: 'elapsed' })
    writes = 0
    runtime.advance(5_000)

    const snapshot = await service.load()

    expect(snapshot.active).toMatchObject({ id: 'owned', status: 'running', accumulatedSeconds: 0 })
    expect(writes).toBe(0)
  })

  it('loads an already paused timer without writing', async () => {
    const runtime = new FakeRuntime()
    const seed = new TimerFileStore(root, runtime.now)
    const original = await seed.state()
    await seed.saveState({
      ...original,
      value: {
        schemaVersion: 1,
        active: {
          id: 'paused',
          mode: 'elapsed',
          status: 'paused',
          createdAt: instant.toISOString(),
          accumulatedSeconds: 9,
          pauseReason: 'app_close',
          updatedAt: instant.toISOString()
        },
        updatedAt: instant.toISOString()
      }
    })
    let writes = 0
    const service = new TimerService(
      new TimerFileStore(root, runtime.now, { beforeInstall: async () => { writes += 1 } }),
      defaultDays,
      runtime
    )

    const snapshot = await service.load()

    expect(snapshot.active).toMatchObject({ status: 'paused', pauseReason: 'app_close' })
    expect(writes).toBe(0)
  })

  it('recovers an overdue running countdown without scheduling or reporting it due', async () => {
    const runtime = new FakeRuntime()
    const seed = new TimerFileStore(root, runtime.now)
    const original = await seed.state()
    await seed.saveState({
      ...original,
      value: {
        schemaVersion: 1,
        active: {
          id: 'offline-countdown',
          mode: 'countdown',
          status: 'running',
          createdAt: instant.toISOString(),
          segmentStartedAt: instant.toISOString(),
          accumulatedSeconds: 7,
          targetSeconds: 60,
          updatedAt: instant.toISOString()
        },
        updatedAt: instant.toISOString()
      }
    })
    runtime.advance(86_400_000)
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)

    const snapshot = await service.load()

    expect(snapshot.active).toMatchObject({
      id: 'offline-countdown',
      status: 'paused',
      pauseReason: 'recovered_after_interruption',
      accumulatedSeconds: 7
    })
    expect(runtime.scheduled).toHaveLength(0)
  })

  it('rejects an active state ID that already exists in a dated ledger as read-only data', async () => {
    const runtime = new FakeRuntime()
    const seed = new TimerFileStore(root, runtime.now)
    const original = await seed.state()
    await seed.saveState({
      ...original,
      value: {
        schemaVersion: 1,
        active: {
          id: 'global-duplicate',
          mode: 'elapsed',
          status: 'paused',
          createdAt: instant.toISOString(),
          accumulatedSeconds: 1,
          pauseReason: 'user',
          updatedAt: instant.toISOString()
        },
        updatedAt: instant.toISOString()
      }
    })
    const ledgerPath = await writeLedger(root, '2026-08-17', ['global-duplicate'])
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)

    const snapshot = await service.load()

    expect(snapshot.readOnlyError).toEqual({
      path: join(root, 'data/timer/state.json'),
      message: expect.stringContaining(ledgerPath)
    })
  })

  it('surfaces corrupt state as a path-specific read-only snapshot and recovers after repair', async () => {
    const runtime = new FakeRuntime()
    const statePath = join(root, 'data/timer/state.json')
    await mkdir(join(root, 'data/timer'), { recursive: true })
    await writeFile(statePath, '{ bad json')
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)

    const damaged = await service.load()

    expect(damaged).toMatchObject({
      active: null,
      readOnlyError: { path: statePath, message: expect.stringContaining(statePath) }
    })
    await expect(service.start({ sessionId: 'blocked', mode: 'elapsed' })).rejects.toThrow(statePath)
    await expect(readFile(statePath, 'utf8')).resolves.toBe('{ bad json')

    await writeFile(statePath, serializeTimerState(emptyTimerState(runtime.now())))
    const repaired = await service.get()
    expect(repaired).toEqual({ active: null, capturedAt: runtime.now().toISOString() })
    await expect(service.start({ sessionId: 'works', mode: 'elapsed' })).resolves.toMatchObject({
      active: { id: 'works' }
    })
  })

  it('enters recoverable path-specific read-only mode when a transition finds external state damage', async () => {
    const runtime = new FakeRuntime()
    const statePath = join(root, 'data/timer/state.json')
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    await service.start({ sessionId: 'active', mode: 'elapsed' })
    await writeFile(statePath, '{ externally damaged')

    await expect(service.pause()).rejects.toThrow()
    const damaged = await service.get()

    expect(damaged.readOnlyError).toEqual({
      path: statePath,
      message: expect.stringContaining(statePath)
    })
    await writeFile(statePath, serializeTimerState(emptyTimerState(runtime.now())))
    await expect(service.get()).resolves.toEqual({ active: null, capturedAt: runtime.now().toISOString() })
  })

  it('broadcasts read-only entry and repair once and reschedules a repaired running countdown', async () => {
    const runtime = new FakeRuntime()
    const statePath = join(root, 'data/timer/state.json')
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    await service.start({ sessionId: 'repair-schedule', mode: 'countdown', countdownMinutes: 1 })
    const validRunningState = await readFile(statePath, 'utf8')
    const delivered: Array<{ readOnlyError?: unknown; active: { status: string } | null }> = []
    service.subscribe((snapshot) => { delivered.push(snapshot) })
    await writeFile(statePath, '{ externally damaged')

    await expect(service.pause()).rejects.toThrow()
    await service.get()
    expect(delivered).toHaveLength(2)
    expect(delivered[0].readOnlyError).toBeDefined()
    expect(delivered[1].readOnlyError).toBeDefined()
    expect(delivered[1].readOnlyError).not.toEqual(delivered[0].readOnlyError)
    expect(runtime.scheduled[0].cleared).toBe(true)

    await writeFile(statePath, validRunningState)
    const repaired = await service.get()

    expect(repaired).not.toHaveProperty('readOnlyError')
    expect(repaired.active?.status).toBe('running')
    expect(runtime.scheduled).toHaveLength(2)
    expect(runtime.scheduled[1].milliseconds).toBe(60_000)
    expect(delivered).toHaveLength(3)
    expect(delivered[2].readOnlyError).toBeUndefined()
  })

  it('surfaces an unknown ledger as a path-specific read-only snapshot without overwriting it', async () => {
    const runtime = new FakeRuntime()
    await new TimerFileStore(root, runtime.now).state()
    const ledgerPath = join(root, 'data/timer/2026/2026-08-17.md')
    await mkdir(join(root, 'data/timer/2026'), { recursive: true })
    await writeFile(ledgerPath, '---\nschemaVersion: 99\n---\nunchanged')
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)

    const snapshot = await service.load()

    expect(snapshot.readOnlyError).toEqual({ path: ledgerPath, message: expect.stringContaining(ledgerPath) })
    await expect(service.pause()).rejects.toThrow(ledgerPath)
    await expect(readFile(ledgerPath, 'utf8')).resolves.toBe('---\nschemaVersion: 99\n---\nunchanged')
  })

  it('reloads all ledger IDs before start and rejects a previously used durable ID', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    await service.load()
    await writeLedger(root, '2026-08-17', ['already-used'])

    await expect(service.start({ sessionId: 'already-used', mode: 'elapsed' })).rejects.toThrow(/ID 已存在/)
    expect((await new TimerFileStore(root, runtime.now).state()).value.active).toBeNull()
  })

  it('treats a session ID duplicated across dated ledgers as read-only timer data', async () => {
    const runtime = new FakeRuntime()
    await new TimerFileStore(root, runtime.now).state()
    const firstPath = await writeLedger(root, '2026-08-17', ['duplicate'])
    const secondPath = await writeLedger(root, '2026-08-18', ['duplicate'])
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)

    const snapshot = await service.load()

    expect(snapshot.readOnlyError?.message).toContain('duplicate')
    expect([firstPath, secondPath]).toContain(snapshot.readOnlyError?.path)
    await expect(service.start({ sessionId: 'new', mode: 'elapsed' })).rejects.toThrow(/duplicate/)
  })

  it('cancels and gates a scheduled countdown after accounting enters read-only mode', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'frozen-due', mode: 'countdown', countdownMinutes: 1 })
    const scheduled = runtime.scheduled[0]
    await writeLedger(root, '2026-08-17', ['duplicate-accounting'])
    await writeLedger(root, '2026-08-18', ['duplicate-accounting'])

    await expect(service.list({ date: '2026-08-17' })).rejects.toThrow(/duplicate-accounting/)
    expect(scheduled.cleared).toBe(true)
    runtime.advance(60_000)
    scheduled.callback()
    const snapshot = await service.get()

    expect(snapshot.readOnlyError?.message).toContain('duplicate-accounting')
    expect((await store.state()).value.active?.id).toBe('frozen-due')
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions.map(({ id }) => id))
      .toEqual(['duplicate-accounting'])
  })

  it('ignores a watcher event for its own committed timer revision', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    const delivered: unknown[] = []
    service.subscribe((snapshot) => { delivered.push(snapshot) })
    await service.start({ sessionId: 'self-write', mode: 'countdown', countdownMinutes: 1 })
    delivered.length = 0

    await service.handleExternalChange(changed('data/timer/state.json'))

    expect(delivered).toEqual([])
    expect(runtime.scheduled[0].cleared).toBe(false)
    expect((await service.get()).active?.id).toBe('self-write')
  })

  it('reloads and publishes a valid external timer change while idle', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.load()
    const state = await store.state()
    const pausedAt = runtime.now().toISOString()
    await store.saveState({
      ...state,
      value: {
        schemaVersion: 1,
        active: {
          id: 'external-paused',
          mode: 'elapsed',
          status: 'paused',
          createdAt: pausedAt,
          accumulatedSeconds: 42,
          pauseReason: 'user',
          updatedAt: pausedAt
        },
        updatedAt: pausedAt
      }
    })
    const delivered: Array<{ active?: { id: string } | null }> = []
    service.subscribe((snapshot) => { delivered.push(snapshot) })

    await service.handleExternalChange(changed('data/timer/state.json'))

    expect((await service.get()).active).toMatchObject({ id: 'external-paused', accumulatedSeconds: 42 })
    expect(delivered.some(({ active }) => active?.id === 'external-paused')).toBe(true)
  })

  it('freezes an active timer and rejects writes after a real external timer change', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'external-conflict', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(10_000)
    const state = await store.state()
    await store.saveState({ ...state, value: { ...state.value, updatedAt: runtime.now().toISOString() } })

    await service.handleExternalChange(changed('data/timer/state.json'))
    const snapshot = await service.get()

    expect(runtime.scheduled[0].cleared).toBe(true)
    expect(snapshot.active).toMatchObject({
      id: 'external-conflict',
      status: 'paused',
      accumulatedSeconds: 10,
      pauseReason: 'recovered_after_interruption'
    })
    expect(snapshot.readOnlyError?.path).toBe(state.path)
    await expect(service.resume()).rejects.toThrow(state.path)

    await service.handleExternalChange(changed('data/timer/state.json'))
    const repaired = await service.get()
    expect(repaired.readOnlyError).toBeUndefined()
    expect(repaired.active).toMatchObject({ id: 'external-conflict', status: 'running' })
    expect(runtime.scheduled).toHaveLength(2)
  })

  it('enters timer-only read-only state for malformed external content and clears it after repair', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.load()
    const state = await store.state()
    const original = await readFile(state.path, 'utf8')
    await writeFile(state.path, '{ malformed')

    await service.handleExternalChange(changed('data/timer/state.json'))
    expect((await service.get()).readOnlyError?.path).toBe(state.path)

    await writeFile(state.path, original)
    await service.handleExternalChange(changed('data/timer/state.json'))
    expect((await service.get()).readOnlyError).toBeUndefined()
  })

  it('ignores non-timer watcher paths without reloading or emitting', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    await service.load()
    const delivered: unknown[] = []
    service.subscribe((snapshot) => { delivered.push(snapshot) })

    await service.handleExternalChange(changed('data/daily/2026/2026-08-20.md'))

    expect(delivered).toEqual([])
  })

  it('notifies immutable transition snapshots only and isolates listener failures', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    const received: unknown[] = []
    service.subscribe(() => { throw new Error('listener failure') })
    const unsubscribe = service.subscribe((snapshot) => { received.push(snapshot) })

    await service.load()
    await service.get()
    await service.start({ sessionId: 'session-1', mode: 'elapsed' })
    await service.get()
    await service.pause()
    unsubscribe()
    await service.resume()

    expect(received).toHaveLength(2)
    expect((received as Array<{ active: object }>).map((snapshot) => Object.isFrozen(snapshot))).toEqual([true, true])
    expect((received as Array<{ active: object }>).every((snapshot) => Object.isFrozen(snapshot.active))).toBe(true)
  })

  it('uses a stable listener snapshot when listeners subscribe or unsubscribe during delivery', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    const deliveries: string[] = []
    const listenerC = (snapshot: Awaited<ReturnType<TimerService['get']>>): void => {
      deliveries.push(`C:${snapshot.active?.status}`)
    }
    let unsubscribeB = (): void => undefined
    service.subscribe((snapshot) => {
      deliveries.push(`A:${snapshot.active?.status}`)
      unsubscribeB()
      service.subscribe(listenerC)
    })
    unsubscribeB = service.subscribe((snapshot) => { deliveries.push(`B:${snapshot.active?.status}`) })

    await service.start({ sessionId: 'listeners', mode: 'elapsed' })
    await service.pause()

    expect(deliveries).toEqual(['A:running', 'B:running', 'A:paused', 'C:paused'])
  })

  it('emits a changed read-only diagnostic but suppresses an identical repeat', async () => {
    const runtime = new FakeRuntime()
    const statePath = join(root, 'data/timer/state.json')
    await mkdir(join(root, 'data/timer'), { recursive: true })
    await writeFile(statePath, 'not json')
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    const diagnostics: string[] = []
    service.subscribe((snapshot) => {
      if (snapshot.readOnlyError) diagnostics.push(snapshot.readOnlyError.message)
    })

    await service.load()
    await writeFile(statePath, '{')
    await service.get()
    await service.get()

    expect(diagnostics).toHaveLength(2)
    expect(diagnostics[0]).not.toBe(diagnostics[1])
  })

  it('releases the serialized queue after a rejected command', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)

    const invalid = service.resume()
    const valid = service.start({ sessionId: 'after-failure', mode: 'elapsed' })

    await expect(invalid).rejects.toThrow(/没有计时器/)
    await expect(valid).resolves.toMatchObject({ active: { id: 'after-failure' } })
  })

  it('serializes concurrent transitions without losing accumulated time or stale revisions', async () => {
    const runtime = new FakeRuntime()
    let writes = 0
    const store = new TimerFileStore(root, runtime.now, { beforeInstall: async () => { writes += 1 } })
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'serialized', mode: 'elapsed' })
    runtime.advance(2_000)
    writes = 0

    await Promise.all([service.pause(), service.resume(), service.pause()])

    const snapshot = await service.get()
    expect(snapshot.active).toMatchObject({ status: 'paused', accumulatedSeconds: 2, pauseReason: 'user' })
    expect(writes).toBe(3)
  })

  it('does not leak mutable active state from returned snapshots', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    const snapshot = await service.start({ sessionId: 'immutable', mode: 'elapsed' })

    expect(Object.isFrozen(snapshot.active)).toBe(true)
    expect(snapshot).not.toHaveProperty('path')
    expect(() => { (snapshot.active as { id: string }).id = 'changed' }).toThrow()
    expect((await service.get()).active?.id).toBe('immutable')
  })

  it('recomputes an early countdown callback and completes exactly once at the authoritative due time', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    const delivered: Array<{ completion?: { sessionId: string; endedAt: string } }> = []
    service.subscribe((snapshot) => { delivered.push(snapshot) })
    await service.start({ sessionId: 'countdown', mode: 'countdown', countdownMinutes: 1 })
    const firstCallback = runtime.scheduled[0].callback

    runtime.advance(30_000)
    firstCallback()
    await service.get()
    expect(runtime.scheduled).toHaveLength(2)
    expect(runtime.scheduled[1].milliseconds).toBe(30_000)

    runtime.advance(30_000)
    runtime.scheduled[1].callback()
    await service.pause()
    runtime.scheduled[1].callback()
    await service.get()

    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions).toMatchObject([{
      id: 'countdown',
      endedAt: '2026-08-17T08:01:00.000Z',
      durationSeconds: 60
    }])
    expect(delivered.filter(({ completion }) => completion !== undefined)).toHaveLength(1)
  })

  it('serializes concurrent due command paths into one durable completion', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'concurrent-due', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(60_000)

    const snapshots = await Promise.all([service.pause(), service.pauseFor('app_close')])

    expect(snapshots.every((snapshot) => snapshot.active === null)).toBe(true)
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions).toHaveLength(1)
  })

  it('routes an idempotent resume through durable due completion', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'resume-due', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(60_000)

    const snapshot = await service.resume()

    expect(snapshot.active).toBeNull()
    expect(runtime.scheduled[0].cleared).toBe(true)
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions[0].id).toBe('resume-due')
  })

  it('retries a failed due transaction after a read-only reload and completes once', async () => {
    const runtime = new FakeRuntime()
    const statePath = join(root, 'data/timer/state.json')
    let armed = false
    let attempts = 0
    const store = new TimerFileStore(root, runtime.now, {
      beforePrepare: async (path) => {
        if (armed && path === statePath) {
          attempts += 1
          if (attempts === 1) throw new Error('retryable completion failure')
        }
      }
    })
    const service = new TimerService(store, defaultDays, runtime)
    const diagnostics: Array<{ message: string; path?: string }> = []
    service.subscribe((snapshot) => {
      if (snapshot.readOnlyError) diagnostics.push(snapshot.readOnlyError)
    })
    await service.start({ sessionId: 'retry-due', mode: 'countdown', countdownMinutes: 1 })
    armed = true
    runtime.advance(60_000)

    runtime.scheduled[0].callback()
    await expect(service.pause()).rejects.toThrow(/retryable/)
    expect(diagnostics.at(-1)).toEqual({
      path: statePath,
      message: expect.stringContaining('retryable completion failure')
    })
    await service.get()
    runtime.scheduled[1].callback()
    await service.get()

    expect(attempts).toBe(2)
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions).toHaveLength(1)
  })

  it('fails closed when the authoritative countdown revision changes before due settlement', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'revised-due', mode: 'countdown', countdownMinutes: 1 })
    const originalCallback = runtime.scheduled[0].callback
    runtime.advance(60_000)
    const current = await store.state()
    await store.saveState({ ...current, value: { ...current.value, updatedAt: runtime.now().toISOString() } })

    originalCallback()
    await expect(service.pause()).rejects.toThrow(/发生变化/)

    expect((await store.state()).value.active?.id).toBe('revised-due')
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions).toEqual([])
  })

  it('lets durable due completion win over a lifecycle pause queued after the deadline', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'deadline-race', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(60_000)

    const snapshot = await service.pauseFor('system_suspend')

    expect(snapshot.active).toBeNull()
    expect(runtime.scheduled[0].cleared).toBe(true)
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions[0].id).toBe('deadline-race')
  })

  it('keeps the queue healthy across pause, resume, and replacement start at the due boundary', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'queued-due', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(60_000)

    const results = await Promise.allSettled([
      service.pause(),
      service.resume(),
      service.start({ sessionId: 'after-due', mode: 'elapsed' })
    ])

    expect(results.map(({ status }) => status)).toEqual(['fulfilled', 'rejected', 'fulfilled'])
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions.map(({ id }) => id)).toEqual(['queued-due'])
    expect((await service.get()).active?.id).toBe('after-due')
  })

  it('surfaces a due transaction failure path-specifically and preserves active authority', async () => {
    const runtime = new FakeRuntime()
    const statePath = join(root, 'data/timer/state.json')
    let armed = false
    const store = new TimerFileStore(root, runtime.now, {
      beforePrepare: async (path) => {
        if (armed && path === statePath) throw new Error('atomic completion failed')
      }
    })
    const service = new TimerService(store, defaultDays, runtime)
    let diagnostic: { message: string; path?: string } | undefined
    service.subscribe((snapshot) => { diagnostic = snapshot.readOnlyError ?? diagnostic })
    await service.start({ sessionId: 'due-failure', mode: 'countdown', countdownMinutes: 1 })
    armed = true
    runtime.advance(60_000)

    await expect(service.pauseFor('system_suspend')).rejects.toThrow('atomic completion failed')
    const snapshot = await service.get()

    expect(diagnostic).toEqual({ path: statePath, message: expect.stringContaining('atomic completion failed') })
    expect(snapshot.active).toMatchObject({ id: 'due-failure', status: 'running' })
    expect(parseTimerState(await readFile(statePath, 'utf8'), statePath).active)
      .toMatchObject({ id: 'due-failure', status: 'running' })
  })

  it('fails due settlement closed if the selected workspace root is replaced', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    await service.start({ sessionId: 'due-root-replaced', mode: 'countdown', countdownMinutes: 1 })
    const movedRoot = `${root}.due-original`
    await rename(root, movedRoot)
    await mkdir(root)
    runtime.advance(60_000)

    try {
      await expect(service.pause()).rejects.toThrow(/工作区根目录已被替换/)
      await expect(readFile(join(root, 'data/timer/state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rename(movedRoot, root)
    }
  })

  it('ignores cleared stale callbacks and cannot complete a replacement session twice', async () => {
    const runtime = new FakeRuntime()
    const store = new TimerFileStore(root, runtime.now)
    const service = new TimerService(store, defaultDays, runtime)
    const delivered: Array<{ completion?: { sessionId: string } }> = []
    service.subscribe((snapshot) => { delivered.push(snapshot) })
    await service.start({ sessionId: 'first', mode: 'countdown', countdownMinutes: 1 })
    const staleBeforePause = runtime.scheduled[0].callback
    runtime.advance(10_000)
    await service.pause()
    await service.resume()
    const completingCallback = runtime.scheduled[1].callback

    runtime.advance(50_000)
    staleBeforePause()
    await service.get()
    expect(await store.ledger('2026-08-17', false)).toBeNull()
    completingCallback()
    await service.get()
    expect(delivered.filter(({ completion }) => completion !== undefined)).toHaveLength(1)

    await service.start({ sessionId: 'replacement', mode: 'elapsed' })
    completingCallback()
    await service.get()
    expect((await store.ledger('2026-08-17', false))?.value.ledger.sessions).toHaveLength(1)
    expect((await service.get()).active?.id).toBe('replacement')
  })

  it('schedules resumed countdowns from authoritative remaining seconds and dispose cancels', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    await service.start({ sessionId: 'countdown', mode: 'countdown', countdownMinutes: 1 })
    runtime.advance(10_000)
    await service.pause()
    runtime.advance(90_000)

    await service.resume()

    expect(runtime.scheduled[1].milliseconds).toBe(50_000)
    await service.dispose()
    expect(runtime.scheduled[1].cleared).toBe(true)
  })

  it('closes every public command after dispose without writes, schedules, or notifications', async () => {
    const runtime = new FakeRuntime()
    let writes = 0
    const service = new TimerService(
      new TimerFileStore(root, runtime.now, { beforeInstall: async () => { writes += 1 } }),
      defaultDays,
      runtime
    )
    await service.start({ sessionId: 'disposed', mode: 'countdown', countdownMinutes: 1 })
    writes = 0
    let deliveries = 0
    service.subscribe(() => { deliveries += 1 })

    const firstDispose = service.dispose()
    const repeatedDispose = service.dispose()
    expect(repeatedDispose).toBe(firstDispose)
    await firstDispose
    const commands = [
      service.load(),
      service.get(),
      service.start({ sessionId: 'after-dispose', mode: 'elapsed' }),
      service.pause(),
      service.resume(),
      service.pauseFor('app_close')
    ]

    for (const command of commands) await expect(command).rejects.toThrow(/released|disposed/i)
    expect(writes).toBe(0)
    expect(runtime.scheduled).toHaveLength(1)
    expect(runtime.scheduled[0].cleared).toBe(true)
    expect(deliveries).toBe(0)
  })

  it('rejects a queued start when dispose begins before that command starts', async () => {
    const runtime = new FakeRuntime()
    let releaseCreate = (): void => undefined
    let markEntered = (): void => undefined
    const entered = new Promise<void>((resolve) => { markEntered = resolve })
    const createGate = new Promise<void>((resolve) => { releaseCreate = resolve })
    let writes = 0
    const store = new TimerFileStore(root, runtime.now, {
      beforeCreateInstall: async () => {
        markEntered()
        await createGate
      },
      beforeInstall: async () => { writes += 1 }
    })
    const service = new TimerService(store, defaultDays, runtime)
    const loading = service.load()
    await entered
    const queuedStart = service.start({ sessionId: 'must-not-start', mode: 'elapsed' })
    const disposing = service.dispose()
    releaseCreate()

    await loading
    await expect(queuedStart).rejects.toThrow(/released|disposed/i)
    await disposing
    expect((await store.state()).value.active).toBeNull()
    expect(writes).toBe(0)
  })

  it('cannot write a replacement workspace after the stale service is disposed', async () => {
    const runtime = new FakeRuntime()
    const service = new TimerService(new TimerFileStore(root, runtime.now), defaultDays, runtime)
    await service.load()
    await service.dispose()
    const movedRoot = `${root}.disposed-original`
    await rename(root, movedRoot)
    await mkdir(root)

    try {
      await expect(service.start({ sessionId: 'stale-root', mode: 'elapsed' })).rejects.toThrow(/released|disposed/i)
      await expect(readFile(join(root, 'data/timer/state.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(root, { recursive: true, force: true })
      await rename(movedRoot, root)
    }
  })
})
