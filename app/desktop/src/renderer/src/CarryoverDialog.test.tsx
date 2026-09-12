// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CarryoverDialog, type CarryoverPendingAction } from './CarryoverDialog'
import type { DailyTask } from '../../shared/schemas'

const tasks: DailyTask[] = [
  { id: 'nlp-1', date: '2026-08-31', originalDate: '2026-08-31', category: 'nlp', title: '复现注意力', plannedMinutes: 90, deliverable: '', actualMinutes: 35, status: 'in_progress', evidence: [], notes: '', outcomes: '' },
  { id: 'exam-1', date: '2026-08-31', originalDate: '2026-08-31', category: 'exam', title: '线性代数', plannedMinutes: 60, deliverable: '', actualMinutes: 0, status: 'planned', evidence: [], notes: '', outcomes: '' }
]

afterEach(cleanup)

describe('CarryoverDialog', () => {
  it('starts collapsed without stealing focus and only acts on explicit choices', async () => {
    const onResolve = vi.fn()
    const initialFocus = document.activeElement
    render(<CarryoverDialog sourceDate="2026-08-31" tasks={tasks} pending={null} onResolve={onResolve} />)

    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(initialFocus)
    expect(document.querySelector('details')?.open).toBe(false)
    expect(onResolve).not.toHaveBeenCalled()
    await userEvent.click(screen.getByText('待处理任务 · 2 项'))
    expect(screen.getByText(/8 月 31 日/)).toBeTruthy()
    expect(screen.getByText('实际 35 分钟 / 计划 1 小时 30 分钟')).toBeTruthy()
    expect(screen.getByText('剩余 55 分钟')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '顺延到今天：复现注意力' }))
    expect(onResolve).toHaveBeenCalledWith('nlp-1', 'reschedule')
  })

  it('locks choices during a transaction without trapping keyboard focus', async () => {
    const pending: CarryoverPendingAction = { taskId: 'nlp-1', action: 'reschedule' }
    render(<CarryoverDialog sourceDate="2026-08-31" tasks={tasks} pending={pending} onResolve={vi.fn()} />)
    await userEvent.click(screen.getByText('待处理任务 · 2 项'))

    expect(screen.getByText('正在顺延…')).toBeTruthy()
    expect(screen.getAllByRole('button').every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
