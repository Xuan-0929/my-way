// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { restoreFocusWhenStable } from './focusRestore'

describe('restoreFocusWhenStable', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('waits for the current target and follows it across a render replacement', () => {
    const frames: FrameRequestCallback[] = []
    const cancelled = new Set<number>()
    const schedule = vi.fn((callback: FrameRequestCallback) => {
      frames.push(callback)
      return frames.length
    })
    const cancel = vi.fn((id: number) => cancelled.add(id))
    const onStable = vi.fn()
    const runNextFrame = (): void => {
      const id = frames.findIndex((callback) => Boolean(callback)) + 1
      const callback = frames[id - 1]
      frames[id - 1] = null as unknown as FrameRequestCallback
      if (!cancelled.has(id)) callback(0)
    }

    document.body.innerHTML = '<main class="workspace"></main>'
    const workspace = document.querySelector<HTMLElement>('.workspace')!
    workspace.scrollTop = 0

    restoreFocusWhenStable({
      selector: '[aria-label="返回目标"]',
      scrollTop: 240,
      onStable,
      schedule,
      cancel,
      maxFrames: 6
    })

    runNextFrame()
    expect(onStable).not.toHaveBeenCalled()

    const first = document.createElement('button')
    first.setAttribute('aria-label', '返回目标')
    workspace.append(first)
    runNextFrame()
    expect(document.activeElement).toBe(first)
    expect(workspace.scrollTop).toBe(240)
    expect(onStable).not.toHaveBeenCalled()

    const replacement = document.createElement('button')
    replacement.setAttribute('aria-label', '返回目标')
    first.replaceWith(replacement)
    runNextFrame()
    expect(document.activeElement).toBe(replacement)
    expect(onStable).not.toHaveBeenCalled()

    runNextFrame()
    expect(document.activeElement).toBe(replacement)
    expect(onStable).toHaveBeenCalledTimes(1)
  })

  it('cancels a pending restoration without focusing later content', () => {
    const frames: FrameRequestCallback[] = []
    const cancelled = new Set<number>()
    const schedule = (callback: FrameRequestCallback): number => {
      frames.push(callback)
      return frames.length
    }
    const cancel = (id: number): void => { cancelled.add(id) }
    const onStable = vi.fn()

    const stop = restoreFocusWhenStable({
      selector: '[aria-label="返回目标"]',
      scrollTop: 0,
      onStable,
      schedule,
      cancel
    })
    stop()
    document.body.innerHTML = '<button aria-label="返回目标">目标</button>'
    if (!cancelled.has(1)) frames[0](0)

    expect(document.activeElement).toBe(document.body)
    expect(onStable).not.toHaveBeenCalled()
  })
})
