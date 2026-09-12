import { differenceInCalendarWeeks, endOfWeek, format, parseISO, startOfWeek } from 'date-fns'
import type { WeeklyPlan, WeeklyTask } from './schemas'
import type { ParsedDailyRecord } from './types'
import { effectiveTaskState } from './taskProgress'

export type PreviousTaskState = 'met' | 'done' | 'in_progress' | 'planned' | 'skipped' | 'rescheduled' | 'not_started'

export interface WeekAnchor {
  week: number
  startDate: string
}

export interface PreviousTaskOutcome {
  task: WeeklyTask
  state: PreviousTaskState
  actualMinutes: number
  evidenceCount: number
}

export interface RouteStage {
  label: string
  title: string
  range: string
  index: string
}

export const naturalWeekRange = (date: string): { startDate: string; endDate: string } => {
  const parsed = parseISO(date)
  return {
    startDate: format(startOfWeek(parsed, { weekStartsOn: 1 }), 'yyyy-MM-dd'),
    endDate: format(endOfWeek(parsed, { weekStartsOn: 1 }), 'yyyy-MM-dd')
  }
}

export const suggestWeekNumber = (anchors: WeekAnchor[], targetStartDate: string): number => {
  if (!anchors.length) return 1
  const anchor = [...anchors].sort((left, right) => left.startDate.localeCompare(right.startDate))[0]
  const week = anchor.week + differenceInCalendarWeeks(parseISO(targetStartDate), parseISO(anchor.startDate), { weekStartsOn: 1 })
  if (!Number.isInteger(week) || week < 1 || week > 53) throw new Error('建议周次必须在 1 到 53 之间')
  return week
}

const statePriority: Record<Exclude<PreviousTaskState, 'not_started'>, number> = {
  rescheduled: 0,
  planned: 1,
  skipped: 2,
  in_progress: 3,
  met: 4,
  done: 4
}

export const derivePreviousTaskOutcomes = (plan: WeeklyPlan, records: ParsedDailyRecord[]): PreviousTaskOutcome[] => (
  plan.tasks.map((task) => {
    const snapshots = records
      .flatMap((record) => record.tasks.map((snapshot) => ({ recordDate: record.date, snapshot })))
      .filter(({ snapshot }) => (snapshot.sourceTaskId ?? snapshot.id) === task.id)
      .sort((left, right) => left.recordDate.localeCompare(right.recordDate) || left.snapshot.date.localeCompare(right.snapshot.date))
    const state = snapshots.reduce<PreviousTaskState>((current, { snapshot }) => {
      const derived = effectiveTaskState(snapshot)
      if (current === 'not_started') return derived
      return statePriority[derived] >= statePriority[current] ? derived : current
    }, 'not_started')
    const evidence = new Set(snapshots.flatMap(({ snapshot }) => snapshot.evidence))
    return {
      task,
      state,
      actualMinutes: snapshots.reduce((sum, { snapshot }) => sum + snapshot.actualMinutes, 0),
      evidenceCount: evidence.size
    }
  })
)

export const deriveRouteStage = (week: number | null): RouteStage => {
  if (week === null) return { label: '等待周计划', title: '建立本周可执行计划', range: '当前自然周', index: '—' }
  if (week <= 3) return { label: '基础校准', title: '数学、Python 与 NLP 基线', range: 'Week 01 — 03', index: '01' }
  if (week <= 6) return { label: '核心方法', title: 'Transformer、实验设计与论文阅读', range: 'Week 04 — 06', index: '02' }
  if (week <= 9) return { label: '项目证据', title: '可复现实验与研究问题', range: 'Week 07 — 09', index: '03' }
  if (week <= 12) return { label: '入试连接', title: '过去问、研究计划与能力门槛', range: 'Week 10 — 12', index: '04' }
  return { label: '长期路线', title: '按个人目标持续学习与复盘', range: '自主规划', index: '→' }
}
