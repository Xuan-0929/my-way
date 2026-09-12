// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TaskDetailView } from './TaskDetailView'
import { DeleteTaskDialog } from './DeleteTaskDialog'
import type { StudyTask } from './studyTask'

vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: ({ value, onChange, label }: { value: string; onChange: (value: string) => void; label?: string }) => (
    <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  )
}))

const task: StudyTask = {
  id: 'nlp-01',
  date: '2026-08-17',
  originalDate: '2026-08-17',
  category: 'NLP',
  title: '实现文本分类基线',
  deliverable: 'notebooks/baseline.ipynb',
  planned: 120,
  actual: 35,
  state: 'in_progress',
  evidence: ['notebooks/baseline.ipynb'],
  notes: '比较不同分词方式',
  outcomes: '完成第一个基线'
}

afterEach(cleanup)

describe('TaskDetailView', () => {
  it('keeps an empty planned-minute draft editable in details', async () => {
    render(<TaskDetailView task={task} evidenceStatus={{}} onChange={vi.fn()} onBack={vi.fn()} onRequestDelete={vi.fn()} onSelectEvidence={vi.fn()} onReplaceEvidence={vi.fn()} onRemoveEvidence={vi.fn()} onOpenEvidence={vi.fn()} />)
    await userEvent.click(screen.getByText('任务信息'))
    const input = screen.getByLabelText('计划分钟') as HTMLInputElement
    await userEvent.click(input)
    await userEvent.keyboard('{End}{Backspace}{Backspace}{Backspace}')
    expect(input.value).toBe('')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    await userEvent.type(input, '150')
    expect(input.value).toBe('150')
  })

  it('edits every task field through the shared update callback', async () => {
    const onChange = vi.fn()
    render(<TaskDetailView task={task} evidenceStatus={{}} onChange={onChange} onBack={vi.fn()} onRequestDelete={vi.fn()} onSelectEvidence={vi.fn()} onReplaceEvidence={vi.fn()} onRemoveEvidence={vi.fn()} onOpenEvidence={vi.fn()} />)

    await userEvent.clear(screen.getByRole('textbox', { name: '任务标题' }))
    await userEvent.type(screen.getByRole('textbox', { name: '任务标题' }), '新的标题')
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ title: expect.any(String) }))

    const notes = screen.getByLabelText('任务备注')
    expect(screen.getByRole('spinbutton', { name: '计划分钟' })).toBeTruthy()
    expect(screen.getByRole('spinbutton', { name: '实际分钟' })).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '任务标题' }).tagName).toBe('TEXTAREA')
    expect(screen.getByLabelText('任务备注')).toBe(notes)
    fireEvent.change(screen.getByLabelText('任务类别'), { target: { value: '英语' } })
    fireEvent.change(screen.getByLabelText('任务日期'), { target: { value: '2026-08-18' } })
    fireEvent.change(screen.getByLabelText('计划分钟'), { target: { value: '90' } })
    fireEvent.change(screen.getByLabelText('实际分钟'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('预期产物'), { target: { value: 'notes/result.md' } })
    fireEvent.change(screen.getByLabelText('任务备注'), { target: { value: '新的备注' } })
    fireEvent.change(screen.getByLabelText('学习成果'), { target: { value: '新的成果' } })

    expect(onChange).toHaveBeenCalledWith({ category: '英语' })
    fireEvent.change(screen.getByLabelText('任务类别'), { target: { value: '健身' } })
    expect(onChange).toHaveBeenCalledWith({ category: '健身' })
    expect(onChange).toHaveBeenCalledWith({ date: '2026-08-18' })
    expect(onChange).toHaveBeenCalledWith({ planned: 90 })
    expect(onChange).toHaveBeenCalledWith({ actual: 60 })
    expect(onChange).toHaveBeenCalledWith({ deliverable: 'notes/result.md' })
    expect(onChange).toHaveBeenCalledWith({ notes: '新的备注' })
    expect(onChange).toHaveBeenCalledWith({ outcomes: '新的成果' })
  })

  it('supports returning, evidence actions, and requesting deletion', async () => {
    const onBack = vi.fn()
    const onRequestDelete = vi.fn()
    const onSelectEvidence = vi.fn()
    const onOpenEvidence = vi.fn()
    render(<TaskDetailView task={task} evidenceStatus={{}} onChange={vi.fn()} onBack={onBack} onRequestDelete={onRequestDelete} onSelectEvidence={onSelectEvidence} onReplaceEvidence={vi.fn()} onRemoveEvidence={vi.fn()} onOpenEvidence={onOpenEvidence} />)

    await userEvent.click(screen.getByRole('button', { name: '返回今天' }))
    await userEvent.click(screen.getByRole('button', { name: '添加证据' }))
    await userEvent.click(screen.getByRole('button', { name: '打开 baseline.ipynb' }))
    await userEvent.click(screen.getByRole('button', { name: '删除任务' }))

    expect(onBack).toHaveBeenCalledOnce()
    expect(onSelectEvidence).toHaveBeenCalledOnce()
    expect(onOpenEvidence).toHaveBeenCalledWith('notebooks/baseline.ipynb')
    expect(onRequestDelete).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: '删除任务' }).closest('.task-detail-toolbar')).toBeNull()
    expect(screen.getByRole('main').lastElementChild).toContainElement(screen.getByRole('button', { name: '删除任务' }))
  })

  it('starts focus for an eligible task and opens an existing timer without creating another', async () => {
    const onStartFocus = vi.fn()
    const onOpenTimer = vi.fn()
    const { rerender } = render(<TaskDetailView
      task={task}
      evidenceStatus={{}}
      canStartFocus
      timerActive={false}
      onStartFocus={onStartFocus}
      onOpenTimer={onOpenTimer}
      onChange={vi.fn()}
      onBack={vi.fn()}
      onRequestDelete={vi.fn()}
      onSelectEvidence={vi.fn()}
      onReplaceEvidence={vi.fn()}
      onRemoveEvidence={vi.fn()}
      onOpenEvidence={vi.fn()}
    />)

    await userEvent.click(screen.getByRole('button', { name: '开始专注' }))
    expect(onStartFocus).toHaveBeenCalledOnce()
    expect(onOpenTimer).not.toHaveBeenCalled()

    rerender(<TaskDetailView
      task={task}
      evidenceStatus={{}}
      canStartFocus
      timerActive
      onStartFocus={onStartFocus}
      onOpenTimer={onOpenTimer}
      onChange={vi.fn()}
      onBack={vi.fn()}
      onRequestDelete={vi.fn()}
      onSelectEvidence={vi.fn()}
      onReplaceEvidence={vi.fn()}
      onRemoveEvidence={vi.fn()}
      onOpenEvidence={vi.fn()}
    />)
    expect(screen.queryByRole('button', { name: '开始专注' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '查看计时' }))
    expect(onOpenTimer).toHaveBeenCalledOnce()
  })

  it('keeps the focus action in place and disables it while start is pending', () => {
    render(<TaskDetailView
      task={task}
      evidenceStatus={{}}
      canStartFocus
      focusStarting
      onStartFocus={vi.fn()}
      onChange={vi.fn()}
      onBack={vi.fn()}
      onRequestDelete={vi.fn()}
      onSelectEvidence={vi.fn()}
      onReplaceEvidence={vi.fn()}
      onRemoveEvidence={vi.fn()}
      onOpenEvidence={vi.fn()}
    />)

    const pending = screen.getByRole('button', { name: '正在开始…' }) as HTMLButtonElement
    expect(pending.disabled).toBe(true)
    expect(screen.queryByRole('button', { name: '开始专注' })).toBeNull()
  })

  it('marks broken evidence and offers replacement or reference removal without opening it', async () => {
    const onReplaceEvidence = vi.fn()
    const onRemoveEvidence = vi.fn()
    const onOpenEvidence = vi.fn()
    render(<TaskDetailView
      task={task}
      evidenceStatus={{ 'notebooks/baseline.ipynb': { path: 'notebooks/baseline.ipynb', status: 'missing', message: '文件不存在' } }}
      onChange={vi.fn()}
      onBack={vi.fn()}
      onRequestDelete={vi.fn()}
      onSelectEvidence={vi.fn()}
      onReplaceEvidence={onReplaceEvidence}
      onRemoveEvidence={onRemoveEvidence}
      onOpenEvidence={onOpenEvidence}
    />)

    expect(screen.getByText('文件缺失')).toBeTruthy()
    expect((screen.getByRole('button', { name: '打开 baseline.ipynb' }) as HTMLButtonElement).disabled).toBe(true)
    await userEvent.click(screen.getByRole('button', { name: '替换 baseline.ipynb' }))
    await userEvent.click(screen.getByRole('button', { name: '移除 baseline.ipynb 引用' }))
    expect(onReplaceEvidence).toHaveBeenCalledWith('notebooks/baseline.ipynb')
    expect(onRemoveEvidence).toHaveBeenCalledWith('notebooks/baseline.ipynb')
    expect(onOpenEvidence).not.toHaveBeenCalled()
  })
})

