// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PastExam } from '../../shared/schemas'
import { PastExamSection } from './PastExamSection'

const exam: PastExam = {
  id: 'past-exam-1',
  date: '2026-09-01',
  subject: '数学',
  paper: '2025 数学模拟卷',
  score: 62,
  maxScore: 100
}

afterEach(cleanup)

describe('PastExamSection', () => {
  it('adds a valid past-exam result as one record update', async () => {
    const onChange = vi.fn()
    render(<PastExamSection date="2026-09-01" exams={[]} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '添加过去问记录' }))
    expect(screen.getByRole('heading', { name: '新增过去问记录' })).toBeTruthy()
    const dialog = screen.getByRole('dialog')
    const descriptionId = dialog.getAttribute('aria-describedby')
    expect(descriptionId).toBeTruthy()
    expect(document.getElementById(descriptionId as string)?.textContent).toContain('保存到当天学习记录')
    await userEvent.type(screen.getByLabelText('科目'), '专业基础')
    await userEvent.type(screen.getByLabelText('试卷'), '2025 专业基础模拟卷')
    await userEvent.clear(screen.getByLabelText('得分'))
    await userEvent.type(screen.getByLabelText('得分'), '73.5')
    await userEvent.keyboard('{Enter}')

    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange.mock.calls[0][0]).toEqual([
      expect.objectContaining({ date: '2026-09-01', subject: '专业基础', paper: '2025 专业基础模拟卷', score: 73.5, maxScore: 100 })
    ])
  })

  it('keeps the editor open and explains an invalid score', async () => {
    const onChange = vi.fn()
    render(<PastExamSection date="2026-09-01" exams={[]} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '添加过去问记录' }))
    await userEvent.type(screen.getByLabelText('科目'), '数学')
    await userEvent.type(screen.getByLabelText('试卷'), '2025 模拟卷')
    await userEvent.clear(screen.getByLabelText('得分'))
    await userEvent.type(screen.getByLabelText('得分'), '110')
    await userEvent.click(screen.getByRole('button', { name: '保存记录' }))

    const alert = screen.getByRole('alert')
    const score = screen.getByLabelText('得分')
    expect(alert.textContent).toContain('成绩不能超过满分')
    expect(score.getAttribute('aria-invalid')).toBe('true')
    expect(document.getElementById(score.getAttribute('aria-describedby') as string)).toBe(alert)
    expect(score).toBe(document.activeElement)
    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('edits an existing result without changing its id', async () => {
    const onChange = vi.fn()
    render(<PastExamSection date="2026-09-01" exams={[exam]} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '编辑过去问记录：数学 · 2025 数学模拟卷' }))
    await userEvent.clear(screen.getByLabelText('得分'))
    await userEvent.type(screen.getByLabelText('得分'), '78')
    await userEvent.click(screen.getByRole('button', { name: '保存记录' }))

    expect(onChange).toHaveBeenCalledWith([{ ...exam, score: 78 }])
  })

  it('requires a second explicit action before deleting a result', async () => {
    const onChange = vi.fn()
    render(<PastExamSection date="2026-09-01" exams={[exam]} onChange={onChange} />)

    await userEvent.click(screen.getByRole('button', { name: '编辑过去问记录：数学 · 2025 数学模拟卷' }))
    await userEvent.click(screen.getByRole('button', { name: '删除记录' }))
    expect(screen.getByText('删除这条过去问记录？')).toBeTruthy()
    expect(onChange).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '确认删除' }))

    expect(onChange).toHaveBeenCalledWith([])
  })
})
