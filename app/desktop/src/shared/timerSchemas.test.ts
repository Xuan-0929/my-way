import { describe, expect, it } from 'vitest'
import type { ActiveTimer, StartTimerRequest, TimerSession } from './timerTypes'
import {
  activeTimerSchema,
  assignmentOptionsSessionIdSchema,
  assignTimerRequestSchema,
  discardTimerRequestSchema,
  setTimerTaskIntentRequestSchema,
  startTimerRequestSchema,
  timerLedgerFileSchema,
  timerListRequestSchema,
  timerModeSchema,
  timerPauseReasonSchema,
  timerSessionSchema,
  timerStateFileSchema,
  timerStatusSchema,
  timerTaskIntentSchema
} from './timerSchemas'

const activeCountdown = {
  id: 'timer-1',
  mode: 'countdown',
  status: 'running',
  createdAt: '2026-08-17T00:00:00.000Z',
  segmentStartedAt: '2026-08-17T00:00:00.000Z',
  accumulatedSeconds: 0,
  targetSeconds: 1500,
  updatedAt: '2026-08-17T00:00:00.000Z'
} as const

describe('setTimerTaskIntentRequestSchema', () => {
  it('requires an explicit intent or clear and refuses timing fields', () => {
    expect(setTimerTaskIntentRequestSchema.parse({ sessionId: 'timer-1', taskIntent: null }))
      .toEqual({ sessionId: 'timer-1', taskIntent: null })
    for (const request of [
      { sessionId: 'timer-1' }, { sessionId: '', taskIntent: null },
      { sessionId: 'timer-1', taskIntent: null, accumulatedSeconds: 0 },
      { sessionId: 'timer-1', taskIntent: { date: '2026-02-30', taskId: 'a', taskTitle: '任务' } }
    ]) expect(() => setTimerTaskIntentRequestSchema.parse(request)).toThrow()
  })
})

const pendingSession = {
  id: 'timer-1',
  mode: 'countdown',
  startedAt: '2026-08-17T00:00:00.000Z',
  endedAt: '2026-08-17T00:25:00.000Z',
  durationSeconds: 1500,
  targetSeconds: 1500,
  status: 'pending'
} as const

const assignment = {
  taskId: 'nlp-01',
  taskTitle: 'Read the Transformer paper',
  creditedMinutes: 25,
  assignedAt: '2026-08-17T00:25:20.000Z'
} as const

const ledger = {
  schemaVersion: 1,
  date: '2026-08-17',
  sessions: [pendingSession],
  updatedAt: '2026-08-17T00:25:00.000Z'
} as const

describe('activeTimerSchema', () => {
  it('accepts elapsed and countdown active timers', () => {
    expect(activeTimerSchema.parse(activeCountdown)).toEqual(activeCountdown)
    expect(activeTimerSchema.parse({
      ...activeCountdown,
      mode: 'elapsed',
      status: 'paused',
      segmentStartedAt: undefined,
      targetSeconds: undefined,
      pauseReason: 'user'
    }).mode).toBe('elapsed')
  })

  it('requires targetSeconds for countdown timers and rejects it for elapsed timers', () => {
    expect(() => activeTimerSchema.parse({ ...activeCountdown, targetSeconds: undefined })).toThrow()
    expect(() => activeTimerSchema.parse({ ...activeCountdown, mode: 'elapsed' })).toThrow()
  })

  it('requires a segment start for running timers', () => {
    expect(() => activeTimerSchema.parse({ ...activeCountdown, segmentStartedAt: undefined })).toThrow()
  })

  it.each([-1, 0.5])('rejects invalid accumulatedSeconds %s', (accumulatedSeconds) => {
    expect(() => activeTimerSchema.parse({ ...activeCountdown, accumulatedSeconds })).toThrow()
  })

  it.each([59, 10_801])('rejects countdown targetSeconds outside the supported range: %s', (targetSeconds) => {
    expect(() => activeTimerSchema.parse({ ...activeCountdown, targetSeconds })).toThrow()
  })

  it('rejects malformed ISO timestamps', () => {
    expect(() => activeTimerSchema.parse({
      ...activeCountdown,
      createdAt: '2026-08-17 00:00:00'
    })).toThrow()
  })

  it('rejects active timestamps before creation with path-specific issues', () => {
    const updatedBeforeCreation = activeTimerSchema.safeParse({
      ...activeCountdown,
      updatedAt: '2026-08-16T23:59:59.000Z'
    })
    expect(updatedBeforeCreation.success).toBe(false)
    if (!updatedBeforeCreation.success) {
      expect(updatedBeforeCreation.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['updatedAt'] })
      ]))
    }

    const segmentBeforeCreation = activeTimerSchema.safeParse({
      ...activeCountdown,
      segmentStartedAt: '2026-08-16T23:59:59.000Z'
    })
    expect(segmentBeforeCreation.success).toBe(false)
    if (!segmentBeforeCreation.success) {
      expect(segmentBeforeCreation.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['segmentStartedAt'] })
      ]))
    }
  })

  it('rejects running segments after the persisted update time', () => {
    const result = activeTimerSchema.safeParse({
      ...activeCountdown,
      segmentStartedAt: '2026-08-17T00:00:01.000Z'
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['segmentStartedAt'] })
      ]))
    }
  })

  it('enforces paused and running persistence fields', () => {
    const pausedWithSegment = activeTimerSchema.safeParse({
      ...activeCountdown,
      status: 'paused',
      pauseReason: 'user'
    })
    expect(pausedWithSegment.success).toBe(false)
    if (!pausedWithSegment.success) {
      expect(pausedWithSegment.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['segmentStartedAt'] })
      ]))
    }

    const pausedWithoutReason = activeTimerSchema.safeParse({
      ...activeCountdown,
      status: 'paused',
      segmentStartedAt: undefined
    })
    expect(pausedWithoutReason.success).toBe(false)
    if (!pausedWithoutReason.success) {
      expect(pausedWithoutReason.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['pauseReason'] })
      ]))
    }

    const runningWithReason = activeTimerSchema.safeParse({ ...activeCountdown, pauseReason: 'user' })
    expect(runningWithReason.success).toBe(false)
    if (!runningWithReason.success) {
      expect(runningWithReason.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['pauseReason'] })
      ]))
    }
  })
})

