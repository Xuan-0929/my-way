import { describe, expect, it } from 'vitest'
import type { ParsedDailyRecord } from '../../shared/types'
import type { DailyTask, WeeklyPlan } from '../../shared/schemas'
import { resolveCarryover } from './carryover'
import { diffWeeklyPlan, importAddedTasks } from './planDiff'
import { deriveMonthlyCells, deriveProgress } from './progress'

const task: DailyTask = {
  id: 'nlp-01',
  date: '2026-08-17',
  originalDate: '2026-08-17',
  category: 'nlp' as const,
  title: '复现注意力',
  plannedMinutes: 120,
  deliverable: 'notebooks/attention.ipynb',
  actualMinutes: 60,
  status: 'in_progress' as const,
  evidence: ['notebooks/attention.ipynb'],
  notes: '',
  outcomes: ''
}

const record = (date: string, tasks = [task]): ParsedDailyRecord => ({
  schemaVersion: 1,
  date,
  sourceWeek: 1,
  tasks,
  reflection: { learned: '', blockers: '', tomorrow: '' },
  pastExams: [],
  updatedAt: '2026-08-17T08:00:00.000Z',
  notes: ''
})

describe('carryover resolution', () => {
  it('moves only residual time, preserving original work and total budget', () => {
    const source = record('2026-08-17', [{ ...task, plannedMinutes: 90, actualMinutes: 60, outcomes: '原日成果' }])
    const result = resolveCarryover(source, record('2026-08-18', []), task.id, { action: 'reschedule', targetDate: '2026-08-18' })
    expect(result.target.tasks[0]).toMatchObject({ plannedMinutes: 30, actualMinutes: 0, outcomes: '', evidence: [] })
    expect(result.source.tasks[0]).toMatchObject({ plannedMinutes: 90, actualMinutes: 60, outcomes: '原日成果', rescheduledMinutes: 30 })
    expect(deriveProgress([result.source, result.target])).toMatchObject({ plannedMinutes: 90, actualMinutes: 60 })
    expect(deriveMonthlyCells([result.source])[0].plannedMinutes).toBe(60)
    expect(source.tasks[0].status).toBe('in_progress')
  })

  it('refuses legacy planned tasks whose recorded time already meets the target', () => {
    const source = record('2026-08-17', [{ ...task, plannedMinutes: 30, actualMinutes: 33, status: 'planned' }])
    expect(() => resolveCarryover(source, record('2026-08-18', []), task.id, { action: 'reschedule', targetDate: '2026-08-18' })).toThrow('已经结束')
  })
  it('reschedules with source lineage and marks the old task', () => {
    const result = resolveCarryover(record('2026-08-17'), record('2026-08-18', []), 'nlp-01', { action: 'reschedule', targetDate: '2026-08-18' })
    expect(result.source.tasks[0].status).toBe('rescheduled')
    expect(result.target.tasks[0]).toMatchObject({
      id: 'nlp-01@2026-08-18', sourceTaskId: 'nlp-01', originalDate: '2026-08-17', date: '2026-08-18', status: 'planned'
    })
  })

  it('skips or keeps overdue without mutating inputs', () => {
    const skipped = resolveCarryover(record('2026-08-17'), record('2026-08-18', []), 'nlp-01', { action: 'skip' })
    const kept = resolveCarryover(record('2026-08-17'), record('2026-08-18', []), 'nlp-01', { action: 'keep_overdue' })
    expect(skipped.source.tasks[0].status).toBe('skipped')
    expect(kept.source.tasks[0].status).toBe('in_progress')
    expect(task.status).toBe('in_progress')
  })
})

describe('weekly plan differences', () => {
  const plan: WeeklyPlan = {
    schemaVersion: 1, week: 1, startDate: '2026-08-17', endDate: '2026-08-23',
    tasks: [
      { id: 'nlp-01', date: '2026-08-17', category: 'nlp', title: '标题已改变', plannedMinutes: 120, deliverable: 'notebooks/attention.ipynb' },
      { id: 'exam-01', date: '2026-08-17', category: 'exam', title: '新增过去问', plannedMinutes: 90, deliverable: 'notes/exam.md' },
      { id: 'tomorrow-01', date: '2026-08-18', category: 'english', title: '明天的任务', plannedMinutes: 60, deliverable: 'notes/tomorrow.md' }
    ]
  }

  it('detects added, changed and removed task IDs', () => {
    const day = record('2026-08-17', [task, { ...task, id: 'removed-01' }])
    expect(diffWeeklyPlan(plan, day)).toEqual({ addedTaskIds: ['exam-01'], changedTaskIds: ['nlp-01'], removedTaskIds: ['removed-01'] })
  })

  it('imports selected additions without modifying snapshots', () => {
    const day = record('2026-08-17')
    const imported = importAddedTasks(plan, day, ['exam-01'])
    expect(imported.tasks).toHaveLength(2)
    expect(imported.tasks[0].title).toBe('复现注意力')
    expect(imported.tasks[1]).toMatchObject({ id: 'exam-01', sourceTaskId: 'exam-01', status: 'planned', actualMinutes: 0 })
  })
})

