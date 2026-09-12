import type { WeeklyPlan, WeeklyTask } from './schemas'
import type { DailyTimeSnapshot } from './types'
import { plannedContribution } from './taskProgress'

interface WeekTimeInput {
  startDate: string
  endDate: string
  plan: WeeklyPlan | null
  records: DailyTimeSnapshot[]
  liveDay?: DailyTimeSnapshot
}

export const deriveWeekTimeTotals = ({ startDate, endDate, plan, records, liveDay }: WeekTimeInput) => {
  const inRange = (date: string) => startDate <= date && date <= endDate
  const persistedDays = records.filter((record) => inRange(record.date))
  const days = new Map(persistedDays.map((record) => [record.date, record]))
  // Replace the whole viewed day, including deletions and category changes.
  // A refreshed persisted record can never be added to its live copy.
  if (liveDay && inRange(liveDay.date)) days.set(liveDay.date, liveDay)
  const dailyTasks = [...days.values()].flatMap((record) => record.tasks)
  // Include the persisted lineage too: removing a card from a live day must
  // not bring its still-cached weekly source back into the target.
  const materializedIds = new Set([...persistedDays.flatMap((record) => record.tasks), ...dailyTasks]
    .filter((task) => inRange(task.originalDate))
    .map((task) => task.sourceTaskId ?? task.id))
  const plannedTasks: Array<Pick<WeeklyTask, 'id' | 'date' | 'category' | 'plannedMinutes'>> = [
    ...(plan?.tasks ?? []).filter((task) => !materializedIds.has(task.id)),
    ...dailyTasks.filter((task) => task.status !== 'rescheduled' || plannedContribution(task) > 0)
      .map((task) => ({ ...task, plannedMinutes: plannedContribution(task) }))
  ].filter((task) => inRange(task.date))
  return {
    studyActual: dailyTasks.filter((task) => task.category !== 'fitness').reduce((sum, task) => sum + task.actualMinutes, 0),
    fitnessActual: dailyTasks.filter((task) => task.category === 'fitness').reduce((sum, task) => sum + task.actualMinutes, 0),
    studyPlanned: plannedTasks.filter((task) => task.category !== 'fitness').reduce((sum, task) => sum + task.plannedMinutes, 0),
    fitnessPlanned: plannedTasks.filter((task) => task.category === 'fitness').reduce((sum, task) => sum + task.plannedMinutes, 0),
    plannedTasks
  }
}
