import { describe, it, expect } from 'vitest'
import { effectiveTaskState, isTaskComplete, isTaskPending } from './taskProgress'
import { dailyTaskSchema } from './schemas'

describe('automatic progress boundaries', () => {
  it.each([
    ['planned', 30, 0, 'planned'], ['in_progress', 30, 0, 'planned'],
    ['planned', 30, 1, 'in_progress'], ['planned', 30, 30, 'met'],
    ['planned', 30, 33, 'met'], ['planned', 60, 33, 'in_progress'],
    ['done', 30, 0, 'done'], ['skipped', 30, 33, 'skipped'],
    ['rescheduled', 30, 33, 'rescheduled'], ['planned', 0, 0, 'planned']
  ] as const)('%s %i/%i derives %s', (status, plannedMinutes, actualMinutes, expected) => {
    const task = { status, plannedMinutes, actualMinutes }
    expect(effectiveTaskState(task)).toBe(expected)
    expect(isTaskComplete(task)).toBe(expected === 'met' || expected === 'done')
    expect(isTaskPending(task)).toBe(expected === 'planned' || expected === 'in_progress')
  })
  it('retains optional transfer metadata through schema parsing', () => {
    const parsed = dailyTaskSchema.parse({ id: 'x', title: 'x', date: '2026-09-07', originalDate: '2026-09-07', category: 'nlp', plannedMinutes: 90, actualMinutes: 60, status: 'rescheduled', rescheduledMinutes: 30, deliverable: '', evidence: [] })
    expect(parsed.rescheduledMinutes).toBe(30)
  })
})
