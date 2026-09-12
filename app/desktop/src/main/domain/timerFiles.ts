import matter from 'gray-matter'
import type { ZodType } from 'zod'
import {
  timerLedgerFileSchema,
  timerStateFileSchema
} from '../../shared/timerSchemas'
import type { TimerLedgerFile, TimerStateFile } from '../../shared/timerTypes'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'

const TIMER_STATE_PATH = 'data/timer/state.json'

export interface TimerLedgerDocument {
  ledger: TimerLedgerFile
  body: string
}

const formatValidationError = (error: { issues: Array<{ path: PropertyKey[]; message: string }> }): string => (
  error.issues
    .map((issue) => `${issue.path.map(String).join('.') || 'file'}: ${issue.message}`)
    .join('; ')
)

const validateAtPath = <T>(schema: ZodType<T>, value: unknown, path: string): T => {
  const result = schema.safeParse(value)
  if (!result.success) {
    throw new Error(`${path}: ${formatValidationError(result.error)}`, { cause: result.error })
  }
  return result.data
}

const timerLedgerPath = (date: unknown): string => {
  const value = typeof date === 'string' ? date : 'YYYY-MM-DD'
  const year = /^\d{4}/.exec(value)?.[0] ?? 'YYYY'
  return `data/timer/${year}/${value}.md`
}

export const parseTimerState = (source: string, path: string): TimerStateFile => {
  let value: unknown
  try {
    value = JSON.parse(source)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${path}: ${message}`, { cause: error })
  }
  return validateAtPath(timerStateFileSchema, value, path)
}

export const serializeTimerState = (value: TimerStateFile): string => {
  const validated = validateAtPath(timerStateFileSchema, value, TIMER_STATE_PATH)
  return `${JSON.stringify(validated, null, 2)}\n`
}

export const parseTimerLedger = (source: string, path: string): TimerLedgerDocument => {
  const parsed = parseFrontmatter(source, path, timerLedgerFileSchema)
  return {
    ledger: parsed.data,
    body: matter(source).content.replace(/^\r?\n/, '')
  }
}

export const serializeTimerLedger = (document: TimerLedgerDocument): string => {
  const path = timerLedgerPath(document.ledger?.date)
  const validated = validateAtPath(timerLedgerFileSchema, document.ledger, path)
  const header = serializeFrontmatter(validated, '')
  return `${header}${document.body}`
}

export const emptyTimerState = (now: Date): TimerStateFile => {
  try {
    return validateAtPath(timerStateFileSchema, {
      schemaVersion: 1,
      active: null,
      updatedAt: now.toISOString()
    }, TIMER_STATE_PATH)
  } catch (error) {
    if (error instanceof Error && error.message.includes(TIMER_STATE_PATH)) {
      throw error
    }
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${TIMER_STATE_PATH}: ${message}`, { cause: error })
  }
}

export const emptyTimerLedger = (date: string, now: Date): TimerLedgerDocument => {
  const path = timerLedgerPath(date)
  let updatedAt: string
  try {
    updatedAt = now.toISOString()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${path}: ${message}`, { cause: error })
  }
  return {
    ledger: validateAtPath(timerLedgerFileSchema, {
      schemaVersion: 1,
      date,
      sessions: [],
      updatedAt
    }, path),
    body: '# Timer sessions\n'
  }
}
