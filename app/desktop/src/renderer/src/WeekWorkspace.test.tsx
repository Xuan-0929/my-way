// @vitest-environment jsdom
import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WeekPlanningContext } from '../../shared/api'
import type { WeeklyPlan } from '../../shared/schemas'
import { WeekWorkspace } from './WeekWorkspace'
import { newWeekDraft, type WeekDraft } from './weekDraft'

vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: ({ value, onChange, label }: { value: string; onChange: (value: string) => void; label?: string }) => (
    <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  )
}))

const summary = {
  timeRecords: [],
  plannedMinutes: 300,
  actualMinutes: 120,
  fitnessPlannedMinutes: 90,
  fitnessActualMinutes: 60,
  completedTasks: 1,
  totalTasks: 2,
  completionRate: 50,
  evidenceCount: 2,
  byCategory: { exam: 60, nlp: 60, english: 0, japanese: 0, fitness: 60 },
  pastExams: [],
  taskOutcomes: [{ date: '2026-09-01', taskId: 'nlp-01', title: '复现注意力', category: 'nlp' as const, outcomes: 'macro-F1 提升到 0.82' }],
  reflections: [{ date: '2026-09-01', learned: '理清了 Transformer 残差连接', blockers: '概率论证明仍不稳定', tomorrow: '重做两道条件概率题' }]
}

const previousPlan: WeeklyPlan = {
  schemaVersion: 1,
  week: 1,
  startDate: '2026-08-17',
  endDate: '2026-08-23',
  tasks: [
    { id: 'nlp-baseline', date: '2026-08-19', category: 'nlp', title: '完成 NLP 基线', plannedMinutes: 120, deliverable: 'evidence/nlp.md' },
    { id: 'exam-done', date: '2026-08-20', category: 'exam', title: '已完成过去问', plannedMinutes: 90, deliverable: 'evidence/exam.md' }
  ]
}

const context: WeekPlanningContext = {
  date: '2026-09-01',
  startDate: '2026-08-31',
  endDate: '2026-09-06',
  suggestedWeek: 3,
  current: null,
  previous: {
    document: { path: '00-dashboard/weeks/week-01.md', revision: 'a'.repeat(64), value: { plan: previousPlan, body: '# W1' } },
    tasks: [
      { task: previousPlan.tasks[0], state: 'planned', actualMinutes: 30, evidenceCount: 1 },
      { task: previousPlan.tasks[1], state: 'done', actualMinutes: 90, evidenceCount: 1 }
    ],
    summary
  },
  summary
}

function Harness({ mode = 'plan', onSave = vi.fn(), onDiscard = vi.fn(), onOpenDay = vi.fn(), value = context }: { mode?: 'plan' | 'review'; onSave?: (draft: WeekDraft) => void; onDiscard?: () => void; onOpenDay?: (date: string, taskId?: string) => void; value?: WeekPlanningContext }) {
  const [draft, setDraft] = useState(() => newWeekDraft(value))
  return <WeekWorkspace
    context={value}
    draft={draft}
    dirty
    saveStatus="idle"
    error={null}
    mode={mode}
    onModeChange={vi.fn()}
    onDraftChange={setDraft}
    onSave={onSave}
    onDiscard={onDiscard}
    onOpenDay={onOpenDay}
  />
}

afterEach(cleanup)

