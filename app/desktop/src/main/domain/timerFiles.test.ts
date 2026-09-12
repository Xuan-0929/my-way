import { describe, expect, it } from 'vitest'
import { timerStateFileSchema } from '../../shared/timerSchemas'
import type { TimerLedgerFile, TimerStateFile } from '../../shared/timerTypes'
import {
  emptyTimerLedger,
  emptyTimerState,
  parseTimerLedger,
  parseTimerState,
  serializeTimerLedger,
  serializeTimerState
} from './timerFiles'

const pausedState: TimerStateFile = {
  schemaVersion: 1,
  active: {
    id: 'timer-1',
    mode: 'countdown',
    status: 'paused',
    createdAt: '2026-08-17T08:00:00.000Z',
    accumulatedSeconds: 90,
    targetSeconds: 1500,
    pauseReason: 'user',
    updatedAt: '2026-08-17T08:01:30.000Z'
  },
  updatedAt: '2026-08-17T08:01:30.000Z'
}

const ledger: TimerLedgerFile = {
  schemaVersion: 1,
  date: '2026-08-17',
  sessions: [
    {
      id: 'timer-1',
      mode: 'countdown',
      startedAt: '2026-08-17T08:00:00.000Z',
      endedAt: '2026-08-17T08:25:00.000Z',
      durationSeconds: 1500,
      targetSeconds: 1500,
      status: 'pending'
    }
  ],
  updatedAt: '2026-08-17T08:25:00.000Z'
}

const validLedgerMarkdown = `---
schemaVersion: 1
date: '2026-08-17'
sessions:
  - id: timer-1
    mode: countdown
    startedAt: '2026-08-17T08:00:00.000Z'
    endedAt: '2026-08-17T08:25:00.000Z'
    durationSeconds: 1500
    targetSeconds: 1500
    status: pending
updatedAt: '2026-08-17T08:25:00.000Z'
---

# Timer sessions
`

describe('timer state JSON codec', () => {
  it('round trips idle and paused states', () => {
    const idle = emptyTimerState(new Date('2026-08-17T08:00:00.000Z'))

    expect(parseTimerState(serializeTimerState(idle), '/workspace/data/timer/state.json')).toEqual(idle)
    expect(parseTimerState(serializeTimerState(pausedState), '/workspace/data/timer/state.json')).toEqual(pausedState)
  })

  it('serializes deterministic pretty JSON with one trailing newline', () => {
    const validated = timerStateFileSchema.parse(pausedState)
    expect(serializeTimerState(pausedState)).toBe(`${JSON.stringify(validated, null, 2)}\n`)
  })

  it('serializes schema-normalized identifiers for a stable parse round trip', () => {
    const state = {
      ...pausedState,
      active: { ...pausedState.active, id: ' timer-1 ' }
    } as TimerStateFile
    const serialized = serializeTimerState(state)
    const parsed = parseTimerState(serialized, '/workspace/data/timer/state.json')

    expect(JSON.parse(serialized).active.id).toBe('timer-1')
    expect(serializeTimerState(parsed)).toBe(serialized)
  })

  it.each([
    ['malformed JSON', '{', '/tmp/broken-state.json'],
    [
      'unknown schema version',
      JSON.stringify({ schemaVersion: 2, active: null, updatedAt: '2026-08-17T08:00:00.000Z' }),
      '/tmp/newer-state.json'
    ],
    [
      'invalid active temporal combination',
      JSON.stringify({
        ...pausedState,
        active: {
          ...pausedState.active,
          createdAt: '2026-08-17T08:02:00.000Z',
          updatedAt: '2026-08-17T08:01:30.000Z'
        }
      }),
      '/tmp/invalid-active-state.json'
    ]
  ])('names the exact path for %s', (_label, source, path) => {
    expect(() => parseTimerState(source, path)).toThrow(path)
  })

  it('names the canonical state path when serialization validation fails', () => {
    expect(() => serializeTimerState({ ...pausedState, schemaVersion: 2 } as unknown as TimerStateFile)).toThrow(
      'data/timer/state.json'
    )
  })
})

