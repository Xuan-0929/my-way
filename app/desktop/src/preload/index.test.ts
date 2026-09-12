import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcChannels, lifecycleEvents, timerEvents, windowEvents, type DesktopApi, type SaveWeekRequest } from '../shared/api'
import type { TimerSnapshot } from '../shared/timerTypes'

const electronMocks = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn<(key: string, api: unknown) => void>(),
  invoke: vi.fn<(...args: unknown[]) => Promise<unknown>>().mockResolvedValue({ ok: true, value: undefined }),
  on: vi.fn<(channel: string, listener: (...args: unknown[]) => void) => void>(),
  removeListener: vi.fn<(channel: string, listener: (...args: unknown[]) => void) => void>(),
  send: vi.fn<(...args: unknown[]) => void>()
}))

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: electronMocks.exposeInMainWorld
  },
  ipcRenderer: {
    invoke: electronMocks.invoke,
    on: electronMocks.on,
    removeListener: electronMocks.removeListener,
    send: electronMocks.send
  }
}))

let api: DesktopApi

beforeAll(async () => {
  await import('./index')
  expect(electronMocks.exposeInMainWorld).toHaveBeenCalledTimes(1)
  expect(electronMocks.exposeInMainWorld.mock.calls[0]?.[0]).toBe('myWay')
  api = electronMocks.exposeInMainWorld.mock.calls[0]?.[1] as DesktopApi
})

beforeEach(() => {
  electronMocks.invoke.mockClear()
  electronMocks.on.mockClear()
  electronMocks.removeListener.mockClear()
  electronMocks.send.mockClear()
})

describe('preload fullscreen API', () => {
  it('exposes only fullscreen state and an explicit exit action', async () => {
    await api.window.getFullScreen()
    await api.window.exitFullScreen()
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(1, ipcChannels.windowGetFullScreen)
    expect(electronMocks.invoke).toHaveBeenNthCalledWith(2, ipcChannels.windowExitFullScreen)
    const listener = vi.fn()
    const unsubscribe = api.window.onFullScreenChanged(listener)
    const wrapper = electronMocks.on.mock.calls[0]?.[1]
    expect(electronMocks.on).toHaveBeenCalledWith(windowEvents.fullScreenChanged, expect.any(Function))
    wrapper?.({ sender: 'electron' }, true)
    expect(listener).toHaveBeenCalledWith(true)
    unsubscribe()
    expect(electronMocks.removeListener).toHaveBeenCalledWith(windowEvents.fullScreenChanged, wrapper)
  })
})

describe('preload timer API', () => {
  const startRequest = { sessionId: 'timer-1', mode: 'countdown', countdownMinutes: 25 } as const
  const listRequest = { date: '2026-08-17' }
  const assignRequest = {
    requestId: 'request-1',
    sessionId: 'timer-1',
    taskId: 'nlp-01',
    creditedMinutes: 25
  }
  const discardRequest = { requestId: 'request-2', sessionId: 'timer-1' }

  it.each([
    ['get', () => api.timer.get(), ipcChannels.timerGet, []],
    ['start', () => api.timer.start(startRequest), ipcChannels.timerStart, [startRequest]],
    ['setTaskIntent', () => api.timer.setTaskIntent({ sessionId: 'timer-1', taskIntent: null }), ipcChannels.timerSetTaskIntent, [{ sessionId: 'timer-1', taskIntent: null }]],
    ['pause', () => api.timer.pause(), ipcChannels.timerPause, []],
    ['resume', () => api.timer.resume(), ipcChannels.timerResume, []],
    ['end', () => api.timer.end(), ipcChannels.timerEnd, []],
    ['list', () => api.timer.list(listRequest), ipcChannels.timerList, [listRequest]],
    [
      'assignmentOptions',
      () => api.timer.assignmentOptions('timer-1'),
      ipcChannels.timerAssignmentOptions,
      ['timer-1']
    ],
    ['assign', () => api.timer.assign(assignRequest), ipcChannels.timerAssign, [assignRequest]],
    ['discard', () => api.timer.discard(discardRequest), ipcChannels.timerDiscard, [discardRequest]]
  ] as const)('maps timer.%s to its exact invoke channel and arguments', async (_name, invokeMethod, channel, args) => {
    await invokeMethod()

    expect(electronMocks.invoke).toHaveBeenCalledTimes(1)
    expect(electronMocks.invoke).toHaveBeenCalledWith(channel, ...args)
  })

  it('forwards only snapshots and removes the exact subscription wrapper', () => {
    const listener = vi.fn()
    const snapshot: TimerSnapshot = {
      active: null,
      capturedAt: '2026-08-17T00:00:00.000Z'
    }

    const unsubscribe = api.timer.subscribe(listener)

    expect(electronMocks.on).toHaveBeenCalledTimes(1)
    expect(electronMocks.on).toHaveBeenCalledWith(timerEvents.changed, expect.any(Function))
    const wrapper = electronMocks.on.mock.calls[0]?.[1]
    expect(wrapper).toBeTypeOf('function')

    wrapper?.({ sender: 'electron' }, snapshot)
    expect(listener).toHaveBeenCalledTimes(1)
    expect(listener).toHaveBeenCalledWith(snapshot)

    unsubscribe()
    expect(electronMocks.removeListener).toHaveBeenCalledTimes(1)
    expect(electronMocks.removeListener).toHaveBeenCalledWith(timerEvents.changed, wrapper)
  })
})

describe('preload close lifecycle API', () => {
  it('uses exact controlled event channels and removes the subscription wrapper', () => {
    const listener = vi.fn()
    const unsubscribe = api.lifecycle.onBeforeClose(listener)

    expect(electronMocks.on).toHaveBeenCalledWith(lifecycleEvents.beforeClose, expect.any(Function))
    const wrapper = electronMocks.on.mock.calls[0]?.[1]
    wrapper?.()
    expect(listener).toHaveBeenCalledOnce()

    api.lifecycle.readyToClose()
    api.lifecycle.cancelClose()
    expect(electronMocks.send).toHaveBeenNthCalledWith(1, lifecycleEvents.readyToClose)
    expect(electronMocks.send).toHaveBeenNthCalledWith(2, lifecycleEvents.cancelClose)

    unsubscribe()
    expect(electronMocks.removeListener).toHaveBeenCalledWith(lifecycleEvents.beforeClose, wrapper)
  })
})

describe('preload weekly planning API', () => {
  it('maps context and save to exact controlled channels', async () => {
    const request: SaveWeekRequest = {
      expectedRevision: null,
      plan: {
        schemaVersion: 1,
        week: 3,
        startDate: '2026-08-31',
        endDate: '2026-09-06',
        tasks: []
      },
      body: '# 第 3 周\n',
      asConflictCopy: true
    }

    await api.week.context('2026-09-01')
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(ipcChannels.weekContext, '2026-09-01')

    await api.week.save(request)
    expect(electronMocks.invoke).toHaveBeenLastCalledWith(ipcChannels.weekSave, request)
  })
})
