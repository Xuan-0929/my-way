import { z } from 'zod'

export const SCHEMA_VERSION = 1 as const
export const taskCategories = ['exam', 'nlp', 'english', 'japanese', 'fitness'] as const
export const taskStatuses = ['planned', 'in_progress', 'done', 'skipped', 'rescheduled'] as const

export const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须使用 YYYY-MM-DD').refine((value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}, '日期无效')

export const safeRelativePathSchema = z.string().trim().min(1).refine(
  (value) => !value.startsWith('/') && !value.split(/[\\/]/).includes('..'),
  '必须是工作区内的相对路径'
)

export const evidenceInspectRequestSchema = z.array(safeRelativePathSchema).max(200, '一次最多检查 200 个证据路径')
export const fileRevisionSchema = z.string().regex(/^[a-f0-9]{64}$/, '文件修订值无效')
export const workspacePathSchema = z.string().trim().min(1, '工作区路径不能为空').max(4096, '工作区路径过长')

export const weeklyTaskSchema = z.object({
  id: z.string({ error: '任务 ID 必须是文本' }).trim().min(1, '任务 ID 不能为空').max(100, '任务 ID 不能超过 100 个字符'),
  date: isoDateSchema,
  category: z.enum(taskCategories, { error: '任务类别无效' }),
  title: z.string({ error: '任务标题必须是文本' }).trim().min(1, '任务标题不能为空').max(300, '任务标题不能超过 300 个字符'),
  plannedMinutes: z.number({ error: '计划分钟必须是数字' }).int('计划分钟必须为整数').positive('计划分钟必须大于 0').max(720, '单项计划不能超过 720 分钟'),
  deliverable: z.string({ error: '预期产物必须是文本' }).trim().max(500, '预期产物不能超过 500 个字符')
})

export const weeklyPlanSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION, { error: '不支持的周计划格式版本' }),
  week: z.number({ error: '周次必须是数字' }).int('周次必须为整数').min(1, '周次不能小于 1').max(53, '周次不能大于 53'),
  startDate: isoDateSchema,
  endDate: isoDateSchema,
  tasks: z.array(weeklyTaskSchema)
}).superRefine((plan, context) => {
  if (plan.startDate > plan.endDate) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: '结束日期不能早于开始日期' })
  }
  const start = Date.parse(`${plan.startDate}T00:00:00Z`)
  const end = Date.parse(`${plan.endDate}T00:00:00Z`)
  const spansOneWeek = end - start === 6 * 86_400_000
  const startsMonday = new Date(start).getUTCDay() === 1
  const endsSunday = new Date(end).getUTCDay() === 0
  if (!spansOneWeek || !startsMonday || !endsSunday) {
    context.addIssue({ code: 'custom', path: ['startDate'], message: '周计划必须覆盖同一自然周（周一至周日）' })
  }

  const seen = new Set<string>()
  for (const [index, task] of plan.tasks.entries()) {
    if (seen.has(task.id)) {
      context.addIssue({ code: 'custom', path: ['tasks', index, 'id'], message: `任务 ID 重复：${task.id}` })
    }
    seen.add(task.id)
    if (task.date < plan.startDate || task.date > plan.endDate) {
      context.addIssue({ code: 'custom', path: ['tasks', index, 'date'], message: '任务日期不在本周范围内' })
    }
  }
})

export const saveWeekRequestSchema = z.object({
  expectedRevision: fileRevisionSchema.nullable(),
  plan: weeklyPlanSchema,
  body: z.string({ error: '周说明必须是文本' }).max(100_000, '周说明不能超过 100000 个字符'),
  asConflictCopy: z.boolean().optional()
}).strict()

export const dailyTaskSchema = weeklyTaskSchema.extend({
  originalDate: isoDateSchema,
  sourceTaskId: z.string().trim().min(1).max(100).optional(),
  actualMinutes: z.number().int().min(0).max(1440),
  status: z.enum(taskStatuses),
  rescheduledMinutes: z.number().int().min(0).max(1440).optional(),
  evidence: z.array(safeRelativePathSchema),
  notes: z.string().max(50_000).default(''),
  outcomes: z.string().max(50_000).default('')
})

export const reflectionSchema = z.object({
  learned: z.string().max(10000),
  blockers: z.string().max(10000),
  tomorrow: z.string().max(10000)
})

