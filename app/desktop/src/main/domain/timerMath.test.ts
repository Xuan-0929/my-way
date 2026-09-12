import { describe, expect, it } from 'vitest'
import type { ActiveTimer } from '../../shared/timerTypes'
import {
  elapsedSeconds,
  localDateAt,
  pauseActive,
  proposedCreditMinutes,
  remainingSeconds
} from './timerMath'

const runningElapsed = (overrides: Partial<ActiveTimer> = {}): ActiveTimer => ({
  id: 'timer-1',
  mode: 'elapsed',
  status: 'running',
  createdAt: '2026-08-17T08:00:00.000Z',
  segmentStartedAt: '2026-08-17T08:00:10.000Z',
  accumulatedSeconds: 12,
  updatedAt: '2026-08-17T08:00:10.000Z',
  ...overrides
} as ActiveTimer)

const runningCountdown = (overrides: Partial<ActiveTimer> = {}): ActiveTimer => ({
  id: 'timer-2',
  mode: 'countdown',
  status: 'running',
  createdAt: '2026-08-17T08:00:00.000Z',
  segmentStartedAt: '2026-08-17T08:00:00.000Z',
  accumulatedSeconds: 0,
  targetSeconds: 60,
  updatedAt: '2026-08-17T08:00:00.000Z',
  ...overrides
} as ActiveTimer)

describe('elapsedSeconds', () => {
  it('adds accumulated whole seconds to the floored current segment', () => {
    expect(elapsedSeconds(runningElapsed(), new Date('2026-08-17T08:00:13.999Z'))).toBe(15)
  })

  it('does not count wall-clock movement after a timer is paused', () => {
    const paused: ActiveTimer = {
      id: 'timer-1',
      mode: 'elapsed',
      status: 'paused',
      createdAt: '2026-08-17T08:00:00.000Z',
      accumulatedSeconds: 34,
      pauseReason: 'user',
      updatedAt: '2026-08-17T08:00:34.000Z'
    }

    expect(elapsedSeconds(paused, new Date('2026-08-18T08:00:00.000Z'))).toBe(34)
  })

  it('rejects a clock value before the current segment began', () => {
    expect(() => elapsedSeconds(runningElapsed(), new Date('2026-08-17T08:00:09.999Z'))).toThrow(
      'segmentStartedAt'
    )
  })
})

describe('remainingSeconds', () => {
  it('reports accurate early countdown values', () => {
    expect(remainingSeconds(runningCountdown(), new Date('2026-08-17T08:00:00.999Z'))).toBe(60)
    expect(remainingSeconds(runningCountdown(), new Date('2026-08-17T08:00:01.000Z'))).toBe(59)
  })

  it('subtracts elapsed time and clamps completed countdowns to zero', () => {
    const timer = runningCountdown({ accumulatedSeconds: 10, targetSeconds: 60 })
    expect(remainingSeconds(timer, new Date('2026-08-17T08:00:05.000Z'))).toBe(45)
    expect(remainingSeconds(timer, new Date('2026-08-17T08:01:30.000Z'))).toBe(0)
  })

  it('rejects elapsed-mode timers', () => {
    expect(() => remainingSeconds(runningElapsed(), new Date('2026-08-17T08:00:11.000Z'))).toThrow(
      'countdown'
    )
  })
})

describe('localDateAt', () => {
  it('owns a session by the local end date when it crosses midnight', () => {
    const originalTimezone = process.env.TZ
    try {
      process.env.TZ = 'Asia/Shanghai'
      const startedAt = new Date('2026-08-17T15:59:00.000Z')
      const endedAt = new Date(startedAt.getTime() + 2 * 60 * 1000)

      expect(localDateAt(startedAt)).toBe('2026-08-17')
      expect(localDateAt(endedAt)).toBe('2026-08-18')
      expect(endedAt.toISOString().slice(0, 10)).toBe('2026-08-17')
    } finally {
      if (originalTimezone === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = originalTimezone
      }
    }
  })
})

describe('proposedCreditMinutes', () => {
  it.each([
    [0, 0],
    [1, 1],
    [29, 1],
    [30, 1],
    [59, 1],
    [60, 1],
    [90, 2]
  ])('proposes the nearest minute for %i seconds as %i', (seconds, minutes) => {
    expect(proposedCreditMinutes(seconds)).toBe(minutes)
  })

  it.each([-1, 0.5, Number.NaN])('rejects a non-authoritative duration: %s', (seconds) => {
    expect(() => proposedCreditMinutes(seconds)).toThrow('non-negative integer')
  })
})

describe('pauseActive', () => {
  it('adds the running segment once, removes its start, and records the reason', () => {
    const active = runningElapsed()
    const paused = pauseActive(active, 'app_close', new Date('2026-08-17T08:00:13.999Z'))

    expect(paused).toEqual({
      id: 'timer-1',
      mode: 'elapsed',
      status: 'paused',
      createdAt: '2026-08-17T08:00:00.000Z',
      accumulatedSeconds: 15,
      pauseReason: 'app_close',
      updatedAt: '2026-08-17T08:00:13.999Z'
    })
    expect(active).toEqual(runningElapsed())
  })

  it('does not add time or replace fields when called on an already paused timer', () => {
    const paused = pauseActive(runningElapsed(), 'user', new Date('2026-08-17T08:00:15.000Z'))
    const pausedAgain = pauseActive(paused, 'system_suspend', new Date('2026-08-18T08:00:00.000Z'))

    expect(pausedAgain).toEqual(paused)
  })
})
