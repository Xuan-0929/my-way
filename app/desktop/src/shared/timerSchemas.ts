import { z } from 'zod'

const TIMER_SCHEMA_VERSION = 1 as const

const isoDateTimeSchema = z.string().datetime()
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期必须使用 YYYY-MM-DD').refine((value) => {
  const date = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value
}, '日期无效')
const identifierSchema = z.string().trim().min(1).max(100)
const countdownSecondsSchema = z.number().int().min(60).max(10_800)

export const timerSessionIdSchema = z.string().trim().min(1).max(100)
export const timerRequestIdSchema = z.string().trim().min(1).max(100)
export const assignmentOptionsSessionIdSchema = timerSessionIdSchema

export const timerModeSchema = z.enum(['elapsed', 'countdown'])
export const timerStatusSchema = z.enum(['idle', 'running', 'paused'])
export const timerPauseReasonSchema = z.enum([
  'user',
  'app_close',
  'system_suspend',
  'recovered_after_interruption'
])

export const timerTaskIntentSchema = z.object({
  date: isoDateSchema,
  taskId: identifierSchema,
  taskTitle: z.string().trim().min(1).max(300)
}).strict()

export const setTimerTaskIntentRequestSchema = z.object({
  sessionId: timerSessionIdSchema,
  taskIntent: timerTaskIntentSchema.nullable()
}).strict()

const activeTimerCommonShape = {
  id: timerSessionIdSchema,
  createdAt: isoDateTimeSchema,
  accumulatedSeconds: z.number().int().min(0),
  updatedAt: isoDateTimeSchema,
  taskIntent: timerTaskIntentSchema.optional()
}

const elapsedModeShape = {
  mode: z.literal('elapsed'),
  targetSeconds: z.never().optional()
}

const countdownModeShape = {
  mode: z.literal('countdown'),
  targetSeconds: countdownSecondsSchema
}

const runningTimerShape = {
  status: z.literal('running'),
  segmentStartedAt: isoDateTimeSchema,
  pauseReason: z.never().optional()
}

const pausedTimerShape = {
  status: z.literal('paused'),
  segmentStartedAt: z.never().optional(),
  pauseReason: timerPauseReasonSchema
}

const activeTimerShapeSchema = z.union([
  z.object({ ...activeTimerCommonShape, ...elapsedModeShape, ...runningTimerShape }).strict(),
  z.object({ ...activeTimerCommonShape, ...elapsedModeShape, ...pausedTimerShape }).strict(),
  z.object({ ...activeTimerCommonShape, ...countdownModeShape, ...runningTimerShape }).strict(),
  z.object({ ...activeTimerCommonShape, ...countdownModeShape, ...pausedTimerShape }).strict()
])

const activeTimerInputSchema = z.object({
  ...activeTimerCommonShape,
  mode: timerModeSchema,
  status: z.enum(['running', 'paused']),
  segmentStartedAt: isoDateTimeSchema.optional(),
  targetSeconds: countdownSecondsSchema.optional(),
  pauseReason: timerPauseReasonSchema.optional()
}).strict().superRefine((timer, context) => {
  if (timer.mode === 'countdown' && timer.targetSeconds === undefined) {
    context.addIssue({ code: 'custom', path: ['targetSeconds'], message: '倒计时必须设置目标秒数' })
  }
  if (timer.mode === 'elapsed' && timer.targetSeconds !== undefined) {
    context.addIssue({ code: 'custom', path: ['targetSeconds'], message: '自由计时不能设置目标秒数' })
  }
  if (timer.status === 'running' && timer.segmentStartedAt === undefined) {
    context.addIssue({ code: 'custom', path: ['segmentStartedAt'], message: '运行中的计时器必须有分段开始时间' })
  }
  if (timer.status === 'running' && timer.pauseReason !== undefined) {
    context.addIssue({ code: 'custom', path: ['pauseReason'], message: '运行中的计时器不能包含暂停原因' })
  }
  if (timer.status === 'paused' && timer.segmentStartedAt !== undefined) {
    context.addIssue({ code: 'custom', path: ['segmentStartedAt'], message: '暂停的计时器不能包含分段开始时间' })
  }
  if (timer.status === 'paused' && timer.pauseReason === undefined) {
    context.addIssue({ code: 'custom', path: ['pauseReason'], message: '暂停的计时器必须包含暂停原因' })
  }
})

export const activeTimerSchema = activeTimerInputSchema
  .transform((timer) => activeTimerShapeSchema.parse(timer))
  .superRefine((timer, context) => {
    const createdAt = Date.parse(timer.createdAt)
    const updatedAt = Date.parse(timer.updatedAt)
    if (updatedAt < createdAt) {
      context.addIssue({ code: 'custom', path: ['updatedAt'], message: '更新时间不能早于创建时间' })
    }
    if (timer.status === 'running') {
      const segmentStartedAt = Date.parse(timer.segmentStartedAt)
      if (segmentStartedAt < createdAt) {
        context.addIssue({ code: 'custom', path: ['segmentStartedAt'], message: '分段开始时间不能早于创建时间' })
      }
      if (segmentStartedAt > updatedAt) {
        context.addIssue({ code: 'custom', path: ['segmentStartedAt'], message: '分段开始时间不能晚于更新时间' })
      }
    }
  })

