import { describe, expect, it } from 'vitest'
import {
  carryoverRequestSchema,
  dailyRecordSchema,
  isoDateSchema,
  parsedDailyRecordSchema,
  progressQueryArgumentsSchema,
  saveWeekRequestSchema,
  weeklyPlanSchema
} from './schemas'

const validTask = {
  id: 'nlp-attention-01',
  date: '2026-08-17',
  category: 'nlp',
  title: '复现多头注意力',
  plannedMinutes: 120,
  deliverable: 'notebooks/attention.ipynb'
}

describe('weeklyPlanSchema', () => {
  it('accepts the versioned weekly contract', () => {
    expect(weeklyPlanSchema.parse({
      schemaVersion: 1,
      week: 1,
      startDate: '2026-08-17',
      endDate: '2026-08-23',
      tasks: [validTask]
    }).tasks).toHaveLength(1)
  })

  it.each(['reading', 'math', ''])('rejects unknown category %s', (category) => {
    expect(() => weeklyPlanSchema.parse({
      schemaVersion: 1, week: 1, startDate: '2026-08-17', endDate: '2026-08-23',
      tasks: [{ ...validTask, category }]
    })).toThrow()
  })

  it('rejects unknown schema versions, duplicate IDs and out-of-range dates', () => {
    expect(() => weeklyPlanSchema.parse({ schemaVersion: 2, week: 1, startDate: '2026-08-17', endDate: '2026-08-23', tasks: [] })).toThrow()
    expect(() => weeklyPlanSchema.parse({ schemaVersion: 1, week: 1, startDate: '2026-08-17', endDate: '2026-08-23', tasks: [validTask, validTask] })).toThrow()
    expect(() => weeklyPlanSchema.parse({ schemaVersion: 1, week: 1, startDate: '2026-08-17', endDate: '2026-08-23', tasks: [{ ...validTask, date: '2026-08-24' }] })).toThrow()
  })

  it('requires one complete Monday-to-Sunday natural week', () => {
    expect(() => weeklyPlanSchema.parse({
      schemaVersion: 1, week: 1, startDate: '2026-08-18', endDate: '2026-08-24', tasks: []
    })).toThrow(/同一自然周/)
    expect(() => weeklyPlanSchema.parse({
      schemaVersion: 1, week: 1, startDate: '2026-08-17', endDate: '2026-08-30', tasks: []
    })).toThrow(/同一自然周/)
  })

  it('accepts fitness tasks without changing the schema version', () => {
    const parsed = weeklyPlanSchema.parse({
      schemaVersion: 1, week: 1, startDate: '2026-08-17', endDate: '2026-08-23',
      tasks: [{ ...validTask, category: 'fitness', title: '力量训练' }]
    })

    expect(parsed.tasks[0]?.category).toBe('fitness')
  })

  it('allows the task cards to define a plan above the old 20 hour quota', () => {
    expect(weeklyPlanSchema.parse({
      schemaVersion: 1, week: 1, startDate: '2026-08-17', endDate: '2026-08-23',
      tasks: Array.from({ length: 11 }, (_, index) => ({ ...validTask, id: `task-${index}`, plannedMinutes: 120 }))
    }).tasks).toHaveLength(11)
  })

  it.each([
    [{ ...validTask, title: '' }, '任务标题不能为空'],
    [{ ...validTask, plannedMinutes: 0 }, '计划分钟必须大于 0'],
    [{ ...validTask, plannedMinutes: 30.5 }, '计划分钟必须为整数'],
    [{ ...validTask, plannedMinutes: 721 }, '单项计划不能超过 720 分钟']
  ])('returns a concise Chinese task error for %j', (task, message) => {
    const result = weeklyPlanSchema.safeParse({
      schemaVersion: 1,
      week: 1,
      startDate: '2026-08-17',
      endDate: '2026-08-23',
      tasks: [task]
    })

    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toBe(message)
  })
})

describe('weekly planning IPC schemas', () => {
  it('validates real calendar dates and a strict path-free save request', () => {
    expect(isoDateSchema.parse('2026-09-01')).toBe('2026-09-01')
    expect(() => isoDateSchema.parse('2026-02-30')).toThrow()

    const request = {
      expectedRevision: null,
      plan: {
        schemaVersion: 1,
        week: 3,
        startDate: '2026-08-31',
        endDate: '2026-09-06',
        tasks: []
      },
      body: '# 本周计划\n'
    }
    expect(saveWeekRequestSchema.parse(request)).toEqual(request)
    expect(saveWeekRequestSchema.parse({ ...request, asConflictCopy: true })).toEqual({
      ...request,
      asConflictCopy: true
    })
    expect(() => saveWeekRequestSchema.parse({ ...request, asConflictCopy: 'yes' })).toThrow()
    expect(() => saveWeekRequestSchema.parse({ ...request, path: '/tmp/escape.md' })).toThrow()
    expect(() => saveWeekRequestSchema.parse({ ...request, expectedRevision: 'short' })).toThrow()
  })
})

