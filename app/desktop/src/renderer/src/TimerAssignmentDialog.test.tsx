// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TimerAssignmentOptions } from '../../shared/timerTypes'
import { TimerAssignmentDialog } from './TimerAssignmentDialog'
import { TimerCompletionDialog } from './TimerCompletionDialog'

const options: TimerAssignmentOptions = {
  session: {
    id: 'session-1', mode: 'elapsed', status: 'pending',
    startedAt: '2026-08-20T08:00:00.000Z', endedAt: '2026-08-20T08:24:31.000Z', durationSeconds: 1471
  },
  date: '2026-08-20',
  tasks: [
    { id: 'nlp-1', title: 'NLP 论文精读', actualMinutes: 30 },
    { id: 'english-1', title: '英语阅读', actualMinutes: 1300 }
  ]
}

afterEach(cleanup)

describe('TimerAssignmentDialog', () => {
  it('shows exact duration, proposes rounded minutes, traps focus, and assigns explicitly', async () => {
    const onAssign = vi.fn()
    const onDefer = vi.fn()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(<TimerAssignmentDialog options={options} pending={false} error={null} onAssign={onAssign} onDefer={onDefer} />)

    const dialog = screen.getByRole('dialog')
    const describedBy = dialog.getAttribute('aria-describedby')?.split(' ') ?? []
    expect(describedBy).toHaveLength(2)
    expect(describedBy.map((id) => document.getElementById(id)?.textContent).join(' ')).toContain('24:31')
    expect(screen.getByText('24:31')).toBeTruthy()
    expect(screen.getByText(options.date)).toBeTruthy()
    expect(screen.queryByText(/ASSIGN SESSION/)).toBeNull()
    expect(screen.getByRole('option', { name: '英语阅读 · 已记 21 小时 40 分钟' })).toBeTruthy()
    expect((screen.getByRole('spinbutton', { name: '计入分钟' }) as HTMLInputElement).value).toBe('25')
    expect(screen.getByRole('button', { name: '暂不分配' })).toBe(document.activeElement)
    await userEvent.click(screen.getByRole('button', { name: '分配到任务' }))
    expect(onAssign).toHaveBeenCalledWith('nlp-1', 25)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDefer).toHaveBeenCalledOnce()
    view.unmount()
    expect(opener).toBe(document.activeElement)
    opener.remove()
  })

  it('rejects per-task overflow and handles dates without tasks', async () => {
    const overflowOptions = {
      ...options,
      tasks: options.tasks.map((task) => task.id === 'english-1' ? { ...task, actualMinutes: 1430 } : task)
    }
    render(<TimerAssignmentDialog options={overflowOptions} pending={false} error={null} onAssign={vi.fn()} onDefer={vi.fn()} />)
    await userEvent.selectOptions(screen.getByRole('combobox', { name: '任务' }), 'english-1')
    const validation = screen.getByRole('alert')
    const minutes = screen.getByRole('spinbutton', { name: '计入分钟' })
    expect(validation.textContent).toContain('超过 1440')
    expect(minutes.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(minutes.getAttribute('aria-describedby') as string)).toBe(validation)
    expect((screen.getByRole('button', { name: '分配到任务' }) as HTMLButtonElement).disabled).toBe(true)
    cleanup()

    render(<TimerAssignmentDialog options={{ ...options, tasks: [] }} pending={false} error={null} onAssign={vi.fn()} onDefer={vi.fn()} />)
    expect(screen.getByText(/没有可分配的任务/)).toBeTruthy()
    expect((screen.getByRole('button', { name: '分配到任务' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('rejects an assignment that would make the whole day exceed 1440 minutes', () => {
    const fullDay = {
      ...options,
      tasks: [
        { id: 'nlp-1', title: 'NLP 论文精读', actualMinutes: 700 },
        { id: 'english-1', title: '英语阅读', actualMinutes: 700 }
      ]
    }
    render(<TimerAssignmentDialog options={fullDay} pending={false} error={null} onAssign={vi.fn()} onDefer={vi.fn()} />)

    fireEvent.change(screen.getByRole('spinbutton', { name: '计入分钟' }), { target: { value: '50' } })
    expect(screen.getByRole('alert').textContent).toBe('该日累计计入后会超过 1440 分钟')
    expect((screen.getByRole('button', { name: '分配到任务' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('preselects the original task when the completed session still has a matching task', async () => {
    const onAssign = vi.fn()
    const focusedOptions: TimerAssignmentOptions = {
      ...options,
      tasks: options.tasks.map((task) => task.id === 'english-1' ? { ...task, actualMinutes: 10 } : task),
      session: {
        ...options.session,
        taskIntent: {
          date: options.date,
          taskId: 'english-1',
          taskTitle: '英语阅读'
        }
      }
    }
    render(<TimerAssignmentDialog options={focusedOptions} pending={false} error={null} onAssign={onAssign} onDefer={vi.fn()} />)

    expect((screen.getByRole('combobox', { name: '任务' }) as HTMLSelectElement).value).toBe('english-1')
    await userEvent.click(screen.getByRole('button', { name: '分配到任务' }))
    expect(onAssign).toHaveBeenCalledWith('english-1', 25)
  })

  it('blocks Escape and keeps focus inside while a write is pending', () => {
    const onDefer = vi.fn()
    render(<TimerAssignmentDialog options={options} pending error={null} onAssign={vi.fn()} onDefer={onDefer} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect(dialog).toBe(document.activeElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onDefer).not.toHaveBeenCalled()
  })
})

describe('TimerCompletionDialog', () => {
  it('requires acknowledgement and keeps keyboard focus on its only action', async () => {
    const onAcknowledge = vi.fn()
    render(<TimerCompletionDialog onAcknowledge={onAcknowledge} />)
    const action = screen.getByRole('button', { name: '记录学习成果' })
    const dialog = screen.getByRole('dialog')
    const descriptionId = dialog.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId as string)?.textContent).toContain('计时已停在准确的结束时刻')
    expect(screen.queryByText('SESSION COMPLETE')).toBeNull()
    expect(screen.getByRole('heading', { name: '学习时段完成' })).toBeTruthy()
    expect(action).toBe(document.activeElement)
    await userEvent.tab()
    expect(action).toBe(document.activeElement)
    await userEvent.click(action)
    expect(onAcknowledge).toHaveBeenCalledOnce()
  })
})
