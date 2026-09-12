// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { millisecondsUntilNextLocalDate, useCurrentLocalDate } from './useCurrentLocalDate'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useCurrentLocalDate', () => {
  it('schedules just beyond the next local midnight', () => {
    const now = new Date(2026, 8, 1, 23, 59, 59, 900)
    expect(millisecondsUntilNextLocalDate(now)).toBe(125)
  })

  it('updates the local date without requiring another render', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 8, 1, 23, 59, 59, 900))
    const { result, unmount } = renderHook(() => useCurrentLocalDate())

    expect(result.current).toBe('2026-09-01')
    act(() => { vi.advanceTimersByTime(125) })
    expect(result.current).toBe('2026-09-02')

    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reconciles a system-date jump when the window regains focus without duplicating midnight timers', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 8, 1, 10, 0, 0))
    const { result, unmount } = renderHook(() => useCurrentLocalDate())

    expect(result.current).toBe('2026-09-01')
    expect(vi.getTimerCount()).toBe(1)

    vi.setSystemTime(new Date(2026, 8, 3, 10, 0, 0))
    act(() => { window.dispatchEvent(new Event('focus')) })

    expect(result.current).toBe('2026-09-03')
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('reconciles the date when a visible document resumes', () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 8, 1, 10, 0, 0))
    const { result, unmount } = renderHook(() => useCurrentLocalDate())

    vi.setSystemTime(new Date(2026, 8, 2, 10, 0, 0))
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })

    expect(result.current).toBe('2026-09-02')
    expect(vi.getTimerCount()).toBe(1)
    unmount()
  })
})
