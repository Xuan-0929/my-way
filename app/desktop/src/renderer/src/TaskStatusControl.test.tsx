// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskStatusControl } from './TaskStatusControl'

afterEach(cleanup)

describe('TaskStatusControl', () => {
  it('derives progress from minutes and recalculates corrections without manual writes', () => {
    const onChange = vi.fn()
    const { rerender } = render(<TaskStatusControl taskTitle="词法练习" state="planned" planned={30} actual={0} onChange={onChange} />)
    expect(screen.getByRole('status').textContent).toContain('未开始')
    rerender(<TaskStatusControl taskTitle="词法练习" state="planned" planned={30} actual={12} onChange={onChange} />)
    expect(screen.getByRole('status').textContent).toContain('进行中')
    rerender(<TaskStatusControl taskTitle="词法练习" state="planned" planned={30} actual={33} onChange={onChange} />)
    expect(screen.getByRole('status').textContent).toContain('已达标')
    expect(screen.queryByRole('button', { name: /提前完成/ })).toBeNull()
    rerender(<TaskStatusControl taskTitle="词法练习" state="planned" planned={60} actual={33} onChange={onChange} />)
    expect(screen.getByRole('status').textContent).toContain('进行中')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('offers explicit early completion and respects manual overrides', async () => {
    const onChange = vi.fn()
    const { rerender } = render(<TaskStatusControl taskTitle="词法练习" state="planned" planned={30} actual={12} onChange={onChange} />)
    await userEvent.click(screen.getByRole('button', { name: '提前完成：词法练习' }))
    expect(onChange).toHaveBeenCalledWith('done')
    rerender(<TaskStatusControl taskTitle="词法练习" state="done" planned={30} actual={0} onChange={onChange} />)
    expect(screen.getByRole('status').textContent).toContain('已完成')
    await userEvent.click(screen.getByRole('button', { name: '恢复自动：词法练习' }))
    expect(onChange).toHaveBeenLastCalledWith('planned')
    rerender(<TaskStatusControl taskTitle="词法练习" state="skipped" planned={30} actual={33} onChange={onChange} />)
    expect(screen.getByRole('status').textContent).toContain('已跳过')
    rerender(<TaskStatusControl taskTitle="词法练习" state="rescheduled" planned={30} actual={12} onChange={onChange} />)
    expect(screen.queryByRole('button')).toBeNull()
  })
})
