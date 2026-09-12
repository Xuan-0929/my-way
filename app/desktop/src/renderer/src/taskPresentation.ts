import type { TimerTaskIntent } from '../../shared/timerTypes'
import { studyTaskProgress, type StudyTask } from './studyTask'
import { plannedContribution } from '../../shared/taskProgress'

export const timerTaskChoices = (tasks: StudyTask[], today: string): StudyTask[] =>
  tasks.filter(task => task.date === today && task.title.trim().length > 0)

export const taskTimeTotals = (tasks: StudyTask[]) => tasks.reduce((total, task) => {
  if (task.category === '健身') {
    total.fitnessPlanned += plannedContribution({ status: task.state, plannedMinutes: task.planned, rescheduledMinutes: task.rescheduledMinutes })
    total.fitnessActual += task.actual
  } else {
    total.studyPlanned += plannedContribution({ status: task.state, plannedMinutes: task.planned, rescheduledMinutes: task.rescheduledMinutes })
    total.studyActual += task.actual
  }
  return total
}, { studyPlanned: 0, studyActual: 0, fitnessPlanned: 0, fitnessActual: 0 })

export const focusedTaskId = (tasks: StudyTask[], date: string, intent: TimerTaskIntent | null): string | null => {
  if (intent?.date === date && tasks.some(task => task.id === intent.taskId)) return intent.taskId
  return tasks.find(task => studyTaskProgress(task) === 'in_progress')?.id
    ?? tasks.find(task => studyTaskProgress(task) === 'planned')?.id
    ?? null
}
