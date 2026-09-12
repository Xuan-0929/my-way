// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { TaskComposer } from './TaskComposer'
import { newTaskDraft } from './taskCreation'

afterEach(cleanup)

function Harness({ onSubmit = vi.fn(), onCancel = vi.fn() }) {
  const [draft, setDraft] = useState(newTaskDraft('2026-09-03'))
  return <TaskComposer draft={draft} kind="new" pending={false} error={null} onChange={setDraft} onCancel={onCancel} onSubmit={onSubmit} />
}

describe('TaskComposer', () => {
  it('validates an empty title before creating and supports a fully cleared minute draft', async () => {
    const onSubmit = vi.fn()
    render(<Harness onSubmit={onSubmit} />)
    await userEvent.click(screen.getByRole('button', { name: '创建任务' }))
    expect(onSubmit).not.toHaveBeenCalled()
    expect(screen.getByText('任务标题不能为空')).toBeTruthy()
    await userEvent.type(screen.getByLabelText('任务标题'), '训练')
    const minutes = screen.getByLabelText('计划分钟') as HTMLInputElement
    await userEvent.click(minutes)
    await userEvent.keyboard('{End}{Backspace}{Backspace}')
    expect(minutes.value).toBe('')
    await userEvent.type(minutes, '150')
    await userEvent.click(screen.getByRole('button', { name: '创建任务' }))
    expect(onSubmit).toHaveBeenCalledOnce()
  })

  it('traps keyboard focus and cancels with Escape', async () => {
    const user = userEvent.setup()
    const onCancel = vi.fn()
    render(<Harness onCancel={onCancel} />)
    expect(document.activeElement).toBe(screen.getByLabelText('任务标题'))
    await user.tab({ shift: true })
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '创建任务' }))
    await user.tab()
    expect(document.activeElement).toBe(screen.getByLabelText('任务标题'))
    await user.keyboard('{Escape}')
    expect(onCancel).toHaveBeenCalledOnce()
  })
})
