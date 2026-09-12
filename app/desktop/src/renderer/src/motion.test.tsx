// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MotionPresence, MotionProvider, useIsPresent, useListMotion, useMotionMode } from './motion'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(() => {
  cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks()
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate
})

function State() { return <output>{useMotionMode()}</output> }
function PresenceState() { return <span>{useIsPresent() ? 'present' : 'exiting'}</span> }

describe('motion policy and presence', () => {
  it('responds to input modality and restores the document on unmount', () => {
    const { unmount } = render(<MotionProvider><State /></MotionProvider>)
    expect(screen.getByText('full')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('instant')).toBeTruthy()
    expect(document.documentElement.dataset.motion).toBe('instant')
    fireEvent.pointerDown(document)
    expect(screen.getByText('full')).toBeTruthy()
    unmount()
    expect(document.documentElement.dataset.motion).toBeUndefined()
  })

  it('uses the system motion preference, including changes during a session', () => {
    let change: (() => void) | undefined
    const preference = { matches: true, addEventListener: (_: string, callback: () => void) => { change = callback }, removeEventListener: vi.fn() }
    vi.stubGlobal('matchMedia', () => preference)
    render(<MotionProvider><State /></MotionProvider>)
    expect(screen.getByText('reduced')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(screen.getByText('instant')).toBeTruthy()
    fireEvent.pointerDown(document)
    expect(screen.getByText('reduced')).toBeTruthy()
    act(() => { preference.matches = false; change?.() })
    expect(screen.getByText('full')).toBeTruthy()
  })

  it('keeps a non-interactive exit frame then removes it', () => {
    vi.useFakeTimers()
    const { rerender, container } = render(<MotionPresence><PresenceState /></MotionPresence>)
    rerender(<MotionPresence>{null}</MotionPresence>)
    expect(screen.getByText('exiting')).toBeTruthy()
    expect(container.querySelector('[data-state="exiting"]')).toHaveAttribute('inert')
    act(() => { vi.advanceTimersByTime(160) })
    expect(container.textContent).toBe('')
  })

  it('cancels a pending exit when reopened, keeping the latest content', () => {
    vi.useFakeTimers()
    const { rerender } = render(<MotionPresence><span>first</span></MotionPresence>)
    rerender(<MotionPresence>{null}</MotionPresence>)
    act(() => { vi.advanceTimersByTime(80) })
    rerender(<MotionPresence><span>second</span></MotionPresence>)
    act(() => { vi.advanceTimersByTime(200) })
    expect(screen.getByText('second')).toBeTruthy()
    expect(screen.queryByText('first')).toBeNull()
  })

  it('does not retain exiting UI for keyboard interaction', () => {
    const { rerender } = render(<MotionProvider><MotionPresence><span>dialog content</span></MotionPresence></MotionProvider>)
    fireEvent.keyDown(document, { key: 'Escape' })
    rerender(<MotionProvider><MotionPresence>{null}</MotionPresence></MotionProvider>)
    expect(screen.queryByText('dialog content')).toBeNull()
  })

  it('releases dialog focus immediately while its visual exit finishes', () => {
    vi.useFakeTimers()
    const trigger = document.createElement('button')
    document.body.append(trigger)
    trigger.focus()
    const dialog = <ConfirmDialog title="确认" description="说明" confirmLabel="执行" onCancel={vi.fn()} onConfirm={vi.fn()} />
    const { rerender } = render(<MotionPresence>{dialog}</MotionPresence>)
    expect(screen.getByRole('button', { name: '取消' })).toHaveFocus()
    rerender(<MotionPresence>{null}</MotionPresence>)
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('dialog')).toBeNull()
    trigger.remove()
  })
})

function List({ ids }: { ids: string[] }) {
  const ref = useListMotion(ids)
  return <div ref={ref}>{ids.map((id) => <div data-motion-id={id} key={id}>{id}</div>)}</div>
}

describe('task list continuity', () => {
  it('moves retained rows from their previous positions and stops on keyboard input', () => {
    vi.spyOn(HTMLElement.prototype, 'offsetTop', 'get').mockImplementation(function (this: HTMLElement) {
      return this.parentElement ? Array.from(this.parentElement.children).indexOf(this) * 40 : 0
    })
    const cancel = vi.fn()
    const animate = vi.fn(() => ({ cancel, onfinish: null }))
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    const { rerender } = render(<MotionProvider><List ids={['a', 'b']} /></MotionProvider>)
    rerender(<MotionProvider><List ids={['b', 'a']} /></MotionProvider>)
    expect(animate.mock.calls).toEqual([
      [[{ transform: 'translate(0px, 40px)' }, { transform: 'translate(0px, 0px)' }], { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }],
      [[{ transform: 'translate(0px, -40px)' }, { transform: 'translate(0px, 0px)' }], { duration: 180, easing: 'cubic-bezier(0.23, 1, 0.32, 1)' }]
    ])
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(cancel).toHaveBeenCalledTimes(2)
    animate.mockClear()
    rerender(<MotionProvider><List ids={['a', 'b']} /></MotionProvider>)
    expect(animate).not.toHaveBeenCalled()
  })

  it('does not move lists when the system requests reduced motion', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }))
    const animate = vi.fn()
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    const { rerender } = render(<MotionProvider><List ids={['a']} /></MotionProvider>)
    rerender(<MotionProvider><List ids={['a', 'b']} /></MotionProvider>)
    expect(animate).not.toHaveBeenCalled()
  })

  it('skips hydration and field edits, animates insertion, and cancels on unmount', () => {
    const cancel = vi.fn()
    const animate = vi.fn(() => ({ cancel, onfinish: null }))
    vi.stubGlobal('Animation', class {})
    Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value: animate })
    const { rerender, unmount } = render(<List ids={['a']} />)
    expect(animate).not.toHaveBeenCalled()
    rerender(<List ids={['a', 'b']} />)
    expect(animate).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ opacity: 0 })]), expect.objectContaining({ duration: 180 }))
    animate.mockClear()
    rerender(<List ids={['a', 'b']} />)
    expect(animate).not.toHaveBeenCalled()
    unmount()
    expect(cancel).toHaveBeenCalled()
    delete (HTMLElement.prototype as Partial<HTMLElement>).animate
  })
})