describe('timer ledger Markdown codec', () => {
  it('round trips validated frontmatter and Markdown body', () => {
    const parsed = parseTimerLedger(validLedgerMarkdown, '/workspace/data/timer/2026/2026-08-17.md')
    const reparsed = parseTimerLedger(serializeTimerLedger(parsed), '/workspace/data/timer/2026/2026-08-17.md')

    expect(reparsed).toEqual(parsed)
    expect(reparsed.ledger).toEqual(ledger)
  })

  it('preserves the parsed body byte-for-byte across a rewrite', () => {
    const body = '# Timer sessions  \n\nCustom note with trailing spaces.   \n\n'
    const source = validLedgerMarkdown.replace('# Timer sessions\n', body)
    const parsed = parseTimerLedger(source, '/workspace/data/timer/2026/2026-08-17.md')
    const serialized = serializeTimerLedger(parsed)

    expect(parsed.body).toBe(body)
    expect(serialized.endsWith(`\n${body}`)).toBe(true)
    expect(parseTimerLedger(serialized, 'ledger.md').body).toBe(body)
  })

  it.each([
    ['bad YAML', '---\nschemaVersion: [\n---\n\n# Timer sessions\n', '/tmp/bad-yaml.md'],
    [
      'unknown schema version',
      validLedgerMarkdown.replace('schemaVersion: 1', 'schemaVersion: 2'),
      '/tmp/newer-ledger.md'
    ],
    [
      'duplicate session IDs',
      validLedgerMarkdown.replace(
        "updatedAt: '2026-08-17T08:25:00.000Z'",
        `  - id: timer-1
    mode: elapsed
    startedAt: '2026-08-17T09:00:00.000Z'
    endedAt: '2026-08-17T09:01:00.000Z'
    durationSeconds: 60
    status: pending
updatedAt: '2026-08-17T09:01:00.000Z'`
      ),
      '/tmp/duplicate-ledger.md'
    ],
    [
      'invalid temporal combination',
      validLedgerMarkdown.replace("endedAt: '2026-08-17T08:25:00.000Z'", "endedAt: '2026-08-17T07:59:59.000Z'"),
      '/tmp/temporal-ledger.md'
    ],
    [
      'invalid assignment combination',
      validLedgerMarkdown.replace(
        '    status: pending',
        `    status: pending
    assignment:
      taskId: nlp-01
      taskTitle: Read Transformer
      creditedMinutes: 25
      assignedAt: '2026-08-17T08:25:01.000Z'`
      ),
      '/tmp/assignment-ledger.md'
    ],
    [
      'invalid calendar date',
      validLedgerMarkdown.replace("date: '2026-08-17'", "date: '2026-02-30'"),
      '/tmp/date-ledger.md'
    ]
  ])('names the exact path for %s', (_label, source, path) => {
    expect(() => parseTimerLedger(source, path)).toThrow(path)
  })

  it('names the canonical dated path when serialization validation fails', () => {
    expect(() => serializeTimerLedger({
      ledger: { ...ledger, sessions: [ledger.sessions[0], ledger.sessions[0]] },
      body: '# Timer sessions\n'
    })).toThrow('data/timer/2026/2026-08-17.md')
  })
})

describe('empty timer files', () => {
  it('creates an idle state at the injected instant', () => {
    expect(emptyTimerState(new Date('2026-08-17T08:00:00.000Z'))).toEqual({
      schemaVersion: 1,
      active: null,
      updatedAt: '2026-08-17T08:00:00.000Z'
    })
  })

  it('creates an empty dated ledger with the stable body at the injected instant', () => {
    expect(emptyTimerLedger('2026-08-17', new Date('2026-08-17T08:00:00.000Z'))).toEqual({
      ledger: {
        schemaVersion: 1,
        date: '2026-08-17',
        sessions: [],
        updatedAt: '2026-08-17T08:00:00.000Z'
      },
      body: '# Timer sessions\n'
    })
  })

  it('rejects an invalid injected ledger date with the canonical dated path', () => {
    expect(() => emptyTimerLedger('2026-02-30', new Date('2026-08-17T08:00:00.000Z'))).toThrow(
      'data/timer/2026/2026-02-30.md'
    )
  })
})
