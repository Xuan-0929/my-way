import type { ParsedDailyRecord, MonthlyProgressCell, ProgressSummary } from '../../shared/types'
import { isTaskComplete, plannedContribution } from '../../shared/taskProgress'

const emptyCategories = (): ProgressSummary['byCategory'] => ({ exam: 0, nlp: 0, english: 0, japanese: 0, fitness: 0 })

export const deriveProgress = (records: ParsedDailyRecord[]): ProgressSummary => {
  const tasks = records.flatMap((record) => record.tasks)
  const scheduledTasks = tasks.filter((task) => task.status !== 'rescheduled')
  const studyTasks = tasks.filter((task) => task.category !== 'fitness')
  const fitnessTasks = tasks.filter((task) => task.category === 'fitness')
  const byCategory = emptyCategories()
  const evidence = new Set<string>()
  for (const task of tasks) {
    byCategory[task.category] += task.actualMinutes
    task.evidence.forEach((path) => evidence.add(path))
  }
  const completedTasks = scheduledTasks.filter(isTaskComplete).length
  return {
    // Keep per-day contributions and totals in the same snapshot, so the UI
    // can replace a day's contribution without adding saved edits twice.
    timeRecords: records.map((record) => ({
      date: record.date,
      tasks: record.tasks.map(({ id, title, sourceTaskId, originalDate, date, category, plannedMinutes, actualMinutes, status, rescheduledMinutes }) => ({
        id, title, sourceTaskId, originalDate, date, category, plannedMinutes, actualMinutes, status,
        ...(rescheduledMinutes === undefined ? {} : { rescheduledMinutes })
      }))
    })),
    plannedMinutes: studyTasks.reduce((sum, task) => sum + plannedContribution(task), 0),
    actualMinutes: studyTasks.reduce((sum, task) => sum + task.actualMinutes, 0),
    fitnessPlannedMinutes: fitnessTasks.reduce((sum, task) => sum + plannedContribution(task), 0),
    fitnessActualMinutes: fitnessTasks.reduce((sum, task) => sum + task.actualMinutes, 0),
    completedTasks,
    totalTasks: scheduledTasks.length,
    completionRate: scheduledTasks.length ? Math.round((completedTasks / scheduledTasks.length) * 100) : 0,
    evidenceCount: evidence.size,
    byCategory,
    pastExams: records.flatMap((record) => record.pastExams).sort((a, b) => b.date.localeCompare(a.date)),
    taskOutcomes: records.flatMap((record) => record.tasks
      .filter((task) => task.outcomes.trim())
      .map((task) => ({ date: record.date, taskId: task.id, title: task.title, category: task.category, outcomes: task.outcomes })))
      .sort((a, b) => a.date.localeCompare(b.date) || a.title.localeCompare(b.title)),
    reflections: records
      .filter((record) => Object.values(record.reflection).some((value) => value.trim()))
      .map((record) => ({ date: record.date, ...record.reflection }))
      .sort((a, b) => a.date.localeCompare(b.date))
  }
}

export const deriveMonthlyCells = (records: ParsedDailyRecord[]): MonthlyProgressCell[] => records
  .map((record) => {
    const tasks = record.tasks
    const scheduledTasks = tasks.filter((task) => task.status !== 'rescheduled')
    const studyTasks = tasks.filter((task) => task.category !== 'fitness')
    const completed = scheduledTasks.filter(isTaskComplete).length
    return {
      date: record.date,
      plannedMinutes: studyTasks.reduce((sum, task) => sum + plannedContribution(task), 0),
      actualMinutes: studyTasks.reduce((sum, task) => sum + task.actualMinutes, 0),
      completionRate: scheduledTasks.length ? Math.round((completed / scheduledTasks.length) * 100) : 0
    }
  })
  .sort((a, b) => a.date.localeCompare(b.date))
