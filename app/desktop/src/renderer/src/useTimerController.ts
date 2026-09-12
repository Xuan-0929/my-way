import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DesktopApi, Result } from '../../shared/api'
import type {
  AssignTimerRequest,
  AssignTimerResult,
  TimerAssignmentOptions,
  TimerListResult,
  TimerSnapshot,
  TimerTaskIntent
} from '../../shared/timerTypes'

type TimerAction = 'start' | 'intent' | 'pause' | 'resume' | 'end' | 'assignment' | 'assign' | 'discard'

export interface UseTimerControllerOptions {
  enabled: boolean
  api?: DesktopApi
  date: string
  commitAssignment?: (request: AssignTimerRequest) => Promise<Result<AssignTimerResult>>
}

const idleSnapshot = (): TimerSnapshot => ({ active: null, capturedAt: new Date().toISOString() })
const emptyList = (): TimerListResult => ({ today: [], pending: [] })

export const playCompletionSound = (): void => {
  try {
    const AudioContextConstructor = window.AudioContext ?? (
      window as typeof window & { webkitAudioContext?: typeof AudioContext }
    ).webkitAudioContext
    if (!AudioContextConstructor) return
    const context = new AudioContextConstructor()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    const start = context.currentTime
    oscillator.type = 'sine'
    oscillator.frequency.setValueAtTime(660, start)
    oscillator.frequency.exponentialRampToValueAtTime(880, start + 0.18)
    gain.gain.setValueAtTime(0.0001, start)
    gain.gain.exponentialRampToValueAtTime(0.025, start + 0.025)
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.32)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start(start)
    oscillator.stop(start + 0.34)
    oscillator.addEventListener('ended', () => { void context.close().catch(() => undefined) }, { once: true })
    void context.resume().catch(() => undefined)
  } catch {
    // Completion UI remains authoritative when audio is unavailable or blocked.
  }
}

const elapsedAt = (snapshot: TimerSnapshot, nowMilliseconds: number): number => {
  const active = snapshot.active
  if (!active) return 0
  if (active.status === 'paused') return active.accumulatedSeconds
  return active.accumulatedSeconds + Math.max(
    0,
    Math.floor((nowMilliseconds - Date.parse(active.segmentStartedAt)) / 1000)
  )
}

