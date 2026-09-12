import { describe, expect, it, vi } from 'vitest'
import { buildDailyTask, newTaskDraft, persistNewTask } from './taskCreation'
import type { DesktopApi } from '../../shared/api'

describe('task creation', () => {
  it('builds an independent template with fresh progress and selected date', () => {
    const source = buildDailyTask({ ...newTaskDraft('2026-09-03'), title: '训练', notes: '动作要领', category: 'fitness', plannedMinutes: '150' }, 'source')
    source.actualMinutes = 150
    source.status = 'done'
    source.sourceTaskId = 'week-original'
    source.evidence = ['training.md']
    source.outcomes = '已完成'
    const copy = buildDailyTask(newTaskDraft('2026-09-04', source), 'copy')
    expect(copy).toMatchObject({ id: 'copy', date: '2026-09-04', originalDate: '2026-09-04', title: '训练', plannedMinutes: 150, notes: '动作要领', actualMinutes: 0, status: 'planned', evidence: [], outcomes: '' })
    expect(copy.sourceTaskId).toBeUndefined()
    expect(source.actualMinutes).toBe(150)
  })

  it.each(['', '0', '721', '1.5'])('rejects invalid planned minutes %s', (plannedMinutes) => {
    expect(() => buildDailyTask({ ...newTaskDraft('2026-09-03'), title: '训练', plannedMinutes }, 'new')).toThrow()
  })

  it('appends to the selected day using its latest revision and makes retries idempotent', async () => {
    const original = buildDailyTask({ ...newTaskDraft('2026-09-04'), title: '原任务' }, 'original')
    const copy = buildDailyTask({ ...newTaskDraft('2026-09-04'), title: '副本' }, 'copy')
    let file = { path: '/tmp/2026-09-04.md', revision: 'newest', value: { schemaVersion: 1 as const, date: '2026-09-04', sourceWeek: null, tasks: [original], reflection: { learned: '', blockers: '', tomorrow: '' }, pastExams: [], updatedAt: '2026-09-04T00:00:00.000Z', notes: '日记不变' } }
    const day = {
      create: vi.fn(async () => ({ ok: true as const, value: { file, created: false, missingPlan: true } })),
      save: vi.fn(async (next) => { file = { ...next, revision: 'saved' }; return { ok: true as const, value: file } })
    } as unknown as DesktopApi['day']
    const result = await persistNewTask(day, copy)
    expect(result.ok).toBe(true)
    expect(day.create).toHaveBeenCalledWith('2026-09-04')
    expect(vi.mocked(day.save).mock.calls[0][0]).toMatchObject({ revision: 'newest', value: { tasks: [original, copy], notes: '日记不变' } })
    await persistNewTask(day, copy)
    expect(day.save).toHaveBeenCalledOnce()
  })
})
