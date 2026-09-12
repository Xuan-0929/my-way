import { addDays, differenceInCalendarDays, format, parseISO, startOfWeek } from 'date-fns'
import type { WeekPlanningContext } from '../../shared/api'
import { weeklyPlanSchema, type TaskCategory, type WeeklyPlan, type WeeklyTask } from '../../shared/schemas'
import type { PreviousTaskOutcome } from '../../shared/weekPlanning'

export interface WeekDraft {
  plan: WeeklyPlan
  body: string
}

export interface WeekBudget {
  studyTotal: number
  fitnessTotal: number
  byCategory: Record<TaskCategory, number>
}

export const newWeekDraft = (context: WeekPlanningContext): WeekDraft => ({
  plan: {
    schemaVersion: 1,
    week: context.suggestedWeek,
    startDate: context.startDate,
    endDate: context.endDate,
    tasks: []
  },
  body: [
    `# 第 ${context.suggestedWeek} 周`,
    '',
    `> ${context.startDate} — ${context.endDate}`,
    '',
    '## 本周目标',
    '',
    '- ',
    '',
    '## 必须产物',
    '',
    '- ',
    '',
    '## 删减顺序',
    '',
    '1. ',
    '',
    '## 周日复盘',
    '',
    '- 学习成果：',
    '- 当前难点：',
    '- 下周调整：',
    ''
  ].join('\n')
})

const uniqueTaskId = (draft: WeekDraft, sourceId: string): string => {
  const suffix = `w${String(draft.plan.week).padStart(2, '0')}`
  const normalized = sourceId.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'task'
  const base = `${normalized.slice(0, Math.max(1, 94 - suffix.length))}-${suffix}`
  const used = new Set(draft.plan.tasks.map((task) => task.id))
  if (!used.has(base)) return base
  let index = 2
  while (used.has(`${base}-${index}`)) index += 1
  return `${base.slice(0, 96 - String(index).length)}-${index}`
}

export const copyPreviousTask = (draft: WeekDraft, candidate: PreviousTaskOutcome): WeekDraft => {
  const sourceDate = parseISO(candidate.task.date)
  const sourceMonday = startOfWeek(sourceDate, { weekStartsOn: 1 })
  const weekdayOffset = differenceInCalendarDays(sourceDate, sourceMonday)
  const task: WeeklyTask = {
    ...candidate.task,
    id: uniqueTaskId(draft, candidate.task.id),
    date: format(addDays(parseISO(draft.plan.startDate), weekdayOffset), 'yyyy-MM-dd')
  }
  return { ...draft, plan: { ...draft.plan, tasks: [...draft.plan.tasks, task] } }
}

export const weekBudget = (plan: WeeklyPlan): WeekBudget => {
  const byCategory: WeekBudget['byCategory'] = { exam: 0, nlp: 0, english: 0, japanese: 0, fitness: 0 }
  for (const task of plan.tasks) byCategory[task.category] += task.plannedMinutes
  return {
    studyTotal: byCategory.exam + byCategory.nlp + byCategory.english + byCategory.japanese,
    fitnessTotal: byCategory.fitness,
    byCategory
  }
}

export const validateWeekDraft = (draft: WeekDraft): Record<string, string> => {
  const errors: Record<string, string> = {}
  const result = weeklyPlanSchema.safeParse(draft.plan)
  if (!result.success) {
    for (const issue of result.error.issues) {
      const path = issue.path.join('.') || 'plan'
      errors[path] ??= issue.message
    }
  }
  if (draft.body.length > 100_000) errors.body = '周说明不能超过 100000 个字符'
  return errors
}