export const timerStateFileSchema = z.object({
  schemaVersion: z.literal(TIMER_SCHEMA_VERSION),
  active: activeTimerSchema.nullable(),
  updatedAt: isoDateTimeSchema
}).strict()

export const timerAssignmentSchema = z.object({
  taskId: identifierSchema,
  taskTitle: z.string().trim().min(1).max(300),
  creditedMinutes: z.number().int().min(1).max(1440),
  assignedAt: isoDateTimeSchema
}).strict()

const timerSessionCommonShape = {
  id: timerSessionIdSchema,
  startedAt: isoDateTimeSchema,
  endedAt: isoDateTimeSchema,
  durationSeconds: z.number().int().min(0),
  taskIntent: timerTaskIntentSchema.optional()
}

const pendingSessionShape = {
  status: z.literal('pending'),
  assignment: z.never().optional()
}

const assignedSessionShape = {
  status: z.literal('assigned'),
  assignment: timerAssignmentSchema
}

const timerSessionShapeSchema = z.union([
  z.object({ ...timerSessionCommonShape, ...elapsedModeShape, ...pendingSessionShape }).strict(),
  z.object({ ...timerSessionCommonShape, ...elapsedModeShape, ...assignedSessionShape }).strict(),
  z.object({ ...timerSessionCommonShape, ...countdownModeShape, ...pendingSessionShape }).strict(),
  z.object({ ...timerSessionCommonShape, ...countdownModeShape, ...assignedSessionShape }).strict()
])

const timerSessionInputSchema = z.object({
  ...timerSessionCommonShape,
  mode: timerModeSchema,
  targetSeconds: countdownSecondsSchema.optional(),
  status: z.enum(['pending', 'assigned']),
  assignment: timerAssignmentSchema.optional()
}).strict().superRefine((session, context) => {
  if (session.mode === 'countdown' && session.targetSeconds === undefined) {
    context.addIssue({ code: 'custom', path: ['targetSeconds'], message: '倒计时会话必须设置目标秒数' })
  }
  if (session.mode === 'elapsed' && session.targetSeconds !== undefined) {
    context.addIssue({ code: 'custom', path: ['targetSeconds'], message: '自由计时会话不能设置目标秒数' })
  }
  if (session.status === 'assigned' && session.assignment === undefined) {
    context.addIssue({ code: 'custom', path: ['assignment'], message: '已分配会话必须包含分配信息' })
  }
  if (session.status === 'pending' && session.assignment !== undefined) {
    context.addIssue({ code: 'custom', path: ['assignment'], message: '待分配会话不能包含分配信息' })
  }
})

export const timerSessionSchema = timerSessionInputSchema
  .transform((session) => timerSessionShapeSchema.parse(session))
  .superRefine((session, context) => {
    const startedAt = Date.parse(session.startedAt)
    const endedAt = Date.parse(session.endedAt)
    if (endedAt < startedAt) {
      context.addIssue({ code: 'custom', path: ['endedAt'], message: '结束时间不能早于开始时间' })
    } else {
      const wallClockSeconds = Math.floor((endedAt - startedAt) / 1000)
      if (session.durationSeconds > wallClockSeconds) {
        context.addIssue({ code: 'custom', path: ['durationSeconds'], message: '计时时长不能超过会话的自然时间跨度' })
      }
    }
  })

export const timerLedgerFileSchema = z.object({
  schemaVersion: z.literal(TIMER_SCHEMA_VERSION),
  date: isoDateSchema,
  sessions: z.array(timerSessionSchema),
  updatedAt: isoDateTimeSchema
}).strict().superRefine((ledger, context) => {
  const seen = new Set<string>()
  for (const [index, session] of ledger.sessions.entries()) {
    if (seen.has(session.id)) {
      context.addIssue({
        code: 'custom',
        path: ['sessions', index, 'id'],
        message: `计时会话 ID 重复：${session.id}`
      })
    }
    seen.add(session.id)
  }
})

export const startTimerRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    sessionId: timerSessionIdSchema,
    mode: z.literal('elapsed'),
    countdownMinutes: z.never().optional(),
    taskIntent: timerTaskIntentSchema.optional()
  }).strict(),
  z.object({
    sessionId: timerSessionIdSchema,
    mode: z.literal('countdown'),
    countdownMinutes: z.number().int().min(1).max(180),
    taskIntent: timerTaskIntentSchema.optional()
  }).strict()
])

export const timerListRequestSchema = z.object({
  date: isoDateSchema
}).strict()

export const assignTimerRequestSchema = z.object({
  requestId: timerRequestIdSchema,
  sessionId: timerSessionIdSchema,
  taskId: identifierSchema,
  creditedMinutes: z.number().int().min(1).max(1440)
}).strict()

export const discardTimerRequestSchema = z.object({
  requestId: timerRequestIdSchema,
  sessionId: timerSessionIdSchema
}).strict()
