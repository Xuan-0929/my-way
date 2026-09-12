// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { DesktopApi, FileWatchEvent, WeekDocument, WeekPlanningContext } from '../../shared/api'
import type { ParsedDailyRecord } from '../../shared/types'
import { App } from './App'

vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: ({ value, onChange, label = '学习笔记' }: { value: string; onChange: (value: string) => void; label?: string }) => (
    <textarea aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} />
  )
}))

const record = {
  schemaVersion: 1 as const,
  date: '2026-08-16',
  sourceWeek: null,
  tasks: [{
    id: 'real-task', date: '2026-08-16', originalDate: '2026-08-16', category: 'nlp' as const,
    title: '来自本地文件的真实任务', plannedMinutes: 90, deliverable: 'notes/real.md', actualMinutes: 15,
    status: 'in_progress' as const, evidence: [], notes: '', outcomes: ''
  }],
  reflection: { learned: '', blockers: '', tomorrow: '' },
  pastExams: [],
  updatedAt: '2026-08-16T08:00:00.000Z',
  notes: '本地笔记'
}

const emptySummary = {
  timeRecords: [],
  plannedMinutes: 0,
  actualMinutes: 0,
  fitnessPlannedMinutes: 0,
  fitnessActualMinutes: 0,
  completedTasks: 0,
  totalTasks: 0,
  completionRate: 0,
  evidenceCount: 0,
  byCategory: { exam: 0, nlp: 0, english: 0, japanese: 0, fitness: 0 },
  pastExams: [],
  taskOutcomes: [],
  reflections: []
}

const currentWeekDocument = (overrides: Partial<WeekDocument['value']['plan']> = {}): WeekDocument => ({
  path: '00-dashboard/weeks/week-03.md',
  revision: 'a'.repeat(64),
  value: {
    plan: {
      schemaVersion: 1,
      week: 3,
      startDate: '2026-08-31',
      endDate: '2026-09-06',
      tasks: [],
      ...overrides
    },
    body: '# 第 3 周\n'
  }
})

const planningContext = (current: WeekDocument | null = null): WeekPlanningContext => ({
  date: '2026-09-01',
  startDate: '2026-08-31',
  endDate: '2026-09-06',
  suggestedWeek: 3,
  current,
  previous: null,
  summary: emptySummary
})

const api = (hasWorkspace: boolean): DesktopApi => ({
  workspace: {
    get: vi.fn(async () => ({ ok: true, value: hasWorkspace ? { root: '/tmp/my-way' } : null })),
    select: vi.fn(async () => ({ ok: true, value: { root: '/tmp/my-way' } })),
    validate: vi.fn(async () => ({ ok: true, value: { root: '/tmp/my-way' } }))
  },
  task: { delete: vi.fn(async (payload) => ({ ok: true, value: { day: { ...payload.day, revision: 'r-deleted', value: { ...record, tasks: record.tasks.filter((task) => task.id !== payload.taskId) } } } })) },
  day: {
    open: vi.fn(async () => ({ ok: true, value: { file: { path: '/tmp/my-way/data/daily/2026/2026-08-16.md', revision: 'r1', value: record }, created: false, missingPlan: true } })),
    create: vi.fn(async () => ({ ok: true, value: { file: { path: '/tmp/day.md', revision: 'r1', value: record }, created: true, missingPlan: true } })),
    save: vi.fn(async (file) => ({ ok: true, value: { ...file, revision: 'r2' } })),
    resolveCarryover: vi.fn(async (payload) => ({ ok: true, value: { source: payload.source } }))
  },
  week: {
    load: vi.fn(async () => ({ ok: true, value: null })),
    diff: vi.fn(async () => ({ ok: true, value: null })),
    context: vi.fn(async () => ({ ok: true, value: planningContext() })),
    save: vi.fn(async (request) => ({ ok: true, value: { path: `00-dashboard/weeks/week-${String(request.plan.week).padStart(2, '0')}.md`, revision: 'b'.repeat(64), value: { plan: request.plan, body: request.body } } }))
  },
  route: { load: vi.fn(async () => ({ ok: true, value: [] })) },
  progress: { query: vi.fn(async () => ({ ok: true, value: { summary: emptySummary, month: [] } })) },
  evidence: {
    select: vi.fn(async () => ({ ok: true, value: null })),
    inspect: vi.fn(async (paths: string[]) => ({ ok: true, value: paths.map((path) => ({ path, status: 'available' as const })) })),
    open: vi.fn(async () => ({ ok: true, value: undefined }))
  },
  timer: {
    setTaskIntent: vi.fn(async () => ({ ok: true, value: { active: null, capturedAt: '2026-08-20T00:00:00.000Z' } })),
    get: vi.fn(async () => ({ ok: true, value: { active: null, capturedAt: '2026-08-20T00:00:00.000Z' } })),
    start: vi.fn(async () => ({ ok: true, value: { active: null, capturedAt: '2026-08-20T00:00:00.000Z' } })),
    pause: vi.fn(async () => ({ ok: true, value: { active: null, capturedAt: '2026-08-20T00:00:00.000Z' } })),
    resume: vi.fn(async () => ({ ok: true, value: { active: null, capturedAt: '2026-08-20T00:00:00.000Z' } })),
    end: vi.fn(async () => ({ ok: false, error: { code: 'NOT_FOUND', message: '当前没有计时器' } })),
    list: vi.fn(async () => ({ ok: true, value: { today: [], pending: [] } })),
    assignmentOptions: vi.fn(async () => ({ ok: false, error: { code: 'NOT_FOUND', message: '找不到计时会话' } })),
    assign: vi.fn(async () => ({ ok: false, error: { code: 'NOT_FOUND', message: '找不到计时会话' } })),
    discard: vi.fn(async () => ({ ok: true, value: { today: [], pending: [] } })),
    subscribe: vi.fn(() => () => undefined)
  },
  files: { subscribe: vi.fn(() => () => undefined) },
  lifecycle: { onBeforeClose: vi.fn(() => () => undefined), readyToClose: vi.fn(), cancelClose: vi.fn() }
} as unknown as DesktopApi)

beforeEach(() => { vi.stubGlobal('innerWidth', 1440) })
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  delete window.myWay
  vi.unstubAllGlobals()
})

