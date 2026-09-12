import type { DailyRecordData, DailyTask, PastExam, TaskCategory, WeeklyPlan } from './schemas'

export interface ParsedDailyRecord extends DailyRecordData {
  notes: string
}

export interface VersionedFile<T> {
  path: string
  revision: string
  value: T
}

export interface WeekPlanDiff {
  addedTaskIds: string[]
  changedTaskIds: string[]
  removedTaskIds: string[]
}

export type TaskTimeSnapshot = Pick<DailyTask, 'id' | 'title' | 'sourceTaskId' | 'originalDate' | 'date' | 'category' | 'plannedMinutes' | 'actualMinutes' | 'status' | 'rescheduledMinutes'>

export interface DailyTimeSnapshot {
  date: string
  tasks: TaskTimeSnapshot[]
}

export interface ProgressSummary {
  timeRecords: DailyTimeSnapshot[]
  plannedMinutes: number
  actualMinutes: number
  fitnessPlannedMinutes: number
  fitnessActualMinutes: number
  completedTasks: number
  totalTasks: number
  completionRate: number
  evidenceCount: number
  byCategory: Record<TaskCategory, number>
  pastExams: PastExam[]
  taskOutcomes: Array<{
    date: string
    taskId: string
    title: string
    category: TaskCategory
    outcomes: string
  }>
  reflections: Array<{
    date: string
    learned: string
    blockers: string
    tomorrow: string
  }>
}

export interface MonthlyProgressCell {
  date: string
  plannedMinutes: number
  actualMinutes: number
  completionRate: number
}

export interface RouteDocument {
  id: 'twelve-week' | 'long-term' | 'current-status'
  title: string
  path: string
  content: string
}

export type { DailyRecordData, WeeklyPlan }
