import type {
  ActiveTimer,
  AssignTimerRequest,
  AssignTimerResult,
  DiscardTimerRequest,
  EndedTimerResult,
  StartTimerRequest,
  SetTimerTaskIntentRequest,
  TimerAssignmentOptions,
  TimerListRequest,
  TimerListResult,
  TimerPauseReason,
  TimerSession,
  TimerSnapshot,
  TimerStateFile,
  TimerSubscriptionListener
} from '../../shared/timerTypes'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { FileChangeEvent } from '../../shared/api'
import type { VersionedFile } from '../../shared/types'
import {
  assignmentOptionsSessionIdSchema,
  assignTimerRequestSchema,
  discardTimerRequestSchema,
  setTimerTaskIntentRequestSchema,
  startTimerRequestSchema,
  timerListRequestSchema
} from '../../shared/timerSchemas'
import { revisionOf } from './versionedFileTransaction'
import { serializeDailyRecord } from '../domain/dailyRecord'
import { serializeTimerLedger, serializeTimerState, type TimerLedgerDocument } from '../domain/timerFiles'
import { elapsedSeconds, localDateAt, pauseActive, proposedCreditMinutes, remainingSeconds } from '../domain/timerMath'
import type { TimerFileStore } from './timerFileStore'
import type { DailyFileService } from './dailyFileService'

export interface TimerRuntime {
  now(): Date
  setTimeout(callback: () => void, milliseconds: number): unknown
  clearTimeout(handle: unknown): void
}

type RunningCountdown = Extract<ActiveTimer, { mode: 'countdown'; status: 'running' }>

const TIMER_STATE_PATH = 'data/timer/state.json'
const TIMER_LEDGER_PATH = /^data\/timer\/(\d{4})\/(\d{4}-\d{2}-\d{2})\.md$/

