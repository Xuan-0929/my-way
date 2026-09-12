import { getISODay, parseISO } from 'date-fns'
import type { DesktopApi, Result, SaveWeekRequest, WeekDocument } from '../../shared/api'
import { weeklyPlanSchema } from '../../shared/schemas'

export const buildCalendarMove = (document: WeekDocument, taskId: string, targetDate: string): SaveWeekRequest => {
  const { plan, body } = document.value
  const sourceTask = plan.tasks.find((task) => task.id === taskId)
  if (!sourceTask) throw new Error('找不到要移动的任务')
  if (sourceTask.date === targetDate) throw new Error('任务已在目标日期')
  if (targetDate < plan.startDate || targetDate > plan.endDate) throw new Error('目标日期不在本周范围内')
  if (getISODay(parseISO(targetDate)) === 7) throw new Error('周日为休息日')

  const movedPlan = weeklyPlanSchema.parse({
    ...plan,
    tasks: plan.tasks.map((task) => task.id === taskId ? { ...task, date: targetDate } : task)
  })
  return { expectedRevision: document.revision, plan: movedPlan, body }
}

export const persistCalendarMove = (
  week: Pick<DesktopApi['week'], 'save'>,
  document: WeekDocument,
  taskId: string,
  targetDate: string
): Promise<Result<WeekDocument>> => week.save(buildCalendarMove(document, taskId, targetDate))

export const persistLatestCalendarMove = async (
  week: Pick<DesktopApi['week'], 'load' | 'save'>,
  referenceDate: string,
  taskId: string,
  targetDate: string
): Promise<Result<WeekDocument>> => {
  try {
    const latest = await week.load(referenceDate)
    if (!latest.ok) return latest
    if (!latest.value) return { ok: false, error: { code: 'NOT_FOUND', message: '当前周计划已不存在' } }
    return await persistCalendarMove(week, latest.value, taskId, targetDate)
  } catch (error) {
    return {
      ok: false,
      error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) }
    }
  }
}
