import { describe, expect, it } from 'vitest'
import type { WeekPlanningContext } from '../../shared/api'
import type { WeeklyPlan } from '../../shared/schemas'
import type { PreviousTaskOutcome } from '../../shared/weekPlanning'
import { copyPreviousTask, newWeekDraft, validateWeekDraft, weekBudget } from './weekDraft'

const summary = {
  plannedMinutes: 0,
  actualMinutes: 0,
  fitnessPlannedMinutes: 0,
  fitnessActualMinutes: 0,
  completedTasks: 0,
  totalTasks: 0,
  completionRate: 0,
  evidenceCount: 0,
  byCategory: { exam: 0, nlp: 0, english: 0, japanese: 0, fitness: 0 },
  pastExams: [],
  timeRecords: [],
  taskOutcomes: [],
  reflections: []
}

const previousPlan: WeeklyPlan = {
  schemaVersion: 1,
  week: 1,
  startDate: '2026-08-17',
  endDate: '2026-08-23',
  tasks: [{
    id: 'nlp-baseline',
    date: '2026-08-19',
    category: 'nlp',
    title: '完成 NLP 基线',
    plannedMinutes: 120,
    deliverable: 'evidence/nlp-baseline.md'
  }]
}

const context: WeekPlanningContext = {
  date: '2026-09-01',
  startDate: '2026-08-31',
  endDate: '2026-09-06',
  suggestedWeek: 3,
  current: null,
  previous: {
    document: { path: '00-dashboard/weeks/week-01.md', revision: 'a'.repeat(64), value: { plan: previousPlan, body: '# W1' } },
    tasks: [{ task: previousPlan.tasks[0], state: 'planned', actualMinutes: 30, evidenceCount: 1 }],
    summary
  },
  summary
}

describe('week draft helpers', () => {
  it('creates a versioned draft for the exact natural week with a useful Chinese body', () => {
    const draft = newWeekDraft(context)

    expect(draft.plan).toEqual({
      schemaVersion: 1,
      week: 3,
      startDate: '2026-08-31',
      endDate: '2026-09-06',
      tasks: []
    })
    expect(draft.body).toContain('# 第 3 周')
    expect(draft.body).toContain('本周目标')
    expect(draft.body).toContain('必须产物')
    expect(draft.body).toContain('删减顺序')
    expect(draft.body).toContain('周日复盘')
  })

  it('copies an explicit previous task to the same weekday with a unique target-week ID', () => {
    const candidate: PreviousTaskOutcome = context.previous!.tasks[0]
    const once = copyPreviousTask(newWeekDraft(context), candidate)
    const twice = copyPreviousTask(once, candidate)

    expect(once.plan.tasks[0]).toMatchObject({
      id: expect.stringContaining('w03'),
      date: '2026-09-02',
      category: 'nlp',
      title: '完成 NLP 基线',
      plannedMinutes: 120,
      deliverable: 'evidence/nlp-baseline.md'
    })
    expect(new Set(twice.plan.tasks.map((task) => task.id)).size).toBe(2)
  })

  it('derives study and fitness totals directly from five task categories', () => {
    const plan: WeeklyPlan = {
      ...newWeekDraft(context).plan,
      tasks: [
        { ...previousPlan.tasks[0], id: 'exam', date: '2026-08-31', category: 'exam', plannedMinutes: 600 },
        { ...previousPlan.tasks[0], id: 'nlp', date: '2026-09-01', category: 'nlp', plannedMinutes: 240 },
        { ...previousPlan.tasks[0], id: 'english', date: '2026-09-02', category: 'english', plannedMinutes: 150 },
        { ...previousPlan.tasks[0], id: 'japanese', date: '2026-09-03', category: 'japanese', plannedMinutes: 60 },
        { ...previousPlan.tasks[0], id: 'fitness', date: '2026-09-04', category: 'fitness', plannedMinutes: 90 }
      ]
    }

    expect(weekBudget(plan)).toEqual({
      studyTotal: 1050,
      fitnessTotal: 90,
      byCategory: { exam: 600, nlp: 240, english: 150, japanese: 60, fitness: 90 }
    })
  })

  it('returns field-specific validation errors for unsafe drafts', () => {
    const base = newWeekDraft(context)
    const task = { ...previousPlan.tasks[0], date: '2026-08-31' }

    expect(validateWeekDraft({ ...base, plan: { ...base.plan, tasks: [{ ...task, title: '' }] } })).toMatchObject({
      'tasks.0.title': '任务标题不能为空'
    })
    expect(validateWeekDraft({ ...base, plan: { ...base.plan, tasks: [{ ...task, plannedMinutes: 0 }] } })).toMatchObject({
      'tasks.0.plannedMinutes': '计划分钟必须大于 0'
    })
    expect(validateWeekDraft({ ...base, plan: { ...base.plan, tasks: [{ ...task, plannedMinutes: 30.5 }] } })).toMatchObject({
      'tasks.0.plannedMinutes': '计划分钟必须为整数'
    })
    expect(validateWeekDraft({ ...base, plan: { ...base.plan, tasks: [{ ...task, plannedMinutes: 721 }] } })).toMatchObject({
      'tasks.0.plannedMinutes': '单项计划不能超过 720 分钟'
    })
    expect(validateWeekDraft({ ...base, plan: { ...base.plan, tasks: [task, task] } })).toMatchObject({
      'tasks.1.id': `任务 ID 重复：${task.id}`
    })
    expect(validateWeekDraft({ ...base, plan: { ...base.plan, tasks: [{ ...task, date: '2026-09-07' }] } })).toMatchObject({
      'tasks.0.date': '任务日期不在本周范围内'
    })
    expect(validateWeekDraft({ ...base, plan: { ...base.plan, tasks: [
      { ...task, id: 'too-much-a', plannedMinutes: 720 },
      { ...task, id: 'too-much-b', plannedMinutes: 720 }
    ] } })).not.toHaveProperty('tasks')
  })
})