const systemRuntime: TimerRuntime = {
  now: () => new Date(),
  setTimeout: (callback, milliseconds) => setTimeout(callback, milliseconds),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

const frozenActive = (active: ActiveTimer | null): ActiveTimer | null => (
  active === null
    ? null
    : Object.freeze({
        ...active,
        ...(active.taskIntent ? { taskIntent: Object.freeze({ ...active.taskIntent }) } : {})
      })
)

const frozenSnapshot = (active: ActiveTimer | null, capturedAt: string): TimerSnapshot => Object.freeze({
  active: frozenActive(active),
  capturedAt
})

export class TimerService {
  private file: VersionedFile<TimerStateFile> | undefined
  private readonly ledgerIds = new Set<string>()
  private readOnlyError: { message: string; path?: string } | undefined
  private loaded = false
  private hasAuthoritativeLoad = false
  private tail: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<TimerSubscriptionListener>()
  private schedulerHandle: unknown
  private schedulerGeneration = 0
  private completion: NonNullable<TimerSnapshot['completion']> | undefined
  private disposed = false
  private disposePromise: Promise<void> | undefined
  private readonly days: DailyFileService
  private readonly runtime: TimerRuntime
  private lastEnded: EndedTimerResult | undefined
  private lastEndAttemptId: string | undefined
  private readonly assignmentRequests = new Map<string, { fingerprint: string; result: AssignTimerResult }>()
  private readonly discardRequests = new Map<string, { fingerprint: string; result: TimerListResult }>()
  private readonly knownRevisions = new Map<string, string>()
  private readonly knownPaths = new Map<string, string>()
  private externalConflict = false

  constructor(
    private readonly store: TimerFileStore,
    days: DailyFileService,
    runtime: TimerRuntime = systemRuntime
  ) {
    this.runtime = runtime
    this.days = days
  }

  load(): Promise<TimerSnapshot> {
    return this.enqueueCommand(async () => {
      await this.tryReadFromDisk(!this.hasAuthoritativeLoad)
      return this.snapshot()
    })
  }

  get(): Promise<TimerSnapshot> {
    return this.enqueueCommand(async () => {
      if (this.externalConflict) return this.snapshot()
      if (this.readOnlyError) await this.tryReadFromDisk(!this.hasAuthoritativeLoad)
      else await this.ensureLoaded()
      return this.snapshot()
    })
  }

  start(request: StartTimerRequest): Promise<TimerSnapshot> {
    if (this.disposed) return Promise.reject(this.disposedError())
    const parsed = startTimerRequestSchema.safeParse(request)
    if (!parsed.success) return Promise.reject(parsed.error)
    const command = parsed.data
    return this.enqueueCommand(async () => {
      await this.ensureLoaded()
      this.assertWritable()
      if (!this.file) throw new Error('计时状态尚未加载')
      await this.tryReadFromDisk(false)
      this.assertWritable()
      if (!this.file) throw new Error('计时状态尚未加载')
      if (this.file.value.active) throw new Error('已有计时器正在运行或暂停')
      if (this.ledgerIds.has(command.sessionId)) throw new Error(`计时会话 ID 已存在：${command.sessionId}`)
      this.lastEnded = undefined
      this.lastEndAttemptId = undefined

      const now = this.runtime.now()
      const timestamp = now.toISOString()
      const common = {
        id: command.sessionId,
        status: 'running' as const,
        createdAt: timestamp,
        segmentStartedAt: timestamp,
        accumulatedSeconds: 0,
        updatedAt: timestamp,
        ...(command.taskIntent ? { taskIntent: command.taskIntent } : {})
      }
      const active: ActiveTimer = command.mode === 'elapsed'
        ? { ...common, mode: 'elapsed' }
        : { ...common, mode: 'countdown', targetSeconds: command.countdownMinutes * 60 }
      await this.persist(active, now)
      this.resetSchedule()
      this.emit()
      return this.snapshot()
    })
  }

  setTaskIntent(request: SetTimerTaskIntentRequest): Promise<TimerSnapshot> {
    if (this.disposed) return Promise.reject(this.disposedError())
    const parsed = setTimerTaskIntentRequestSchema.safeParse(request)
    if (!parsed.success) return Promise.reject(parsed.error)
    const command = parsed.data
    return this.enqueueCommand(async () => {
      await this.ensureLoaded()
      this.assertWritable()
      const active = this.requireActive()
      if (active.id !== command.sessionId) throw new Error('计时会话已变化，请重新选择任务')
      const now = this.runtime.now()
      if (active.mode === 'countdown' && active.status === 'running' && remainingSeconds(active, now) === 0) {
        this.cancelSchedule()
        await this.runDueBoundary(active)
        return this.snapshot()
      }
      if (command.taskIntent && command.taskIntent.date !== localDateAt(now)) {
        throw new Error('日期已变化，请从今日任务重新选择')
      }
      const { taskIntent: previousIntent, ...timing } = active
      void previousIntent
      await this.persist({
        ...timing,
        updatedAt: now.toISOString(),
        ...(command.taskIntent ? { taskIntent: command.taskIntent } : {})
      }, now)
      this.resetSchedule()
      this.emit()
      return this.snapshot()
    })
  }

  pause(): Promise<TimerSnapshot> {
    return this.pauseWithReason('user')
  }

  pauseFor(reason: Extract<TimerPauseReason, 'app_close' | 'system_suspend'>): Promise<TimerSnapshot> {
    return this.pauseWithReason(reason)
  }

  private pauseWithReason(reason: Extract<TimerPauseReason, 'user' | 'app_close' | 'system_suspend'>): Promise<TimerSnapshot> {
    return this.enqueueCommand(async () => {
      await this.ensureLoaded()
      this.assertWritable()
      if (!this.file?.value.active && (reason !== 'user' || this.lastEnded)) return this.snapshot()
      const active = this.requireActive()
      if (active.status === 'paused') return this.snapshot()
      const now = this.runtime.now()
      if (active.mode === 'countdown' && remainingSeconds(active, now) === 0) {
        this.cancelSchedule()
        await this.runDueBoundary(active)
        return this.snapshot()
      }
      await this.persist(pauseActive(active, reason, now), now)
      this.resetSchedule()
      this.emit()
      return this.snapshot()
    })
  }

  resume(): Promise<TimerSnapshot> {
    return this.enqueueCommand(async () => {
      await this.ensureLoaded()
      this.assertWritable()
      const active = this.requireActive()
      const now = this.runtime.now()
      if (active.status === 'running') {
        if (active.mode === 'countdown' && remainingSeconds(active, now) === 0) {
          this.cancelSchedule()
          await this.runDueBoundary(active)
        }
        return this.snapshot()
      }
      const timestamp = now.toISOString()
      const { pauseReason, ...paused } = active
      void pauseReason
      const resumed: ActiveTimer = {
        ...paused,
        status: 'running',
        segmentStartedAt: timestamp,
        updatedAt: timestamp
      }
      await this.persist(resumed, now)
      this.resetSchedule()
      this.emit()
      return this.snapshot()
    })
  }

  end(): Promise<EndedTimerResult> {
    return this.enqueueCommand(async () => {
      await this.ensureLoaded()
      this.assertWritable()
      if (!this.file?.value.active) {
        if (this.lastEnded) return this.lastEnded
        if (this.lastEndAttemptId) {
          const { session } = await this.findSession(this.lastEndAttemptId)
          const result = { session, proposedMinutes: proposedCreditMinutes(session.durationSeconds) }
          this.lastEnded = result
          return result
        }
        throw new Error('当前没有计时器')
      }
      const active = this.file.value.active
      const now = this.runtime.now()
      const stateRevision = this.file.revision
      this.cancelSchedule()
      if (active.mode === 'countdown' && active.status === 'running' && remainingSeconds(active, now) === 0) {
        return this.completeActive(active, now, true, stateRevision)
      }
      return this.completeActive(active, now, false)
    })
  }

  list(request: TimerListRequest): Promise<TimerListResult> {
    if (this.disposed) return Promise.reject(this.disposedError())
    const parsed = timerListRequestSchema.safeParse(request)
    if (!parsed.success) return Promise.reject(parsed.error)
    return this.enqueueCommand(async () => {
      await this.ensureLoaded()
      return this.listNow(parsed.data.date)
    })
  }

  assignmentOptions(sessionId: string): Promise<TimerAssignmentOptions> {
    if (this.disposed) return Promise.reject(this.disposedError())
    const parsed = assignmentOptionsSessionIdSchema.safeParse(sessionId)
    if (!parsed.success) return Promise.reject(parsed.error)
    return this.enqueueCommand(async () => {
      await this.ensureLoaded()
      const { session, date } = await this.findSession(parsed.data)
      if (session.status !== 'pending') throw new Error(`计时会话已分配：${session.id}`)
      const day = await this.requireDays().open(date, { create: true })
      if (!day) throw new Error(`无法建立每日记录：${date}`)
      return {
        session,
        date,
        tasks: day.file.value.tasks.map(({ id, title, actualMinutes }) => ({ id, title, actualMinutes }))
      }
    })
  }

  assign(request: AssignTimerRequest): Promise<AssignTimerResult> {
    if (this.disposed) return Promise.reject(this.disposedError())
    const parsed = assignTimerRequestSchema.safeParse(request)
    if (!parsed.success) return Promise.reject(parsed.error)
    const command = parsed.data
    const fingerprint = JSON.stringify(command)
    return this.enqueueCommand(async () => {
      await this.ensureLoaded()
      const cached = this.assignmentRequests.get(command.requestId)
      if (cached) {
        if (cached.fingerprint !== fingerprint) throw new Error(`请求 ID 已用于不同的分配：${command.requestId}`)
        return cached.result
      }
      const result = await this.assignNow(command)
      this.cacheRequest(this.assignmentRequests, command.requestId, { fingerprint, result })
      return result
    })
  }

  discard(request: DiscardTimerRequest): Promise<TimerListResult> {
    if (this.disposed) return Promise.reject(this.disposedError())
    const parsed = discardTimerRequestSchema.safeParse(request)
    if (!parsed.success) return Promise.reject(parsed.error)
    const command = parsed.data
    const fingerprint = JSON.stringify(command)
    return this.enqueueCommand(async () => {
      await this.ensureLoaded()
      const cached = this.discardRequests.get(command.requestId)
      if (cached) {
        if (cached.fingerprint !== fingerprint) throw new Error(`请求 ID 已用于不同的丢弃操作：${command.requestId}`)
        return cached.result
      }
      const result = await this.discardNow(command)
      this.cacheRequest(this.discardRequests, command.requestId, { fingerprint, result })
      return result
    })
  }

  handleExternalChange(event: FileChangeEvent): Promise<void> {
    const requestedPath = event.path.replaceAll('\\', '/')
    if (requestedPath !== TIMER_STATE_PATH && !TIMER_LEDGER_PATH.test(requestedPath)) return Promise.resolve()
    return this.enqueueCommand(async () => {
      if (!this.loaded) await this.tryReadFromDisk(true)
      const relativePath = await this.store.relativeTimerPath(requestedPath)
      const absolutePath = this.absoluteTimerPath(relativePath)
      if (event.kind !== 'removed') {
        try {
          const revision = revisionOf(await readFile(absolutePath, 'utf8'))
          if (!this.externalConflict && revision === this.knownRevisions.get(relativePath)) return
        } catch {
          // The authoritative reload below reports malformed or vanished files.
        }
      }

      const active = this.file?.value.active
      if (active && !this.externalConflict) {
        const now = this.runtime.now()
        const frozen = active.status === 'running'
          ? pauseActive(active, 'recovered_after_interruption', now)
          : active
        if (this.file) {
          this.file = {
            ...this.file,
            value: { ...this.file.value, active: frozen }
          }
        }
        this.externalConflict = true
        this.recordReadOnlyError(
          new Error(`${absolutePath}: 活动计时期间计时文件被外部修改`),
          absolutePath
        )
        return
      }

      if (event.kind === 'removed' && relativePath === TIMER_STATE_PATH) {
        this.externalConflict = true
        this.recordReadOnlyError(new Error(`${absolutePath}: 计时状态文件被外部删除`), absolutePath)
        return
      }

      const wasReadOnly = this.readOnlyError !== undefined
      await this.tryReadFromDisk(false)
      if (this.readOnlyError) {
        this.externalConflict = true
        return
      }
      this.externalConflict = false
      if (!wasReadOnly) this.emit()
    })
  }

  subscribe(listener: TimerSubscriptionListener): () => void {
    if (this.disposed) return () => undefined
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispose(): Promise<void> {
    if (this.disposePromise) return this.disposePromise
    this.disposed = true
    this.cancelSchedule()
    this.listeners.clear()
    this.disposePromise = this.enqueue(async () => undefined)
    return this.disposePromise
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }

  private enqueueCommand<T>(operation: () => Promise<T>): Promise<T> {
    if (this.disposed) return Promise.reject(this.disposedError())
    return this.enqueue(async () => {
      if (this.disposed) throw this.disposedError()
      return operation()
    })
  }

  private disposedError(): Error {
    return new Error('Timer service has been disposed and released')
  }

  private async ensureLoaded(): Promise<void> {
    if (!this.loaded) await this.tryReadFromDisk(true)
    this.assertWritable()
  }

  private async tryReadFromDisk(recoverRunning: boolean): Promise<boolean> {
    const wasReadOnly = this.readOnlyError !== undefined
    try {
      const recovered = await this.readFromDisk(recoverRunning)
      this.readOnlyError = undefined
      this.externalConflict = false
      this.loaded = true
      this.hasAuthoritativeLoad = true
      this.completion = undefined
      this.resetSchedule()
      if (wasReadOnly || recovered) this.emit()
      return recovered
    } catch (error) {
      this.cancelSchedule()
      const nextError = this.timerError(error)
      const diagnosticChanged = !this.sameTimerError(this.readOnlyError, nextError)
      this.readOnlyError = nextError
      this.loaded = true
      if (diagnosticChanged) this.emit()
      return false
    }
  }

  private async readFromDisk(recoverRunning: boolean): Promise<boolean> {
    const file = await this.store.state()
    const ledgers = await this.store.listLedgers()
    const ids = new Set<string>()
    const idPaths = new Map<string, string>()
    for (const ledger of ledgers) {
      for (const session of ledger.value.ledger.sessions) {
        const priorPath = idPaths.get(session.id)
        if (priorPath) {
          throw new Error(`${ledger.path}: duplicate timer session ID ${session.id}; first found in ${priorPath}`)
        }
        ids.add(session.id)
        idPaths.set(session.id, ledger.path)
      }
    }
    const activeLedgerPath = file.value.active ? idPaths.get(file.value.active.id) : undefined
    if (file.value.active && activeLedgerPath) {
      throw new Error(
        `${file.path}: active timer session ID ${file.value.active.id} already exists in ${activeLedgerPath}`
      )
    }

    let authoritative = file
    let recovered = false
    if (recoverRunning && file.value.active?.status === 'running') {
      const now = this.runtime.now()
      const { segmentStartedAt, ...rest } = file.value.active
      void segmentStartedAt
      authoritative = await this.store.saveState({
        ...file,
        value: {
          schemaVersion: 1,
          active: {
            ...rest,
            status: 'paused',
            pauseReason: 'recovered_after_interruption',
            updatedAt: now.toISOString()
          },
          updatedAt: now.toISOString()
        }
      })
      recovered = true
    }
    this.file = authoritative
    this.knownRevisions.clear()
    this.knownPaths.clear()
    this.rememberTimerFile(TIMER_STATE_PATH, authoritative)
    for (const ledger of ledgers) {
      this.rememberTimerFile(this.ledgerRelativePath(ledger.value.ledger.date), ledger)
    }
    this.ledgerIds.clear()
    for (const id of ids) this.ledgerIds.add(id)
    return recovered
  }

  private assertWritable(): void {
    if (this.readOnlyError) throw new Error(this.readOnlyError.message)
  }

  private requireActive(): ActiveTimer {
    const active = this.file?.value.active
    if (!active) throw new Error('当前没有计时器')
    return active
  }

  private async persist(active: ActiveTimer | null, now: Date): Promise<void> {
    if (!this.file) throw new Error('计时状态尚未加载')
    try {
      const saved = await this.store.saveState({
        ...this.file,
        value: {
          schemaVersion: 1,
          active,
          updatedAt: now.toISOString()
        }
      })
      this.file = saved
      this.rememberTimerFile(TIMER_STATE_PATH, saved)
      this.completion = undefined
    } catch (error) {
      this.cancelSchedule()
      throw this.recordReadOnlyError(error, this.file.path)
    }
  }

  private async completeActive(
    expectedActive: ActiveTimer,
    requestedEnd: Date,
    automatic: boolean,
    expectedStateRevision?: string
  ): Promise<EndedTimerResult> {
    if (!this.file) throw new Error('计时状态尚未加载')
    this.lastEndAttemptId = expectedActive.id
    if (automatic && (expectedActive.mode !== 'countdown' || expectedActive.status !== 'running')) {
      throw new Error('只有运行中的倒计时可以自动结束')
    }
    const endedAt = automatic && expectedActive.mode === 'countdown' && expectedActive.status === 'running'
      ? new Date(Date.parse(expectedActive.segmentStartedAt) +
          (expectedActive.targetSeconds - expectedActive.accumulatedSeconds) * 1000)
      : new Date(requestedEnd)
    const date = localDateAt(endedAt)

    try {
      await this.store.ledger(date, true)
      const state = await this.store.state()
      const ledger = await this.store.ledger(date, false)
      if (!ledger) throw new Error(`计时台账在事务前消失：${date}`)
      if (expectedStateRevision && state.revision !== expectedStateRevision) {
        throw new Error(`${state.path}: 倒计时状态在到点结算前发生变化`)
      }
      const existing = ledger.value.ledger.sessions.find((session) => session.id === expectedActive.id)
      if (existing) {
        if (state.value.active !== null) {
          throw new Error(`${ledger.path}: 计时会话 ${expectedActive.id} 同时存在于活动状态和台账`)
        }
        const result = { session: existing, proposedMinutes: proposedCreditMinutes(existing.durationSeconds) }
        this.file = state
        this.ledgerIds.add(existing.id)
        this.lastEnded = result
        return result
      }
      const active = state.value.active
      if (!active || active.id !== expectedActive.id) {
        throw new Error(`${state.path}: 活动计时器在结束事务前发生变化`)
      }
      const rawDuration = elapsedSeconds(active, endedAt)
      const durationSeconds = active.mode === 'countdown'
        ? Math.min(active.targetSeconds, rawDuration)
        : rawDuration
      const timestamp = endedAt.toISOString()
      const taskIntent = active.taskIntent ? { taskIntent: active.taskIntent } : {}
      const session: TimerSession = active.mode === 'countdown'
        ? {
            id: active.id,
            mode: active.mode,
            targetSeconds: active.targetSeconds,
            status: 'pending',
            startedAt: active.createdAt,
            endedAt: timestamp,
            durationSeconds,
            ...taskIntent
          }
        : {
            id: active.id,
            mode: active.mode,
            status: 'pending',
            startedAt: active.createdAt,
            endedAt: timestamp,
            durationSeconds,
            ...taskIntent
          }
      const nextState: TimerStateFile = { schemaVersion: 1, active: null, updatedAt: timestamp }
      const nextLedger: TimerLedgerDocument = {
        ledger: {
          ...ledger.value.ledger,
          sessions: [...ledger.value.ledger.sessions, session],
          updatedAt: timestamp
        },
        body: ledger.value.body
      }
      const stateContent = serializeTimerState(nextState)
      const ledgerContent = serializeTimerLedger(nextLedger)
      let revisions: string[]
      try {
        revisions = await this.store.transaction().replaceMany([
          { path: state.path, content: stateContent, expectedRevision: state.revision },
          { path: ledger.path, content: ledgerContent, expectedRevision: ledger.revision }
        ])
      } catch (error) {
        throw await this.recordTransactionError(error, [
          { path: state.path, expectedRevision: state.revision },
          { path: ledger.path, expectedRevision: ledger.revision }
        ])
      }
      this.file = { path: state.path, revision: revisions[0], value: nextState }
      this.rememberTimerFile(TIMER_STATE_PATH, this.file)
      this.knownRevisions.set(this.ledgerRelativePath(date), revisions[1])
      this.knownPaths.set(this.ledgerRelativePath(date), ledger.path)
      this.ledgerIds.add(session.id)
      const result = { session, proposedMinutes: proposedCreditMinutes(durationSeconds) }
      this.lastEnded = result
      this.completion = automatic ? { sessionId: session.id, endedAt: timestamp } : undefined
      this.resetSchedule()
      this.emit()
      return result
    } catch (error) {
      if (this.readOnlyError && error instanceof Error && error.message === this.readOnlyError.message) throw error
      throw this.recordReadOnlyError(error, this.file.path)
    }
  }

  private async ledgerIndex(): Promise<Array<{ file: VersionedFile<TimerLedgerDocument>; session: TimerSession }>> {
    const ledgers = await this.store.listLedgers()
    const seen = new Map<string, string>()
    const entries: Array<{ file: VersionedFile<TimerLedgerDocument>; session: TimerSession }> = []
    for (const file of ledgers) {
      this.rememberTimerFile(this.ledgerRelativePath(file.value.ledger.date), file)
      for (const session of file.value.ledger.sessions) {
        const prior = seen.get(session.id)
        if (prior) throw new Error(`${file.path}: duplicate timer session ID ${session.id}; first found in ${prior}`)
        seen.set(session.id, file.path)
        entries.push({ file, session })
      }
    }
    return entries
  }

  private sessionOrder(left: TimerSession, right: TimerSession): number {
    return right.endedAt.localeCompare(left.endedAt) || right.id.localeCompare(left.id)
  }

  private async listNow(date: string): Promise<TimerListResult> {
    try {
      const entries = await this.ledgerIndex()
      return {
        today: entries
          .filter(({ file }) => file.value.ledger.date === date)
          .map(({ session }) => session)
          .sort((left, right) => this.sessionOrder(left, right)),
        pending: entries
          .map(({ session }) => session)
          .filter((session) => session.status === 'pending')
          .sort((left, right) => this.sessionOrder(left, right))
      }
    } catch (error) {
      throw this.recordReadOnlyError(error)
    }
  }

  private async findSession(id: string): Promise<{
    file: VersionedFile<TimerLedgerDocument>
    session: TimerSession
    date: string
  }> {
    let entries: Awaited<ReturnType<TimerService['ledgerIndex']>>
    try {
      entries = await this.ledgerIndex()
    } catch (error) {
      throw this.recordReadOnlyError(error)
    }
    const found = entries.find(({ session }) => session.id === id)
    if (!found) throw new Error(`找不到计时会话：${id}`)
    return { ...found, date: found.file.value.ledger.date }
  }

  private requireDays(): DailyFileService {
    return this.days
  }

  private async assignNow(command: AssignTimerRequest): Promise<AssignTimerResult> {
    const located = await this.findSession(command.sessionId)
    const days = this.requireDays()
    const opened = await days.open(located.date, { create: true })
    if (!opened) throw new Error(`无法建立每日记录：${located.date}`)
    const dayReloaded = await days.open(located.date, { create: false })
    const ledgerReloaded = await this.store.ledger(located.date, false)
    if (!dayReloaded || !ledgerReloaded) throw new Error(`分配事务前文件消失：${located.date}`)
    const sessionIndex = ledgerReloaded.value.ledger.sessions.findIndex(({ id }) => id === command.sessionId)
    if (sessionIndex < 0) throw new Error(`分配事务前会话消失：${command.sessionId}`)
    const currentSession = ledgerReloaded.value.ledger.sessions[sessionIndex]
    if (currentSession.status === 'assigned') {
      const same = currentSession.assignment.taskId === command.taskId &&
        currentSession.assignment.creditedMinutes === command.creditedMinutes
      if (!same) throw new Error(`计时会话已分配到不同任务：${command.sessionId}`)
      return { session: currentSession, day: dayReloaded.file }
    }
    const taskIndex = dayReloaded.file.value.tasks.findIndex(({ id }) => id === command.taskId)
    if (taskIndex < 0) throw new Error(`每日任务不存在：${command.taskId}`)
    const task = dayReloaded.file.value.tasks[taskIndex]
    if (task.actualMinutes + command.creditedMinutes > 1440) throw new Error('任务实际分钟数不能超过 1440')
    const currentDayActual = dayReloaded.file.value.tasks.reduce((sum, candidate) => sum + candidate.actualMinutes, 0)
    if (currentDayActual + command.creditedMinutes > 1440) throw new Error('该日实际学习时间不能超过 1440 分钟')

    const assignedAt = this.runtime.now().toISOString()
    const assignedSession: TimerSession = {
      ...currentSession,
      status: 'assigned',
      assignment: {
        taskId: task.id,
        taskTitle: task.title,
        creditedMinutes: command.creditedMinutes,
        assignedAt
      }
    }
    const nextDay = {
      ...dayReloaded.file.value,
      tasks: dayReloaded.file.value.tasks.map((item, index) => (
        index === taskIndex ? { ...item, actualMinutes: item.actualMinutes + command.creditedMinutes } : item
      )),
      updatedAt: assignedAt
    }
    const nextLedger: TimerLedgerDocument = {
      ledger: {
        ...ledgerReloaded.value.ledger,
        sessions: ledgerReloaded.value.ledger.sessions.map((session, index) => (
          index === sessionIndex ? assignedSession : session
        )),
        updatedAt: assignedAt
      },
      body: ledgerReloaded.value.body
    }
    const dayContent = serializeDailyRecord(nextDay)
    const ledgerContent = serializeTimerLedger(nextLedger)
    let revisions: string[]
    try {
      revisions = await this.store.transaction().replaceMany([
        { path: dayReloaded.file.path, content: dayContent, expectedRevision: dayReloaded.file.revision },
        { path: ledgerReloaded.path, content: ledgerContent, expectedRevision: ledgerReloaded.revision }
      ])
    } catch (error) {
      throw await this.recordTransactionError(error, [
        { path: dayReloaded.file.path, expectedRevision: dayReloaded.file.revision },
        { path: ledgerReloaded.path, expectedRevision: ledgerReloaded.revision }
      ])
    }
    this.knownRevisions.set(this.ledgerRelativePath(located.date), revisions[1])
    this.knownPaths.set(this.ledgerRelativePath(located.date), ledgerReloaded.path)
    return {
      session: assignedSession,
      day: { path: dayReloaded.file.path, revision: revisions[0], value: nextDay }
    }
  }

  private async discardNow(command: DiscardTimerRequest): Promise<TimerListResult> {
    const located = await this.findSession(command.sessionId)
    if (located.session.status === 'assigned') throw new Error(`已分配会话不能丢弃：${command.sessionId}`)
    const reloaded = await this.store.ledger(located.date, false)
    if (!reloaded) throw new Error(`丢弃前台账消失：${located.date}`)
    const current = reloaded.value.ledger.sessions.find(({ id }) => id === command.sessionId)
    if (!current) throw new Error(`丢弃前会话消失：${command.sessionId}`)
    if (current.status === 'assigned') throw new Error(`已分配会话不能丢弃：${command.sessionId}`)
    const now = this.runtime.now()
    try {
      const saved = await this.store.saveLedger({
        ...reloaded,
        value: {
          ledger: {
            ...reloaded.value.ledger,
            sessions: reloaded.value.ledger.sessions.filter(({ id }) => id !== command.sessionId),
            updatedAt: now.toISOString()
          },
          body: reloaded.value.body
        }
      })
      this.rememberTimerFile(this.ledgerRelativePath(located.date), saved)
    } catch (error) {
      throw this.recordReadOnlyError(error, reloaded.path)
    }
    this.ledgerIds.delete(command.sessionId)
    return this.listNow(localDateAt(now))
  }

  private cacheRequest<T>(cache: Map<string, T>, key: string, value: T): void {
    cache.set(key, value)
    if (cache.size > 128) cache.delete(cache.keys().next().value as string)
  }

  private ledgerRelativePath(date: string): string {
    return `data/timer/${date.slice(0, 4)}/${date}.md`
  }

  private rememberTimerFile(relativePath: string, file: { path: string; revision: string }): void {
    this.knownRevisions.set(relativePath, file.revision)
    this.knownPaths.set(relativePath, file.path)
  }

  private absoluteTimerPath(relativePath: string): string {
    const known = this.knownPaths.get(relativePath)
    if (known) return known
    if (!this.file) return relativePath
    return join(dirname(this.file.path), relativePath.slice('data/timer/'.length))
  }

  private async recordTransactionError(
    error: unknown,
    candidates: Array<{ path: string; expectedRevision: string }>
  ): Promise<Error> {
    let fallbackPath = candidates[0]?.path
    for (const candidate of candidates) {
      try {
        const currentRevision = revisionOf(await readFile(candidate.path, 'utf8'))
        if (currentRevision !== candidate.expectedRevision) {
          fallbackPath = candidate.path
          break
        }
      } catch {
        fallbackPath = candidate.path
        break
      }
    }
    return this.recordReadOnlyError(error, fallbackPath)
  }

  private snapshot(): TimerSnapshot {
    const base = frozenSnapshot(this.file?.value.active ?? null, this.runtime.now().toISOString())
    if (!this.readOnlyError && !this.completion) return base
    const snapshot: TimerSnapshot = {
      ...base,
      ...(this.readOnlyError ? { readOnlyError: Object.freeze({ ...this.readOnlyError }) } : {}),
      ...(this.completion ? { completion: Object.freeze({ ...this.completion }) } : {})
    }
    return Object.freeze(snapshot)
  }

  private timerError(error: unknown): { message: string; path?: string } {
    const message = error instanceof Error ? error.message : String(error)
    const directPath = typeof (error as { path?: unknown })?.path === 'string'
      ? (error as { path: string }).path
      : undefined
    const messagePath = /^(.+?data\/timer\/(?:state\.json|\d{4}\/\d{4}-\d{2}-\d{2}\.md)):/.exec(message)?.[1]
    const path = directPath ?? messagePath
    return path ? { message, path } : { message }
  }

  private sameTimerError(
    left: { message: string; path?: string } | undefined,
    right: { message: string; path?: string }
  ): boolean {
    return left?.message === right.message && left.path === right.path
  }

  private recordReadOnlyError(error: unknown, fallbackPath?: string): Error {
    const parsed = this.timerError(error)
    const nextError = parsed.path || !fallbackPath
      ? parsed
      : { path: fallbackPath, message: `${fallbackPath}: ${parsed.message}` }
    const diagnosticChanged = !this.sameTimerError(this.readOnlyError, nextError)
    this.readOnlyError = nextError
    this.cancelSchedule()
    if (diagnosticChanged) this.emit()
    return new Error(nextError.message, { cause: error })
  }

  private emit(): void {
    const snapshot = this.snapshot()
    for (const listener of Array.from(this.listeners)) {
      try {
        listener(snapshot)
      } catch {
        // One renderer listener must not break timer state or other listeners.
      }
    }
  }

  private resetSchedule(): void {
    this.cancelSchedule()
    this.scheduleCurrentCountdown()
  }

  private scheduleCurrentCountdown(): void {
    if (this.disposed || this.readOnlyError) return
    const active = this.file?.value.active
    if (!active || active.mode !== 'countdown' || active.status !== 'running') return
    const generation = this.schedulerGeneration
    const milliseconds = remainingSeconds(active, this.runtime.now()) * 1000
    this.schedulerHandle = this.runtime.setTimeout(() => {
      void this.enqueue(async () => this.handleScheduledDue(generation, active.id)).catch(() => undefined)
    }, milliseconds)
  }

  private async handleScheduledDue(generation: number, sessionId: string): Promise<void> {
    if (this.disposed || this.readOnlyError || generation !== this.schedulerGeneration) return
    this.schedulerHandle = undefined
    this.schedulerGeneration += 1
    const active = this.file?.value.active
    if (!active || active.id !== sessionId || active.mode !== 'countdown' || active.status !== 'running') return

    const now = this.runtime.now()
    if (remainingSeconds(active, now) > 0) {
      this.scheduleCurrentCountdown()
      return
    }
    if (!this.file) return

    await this.runDueBoundary(active)
  }

  private async runDueBoundary(active: RunningCountdown): Promise<void> {
    if (!this.file) return
    this.assertWritable()
    const revision = this.file.revision
    const dueAt = new Date(
      Date.parse(active.segmentStartedAt) + (active.targetSeconds - active.accumulatedSeconds) * 1000
    )

    try {
      await this.completeActive(active, dueAt, true, revision)
    } catch (error) {
      if (this.readOnlyError && error instanceof Error && error.message === this.readOnlyError.message) throw error
      throw this.recordReadOnlyError(error, this.file.path)
    }
  }

  private cancelSchedule(): void {
    this.schedulerGeneration += 1
    if (this.schedulerHandle !== undefined) this.runtime.clearTimeout(this.schedulerHandle)
    this.schedulerHandle = undefined
  }
}
