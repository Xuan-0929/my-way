import type { DailyTask } from './schemas'

type ProgressInput = Pick<DailyTask, 'status' | 'plannedMinutes' | 'actualMinutes'>
export type TaskProgressState = DailyTask['status'] | 'met'

// Persisted terminal states are deliberate choices. All other states are
// derived on read so correcting minutes never leaves a stale manual 'done'.
export const effectiveTaskState = (task: ProgressInput): TaskProgressState => {
  if (task.status === 'done' || task.status === 'skipped' || task.status === 'rescheduled') return task.status
  if (task.plannedMinutes > 0 && task.actualMinutes >= task.plannedMinutes) return 'met'
  return task.actualMinutes > 0 ? 'in_progress' : 'planned'
}

export const isTaskComplete = (task: ProgressInput): boolean => {
  const state = effectiveTaskState(task)
  return state === 'met' || state === 'done'
}

export const isTaskPending = (task: ProgressInput): boolean => {
  const state = effectiveTaskState(task)
  return state === 'planned' || state === 'in_progress'
}

export const plannedContribution = (task: Pick<DailyTask, 'status' | 'plannedMinutes' | 'rescheduledMinutes'>): number =>
  task.status === 'rescheduled'
    ? Math.max(0, task.plannedMinutes - (task.rescheduledMinutes ?? task.plannedMinutes))
    : task.plannedMinutes