describe('App desktop data flow', () => {
  it('opens an imported weekly calendar card independently from its drag handle', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 3, 12))
    try {
      const desktop = api(true)
      const task = { ...record.tasks[0], date: '2026-09-03', originalDate: '2026-09-03' }
      const week = currentWeekDocument({ tasks: [task] })
      const day = { ...record, date: task.date, tasks: [task] }
      desktop.day.open = vi.fn(async (date) => ({ ok: true as const, value: date === day.date ? { file: { path: '/tmp/day.md', revision: 'r1', value: day }, created: false, missingPlan: false } : null }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      desktop.progress.query = vi.fn(async () => ({ ok: true as const, value: { summary: { ...emptySummary, timeRecords: [day] }, month: [] } }))
      window.myWay = desktop
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await screen.findByRole('button', { name: `移动 ${task.title}` })
      await userEvent.click(screen.getByRole('button', { name: `打开任务详情：${task.title}` }))
      expect(await screen.findByRole('textbox', { name: '任务标题' })).toHaveProperty('value', task.title)
      expect(desktop.week.save).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('separates fitness from study in the calendar day load and identifies today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 3, 12))
    try {
      const desktop = api(true)
      const tasks = [
        { ...record.tasks[0], date: '2026-09-03', originalDate: '2026-09-03', plannedMinutes: 60 },
        { ...record.tasks[0], id: 'gym', date: '2026-09-03', originalDate: '2026-09-03', category: 'fitness' as const, plannedMinutes: 150 }
      ]
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: currentWeekDocument({ tasks }) }))
      window.myWay = desktop
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await waitFor(() => expect(document.querySelectorAll('.calendar-task')).toHaveLength(2))
      const column = document.querySelector('[data-calendar-date="2026-09-03"]')!
      expect(column.querySelector('.day-load')?.textContent).toContain('学习 1 小时')
      expect(column.querySelector('.day-load')?.textContent).toContain('健身 2 小时 30 分钟')
      expect(column.querySelector('[aria-current="date"]')).not.toBeNull()
    } finally { vi.useRealTimers() }
  })

  it.each([true, false])('shows newly created daily cards in the calendar with a weekly plan: %s', async (hasWeek) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 3, 12))
    try {
      const desktop = api(true)
      const week = hasWeek ? currentWeekDocument() : null
      let saved: ParsedDailyRecord = { ...record, date: '2026-09-03', tasks: [] }
      const opened = () => ({ file: { path: '/tmp/my-way/data/daily/2026/2026-09-03.md', revision: 'r1', value: saved }, created: false, missingPlan: !hasWeek })
      desktop.day.open = vi.fn(async () => ({ ok: true as const, value: opened() }))
      desktop.day.create = vi.fn(async () => ({ ok: true as const, value: opened() }))
      desktop.day.save = vi.fn(async (file) => {
        saved = file.value
        return { ok: true as const, value: { ...file, revision: 'r2' } }
      })
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      desktop.progress.query = vi.fn(async () => ({ ok: true as const, value: { summary: { ...emptySummary, timeRecords: [saved] }, month: [] } }))
      window.myWay = desktop
      render(<App />)

      for (const title of ['N1单词', 'N1语法']) {
        await userEvent.click(await screen.findByRole('button', { name: /添加一项任务/ }))
        const dialog = screen.getByRole('dialog', { name: '新建任务' })
        fireEvent.change(within(dialog).getByLabelText('任务标题'), { target: { value: title } })
        fireEvent.change(within(dialog).getByLabelText('任务类别'), { target: { value: 'japanese' } })
        fireEvent.change(within(dialog).getByLabelText('计划分钟'), { target: { value: '30' } })
        await userEvent.click(within(dialog).getByRole('button', { name: '创建任务' }))
        await userEvent.click(await screen.findByRole('button', { name: '保存并返回' }))
      }
      expect(saved.tasks).toHaveLength(2)
      await userEvent.click(screen.getByRole('button', { name: '日历' }))
      await waitFor(() => expect(document.querySelector('[data-calendar-date="2026-09-03"]')?.textContent).toContain('N1单词'))
      const day = document.querySelector('[data-calendar-date="2026-09-03"]')!
      expect(day.textContent).toContain('N1语法')
      expect(day.querySelectorAll('.calendar-task')).toHaveLength(2)
      expect(day.querySelector('.day-load')?.textContent).toContain('1 小时')
      expect(screen.queryByText(/日历暂时为空/)).toBeNull()
      expect(desktop.week.save).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads the full calendar week across a month boundary and refreshes daily cards after external edits', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 3, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      let listener: ((event: FileWatchEvent) => void) | undefined
      let title = '周一的手动任务'
      desktop.day.open = vi.fn(async (date) => ({ ok: true as const, value: date === '2026-09-03'
        ? { file: { path: '/tmp/my-way/data/daily/2026/2026-09-03.md', revision: 'r1', value: { ...record, date, tasks: [] } }, created: false, missingPlan: false } : null }))
      desktop.files.subscribe = vi.fn((callback) => { listener = callback; return () => undefined })
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.progress.query = vi.fn(async (from, to) => ({
        ok: true as const,
        value: { summary: { ...emptySummary, timeRecords: from <= '2026-08-31' && to >= '2026-08-31'
          ? [{ date: '2026-08-31', tasks: [{ ...record.tasks[0], date: '2026-08-31', originalDate: '2026-08-31', title }] }] : [] }, month: [] }
      }))
      window.myWay = desktop
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await waitFor(() => expect(document.querySelector('[data-calendar-date="2026-08-31"]')?.textContent).toContain(title))
      expect(desktop.progress.query).toHaveBeenCalledWith('2026-08-31', '2026-09-30')
      title = '外部更新后的手动任务'
      act(() => listener?.({ kind: 'changed', path: 'data/daily/2026/2026-08-31.md', at: new Date().toISOString() }))
      await waitFor(() => expect(document.querySelector('[data-calendar-date="2026-08-31"]')?.textContent).toContain(title))
      expect(document.querySelectorAll('.calendar-task')).toHaveLength(1)
      expect(desktop.day.create).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it.each([
    ['2026-11-30', '2026-11-01', '2026-12-06'],
    ['2027-01-01', '2026-12-28', '2027-01-31']
  ])('includes the adjacent month or year in the calendar query on %s', async (date, from, to) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(`${date}T12:00:00`))
    try {
      const desktop = api(true)
      desktop.day.open = vi.fn(async (requested) => ({ ok: true as const, value: requested === date
        ? { file: { path: `/tmp/my-way/data/daily/${date.slice(0, 4)}/${date}.md`, revision: 'r1', value: { ...record, date, tasks: [] } }, created: false, missingPlan: true } : null }))
      window.myWay = desktop
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await waitFor(() => expect(desktop.progress.query).toHaveBeenCalledWith(from, to))
      expect(desktop.day.create).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not close the app with an incomplete task form', async () => {
    const desktop = api(true)
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /添加一项任务/ }))
    fireEvent.change(screen.getByRole('dialog', { name: '新建任务' }).querySelector('input')!, { target: { value: '未确认的任务' } })
    act(() => vi.mocked(desktop.lifecycle.onBeforeClose).mock.calls[0][0]())
    await waitFor(() => expect(desktop.lifecycle.cancelClose).toHaveBeenCalled())
    expect(desktop.lifecycle.readyToClose).not.toHaveBeenCalled()
    expect(screen.getByDisplayValue('未确认的任务')).toBeTruthy()
    expect(desktop.day.save).not.toHaveBeenCalled()
  })

  it('does not close or save an empty planned-minute editor', async () => {
    const desktop = api(true)
    window.myWay = desktop
    render(<App />)
    const input = await screen.findByLabelText('来自本地文件的真实任务 计划分钟')
    await userEvent.clear(input)
    act(() => vi.mocked(desktop.lifecycle.onBeforeClose).mock.calls[0][0]())
    await waitFor(() => expect(desktop.lifecycle.cancelClose).toHaveBeenCalled())
    expect(desktop.lifecycle.readyToClose).not.toHaveBeenCalled()
    expect(desktop.day.save).not.toHaveBeenCalled()
    expect((input as HTMLInputElement).value).toBe('')
  })

  it('waits for the latest edit before save-and-return completes', async () => {
    const desktop = api(true)
    let finishSave!: () => void
    let writes = 0
    desktop.day.save = vi.fn(async (file) => {
      writes += 1
      if (writes === 1) await new Promise<void>((resolve) => { finishSave = resolve })
      return { ok: true as const, value: { ...file, revision: 'saved' } }
    })
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    fireEvent.change(screen.getByLabelText('任务备注'), { target: { value: '第一版' } })
    await userEvent.click(screen.getByRole('button', { name: '保存并返回' }))
    await waitFor(() => expect(desktop.day.save).toHaveBeenCalledOnce())
    expect(screen.getByRole('textbox', { name: '任务标题' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('任务备注'), { target: { value: '第二版' } })
    await act(async () => finishSave())
    await waitFor(() => expect(screen.queryByRole('textbox', { name: '任务标题' })).toBeNull())
    expect(vi.mocked(desktop.day.save).mock.calls.at(-1)?.[0].value.tasks[0].notes).toBe('第二版')
  })

  it('creates only after confirming upfront task fields and leaves no task on cancel', async () => {
    const desktop = api(true)
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /添加一项任务/ }))
    let dialog = screen.getByRole('dialog', { name: '新建任务' })
    fireEvent.change(within(dialog).getByLabelText('任务标题'), { target: { value: '背+胸' } })
    await userEvent.click(within(dialog).getByRole('button', { name: '取消' }))
    expect(desktop.day.save).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /添加一项任务/ }))
    dialog = screen.getByRole('dialog', { name: '新建任务' })
    fireEvent.change(within(dialog).getByLabelText('任务标题'), { target: { value: '背+胸' } })
    fireEvent.change(within(dialog).getByLabelText('任务类别'), { target: { value: 'fitness' } })
    fireEvent.change(within(dialog).getByLabelText('计划分钟'), { target: { value: '150' } })
    await userEvent.click(within(dialog).getByRole('button', { name: '创建任务' }))
    await screen.findByRole('textbox', { name: '任务标题' })
    expect(vi.mocked(desktop.day.save).mock.calls.at(-1)?.[0].value.tasks.at(-1)).toMatchObject({
      title: '背+胸', category: 'fitness', plannedMinutes: 150, actualMinutes: 0, status: 'planned'
    })
  })

  it('copies a task template without its progress, evidence or lineage', async () => {
    const desktop = api(true)
    const original = { ...record.tasks[0], sourceTaskId: 'week-source', notes: '组间休息', outcomes: '已完成训练', evidence: ['proof.md'], status: 'done' as const }
    desktop.day.open = vi.fn(async () => ({ ok: true as const, value: { file: { path: '/tmp/day.md', revision: 'r1', value: { ...record, tasks: [original] } }, created: false, missingPlan: true } }))
    desktop.day.create = vi.fn(async () => ({ ok: true as const, value: { file: { path: '/tmp/day.md', revision: 'r1', value: { ...record, tasks: [original] } }, created: false, missingPlan: true } }))
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '复制 来自本地文件的真实任务' }))
    const dialog = screen.getByRole('dialog', { name: '复制任务' })
    expect((within(dialog).getByLabelText('任务备注') as HTMLTextAreaElement).value).toBe('组间休息')
    fireEvent.change(within(dialog).getByLabelText('任务标题'), { target: { value: '第二次训练' } })
    await userEvent.click(within(dialog).getByRole('button', { name: '创建副本' }))
    await screen.findByDisplayValue('第二次训练')
    const saved = vi.mocked(desktop.day.save).mock.calls.at(-1)![0].value.tasks
    expect(saved[0]).toEqual(original)
    expect(saved[1]).toMatchObject({ title: '第二次训练', plannedMinutes: 90, notes: '组间休息', actualMinutes: 0, status: 'planned', evidence: [], outcomes: '' })
    expect(saved[1].id).not.toBe(original.id)
    expect(saved[1].sourceTaskId).toBeUndefined()
  })

  it('retains the new task form and input when creation fails', async () => {
    const desktop = api(true)
    desktop.day.save = vi.fn(async () => ({ ok: false as const, error: { code: 'IO' as const, message: '磁盘暂不可写' } }))
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: /添加一项任务/ }))
    const dialog = screen.getByRole('dialog', { name: '新建任务' })
    fireEvent.change(within(dialog).getByLabelText('任务标题'), { target: { value: '不要丢失' } })
    await userEvent.click(within(dialog).getByRole('button', { name: '创建任务' }))
    expect(await within(dialog).findByText('磁盘暂不可写')).toBeTruthy()
    expect((within(dialog).getByLabelText('任务标题') as HTMLInputElement).value).toBe('不要丢失')
    expect(screen.queryByRole('button', { name: '打开任务详情：不要丢失' })).toBeNull()
  })

  it('explicitly saves details in place and returns only after a successful save', async () => {
    const desktop = api(true)
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    fireEvent.change(screen.getByLabelText('任务备注'), { target: { value: '第一版' } })
    await userEvent.click(screen.getByRole('button', { name: /^保存$/ }))
    await waitFor(() => expect(desktop.day.save).toHaveBeenCalledOnce())
    expect(screen.getByRole('textbox', { name: '任务标题' })).toBeTruthy()
    desktop.day.save = vi.fn(async () => ({ ok: false as const, error: { code: 'CONFLICT' as const, message: '外部文件已修改' } }))
    fireEvent.change(screen.getByLabelText('任务备注'), { target: { value: '保留第二版' } })
    await userEvent.click(screen.getByRole('button', { name: '保存并返回' }))
    await screen.findByText('外部文件已修改')
    expect((screen.getByLabelText('任务备注') as HTMLTextAreaElement).value).toBe('保留第二版')
  })

  it('keeps minute labels and their surrounding area out of card activation', async () => {
    window.myWay = api(true)
    render(<App />)
    const input = await screen.findByLabelText('来自本地文件的真实任务 计划分钟')
    await userEvent.click(input.closest('label')!.querySelector('span')!)
    expect(screen.queryByRole('textbox', { name: '任务标题' })).toBeNull()
    await userEvent.click(input.closest('.time-inputs')!)
    expect(screen.queryByRole('textbox', { name: '任务标题' })).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    expect(screen.getByRole('textbox', { name: '任务标题' })).toBeTruthy()
  })

  it('allows backspace to empty planned minutes and blocks saving or leaving until corrected', async () => {
    const desktop = api(true)
    window.myWay = desktop
    render(<App />)
    const input = await screen.findByLabelText('来自本地文件的真实任务 计划分钟') as HTMLInputElement
    await userEvent.click(input)
    await userEvent.keyboard('{End}{Backspace}{Backspace}')
    expect(input.value).toBe('')
    await userEvent.keyboard('{Meta>}s{/Meta}')
    expect(desktop.day.save).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: /^计时器$/ }))
    expect(screen.getByLabelText('来自本地文件的真实任务 计划分钟')).toBe(input)
    await userEvent.type(input, '150')
    expect(input.value).toBe('150')
    await userEvent.keyboard('{Meta>}s{/Meta}')
    await waitFor(() => expect(desktop.day.save).toHaveBeenCalled())
    expect(vi.mocked(desktop.day.save).mock.calls.at(-1)?.[0].value.tasks[0].plannedMinutes).toBe(150)
  })

  it.each([{ category: 'fitness', label: '健身' }, { category: 'exam', label: '学习' }] as const)('does not double-count $label minutes after a saved daily file refresh', async ({ category, label }) => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 2, 12))
    try {
      const desktop = api(true)
      const date = '2026-09-02'
      const path = '/tmp/my-way/data/daily/2026/2026-09-02.md'
      let persisted: ParsedDailyRecord = { ...record, date, tasks: [{ ...record.tasks[0], date, originalDate: date, category, actualMinutes: 0, plannedMinutes: 150 }] }
      let revision = 'r1'
      let listener: ((event: FileWatchEvent) => void) | undefined
      const week = currentWeekDocument({ tasks: persisted.tasks })
      const summary = () => ({
        ...emptySummary, timeRecords: [persisted],
        actualMinutes: category === 'fitness' ? 0 : persisted.tasks[0].actualMinutes,
        fitnessActualMinutes: category === 'fitness' ? persisted.tasks[0].actualMinutes : 0
      })
      desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: { ...planningContext(week), summary: summary() } }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.progress.query = vi.fn(async () => ({ ok: true as const, value: { summary: summary(), month: [] } }))
      desktop.day.open = vi.fn(async (requested) => ({ ok: true as const, value: requested === date ? { file: { path, revision, value: persisted }, created: false, missingPlan: false } : null }))
      desktop.day.save = vi.fn(async (file) => {
        persisted = file.value
        revision = 'r2'
        return { ok: true as const, value: { ...file, revision } }
      })
      window.myWay = desktop
      render(<App />)
      const input = await screen.findByRole('spinbutton', { name: /来自本地文件的真实任务 实际分钟/ })
      const progress = screen.getByRole('progressbar', { name: `本周${label}时长` })
      fireEvent.change(input, { target: { value: '150' } })
      expect(progress.getAttribute('aria-valuetext')).toBe('实际 2 小时 30 分钟，目标 2 小时 30 分钟')
      await waitFor(() => expect(persisted.tasks[0].actualMinutes).toBe(150))
      const contextsBefore = vi.mocked(desktop.week.context).mock.calls.length
      await act(async () => listener?.({ kind: 'changed', path, at: new Date().toISOString() }))
      await waitFor(() => expect(vi.mocked(desktop.week.context).mock.calls.length).toBeGreaterThan(contextsBefore))
      expect(progress.getAttribute('aria-valuetext')).toBe('实际 2 小时 30 分钟，目标 2 小时 30 分钟')
      for (const destination of ['计时器', '本周', '今天']) {
        await userEvent.click(screen.getByRole('button', { name: destination }))
        expect(screen.getByRole('progressbar', { name: `本周${label}时长` }).getAttribute('aria-valuetext')).toBe('实际 2 小时 30 分钟，目标 2 小时 30 分钟')
      }
    } finally { vi.useRealTimers() }
  })

  it('includes a manually added fitness card in the weekly target without changing the weekly plan', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 2, 12))
    try {
      const desktop = api(true)
      const date = '2026-09-02'
      const day: ParsedDailyRecord = { ...record, date, tasks: [{ ...record.tasks[0], id: 'manual-fitness', date, category: 'fitness', title: '背+胸', plannedMinutes: 150, actualMinutes: 150, status: 'done' }] }
      const week = currentWeekDocument()
      const summary = { ...emptySummary, timeRecords: [day], fitnessPlannedMinutes: 150, fitnessActualMinutes: 150 }
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: { ...planningContext(week), summary } }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.progress.query = vi.fn(async () => ({ ok: true as const, value: { summary, month: [] } }))
      desktop.day.open = vi.fn(async (requested) => ({ ok: true as const, value: requested === date ? { file: { path: '/tmp/day.md', revision: 'r1', value: day }, created: false, missingPlan: false } : null }))
      window.myWay = desktop
      render(<App />)
      await screen.findByRole('button', { name: '打开任务详情：背+胸' })
      expect(screen.getByRole('progressbar', { name: '本周健身时长' }).getAttribute('aria-valuetext')).toBe('实际 2 小时 30 分钟，目标 2 小时 30 分钟')
      expect(screen.getByRole('progressbar', { name: '本周学习时长' }).getAttribute('aria-valuetext')).toBe('实际 0 分钟，目标 0 分钟')
      expect(screen.getByRole('listitem', { name: '星期三 2026-09-02，学习计划 0 分钟，健身计划 2 小时 30 分钟，1 项任务' })).toBeTruthy()
      expect(desktop.week.save).not.toHaveBeenCalled()
      expect(desktop.day.save).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('focuses one existing row without reordering and excludes fitness from the daily learning total', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 16, 12))
    try {
      const desktop = api(true)
      desktop.day.open = vi.fn<DesktopApi['day']['open']>(async () => ({ ok: true, value: { file: { path: '/tmp/day.md', revision: 'r1', value: {
        ...record,
        tasks: [
          { ...record.tasks[0], id: 'fitness', title: '力量训练', category: 'fitness', plannedMinutes: 45, actualMinutes: 30, status: 'planned' },
          { ...record.tasks[0], plannedMinutes: 60, actualMinutes: 15 }
        ]
      } }, created: false, missingPlan: true } }))
      window.myWay = desktop
      render(<App />)
      await screen.findByRole('button', { name: '打开任务详情：力量训练' })
      expect([...document.querySelectorAll('[data-task-id]')].map(row => row.getAttribute('data-task-id'))).toEqual(['fitness', 'real-task'])
      expect(document.querySelectorAll('.task-row.is-focused')).toHaveLength(1)
      expect(document.querySelector('.task-row.is-focused')?.getAttribute('data-task-id')).toBe('fitness')
      expect(screen.getByLabelText('今日学习时间进度').textContent).toBe('15 分钟/ 1 小时')
      expect(desktop.day.save).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })
  it('allows the fitness category on the daily task card', async () => {
    window.myWay = api(true)
    render(<App />)
    const category = await screen.findByRole('combobox', { name: '来自本地文件的真实任务 类别' })
    await userEvent.selectOptions(category, '健身')
    expect((category as HTMLSelectElement).value).toBe('健身')
  })
  it('surfaces changed and removed week-plan tasks without rewriting the daily snapshot', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 16, 12))
    try {
      const desktop = api(true)
      desktop.week.diff = vi.fn(async () => ({
        ok: true as const,
        value: { addedTaskIds: [], changedTaskIds: ['real-task'], removedTaskIds: ['removed-task'] }
      }))
      window.myWay = desktop
      render(<App />)

      expect(await screen.findByText('周计划差异：已修改 1 项、已移除 1 项。每日快照保持不变。')).toBeTruthy()
      expect(screen.queryByRole('button', { name: '导入新增任务' })).toBeNull()
      expect(screen.getByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the right rail free of placeholder controls and unverifiable save copy', async () => {
    window.myWay = api(true)
    render(<App />)

    await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })
    expect(screen.getByRole('complementary', { name: '应用导航' })).toBeTruthy()
    expect(screen.getByRole('complementary', { name: '学习摘要' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '打开保存位置' })).toBeNull()
    expect(screen.queryByRole('button', { name: '查看全部' })).toBeNull()
    expect(screen.queryByText('刚刚更新')).toBeNull()
    expect(screen.getByText('本地保存')).toBeTruthy()
  })

  it('uses a static calendar empty state instead of a button with no action', async () => {
    window.myWay = api(true)
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '日历' }))
    expect(screen.getByRole('group', { name: '日历视图' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '周' }).getAttribute('aria-pressed')).toBe('true')
    expect(await screen.findByText('按空格键拾取任务，使用方向键移动，再按空格键放下；按 Escape 取消。')).toBeTruthy()
    expect(screen.queryAllByRole('button', { name: /安排任务/ })).toHaveLength(0)
    expect(document.querySelectorAll('.day-placeholder')).toHaveLength(0)
  })

  it('returns a browsed calendar to the current week or month', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const openDay = desktop.day.open
      desktop.day.open = vi.fn((date) => date === '2026-08-31'
        ? Promise.resolve({ ok: true as const, value: null })
        : openDay(date))
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      const returnToWeek = screen.getByRole('button', { name: '回到本周' }) as HTMLButtonElement
      expect(returnToWeek.disabled).toBe(true)
      await userEvent.click(screen.getByRole('button', { name: '下一周期' }))
      expect(await screen.findByRole('heading', { name: '9 月 7 日 — 9 月 13 日' })).toBeTruthy()
      expect(returnToWeek.disabled).toBe(false)
      await userEvent.click(returnToWeek)
      expect(await screen.findByRole('heading', { name: '8 月 31 日 — 9 月 6 日' })).toBeTruthy()

      await userEvent.click(screen.getByRole('button', { name: '月' }))
      const returnToMonth = screen.getByRole('button', { name: '回到本月' }) as HTMLButtonElement
      expect(returnToMonth.disabled).toBe(true)
      await userEvent.click(screen.getByRole('button', { name: '下一周期' }))
      expect(await screen.findByRole('heading', { name: '2026 年 10 月' })).toBeTruthy()
      expect(returnToMonth.disabled).toBe(false)
      await userEvent.click(returnToMonth)
      expect(await screen.findByRole('heading', { name: '2026 年 9 月' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('rolls the local date at midnight, creates the newly opened Today, and checks carryover', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 8, 1, 23, 59, 59, 900))
    try {
      const desktop = api(true)
      const oldDay = {
        ...record,
        date: '2026-09-01',
        tasks: [{ ...record.tasks[0], date: '2026-09-01', originalDate: '2026-09-01', title: '跨日未完成任务' }]
      }
      const newDay = { ...record, date: '2026-09-02', tasks: [], notes: '' }
      desktop.day.open = vi.fn(async (date) => ({
        ok: true as const,
        value: date === '2026-09-01'
          ? { file: { path: `/tmp/my-way/data/daily/2026/${date}.md`, revision: 'old-r1', value: oldDay }, created: false, missingPlan: false }
          : null
      }))
      desktop.day.create = vi.fn(async (date) => ({
        ok: true as const,
        value: { file: { path: `/tmp/my-way/data/daily/2026/${date}.md`, revision: 'new-r1', value: newDay }, created: true, missingPlan: false }
      }))
      window.myWay = desktop
      render(<App />)

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getByRole('heading', { name: /今天，9 月 1 日/ })).toBeTruthy()
      act(() => { vi.advanceTimersByTime(125) })
      expect(screen.getByRole('button', { name: '今天' }).getAttribute('aria-current')).toBeNull()

      fireEvent.click(screen.getByRole('button', { name: '今天' }))
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getByRole('heading', { name: /今天，9 月 2 日/ })).toBeTruthy()
      expect(desktop.day.create).toHaveBeenCalledWith('2026-09-02')
      expect(screen.queryByRole('dialog', { name: '未完成任务处理' })).toBeNull()
      expect(screen.getByText('待处理任务 · 1 项')).toBeTruthy()
      expect(screen.getByText('跨日未完成任务')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('expires an idle task choice at midnight without creating a day from the timer', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 8, 1, 23, 59, 59, 900))
    try {
      const desktop = api(true)
      desktop.day.open = vi.fn(async date => ({ ok: true as const, value: date === '2026-09-01' ? {
        file: { path: '/tmp/old.md', revision: 'r1', value: { ...record, date, tasks: [{ ...record.tasks[0], date, originalDate: date }] } }, created: false, missingPlan: false
      } : null }))
      window.myWay = desktop
      render(<App />)
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
      fireEvent.click(screen.getByRole('button', { name: '计时器' }))
      const picker = screen.getByRole('combobox', { name: '关联任务' })
      fireEvent.click(picker)
      fireEvent.click(screen.getByRole('option', { name: /来自本地文件的真实任务/ }))
      expect(picker.textContent).toContain(record.tasks[0].title)
      await act(async () => { vi.advanceTimersByTime(125); await Promise.resolve(); await Promise.resolve() })
      expect(picker.textContent).toContain('不关联任务')
      fireEvent.click(picker)
      expect(screen.queryByRole('option', { name: /来自本地文件的真实任务/ })).toBeNull()
      expect(desktop.day.create).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('keeps the current view usable when the midnight summary refresh rejects', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    vi.setSystemTime(new Date(2026, 8, 1, 23, 59, 59, 900))
    try {
      const desktop = api(true)
      const oldDay = {
        ...record,
        date: '2026-09-01',
        tasks: [{ ...record.tasks[0], date: '2026-09-01', originalDate: '2026-09-01', title: '午夜前的任务' }]
      }
      desktop.day.open = vi.fn(async (date) => {
        if (date === '2026-09-01') return {
          ok: true as const,
          value: { file: { path: `/tmp/my-way/data/daily/2026/${date}.md`, revision: 'old-r1', value: oldDay }, created: false, missingPlan: false }
        }
        if (date === '2026-08-31') return { ok: true as const, value: null }
        throw new Error('新日期摘要暂时不可读')
      })
      window.myWay = desktop
      render(<App />)

      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.getByRole('button', { name: '打开任务详情：午夜前的任务' })).toBeTruthy()
      act(() => { vi.advanceTimersByTime(125) })
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
        await Promise.resolve()
      })

      expect(screen.getByText('今日摘要刷新失败：新日期摘要暂时不可读')).toBeTruthy()
      expect(screen.getByRole('button', { name: '打开任务详情：午夜前的任务' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('recovers the workspace chooser when its IPC call rejects', async () => {
    const desktop = api(false)
    desktop.workspace.select = vi.fn(async () => { throw new Error('文件夹选择器暂时不可用') })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '选择 my-way 文件夹' }))

    expect(await screen.findByRole('heading', { name: '无法打开工作区' })).toBeTruthy()
    expect(screen.getByText('文件夹选择器暂时不可用')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重新读取' })).toBeTruthy()
  })

  it('distinguishes calendar and route loading from their true empty states', async () => {
    const desktop = api(true)
    let finishWeek!: (value: Awaited<ReturnType<DesktopApi['week']['load']>>) => void
    let finishRoute!: (value: Awaited<ReturnType<DesktopApi['route']['load']>>) => void
    desktop.week.load = vi.fn(() => new Promise<Awaited<ReturnType<DesktopApi['week']['load']>>>((resolve) => { finishWeek = resolve }))
    desktop.route.load = vi.fn(() => new Promise<Awaited<ReturnType<DesktopApi['route']['load']>>>((resolve) => { finishRoute = resolve }))
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '日历' }))
    expect(screen.getByText('日历读取中')).toBeTruthy()
    expect(screen.queryByText(/日历暂时为空/)).toBeNull()

    await act(async () => { finishWeek({ ok: true, value: null }) })
    expect(await screen.findByText(/日历暂时为空/)).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '路线' }))
    expect(screen.getByText('路线读取中')).toBeTruthy()
    expect(screen.queryByText('尚未读取到路线文件。')).toBeNull()

    await act(async () => { finishRoute({ ok: true, value: [] }) })
    expect(await screen.findByText('尚未读取到路线文件。')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '路线' }))
    expect(desktop.route.load).toHaveBeenCalledTimes(1)
    expect(screen.getByText('尚未读取到路线文件。')).toBeTruthy()
  })

  it('reloads the visible route after an external route-file edit', async () => {
    const desktop = api(true)
    let listener: ((event: FileWatchEvent) => void) | undefined
    let external = false
    desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
    desktop.route.load = vi.fn(async () => ({ ok: true as const, value: [{
      id: 'twelve-week' as const,
      title: '12 周路线',
      path: '00-dashboard/12-week-roadmap.md',
      content: external ? '# 外部更新路线' : '# 初始路线'
    }] }))
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '路线' }))
    expect(await screen.findByRole('heading', { name: '初始路线' })).toBeTruthy()
    expect(screen.queryByText('00-dashboard/12-week-roadmap.md · 只读')).toBeNull()
    external = true
    await act(async () => {
      listener?.({ kind: 'changed', path: '00-dashboard/12-week-roadmap.md', at: new Date().toISOString() })
      await Promise.resolve()
    })

    expect(await screen.findByRole('heading', { name: '外部更新路线' })).toBeTruthy()
    expect(desktop.route.load).toHaveBeenCalledTimes(2)
  })

  it('refreshes weekly review totals when another daily record changes externally', async () => {
    const desktop = api(true)
    const week = currentWeekDocument()
    let listener: ((event: FileWatchEvent) => void) | undefined
    let external = false
    desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
    desktop.week.context = vi.fn(async () => ({
      ok: true as const,
      value: {
        ...planningContext(week),
        summary: { ...emptySummary, actualMinutes: external ? 120 : 30 }
      }
    }))
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '本周' }))
    await userEvent.click(screen.getByRole('button', { name: '复盘' }))
    const review = screen.getByLabelText('本周复盘')
    expect(within(review).getByText('30 分钟')).toBeTruthy()

    external = true
    await act(async () => {
      listener?.({ kind: 'changed', path: 'data/daily/2026/2026-09-02.md', at: new Date().toISOString() })
      await Promise.resolve()
    })

    expect(await within(review).findByText('2 小时')).toBeTruthy()
  })

  it('shows and dismisses a file-watcher failure without hiding the workspace', async () => {
    const desktop = api(true)
    let listener: ((event: FileWatchEvent) => void) | undefined
    desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
    window.myWay = desktop
    render(<App />)

    await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })
    act(() => listener?.({ kind: 'error', message: '文件监听失败：watcher offline', at: new Date().toISOString() }))

    const alert = screen.getByRole('alert')
    expect(alert.textContent).toContain('外部文件变化可能无法自动显示')
    expect(screen.getByRole('heading', { name: '今日任务' })).toBeTruthy()
    await userEvent.click(within(alert).getByRole('button', { name: '知道了' }))
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('uses complete Chinese date and duration labels without placeholder milestones', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    window.myWay = api(true)
    render(<App />)

    await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })
    expect(document.querySelectorAll('.time-inputs small')).toHaveLength(0)
    expect(screen.queryByText('近期节点')).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: '日历' }))
    expect(await screen.findByRole('heading', { name: '8 月 31 日 — 9 月 6 日' })).toBeTruthy()
  })

  it('opens a task detail from its card and persists task Markdown', async () => {
    const desktop = api(true)
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    expect(screen.getByRole('button', { name: '返回今天' })).toBeTruthy()
    await userEvent.type(screen.getByRole('textbox', { name: '任务备注' }), '任务级备注')
    await userEvent.type(screen.getByRole('textbox', { name: '学习成果' }), '任务级成果')

    await waitFor(() => {
      const saved = vi.mocked(desktop.day.save).mock.calls.at(-1)?.[0]
      expect(saved?.value.tasks[0]).toMatchObject({ notes: '任务级备注', outcomes: '任务级成果' })
    })
  })

  it('persists a past-exam result through the daily autosave pipeline', async () => {
    const desktop = api(true)
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '添加过去问记录' }))
    await userEvent.type(screen.getByLabelText('科目'), '数学')
    await userEvent.type(screen.getByLabelText('试卷'), '2025 数学模拟卷')
    await userEvent.type(screen.getByLabelText('得分'), '68')
    await userEvent.click(screen.getByRole('button', { name: '保存记录' }))

    await waitFor(() => {
      const saved = vi.mocked(desktop.day.save).mock.calls.at(-1)?.[0]
      expect(saved?.value.pastExams).toEqual([
        expect.objectContaining({ subject: '数学', paper: '2025 数学模拟卷', score: 68, maxScore: 100 })
      ])
    })
  })

  it('inspects evidence and replaces a broken reference without deleting the source file', async () => {
    const desktop = api(true)
    const brokenPath = 'notes/missing.md'
    const replacementPath = 'notes/replacement.md'
    const recordWithEvidence = { ...record, tasks: [{ ...record.tasks[0], evidence: [brokenPath] }] }
    desktop.day.open = vi.fn(async () => ({ ok: true as const, value: { file: { path: '/tmp/my-way/data/daily/2026/2026-08-16.md', revision: 'r1', value: recordWithEvidence }, created: false, missingPlan: true } }))
    desktop.evidence.inspect = vi.fn(async (paths: string[]) => ({ ok: true as const, value: paths.map((path) => ({ path, status: path === brokenPath ? 'missing' as const : 'available' as const })) }))
    desktop.evidence.select = vi.fn(async () => ({ ok: true as const, value: replacementPath }))
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    expect((await screen.findAllByText('文件缺失')).length).toBeGreaterThan(0)
    await userEvent.click(screen.getByRole('button', { name: '替换 missing.md' }))

    await waitFor(() => {
      const saved = vi.mocked(desktop.day.save).mock.calls.at(-1)?.[0]
      expect(saved?.value.tasks[0].evidence).toEqual([replacementPath])
    })
    expect(desktop.evidence.select).toHaveBeenCalledOnce()
  })

  it('reports a rejected evidence picker without leaving the UI action unhandled', async () => {
    const desktop = api(true)
    desktop.evidence.select = vi.fn(async () => { throw new Error('文件选择器暂时不可用') })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '为 来自本地文件的真实任务 添加证据' }))

    expect(await screen.findByText('无法选择证据：文件选择器暂时不可用')).toBeTruthy()
  })

  it('reports a rejected evidence inspection call', async () => {
    const desktop = api(true)
    const evidencePath = 'notes/result.md'
    const recordWithEvidence = { ...record, tasks: [{ ...record.tasks[0], evidence: [evidencePath] }] }
    desktop.day.open = vi.fn(async () => ({ ok: true as const, value: { file: { path: '/tmp/my-way/data/daily/2026/2026-08-16.md', revision: 'r1', value: recordWithEvidence }, created: false, missingPlan: true } }))
    desktop.evidence.inspect = vi.fn(async () => { throw new Error('证据索引暂时不可读') })
    window.myWay = desktop
    render(<App />)

    expect(await screen.findByText('无法检查证据：证据索引暂时不可读')).toBeTruthy()
  })

  it('reports a rejected evidence open call', async () => {
    const desktop = api(true)
    const evidencePath = 'notes/result.md'
    const recordWithEvidence = { ...record, tasks: [{ ...record.tasks[0], evidence: [evidencePath] }] }
    desktop.day.open = vi.fn(async () => ({ ok: true as const, value: { file: { path: '/tmp/my-way/data/daily/2026/2026-08-16.md', revision: 'r1', value: recordWithEvidence }, created: false, missingPlan: true } }))
    desktop.evidence.inspect = vi.fn(async () => ({ ok: true as const, value: [{ path: evidencePath, status: 'available' as const }] }))
    desktop.evidence.open = vi.fn(async () => { throw new Error('系统无法打开文件') })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    await userEvent.click(screen.getByRole('button', { name: '打开 result.md' }))

    expect(await screen.findByText('无法打开证据：系统无法打开文件')).toBeTruthy()
  })

  it('reports a rejected task-source lookup without crashing the detail view', async () => {
    const desktop = api(true)
    desktop.week.load = vi.fn(async () => { throw new Error('周计划来源暂时不可读') })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))

    expect(await screen.findByText('无法确认任务来源：周计划来源暂时不可读')).toBeTruthy()
    expect(screen.getByRole('textbox', { name: '任务标题' })).toBeTruthy()
  })

  it('reports rejected daily and weekly reads triggered by the file watcher', async () => {
    const desktop = api(true)
    let listener: ((event: FileWatchEvent) => void) | undefined
    desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
    window.myWay = desktop
    render(<App />)
    await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })

    const observedDate = vi.mocked(desktop.day.open).mock.calls[0][0]
    desktop.day.open = vi.fn(async () => { throw new Error('每日文件暂时被占用') })
    await act(async () => {
      listener?.({ kind: 'changed', path: `data/daily/${observedDate.slice(0, 4)}/${observedDate}.md`, at: new Date().toISOString() })
      await Promise.resolve()
    })
    expect(await screen.findByText('无法核对外部文件变化：每日文件暂时被占用')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '知道了' }))

    desktop.week.context = vi.fn(async () => { throw new Error('周计划目录暂时不可读') })
    await act(async () => {
      listener?.({ kind: 'changed', path: '00-dashboard/weeks/week-03.md', at: new Date().toISOString() })
      await Promise.resolve()
    })
    expect(await screen.findByText('无法核对周计划变化：周计划目录暂时不可读')).toBeTruthy()
  })

  it('reports a rejected historical-day read and releases the calendar opening state', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    const desktop = api(true)
    window.myWay = desktop
    render(<App />)
    await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })
    await userEvent.click(screen.getByRole('button', { name: '日历' }))
    await screen.findByRole('button', { name: '打开 2026-09-02 记录' })
    desktop.day.open = vi.fn(async () => { throw new Error('历史每日文件暂时不可读') })

    const opener = screen.getByRole('button', { name: '打开 2026-09-02 记录' })
    await userEvent.click(opener)

    expect(await screen.findByText('历史每日文件暂时不可读')).toBeTruthy()
    expect((opener as HTMLButtonElement).disabled).toBe(false)
    expect(screen.getByRole('heading', { name: '8 月 31 日 — 9 月 6 日' })).toBeTruthy()
  })

  it('keeps Today usable when the previous-day carryover check rejects', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const todayRecord = {
        ...record,
        date: '2026-09-01',
        tasks: [{ ...record.tasks[0], date: '2026-09-01', originalDate: '2026-09-01', title: '今天仍可学习' }]
      }
      desktop.day.open = vi.fn(async (date) => {
        if (date === '2026-09-01') return {
          ok: true as const,
          value: { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'today-r1', value: todayRecord }, created: false, missingPlan: false }
        }
        throw new Error('昨日记录暂时被其他程序占用')
      })
      window.myWay = desktop
      render(<App />)

      expect(await screen.findByRole('button', { name: '打开任务详情：今天仍可学习' })).toBeTruthy()
      expect(await screen.findByText('无法检查未完成任务：昨日记录暂时被其他程序占用')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes pending edits before deleting and returns to the task list', async () => {
    const desktop = api(true)
    const events: string[] = []
    desktop.day.save = vi.fn(async (file) => {
      events.push('save')
      return { ok: true as const, value: { ...file, revision: 'r2' } }
    })
    desktop.task.delete = vi.fn(async (payload) => {
      events.push('delete')
      return { ok: true as const, value: { day: { ...payload.day, revision: 'r3', value: { ...record, tasks: [] } } } }
    })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    await userEvent.type(screen.getByRole('textbox', { name: '任务标题' }), ' · 已编辑')
    await userEvent.click(screen.getByRole('button', { name: '删除任务' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认删除' }))

    await waitFor(() => expect(desktop.task.delete).toHaveBeenCalledOnce())
    expect(desktop.task.delete).toHaveBeenCalledWith({
      day: { path: '/tmp/my-way/data/daily/2026/2026-08-16.md', revision: 'r2' },
      taskId: 'real-task'
    })
    expect(events).toEqual(['save', 'delete'])
    expect(screen.queryByRole('button', { name: /打开任务详情/ })).toBeNull()
    expect(screen.getByRole('heading', { name: '今日任务' })).toBeTruthy()
  })

  it('keeps inline controls inline and supports keyboard detail navigation', async () => {
    window.myWay = api(true)
    render(<App />)
    const planned = await screen.findByRole('spinbutton', { name: /来自本地文件的真实任务 计划分钟/ })
    await userEvent.click(planned)
    expect(screen.queryByRole('button', { name: '返回今天' })).toBeNull()
    expect((screen.getByRole('button', { name: '上移 来自本地文件的真实任务' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '下移 来自本地文件的真实任务' }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.getByRole('button', { name: '为 来自本地文件的真实任务 添加证据' })).toBeTruthy()

    const card = screen.getByLabelText('任务卡片：来自本地文件的真实任务')
    card.focus()
    await userEvent.keyboard('{Enter}')
    await userEvent.click(screen.getByRole('button', { name: '返回今天' }))
    await waitFor(() => expect(screen.getByLabelText('任务卡片：来自本地文件的真实任务')).toBe(document.activeElement))
  })

  it('keeps the task detail open when deletion conflicts', async () => {
    const desktop = api(true)
    desktop.task.delete = vi.fn(async () => ({ ok: false as const, error: { code: 'CONFLICT' as const, message: '周计划已在外部变化' } }))
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    await userEvent.click(screen.getByRole('button', { name: '删除任务' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    expect((await screen.findByRole('alert')).textContent).toContain('周计划已在外部变化')
    expect(screen.getByRole('textbox', { name: '任务标题' })).toBeTruthy()
  })

  it('waits for an in-flight deletion before allowing the window to close', async () => {
    const desktop = api(true)
    let beforeClose: (() => void) | undefined
    let finishDelete: (() => void) | undefined
    desktop.lifecycle.onBeforeClose = vi.fn((listener) => { beforeClose = listener; return () => undefined })
    desktop.task.delete = vi.fn((payload) => new Promise<Awaited<ReturnType<DesktopApi['task']['delete']>>>((resolve) => {
      finishDelete = () => resolve({ ok: true, value: { day: { ...payload.day, value: { ...record, tasks: [] } } } })
    }))
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    await userEvent.click(screen.getByRole('button', { name: '删除任务' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    await waitFor(() => expect(desktop.task.delete).toHaveBeenCalledOnce())

    await act(async () => { beforeClose?.(); await Promise.resolve() })
    expect(desktop.lifecycle.readyToClose).not.toHaveBeenCalled()
    await act(async () => { finishDelete?.(); await Promise.resolve() })
    await waitFor(() => expect(desktop.lifecycle.readyToClose).toHaveBeenCalledOnce())
  })

  it('waits for a deletion queued after close started waiting on a save', async () => {
    const desktop = api(true)
    let beforeClose: (() => void) | undefined
    let finishSave: (() => void) | undefined
    let finishDelete: (() => void) | undefined
    desktop.lifecycle.onBeforeClose = vi.fn((listener) => { beforeClose = listener; return () => undefined })
    desktop.day.save = vi.fn((file) => new Promise<Awaited<ReturnType<DesktopApi['day']['save']>>>((resolve) => {
      finishSave = () => resolve({ ok: true, value: { ...file, revision: 'r2' } })
    }))
    desktop.task.delete = vi.fn((payload) => new Promise<Awaited<ReturnType<DesktopApi['task']['delete']>>>((resolve) => {
      finishDelete = () => resolve({ ok: true, value: { day: { ...payload.day, revision: 'r3', value: { ...record, tasks: [] } } } })
    }))
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    fireEvent.change(screen.getByRole('textbox', { name: '任务标题' }), { target: { value: '关闭前正在保存' } })
    await act(async () => { beforeClose?.(); await Promise.resolve() })
    await waitFor(() => expect(desktop.day.save).toHaveBeenCalledOnce())

    await userEvent.click(screen.getByRole('button', { name: '删除任务' }))
    await userEvent.click(await screen.findByRole('button', { name: '确认删除' }))
    await act(async () => { finishSave?.(); await Promise.resolve() })
    await waitFor(() => expect(desktop.task.delete).toHaveBeenCalledOnce())
    expect(desktop.lifecycle.readyToClose).not.toHaveBeenCalled()

    await act(async () => { finishDelete?.(); await Promise.resolve() })
    await waitFor(() => expect(desktop.lifecycle.readyToClose).toHaveBeenCalledOnce())
  })

  it('flushes edits that arrive during the close-time save before closing', async () => {
    const desktop = api(true)
    let beforeClose: (() => void) | undefined
    let finishFirstSave: (() => void) | undefined
    let saveCount = 0
    desktop.lifecycle.onBeforeClose = vi.fn((listener) => { beforeClose = listener; return () => undefined })
    desktop.day.save = vi.fn((file): ReturnType<DesktopApi['day']['save']> => {
      saveCount += 1
      if (saveCount === 1) return new Promise<Awaited<ReturnType<DesktopApi['day']['save']>>>((resolve) => { finishFirstSave = () => resolve({ ok: true, value: { ...file, revision: 'r2' } }) })
      return Promise.resolve({ ok: true as const, value: { ...file, revision: `r${saveCount + 1}` } })
    })
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    const title = screen.getByRole('textbox', { name: '任务标题' })
    fireEvent.change(title, { target: { value: '来自本地文件的真实任务 · 第一版' } })
    await act(async () => { beforeClose?.(); await Promise.resolve() })
    await waitFor(() => expect(desktop.day.save).toHaveBeenCalledOnce())
    fireEvent.change(title, { target: { value: '来自本地文件的真实任务 · 第一版 · 第二版' } })
    await act(async () => { finishFirstSave?.(); await Promise.resolve() })

    await waitFor(() => expect(desktop.day.save).toHaveBeenCalledTimes(2))
    expect(vi.mocked(desktop.day.save).mock.calls[1][0].value.tasks[0].title).toContain('第二版')
    await waitFor(() => expect(desktop.lifecycle.readyToClose).toHaveBeenCalledOnce())
  })

  it('returns safely when an external refresh removes the selected task', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 17, 12))
    try {
      const desktop = api(true)
      let listener: ((event: FileWatchEvent) => void) | undefined
      let externallyRemoved = false
      desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
      desktop.day.open = vi.fn(async () => ({
        ok: true as const,
        value: { file: { path: '/tmp/my-way/data/daily/2026/2026-08-17.md', revision: externallyRemoved ? 'r-external' : 'r1', value: externallyRemoved ? { ...record, tasks: [] } : record }, created: false, missingPlan: true }
      }))
      window.myWay = desktop
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
      externallyRemoved = true
      await act(async () => { listener?.({ kind: 'changed', path: '/tmp/my-way/data/daily/2026/2026-08-17.md', at: new Date().toISOString() }); await Promise.resolve() })
      expect((await screen.findByRole('alert')).textContent).toContain('已返回今天列表')
      expect(screen.getByRole('heading', { name: '今日任务' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores a delayed watcher event for the current daily revision while editing', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 16, 12))
    try {
      const desktop = api(true)
      let listener: ((event: FileWatchEvent) => void) | undefined
      desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
      window.myWay = desktop
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
      fireEvent.change(screen.getByRole('textbox', { name: '任务标题' }), { target: { value: '本地正在编辑' } })
      await act(async () => {
        listener?.({ kind: 'added', path: '/tmp/my-way/data/daily/2026/2026-08-16.md', at: new Date().toISOString() })
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(screen.queryByText(/每日文件已在 App 外部发生变化/)).toBeNull()
      expect((screen.getByRole('textbox', { name: '任务标题' }) as HTMLInputElement).value).toBe('本地正在编辑')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows first-run workspace selection when no folder is configured', async () => {
    window.myWay = api(false)
    render(<App />)
    expect(await screen.findByRole('button', { name: '选择 my-way 文件夹' })).toBeTruthy()
  })

  it('retries the configured workspace after a recoverable file error without reopening the picker', async () => {
    const desktop = api(true)
    const originalOpen = desktop.day.open
    desktop.day.open = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, error: { code: 'VALIDATION' as const, message: '/tmp/my-way/data/daily/2026/2026-08-16.md: YAML 无效' } })
      .mockImplementation(originalOpen)
    window.myWay = desktop
    render(<App />)

    expect(await screen.findByRole('heading', { name: '无法打开工作区' })).toBeTruthy()
    expect(screen.getByText(/YAML 无效/)).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '重新读取' }))

    expect(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })).toBeTruthy()
    expect(desktop.workspace.select).not.toHaveBeenCalled()
    expect(desktop.workspace.get).toHaveBeenCalledTimes(2)
  })

  it('loads today from the local daily Markdown record', async () => {
    window.myWay = api(true)
    render(<App />)
    expect(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /复现 Transformer 的多头注意力/ })).toBeNull()
  })

  it('uses noun-phrase labels and consistently sized accessible navigation icons', async () => {
    window.myWay = api(true)
    render(<App />)

    expect(await screen.findByRole('heading', { name: '今日任务' })).toBeTruthy()
    expect(screen.getByText('学习成果')).toBeTruthy()
    expect(screen.getByText('当前难点')).toBeTruthy()
    expect(screen.getByText('明日计划调整')).toBeTruthy()
    expect(screen.queryByText('学会了什么')).toBeNull()
    expect(screen.queryByText('卡在哪里')).toBeNull()
    expect(screen.queryByText('明天怎么调')).toBeNull()
    expect(screen.queryByText(/DAILY RECORD|NO WEEK PLAN/)).toBeNull()
    expect(screen.getByRole('button', { name: '本周' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: '进度' })).toBeNull()

    const navigation = screen.getByRole('navigation', { name: '主导航' })
    expect(navigation.querySelectorAll('button .nav-icon[aria-hidden="true"][viewBox="0 0 20 20"]')).toHaveLength(5)
    expect(navigation.querySelector('.selection-indicator')?.textContent).toBe('')
  })

  it('supports quiet keyboard navigation and an explicit weekly save shortcut', async () => {
    const desktop = api(true)
    let saved: WeekDocument | null = null
    desktop.day.open = vi.fn(async (date) => ({
      ok: true as const,
      value: date === '2026-09-01'
        ? { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'today-r1', value: { ...record, date, tasks: [] } }, created: false, missingPlan: true }
        : null
    }))
    desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(saved) }))
    desktop.week.save = vi.fn(async (request) => {
      saved = { path: '00-dashboard/weeks/week-03.md', revision: 'b'.repeat(64), value: { plan: request.plan, body: request.body } }
      return { ok: true as const, value: saved }
    })
    window.myWay = desktop
    render(<App />)

    const today = await screen.findByRole('button', { name: '今天' })
    expect(today.getAttribute('aria-keyshortcuts')).toBe('Meta+1')
    fireEvent.keyDown(window, { key: '3', metaKey: true })
    expect(await screen.findByRole('heading', { name: '第 3 周' })).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '新增任务' }))
    fireEvent.change(screen.getByRole('textbox', { name: '任务标题' }), { target: { value: '键盘工作流' } })
    fireEvent.keyDown(window, { key: 's', metaKey: true })
    await waitFor(() => expect(desktop.week.save).toHaveBeenCalledOnce())

    fireEvent.keyDown(window, { key: '5', metaKey: true })
    expect(await screen.findByRole('heading', { name: '计时器' })).toBeTruthy()
  })

  it('keeps navigation interactive after loading local data', async () => {
    window.myWay = api(true)
    render(<App />)
    await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })
    await userEvent.click(screen.getByRole('button', { name: /日历/ }))
    await waitFor(() => expect(screen.getByRole('heading', { name: /月/ })).toBeTruthy())
    expect(document.querySelector('.week-grid')?.textContent).not.toContain('来自本地文件的真实任务')
    expect(screen.getByText(/日历暂时为空/)).toBeTruthy()
  })

  it('waits for current-day saving before loading a data-derived destination view', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      const todayRecord = { ...record, date: '2026-09-01', sourceWeek: 3, tasks: [{ ...record.tasks[0], date: '2026-09-01', originalDate: '2026-09-01' }] }
      let finishSave!: () => void
      const saveGate = new Promise<void>((resolve) => { finishSave = resolve })
      desktop.day.open = vi.fn(async (date) => date === '2026-09-01'
        ? { ok: true as const, value: { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'r1', value: todayRecord }, created: false, missingPlan: false } }
        : { ok: true as const, value: null })
      desktop.day.save = vi.fn(async (file) => {
        await saveGate
        return { ok: true as const, value: { ...file, revision: 'r2' } }
      })
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      window.myWay = desktop
      render(<App />)

      fireEvent.change(await screen.findByRole('spinbutton', { name: /来自本地文件的真实任务 实际分钟/ }), { target: { value: '35' } })
      await userEvent.click(screen.getByRole('button', { name: '本周' }))

      expect(desktop.day.save).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('heading', { name: /今天，9 月 1 日/ })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: '第 3 周' })).toBeNull()

      await act(async () => { finishSave() })
      expect(await screen.findByRole('heading', { name: '第 3 周' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stays on the edited day when navigation saving detects a conflict', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      const todayRecord = { ...record, date: '2026-09-01', sourceWeek: 3, tasks: [{ ...record.tasks[0], date: '2026-09-01', originalDate: '2026-09-01' }] }
      desktop.day.open = vi.fn(async (date) => date === '2026-09-01'
        ? { ok: true as const, value: { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'r1', value: todayRecord }, created: false, missingPlan: false } }
        : { ok: true as const, value: null })
      desktop.day.save = vi.fn(async () => ({ ok: false as const, error: { code: 'CONFLICT' as const, message: '每日记录已被外部修改' } }))
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      window.myWay = desktop
      render(<App />)

      fireEvent.change(await screen.findByRole('spinbutton', { name: /来自本地文件的真实任务 实际分钟/ }), { target: { value: '35' } })
      await userEvent.click(screen.getByRole('button', { name: '本周' }))

      expect(await screen.findByText('每日文件已在 App 外部发生变化。当前编辑不会被静默覆盖。')).toBeTruthy()
      expect(screen.getByRole('heading', { name: /今天，9 月 1 日/ })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: '第 3 周' })).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reports a failed conflict-copy save instead of silently leaving the action unresolved', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      const todayRecord = { ...record, date: '2026-09-01', sourceWeek: 3, tasks: [{ ...record.tasks[0], date: '2026-09-01', originalDate: '2026-09-01' }] }
      desktop.day.open = vi.fn(async () => ({ ok: true as const, value: { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'r1', value: todayRecord }, created: false, missingPlan: false } }))
      desktop.day.save = vi.fn()
        .mockResolvedValueOnce({ ok: false as const, error: { code: 'CONFLICT' as const, message: '每日记录已被外部修改' } })
        .mockResolvedValueOnce({ ok: false as const, error: { code: 'IO' as const, message: '无法建立冲突副本' } })
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      window.myWay = desktop
      render(<App />)

      fireEvent.change(await screen.findByRole('spinbutton', { name: /来自本地文件的真实任务 实际分钟/ }), { target: { value: '35' } })
      await userEvent.click(screen.getByRole('button', { name: '本周' }))
      await userEvent.click(await screen.findByRole('button', { name: '另存冲突副本' }))

      expect(await screen.findByText('无法建立冲突副本')).toBeTruthy()
      expect(desktop.day.save).toHaveBeenNthCalledWith(2, expect.anything(), { asConflictCopy: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('waits for a valid weekly draft to save before opening the calendar', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument({ tasks: [{ id: 'week-task', date: '2026-09-01', category: 'nlp', title: '原任务', plannedMinutes: 60, deliverable: 'notes/week.md' }] })
      let persistedWeek = week
      const todayRecord = { ...record, date: '2026-09-01', sourceWeek: 3, tasks: [] }
      let finishSave!: () => void
      const saveGate = new Promise<void>((resolve) => { finishSave = resolve })
      desktop.day.open = vi.fn(async (date) => date === '2026-09-01'
        ? { ok: true as const, value: { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'r1', value: todayRecord }, created: false, missingPlan: false } }
        : { ok: true as const, value: null })
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: persistedWeek }))
      desktop.week.save = vi.fn(async (request) => {
        await saveGate
        persistedWeek = { path: week.path, revision: 'b'.repeat(64), value: { plan: request.plan, body: request.body } }
        return { ok: true as const, value: persistedWeek }
      })
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '本周' }))
      fireEvent.change(await screen.findByRole('textbox', { name: '任务标题' }), { target: { value: '更新后的任务' } })
      await userEvent.click(screen.getByRole('button', { name: '日历' }))

      expect(desktop.week.save).toHaveBeenCalledTimes(1)
      expect(screen.getByRole('heading', { name: '第 3 周' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: /8 月 31 日/ })).toBeNull()

      await act(async () => { finishSave() })
      expect(await screen.findByRole('heading', { name: /8 月 31 日/ })).toBeTruthy()
      expect(await screen.findByText('更新后的任务')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an invalid weekly draft visible instead of opening a stale destination', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument({ tasks: [{ id: 'week-task', date: '2026-09-01', category: 'nlp', title: '原任务', plannedMinutes: 60, deliverable: 'notes/week.md' }] })
      const todayRecord = { ...record, date: '2026-09-01', sourceWeek: 3, tasks: [] }
      desktop.day.open = vi.fn(async (date) => date === '2026-09-01'
        ? { ok: true as const, value: { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'r1', value: todayRecord }, created: false, missingPlan: false } }
        : { ok: true as const, value: null })
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '本周' }))
      fireEvent.change(await screen.findByRole('textbox', { name: '任务标题' }), { target: { value: '' } })
      await userEvent.click(screen.getByRole('button', { name: '路线' }))

      await waitFor(() => expect(screen.getByRole('textbox', { name: '任务标题' }).getAttribute('aria-invalid')).toBe('true'))
      expect(screen.getAllByText('任务标题不能为空').length).toBeGreaterThan(0)
      expect(screen.getByRole('heading', { name: '第 3 周' })).toBeTruthy()
      expect(screen.queryByRole('heading', { name: '从基础到研究室' })).toBeNull()
      expect(desktop.week.save).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens an unrecorded calendar date without creating a file until the user starts recording', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument({ tasks: [{
        id: 'w3-history', date: '2026-09-02', category: 'nlp', title: '历史日期任务', plannedMinutes: 60, deliverable: 'notes/history.md'
      }] })
      const todayRecord = { ...record, date: '2026-09-01', tasks: [] }
      const createdRecord = {
        ...record,
        date: '2026-09-02',
        sourceWeek: 3,
        tasks: [{ ...record.tasks[0], id: 'w3-history', sourceTaskId: 'w3-history', date: '2026-09-02', originalDate: '2026-09-02', title: '历史日期任务', plannedMinutes: 60 }]
      }
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.day.open = vi.fn(async (date) => ({
        ok: true as const,
        value: date === '2026-09-01'
          ? { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'today-r1', value: todayRecord }, created: false, missingPlan: false }
          : null
      }))
      desktop.day.create = vi.fn(async () => ({
        ok: true as const,
        value: { file: { path: '/tmp/my-way/data/daily/2026/2026-09-02.md', revision: 'history-r1', value: createdRecord }, created: true, missingPlan: false }
      }))
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await userEvent.click(await screen.findByRole('button', { name: '打开 2026-09-02 记录' }))

      expect(await screen.findByRole('heading', { name: '9 月 2 日' })).toBeTruthy()
      expect(screen.getByText('这一天还没有学习记录。')).toBeTruthy()
      expect(desktop.day.create).not.toHaveBeenCalled()

      await userEvent.click(screen.getByRole('button', { name: '开始记录' }))
      await screen.findByRole('button', { name: '打开任务详情：历史日期任务' })
      expect(desktop.day.create).toHaveBeenCalledWith('2026-09-02')
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps an unrecorded calendar date available when explicit record creation rejects', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument({ tasks: [{
        id: 'w3-history', date: '2026-09-02', category: 'nlp', title: '历史日期任务', plannedMinutes: 60, deliverable: 'notes/history.md'
      }] })
      const todayRecord = { ...record, date: '2026-09-01', tasks: [] }
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.day.open = vi.fn(async (date) => ({
        ok: true as const,
        value: date === '2026-09-01'
          ? { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'today-r1', value: todayRecord }, created: false, missingPlan: false }
          : null
      }))
      desktop.day.create = vi.fn(async () => { throw new Error('每日记录目录暂时不可写') })
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await userEvent.click(await screen.findByRole('button', { name: '打开 2026-09-02 记录' }))
      const start = await screen.findByRole('button', { name: '开始记录' })
      await userEvent.click(start)

      expect(await screen.findByText('每日记录目录暂时不可写')).toBeTruthy()
      expect((start as HTMLButtonElement).disabled).toBe(false)
      expect(screen.getByText('这一天还没有学习记录。')).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('loads an existing calendar date and returns to the real current day from navigation', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      const todayRecord = { ...record, date: '2026-09-01', tasks: [{ ...record.tasks[0], id: 'today-task', date: '2026-09-01', originalDate: '2026-09-01', title: '今日任务' }] }
      const historyRecord = { ...record, date: '2026-09-02', tasks: [{ ...record.tasks[0], id: 'history-task', date: '2026-09-02', originalDate: '2026-09-02', title: '历史记录任务' }] }
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.day.open = vi.fn(async (date) => ({
        ok: true as const,
        value: {
          file: {
            path: `/tmp/my-way/data/daily/2026/${date}.md`,
            revision: `${date}-r1`,
            value: date === '2026-09-02' ? historyRecord : todayRecord
          },
          created: false,
          missingPlan: false
        }
      }))
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await userEvent.click(await screen.findByRole('button', { name: '打开 2026-09-02 记录' }))
      expect(await screen.findByRole('button', { name: '打开任务详情：历史记录任务' })).toBeTruthy()
      await userEvent.click(screen.getByRole('button', { name: '返回日历' }))
      const calendarOpener = await screen.findByRole('button', { name: '打开 2026-09-02 记录' })
      await waitFor(() => expect(document.activeElement).toBe(calendarOpener))
      await userEvent.click(calendarOpener)
      expect(await screen.findByRole('button', { name: '打开任务详情：历史记录任务' })).toBeTruthy()

      const createsBefore = vi.mocked(desktop.day.create).mock.calls.length
      await userEvent.click(screen.getByRole('button', { name: '计时器' }))
      await userEvent.click(screen.getByRole('combobox', { name: '关联任务' }))
      expect(screen.getByRole('option', { name: /^今日任务/ })).toBeTruthy()
      expect(screen.queryByRole('option', { name: /历史记录任务/ })).toBeNull()
      expect(vi.mocked(desktop.day.create).mock.calls).toHaveLength(createsBefore)
      await userEvent.click(screen.getByRole('button', { name: '今天' }))
      expect(await screen.findByRole('button', { name: '打开任务详情：今日任务' })).toBeTruthy()
      expect(vi.mocked(desktop.day.open).mock.calls.some(([date]) => date === '2026-09-02')).toBe(true)
      expect(vi.mocked(desktop.day.open).mock.calls.some(([date]) => date === '2026-09-01')).toBe(true)
      expect(vi.mocked(desktop.day.open).mock.calls.at(-1)?.[0]).toBe('2026-08-31')
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns a weekly-review drilldown to the review that opened it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      const summary = {
        ...emptySummary,
        taskOutcomes: [{
          date: '2026-09-01',
          taskId: 'nlp-01',
          title: 'NLP 分类基线',
          category: 'nlp' as const,
          outcomes: 'macro-F1 提升到 0.82'
        }],
        reflections: [{
          date: '2026-09-01',
          learned: '完成 NLP 基线复盘',
          blockers: '概率论证明仍不稳定',
          tomorrow: '重做两道条件概率题'
        }]
      }
      const context = { ...planningContext(week), summary }
      const todayRecord = {
        ...record,
        date: '2026-09-01',
        reflection: summary.reflections[0],
        tasks: [{
          ...record.tasks[0],
          id: 'nlp-01',
          sourceTaskId: 'nlp-01',
          date: '2026-09-01',
          originalDate: '2026-09-01',
          title: 'NLP 分类基线',
          status: 'done' as const,
          outcomes: 'macro-F1 提升到 0.82'
        }]
      }
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: context }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.progress.query = vi.fn(async () => ({ ok: true as const, value: { summary, month: [] } }))
      desktop.day.open = vi.fn(async () => ({
        ok: true as const,
        value: {
          file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'today-r1', value: todayRecord },
          created: false,
          missingPlan: false
        }
      }))
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '本周' }))
      await userEvent.click(await screen.findByRole('button', { name: '复盘' }))
      await userEvent.click(await screen.findByRole('button', { name: '打开 2026-09-01 日终复盘记录' }))

      expect(await screen.findByRole('heading', { name: '今天，9 月 1 日' })).toBeTruthy()
      const back = screen.getByRole('button', { name: '返回本周' })
      await userEvent.click(back)

      expect(await screen.findByLabelText('本周复盘')).toBeTruthy()
      expect(screen.getByText('完成 NLP 基线复盘')).toBeTruthy()
      expect(screen.queryByRole('button', { name: '返回日历' })).toBeNull()
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开 2026-09-01 日终复盘记录' })))

      await userEvent.click(screen.getByRole('button', { name: '打开 2026-09-01 NLP 分类基线任务详情' }))
      const title = await screen.findByRole('textbox', { name: '任务标题' }) as HTMLInputElement
      expect(title.value).toBe('NLP 分类基线')
      expect(screen.getByRole('button', { name: '返回今天' }).getAttribute('aria-keyshortcuts')).toBe('Meta+[')
      fireEvent.keyDown(window, { key: '[', metaKey: true })
      const returnToWeek = await screen.findByRole('button', { name: '返回本周' })
      expect(returnToWeek.getAttribute('aria-keyshortcuts')).toBe('Meta+[')
      fireEvent.keyDown(window, { key: '[', metaKey: true })
      expect(await screen.findByLabelText('本周复盘')).toBeTruthy()
      await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '打开 2026-09-01 NLP 分类基线任务详情' })))
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows the viewed historical week in the rail and restores the current week outside that day view', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const currentWeek = currentWeekDocument()
      const historyWeek = currentWeekDocument({
        week: 2,
        startDate: '2026-08-24',
        endDate: '2026-08-30',
        tasks: [{ id: 'history-task', date: '2026-08-25', category: 'exam', title: '历史周任务', plannedMinutes: 120, deliverable: 'notes/history.md' }]
      })
      const currentContext: WeekPlanningContext = { ...planningContext(currentWeek), summary: { ...emptySummary, actualMinutes: 120 } }
      const historyContext: WeekPlanningContext = {
        ...planningContext(historyWeek),
        date: '2026-08-25',
        startDate: '2026-08-24',
        endDate: '2026-08-30',
        suggestedWeek: 2,
        summary: { ...emptySummary, actualMinutes: 480 }
      }
      const todayRecord = {
        ...record,
        date: '2026-09-01',
        sourceWeek: 3,
        tasks: [{ ...record.tasks[0], id: 'today-task', date: '2026-09-01', originalDate: '2026-09-01', title: '今日任务', actualMinutes: 25, evidence: ['notes/today.md'] }]
      }
      const historyRecord = { ...record, date: '2026-08-25', sourceWeek: 2, tasks: [{ ...record.tasks[0], id: 'history-task', date: '2026-08-25', originalDate: '2026-08-25', title: '历史周任务', plannedMinutes: 120, actualMinutes: 40 }] }
      currentContext.summary.timeRecords = [todayRecord, { date: '2026-08-31', tasks: [{ ...todayRecord.tasks[0], id: 'earlier-current', date: '2026-08-31', actualMinutes: 95, status: 'rescheduled' }] }]
      historyContext.summary.timeRecords = [historyRecord, { date: '2026-08-24', tasks: [{ ...historyRecord.tasks[0], id: 'earlier-history', date: '2026-08-24', actualMinutes: 440, status: 'rescheduled' }] }]
      desktop.week.context = vi.fn(async (date) => ({ ok: true as const, value: date === '2026-08-25' ? historyContext : currentContext }))
      desktop.week.load = vi.fn(async (date) => ({ ok: true as const, value: date.startsWith('2026-08') ? historyWeek : currentWeek }))
      desktop.progress.query = vi.fn(async () => ({ ok: true as const, value: { summary: currentContext.summary, month: [] } }))
      desktop.day.open = vi.fn(async (date) => ({
        ok: true as const,
        value: { file: { path: `/tmp/my-way/data/daily/2026/${date}.md`, revision: `${date}-r1`, value: date === '2026-08-25' ? historyRecord : todayRecord }, created: false, missingPlan: false }
      }))
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await userEvent.click(screen.getByRole('button', { name: '上一周期' }))
      await userEvent.click(await screen.findByRole('button', { name: '打开 2026-08-25 记录' }))

      await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：历史周任务' }))
      expect(screen.queryByRole('button', { name: '开始专注' })).toBeNull()
      await userEvent.click(screen.getByRole('button', { name: '返回当日' }))

      const rail = document.querySelector('.week-context') as HTMLElement
      await waitFor(() => expect(rail.textContent).toContain('所在周'))
      expect(rail.textContent).toContain('08.24 — 08.30')
      const quotaProgress = within(rail).getByRole('progressbar', { name: '所在周学习时长' })
      expect(quotaProgress.getAttribute('aria-valuemax')).toBe('120')
      expect(quotaProgress.getAttribute('aria-valuenow')).toBe('120')
      expect(quotaProgress.getAttribute('aria-valuetext')).toBe('实际 8 小时，目标 2 小时')
      const dailyPlan = within(rail).getByRole('list', { name: '所在周每日计划' })
      expect(within(dailyPlan).getByRole('listitem', { name: '星期二 2026-08-25，学习计划 2 小时，健身计划 0 分钟，1 项任务' })).toBeTruthy()

      fireEvent.change(await screen.findByRole('spinbutton', { name: /历史周任务 实际分钟/ }), { target: { value: '70' } })
      await waitFor(() => expect(quotaProgress.getAttribute('aria-valuetext')).toBe('实际 8 小时 30 分钟，目标 2 小时'))
      expect(quotaProgress.getAttribute('aria-valuenow')).toBe('120')

      // Today was updated elsewhere while the editor was showing a past week.
      currentContext.summary.timeRecords[0] = { ...todayRecord, tasks: [{ ...todayRecord.tasks[0], actualMinutes: 55 }] }
      currentContext.summary.actualMinutes = 150
      await userEvent.click(screen.getByRole('button', { name: '本周' }))
      await waitFor(() => expect(rail.textContent).toContain('本周'))
      expect(rail.textContent).toContain('08.31 — 09.06')
      expect(within(rail).getByRole('progressbar', { name: '本周学习时长' }).getAttribute('aria-valuetext')).toBe('实际 2 小时 30 分钟，目标 1 小时 30 分钟')
      expect(document.querySelector('.right-rail')?.textContent).toContain('今日学习 55 分钟 · 健身 0 分钟')
      expect(document.querySelector('.right-rail')?.textContent).toContain('today.md')
    } finally {
      vi.useRealTimers()
    }
  })

  it('updates the current-week actual total immediately while daily minutes are being edited', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      const context: WeekPlanningContext = { ...planningContext(week), summary: { ...emptySummary, actualMinutes: 120 } }
      const todayRecord = {
        ...record,
        date: '2026-09-01',
        sourceWeek: 3,
        tasks: [{ ...record.tasks[0], date: '2026-09-01', originalDate: '2026-09-01', actualMinutes: 15 }]
      }
      context.summary.timeRecords = [todayRecord, { date: '2026-08-31', tasks: [{ ...todayRecord.tasks[0], id: 'earlier', date: '2026-08-31', actualMinutes: 105, status: 'rescheduled' }] }]
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: context }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.progress.query = vi.fn(async () => ({ ok: true as const, value: { summary: context.summary, month: [] } }))
      desktop.day.open = vi.fn(async (date) => date === '2026-09-01'
        ? {
            ok: true as const,
            value: { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'r1', value: todayRecord }, created: false, missingPlan: false }
          }
        : { ok: true as const, value: null })
      window.myWay = desktop
      render(<App />)

      await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })
      const rail = document.querySelector('.week-context') as HTMLElement
      const learningProgress = within(rail).getByRole('progressbar', { name: '本周学习时长' })
      await waitFor(() => expect(learningProgress.getAttribute('aria-valuetext')).toBe('实际 2 小时，目标 1 小时 30 分钟'))
      fireEvent.change(await screen.findByRole('spinbutton', { name: /来自本地文件的真实任务 实际分钟/ }), { target: { value: '45' } })
      await waitFor(() => expect(learningProgress.getAttribute('aria-valuetext')).toBe('实际 2 小时 30 分钟，目标 1 小时 30 分钟'))
    } finally {
      vi.useRealTimers()
    }
  })

  it('derives independent learning and fitness progress from weekly cards and live daily minutes', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument({ tasks: [
        { id: 'study-task', date: '2026-09-01', category: 'exam', title: '入试复习', plannedMinutes: 600, deliverable: '' },
        { id: 'fitness-task', date: '2026-09-01', category: 'fitness', title: '力量训练', plannedMinutes: 180, deliverable: '' }
      ] })
      const context: WeekPlanningContext = {
        ...planningContext(week),
        summary: {
          ...emptySummary,
          plannedMinutes: 600,
          actualMinutes: 240,
          fitnessPlannedMinutes: 180,
          fitnessActualMinutes: 60,
          byCategory: { ...emptySummary.byCategory, exam: 240, fitness: 60 }
        }
      }
      const todayRecord = {
        ...record,
        date: '2026-09-01',
        sourceWeek: 3,
        tasks: [
          { ...record.tasks[0], id: 'study-task', date: '2026-09-01', originalDate: '2026-09-01', category: 'exam' as const, title: '入试复习', plannedMinutes: 600, actualMinutes: 30 },
          { ...record.tasks[0], id: 'fitness-task', date: '2026-09-01', originalDate: '2026-09-01', category: 'fitness' as const, title: '力量训练', plannedMinutes: 180, actualMinutes: 20 }
        ]
      }
      context.summary.timeRecords = [todayRecord, { date: '2026-08-31', tasks: [
        { ...todayRecord.tasks[0], id: 'earlier-study', date: '2026-08-31', actualMinutes: 210, status: 'rescheduled' },
        { ...todayRecord.tasks[1], id: 'earlier-fitness', date: '2026-08-31', actualMinutes: 40, status: 'rescheduled' }
      ] }]
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: context }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.progress.query = vi.fn(async () => ({ ok: true as const, value: { summary: context.summary, month: [] } }))
      desktop.day.open = vi.fn(async () => ({
        ok: true as const,
        value: { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'r1', value: todayRecord }, created: false, missingPlan: false }
      }))
      window.myWay = desktop
      render(<App />)

      await screen.findByRole('button', { name: '打开任务详情：力量训练' })
      const rail = document.querySelector('.week-context') as HTMLElement
      const learning = within(rail).getByRole('progressbar', { name: '本周学习时长' })
      const fitness = within(rail).getByRole('progressbar', { name: '本周健身时长' })
      expect(learning.getAttribute('aria-valuemax')).toBe('600')
      expect(learning.getAttribute('aria-valuenow')).toBe('240')
      expect(learning.getAttribute('aria-valuetext')).toBe('实际 4 小时，目标 10 小时')
      expect(fitness.getAttribute('aria-valuemax')).toBe('180')
      expect(fitness.getAttribute('aria-valuenow')).toBe('60')
      expect(fitness.getAttribute('aria-valuetext')).toBe('实际 1 小时，目标 3 小时')

      fireEvent.change(screen.getByRole('spinbutton', { name: /力量训练 实际分钟/ }), { target: { value: '50' } })
      await waitFor(() => expect(fitness.getAttribute('aria-valuenow')).toBe('90'))
      expect(learning.getAttribute('aria-valuenow')).toBe('240')
    } finally {
      vi.useRealTimers()
    }
  })

  it('flushes historical-day edits before returning to today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      const todayRecord = { ...record, date: '2026-09-01', tasks: [{ ...record.tasks[0], id: 'today-task', date: '2026-09-01', originalDate: '2026-09-01', title: '今日任务' }] }
      const historyRecord = { ...record, date: '2026-09-02', tasks: [{ ...record.tasks[0], id: 'history-task', date: '2026-09-02', originalDate: '2026-09-02', title: '历史记录任务' }] }
      const events: string[] = []
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.day.open = vi.fn(async (date) => {
        events.push(`open:${date}`)
        return {
          ok: true as const,
          value: { file: { path: `/tmp/my-way/data/daily/2026/${date}.md`, revision: `${date}-r1`, value: date === '2026-09-02' ? historyRecord : todayRecord }, created: false, missingPlan: false }
        }
      })
      desktop.day.save = vi.fn(async (file) => {
        events.push(`save:${file.value.date}`)
        return { ok: true as const, value: { ...file, revision: `${file.value.date}-r2` } }
      })
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await userEvent.click(await screen.findByRole('button', { name: '打开 2026-09-02 记录' }))
      fireEvent.change(await screen.findByRole('spinbutton', { name: /历史记录任务 实际分钟/ }), { target: { value: '35' } })
      await userEvent.click(screen.getByRole('button', { name: '今天' }))

      expect(await screen.findByRole('button', { name: '打开任务详情：今日任务' })).toBeTruthy()
      expect(events.lastIndexOf('save:2026-09-02')).toBeLessThan(events.lastIndexOf('open:2026-09-01'))
      const historicalSave = vi.mocked(desktop.day.save).mock.calls.find(([file]) => file.value.date === '2026-09-02')?.[0]
      expect(historicalSave?.value.tasks[0].actualMinutes).toBe(35)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps the historical day open when its pending save conflicts', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      const todayRecord = { ...record, date: '2026-09-01', tasks: [] }
      const historyRecord = { ...record, date: '2026-09-02', tasks: [{ ...record.tasks[0], id: 'history-task', date: '2026-09-02', originalDate: '2026-09-02', title: '历史记录任务' }] }
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.day.open = vi.fn(async (date) => ({ ok: true as const, value: { file: { path: `/tmp/my-way/data/daily/2026/${date}.md`, revision: `${date}-r1`, value: date === '2026-09-02' ? historyRecord : todayRecord }, created: false, missingPlan: false } }))
      desktop.day.save = vi.fn(async () => ({ ok: false as const, error: { code: 'CONFLICT' as const, message: '历史记录已在外部修改' } }))
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await userEvent.click(await screen.findByRole('button', { name: '打开 2026-09-02 记录' }))
      fireEvent.change(await screen.findByRole('spinbutton', { name: /历史记录任务 实际分钟/ }), { target: { value: '35' } })
      await userEvent.click(screen.getByRole('button', { name: '今天' }))

      expect(await screen.findByRole('heading', { name: '9 月 2 日' })).toBeTruthy()
      expect(screen.getByRole('button', { name: '打开任务详情：历史记录任务' })).toBeTruthy()
      expect(screen.getByText(/当前编辑不会被静默覆盖/)).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('opens a day from the month view and refreshes that active date after an external edit', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      let listener: ((event: FileWatchEvent) => void) | undefined
      let external = false
      const todayRecord = { ...record, date: '2026-09-01', tasks: [] }
      const historical = (title: string) => ({ ...record, date: '2026-09-02', tasks: [{ ...record.tasks[0], id: 'history-task', date: '2026-09-02', originalDate: '2026-09-02', title }] })
      desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(week) }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.day.open = vi.fn(async (date) => ({
        ok: true as const,
        value: date === '2026-09-01'
          ? { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'today-r1', value: todayRecord }, created: false, missingPlan: false }
          : date === '2026-09-02'
            ? { file: { path: '/tmp/my-way/data/daily/2026/2026-09-02.md', revision: external ? 'history-r2' : 'history-r1', value: historical(external ? '外部更新的历史任务' : '历史任务') }, created: false, missingPlan: false }
            : null
      }))
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await userEvent.click(screen.getByRole('button', { name: '月' }))
      await userEvent.click(screen.getByRole('button', { name: '打开 2026-09-02 记录' }))
      expect(await screen.findByRole('button', { name: '打开任务详情：历史任务' })).toBeTruthy()

      external = true
      await act(async () => {
        listener?.({ kind: 'changed', path: 'data/daily/2026/2026-09-02.md', at: new Date().toISOString() })
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(await screen.findByRole('button', { name: '打开任务详情：外部更新的历史任务' })).toBeTruthy()
    } finally {
      vi.useRealTimers()
    }
  })

  it('adds a timer workspace without starting implicitly and keeps its compact status across navigation', async () => {
    const desktop = api(true)
    const now = new Date().toISOString()
    desktop.timer.start = vi.fn(async () => ({
      ok: true as const,
      value: {
        active: {
          id: '00000000-0000-4000-8000-000000000001', mode: 'elapsed' as const, status: 'running' as const,
          createdAt: now, segmentStartedAt: now, accumulatedSeconds: 0, updatedAt: now
        },
        capturedAt: now
      }
    }))
    window.myWay = desktop
    render(<App />)
    await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })

    await userEvent.click(screen.getByRole('button', { name: '计时器' }))
    expect(screen.getByRole('heading', { name: '计时器' })).toBeTruthy()
    expect(desktop.timer.start).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('button', { name: '开始' }))
    await waitFor(() => expect(desktop.timer.start).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: '打开计时器' })).toBeTruthy()
    expect(document.querySelector('.timer-sidebar-entry')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '今天' }))
    expect(screen.getByRole('heading', { name: '今日任务' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开计时器' })).toBeTruthy()
    expect(desktop.timer.subscribe).toHaveBeenCalledOnce()
  })

  it.each(['elapsed', 'countdown'] as const)('starts %s with the selected real task and preserves the idle choice across navigation', async mode => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 16, 12))
    try {
      const desktop = api(true)
      window.myWay = desktop
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: '计时器' }))
      await userEvent.click(screen.getByRole('combobox', { name: '关联任务' }))
      await userEvent.click(screen.getByRole('option', { name: /来自本地文件的真实任务/ }))
      expect(desktop.timer.start).not.toHaveBeenCalled()
      await userEvent.click(screen.getByRole('button', { name: '今天' }))
      await userEvent.click(screen.getByRole('button', { name: '计时器' }))
      expect(screen.getByRole('combobox', { name: '关联任务' }).textContent).toContain(record.tasks[0].title)
      if (mode === 'countdown') await userEvent.click(screen.getByRole('button', { name: '倒计时' }))
      await userEvent.click(screen.getByRole('button', { name: '开始' }))
      await waitFor(() => expect(desktop.timer.start).toHaveBeenCalledWith(expect.objectContaining({ mode, taskIntent: { date: record.date, taskId: 'real-task', taskTitle: record.tasks[0].title }, ...(mode === 'countdown' ? { countdownMinutes: 25 } : {}) })))
      expect(desktop.day.create).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('keeps the authoritative active task and clock when an intent write fails', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 16, 12))
    try {
      const desktop = api(true)
      const active = { id: 'running', mode: 'elapsed' as const, status: 'running' as const, createdAt: '2026-08-16T03:59:00.000Z', segmentStartedAt: '2026-08-16T03:59:00.000Z', accumulatedSeconds: 5, updatedAt: '2026-08-16T03:59:00.000Z', taskIntent: { date: record.date, taskId: 'real-task', taskTitle: record.tasks[0].title } }
      desktop.timer.get = vi.fn(async () => ({ ok: true as const, value: { active, capturedAt: '2026-08-16T04:00:00.000Z' } }))
      desktop.timer.setTaskIntent = vi.fn(async () => ({ ok: false as const, error: { code: 'CONFLICT' as const, message: '文件已变化' } }))
      window.myWay = desktop
      render(<App />)
      await userEvent.click(await screen.findByRole('button', { name: '计时器' }))
      const clock = screen.getByLabelText('当前计时')
      const before = clock.textContent
      await userEvent.click(screen.getByRole('combobox', { name: '关联任务' }))
      await userEvent.click(screen.getByRole('option', { name: '不关联任务' }))
      await waitFor(() => expect(desktop.timer.setTaskIntent).toHaveBeenCalledWith({ sessionId: 'running', taskIntent: null }))
      expect(await screen.findByText('文件已变化')).toBeTruthy()
      expect(screen.getByRole('combobox', { name: '关联任务' }).textContent).toContain(record.tasks[0].title)
      expect(screen.getByLabelText('当前计时')).toBe(clock)
      expect(clock.textContent).toBe(before)
      expect(desktop.timer.start).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('starts a persisted task-focused timer from todays task detail', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 7, 16, 12))
    try {
      const desktop = api(true)
      const now = new Date().toISOString()
      let startRequest: Parameters<DesktopApi['timer']['start']>[0] | undefined
      let resolveStart: ((result: Awaited<ReturnType<DesktopApi['timer']['start']>>) => void) | undefined
      desktop.timer.start = vi.fn((request: Parameters<DesktopApi['timer']['start']>[0]) => new Promise<Awaited<ReturnType<DesktopApi['timer']['start']>>>((resolve) => {
        startRequest = request
        resolveStart = resolve
      }))
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
      await userEvent.click(screen.getByRole('button', { name: '开始专注' }))

      await waitFor(() => expect(desktop.timer.start).toHaveBeenCalledWith(expect.objectContaining({
        mode: 'elapsed',
        taskIntent: {
          date: '2026-08-16',
          taskId: 'real-task',
          taskTitle: '来自本地文件的真实任务'
        }
      })))
      const pending = screen.getByRole('button', { name: '正在开始…' }) as HTMLButtonElement
      expect(pending.disabled).toBe(true)
      fireEvent.click(pending)
      expect(desktop.timer.start).toHaveBeenCalledOnce()
      await act(async () => resolveStart?.({
        ok: true,
        value: {
          active: {
            id: startRequest?.sessionId ?? 'task-focused',
            mode: 'elapsed',
            status: 'running',
            createdAt: now,
            segmentStartedAt: now,
            accumulatedSeconds: 0,
            updatedAt: now,
            taskIntent: startRequest?.taskIntent
          },
          capturedAt: now
        }
      }))
      expect(await screen.findByRole('heading', { name: '计时器' })).toBeTruthy()
      expect(screen.getAllByText('来自本地文件的真实任务').length).toBeGreaterThan(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('saves pending day edits before assigning time, then hydrates the returned day and refreshes progress', async () => {
    const desktop = api(true)
    const local = new Date()
    const today = `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, '0')}-${String(local.getDate()).padStart(2, '0')}`
    const currentRecord = {
      ...record,
      date: today,
      tasks: record.tasks.map((task) => ({ ...task, date: today, originalDate: today }))
    }
    const session = {
      id: 'timer-session', mode: 'elapsed' as const, status: 'pending' as const,
      startedAt: `${today}T08:00:00.000Z`, endedAt: `${today}T08:10:00.000Z`, durationSeconds: 600
    }
    const events: string[] = []
    desktop.day.open = vi.fn(async () => ({ ok: true as const, value: { file: { path: `/tmp/my-way/data/daily/2026/${today}.md`, revision: 'r1', value: currentRecord }, created: false, missingPlan: true } }))
    desktop.day.save = vi.fn(async (file) => {
      events.push('save')
      return { ok: true as const, value: { ...file, revision: 'r2' } }
    })
    desktop.timer.list = vi.fn(async () => ({ ok: true as const, value: { today: [], pending: [session] } }))
    desktop.timer.assignmentOptions = vi.fn(async () => ({ ok: true as const, value: { session, date: today, tasks: [{ id: 'real-task', title: '来自本地文件的真实任务', actualMinutes: 15 }] } }))
    desktop.timer.assign = vi.fn(async () => {
      events.push('assign')
      return {
        ok: true as const,
        value: {
          session: { ...session, status: 'assigned' as const, assignment: { taskId: 'real-task', taskTitle: '来自本地文件的真实任务', creditedMinutes: 10, assignedAt: new Date().toISOString() } },
          day: { path: `/tmp/my-way/data/daily/2026/${today}.md`, revision: 'r3', value: { ...currentRecord, tasks: currentRecord.tasks.map((task) => ({ ...task, actualMinutes: 25 })) } }
        }
      }
    })
    window.myWay = desktop
    render(<App />)
    const actual = await screen.findByRole('spinbutton', { name: /实际分钟/ })
    fireEvent.change(actual, { target: { value: '16' } })
    await userEvent.click(screen.getByRole('button', { name: '计时器' }))
    await userEvent.click(await screen.findByRole('button', { name: /^稍后分配 / }))
    await userEvent.click(await screen.findByRole('button', { name: '分配到任务' }))

    await waitFor(() => expect(desktop.timer.assign).toHaveBeenCalledOnce())
    expect(events.slice(-2)).toEqual(['save', 'assign'])
    expect(desktop.progress.query).toHaveBeenCalledTimes(2)
    await userEvent.click(screen.getByRole('button', { name: '今天' }))
    expect((await screen.findByRole('spinbutton', { name: /实际分钟/ }) as HTMLInputElement).value).toBe('25')
  })

  it('refreshes the cached today rail after assigning time while another date is active', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 1, 12))
    try {
      const desktop = api(true)
      const week = currentWeekDocument()
      const todayRecord = {
        ...record,
        date: '2026-09-01',
        sourceWeek: 3,
        tasks: [{ ...record.tasks[0], date: '2026-09-01', originalDate: '2026-09-01', actualMinutes: 15 }]
      }
      const historyRecord = { ...record, date: '2026-09-02', sourceWeek: 3, tasks: [] }
      const session = {
        id: 'historical-view-session', mode: 'elapsed' as const, status: 'pending' as const,
        startedAt: '2026-09-01T08:00:00.000Z', endedAt: '2026-09-01T08:10:00.000Z', durationSeconds: 600
      }
      const summary = () => ({
        ...emptySummary,
        actualMinutes: vi.mocked(desktop.timer.assign).mock.calls.length ? 25 : 15,
        timeRecords: [historyRecord, { ...todayRecord, tasks: todayRecord.tasks.map((task) => ({
          ...task, actualMinutes: vi.mocked(desktop.timer.assign).mock.calls.length ? 25 : 15
        })) }]
      })
      desktop.day.open = vi.fn(async (date) => ({
        ok: true as const,
        value: date === '2026-09-01'
          ? { file: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'today-r1', value: todayRecord }, created: false, missingPlan: false }
          : date === '2026-09-02'
            ? { file: { path: '/tmp/my-way/data/daily/2026/2026-09-02.md', revision: 'history-r1', value: historyRecord }, created: false, missingPlan: false }
            : null
      }))
      desktop.week.context = vi.fn(async () => ({ ok: true as const, value: { ...planningContext(week), summary: summary() } }))
      desktop.week.load = vi.fn(async () => ({ ok: true as const, value: week }))
      desktop.progress.query = vi.fn(async () => ({ ok: true as const, value: { summary: summary(), month: [] } }))
      desktop.timer.list = vi.fn(async () => ({ ok: true as const, value: { today: [], pending: [session] } }))
      desktop.timer.assignmentOptions = vi.fn(async () => ({ ok: true as const, value: { session, date: '2026-09-01', tasks: [{ id: 'real-task', title: '来自本地文件的真实任务', actualMinutes: 15 }] } }))
      desktop.timer.assign = vi.fn(async () => ({
        ok: true as const,
        value: {
          session: { ...session, status: 'assigned' as const, assignment: { taskId: 'real-task', taskTitle: '来自本地文件的真实任务', creditedMinutes: 10, assignedAt: new Date().toISOString() } },
          day: { path: '/tmp/my-way/data/daily/2026/2026-09-01.md', revision: 'today-r2', value: { ...todayRecord, tasks: todayRecord.tasks.map((task) => ({ ...task, actualMinutes: 25 })) } }
        }
      }))
      window.myWay = desktop
      render(<App />)

      await userEvent.click(await screen.findByRole('button', { name: '日历' }))
      await userEvent.click(await screen.findByRole('button', { name: '打开 2026-09-02 记录' }))
      await userEvent.click(screen.getByRole('button', { name: '计时器' }))
      await userEvent.click(await screen.findByRole('button', { name: /^稍后分配 / }))
      await userEvent.click(await screen.findByRole('button', { name: '分配到任务' }))

      await waitFor(() => expect(desktop.timer.assign).toHaveBeenCalledOnce())
      expect(document.querySelector('.right-rail')?.textContent).toContain('今日学习 25 分钟 · 健身 0 分钟')
    } finally {
      vi.useRealTimers()
    }
  })

  it('shows a real loading error instead of preview progress figures', async () => {
    const desktop = api(true)
    const emptyProgress = { summary: emptySummary, month: [] }
    desktop.progress.query = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: emptyProgress })
      .mockResolvedValueOnce({ ok: false, error: { code: 'IO', message: '进度文件读取失败' } })
    window.myWay = desktop
    render(<App />)
    await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })
    await userEvent.click(screen.getByRole('button', { name: '本周' }))
    expect((await screen.findByRole('alert')).textContent).toContain('进度文件读取失败')
    expect(screen.queryByText(/12h/)).toBeNull()
  })

  it('keeps the study workspace usable when file-watch subscription setup fails', async () => {
    const desktop = api(true)
    desktop.files.subscribe = vi.fn(() => { throw new Error('文件监听桥接不可用') })
    window.myWay = desktop

    render(<App />)

    expect(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toContain('无法启动文件监听：文件监听桥接不可用')
  })

  it('keeps the study workspace usable when close-protection subscription setup fails', async () => {
    const desktop = api(true)
    desktop.lifecycle.onBeforeClose = vi.fn(() => { throw new Error('关闭监听桥接不可用') })
    window.myWay = desktop

    render(<App />)

    expect(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })).toBeTruthy()
    expect((await screen.findByRole('alert')).textContent).toContain('无法注册关闭保护：关闭监听桥接不可用')
  })

  it('keeps the window open and reports an error when close-time saving fails', async () => {
    const desktop = api(true)
    let beforeClose: (() => void) | undefined
    desktop.lifecycle.onBeforeClose = vi.fn((listener) => { beforeClose = listener; return () => undefined })
    desktop.day.save = vi.fn(async () => ({ ok: false as const, error: { code: 'VALIDATION' as const, message: '任务标题不能为空' } }))
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    const title = screen.getByRole('textbox', { name: '任务标题' })
    await userEvent.clear(title)
    await act(async () => { beforeClose?.(); await Promise.resolve() })
    expect(desktop.lifecycle.readyToClose).not.toHaveBeenCalled()
    expect((await screen.findByRole('alert')).textContent).toContain('窗口已保持打开')
    expect(desktop.lifecycle.cancelClose).toHaveBeenCalledOnce()
  })

  it('retries a cancelled close after the user fixes a recoverable save failure', async () => {
    const desktop = api(true)
    let beforeClose: (() => void) | undefined
    desktop.lifecycle.onBeforeClose = vi.fn((listener) => { beforeClose = listener; return () => undefined })
    desktop.day.save = vi.fn()
      .mockResolvedValueOnce({ ok: false as const, error: { code: 'IO' as const, message: '磁盘暂时不可写' } })
      .mockImplementation(async (file) => ({ ok: true as const, value: { ...file, revision: 'r-recovered' } }))
    window.myWay = desktop
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    fireEvent.change(screen.getByRole('textbox', { name: '任务标题' }), { target: { value: '修正后的标题' } })

    await act(async () => { beforeClose?.(); await Promise.resolve() })
    await waitFor(() => expect(desktop.lifecycle.cancelClose).toHaveBeenCalledOnce())
    expect(desktop.lifecycle.readyToClose).not.toHaveBeenCalled()

    await act(async () => { beforeClose?.(); await Promise.resolve() })
    await waitFor(() => expect(desktop.lifecycle.readyToClose).toHaveBeenCalledOnce())
    expect(desktop.day.save).toHaveBeenCalledTimes(2)
  })

  it('keeps a daily edit dirty and reports a rejected autosave call', async () => {
    const desktop = api(true)
    desktop.day.save = vi.fn(async () => { throw new Error('每日保存通道已断开') })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' }))
    fireEvent.change(screen.getByRole('textbox', { name: '任务标题' }), { target: { value: '尚未保存的标题' } })

    expect(await screen.findByText('每日保存通道已断开', {}, { timeout: 2000 })).toBeTruthy()
    expect(document.querySelector('.save-state')?.textContent).toContain('待保存修改')
  })

  it('does not admit an invalid zero-minute plan into local state', async () => {
    window.myWay = api(true)
    render(<App />)
    const planned = await screen.findByRole('spinbutton', { name: /计划分钟/ })
    await userEvent.clear(planned)
    expect((planned as HTMLInputElement).value).toBe('')
    expect(planned.getAttribute('aria-invalid')).toBe('true')
    await userEvent.keyboard('{Meta>}s{/Meta}')
    expect(window.myWay.day.save).not.toHaveBeenCalled()
  })

  it('rejects an impossible aggregate daily actual time before autosave', async () => {
    const desktop = api(true)
    const tasks = [{ ...record.tasks[0], actualMinutes: 800 }, { ...record.tasks[0], id: 'manual', title: '新学习任务', actualMinutes: 0 }]
    desktop.day.open = vi.fn(async () => ({ ok: true as const, value: { file: { path: '/tmp/day.md', revision: 'r1', value: { ...record, tasks } }, created: false, missingPlan: true } }))
    window.myWay = desktop
    render(<App />)

    await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })
    const manualActual = screen.getByRole('spinbutton', { name: '新学习任务 实际分钟' }) as HTMLInputElement
    fireEvent.change(manualActual, { target: { value: '700' } })

    expect(await screen.findByText('请输入 0–640 的整数分钟')).toBeTruthy()
    expect(manualActual.value).toBe('700')
    await userEvent.keyboard('{Meta>}s{/Meta}')
    expect(window.myWay.day.save).not.toHaveBeenCalled()
  })

  it('surfaces carryover conflicts instead of silently keeping inconsistent files', async () => {
    const desktop = api(true)
    desktop.day.resolveCarryover = vi.fn(async () => ({ ok: false as const, error: { code: 'CONFLICT' as const, message: '顺延源文件和目标文件均已变化' } }))
    window.myWay = desktop
    render(<App />)
    await screen.findByRole('button', { name: '打开任务详情：来自本地文件的真实任务' })
    await userEvent.click(await screen.findByText('待处理任务 · 1 项'))
    await userEvent.click(await screen.findByRole('button', { name: '顺延到今天：来自本地文件的真实任务' }))
    expect((await screen.findByRole('alert')).textContent).toContain('已保留任务副本')
  })

  it('saves current edits before carryover and preserves edits made during the transaction', async () => {
    const desktop = api(true)
    let finish!: () => void
    let targetAtStart!: ParsedDailyRecord
    desktop.day.resolveCarryover = vi.fn<DesktopApi['day']['resolveCarryover']>((payload) => new Promise((resolve) => {
      targetAtStart = vi.mocked(desktop.day.save).mock.calls.at(-1)?.[0].value ?? record
      finish = () => resolve({ ok: true, value: {
        source: { ...payload.source, value: { ...payload.source.value, tasks: payload.source.value.tasks.map((task) => ({ ...task, status: 'rescheduled' as const })) } },
        target: { path: '/tmp/day.md', revision: 'carried-r2', value: { ...targetAtStart, tasks: [...targetAtStart.tasks, { ...record.tasks[0], id: 'carried', title: '顺延剩余', actualMinutes: 0, plannedMinutes: 30, status: 'planned' as const }] } }
      } })
    }))
    window.myWay = desktop
    render(<App />)
    const actual = await screen.findByRole('spinbutton', { name: '来自本地文件的真实任务 实际分钟' })
    await userEvent.click(await screen.findByText('待处理任务 · 1 项'))
    fireEvent.change(actual, { target: { value: '25' } })
    fireEvent.click(screen.getByRole('button', { name: '顺延到今天：来自本地文件的真实任务' }))
    await waitFor(() => expect(desktop.day.resolveCarryover).toHaveBeenCalledOnce())
    expect(targetAtStart.tasks[0].actualMinutes).toBe(25)
    fireEvent.change(actual, { target: { value: '40' } })
    await act(async () => { finish(); await Promise.resolve() })
    expect((actual as HTMLInputElement).value).toBe('40')
    expect(screen.getByRole('button', { name: '打开任务详情：顺延剩余' })).toBeTruthy()
    await userEvent.keyboard('{Meta>}s{/Meta}')
    await waitFor(() => expect(vi.mocked(desktop.day.save).mock.calls.at(-1)?.[0]).toMatchObject({
      revision: 'carried-r2', value: { tasks: [expect.objectContaining({ actualMinutes: 40 }), expect.objectContaining({ id: 'carried' })] }
    }))
  })

  it('contains a rejected carryover call and unlocks the task choice for retry', async () => {
    const desktop = api(true)
    desktop.day.resolveCarryover = vi.fn(async () => { throw new Error('顺延服务暂时不可用') })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByText('待处理任务 · 1 项'))
    const reschedule = await screen.findByRole('button', { name: '顺延到今天：来自本地文件的真实任务' })
    await userEvent.click(reschedule)

    expect((await screen.findByRole('alert')).textContent).toContain('顺延失败：顺延服务暂时不可用。任务仍保留，请重试。')
    expect((reschedule as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps edits made during a failed carryover instead of reloading the current day', async () => {
    const desktop = api(true)
    let finish!: () => void
    desktop.day.resolveCarryover = vi.fn<DesktopApi['day']['resolveCarryover']>(() => new Promise((resolve) => {
      finish = () => resolve({ ok: false, error: { code: 'CONFLICT', message: '外部修改' } })
    }))
    window.myWay = desktop
    render(<App />)
    const actual = await screen.findByRole('spinbutton', { name: '来自本地文件的真实任务 实际分钟' })
    await userEvent.click(await screen.findByText('待处理任务 · 1 项'))
    fireEvent.click(screen.getByRole('button', { name: '顺延到今天：来自本地文件的真实任务' }))
    await waitFor(() => expect(desktop.day.resolveCarryover).toHaveBeenCalledOnce())
    fireEvent.change(actual, { target: { value: '40' } })
    await act(async () => { finish(); await Promise.resolve() })
    expect((actual as HTMLInputElement).value).toBe('40')
    expect(screen.getByRole('alert').textContent).toContain('外部修改')
    expect(document.querySelector('.save-state')?.textContent).toContain('待保存修改')
  })

  it('does not adopt a new revision over concurrent external changes to existing target fields', async () => {
    const desktop = api(true)
    let finish!: () => void
    desktop.day.resolveCarryover = vi.fn<DesktopApi['day']['resolveCarryover']>((payload) => new Promise((resolve) => {
      finish = () => resolve({ ok: true, value: { source: payload.source, target: {
        path: '/tmp/day.md', revision: 'external-and-carried', value: { ...record, notes: '外部新笔记' }
      } } })
    }))
    window.myWay = desktop
    render(<App />)
    const actual = await screen.findByRole('spinbutton', { name: '来自本地文件的真实任务 实际分钟' })
    await userEvent.click(await screen.findByText('待处理任务 · 1 项'))
    fireEvent.click(screen.getByRole('button', { name: '顺延到今天：来自本地文件的真实任务' }))
    await waitFor(() => expect(desktop.day.resolveCarryover).toHaveBeenCalledOnce())
    fireEvent.change(actual, { target: { value: '40' } })
    await act(async () => { finish(); await Promise.resolve() })
    expect((actual as HTMLInputElement).value).toBe('40')
    expect(document.querySelector('.save-state')?.textContent).toContain('文件冲突')
    expect(desktop.day.save).not.toHaveBeenCalled()
  })

  it('serializes carryover choices and blocks a second transaction while the first is pending', async () => {
    const desktop = api(true)
    let finish: (() => void) | undefined
    desktop.day.resolveCarryover = vi.fn((payload) => new Promise<Awaited<ReturnType<DesktopApi['day']['resolveCarryover']>>>((resolve) => {
      finish = () => resolve({ ok: true, value: { source: payload.source } })
    }))
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByText('待处理任务 · 1 项'))
    const reschedule = await screen.findByRole('button', { name: '顺延到今天：来自本地文件的真实任务' })
    const skip = screen.getByRole('button', { name: '跳过：来自本地文件的真实任务' })
    fireEvent.click(reschedule)
    fireEvent.click(skip)
    expect((reschedule as HTMLButtonElement).disabled).toBe(true)
    await waitFor(() => expect(desktop.day.resolveCarryover).toHaveBeenCalledOnce())
    await act(async () => { finish?.(); await Promise.resolve() })
  })

  it('opens weekly planning directly from Today when the current plan is missing', async () => {
    window.myWay = api(true)
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '建立本周计划' }))
    expect(screen.getByRole('heading', { name: '第 3 周' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存本周计划' })).toBeTruthy()
  })

  it('uses the real W3 dates and stage across the weekly workspace, route and right rail', async () => {
    const desktop = api(true)
    desktop.route.load = vi.fn(async () => ({ ok: true as const, value: [
      { id: 'twelve-week' as const, title: '12 周路线', path: '00-dashboard/12-week-roadmap.md', content: '# 12 周路线' },
      { id: 'long-term' as const, title: '长期路线', path: '00-dashboard/long-term-roadmap.md', content: '# 长期路线' }
    ] }))
    window.myWay = desktop
    render(<App />)

    expect(await screen.findByText('08.31 — 09.06')).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: '本周' }))
    expect(screen.getByRole('heading', { name: '第 3 周' })).toBeTruthy()
    expect(screen.getByText('8 月 31 日 — 9 月 6 日')).toBeTruthy()

    await userEvent.click(screen.getByRole('button', { name: '路线' }))
    expect(await screen.findByText('第 3 周 · 基础校准')).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '路线文档' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '12 周路线' }).getAttribute('aria-current')).toBe('page')
    await userEvent.click(screen.getByRole('button', { name: '长期路线' }))
    expect(screen.getByRole('button', { name: '长期路线' }).getAttribute('aria-current')).toBe('page')
  })

  it('creates a valid week, reloads authoritative context and computes a day diff without rewriting Today', async () => {
    const desktop = api(true)
    let saved: WeekDocument | null = null
    desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(saved) }))
    desktop.week.save = vi.fn(async (request) => {
      saved = { path: '00-dashboard/weeks/week-03.md', revision: 'b'.repeat(64), value: { plan: request.plan, body: request.body } }
      return { ok: true as const, value: saved }
    })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '建立本周计划' }))
    await userEvent.click(screen.getByRole('button', { name: '新增任务' }))
    fireEvent.change(screen.getByRole('textbox', { name: '任务标题' }), { target: { value: '第三周数学诊断' } })
    await userEvent.click(screen.getByRole('button', { name: '保存本周计划' }))

    await waitFor(() => expect(desktop.week.save).toHaveBeenCalledOnce())
    await waitFor(() => expect(vi.mocked(desktop.week.context).mock.calls.length).toBeGreaterThanOrEqual(2))
    expect(desktop.week.diff).toHaveBeenCalled()
    expect(desktop.day.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '保存更改' })).toBeTruthy()
  })

  it('autosaves an existing weekly plan with its current revision', async () => {
    const desktop = api(true)
    const document = currentWeekDocument({ tasks: [{
      id: 'w3-math', date: '2026-08-31', category: 'exam', title: '数学诊断', plannedMinutes: 120, deliverable: 'evidence/math.md'
    }] })
    desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(document) }))
    desktop.week.save = vi.fn(async (request) => ({ ok: true as const, value: { ...document, revision: 'b'.repeat(64), value: { plan: request.plan, body: request.body } } }))
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '本周' }))
    fireEvent.change(screen.getByDisplayValue('数学诊断'), { target: { value: '数学诊断与复盘' } })

    await waitFor(() => expect(desktop.week.save).toHaveBeenCalledOnce(), { timeout: 2000 })
    expect(vi.mocked(desktop.week.save).mock.calls[0][0]).toMatchObject({
      expectedRevision: 'a'.repeat(64),
      plan: { tasks: [{ title: '数学诊断与复盘' }] }
    })
  })

  it('keeps an existing weekly draft dirty and reports a rejected autosave call', async () => {
    const desktop = api(true)
    const document = currentWeekDocument({ tasks: [{
      id: 'w3-math', date: '2026-08-31', category: 'exam', title: '数学诊断', plannedMinutes: 120, deliverable: 'evidence/math.md'
    }] })
    desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(document) }))
    desktop.week.save = vi.fn(async () => { throw new Error('周计划保存通道已断开') })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '本周' }))
    fireEvent.change(screen.getByDisplayValue('数学诊断'), { target: { value: '尚未保存的数学诊断' } })

    expect(await screen.findByText('周计划保存通道已断开', {}, { timeout: 2000 })).toBeTruthy()
    expect(screen.getByRole('button', { name: '保存更改' })).toBeTruthy()
  })

  it('reloads a clean weekly plan after an external edit and protects a dirty draft as a conflict', async () => {
    const desktop = api(true)
    let listener: ((event: FileWatchEvent) => void) | undefined
    let external = false
    const original = currentWeekDocument({ tasks: [{ id: 'w3-math', date: '2026-08-31', category: 'exam', title: '原计划', plannedMinutes: 120, deliverable: '' }] })
    const changed: WeekDocument = {
      ...original,
      revision: 'c'.repeat(64),
      value: { ...original.value, plan: { ...original.value.plan, tasks: [{ ...original.value.plan.tasks[0], title: '外部计划' }] } }
    }
    desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
    desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(external ? changed : original) }))
    window.myWay = desktop
    const first = render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '本周' }))
    expect(screen.getByDisplayValue('原计划')).toBeTruthy()
    external = true
    await act(async () => {
      listener?.({ kind: 'changed', path: '/tmp/my-way/00-dashboard/weeks/week-03.md', at: new Date().toISOString() })
      await Promise.resolve()
    })
    expect(await screen.findByDisplayValue('外部计划')).toBeTruthy()

    first.unmount()
    external = false
    const second = api(true)
    let progressFails = false
    second.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
    second.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(external ? changed : original) }))
    second.progress.query = vi.fn(async () => progressFails
      ? { ok: false as const, error: { code: 'IO' as const, message: '进度文件暂时不可读' } }
      : { ok: true as const, value: { summary: emptySummary, month: [] } })
    window.myWay = second
    render(<App />)
    await userEvent.click(await screen.findByRole('button', { name: '本周' }))
    fireEvent.change(screen.getByDisplayValue('原计划'), { target: { value: '本地草案' } })
    external = true
    await act(async () => {
      listener?.({ kind: 'changed', path: '/tmp/my-way/00-dashboard/weeks/week-03.md', at: new Date().toISOString() })
      await Promise.resolve()
    })
    expect((await screen.findAllByText(/当前草案不会被静默覆盖/)).length).toBeGreaterThan(0)
    expect(screen.getByDisplayValue('本地草案')).toBeTruthy()
    progressFails = true
    await userEvent.click(screen.getByRole('button', { name: '重新载入周计划' }))
    expect(await screen.findByDisplayValue('外部计划')).toBeTruthy()
    expect(await screen.findByText('进度文件暂时不可读')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '另存冲突副本' })).toBeNull()
  })

  it('preserves a conflicted weekly draft as a separate copy before reloading the external plan', async () => {
    const desktop = api(true)
    let listener: ((event: FileWatchEvent) => void) | undefined
    let external = false
    const original = currentWeekDocument({ tasks: [{ id: 'w3-math', date: '2026-08-31', category: 'exam', title: '原计划', plannedMinutes: 120, deliverable: '' }] })
    const changed: WeekDocument = {
      ...original,
      revision: 'c'.repeat(64),
      value: { ...original.value, plan: { ...original.value.plan, tasks: [{ ...original.value.plan.tasks[0], title: '外部计划' }] } }
    }
    const conflictCopy: WeekDocument = {
      ...original,
      path: '/tmp/my-way/00-dashboard/weeks/week-03.conflict-20260901T080910123Z-copy.md',
      revision: 'd'.repeat(64),
      value: { ...original.value, plan: { ...original.value.plan, tasks: [{ ...original.value.plan.tasks[0], title: '本地草案' }] } }
    }
    desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
    desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(external ? changed : original) }))
    desktop.week.save = vi.fn(async (request) => request.asConflictCopy
      ? { ok: true as const, value: conflictCopy }
      : { ok: false as const, error: { code: 'CONFLICT' as const, message: '外部修改' } })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '本周' }))
    fireEvent.change(screen.getByDisplayValue('原计划'), { target: { value: '本地草案' } })
    external = true
    await act(async () => {
      listener?.({ kind: 'changed', path: '/tmp/my-way/00-dashboard/weeks/week-03.md', at: new Date().toISOString() })
      await Promise.resolve()
    })
    await userEvent.click(await screen.findByRole('button', { name: '另存冲突副本' }))

    await waitFor(() => expect(desktop.week.save).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: original.revision,
      asConflictCopy: true,
      plan: expect.objectContaining({ tasks: [expect.objectContaining({ title: '本地草案' })] })
    })))
    expect(await screen.findByDisplayValue('外部计划')).toBeTruthy()
    expect(screen.getByText(/week-03\.conflict-20260901T080910123Z-copy\.md/)).toBeTruthy()
    await act(async () => {
      listener?.({ kind: 'changed', path: '/tmp/my-way/00-dashboard/weeks/week-03.md', at: new Date().toISOString() })
      await Promise.resolve()
    })
    expect(screen.getByText(/week-03\.conflict-20260901T080910123Z-copy\.md/)).toBeTruthy()
  })

  it('keeps a conflicted weekly draft available when creating its conflict copy fails', async () => {
    const desktop = api(true)
    let listener: ((event: FileWatchEvent) => void) | undefined
    let external = false
    const original = currentWeekDocument({ tasks: [{ id: 'w3-math', date: '2026-08-31', category: 'exam', title: '原计划', plannedMinutes: 120, deliverable: '' }] })
    const changed: WeekDocument = {
      ...original,
      revision: 'c'.repeat(64),
      value: { ...original.value, plan: { ...original.value.plan, tasks: [{ ...original.value.plan.tasks[0], title: '外部计划' }] } }
    }
    desktop.files.subscribe = vi.fn((next) => { listener = next; return () => undefined })
    desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(external ? changed : original) }))
    desktop.week.save = vi.fn(async () => ({ ok: false as const, error: { code: 'IO' as const, message: '无法建立周计划冲突副本' } }))
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '本周' }))
    fireEvent.change(screen.getByDisplayValue('原计划'), { target: { value: '仍需保留的本地草案' } })
    external = true
    await act(async () => {
      listener?.({ kind: 'changed', path: '/tmp/my-way/00-dashboard/weeks/week-03.md', at: new Date().toISOString() })
      await Promise.resolve()
    })
    await userEvent.click(await screen.findByRole('button', { name: '另存冲突副本' }))

    expect(await screen.findByText('另存冲突副本失败：无法建立周计划冲突副本')).toBeTruthy()
    expect(screen.getByDisplayValue('仍需保留的本地草案')).toBeTruthy()
    expect(screen.getByRole('button', { name: '另存冲突副本' })).toBeTruthy()
    expect(screen.queryByDisplayValue('外部计划')).toBeNull()
  })

  it('waits for an existing weekly-plan save before allowing App close', async () => {
    const desktop = api(true)
    let beforeClose: (() => void) | undefined
    let finishSave: (() => void) | undefined
    const document = currentWeekDocument({ tasks: [{ id: 'w3-math', date: '2026-08-31', category: 'exam', title: '数学诊断', plannedMinutes: 120, deliverable: '' }] })
    desktop.lifecycle.onBeforeClose = vi.fn((listener) => { beforeClose = listener; return () => undefined })
    desktop.week.context = vi.fn(async () => ({ ok: true as const, value: planningContext(document) }))
    desktop.week.save = vi.fn((request) => new Promise<Awaited<ReturnType<DesktopApi['week']['save']>>>((resolve) => {
      finishSave = () => resolve({ ok: true, value: { ...document, revision: 'd'.repeat(64), value: { plan: request.plan, body: request.body } } })
    }))
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '本周' }))
    fireEvent.change(screen.getByDisplayValue('数学诊断'), { target: { value: '数学诊断更新' } })
    await act(async () => { beforeClose?.(); await Promise.resolve() })
    await waitFor(() => expect(desktop.week.save).toHaveBeenCalledOnce())
    expect(desktop.lifecycle.readyToClose).not.toHaveBeenCalled()
    await act(async () => { finishSave?.(); await Promise.resolve() })
    await waitFor(() => expect(desktop.lifecycle.readyToClose).toHaveBeenCalledOnce())
  })

  it('keeps an uncreated dirty weekly draft open when App close is requested', async () => {
    const desktop = api(true)
    let beforeClose: (() => void) | undefined
    desktop.lifecycle.onBeforeClose = vi.fn((listener) => { beforeClose = listener; return () => undefined })
    window.myWay = desktop
    render(<App />)

    await userEvent.click(await screen.findByRole('button', { name: '建立本周计划' }))
    await userEvent.click(screen.getByRole('button', { name: '新增任务' }))
    await act(async () => { beforeClose?.(); await Promise.resolve() })

    expect(desktop.lifecycle.readyToClose).not.toHaveBeenCalled()
    expect(await screen.findByText(/本周计划尚未创建/)).toBeTruthy()
    expect(desktop.lifecycle.cancelClose).toHaveBeenCalledOnce()
  })
})