describe('DeleteTaskDialog', () => {
  it('describes weekly deletion, focuses cancel, and cancels with Escape', async () => {
    const onCancel = vi.fn()
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const view = render(<DeleteTaskDialog taskTitle={task.title} sourceWeek={1} pending={false} onCancel={onCancel} onConfirm={vi.fn()} />)

    expect(screen.getByText(/week-01\.md/)).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    const descriptionId = dialog.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId as string)?.textContent).toContain('week-01.md')
    expect(screen.queryByText('DELETE TASK')).toBeNull()
    expect(screen.getByRole('button', { name: '取消' })).toBe(document.activeElement)
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: '确认删除' })).toBe(document.activeElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    view.unmount()
    expect(opener).toBe(document.activeElement)
    opener.remove()
  })

  it('describes a manual-only deletion and confirms explicitly', async () => {
    const onConfirm = vi.fn()
    render(<DeleteTaskDialog taskTitle={task.title} sourceWeek={null} pending={false} onCancel={vi.fn()} onConfirm={onConfirm} />)
    expect(screen.getByText(/只会从当天记录删除/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('keeps focus inside the dialog while deletion is pending', async () => {
    render(<DeleteTaskDialog taskTitle={task.title} sourceWeek={1} pending={true} onCancel={vi.fn()} onConfirm={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.getAttribute('aria-busy')).toBe('true')
    expect(dialog).toBe(document.activeElement)
    await userEvent.tab()
    expect(dialog).toBe(document.activeElement)
  })
})
