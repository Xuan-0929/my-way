import { describe, expect, it } from 'vitest'
import type { DailyTimeSnapshot, TaskTimeSnapshot } from './types'
import type { WeeklyPlan } from './schemas'
import { deriveWeekTimeTotals } from './weekTimeTotals'

const range = { startDate: '2026-08-31', endDate: '2026-09-06' }
const task = (patch: Partial<TaskTimeSnapshot> = {}): TaskTimeSnapshot => ({
  id: 'fitness', title: '力量训练', date: '2026-09-02', originalDate: '2026-09-02', category: 'fitness', plannedMinutes: 150, actualMinutes: 150, status: 'done', ...patch
})
const day = (tasks = [task()], date = '2026-09-02'): DailyTimeSnapshot => ({ date, tasks })
const plan = (...tasks: TaskTimeSnapshot[]): WeeklyPlan => ({
  schemaVersion: 1, week: 1, ...range, tasks: tasks.map((item) => ({ ...item, title: item.id, deliverable: '' }))
})
const totals = (records: DailyTimeSnapshot[], liveDay?: DailyTimeSnapshot, weeklyPlan: WeeklyPlan | null = null) =>
  deriveWeekTimeTotals({ ...range, records, liveDay, plan: weeklyPlan })

describe('weekly time snapshots', () => {
  it('preserves consumed budget when residual time is transferred, including live sources', () => {
    const source = task({ status: 'rescheduled', plannedMinutes: 90, actualMinutes: 60, rescheduledMinutes: 30 })
    const target = task({ id: 'fitness@2026-09-03', sourceTaskId: 'fitness', date: '2026-09-03', plannedMinutes: 30, actualMinutes: 0, status: 'planned' })
    expect(totals([day([source]), day([target], '2026-09-03')], day([source]), plan(source))).toMatchObject({ fitnessPlanned: 90, fitnessActual: 60 })
    expect(totals([day([source])])).toMatchObject({ fitnessPlanned: 60, fitnessActual: 60 })
  })
  it('counts a manual fitness card with or without a weekly plan', () => {
    for (const weeklyPlan of [null, plan()]) {
      expect(totals([], day(), weeklyPlan)).toMatchObject({ studyActual: 0, studyPlanned: 0, fitnessActual: 150, fitnessPlanned: 150 })
    }
  })

  it('replaces a whole day regardless of whether the refreshed file already includes the edit', () => {
    for (const savedMinutes of [0, 50, 150]) {
      expect(totals([day([task({ actualMinutes: savedMinutes })])], day())).toMatchObject({ fitnessActual: 150, fitnessPlanned: 150 })
    }
  })

  it('preserves newer live edits while an older progress query finishes', () => {
    expect(totals([day()], day([task({ actualMinutes: 175 })]))).toMatchObject({ fitnessActual: 175, fitnessPlanned: 150 })
    expect(totals([day([task({ actualMinutes: 175 })])], day([task({ actualMinutes: 175 })]))).toMatchObject({ fitnessActual: 175 })
  })

  it('combines unimported weekly cards and manual cards without duplicating imported cards', () => {
    const imported = task({ sourceTaskId: 'fitness' })
    const manual = task({ id: 'manual', plannedMinutes: 30, actualMinutes: 20 })
    const upcoming = task({ id: 'upcoming', date: '2026-09-04', plannedMinutes: 90, actualMinutes: 0, status: 'planned' })
    const study = task({ id: 'study', category: 'exam', plannedMinutes: 120, actualMinutes: 0, status: 'planned' })
    expect(totals([day([imported, manual])], undefined, plan(imported, upcoming, study))).toMatchObject({
      fitnessPlanned: 270, fitnessActual: 170, studyPlanned: 120, studyActual: 0
    })
  })

  it('uses the daily card duration and category when its weekly source differs', () => {
    const weeklyTask = task({ category: 'exam', plannedMinutes: 90 })
    expect(totals([day([task({ sourceTaskId: 'fitness' })])], undefined, plan(weeklyTask))).toMatchObject({
      studyPlanned: 0, studyActual: 0, fitnessPlanned: 150, fitnessActual: 150
    })
  })

  it('retains contributions from other days when the live day is replaced', () => {
    const previous = day([task({ id: 'previous', date: '2026-09-01', plannedMinutes: 60, actualMinutes: 50 })], '2026-09-01')
    expect(totals([previous, day([task({ actualMinutes: 0 })])], day())).toMatchObject({ fitnessActual: 200, fitnessPlanned: 210 })
  })

  it('does not resurrect an imported task removed from the live day', () => {
    expect(totals([day([task({ sourceTaskId: 'fitness' })])], day([]), plan(task()))).toMatchObject({
      fitnessActual: 0, fitnessPlanned: 0, plannedTasks: []
    })
  })

  it('counts rescheduled task time segments but only the target planned duration', () => {
    const source = task({ date: '2026-09-01', status: 'rescheduled', actualMinutes: 30 })
    const target = task({ id: 'fitness@2026-09-02', sourceTaskId: 'fitness', actualMinutes: 120 })
    const result = totals([day([source], '2026-09-01'), day([target])], undefined, plan(source))
    expect(result).toMatchObject({ fitnessActual: 150, fitnessPlanned: 150 })
    expect(result.plannedTasks).toHaveLength(1)
  })

  it('keeps actual time but removes planned time for a task carried out of the week', () => {
    const source = task({ status: 'rescheduled', actualMinutes: 30 })
    expect(totals([day([source])], undefined, plan(source))).toMatchObject({ fitnessActual: 30, fitnessPlanned: 0 })
  })

  it('does not mistake a previous-week carryover for a new weekly card with the same ID', () => {
    const carried = { ...task({ id: 'fitness@2026-09-02', sourceTaskId: 'fitness' }), originalDate: '2026-08-30' }
    expect(totals([day([carried])], undefined, plan(task()))).toMatchObject({ fitnessActual: 150, fitnessPlanned: 300 })
  })

  it('ignores records and live overrides outside the requested week', () => {
    const outside = day([task({ date: '2026-09-07', actualMinutes: 999 })], '2026-09-07')
    expect(totals([day(), outside], outside)).toMatchObject({ fitnessActual: 150, fitnessPlanned: 150 })
  })

  it('does not mutate persisted records or weekly plans', () => {
    const records = [day()]
    const weeklyPlan = plan(task())
    const before = JSON.stringify({ records, weeklyPlan })
    totals(records, day([task({ actualMinutes: 175, category: 'exam' })]), weeklyPlan)
    expect(JSON.stringify({ records, weeklyPlan })).toBe(before)
  })
})
