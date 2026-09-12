// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MotionProvider } from './motion'
import { TimerTaskPicker } from './TimerTaskPicker'
import type { StudyTask } from './studyTask'

const task = (id: string, patch: Partial<StudyTask> = {}): StudyTask => ({
  id, date: '2026-09-02', originalDate: '2026-09-02', category: 'NLP', title: id,
  deliverable: '', planned: 60, actual: 15, state: 'planned', evidence: [], notes: '', outcomes: '', ...patch
})
const tasks = [task('NLP'), task('gym', { title: '力量训练', category: '健身' })]
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

describe('TimerTaskPicker', () => {
  it('selects by keyboard and releases the menu and focus on Escape', async () => {
    const onChange = vi.fn()
    render(<MotionProvider><TimerTaskPicker tasks={tasks} value={null} disabled={false} onChange={onChange} /></MotionProvider>)
    const trigger = screen.getByRole('combobox', { name: '关联任务' })
    trigger.focus()
    await userEvent.keyboard('{ArrowDown}{End}{Enter}')
    expect(onChange).toHaveBeenCalledWith({ date: '2026-09-02', taskId: 'gym', taskTitle: '力量训练' })
    expect(document.activeElement).toBe(trigger)
    await userEvent.keyboard('{ArrowDown}{Escape}')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })
  it('supports pointer selection, Home clear and case-insensitive typeahead', async () => {
    const onChange = vi.fn()
    render(<MotionProvider><TimerTaskPicker tasks={tasks} value={tasks[1] && { date: tasks[1].date, taskId: 'gym', taskTitle: '力量训练' }} disabled={false} onChange={onChange} /></MotionProvider>)
    const trigger = screen.getByRole('combobox')
    await userEvent.click(trigger)
    expect(screen.getByRole('option', { name: /力量训练/ }).getAttribute('aria-selected')).toBe('true')
    await userEvent.click(screen.getByRole('option', { name: /NLP/ }))
    expect(onChange).toHaveBeenLastCalledWith({ date: '2026-09-02', taskId: 'NLP', taskTitle: 'NLP' })
    await userEvent.keyboard('{ArrowDown}{Home}{Enter}')
    expect(onChange).toHaveBeenLastCalledWith(null)
    await userEvent.keyboard('nl{Enter}')
    expect(onChange).toHaveBeenLastCalledWith({ date: '2026-09-02', taskId: 'NLP', taskTitle: 'NLP' })
  })
  it('closes on Tab and outside clicks without stealing the destination focus', async () => {
    render(<MotionProvider><TimerTaskPicker tasks={tasks} value={null} disabled={false} onChange={vi.fn()} /><button>后续操作</button></MotionProvider>)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.tab()
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '后续操作' }))
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.click(screen.getByRole('button', { name: '后续操作' }))
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '后续操作' }))
  })
  it('retains missing intent labels and safely closes when disabled', async () => {
    const value = { date: '2026-09-02', taskId: 'deleted', taskTitle: '已移除的任务' }
    const onChange = vi.fn()
    const { rerender } = render(<TimerTaskPicker tasks={[]} value={value} disabled={false} onChange={onChange} />)
    expect(screen.getByText('任务不可用')).toBeTruthy()
    await userEvent.click(screen.getByRole('combobox'))
    expect(screen.getAllByRole('option')).toHaveLength(1)
    expect(screen.getByText('今日暂无可关联任务')).toBeTruthy()
    rerender(<TimerTaskPicker tasks={[]} value={value} disabled onChange={onChange} />)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
  })
  it('ignores queued scroll events but closes when the anchor actually moves', async () => {
    render(<TimerTaskPicker tasks={tasks} value={null} disabled={false} onChange={vi.fn()} />)
    const trigger = screen.getByRole('combobox')
    let top = 100
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => ({ left: 100, top, bottom: top + 42, width: 250, height: 42, right: 350, x: 100, y: top, toJSON: () => ({}) }))
    await userEvent.click(trigger)
    fireEvent.scroll(document)
    expect(screen.getByRole('listbox')).toBeTruthy()
    top = 120
    fireEvent.scroll(document)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
  it('removes the portal and event handlers when unmounted', async () => {
    const { unmount } = render(<TimerTaskPicker tasks={tasks} value={null} disabled={false} onChange={vi.fn()} />)
    await userEvent.click(screen.getByRole('combobox'))
    unmount()
    fireEvent.scroll(document)
    fireEvent.resize(window)
    expect(screen.queryByRole('listbox')).toBeNull()
  })
  it('repositions on resize, preserves long labels, and reverses a quick close and reopen', async () => {
    const longTitle = '自然语言处理实验与误差分析'.repeat(12)
    render(<MotionProvider><TimerTaskPicker tasks={[task('long', { title: longTitle })]} value={null} disabled={false} onChange={vi.fn()} /></MotionProvider>)
    const trigger = screen.getByRole('combobox')
    let left = 500
    vi.spyOn(trigger, 'getBoundingClientRect').mockImplementation(() => ({ left, top: 100, bottom: 142, width: 250, height: 42, right: left + 250, x: left, y: 100, toJSON: () => ({}) }))
    await userEvent.click(trigger)
    const menu = screen.getByRole('listbox')
    expect(screen.getByRole('option', { name: new RegExp(longTitle) }).textContent).toContain(longTitle)
    const previousLeft = menu.style.left
    left = 100
    fireEvent.resize(window)
    expect(menu.style.left).not.toBe(previousLeft)
    fireEvent.keyDown(trigger, { key: 'Escape' })
    fireEvent.click(trigger)
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
    expect(screen.getByRole('listbox').closest('[inert]')).toBeNull()
  })
})
