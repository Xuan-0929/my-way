import type { WeeklyPlan, WeeklyTask } from '../../shared/schemas'
import type { ParsedDailyRecord, WeekPlanDiff } from '../../shared/types'

const hasChanged = (planned: WeeklyTask, snapshot: ParsedDailyRecord['tasks'][number]): boolean => (
  planned.date !== snapshot.date ||
  planned.category !== snapshot.category ||
  planned.title !== snapshot.title ||
  planned.plannedMinutes !== snapshot.plannedMinutes ||
  planned.deliverable !== snapshot.deliverable
)

export const diffWeeklyPlan = (plan: WeeklyPlan, record: ParsedDailyRecord): WeekPlanDiff => {
  const dailyPlanTasks = plan.tasks.filter((task) => task.date === record.date)
  const planById = new Map(dailyPlanTasks.map((task) => [task.id, task]))
  const recordBySourceId = new Map(record.tasks.map((task) => [task.sourceTaskId ?? task.id, task]))
  return {
    addedTaskIds: dailyPlanTasks.filter((task) => !recordBySourceId.has(task.id)).map((task) => task.id).sort(),
    changedTaskIds: dailyPlanTasks.filter((task) => {
      const snapshot = recordBySourceId.get(task.id)
      return snapshot ? hasChanged(task, snapshot) : false
    }).map((task) => task.id).sort(),
    removedTaskIds: record.tasks.filter((task) => !planById.has(task.sourceTaskId ?? task.id)).map((task) => task.sourceTaskId ?? task.id).sort()
  }
}

export const importAddedTasks = (plan: WeeklyPlan, record: ParsedDailyRecord, taskIds: string[]): ParsedDailyRecord => {
  const selected = new Set(taskIds)
  const existing = new Set(record.tasks.map((task) => task.sourceTaskId ?? task.id))
  const additions = plan.tasks.filter((task) => selected.has(task.id) && !existing.has(task.id) && task.date === record.date)
  return {
    ...record,
    tasks: [
      ...record.tasks.map((task) => ({ ...task, evidence: [...task.evidence] })),
      ...additions.map((task) => ({ ...task, sourceTaskId: task.id, originalDate: task.date, actualMinutes: 0, status: 'planned' as const, evidence: [], notes: '', outcomes: '' }))
    ],
    reflection: { ...record.reflection },
    pastExams: record.pastExams.map((exam) => ({ ...exam }))
  }
}