describe('timer enums', () => {
  it('rejects unknown modes, statuses, and pause reasons', () => {
    expect(() => timerModeSchema.parse('pomodoro')).toThrow()
    expect(() => timerStatusSchema.parse('stopped')).toThrow()
    expect(() => timerPauseReasonSchema.parse('window_blur')).toThrow()
  })
})

describe('timerTaskIntentSchema', () => {
  const taskIntent = {
    date: '2026-08-17',
    taskId: 'nlp-01',
    taskTitle: 'Read the Transformer paper'
  }

  it('accepts a durable task snapshot and trims its text fields', () => {
    expect(timerTaskIntentSchema.parse({
      date: taskIntent.date,
      taskId: ` ${taskIntent.taskId} `,
      taskTitle: ` ${taskIntent.taskTitle} `
    })).toEqual(taskIntent)
  })

  it.each([
    { ...taskIntent, date: '2026-02-30' },
    { ...taskIntent, taskId: ' ' },
    { ...taskIntent, taskTitle: ' ' },
    { ...taskIntent, taskTitle: 'x'.repeat(301) },
    { ...taskIntent, workspacePath: '/tmp/my-way' }
  ])('rejects an invalid or over-broad task snapshot', (input) => {
    expect(() => timerTaskIntentSchema.parse(input)).toThrow()
  })
})

describe('timer identifiers', () => {
  it.each([' ', 'x'.repeat(101)])('rejects invalid timer session IDs', (id) => {
    expect(() => activeTimerSchema.parse({ ...activeCountdown, id })).toThrow()
    expect(() => timerSessionSchema.parse({ ...pendingSession, id })).toThrow()
    expect(() => startTimerRequestSchema.parse({ sessionId: id, mode: 'elapsed' })).toThrow()
  })

  it.each([' ', 'x'.repeat(101)])('rejects invalid timer request IDs', (requestId) => {
    expect(() => assignTimerRequestSchema.parse({
      requestId,
      sessionId: 'timer-1',
      taskId: 'nlp-01',
      creditedMinutes: 25
    })).toThrow()
    expect(() => discardTimerRequestSchema.parse({ requestId, sessionId: 'timer-1' })).toThrow()
  })

  it('validates the scalar assignment-options session ID boundary', () => {
    expect(assignmentOptionsSessionIdSchema.parse(' timer-1 ')).toBe('timer-1')
    expect(() => assignmentOptionsSessionIdSchema.parse(' ')).toThrow()
    expect(() => assignmentOptionsSessionIdSchema.parse('x'.repeat(101))).toThrow()
  })
})

