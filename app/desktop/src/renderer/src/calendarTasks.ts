import type { WeeklyPlan } from '../../shared/schemas'
import type { DailyTimeSnapshot } from '../../shared/types'
import { effectiveTaskState, plannedContribution, type TaskProgressState } from '../../shared/taskProgress'
import { categoryLabels, type StudyTask } from './studyTask'

export interface CalendarTask extends Pick<StudyTask, 'id' | 'date' | 'category' | 'title' | 'planned'> {
  state: TaskProgressState
  key: string
  weekTaskId?: string
  recordDate?: string
}

export const deriveCalendarTasks = ({ plan, records, startDate, endDate }: {
  plan: WeeklyPlan | null
  records: DailyTimeSnapshot[]
  startDate: string
  endDate: string
}): CalendarTask[] => {
  const inRange = (date: string) => startDate <= date && date <= endDate
  const daily = records.flatMap((record) => record.tasks.map((task) => ({
    task, recordDate: record.date, key: JSON.stringify(['day', record.date, task.id])
  })))
  const consumed = new Set<string>()
  const result: CalendarTask[] = []

  for (const planned of plan?.tasks ?? []) {
    // IDs are local to a weekly plan; a previous week's carryover with the
    // same root ID must remain a separate calendar entry.
    const snapshots = daily.filter(({ task }) => inRange(task.originalDate) && (task.sourceTaskId ?? task.id) === planned.id)
    for (const item of snapshots) {
      if (item.task.id === planned.id) consumed.add(item.key)
    }
    // A carryover replaces its source, including when the destination falls
    // outside this calendar week. Never resurrect the old weekly card.
    if (snapshots.some(({ task }) => task.status === 'rescheduled' || task.id !== planned.id)) continue
    const snapshot = snapshots.find(({ task }) => task.date === planned.date) ?? snapshots.at(-1)
    const recorded = snapshot?.task
    result.push({
      key: JSON.stringify(['week', startDate, planned.id]),
      id: planned.id,
      weekTaskId: planned.id,
      ...(snapshot ? { recordDate: snapshot.recordDate } : {}),
      // Weekly drag edits only the schedule, not historical daily records.
      date: planned.date,
      category: categoryLabels[recorded?.category ?? planned.category],
      title: recorded?.title ?? planned.title,
      planned: recorded?.plannedMinutes ?? planned.plannedMinutes,
      state: recorded ? effectiveTaskState(recorded) : 'planned'
    })
  }
  for (const { task, recordDate, key } of daily) {
    if (task.status === 'rescheduled' ? plannedContribution(task) === 0 : consumed.has(key)) continue
    result.push({
      key, recordDate, id: task.id, date: task.date, category: categoryLabels[task.category],
      title: task.title, planned: plannedContribution(task), state: effectiveTaskState(task)
    })
  }
  return result.filter((task) => inRange(task.date))
}
