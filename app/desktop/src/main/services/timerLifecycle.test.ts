import { describe, expect, it, vi } from 'vitest'
import type { TimerSnapshot } from '../../shared/timerTypes'
import { TimerLifecycle } from './timerLifecycle'

const idle: TimerSnapshot = { active: null, capturedAt: '2026-08-20T00:00:00.000Z' }

describe('TimerLifecycle', () => {
  it('awaits app-close pause before asking the renderer to flush and shares duplicate preparation', async () => {
    const order: string[] = []
    let finishPause: (() => void) | undefined
    const pauseFor = vi.fn(() => new Promise<TimerSnapshot>((resolve) => {
      finishPause = () => { order.push('paused'); resolve(idle) }
    }))
    const requestRendererFlush = vi.fn(() => { order.push('flush') })
    const lifecycle = new TimerLifecycle({
      getTimer: async () => ({ pauseFor }),
      requestRendererFlush,
      permitClose: vi.fn(),
      publishError: vi.fn()
    })

    const first = lifecycle.prepareClose()
    const second = lifecycle.prepareClose()
    expect(second).toBe(first)
    expect(requestRendererFlush).not.toHaveBeenCalled()
    await Promise.resolve()
    finishPause?.()
    await first

    const whileAwaitingRenderer = lifecycle.prepareClose()

    expect(pauseFor).toHaveBeenCalledOnce()
    expect(pauseFor).toHaveBeenCalledWith('app_close')
    expect(order).toEqual(['paused', 'flush'])
    expect(whileAwaitingRenderer).toBe(first)
  })

  it('keeps the window open and publishes an error when timer pause fails', async () => {
    const error = new Error('timer pause failed')
    const requestRendererFlush = vi.fn()
    const permitClose = vi.fn()
    const publishError = vi.fn()
    const lifecycle = new TimerLifecycle({
      getTimer: async () => ({ pauseFor: vi.fn(async () => { throw error }) }),
      requestRendererFlush,
      permitClose,
      publishError
    })

    await expect(lifecycle.prepareClose()).rejects.toThrow('timer pause failed')

    expect(requestRendererFlush).not.toHaveBeenCalled()
    expect(permitClose).not.toHaveBeenCalled()
    expect(publishError).toHaveBeenCalledWith(error)
  })

  it('keeps the window open and the timer paused until renderer saving succeeds', async () => {
    const pauseFor = vi.fn(async () => idle)
    const permitClose = vi.fn()
    const lifecycle = new TimerLifecycle({
      getTimer: async () => ({ pauseFor }),
      requestRendererFlush: vi.fn(),
      permitClose,
      publishError: vi.fn()
    })

    await lifecycle.prepareClose()
    expect(pauseFor).toHaveBeenCalledWith('app_close')
    expect(permitClose).not.toHaveBeenCalled()

    lifecycle.cancelClosePreparation()
    expect(permitClose).not.toHaveBeenCalled()

    await lifecycle.prepareClose()
    expect(pauseFor).toHaveBeenCalledTimes(2)
  })

  it('permits close only after the renderer confirms its save', async () => {
    const permitClose = vi.fn()
    const lifecycle = new TimerLifecycle({
      getTimer: async () => ({ pauseFor: vi.fn(async () => idle) }),
      requestRendererFlush: vi.fn(),
      permitClose,
      publishError: vi.fn()
    })
    await lifecycle.prepareClose()

    lifecycle.rendererReadyToClose()
    lifecycle.rendererReadyToClose()

    expect(permitClose).toHaveBeenCalledOnce()
  })

  it('pauses for system suspend and never calls resume on wake', async () => {
    const pauseFor = vi.fn(async () => idle)
    const resume = vi.fn()
    const lifecycle = new TimerLifecycle({
      getTimer: async () => ({ pauseFor, resume }),
      requestRendererFlush: vi.fn(),
      permitClose: vi.fn(),
      publishError: vi.fn()
    })

    await lifecycle.handleSuspend()
    lifecycle.handleResume()

    expect(pauseFor).toHaveBeenCalledWith('system_suspend')
    expect(resume).not.toHaveBeenCalled()
  })

  it('accepts countdown-at-zero completion from pauseFor instead of forcing a paused state', async () => {
    const completed: TimerSnapshot = {
      active: null,
      capturedAt: '2026-08-20T00:25:00.000Z',
      completion: { sessionId: 'due', endedAt: '2026-08-20T00:25:00.000Z' }
    }
    const pauseFor = vi.fn(async () => completed)
    const lifecycle = new TimerLifecycle({
      getTimer: async () => ({ pauseFor }),
      requestRendererFlush: vi.fn(),
      permitClose: vi.fn(),
      publishError: vi.fn()
    })

    await lifecycle.prepareClose()

    expect(await pauseFor.mock.results[0].value).toEqual(completed)
  })
})