describe('dailyRecordSchema', () => {
  it('accepts only the five task states', () => {
    const base = {
      schemaVersion: 1,
      date: '2026-08-17',
      sourceWeek: 1,
      tasks: [{ ...validTask, originalDate: validTask.date, actualMinutes: 0, status: 'planned', evidence: [] }],
      reflection: { learned: '', blockers: '', tomorrow: '' },
      updatedAt: '2026-08-17T08:00:00.000Z'
    }
    expect(dailyRecordSchema.parse(base).tasks[0].status).toBe('planned')
    expect(() => dailyRecordSchema.parse({ ...base, tasks: [{ ...base.tasks[0], status: 'cancelled' }] })).toThrow()
  })

  it('defaults missing task Markdown and enforces its size limit', () => {
    const base = {
      schemaVersion: 1,
      date: '2026-08-17',
      sourceWeek: 1,
      tasks: [{ ...validTask, originalDate: validTask.date, actualMinutes: 0, status: 'planned', evidence: [] }],
      reflection: { learned: '', blockers: '', tomorrow: '' },
      updatedAt: '2026-08-17T08:00:00.000Z'
    }
    expect(dailyRecordSchema.parse(base).tasks[0]).toMatchObject({ notes: '', outcomes: '' })
    expect(() => dailyRecordSchema.parse({
      ...base,
      tasks: [{ ...base.tasks[0], notes: 'x'.repeat(50_001) }]
    })).toThrow()
  })

  it('rejects impossible aggregate actual time', () => {
    const base = {
      schemaVersion: 1 as const,
      date: '2026-08-17',
      sourceWeek: 1,
      tasks: [{ ...validTask, originalDate: validTask.date, actualMinutes: 0, status: 'planned' as const, evidence: [] }],
      reflection: { learned: '', blockers: '', tomorrow: '' },
      updatedAt: '2026-08-17T08:00:00.000Z'
    }

    expect(() => dailyRecordSchema.parse({
      ...base,
      tasks: [
        { ...base.tasks[0], id: 'task-a', actualMinutes: 721 },
        { ...base.tasks[0], id: 'task-b', actualMinutes: 720 }
      ]
    })).toThrow(/一天的实际学习时间不能超过 1440 分钟/)
  })

  it('rejects duplicate past-exam identifiers', () => {
    const exam = { id: 'exam-2026-summer', date: '2026-08-17', subject: '数学', paper: '2026 夏', score: 80, maxScore: 100 }
    expect(() => dailyRecordSchema.parse({
      schemaVersion: 1,
      date: '2026-08-17',
      sourceWeek: 1,
      tasks: [],
      reflection: { learned: '', blockers: '', tomorrow: '' },
      pastExams: [exam, exam],
      updatedAt: '2026-08-17T08:00:00.000Z'
    })).toThrow(/过去问记录 ID 重复/)
  })
})

describe('daily IPC schemas', () => {
  const record = {
    schemaVersion: 1 as const,
    date: '2026-08-17',
    sourceWeek: 1,
    tasks: [{ ...validTask, originalDate: validTask.date, actualMinutes: 0, status: 'planned' as const, evidence: [], notes: '', outcomes: '' }],
    reflection: { learned: '', blockers: '', tomorrow: '' },
    pastExams: [],
    updatedAt: '2026-08-17T08:00:00.000Z',
    notes: '# 学习笔记\n'
  }

  it('preserves the Markdown body and rejects unknown record fields', () => {
    expect(parsedDailyRecordSchema.parse(record).notes).toBe('# 学习笔记\n')
    expect(() => parsedDailyRecordSchema.parse({ ...record, injected: true })).toThrow()
  })

  it('requires one coherent reschedule target', () => {
    const source = { path: '/workspace/data/daily/2026/2026-08-17.md', revision: 'a'.repeat(64), value: record }
    expect(carryoverRequestSchema.parse({
      source,
      targetDate: '2026-08-18',
      taskId: validTask.id,
      choice: { action: 'reschedule', targetDate: '2026-08-18' }
    }).targetDate).toBe('2026-08-18')
    expect(() => carryoverRequestSchema.parse({
      source,
      targetDate: '2026-08-18',
      taskId: validTask.id,
      choice: { action: 'reschedule', targetDate: '2026-08-19' }
    })).toThrow(/不一致/)
  })

  it('bounds progress queries to one year and rejects reversed ranges', () => {
    expect(progressQueryArgumentsSchema.parse(['2026-01-01', '2027-01-02'])).toEqual(['2026-01-01', '2027-01-02'])
    expect(() => progressQueryArgumentsSchema.parse(['2026-01-01', '2027-01-03'])).toThrow(/366/)
    expect(() => progressQueryArgumentsSchema.parse(['2026-09-02', '2026-09-01'])).toThrow(/早于/)
  })
})
