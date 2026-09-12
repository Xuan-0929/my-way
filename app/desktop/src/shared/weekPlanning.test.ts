import { describe, expect, it } from 'vitest'
import type { DailyTask, WeeklyPlan, WeeklyTask } from './schemas'
import type { ParsedDailyRecord } from './types'
import {
  derivePreviousTaskOutcomes,
  deriveRouteStage,
  naturalWeekRange,
  suggestWeekNumber
} from './weekPlanning'

const weeklyTask = (id: string, date = '2026-08-17'): WeeklyTask => ({
  id,
  date,
  category: 'exam',
  title: id,
  plannedMinutes: 60,
  deliverable: `notes/${id}.md`
})

const dailyTask = (id: string, status: DailyTask['status'], patch: Partial<DailyTask> = {}): DailyTask => ({
  ...weeklyTask(id),
  originalDate: '2026-08-17',
  actualMinutes: 0,
  status,
  evidence: [],
  notes: '',
  outcomes: '',
  ...patch
})

const record = (date: string, tasks: DailyTask[]): ParsedDailyRecord => ({
  schemaVersion: 1,
  date,
  sourceWeek: 1,
  tasks,
  reflection: { learned: '', blockers: '', tomorrow: '' },
  pastExams: [],
  updatedAt: `${date}T08:00:00.000Z`,
  notes: ''
})

describe('natural week planning context', () => {
  it('uses local Monday-to-Sunday ranges across month and year boundaries', () => {
    expect(naturalWeekRange('2026-09-01')).toEqual({ startDate: '2026-08-31', endDate: '2026-09-06' })
    expect(naturalWeekRange('2027-01-01')).toEqual({ startDate: '2026-12-28', endDate: '2027-01-03' })
  })

  it('derives the route-relative week from the earliest plan anchor', () => {
    expect(suggestWeekNumber([{ week: 1, startDate: '2026-08-17' }], '2026-08-31')).toBe(3)
    expect(suggestWeekNumber([
      { week: 3, startDate: '2026-08-31' },
      { week: 1, startDate: '2026-08-17' }
    ], '2026-09-07')).toBe(4)
    expect(() => suggestWeekNumber([{ week: 53, startDate: '2026-08-17' }], '2026-08-31')).toThrow(/1.*53/)
  })

  it('falls back to week one when the workspace has no anchor', () => {
    expect(suggestWeekNumber([], '2026-08-31')).toBe(1)
  })
})

describe('previous task outcomes', () => {
  const plan: WeeklyPlan = {
    schemaVersion: 1,
    week: 1,
    startDate: '2026-08-17',
    endDate: '2026-08-23',
    tasks: ['done', 'active', 'skipped', 'moved', 'never-opened'].map((id) => weeklyTask(id))
  }

  it('recognizes time achievement without manual status in the previous week', () => {
    const outcomes = derivePreviousTaskOutcomes(plan, [record('2026-08-17', [dailyTask('active', 'planned', { actualMinutes: 65 })])])
    expect(outcomes.find(({ task }) => task.id === 'active')?.state).toBe('met')
  })

  it('follows source lineage, sums work, and keeps never-opened work explicit', () => {
    const outcomes = derivePreviousTaskOutcomes(plan, [
      record('2026-08-17', [
        dailyTask('done', 'done', { actualMinutes: 45, evidence: ['notes/done.md'] }),
        dailyTask('active', 'in_progress', { actualMinutes: 30 }),
        dailyTask('skipped', 'skipped'),
        dailyTask('moved', 'rescheduled', { actualMinutes: 10 })
      ]),
      record('2026-08-18', [
        dailyTask('moved@2026-08-18', 'planned', {
          date: '2026-08-18',
          sourceTaskId: 'moved',
          actualMinutes: 20,
          evidence: ['notes/moved.md']
        })
      ])
    ])

    expect(outcomes.map(({ task, state }) => [task.id, state])).toEqual([
      ['done', 'done'],
      ['active', 'in_progress'],
      ['skipped', 'skipped'],
      ['moved', 'in_progress'],
      ['never-opened', 'not_started']
    ])
    expect(outcomes.find(({ task }) => task.id === 'moved')).toMatchObject({ actualMinutes: 30, evidenceCount: 1 })
  })

  it('treats any completed lineage snapshot as authoritative', () => {
    const outcome = derivePreviousTaskOutcomes({ ...plan, tasks: [weeklyTask('done')] }, [
      record('2026-08-17', [dailyTask('done', 'in_progress')]),
      record('2026-08-18', [dailyTask('done@2026-08-18', 'done', { sourceTaskId: 'done', date: '2026-08-18' })])
    ])[0]

    expect(outcome.state).toBe('done')
  })
})

describe('route stage derivation', () => {
  it.each([
    [1, '基础校准', 'Week 01 — 03', '01'],
    [4, '核心方法', 'Week 04 — 06', '02'],
    [7, '项目证据', 'Week 07 — 09', '03'],
    [10, '入试连接', 'Week 10 — 12', '04'],
    [13, '长期路线', '自主规划', '→'],
    [null, '等待周计划', '当前自然周', '—']
  ] as const)('maps week %s to an honest current stage', (week, label, range, index) => {
    expect(deriveRouteStage(week)).toMatchObject({ label, range, index })
  })
})
