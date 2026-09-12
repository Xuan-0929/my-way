import type { z } from 'zod'
import type {
  activeTimerSchema,
  assignTimerRequestSchema,
  discardTimerRequestSchema,
  setTimerTaskIntentRequestSchema,
  startTimerRequestSchema,
  timerAssignmentSchema,
  timerLedgerFileSchema,
  timerListRequestSchema,
  timerModeSchema,
  timerPauseReasonSchema,
  timerSessionSchema,
  timerStateFileSchema,
  timerStatusSchema,
  timerTaskIntentSchema
} from './timerSchemas'
import type { ParsedDailyRecord, VersionedFile } from './types'

export type TimerMode = z.infer<typeof timerModeSchema>
export type TimerStatus = z.infer<typeof timerStatusSchema>
export type TimerPauseReason = z.infer<typeof timerPauseReasonSchema>
export type TimerTaskIntent = z.infer<typeof timerTaskIntentSchema>
export type ActiveTimer = z.infer<typeof activeTimerSchema>
export type TimerStateFile = z.infer<typeof timerStateFileSchema>
export type TimerAssignment = z.infer<typeof timerAssignmentSchema>
export type TimerSession = z.infer<typeof timerSessionSchema>
export type TimerLedgerFile = z.infer<typeof timerLedgerFileSchema>
export type StartTimerRequest = z.infer<typeof startTimerRequestSchema>
export type SetTimerTaskIntentRequest = z.infer<typeof setTimerTaskIntentRequestSchema>
export type TimerListRequest = z.infer<typeof timerListRequestSchema>
export type AssignTimerRequest = z.infer<typeof assignTimerRequestSchema>
export type DiscardTimerRequest = z.infer<typeof discardTimerRequestSchema>

export interface TimerSnapshot {
  active: ActiveTimer | null
  capturedAt: string
  readOnlyError?: { message: string; path?: string }
  completion?: { sessionId: string; endedAt: string }
}

export interface EndedTimerResult {
  session: TimerSession
  proposedMinutes: number
}

export interface TimerListResult {
  today: TimerSession[]
  pending: TimerSession[]
}

export interface TimerAssignmentOptions {
  session: TimerSession
  date: string
  tasks: Array<{ id: string; title: string; actualMinutes: number }>
}

export interface AssignTimerResult {
  session: TimerSession
  day: VersionedFile<ParsedDailyRecord>
}

export type TimerSubscriptionListener = (snapshot: TimerSnapshot) => void
