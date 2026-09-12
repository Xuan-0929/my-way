import { describe, expect, it, vi } from 'vitest'
import type { CarryoverRequest, DayOpenResult } from '../../shared/api'
import type { DailyTask } from '../../shared/schemas'
import type { ParsedDailyRecord, VersionedFile } from '../../shared/types'
import { resolveAndPersistCarryover, type CarryoverStore } from './carryoverService'

const task: DailyTask = { id: 'nlp-01', date: '2026-08-17', originalDate: '2026-08-17', category: 'nlp', title: '注意力', plannedMinutes: 90, deliverable: '', actualMinutes: 20, status: 'in_progress', evidence: [], notes: '', outcomes: '' }
const record = (date: string, tasks: DailyTask[] = [task]): ParsedDailyRecord => ({ schemaVersion: 1, date, sourceWeek: 1, tasks, reflection: { learned: '', blockers: '', tomorrow: '' }, pastExams: [], updatedAt: '2026-08-17T08:00:00.000Z', notes: '' })
const versioned = (path: string, value: ParsedDailyRecord, revision: string): VersionedFile<ParsedDailyRecord> => ({ path, value, revision })

const request: CarryoverRequest = {
  source: versioned('/days/17.md', record('2026-08-17'), 'source-r1'),
  targetDate: '2026-08-18',
  taskId: 'nlp-01',
  choice: { action: 'reschedule', targetDate: '2026-08-18' }
}

describe('carryover persistence', () => {
  it('rejects already time-met tasks before creating any target file', async () => {
    const store: CarryoverStore = { open: vi.fn(), save: vi.fn() }
    const met = { ...request, source: { ...request.source, value: record('2026-08-17', [{ ...task, actualMinutes: 100, status: 'planned' }]) } }
    await expect(resolveAndPersistCarryover(store, met)).rejects.toThrow('已经结束')
    expect(store.open).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })

  it('defers a task without writing unchanged historical data', async () => {
    const store: CarryoverStore = { open: vi.fn(), save: vi.fn() }
    expect(await resolveAndPersistCarryover(store, { ...request, choice: { action: 'keep_overdue' } })).toEqual({ source: request.source })
    expect(store.open).not.toHaveBeenCalled()
    expect(store.save).not.toHaveBeenCalled()
  })
  it('does not modify the source when writing the target fails', async () => {
    const target: DayOpenResult = { file: versioned('/days/18.md', record('2026-08-18', []), 'target-r1'), created: false, missingPlan: false }
    const save = vi.fn(async () => { throw new Error('target failed') })
    const store: CarryoverStore = { open: vi.fn(async () => target), save }
    await expect(resolveAndPersistCarryover(store, request)).rejects.toThrow('target failed')
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('/days/18.md', expect.anything(), 'target-r1')
  })

  it('rolls the target back when the source conflicts', async () => {
    const originalTarget = record('2026-08-18', [])
    const target: DayOpenResult = { file: versioned('/days/18.md', originalTarget, 'target-r1'), created: false, missingPlan: false }
    const save = vi.fn()
      .mockResolvedValueOnce(versioned('/days/18.md', record('2026-08-18'), 'target-r2'))
      .mockRejectedValueOnce(new Error('source conflict'))
      .mockResolvedValueOnce(versioned('/days/18.md', originalTarget, 'target-r3'))
    const store: CarryoverStore = { open: vi.fn(async () => target), save }
    await expect(resolveAndPersistCarryover(store, request)).rejects.toThrow('source conflict')
    expect(save).toHaveBeenNthCalledWith(3, '/days/18.md', originalTarget, 'target-r2')
  })

  it('retries idempotently when the carried task already exists in the target', async () => {
    const carriedTask = { ...task, id: 'nlp-01@2026-08-18', sourceTaskId: 'nlp-01', date: '2026-08-18', status: 'planned' as const }
    const existingTarget = versioned('/days/18.md', record('2026-08-18', [carriedTask]), 'target-r2')
    const savedSource = versioned('/days/17.md', { ...request.source.value, tasks: [{ ...task, status: 'rescheduled' as const }] }, 'source-r2')
    const save = vi.fn<CarryoverStore['save']>(async () => savedSource)
    const store: CarryoverStore = { open: vi.fn(async () => ({ file: existingTarget, created: false, missingPlan: false })), save }

    const result = await resolveAndPersistCarryover(store, request)
    expect(save).toHaveBeenCalledTimes(1)
    expect(save).toHaveBeenCalledWith('/days/17.md', expect.objectContaining({ tasks: [expect.objectContaining({ status: 'rescheduled' })] }), 'source-r1')
    expect(result.target).toBe(existingTarget)
    // This old-format retry target contains the full 90-minute budget.
    // Do not additionally retain 20 planned minutes on the source.
    expect(save.mock.calls[0][1].tasks[0].rescheduledMinutes).toBe(90)
  })

  it('uses the original lineage when retrying a task that was already carried once', async () => {
    const secondSourceTask: DailyTask = { ...task, id: 'nlp-01@2026-08-18', sourceTaskId: 'nlp-01', date: '2026-08-18' }
    const secondRequest: CarryoverRequest = {
      source: versioned('/days/18.md', record('2026-08-18', [secondSourceTask]), 'source-r1'),
      targetDate: '2026-08-19',
      taskId: secondSourceTask.id,
      choice: { action: 'reschedule', targetDate: '2026-08-19' }
    }
    const carriedAgain: DailyTask = { ...secondSourceTask, id: 'nlp-01@2026-08-19', date: '2026-08-19', status: 'planned' }
    const existingTarget = versioned('/days/19.md', record('2026-08-19', [carriedAgain]), 'target-r2')
    const save = vi.fn(async (_path, value: ParsedDailyRecord) => versioned('/days/18.md', value, 'source-r2'))
    const store: CarryoverStore = { open: vi.fn(async () => ({ file: existingTarget, created: false, missingPlan: false })), save }

    const result = await resolveAndPersistCarryover(store, secondRequest)
    expect(save).toHaveBeenCalledTimes(1)
    expect(result.source.value.tasks[0].status).toBe('rescheduled')
    expect(result.target).toBe(existingTarget)
  })
})