describe('timerStateFileSchema', () => {
  it('accepts schemaVersion 1 state', () => {
    expect(timerStateFileSchema.parse({
      schemaVersion: 1,
      active: activeCountdown,
      updatedAt: '2026-08-17T00:00:00.000Z'
    }).schemaVersion).toBe(1)
  })

  it('rejects unknown schema versions', () => {
    expect(() => timerStateFileSchema.parse({
      schemaVersion: 2,
      active: null,
      updatedAt: '2026-08-17T00:00:00.000Z'
    })).toThrow()
  })

  it('strictly rejects unknown persisted fields', () => {
    expect(() => timerStateFileSchema.parse({
      schemaVersion: 1,
      active: null,
      updatedAt: '2026-08-17T00:00:00.000Z',
      path: 'data/timer/state.json'
    })).toThrow()
  })
})

describe('timerSessionSchema', () => {
  it('enforces elapsed and countdown target rules independently of active timers', () => {
    expect(timerSessionSchema.parse({
      ...pendingSession,
      mode: 'elapsed',
      targetSeconds: undefined
    }).mode).toBe('elapsed')
    expect(timerSessionSchema.parse(pendingSession).mode).toBe('countdown')
    expect(() => timerSessionSchema.parse({ ...pendingSession, targetSeconds: undefined })).toThrow()
    expect(() => timerSessionSchema.parse({ ...pendingSession, mode: 'elapsed' })).toThrow()
  })

  it('strictly rejects unknown persisted fields', () => {
    expect(() => timerSessionSchema.parse({
      ...pendingSession,
      workspacePath: '/tmp/my-way'
    })).toThrow()
  })

  it('rejects sessions that end before they start', () => {
    const result = timerSessionSchema.safeParse({
      ...pendingSession,
      endedAt: '2026-08-16T23:59:59.000Z'
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['endedAt'] })
      ]))
    }
  })

  it('rejects durations longer than the session wall-clock interval', () => {
    const result = timerSessionSchema.safeParse({
      ...pendingSession,
      endedAt: '2026-08-17T00:00:59.999Z',
      durationSeconds: 60
    })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ['durationSeconds'] })
      ]))
    }
  })
})

describe('timerLedgerFileSchema', () => {
  it('accepts pending and assigned sessions', () => {
    const assignedSession = { ...pendingSession, id: 'timer-2', status: 'assigned', assignment }
    expect(timerLedgerFileSchema.parse({ ...ledger, sessions: [pendingSession, assignedSession] }).sessions).toHaveLength(2)
  })

  it('requires assigned sessions to contain an assignment', () => {
    expect(() => timerLedgerFileSchema.parse({
      ...ledger,
      sessions: [{ ...pendingSession, status: 'assigned' }]
    })).toThrow()
  })

  it('rejects assignments on pending sessions', () => {
    expect(() => timerLedgerFileSchema.parse({
      ...ledger,
      sessions: [{ ...pendingSession, assignment }]
    })).toThrow()
  })

  it('rejects duplicate session IDs', () => {
    expect(() => timerLedgerFileSchema.parse({ ...ledger, sessions: [pendingSession, pendingSession] })).toThrow()
  })

  it.each([0, 1441])('rejects creditedMinutes outside 1 through 1440: %s', (creditedMinutes) => {
    expect(() => timerLedgerFileSchema.parse({
      ...ledger,
      sessions: [{
        ...pendingSession,
        status: 'assigned',
        assignment: { ...assignment, creditedMinutes }
      }]
    })).toThrow()
  })

  it('rejects unknown schema versions', () => {
    expect(() => timerLedgerFileSchema.parse({ ...ledger, schemaVersion: 2 })).toThrow()
  })

  it('strictly rejects unknown persisted fields', () => {
    expect(() => timerLedgerFileSchema.parse({ ...ledger, body: '# Timer sessions' })).toThrow()
  })
})

