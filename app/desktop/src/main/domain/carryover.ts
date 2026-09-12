import type { ParsedDailyRecord } from '../../shared/types'
import { isTaskPending } from '../../shared/taskProgress'

type CarryoverChoice =
  | { action: 'skip' }
  | { action: 'keep_overdue' }
  | { action: 'reschedule'; targetDate: string }

const cloneRecord = (record: ParsedDailyRecord): ParsedDailyRecord => ({
  ...record,
  tasks: record.tasks.map((task) => ({ ...task, evidence: [...task.evidence] })),
  reflection: { ...record.reflection },
  pastExams: record.pastExams.map((exam) => ({ ...exam }))
})

export const resolveCarryover = (
  sourceRecord: ParsedDailyRecord,
  targetRecord: ParsedDailyRecord,
  taskId: string,
  choice: CarryoverChoice
): { source: ParsedDailyRecord; target: ParsedDailyRecord } => {
  const source = cloneRecord(sourceRecord)
  const target = cloneRecord(targetRecord)
  const index = source.tasks.findIndex((task) => task.id === taskId)
  if (index < 0) throw new Error(`找不到待处理任务：${taskId}`)
  const task = source.tasks[index]
  if (!isTaskPending(task)) {
    throw new Error(`任务 ${taskId} 已经结束，不能顺延`)
  }

  if (choice.action === 'keep_overdue') return { source, target }
  if (choice.action === 'skip') {
    source.tasks[index] = { ...task, status: 'skipped' }
    return { source, target }
  }

  if (choice.targetDate !== target.date) throw new Error('顺延日期必须与目标每日记录一致')
  const nextId = `${task.sourceTaskId ?? task.id}@${choice.targetDate}`
  if (target.tasks.some((candidate) => candidate.id === nextId)) throw new Error(`目标日期已有任务：${nextId}`)
  const remainingMinutes = Math.max(0, task.plannedMinutes - task.actualMinutes)
  source.tasks[index] = { ...task, status: 'rescheduled', rescheduledMinutes: remainingMinutes }
  target.tasks.push({
    ...task,
    id: nextId,
    sourceTaskId: task.sourceTaskId ?? task.id,
    date: choice.targetDate,
    actualMinutes: 0,
    plannedMinutes: remainingMinutes,
    rescheduledMinutes: undefined,
    status: 'planned',
    outcomes: '',
    evidence: []
  })
  return { source, target }
}
