import { dailyTaskSchema, type DailyTask, type TaskCategory, type WeeklyTask } from '../../shared/schemas'
import type { DesktopApi, Result } from '../../shared/api'
import type { ParsedDailyRecord, VersionedFile } from '../../shared/types'

export interface TaskDraft {
  title: string
  category: TaskCategory
  date: string
  plannedMinutes: string
  deliverable: string
  notes: string
}

export const newTaskDraft = (date: string, source?: WeeklyTask & { notes?: string }): TaskDraft => ({
  title: source?.title ?? '',
  category: source?.category ?? 'nlp',
  date,
  plannedMinutes: String(source?.plannedMinutes ?? 30),
  deliverable: source?.deliverable ?? '',
  notes: source?.notes ?? ''
})

const taskFields = (draft: TaskDraft, id: string) => ({
  ...draft, id, originalDate: draft.date, plannedMinutes: Number(draft.plannedMinutes),
  actualMinutes: 0, status: 'planned' as const, evidence: [], outcomes: ''
})

export const buildDailyTask = (draft: TaskDraft, id: string): DailyTask => dailyTaskSchema.parse(taskFields(draft, id))

export function taskDraftErrors(draft: TaskDraft): Partial<Record<keyof TaskDraft, string>> {
  const parsed = dailyTaskSchema.safeParse(taskFields(draft, 'draft'))
  if (parsed.success) return {}
  return Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]))
}

/** Re-read on each explicit attempt; never replace the target day's unrelated tasks or notes. */
export async function persistNewTask(day: DesktopApi['day'], task: DailyTask): Promise<Result<VersionedFile<ParsedDailyRecord>>> {
  const opened = await day.create(task.date)
  if (!opened.ok) return opened
  const file = opened.value.file
  if (file.value.date !== task.date) return { ok: false, error: { code: 'VALIDATION', message: '目标记录日期不一致' } }
  const existing = file.value.tasks.find((item) => item.id === task.id)
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(task)) return { ok: true, value: file }
    return { ok: false, error: { code: 'CONFLICT', message: '该副本已存在且内容不同，请取消并检查目标日期。' } }
  }
  return day.save({ ...file, value: { ...file.value, tasks: [...file.value.tasks, task] } })
}