describe('progress derivation', () => {
  it('counts time-met legacy tasks without persisting a manual completion', () => {
    const source = record('2026-08-17', [{ ...task, plannedMinutes: 30, actualMinutes: 33, status: 'planned' }])
    expect(deriveProgress([source])).toMatchObject({ completedTasks: 1, completionRate: 100 })
    expect(deriveMonthlyCells([source])[0].completionRate).toBe(100)
    expect(source.tasks[0].status).toBe('planned')
  })
  it('returns day contributions from the same records as the totals without copying private notes', () => {
    const day = record('2026-08-17', [{ ...task, sourceTaskId: 'nlp-01', notes: '私密笔记', outcomes: '成果' }])
    expect(deriveProgress([day]).timeRecords).toEqual(
      [{ date: day.date, tasks: [{
        id: task.id, title: task.title, sourceTaskId: task.id, originalDate: task.originalDate, date: task.date, category: task.category,
        plannedMinutes: 120, actualMinutes: 60, status: 'in_progress'
      }] }]
    )
  })

  it('derives time, completion, evidence, allocation and exam scores', () => {
    const first = record('2026-08-17', [{ ...task, status: 'done', actualMinutes: 100, outcomes: 'macro-F1 提升到 0.82' }])
    first.reflection = { learned: '掌握了注意力计算', blockers: '', tomorrow: '补齐推导' }
    first.pastExams = [{ id: 'exam-score-1', date: '2026-08-17', subject: '数学', paper: '2024 数学模拟卷', score: 62, maxScore: 100 }]
    const second = record('2026-08-18', [{ ...task, id: 'english-01', date: '2026-08-18', category: 'english', plannedMinutes: 60, actualMinutes: 45, status: 'in_progress', evidence: ['notes/cet4.md'] }])
    second.reflection = { learned: '', blockers: '长难句速度不稳定', tomorrow: '' }
    const progress = deriveProgress([first, second])
    expect(progress).toMatchObject({ plannedMinutes: 180, actualMinutes: 145, completedTasks: 1, totalTasks: 2, completionRate: 50, evidenceCount: 2 })
    expect(progress.byCategory).toEqual({ exam: 0, nlp: 100, english: 45, japanese: 0, fitness: 0 })
    expect(progress.pastExams[0].score).toBe(62)
    expect(progress.taskOutcomes).toEqual([{
      date: '2026-08-17', taskId: 'nlp-01', title: '复现注意力', category: 'nlp', outcomes: 'macro-F1 提升到 0.82'
    }])
    expect(progress.reflections).toEqual([
      { date: '2026-08-17', learned: '掌握了注意力计算', blockers: '', tomorrow: '补齐推导' },
      { date: '2026-08-18', learned: '', blockers: '长难句速度不稳定', tomorrow: '' }
    ])
  })

  it('creates compact monthly cells for days with records', () => {
    expect(deriveMonthlyCells([record('2026-08-17')])).toEqual([{ date: '2026-08-17', plannedMinutes: 120, actualMinutes: 60, completionRate: 0 }])
  })

  it('keeps fitness time separate from learning totals and monthly learning time', () => {
    const fitnessTask: DailyTask = {
      ...task,
      id: 'fitness-01',
      category: 'fitness' as DailyTask['category'],
      title: '力量训练',
      plannedMinutes: 90,
      actualMinutes: 75,
      evidence: []
    }
    const progress = deriveProgress([record('2026-08-17', [task, fitnessTask])])

    expect(progress).toMatchObject({
      plannedMinutes: 120,
      actualMinutes: 60,
      fitnessPlannedMinutes: 90,
      fitnessActualMinutes: 75
    })
    expect(progress.byCategory).toEqual({ exam: 0, nlp: 60, english: 0, japanese: 0, fitness: 75 })
    expect(deriveMonthlyCells([record('2026-08-17', [task, fitnessTask])])).toEqual([
      { date: '2026-08-17', plannedMinutes: 120, actualMinutes: 60, completionRate: 0 }
    ])
  })

  it('does not double-count the source snapshot of a rescheduled task', () => {
    const source = record('2026-08-17', [{ ...task, status: 'rescheduled' }])
    const target = record('2026-08-18', [{ ...task, id: 'nlp-01@2026-08-18', sourceTaskId: 'nlp-01', date: '2026-08-18', actualMinutes: 0, status: 'planned' }])
    expect(deriveProgress([source, target])).toMatchObject({ plannedMinutes: 120, actualMinutes: 60, totalTasks: 1 })
    expect(deriveMonthlyCells([source, target])).toEqual([
      { date: '2026-08-17', plannedMinutes: 0, actualMinutes: 60, completionRate: 0 },
      { date: '2026-08-18', plannedMinutes: 120, actualMinutes: 0, completionRate: 0 }
    ])
  })
})
