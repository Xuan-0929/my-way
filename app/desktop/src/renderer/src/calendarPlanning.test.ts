import { describe, expect, it, vi } from 'vitest'
import type { WeekDocument } from '../../shared/api'
import { buildCalendarMove, persistCalendarMove, persistLatestCalendarMove } from './calendarPlanning'

const document: WeekDocument = {
  path: '00-dashboard/weeks/week-03.md',
  revision: 'a'.repeat(64),
  value: {
    plan: {
      schemaVersion: 1,
      week: 3,
      startDate: '2026-08-31',
      endDate: '2026-09-06',
      tasks: [
        { id: 'math', date: '2026-08-31', category: 'exam', title: '数学诊断', plannedMinutes: 120, deliverable: 'evidence/math.md' },
        { id: 'nlp', date: '2026-09-02', category: 'nlp', title: 'NLP 复现', plannedMinutes: 180, deliverable: 'evidence/nlp.md' }
      ]
    },
    body: '# 第 3 周\n'
  }
}

describe('calendar planning', () => {
  it('builds a revision-aware week save without mutating the loaded document', () => {
    const request = buildCalendarMove(document, 'math', '2026-09-01')

    expect(request).toMatchObject({
      expectedRevision: 'a'.repeat(64),
      body: '# 第 3 周\n',
      plan: { tasks: [{ id: 'math', date: '2026-09-01' }, { id: 'nlp', date: '2026-09-02' }] }
    })
    expect(document.value.plan.tasks[0].date).toBe('2026-08-31')
  })

  it.each([
    ['missing', '2026-09-01', '找不到要移动的任务'],
    ['math', '2026-09-07', '目标日期不在本周范围内'],
    ['math', '2026-09-06', '周日为休息日'],
    ['math', '2026-08-31', '任务已在目标日期']
  ])('rejects an unsafe move for %s to %s', (taskId, date, message) => {
    expect(() => buildCalendarMove(document, taskId, date)).toThrow(message)
  })

  it('persists through week.save only and returns its authoritative document', async () => {
    const saved: WeekDocument = { ...document, revision: 'b'.repeat(64) }
    const save = vi.fn(async () => ({ ok: true as const, value: saved }))

    await expect(persistCalendarMove({ save }, document, 'math', '2026-09-01')).resolves.toEqual({ ok: true, value: saved })
    expect(save).toHaveBeenCalledWith(buildCalendarMove(document, 'math', '2026-09-01'))
  })

  it('turns a rejected latest-plan read into a recoverable move result', async () => {
    const load = vi.fn(async () => { throw new Error('周计划锁定中') })
    const save = vi.fn()

    await expect(persistLatestCalendarMove({ load, save }, '2026-09-01', 'math', '2026-09-02')).resolves.toEqual({
      ok: false,
      error: { code: 'UNKNOWN', message: '周计划锁定中' }
    })
    expect(save).not.toHaveBeenCalled()
  })
})
