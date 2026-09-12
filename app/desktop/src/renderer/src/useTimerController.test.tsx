// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi, Result } from '../../shared/api'
import type {
  AssignTimerResult,
  EndedTimerResult,
  TimerAssignmentOptions,
  TimerListResult,
  TimerSnapshot
} from '../../shared/timerTypes'
import { useTimerController } from './useTimerController'

const idle: TimerSnapshot = { active: null, capturedAt: '2026-08-20T00:00:00.000Z' }
const running: TimerSnapshot = {
  active: {
    id: 'running',
    mode: 'elapsed',
    status: 'running',
    createdAt: '2026-08-20T00:00:00.000Z',
    segmentStartedAt: '2026-08-20T00:00:00.000Z',
    accumulatedSeconds: 2,
    updatedAt: '2026-08-20T00:00:00.000Z'
  },
  capturedAt: '2026-08-20T00:00:00.000Z'
}
const emptyList: TimerListResult = { today: [], pending: [] }

const ok = <T,>(value: T): Result<T> => ({ ok: true, value })

const timerApi = () => {
  let listener: ((snapshot: TimerSnapshot) => void) | undefined
  const assignment: TimerAssignmentOptions = {
    session: {
      id: 'ended', mode: 'elapsed', status: 'pending',
      startedAt: '2026-08-20T00:00:00.000Z', endedAt: '2026-08-20T00:01:00.000Z', durationSeconds: 60
    },
    date: '2026-08-20',
    tasks: [{ id: 'task-1', title: 'NLP', actualMinutes: 10 }]
  }
  const ended: EndedTimerResult = { session: assignment.session, proposedMinutes: 1 }
  const assigned = {
    session: { ...assignment.session, status: 'assigned', assignment: { taskId: 'task-1', taskTitle: 'NLP', creditedMinutes: 1, assignedAt: '2026-08-20T00:02:00.000Z' } },
    day: { path: '/tmp/day.md', revision: 'r2', value: {} }
  } as unknown as AssignTimerResult
  const timer: DesktopApi['timer'] = {
    get: vi.fn(async () => ok(idle)),
    start: vi.fn(async () => ok(running)),
    setTaskIntent: vi.fn(async () => ok(running)),
    pause: vi.fn(async () => ok({ ...running, active: running.active && { ...running.active, status: 'paused', accumulatedSeconds: 2, pauseReason: 'user', segmentStartedAt: undefined } } as TimerSnapshot)),
    resume: vi.fn(async () => ok(running)),
    end: vi.fn(async () => ok(ended)),
    list: vi.fn(async () => ok(emptyList)),
    assignmentOptions: vi.fn(async () => ok(assignment)),
    assign: vi.fn(async () => ok(assigned)),
    discard: vi.fn(async () => ok(emptyList)),
    subscribe: vi.fn((next) => { listener = next; return vi.fn() })
  }
  return { timer, emit: (snapshot: TimerSnapshot) => listener?.(snapshot), assignment }
}

