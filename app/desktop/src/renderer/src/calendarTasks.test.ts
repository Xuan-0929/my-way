import { describe, expect, it } from 'vitest'
import type { WeeklyPlan } from '../../shared/schemas'
import type { DailyTimeSnapshot, TaskTimeSnapshot } from '../../shared/types'
import { deriveCalendarTasks } from './calendarTasks'

const range = { startDate: '2026-08-31', endDate: '2026-09-06' }
const task = (patch: Partial<TaskTimeSnapshot> = {}): TaskTimeSnapshot => ({
  id: 'japanese', title: 'N1单词', date: '2026-09-03', originalDate: '2026-09-03',
  category: 'japanese', plannedMinutes: 30, actualMinutes: 30, status: 'done', ...patch
})
const day = (tasks = [task()], date = '2026-09-03'): DailyTimeSnapshot => ({ date, tasks })
const plan = (...tasks: TaskTimeSnapshot[]): WeeklyPlan => ({
  schemaVersion: 1, week: 1, ...range, tasks: tasks.map((item) => ({ ...item, deliverable: '' }))
})
const calendar = (records: DailyTimeSnapshot[], weeklyPlan: WeeklyPlan | null = null) => deriveCalendarTasks({ ...range, records, plan: weeklyPlan })

describe('calendar task sources', () => {
  it('derives time achievement for both weekly snapshots and manual legacy tasks', () => {
    const met = task({ status: 'planned', actualMinutes: 33 })
    expect(calendar([day([met])])[0].state).toBe('met')
    expect(calendar([day([met])], plan(met))[0].state).toBe('met')
  })
  it.each([null, plan()])('includes manual and completed tasks without a populated weekly plan', (weeklyPlan) => {
    expect(calendar([day([task(), task({ id: 'grammar', title: 'N1语法' })])], weeklyPlan)).toMatchObject([
      { id: 'japanese', title: 'N1单词', date: '2026-09-03', planned: 30, state: 'done', recordDate: '2026-09-03' },
      { id: 'grammar', title: 'N1语法', date: '2026-09-03', planned: 30, state: 'done', recordDate: '2026-09-03' }
    ])
  })

  it('combines upcoming weekly tasks and edited daily snapshots without duplicate imported cards', () => {
    const upcoming = task({ id: 'upcoming', title: '未来安排', date: '2026-09-04' })
    const recorded = task({ sourceTaskId: 'japanese', title: 'N1单词 · 修订', plannedMinutes: 45, category: 'fitness' })
    const result = calendar([day([recorded, task({ id: 'manual' })])], plan(task(), upcoming))
    expect(result).toHaveLength(3)
    expect(result.find((item) => item.id === 'japanese')).toMatchObject({ title: 'N1单词 · 修订', planned: 45, state: 'done', category: '健身', weekTaskId: 'japanese' })
    expect(result.find((item) => item.id === 'upcoming')).toMatchObject({ title: '未来安排', date: '2026-09-04' })
  })

  it('keeps weekly drag scheduling authoritative without rewriting recorded time', () => {
    const result = calendar([day()], plan(task({ date: '2026-09-04' })))
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({ id: 'japanese', date: '2026-09-04', state: 'done', weekTaskId: 'japanese', recordDate: '2026-09-03' })
  })

  it('shows a carried task once on its target date, not its rescheduled source', () => {
    const source = task({ status: 'rescheduled' })
    const target = task({ id: 'japanese@2026-09-04', sourceTaskId: 'japanese', date: '2026-09-04', status: 'planned' })
    expect(calendar([day([source]), day([target], '2026-09-04')], plan(task()))).toMatchObject([
      { id: target.id, date: '2026-09-04', recordDate: '2026-09-04' }
    ])
    expect(calendar([day([source])], plan(task()))).toEqual([])
  })

  it('retains the consumed source budget for new residual carryovers', () => {
    const source = task({ status: 'rescheduled', plannedMinutes: 90, actualMinutes: 60, rescheduledMinutes: 30 })
    const target = task({ id: 'japanese@2026-09-04', sourceTaskId: 'japanese', date: '2026-09-04', plannedMinutes: 30, actualMinutes: 0, status: 'planned' })
    const result = calendar([day([source]), day([target], '2026-09-04')], plan(task()))
    expect(result).toHaveLength(2)
    expect(result.find((item) => item.id === source.id)).toMatchObject({ state: 'rescheduled', planned: 60, recordDate: '2026-09-03' })
    expect(result.reduce((sum, item) => sum + item.planned, 0)).toBe(90)
  })

  it('does not conflate reused IDs from a different source week', () => {
    const carried = task({ id: 'japanese@2026-09-03', sourceTaskId: 'japanese', originalDate: '2026-08-30' })
    expect(calendar([day([carried])], plan(task()))).toHaveLength(2)
  })

  it('retains distinct daily cards with the same local ID and gives them unique UI keys', () => {
    const result = calendar([day(), day([task({ date: '2026-09-04' })], '2026-09-04')])
    expect(result).toHaveLength(2)
    expect(new Set(result.map((item) => item.key)).size).toBe(2)
  })

  it('keeps calendar-only browsing in range and never mutates the underlying files', () => {
    const records = [day(), day([task({ date: '2026-09-07' })], '2026-09-07')]
    const weeklyPlan = plan()
    const before = JSON.stringify({ records, weeklyPlan })
    expect(calendar(records, weeklyPlan)).toHaveLength(1)
    expect(JSON.stringify({ records, weeklyPlan })).toBe(before)
    expect(calendar([day([])], weeklyPlan)).toEqual([])
  })
})
