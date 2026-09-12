import type { ActiveTimer, TimerPauseReason } from '../../shared/timerTypes'

const runningSegmentSeconds = (
  active: Extract<ActiveTimer, { status: 'running' }>,
  now: Date
): number => {
  const elapsedMilliseconds = now.getTime() - Date.parse(active.segmentStartedAt)
  if (elapsedMilliseconds < 0) {
    throw new Error('now cannot be before segmentStartedAt')
  }
  return Math.floor(elapsedMilliseconds / 1000)
}

export const elapsedSeconds = (active: ActiveTimer, now: Date): number => {
  if (active.status === 'paused') {
    return active.accumulatedSeconds
  }
  return active.accumulatedSeconds + runningSegmentSeconds(active, now)
}

export const remainingSeconds = (active: ActiveTimer, now: Date): number => {
  if (active.mode !== 'countdown') {
    throw new Error('remainingSeconds requires a countdown timer')
  }
  return Math.max(0, active.targetSeconds - elapsedSeconds(active, now))
}

export const pauseActive = (
  active: ActiveTimer,
  reason: TimerPauseReason,
  now: Date
): ActiveTimer => {
  if (active.status === 'paused') {
    return active
  }

  const { segmentStartedAt, ...rest } = active
  void segmentStartedAt
  return {
    ...rest,
    status: 'paused',
    accumulatedSeconds: active.accumulatedSeconds + runningSegmentSeconds(active, now),
    pauseReason: reason,
    updatedAt: now.toISOString()
  }
}

export const proposedCreditMinutes = (durationSeconds: number): number => {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0) {
    throw new Error('durationSeconds must be a non-negative integer')
  }
  return durationSeconds === 0 ? 0 : Math.max(1, Math.round(durationSeconds / 60))
}

export const localDateAt = (date: Date): string => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}
