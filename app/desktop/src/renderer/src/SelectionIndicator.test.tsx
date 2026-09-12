// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { afterEach, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { SelectionIndicator } from './SelectionIndicator'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

it('tracks the selected native button without adding a tab stop', () => {
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (this: HTMLElement) { return this.textContent === 'B' ? 100 : 0 })
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(100)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(36)
  const Group = ({ value }: { value: string }) => <div role="group"><SelectionIndicator value={value} />{['A', 'B'].map((label) => <button key={label} aria-pressed={value === label}>{label}</button>)}</div>
  const { rerender, container } = render(<Group value="A" />)
  const indicator = container.querySelector('.selection-indicator')!
  expect(indicator).toHaveStyle({ transform: 'translate(0px, 0px)', width: '100px', height: '36px' })
  rerender(<Group value="B" />)
  expect(indicator).toHaveStyle({ transform: 'translate(100px, 0px)' })
  expect(indicator).toHaveAttribute('aria-hidden', 'true')
  expect(indicator).not.toHaveAttribute('tabindex')
  expect(screen.getAllByRole('button')).toHaveLength(2)
})

it('remeasures a resized group and hides when there is no selection', () => {
  let measure: (() => void) | undefined
  const disconnect = vi.fn()
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { measure = callback } observe() {} disconnect = disconnect })
  const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(80)
  const { container, rerender, unmount } = render(<div><SelectionIndicator value="a" /><button aria-pressed="true">A</button></div>)
  expect(container.querySelector('.selection-indicator')).toHaveStyle({ width: '80px' })
  width.mockReturnValue(120)
  act(() => measure?.())
  expect(container.querySelector('.selection-indicator')).toHaveStyle({ width: '120px' })
  rerender(<div><SelectionIndicator value="none" /><button>A</button></div>)
  expect(container.querySelector('.selection-indicator')).toHaveAttribute('data-ready', 'false')
  unmount()
  expect(disconnect).toHaveBeenCalled()
  vi.unstubAllGlobals()
})