export const pastExamSchema = z.object({
  id: z.string().trim().min(1).max(100),
  date: isoDateSchema,
  subject: z.string().trim().min(1).max(100),
  paper: z.string().trim().min(1).max(300),
  score: z.number().min(0),
  maxScore: z.number().positive()
}).refine((exam) => exam.score <= exam.maxScore, { message: '成绩不能超过满分', path: ['score'] })

export const dailyRecordSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  date: isoDateSchema,
  sourceWeek: z.number().int().min(1).max(53).nullable(),
  tasks: z.array(dailyTaskSchema),
  reflection: reflectionSchema,
  pastExams: z.array(pastExamSchema).default([]),
  updatedAt: z.string().datetime()
}).superRefine((record, context) => {
  const seen = new Set<string>()
  for (const [index, task] of record.tasks.entries()) {
    if (seen.has(task.id)) {
      context.addIssue({ code: 'custom', path: ['tasks', index, 'id'], message: `任务 ID 重复：${task.id}` })
    }
    seen.add(task.id)
  }

  const actualMinutes = record.tasks.reduce((sum, task) => sum + task.actualMinutes, 0)
  if (actualMinutes > 1440) {
    context.addIssue({ code: 'custom', path: ['tasks'], message: '一天的实际学习时间不能超过 1440 分钟' })
  }

  const seenExamIds = new Set<string>()
  for (const [index, exam] of record.pastExams.entries()) {
    if (seenExamIds.has(exam.id)) {
      context.addIssue({ code: 'custom', path: ['pastExams', index, 'id'], message: `过去问记录 ID 重复：${exam.id}` })
    }
    seenExamIds.add(exam.id)
  }
})

export const parsedDailyRecordSchema = dailyRecordSchema.safeExtend({
  notes: z.string({ error: '学习笔记必须是文本' }).max(200_000, '学习笔记不能超过 200000 个字符')
}).strict()

export const versionedDailyRecordSchema = z.object({
  path: z.string().trim().min(1, '每日文件路径不能为空').max(4096, '每日文件路径过长'),
  revision: fileRevisionSchema,
  value: parsedDailyRecordSchema
}).strict()

const taskIdentifierSchema = z.string().trim().min(1, '任务 ID 不能为空').max(100, '任务 ID 不能超过 100 个字符')

export const deleteTaskRequestSchema = z.object({
  day: versionedDailyRecordSchema.pick({ path: true, revision: true }),
  taskId: taskIdentifierSchema
}).strict()

const carryoverChoiceSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('skip') }).strict(),
  z.object({ action: z.literal('keep_overdue') }).strict(),
  z.object({ action: z.literal('reschedule'), targetDate: isoDateSchema }).strict()
])

export const carryoverRequestSchema = z.object({
  source: versionedDailyRecordSchema,
  targetDate: isoDateSchema,
  taskId: taskIdentifierSchema,
  choice: carryoverChoiceSchema
}).strict().superRefine((request, context) => {
  if (request.choice.action === 'reschedule' && request.choice.targetDate !== request.targetDate) {
    context.addIssue({ code: 'custom', path: ['choice', 'targetDate'], message: '顺延目标日期不一致' })
  }
})

export const progressQueryArgumentsSchema = z.tuple([isoDateSchema, isoDateSchema]).superRefine(([dateFrom, dateTo], context) => {
  if (dateFrom > dateTo) {
    context.addIssue({ code: 'custom', path: [1], message: '进度查询的结束日期不能早于开始日期' })
    return
  }
  const spanDays = Math.round((Date.parse(`${dateTo}T00:00:00Z`) - Date.parse(`${dateFrom}T00:00:00Z`)) / 86_400_000)
  if (spanDays > 366) context.addIssue({ code: 'custom', path: [1], message: '单次进度查询不能超过 366 天' })
})

export type WeeklyTask = z.infer<typeof weeklyTaskSchema>
export type WeeklyPlan = z.infer<typeof weeklyPlanSchema>
export type DailyTask = z.infer<typeof dailyTaskSchema>
export type DailyRecordData = z.infer<typeof dailyRecordSchema>
export type TaskCategory = WeeklyTask['category']
export type TaskStatus = DailyTask['status']
export type PastExam = z.infer<typeof pastExamSchema>