describe('timer request schemas', () => {
  it('validates exact start requests', () => {
    expect(startTimerRequestSchema.parse({
      sessionId: 'timer-1', mode: 'countdown', countdownMinutes: 25
    })).toEqual({ sessionId: 'timer-1', mode: 'countdown', countdownMinutes: 25 })
    expect(startTimerRequestSchema.parse({ sessionId: 'timer-2', mode: 'elapsed' })).toEqual({
      sessionId: 'timer-2', mode: 'elapsed'
    })
    expect(() => startTimerRequestSchema.parse({ sessionId: 'timer-1', mode: 'countdown' })).toThrow()
    expect(() => startTimerRequestSchema.parse({ sessionId: 'timer-1', mode: 'elapsed', countdownMinutes: 25 })).toThrow()
    expect(() => startTimerRequestSchema.parse({ sessionId: 'timer-1', mode: 'elapsed', path: 'data/timer/state.json' })).toThrow()
  })

  it('accepts the same optional task intent for elapsed and countdown starts', () => {
    const taskIntent = {
      date: '2026-08-17',
      taskId: 'nlp-01',
      taskTitle: 'Read the Transformer paper'
    }
    expect(startTimerRequestSchema.parse({
      sessionId: 'timer-1', mode: 'elapsed', taskIntent
    })).toEqual({ sessionId: 'timer-1', mode: 'elapsed', taskIntent })
    expect(startTimerRequestSchema.parse({
      sessionId: 'timer-2', mode: 'countdown', countdownMinutes: 25, taskIntent
    })).toEqual({ sessionId: 'timer-2', mode: 'countdown', countdownMinutes: 25, taskIntent })
  })

  it('validates exact assignment requests', () => {
    const request = { requestId: 'request-1', sessionId: 'timer-1', taskId: 'nlp-01', creditedMinutes: 25 }
    expect(assignTimerRequestSchema.parse(request)).toEqual(request)
    expect(() => assignTimerRequestSchema.parse({ ...request, creditedMinutes: 0 })).toThrow()
    expect(() => assignTimerRequestSchema.parse({ ...request, date: '2026-08-17' })).toThrow()
  })

  it('validates exact discard requests', () => {
    const request = { requestId: 'request-1', sessionId: 'timer-1' }
    expect(discardTimerRequestSchema.parse(request)).toEqual(request)
    expect(() => discardTimerRequestSchema.parse({ ...request, path: 'data/timer/2026/2026-08-17.md' })).toThrow()
  })

  it('validates exact list requests and real calendar dates', () => {
    expect(timerListRequestSchema.parse({ date: '2026-08-17' })).toEqual({ date: '2026-08-17' })
    expect(() => timerListRequestSchema.parse({ date: '2026-02-30' })).toThrow()
    expect(() => timerListRequestSchema.parse({ date: '2026-08-17', path: 'data/timer' })).toThrow()
  })
})

describe('inferred timer contract types', () => {
  it('rejects invalid start request combinations at compile time', () => {
    const accept = (request: StartTimerRequest): void => { void request }
    accept({ sessionId: 'timer-1', mode: 'elapsed' })
    accept({ sessionId: 'timer-1', mode: 'countdown', countdownMinutes: 25 })
    accept({
      sessionId: 'timer-1',
      mode: 'elapsed',
      taskIntent: { date: '2026-08-17', taskId: 'nlp-01', taskTitle: 'Read the Transformer paper' }
    })

    // @ts-expect-error elapsed requests cannot contain countdownMinutes
    accept({ sessionId: 'timer-1', mode: 'elapsed', countdownMinutes: 25 })
    // @ts-expect-error countdown requests require countdownMinutes
    accept({ sessionId: 'timer-1', mode: 'countdown' })
  })

  it('rejects invalid session combinations at compile time', () => {
    const accept = (session: TimerSession): void => { void session }
    accept(pendingSession)
    accept({ ...pendingSession, id: 'timer-2', status: 'assigned', assignment })

    // @ts-expect-error pending sessions cannot contain assignment
    accept({ ...pendingSession, assignment })
    // @ts-expect-error assigned sessions require assignment
    accept({ ...pendingSession, status: 'assigned' })
    // @ts-expect-error elapsed sessions cannot contain targetSeconds
    accept({ ...pendingSession, mode: 'elapsed' })
    // @ts-expect-error countdown sessions require targetSeconds
    accept({ ...pendingSession, targetSeconds: undefined })
  })

  it('rejects invalid active timer combinations at compile time', () => {
    const accept = (timer: ActiveTimer): void => { void timer }
    accept(activeCountdown)
    accept({
      ...activeCountdown,
      mode: 'elapsed',
      status: 'paused',
      segmentStartedAt: undefined,
      targetSeconds: undefined,
      pauseReason: 'user'
    })

    // @ts-expect-error elapsed timers cannot contain targetSeconds
    accept({ ...activeCountdown, mode: 'elapsed' })
    // @ts-expect-error countdown timers require targetSeconds
    accept({ ...activeCountdown, targetSeconds: undefined })
    // @ts-expect-error running timers require segmentStartedAt
    accept({ ...activeCountdown, segmentStartedAt: undefined })
    // @ts-expect-error running timers cannot contain pauseReason
    accept({ ...activeCountdown, pauseReason: 'user' })
    // @ts-expect-error paused timers cannot contain segmentStartedAt
    accept({ ...activeCountdown, status: 'paused', pauseReason: 'user' })
    // @ts-expect-error paused timers require pauseReason
    accept({ ...activeCountdown, status: 'paused', segmentStartedAt: undefined })
  })
})