describe('WeekWorkspace', () => {
  it('duplicates a weekly task through an editable template with an independent id', async () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: '新增任务' }))
    fireEvent.change(screen.getByLabelText('任务标题'), { target: { value: '训练' } })
    await userEvent.click(screen.getByRole('button', { name: '复制 训练' }))
    const dialog = screen.getByRole('dialog', { name: '复制任务' })
    expect(within(dialog).queryByLabelText('任务备注')).toBeNull()
    fireEvent.change(within(dialog).getByLabelText('任务标题'), { target: { value: '第二次训练' } })
    fireEvent.change(within(dialog).getByLabelText('计划分钟'), { target: { value: '150' } })
    await userEvent.click(within(dialog).getByRole('button', { name: '创建副本' }))
    await userEvent.click(screen.getByRole('button', { name: '保存本周计划' }))
    const tasks = onSave.mock.calls[0][0].plan.tasks
    expect(tasks).toHaveLength(2)
    expect(tasks[1]).toMatchObject({ title: '第二次训练', plannedMinutes: 150 })
    expect(tasks[1].id).not.toBe(tasks[0].id)
    expect(tasks[0].title).toBe('训练')
  })

  it('allows empty minute drafts but refuses a weekly save until corrected', async () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)
    await userEvent.click(screen.getByRole('button', { name: '新增任务' }))
    fireEvent.change(screen.getByLabelText('任务标题'), { target: { value: '新任务' } })
    const input = screen.getByLabelText('计划分钟') as HTMLInputElement
    await userEvent.click(input)
    await userEvent.keyboard('{End}{Backspace}{Backspace}')
    expect(input.value).toBe('')
    await userEvent.click(screen.getByRole('button', { name: '保存本周计划' }))
    expect(onSave).not.toHaveBeenCalled()
    await userEvent.type(input, '150')
    await userEvent.click(screen.getByRole('button', { name: '保存本周计划' }))
    expect(onSave.mock.calls[0][0].plan.tasks[0].plannedMinutes).toBe(150)
  })

  it('shows the real week and keeps every previous task opt-in', async () => {
    render(<Harness />)

    expect(screen.getByRole('heading', { name: '第 3 周' })).toBeTruthy()
    expect(screen.getByRole('group', { name: '本周页面模式' })).toBeTruthy()
    expect(screen.getByText('8 月 31 日 — 9 月 6 日')).toBeTruthy()
    expect(screen.queryByDisplayValue('完成 NLP 基线')).toBeNull()
    const choice = screen.getByRole('checkbox', { name: '选择 完成 NLP 基线' }) as HTMLInputElement
    expect(choice.checked).toBe(false)
    expect(screen.queryByRole('checkbox', { name: '选择 已完成过去问' })).toBeNull()

    await userEvent.click(choice)
    await userEvent.click(screen.getByRole('button', { name: '加入草案' }))
    expect(screen.getByDisplayValue('完成 NLP 基线')).toBeTruthy()
    expect(screen.getByDisplayValue('2026-09-02')).toBeTruthy()
  })

  it('supports add, edit, move, delete, Markdown and an explicit valid first save', async () => {
    const onSave = vi.fn()
    render(<Harness onSave={onSave} />)

    await userEvent.click(screen.getByRole('button', { name: '新增任务' }))
    const row = screen.getByTestId('week-task-row')
    const titleInput = within(row).getByLabelText('任务标题')
    expect(within(row).getByText('任务标题不能为空')).toBeTruthy()
    expect(titleInput.getAttribute('aria-invalid')).toBe('true')
    expect(titleInput.getAttribute('aria-describedby')).toBeTruthy()
    expect(screen.queryByText(/Invalid input|Too small/)).toBeNull()
    expect((screen.getByRole('button', { name: '保存本周计划' }) as HTMLButtonElement).disabled).toBe(true)

    fireEvent.change(titleInput, { target: { value: '线性代数诊断' } })
    expect(titleInput.getAttribute('aria-invalid')).toBe('false')
    expect(within(row).queryByText('任务标题不能为空')).toBeNull()
    fireEvent.change(within(row).getByLabelText('任务日期'), { target: { value: '2026-09-01' } })
    fireEvent.change(within(row).getByLabelText('任务类别'), { target: { value: 'exam' } })
    fireEvent.change(within(row).getByLabelText('计划分钟'), { target: { value: '180' } })
    fireEvent.change(within(row).getByLabelText('预期产物'), { target: { value: 'evidence/math.md' } })
    fireEvent.change(screen.getByLabelText('周说明'), { target: { value: '# 可执行的第三周' } })

    expect((screen.getByRole('button', { name: '保存本周计划' }) as HTMLButtonElement).disabled).toBe(false)
    await userEvent.click(screen.getByRole('button', { name: '保存本周计划' }))
    expect(onSave).toHaveBeenCalledOnce()
    expect(row.getAttribute('data-motion-id')).toBe(onSave.mock.calls[0][0].plan.tasks[0].id)
    expect(onSave.mock.calls[0][0]).toMatchObject({
      body: '# 可执行的第三周',
      plan: { tasks: [{ title: '线性代数诊断', date: '2026-09-01', category: 'exam', plannedMinutes: 180, deliverable: 'evidence/math.md' }] }
    })

    await userEvent.click(within(row).getByRole('button', { name: '删除 线性代数诊断' }))
    expect(screen.getByRole('dialog', { name: '删除本周任务？' })).toBeTruthy()
    expect(screen.getByText('“线性代数诊断”将从本周计划移除。已经生成的每日记录不会改变。')).toBeTruthy()
    expect(screen.getByDisplayValue('线性代数诊断')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '删除本周任务？' })).toBeNull()
    expect(screen.getByDisplayValue('线性代数诊断')).toBeTruthy()
    await userEvent.click(within(row).getByRole('button', { name: '删除 线性代数诊断' }))
    await userEvent.click(screen.getByRole('button', { name: '删除任务' }))
    expect(screen.queryByDisplayValue('线性代数诊断')).toBeNull()
  })

  it('derives separate study and fitness plan totals from the current cards', async () => {
    render(<Harness />)

    await userEvent.click(screen.getByRole('button', { name: '新增任务' }))
    const budget = screen.getByLabelText('本周计划时长')
    expect(within(budget).getByLabelText('学习计划总时长').textContent).toContain('1 小时')
    expect(within(budget).getByLabelText('健身计划总时长').textContent).toContain('0 分钟')

    await userEvent.selectOptions(within(screen.getByTestId('week-task-row')).getByLabelText('任务类别'), 'fitness')
    expect(within(budget).getByLabelText('学习计划总时长').textContent).toContain('0 分钟')
    expect(within(budget).getByLabelText('健身计划总时长').textContent).toContain('1 小时')
  })

  it('renders review metrics from the provided context without invented progress', () => {
    render(<Harness mode="review" />)

    expect(screen.getByLabelText('本周复盘').classList.contains('week-mode-content')).toBe(true)
    const metrics = document.querySelector('.week-review-metrics') as HTMLElement
    expect(within(metrics).getByText('5 小时')).toBeTruthy()
    expect(within(metrics).getByText('2 小时')).toBeTruthy()
    const fitnessPlanMetric = within(metrics).getByText('健身计划').parentElement as HTMLElement
    const fitnessActualMetric = within(metrics).getByText('健身实际').parentElement as HTMLElement
    expect(within(fitnessPlanMetric).getByText('1 小时 30 分钟')).toBeTruthy()
    expect(within(fitnessActualMetric).getByText('1 小时')).toBeTruthy()
    expect(screen.getByText('1 / 2')).toBeTruthy()
    expect(screen.getByText('50%')).toBeTruthy()
    expect(screen.getByText('2 项')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '任务成果' })).toBeTruthy()
    expect(screen.getByText('macro-F1 提升到 0.82')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '日终复盘' })).toBeTruthy()
    expect(screen.getByText('理清了 Transformer 残差连接')).toBeTruthy()
    expect(screen.getByText('概率论证明仍不稳定')).toBeTruthy()
    expect(screen.getByText('重做两道条件概率题')).toBeTruthy()
    expect(screen.queryByText('连续学习')).toBeNull()
  })

  it('opens the source daily record from a reflection date', async () => {
    const onOpenDay = vi.fn()
    render(<Harness mode="review" onOpenDay={onOpenDay} />)

    await userEvent.click(screen.getByRole('button', { name: '打开 2026-09-01 日终复盘记录' }))
    expect(onOpenDay).toHaveBeenCalledWith('2026-09-01')
  })

  it('opens the exact task detail from a weekly outcome title', async () => {
    const onOpenDay = vi.fn()
    render(<Harness mode="review" onOpenDay={onOpenDay} />)

    await userEvent.click(screen.getByRole('button', { name: '打开 2026-09-01 复现注意力任务详情' }))
    expect(onOpenDay).toHaveBeenCalledWith('2026-09-01', 'nlp-01')
  })

  it('shows concise actual-time and completion-rate deltas from the previous week', () => {
    const current = {
      ...context,
      summary: { ...summary, actualMinutes: 240, completionRate: 75 }
    }
    render(<Harness mode="review" value={current} />)

    expect(screen.getByText('实际时间变化')).toBeTruthy()
    expect(screen.getByText('+2 小时')).toBeTruthy()
    expect(screen.getByText('达标 / 完成率变化')).toBeTruthy()
    expect(screen.getByText('+25 个百分点')).toBeTruthy()
  })

  it('uses an in-app confirmation before discarding a weekly draft', async () => {
    const onDiscard = vi.fn()
    render(<Harness onDiscard={onDiscard} />)

    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    expect(screen.getByRole('dialog', { name: '放弃本周草案？' })).toBeTruthy()
    expect(onDiscard).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('dialog', { name: '放弃本周草案？' })).toBeNull()

    await userEvent.click(screen.getByRole('button', { name: '放弃修改' }))
    await userEvent.click(screen.getByRole('button', { name: '放弃草案' }))
    expect(onDiscard).toHaveBeenCalledOnce()
  })
})