export const useTimerController = ({ enabled, api, date, commitAssignment }: UseTimerControllerOptions) => {
  const [snapshot, setSnapshot] = useState<TimerSnapshot>(() => idleSnapshot())
  const [sessions, setSessions] = useState<TimerListResult>(() => emptyList())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingAction, setPendingAction] = useState<TimerAction | null>(null)
  const [completion, setCompletion] = useState<NonNullable<TimerSnapshot['completion']> | null>(null)
  const [assignment, setAssignment] = useState<TimerAssignmentOptions | null>(null)
  const [ariaAnnouncement, setAriaAnnouncement] = useState('')
  const [nowMilliseconds, setNowMilliseconds] = useState(() => Date.now())
  const completionKey = useRef<string | null>(null)
  const actionLock = useRef(false)

  const acceptSnapshot = useCallback((next: TimerSnapshot): void => {
    setSnapshot(next)
    setNowMilliseconds(Date.now())
    setError(next.readOnlyError?.message ?? null)
    if (next.completion) {
      const key = `${next.completion.sessionId}:${next.completion.endedAt}`
      if (completionKey.current !== key) {
        completionKey.current = key
        setCompletion(next.completion)
        setAriaAnnouncement('倒计时已结束')
        playCompletionSound()
      }
    }
  }, [])

  const readResult = useCallback(<T,>(result: Result<T>): T | null => {
    if (result.ok) return result.value
    setError(result.error.message)
    return null
  }, [])

  const readOperation = useCallback(async <T,>(operation: () => Promise<Result<T>>): Promise<T | null> => {
    try {
      return readResult(await operation())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    }
  }, [readResult])

  const refreshList = useCallback(async (): Promise<boolean> => {
    if (!api) return false
    const value = await readOperation(() => api.timer.list({ date }))
    if (!value) return false
    setSessions(value)
    return true
  }, [api, date, readOperation])

  useEffect(() => {
    if (!enabled || !completion) return
    let active = true
    queueMicrotask(() => { if (active) void refreshList() })
    return () => { active = false }
  }, [completion, enabled, refreshList])

  useEffect(() => {
    if (!enabled || !api) {
      completionKey.current = null
      return
    }
    let mounted = true
    queueMicrotask(() => {
      if (!mounted) return
      setLoading(true)
      setError(null)
      setPendingAction(null)
      setCompletion(null)
      setAssignment(null)
    })
    let unsubscribe = (): void => undefined
    let subscriptionError: string | null = null
    try {
      unsubscribe = api.timer.subscribe((next) => {
        if (mounted) acceptSnapshot(next)
      })
    } catch (cause) {
      subscriptionError = cause instanceof Error ? cause.message : String(cause)
    }
    void Promise.all([api.timer.get(), api.timer.list({ date })]).then(([snapshotResult, listResult]) => {
      if (!mounted) return
      const nextSnapshot = readResult(snapshotResult)
      const nextList = readResult(listResult)
      if (nextSnapshot) acceptSnapshot(nextSnapshot)
      if (nextList) setSessions(nextList)
    }).catch((cause: unknown) => {
      if (mounted) setError(cause instanceof Error ? cause.message : String(cause))
    }).finally(() => {
      if (mounted) {
        setLoading(false)
        if (subscriptionError) setError(subscriptionError)
      }
    })
    return () => {
      mounted = false
      unsubscribe()
    }
  }, [acceptSnapshot, api, date, enabled, readResult])

  useEffect(() => {
    if (!enabled || snapshot.active?.status !== 'running') return
    const handle = window.setInterval(() => setNowMilliseconds(Date.now()), 1_000)
    return () => window.clearInterval(handle)
  }, [enabled, snapshot.active?.id, snapshot.active?.status])

  const run = useCallback(async <T,>(action: TimerAction, operation: () => Promise<Result<T>>): Promise<T | null> => {
    if (actionLock.current) return null
    actionLock.current = true
    setPendingAction(action)
    setError(null)
    try {
      return readResult(await operation())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      return null
    } finally {
      actionLock.current = false
      setPendingAction(null)
    }
  }, [readResult])

  const startElapsed = useCallback(async (taskIntent?: TimerTaskIntent): Promise<void> => {
    if (!api) return
    const next = await run('start', () => api.timer.start({
      sessionId: globalThis.crypto.randomUUID(),
      mode: 'elapsed',
      ...(taskIntent ? { taskIntent } : {})
    }))
    if (next) {
      acceptSnapshot(next)
      setAriaAnnouncement('自由计时已开始')
    }
  }, [acceptSnapshot, api, run])

  const startCountdown = useCallback(async (countdownMinutes: number, taskIntent?: TimerTaskIntent): Promise<void> => {
    if (!api) return
    const next = await run('start', () => api.timer.start({
      sessionId: globalThis.crypto.randomUUID(),
      mode: 'countdown',
      countdownMinutes,
      ...(taskIntent ? { taskIntent } : {})
    }))
    if (next) {
      acceptSnapshot(next)
      setAriaAnnouncement(`已开始 ${countdownMinutes} 分钟倒计时`)
    }
  }, [acceptSnapshot, api, run])

  const pause = useCallback(async (): Promise<void> => {
    if (!api) return
    const next = await run('pause', () => api.timer.pause())
    if (next) {
      acceptSnapshot(next)
      setAriaAnnouncement('计时已暂停')
    }
  }, [acceptSnapshot, api, run])

  const setTaskIntent = useCallback(async (taskIntent: TimerTaskIntent | null): Promise<void> => {
    if (!api || !snapshot.active) return
    const sessionId = snapshot.active.id
    const next = await run('intent', () => api.timer.setTaskIntent({ sessionId, taskIntent }))
    if (next) {
      acceptSnapshot(next)
      if (next.active?.id === sessionId) setAriaAnnouncement(taskIntent ? `已关联 ${taskIntent.taskTitle}` : '已取消任务关联')
    }
  }, [acceptSnapshot, api, run, snapshot.active])

  const resume = useCallback(async (): Promise<void> => {
    if (!api) return
    const next = await run('resume', () => api.timer.resume())
    if (next) {
      acceptSnapshot(next)
      setAriaAnnouncement('计时已继续')
    }
  }, [acceptSnapshot, api, run])

  const openAssignment = useCallback(async (sessionId: string): Promise<void> => {
    if (!api) return
    const options = await run('assignment', () => api.timer.assignmentOptions(sessionId))
    if (options) setAssignment(options)
  }, [api, run])

  const end = useCallback(async (): Promise<void> => {
    if (!api) return
    const ended = await run('end', () => api.timer.end())
    if (!ended) return
    setAriaAnnouncement('计时已结束，等待分配学习时长')
    const latest = await readOperation(() => api.timer.get())
    if (latest) acceptSnapshot(latest)
    await refreshList()
    const options = await readOperation(() => api.timer.assignmentOptions(ended.session.id))
    if (options) setAssignment(options)
  }, [acceptSnapshot, api, readOperation, refreshList, run])

  const deferAssignment = useCallback((): void => {
    setAssignment(null)
    setAriaAnnouncement('本次学习时长已保留为待分配')
  }, [])

  const confirmAssignment = useCallback(async (taskId: string, creditedMinutes: number): Promise<void> => {
    if (!api || !assignment) return
    const request: AssignTimerRequest = {
      requestId: globalThis.crypto.randomUUID(),
      sessionId: assignment.session.id,
      taskId,
      creditedMinutes
    }
    const result = await run('assign', () => (
      commitAssignment ? commitAssignment(request) : api.timer.assign(request)
    ))
    if (!result) return
    setAssignment(null)
    setAriaAnnouncement(`已将 ${creditedMinutes} 分钟计入 ${result.session.assignment?.taskTitle ?? '任务'}`)
    await refreshList()
  }, [api, assignment, commitAssignment, refreshList, run])

  const confirmDiscard = useCallback(async (sessionId: string): Promise<void> => {
    if (!api) return
    const result = await run('discard', () => api.timer.discard({
      requestId: globalThis.crypto.randomUUID(),
      sessionId
    }))
    if (!result) return
    setSessions(result)
    setAriaAnnouncement('待分配计时记录已丢弃')
    await refreshList()
  }, [api, refreshList, run])

  const acknowledgeCompletion = useCallback(async (): Promise<void> => {
    const completed = completion
    setCompletion(null)
    setSnapshot((current) => current.completion ? { ...current, completion: undefined } : current)
    if (completed) await openAssignment(completed.sessionId)
  }, [completion, openAssignment])

  const displayElapsedSeconds = useMemo(
    () => enabled ? elapsedAt(snapshot, nowMilliseconds) : 0,
    [enabled, nowMilliseconds, snapshot]
  )
  const visibleSnapshot = enabled ? snapshot : idleSnapshot()
  const displayRemainingSeconds = visibleSnapshot.active?.mode === 'countdown'
    ? Math.max(0, visibleSnapshot.active.targetSeconds - displayElapsedSeconds)
    : null

  return {
    snapshot: visibleSnapshot,
    sessions: enabled ? sessions : emptyList(),
    loading: enabled ? loading : false,
    error: enabled ? (api ? error : '计时服务不可用') : null,
    pendingAction: enabled ? pendingAction : null,
    completion: enabled ? completion : null,
    assignment: enabled ? assignment : null,
    ariaAnnouncement,
    displayElapsedSeconds,
    displayRemainingSeconds,
    startElapsed,
    startCountdown,
    setTaskIntent,
    pause,
    resume,
    end,
    openAssignment,
    deferAssignment,
    confirmAssignment,
    confirmDiscard,
    acknowledgeCompletion,
    refreshList
  }
}