const desktop = (timer: DesktopApi['timer']): DesktopApi => ({ timer } as unknown as DesktopApi)
const flushEffects = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('useTimerController', () => {
  it('keeps the authoritative intent when retargeting fails', async () => {
    const mock = timerApi()
    vi.mocked(mock.timer.get).mockResolvedValue(ok(running))
    vi.mocked(mock.timer.setTaskIntent).mockResolvedValue({ ok: false, error: { code: 'CONFLICT', message: '外部修改' } })
    const api = desktop(mock.timer)
    const { result } = renderHook(() => useTimerController({ enabled: true, api, date: '2026-08-20' }))
    await flushEffects()
    await act(async () => result.current.setTaskIntent(null))
    expect(mock.timer.setTaskIntent).toHaveBeenCalledWith({ sessionId: 'running', taskIntent: null })
    expect(result.current.snapshot.active).toEqual(running.active)
    expect(result.current.error).toBe('外部修改')
  })

  it('starts a countdown with the selected task intent', async () => {
    const mock = timerApi()
    const api = desktop(mock.timer)
    const { result } = renderHook(() => useTimerController({ enabled: true, api, date: '2026-08-20' }))
    await flushEffects()
    const taskIntent = { date: '2026-08-20', taskId: 'nlp', taskTitle: 'NLP' }
    await act(async () => result.current.startCountdown(25, taskIntent))
    expect(mock.timer.start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'countdown', countdownMinutes: 25, taskIntent }))
  })

  it('serializes same-tick requests and never announces retarget success after completion', async () => {
    const mock = timerApi()
    vi.mocked(mock.timer.get).mockResolvedValue(ok(running))
    const completion = { sessionId: 'running', endedAt: '2026-08-20T00:01:00.000Z' }
    let finish!: (value: Result<TimerSnapshot>) => void
    vi.mocked(mock.timer.setTaskIntent).mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const api = desktop(mock.timer)
    const { result } = renderHook(() => useTimerController({ enabled: true, api, date: '2026-08-20' }))
    await flushEffects()
    await act(async () => {
      const first = result.current.setTaskIntent(null)
      const second = result.current.setTaskIntent(null)
      expect(mock.timer.setTaskIntent).toHaveBeenCalledOnce()
      finish(ok({ ...idle, completion }))
      await Promise.all([first, second])
    })
    expect(result.current.snapshot.active).toBeNull()
    expect(result.current.ariaAnnouncement).toBe('倒计时已结束')
  })
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] })
    vi.setSystemTime(new Date('2026-08-20T00:00:05.000Z'))
    vi.spyOn(globalThis.crypto, 'randomUUID').mockReturnValue('00000000-0000-4000-8000-000000000001')
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('stays idle while disabled, then loads and subscribes exactly once across unrelated rerenders', async () => {
    const mock = timerApi()
    const api = desktop(mock.timer)
    const { result, rerender, unmount } = renderHook(
      ({ enabled, version }) => {
        void version
        return useTimerController({ enabled, api, date: '2026-08-20' })
      },
      { initialProps: { enabled: false, version: 0 } }
    )
    expect(mock.timer.get).not.toHaveBeenCalled()

    rerender({ enabled: true, version: 1 })
    await flushEffects()
    expect(result.current.loading).toBe(false)
    expect(mock.timer.get).toHaveBeenCalledOnce()
    expect(mock.timer.list).toHaveBeenCalledOnce()
    expect(mock.timer.subscribe).toHaveBeenCalledOnce()

    rerender({ enabled: true, version: 2 })
    expect(mock.timer.get).toHaveBeenCalledOnce()
    unmount()
    expect(vi.mocked(mock.timer.subscribe).mock.results[0].value).toHaveBeenCalledOnce()
  })

  it('still loads timer state when event subscription setup fails', async () => {
    const mock = timerApi()
    mock.timer.subscribe = vi.fn(() => { throw new Error('计时订阅桥接不可用') })
    const api = desktop(mock.timer)

    const { result } = renderHook(() => useTimerController({
      enabled: true,
      api,
      date: '2026-08-20'
    }))
    await flushEffects()

    expect(result.current.loading).toBe(false)
    expect(mock.timer.get).toHaveBeenCalledOnce()
    expect(mock.timer.list).toHaveBeenCalledOnce()
    expect(result.current.error).toBe('计时订阅桥接不可用')
  })

  it('derives display time locally and owns an interval only while the latest snapshot is running', async () => {
    const mock = timerApi()
    mock.timer.get = vi.fn(async () => ok(running))
    const api = desktop(mock.timer)
    const { result, rerender, unmount } = renderHook(() => useTimerController({
      enabled: true,
      api,
      date: '2026-08-20'
    }))
    await flushEffects()
    expect(result.current.loading).toBe(false)
    expect(result.current.displayElapsedSeconds).toBe(7)
    expect(vi.getTimerCount()).toBe(1)
    rerender()
    expect(mock.timer.get).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(1)

    act(() => { vi.advanceTimersByTime(2_000) })
    expect(result.current.displayElapsedSeconds).toBe(9)
    expect(mock.timer.get).toHaveBeenCalledOnce()

    act(() => {
      mock.emit({
        ...running,
        active: running.active && {
          ...running.active,
          status: 'paused',
          accumulatedSeconds: 9,
          pauseReason: 'user',
          segmentStartedAt: undefined
        }
      } as TimerSnapshot)
    })
    expect(result.current.displayElapsedSeconds).toBe(9)
    expect(vi.getTimerCount()).toBe(0)
    act(() => { mock.emit(running) })
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('runs all commands, exposes pending state, and refreshes lists after accounting changes', async () => {
    const mock = timerApi()
    let finishPause: ((value: Result<TimerSnapshot>) => void) | undefined
    mock.timer.pause = vi.fn(() => new Promise<Result<TimerSnapshot>>((resolve) => { finishPause = resolve }))
    const commitAssignment = vi.fn(async () => mock.timer.assign({
      requestId: 'unused', sessionId: 'ended', taskId: 'task-1', creditedMinutes: 1
    }))
    const api = desktop(mock.timer)
    const { result } = renderHook(() => useTimerController({
      enabled: true,
      api,
      date: '2026-08-20',
      commitAssignment
    }))
    await flushEffects()
    expect(result.current.loading).toBe(false)

    await act(async () => { await result.current.startCountdown(25) })
    expect(mock.timer.start).toHaveBeenCalledWith(expect.objectContaining({ mode: 'countdown', countdownMinutes: 25 }))
    let pausePromise: Promise<void>
    act(() => { pausePromise = result.current.pause() })
    expect(result.current.pendingAction).toBe('pause')
    await act(async () => { finishPause?.(ok(idle)); await pausePromise! })
    await act(async () => { await result.current.resume() })
    await act(async () => { await result.current.end() })
    expect(result.current.assignment?.session.id).toBe('ended')
    result.current.deferAssignment()
    await act(async () => { await result.current.openAssignment('ended') })
    await act(async () => { await result.current.confirmAssignment('task-1', 1) })
    await act(async () => { await result.current.confirmDiscard('ended') })

    expect(commitAssignment).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'ended', taskId: 'task-1', creditedMinutes: 1
    }))
    expect(mock.timer.discard).toHaveBeenCalledOnce()
    expect(mock.timer.list).toHaveBeenCalledTimes(4)
    expect(result.current.error).toBeNull()
  })

  it('passes an optional task intent only when starting task-focused elapsed time', async () => {
    const mock = timerApi()
    const api = desktop(mock.timer)
    const { result } = renderHook(() => useTimerController({
      enabled: true,
      api,
      date: '2026-08-20'
    }))
    await flushEffects()
    const taskIntent = {
      date: '2026-08-20',
      taskId: 'task-1',
      taskTitle: 'NLP'
    }

    await act(async () => { await result.current.startElapsed(taskIntent) })

    expect(mock.timer.start).toHaveBeenLastCalledWith({
      sessionId: '00000000-0000-4000-8000-000000000001',
      mode: 'elapsed',
      taskIntent
    })
  })

  it('keeps command errors local and opens completion even when Web Audio fails', async () => {
    const mock = timerApi()
    mock.timer.resume = vi.fn(async () => ({
      ok: false as const,
      error: { code: 'READ_ONLY' as const, message: '计时文件冲突' }
    }))
    let audioAttempts = 0
    vi.stubGlobal('AudioContext', class {
      constructor() {
        audioAttempts += 1
        throw new Error('audio unavailable')
      }
    })
    const api = desktop(mock.timer)
    const { result } = renderHook(() => useTimerController({
      enabled: true,
      api,
      date: '2026-08-20'
    }))
    await flushEffects()
    expect(result.current.loading).toBe(false)

    await act(async () => { await result.current.resume() })
    expect(result.current.error).toBe('计时文件冲突')
    act(() => {
      mock.emit({
        active: null,
        capturedAt: '2026-08-20T00:01:00.000Z',
        completion: { sessionId: 'ended', endedAt: '2026-08-20T00:01:00.000Z' }
      })
      mock.emit({
        active: null,
        capturedAt: '2026-08-20T00:01:00.000Z',
        completion: { sessionId: 'ended', endedAt: '2026-08-20T00:01:00.000Z' }
      })
    })
    expect(result.current.completion?.sessionId).toBe('ended')
    expect(audioAttempts).toBe(1)
    await flushEffects()
    expect(mock.timer.list).toHaveBeenCalledTimes(2)

    await act(async () => { await result.current.acknowledgeCompletion() })
    expect(result.current.assignment?.session.id).toBe('ended')
  })

  it('contains rejected refresh calls and reports the failure without rejecting UI actions', async () => {
    const mock = timerApi()
    const api = desktop(mock.timer)
    const { result } = renderHook(() => useTimerController({
      enabled: true,
      api,
      date: '2026-08-20'
    }))
    await flushEffects()
    mock.timer.list = vi.fn(async () => { throw new Error('计时记录暂时不可读') })

    let refreshed: boolean | undefined
    await act(async () => { refreshed = await result.current.refreshList() })

    expect(refreshed).toBe(false)
    expect(result.current.error).toBe('计时记录暂时不可读')
  })

  it('contains rejected follow-up reads after ending a timer', async () => {
    const mock = timerApi()
    const api = desktop(mock.timer)
    const { result } = renderHook(() => useTimerController({
      enabled: true,
      api,
      date: '2026-08-20'
    }))
    await flushEffects()
    mock.timer.get = vi.fn(async () => { throw new Error('结束后状态刷新失败') })

    await expect(act(async () => { await result.current.end() })).resolves.toBeUndefined()

    expect(result.current.error).toBe('结束后状态刷新失败')
    expect(result.current.pendingAction).toBeNull()
  })
})
