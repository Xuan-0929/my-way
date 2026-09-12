// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { TimerListResult, TimerSnapshot } from '../../shared/timerTypes'
import { TimerView } from './TimerView'

const idle: TimerSnapshot = { active: null, capturedAt: '2026-08-20T08:00:00.000Z' }
const empty: TimerListResult = { today: [], pending: [] }

const renderTimer = (overrides: Partial<Parameters<typeof TimerView>[0]> = {}) => {
  const props: Parameters<typeof TimerView>[0] = {
    tasks: [],
    taskIntent: overrides.snapshot?.active?.taskIntent ?? null,
    onTaskIntentChange: vi.fn(),
    snapshot: idle,
    sessions: empty,
    elapsedSeconds: 0,
    remainingSeconds: null,
    pendingAction: null,
    error: null,
    onStartElapsed: vi.fn(),
    onStartCountdown: vi.fn(),
    onPause: vi.fn(),
    onResume: vi.fn(),
    onEnd: vi.fn(),
    onAssign: vi.fn(),
    onDiscard: vi.fn(),
    ...overrides
  }
  render(<TimerView {...props} />)
  return props
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('TimerView', () => {
  it('keeps a cleared countdown draft empty and blocks starting until valid', async () => {
    const props = renderTimer()
    await userEvent.click(screen.getByRole('button', { name: '倒计时' }))
    const input = screen.getByRole('spinbutton', { name: '自定义倒计时分钟' }) as HTMLInputElement
    await userEvent.clear(input)
    expect(input.value).toBe('')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await userEvent.click(screen.getByRole('button', { name: '开始' }))
    expect(props.onStartCountdown).not.toHaveBeenCalled()
    await userEvent.type(input, '35')
    await userEvent.click(screen.getByRole('button', { name: '开始' }))
    expect(props.onStartCountdown).toHaveBeenCalledWith(35)
  })

  it('omits the cross-date ledger when there is nothing to allocate', () => {
    renderTimer()
    expect(screen.queryByRole('heading', { name: '跨日待分配' })).toBeNull()
  })

  it('retargets a running timer through the picker without invoking start or replacing its clock', async () => {
    const props = renderTimer({
      snapshot: { active: { id: 'running', mode: 'elapsed', status: 'running', createdAt: '2026-08-20T08:00:00.000Z', segmentStartedAt: '2026-08-20T08:00:00.000Z', updatedAt: '2026-08-20T08:00:00.000Z', accumulatedSeconds: 0 }, capturedAt: '2026-08-20T08:01:05.000Z' },
      elapsedSeconds: 65,
      tasks: [{ id: 'gym', date: '2026-08-20', originalDate: '2026-08-20', title: '力量训练', category: '健身', planned: 45, actual: 0, state: 'planned', deliverable: '', evidence: [], notes: '', outcomes: '' }]
    })
    const clock = screen.getByLabelText('当前计时')
    await userEvent.click(screen.getByRole('combobox', { name: '关联任务' }))
    await userEvent.click(screen.getByRole('option', { name: /力量训练/ }))
    expect(props.onTaskIntentChange).toHaveBeenCalledWith({ date: '2026-08-20', taskId: 'gym', taskTitle: '力量训练' })
    expect(props.onStartElapsed).not.toHaveBeenCalled()
    expect(props.onStartCountdown).not.toHaveBeenCalled()
    expect(screen.getByLabelText('当前计时')).toBe(clock)
    expect(clock.textContent).toBe('01:05')
    expect((screen.getByRole('button', { name: '倒计时' }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('starts elapsed timing only after an explicit click', async () => {
    const props = renderTimer()
    expect(screen.queryByText('本地计时 · 跨页面持续')).toBeNull()
    expect(screen.getByRole('group', { name: '计时模式' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '自由计时' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '倒计时' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.queryByText('FOCUS TIMER · LOCAL FIRST')).toBeNull()
    expect(props.onStartElapsed).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '开始' }))
    expect(props.onStartElapsed).toHaveBeenCalledOnce()
  })

  it('supports countdown presets and validates custom minutes', async () => {
    const props = renderTimer()
    await userEvent.click(screen.getByRole('button', { name: '倒计时' }))
    expect(screen.getByRole('button', { name: '倒计时' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('group', { name: '倒计时设置' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '25 分钟' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByRole('button', { name: '50 分钟' }).getAttribute('aria-pressed')).toBe('false')
    await userEvent.click(screen.getByRole('button', { name: '50 分钟' }))
    expect(screen.getByRole('button', { name: '25 分钟' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '50 分钟' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getByText('50:00')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '开始' }))
    expect(props.onStartCountdown).toHaveBeenCalledWith(50)

    fireEvent.change(screen.getByRole('spinbutton', { name: '自定义倒计时分钟' }), { target: { value: '181' } })
    expect(screen.getByRole('button', { name: '25 分钟' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('button', { name: '50 分钟' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('alert').textContent).toContain('1–180')
    expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: '自由计时' }))
    expect((screen.getByRole('button', { name: '开始' }) as HTMLButtonElement).disabled).toBe(false)
  })

  it('clamps a completed countdown display to zero', async () => {
    renderTimer({ snapshot: { ...idle, completion: { sessionId: 'done', endedAt: '2026-08-20T08:25:00.000Z' } } })
    await userEvent.click(screen.getByRole('button', { name: '倒计时' }))
    expect(screen.getByText('00:00')).toBeTruthy()
  })

  it('shows persistent active controls, pause reason, and read-only protection', async () => {
    const paused: TimerSnapshot = {
      active: {
        id: 'timer-1', mode: 'elapsed', status: 'paused', createdAt: '2026-08-20T08:00:00.000Z',
        accumulatedSeconds: 125, pauseReason: 'app_close', updatedAt: '2026-08-20T08:02:05.000Z'
      },
      capturedAt: '2026-08-20T08:02:05.000Z',
      readOnlyError: { message: '计时文件已被外部修改' }
    }
    const props = renderTimer({ snapshot: paused, elapsedSeconds: 125, error: '计时文件已被外部修改' })
    expect(screen.getByLabelText('当前计时').textContent).toBe('02:05')
    expect(screen.getByText('关闭 App 时自动暂停')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toContain('外部修改')
    expect((screen.getByRole('button', { name: '继续' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '结束并分配' }) as HTMLButtonElement).disabled).toBe(true)
    expect(props.onResume).not.toHaveBeenCalled()
  })

  it('keeps the focused task visible in the active console and pending ledger', () => {
    const taskIntent = { date: '2026-08-20', taskId: 'nlp-1', taskTitle: 'NLP 论文精读' }
    const active: TimerSnapshot = {
      active: {
        id: 'focused', mode: 'elapsed', status: 'running', createdAt: '2026-08-20T08:00:00.000Z',
        segmentStartedAt: '2026-08-20T08:00:00.000Z', accumulatedSeconds: 0,
        updatedAt: '2026-08-20T08:00:00.000Z', taskIntent
      },
      capturedAt: '2026-08-20T08:00:00.000Z'
    }
    const pending = {
      id: 'pending-focused', mode: 'elapsed' as const, status: 'pending' as const,
      startedAt: '2026-08-20T07:30:00.000Z', endedAt: '2026-08-20T07:55:00.000Z',
      durationSeconds: 1500, taskIntent
    }

    renderTimer({ snapshot: active, sessions: { today: [pending], pending: [pending] } })

    expect(screen.getAllByText('NLP 论文精读')).toHaveLength(2)
    expect(screen.queryByText('待分配')).toBeNull()
  })

  it('lists assigned and pending sessions and requires confirmation before discard', async () => {
    const pending = {
      id: 'pending-1', mode: 'elapsed' as const, status: 'pending' as const,
      startedAt: '2026-08-19T23:55:00.000Z', endedAt: '2026-08-20T00:05:00.000Z', durationSeconds: 600
    }
    const assigned = {
      ...pending,
      id: 'assigned-1',
      status: 'assigned' as const,
      assignment: { taskId: 'nlp-1', taskTitle: 'NLP 论文精读', creditedMinutes: 10, assignedAt: '2026-08-20T00:06:00.000Z' }
    }
    const props = renderTimer({ sessions: { today: [assigned], pending: [pending] } })
    expect(screen.getByText('NLP 论文精读')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /稍后分配 2026-08-20 07:55 的 10:00 计时记录/ }))
    expect(props.onAssign).toHaveBeenCalledWith('pending-1')
    const discard = screen.getByRole('button', { name: /丢弃 2026-08-20 07:55 的 10:00 计时记录/ })
    await userEvent.click(discard)
    expect(screen.getByRole('dialog', { name: '丢弃这段计时？' })).toBeTruthy()
    expect(screen.getByText('该记录尚未分配，丢弃后无法恢复。')).toBeTruthy()
    expect(props.onDiscard).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '丢弃这段计时？' })).toBeNull()
    await userEvent.click(discard)
    await userEvent.click(screen.getByRole('button', { name: '确认丢弃' }))
    expect(props.onDiscard).toHaveBeenCalledWith('pending-1')
  })

  it('shows a pending session from today once and reserves the cross-date list for older sessions', () => {
    const todayPending = {
      id: 'today-pending', mode: 'elapsed' as const, status: 'pending' as const,
      startedAt: '2026-08-20T08:00:00.000Z', endedAt: '2026-08-20T08:10:00.000Z', durationSeconds: 600
    }
    const olderPending = {
      ...todayPending,
      id: 'older-pending',
      startedAt: '2026-08-19T08:00:00.000Z', endedAt: '2026-08-19T08:05:00.000Z', durationSeconds: 300
    }
    renderTimer({ sessions: { today: [todayPending], pending: [todayPending, olderPending] } })

    const today = screen.getByRole('heading', { name: '今日记录' }).closest('section') as HTMLElement
    const crossDate = screen.getByRole('heading', { name: '跨日待分配' }).closest('section') as HTMLElement
    expect(within(today).getByText('1 段 · 10:00')).toBeTruthy()
    expect(within(today).getAllByText('待分配')).toHaveLength(1)
    expect(within(today).getByRole('button', { name: /分配 2026-08-20 16:00 的 10:00 计时记录/ })).toBeTruthy()
    expect(within(today).getByRole('button', { name: /丢弃 2026-08-20 16:00 的 10:00 计时记录/ })).toBeTruthy()
    expect(within(crossDate).getByText('1 段')).toBeTruthy()
    expect(within(crossDate).getByRole('button', { name: /稍后分配 2026-08-19 16:00 的 05:00 计时记录/ })).toBeTruthy()
    expect(within(crossDate).getByRole('button', { name: /丢弃 2026-08-19 16:00 的 05:00 计时记录/ })).toBeTruthy()
  })

  it('renders cross-date session dates in the local timezone instead of UTC', () => {
    const afterLocalMidnight = {
      id: 'local-midnight', mode: 'elapsed' as const, status: 'pending' as const,
      startedAt: '2026-08-19T15:55:00.000Z', endedAt: '2026-08-19T16:05:00.000Z', durationSeconds: 600
    }
    renderTimer({ sessions: { today: [], pending: [afterLocalMidnight] } })

    const crossDate = screen.getByRole('heading', { name: '跨日待分配' }).closest('section') as HTMLElement
    expect(within(crossDate).getByText('2026-08-20')).toBeTruthy()
    expect(within(crossDate).queryByText('2026-08-19')).toBeNull()
  })
})
