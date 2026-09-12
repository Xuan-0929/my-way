import { describe, expect, it } from 'vitest'
import { formatChineseDateRange, formatChineseDuration, formatCompactDuration } from './displayFormat'

describe('display formatting', () => {
  it.each([[0, '0分'], [90, '1时30分'], [1200, '20时'], [-1, '0分']] as const)('formats %i compactly for the narrow summary', (minutes, expected) => {
    expect(formatCompactDuration(minutes)).toBe(expected)
  })
  it.each([
    ['2026-09-01', '2026-09-06', '9 月 1 日 — 9 月 6 日'],
    ['2026-08-31', '2026-09-06', '8 月 31 日 — 9 月 6 日'],
    ['2026-12-28', '2027-01-03', '2026 年 12 月 28 日 — 2027 年 1 月 3 日']
  ])('formats %s through %s without dropping month or year context', (start, end, expected) => {
    expect(formatChineseDateRange(start, end)).toBe(expected)
  })

  it.each([
    [0, '0 分钟'],
    [25, '25 分钟'],
    [60, '1 小时'],
    [90, '1 小时 30 分钟'],
    [120, '2 小时']
  ])('formats %i minutes as %s', (minutes, expected) => {
    expect(formatChineseDuration(minutes)).toBe(expected)
  })
})
