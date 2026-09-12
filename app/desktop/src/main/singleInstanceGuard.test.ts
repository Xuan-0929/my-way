import { describe, expect, it, vi } from 'vitest'
import { installSingleInstanceGuard, type FocusableWindow, type SingleInstanceApplication } from './singleInstanceGuard'

const windowDouble = (options: { minimized?: boolean, destroyed?: boolean } = {}): FocusableWindow => ({
  isDestroyed: vi.fn(() => options.destroyed ?? false),
  isMinimized: vi.fn(() => options.minimized ?? false),
  restore: vi.fn(),
  show: vi.fn(),
  focus: vi.fn()
})

const applicationDouble = (options: { ownsLock?: boolean, ready?: boolean, whenReady?: Promise<void> } = {}) => {
  let secondInstance: (() => void) | undefined
  const target: SingleInstanceApplication = {
    requestSingleInstanceLock: vi.fn(() => options.ownsLock ?? true),
    quit: vi.fn(),
    on: vi.fn((_event, listener) => { secondInstance = listener }),
    isReady: vi.fn(() => options.ready ?? true),
    whenReady: vi.fn(() => options.whenReady ?? Promise.resolve())
  }
  return { target, triggerSecondInstance: () => secondInstance?.() }
}

describe('installSingleInstanceGuard', () => {
  it('quits a secondary process before registering an event listener', () => {
    const { target } = applicationDouble({ ownsLock: false })

    expect(installSingleInstanceGuard(target, { getWindow: () => null, createWindow: vi.fn() })).toBe(false)

    expect(target.quit).toHaveBeenCalledOnce()
    expect(target.on).not.toHaveBeenCalled()
  })

  it('restores, shows, and focuses an existing minimized window', () => {
    const window = windowDouble({ minimized: true })
    const { target, triggerSecondInstance } = applicationDouble()
    const createWindow = vi.fn()
    expect(installSingleInstanceGuard(target, { getWindow: () => window, createWindow })).toBe(true)

    triggerSecondInstance()

    expect(createWindow).not.toHaveBeenCalled()
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it('does not restore a non-minimized window', () => {
    const window = windowDouble()
    const { target, triggerSecondInstance } = applicationDouble()
    installSingleInstanceGuard(target, { getWindow: () => window, createWindow: vi.fn() })

    triggerSecondInstance()

    expect(window.restore).not.toHaveBeenCalled()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it.each([{ destroyed: false }, { destroyed: true }])('creates a usable window when the current window is unavailable: %o', ({ destroyed }) => {
    let window: FocusableWindow | null = destroyed ? windowDouble({ destroyed: true }) : null
    const created = windowDouble()
    const createWindow = vi.fn(() => { window = created })
    const { target, triggerSecondInstance } = applicationDouble()
    installSingleInstanceGuard(target, { getWindow: () => window, createWindow })

    triggerSecondInstance()

    expect(createWindow).toHaveBeenCalledOnce()
    expect(created.show).toHaveBeenCalledOnce()
    expect(created.focus).toHaveBeenCalledOnce()
  })

  it('waits for readiness and coalesces window creation across repeated launches', async () => {
    let resolveReady: (() => void) | undefined
    const ready = new Promise<void>((resolve) => { resolveReady = resolve })
    let window: FocusableWindow | null = null
    const created = windowDouble()
    const createWindow = vi.fn(() => { window = created })
    const { target, triggerSecondInstance } = applicationDouble({ ready: false, whenReady: ready })
    installSingleInstanceGuard(target, { getWindow: () => window, createWindow })

    triggerSecondInstance()
    triggerSecondInstance()
    expect(createWindow).not.toHaveBeenCalled()
    resolveReady?.()
    await ready
    await Promise.resolve()

    expect(createWindow).toHaveBeenCalledOnce()
    expect(created.focus).toHaveBeenCalledTimes(2)
  })
})
