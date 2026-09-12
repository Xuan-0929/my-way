// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { TimerDial } from './TimerDial'

afterEach(cleanup)
describe('TimerDial', () => {
  it('updates a stable digit node and remaining ring without its own clock', () => {
    const { rerender, container } = render(<TimerDial seconds={120} remainingFraction={.5} />)
    const digits = screen.getByLabelText('当前计时')
    expect(digits.textContent).toBe('02:00')
    rerender(<TimerDial seconds={119} remainingFraction={.49} />)
    expect(screen.getByLabelText('当前计时')).toBe(digits)
    expect(container.querySelector('.timer-dial-progress')?.getAttribute('stroke-dasharray')).toBe('49 100')
    expect(container.querySelectorAll('line')).toHaveLength(60)
  })
  it('clamps completed and excessive remaining values, and has no false elapsed progress', () => {
    const { rerender, container } = render(<TimerDial seconds={-1} remainingFraction={-1} />)
    expect(screen.getByLabelText('当前计时').textContent).toBe('00:00')
    expect(container.querySelector('.timer-dial-progress')?.getAttribute('stroke-dasharray')).toBe('0 100')
    rerender(<TimerDial seconds={65} remainingFraction={2} />)
    expect(container.querySelector('.timer-dial-progress')?.getAttribute('stroke-dasharray')).toBe('100 100')
    rerender(<TimerDial seconds={65} remainingFraction={null} />)
    expect(container.querySelector('.timer-dial-progress')).toBeNull()
    expect(screen.getByLabelText('当前计时').textContent).toBe('01:05')
  })
})
