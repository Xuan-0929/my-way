import { MotionPresence, useListMotion } from './motion'
import { SelectionIndicator } from './SelectionIndicator'
import { useMemo, useState } from 'react'
import { format, parseISO } from 'date-fns'
import type { WeekPlanningContext } from '../../shared/api'
import type { TaskCategory, WeeklyTask } from '../../shared/schemas'
import { MarkdownEditor } from './MarkdownEditor'
import { ConfirmDialog } from './ConfirmDialog'
import { formatChineseDuration } from './displayFormat'
import { copyPreviousTask, validateWeekDraft, weekBudget, type WeekDraft } from './weekDraft'
import { MinutesInput, minuteInputError } from './MinutesInput'
import { TaskComposer } from './TaskComposer'
import { buildDailyTask, newTaskDraft, type TaskDraft } from './taskCreation'
import { weeklyTaskSchema } from '../../shared/schemas'

export type WeekWorkspaceMode = 'plan' | 'review'
export type WeekSaveStatus = 'idle' | 'saving' | 'saved' | 'conflict'

const categoryLabels: Record<TaskCategory, string> = {
  exam: '入试',
  nlp: 'NLP',
  english: '英语',
  japanese: '日语',
  fitness: '健身'
}

const stateLabels = {
  met: '已达标',
  done: '已完成',
  in_progress: '进行中',
  planned: '未完成',
  skipped: '已跳过',
  rescheduled: '已顺延',
  not_started: '未开始'
} as const

const displayDate = (value: string): string => format(parseISO(value), 'M 月 d 日')
const formatDelta = (value: number, unit: string): string => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value)} ${unit}`
const formatDurationDelta = (value: number): string => `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatChineseDuration(Math.abs(value))}`

const nextBlankTask = (draft: WeekDraft): WeeklyTask => {
  const suffix = `w${String(draft.plan.week).padStart(2, '0')}`
  let index = draft.plan.tasks.length + 1
  while (draft.plan.tasks.some((task) => task.id === `task-${suffix}-${index}`)) index += 1
  return {
    id: `task-${suffix}-${index}`,
    date: draft.plan.startDate,
    category: 'exam',
    title: '',
    plannedMinutes: 60,
    deliverable: ''
  }
}

const Metric = ({ label, value }: { label: string; value: string }) => (
  <div className="week-review-metric"><span>{label}</span><strong>{value}</strong></div>
)

export function WeekWorkspace({ context, draft, dirty, saveStatus, error, notice = null, mode, onModeChange, onDraftChange, onSave, onDiscard, onOpenDay }: {
  context: WeekPlanningContext
  draft: WeekDraft
  dirty: boolean
  saveStatus: WeekSaveStatus
  error: string | null
  notice?: string | null
  mode: WeekWorkspaceMode
  onModeChange: (mode: WeekWorkspaceMode) => void
  onDraftChange: (draft: WeekDraft) => void
  onSave: (draft: WeekDraft) => void
  onDiscard: () => void
  onOpenDay: (date: string, taskId?: string) => void
}) {
  const [selectedPrevious, setSelectedPrevious] = useState<Set<string>>(() => new Set())
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false)
  const [taskPendingDeletion, setTaskPendingDeletion] = useState<WeeklyTask | null>(null)
  const [copyDraft, setCopyDraft] = useState<{ id: string; draft: TaskDraft } | null>(null)
  const listRef = useListMotion(draft.plan.tasks.map((task) => task.id))
  const budget = useMemo(() => weekBudget(draft.plan), [draft.plan])
  const errors = useMemo(() => validateWeekDraft(draft), [draft])
  const hasErrors = Object.keys(errors).length > 0
  const summaryErrorMessages = [...new Set(Object.entries(errors)
    .filter(([path]) => !/^tasks\.\d+\.(date|category|title|plannedMinutes|deliverable)$/.test(path))
    .map(([, message]) => message))]
  const previousCandidates = context.previous?.tasks ?? []

  const updateTask = (id: string, patch: Partial<WeeklyTask>): void => {
    onDraftChange({
      ...draft,
      plan: {
        ...draft.plan,
        tasks: draft.plan.tasks.map((task) => task.id === id ? { ...task, ...patch } : task)
      }
    })
  }

  const removeTask = (id: string): void => {
    onDraftChange({ ...draft, plan: { ...draft.plan, tasks: draft.plan.tasks.filter((task) => task.id !== id) } })
  }

  const moveTask = (index: number, offset: -1 | 1): void => {
    const target = index + offset
    if (target < 0 || target >= draft.plan.tasks.length) return
    const tasks = [...draft.plan.tasks]
    const [task] = tasks.splice(index, 1)
    tasks.splice(target, 0, task)
    onDraftChange({ ...draft, plan: { ...draft.plan, tasks } })
  }

  const addSelectedPrevious = (): void => {
    let next = draft
    for (const candidate of previousCandidates) {
      if (candidate.state !== 'done' && candidate.state !== 'met' && selectedPrevious.has(candidate.task.id)) next = copyPreviousTask(next, candidate)
    }
    onDraftChange(next)
    setSelectedPrevious(new Set())
  }

  const addBlankTask = (): void => {
    const task = nextBlankTask(draft)
    onDraftChange({ ...draft, plan: { ...draft.plan, tasks: [...draft.plan.tasks, task] } })
  }

  return <>
  <main className="workspace week-workspace">
    <header className="page-header week-workspace-header">
      <div>
        <p className="page-kicker">本周</p>
        <h1>第 {draft.plan.week} 周</h1>
        <p className="subtle">{displayDate(context.startDate)} — {displayDate(context.endDate)}</p>
      </div>
      <div className="week-mode-switch motion-selection" role="group" aria-label="本周页面模式"><SelectionIndicator value={mode} />
        <button className={mode === 'plan' ? 'active' : ''} aria-pressed={mode === 'plan'} onClick={() => onModeChange('plan')}>计划</button>
        <button className={mode === 'review' ? 'active' : ''} aria-pressed={mode === 'review'} onClick={() => { if (!minuteInputError('.week-workspace')) onModeChange('review') }}>复盘</button>
      </div>
    </header>

    {error && <div className="inline-notice" role="alert">{error}</div>}
    {notice && <div className="inline-notice week-notice" role="status">{notice}</div>}

    {mode === 'review' ? <section className="week-review week-mode-content" aria-label="本周复盘">
      <div className="week-review-metrics">
        <Metric label="学习计划" value={formatChineseDuration(context.summary.plannedMinutes)} />
        <Metric label="学习实际" value={formatChineseDuration(context.summary.actualMinutes)} />
        <Metric label="健身计划" value={formatChineseDuration(context.summary.fitnessPlannedMinutes)} />
        <Metric label="健身实际" value={formatChineseDuration(context.summary.fitnessActualMinutes)} />
        <Metric label="任务完成" value={`${context.summary.completedTasks} / ${context.summary.totalTasks}`} />
        <Metric label="达标 / 完成率" value={`${Math.round(context.summary.completionRate)}%`} />
        <Metric label="学习证据" value={`${context.summary.evidenceCount} 项`} />
      </div>
      <section className="week-category-review">
        <div className="section-title-row"><h2>方向分配</h2><span>实际时长</span></div>
        {Object.entries(categoryLabels).map(([category, label]) => <div key={category}><span>{label}</span><strong>{formatChineseDuration(context.summary.byCategory[category as TaskCategory])}</strong></div>)}
      </section>
      <section className="week-exam-review">
        <div className="section-title-row"><h2>过去问</h2><span>{context.summary.pastExams.length} 份</span></div>
        {context.summary.pastExams.length ? context.summary.pastExams.map((exam) => <p key={exam.id}>{exam.subject} · {exam.paper} · {exam.score}/{exam.maxScore}</p>) : <p className="subtle">本周尚无过去问成绩。</p>}
      </section>
      <section className="week-outcome-review">
        <div className="section-title-row"><h2>任务成果</h2><span>{context.summary.taskOutcomes.length} 项</span></div>
        {context.summary.taskOutcomes.length ? <div className="week-outcome-list">{context.summary.taskOutcomes.map((outcome) => <article className="week-outcome-entry" key={`${outcome.date}:${outcome.taskId}`}>
          <button className="week-reflection-date" aria-label={`打开 ${outcome.date} 任务成果记录`} onClick={() => onOpenDay(outcome.date)}><time dateTime={outcome.date}>{displayDate(outcome.date)}</time></button>
          <div><span>{categoryLabels[outcome.category]}</span><button className="week-outcome-title" aria-label={`打开 ${outcome.date} ${outcome.title}任务详情`} onClick={() => onOpenDay(outcome.date, outcome.taskId)}><strong>{outcome.title}</strong></button><p>{outcome.outcomes}</p></div>
        </article>)}</div> : <p className="subtle">本周尚无任务成果。</p>}
      </section>
      <section className="week-reflection-review">
        <div className="section-title-row"><h2>日终复盘</h2><span>{context.summary.reflections.length} 天</span></div>
        {context.summary.reflections.length ? <div className="week-reflection-list">{context.summary.reflections.map((reflection) => <article className="week-reflection-entry" key={reflection.date}>
          <button className="week-reflection-date" aria-label={`打开 ${reflection.date} 日终复盘记录`} onClick={() => onOpenDay(reflection.date)}><time dateTime={reflection.date}>{displayDate(reflection.date)}</time></button>
          <dl>
            {reflection.learned && <div><dt>学习成果</dt><dd>{reflection.learned}</dd></div>}
            {reflection.blockers && <div><dt>当前难点</dt><dd>{reflection.blockers}</dd></div>}
            {reflection.tomorrow && <div><dt>明日计划调整</dt><dd>{reflection.tomorrow}</dd></div>}
          </dl>
        </article>)}</div> : <p className="subtle">本周尚无日终复盘。</p>}
      </section>
      {context.previous && <section className="week-previous-comparison">
        <div className="section-title-row"><h2>上次计划对照</h2><span>第 {context.previous.document.value.plan.week} 周</span></div>
        <p>实际 {formatChineseDuration(context.previous.summary.actualMinutes)} · 完成 {context.previous.summary.completedTasks} / {context.previous.summary.totalTasks}</p>
        <div className="week-previous-deltas">
          <div><span>实际时间变化</span><strong>{formatDurationDelta(context.summary.actualMinutes - context.previous.summary.actualMinutes)}</strong></div>
          <div><span>达标 / 完成率变化</span><strong>{formatDelta(context.summary.completionRate - context.previous.summary.completionRate, '个百分点')}</strong></div>
        </div>
      </section>}
    </section> : <div className="week-mode-content" aria-label="本周计划">
      <section className="week-budget" aria-label="本周计划时长">
        <div className="section-title-row"><h2>本周计划</h2><span>按任务卡片自动计算</span></div>
        <div className="week-budget-totals">
          <div aria-label="学习计划总时长"><span>学习</span><strong>{formatChineseDuration(budget.studyTotal)}</strong></div>
          <div aria-label="健身计划总时长"><span>健身</span><strong>{formatChineseDuration(budget.fitnessTotal)}</strong></div>
        </div>
        <div className="week-budget-categories">
          {(Object.keys(categoryLabels) as TaskCategory[]).map((category) => <div key={category}>
            <span>{categoryLabels[category]}</span>
            <strong>{formatChineseDuration(budget.byCategory[category])}</strong>
          </div>)}
        </div>
      </section>

      {context.previous && <section className="previous-week-tasks">
        <div className="section-title-row"><h2>上次计划</h2><span>按需加入，不自动顺延</span></div>
        <div className="previous-task-list">
          {previousCandidates.map((candidate) => <div className="previous-task-row" key={candidate.task.id}>
            {candidate.state === 'done' || candidate.state === 'met' ? <span className="previous-task-done" aria-label={`${candidate.task.title} ${stateLabels[candidate.state]}`}>✓</span> : <input
              type="checkbox"
              aria-label={`选择 ${candidate.task.title}`}
              checked={selectedPrevious.has(candidate.task.id)}
              onChange={(event) => setSelectedPrevious((current) => {
                const next = new Set(current)
                if (event.target.checked) next.add(candidate.task.id)
                else next.delete(candidate.task.id)
                return next
              })}
            />}
            <div><strong>{candidate.task.title}</strong><span>{stateLabels[candidate.state]} · 实际 {formatChineseDuration(candidate.actualMinutes)} · 证据 {candidate.evidenceCount}</span></div>
            <time>{displayDate(candidate.task.date)}</time>
          </div>)}
        </div>
        <button className="secondary-button" disabled={!selectedPrevious.size} onClick={addSelectedPrevious}>加入草案</button>
      </section>}

      <section className="week-plan-editor">
        <div className="section-title-row"><h2>本周任务</h2><button className="secondary-button" onClick={addBlankTask}>新增任务</button></div>
        {draft.plan.tasks.length ? <div className="week-plan-list" ref={listRef}>{draft.plan.tasks.map((task, index) => {
          const fieldError = (field: keyof WeeklyTask): string | undefined => errors[`tasks.${index}.${field}`]
          const errorId = (field: keyof WeeklyTask): string => `week-task-${index}-${field}-error`
          return <article className="week-plan-row" data-motion-id={task.id} data-testid="week-task-row" key={task.id}>
          <label><span>日期</span><input aria-label="任务日期" aria-invalid={Boolean(fieldError('date'))} aria-describedby={fieldError('date') ? errorId('date') : undefined} type="date" min={draft.plan.startDate} max={draft.plan.endDate} value={task.date} onChange={(event) => updateTask(task.id, { date: event.target.value })} />{fieldError('date') && <small id={errorId('date')} className="field-error">{fieldError('date')}</small>}</label>
          <label><span>类别</span><select aria-label="任务类别" aria-invalid={Boolean(fieldError('category'))} aria-describedby={fieldError('category') ? errorId('category') : undefined} value={task.category} onChange={(event) => updateTask(task.id, { category: event.target.value as TaskCategory })}>{(Object.keys(categoryLabels) as TaskCategory[]).map((category) => <option value={category} key={category}>{categoryLabels[category]}</option>)}</select>{fieldError('category') && <small id={errorId('category')} className="field-error">{fieldError('category')}</small>}</label>
          <label className="week-task-title"><span>标题</span><input aria-label="任务标题" aria-invalid={Boolean(fieldError('title'))} aria-describedby={fieldError('title') ? errorId('title') : undefined} placeholder="输入任务标题" value={task.title} onChange={(event) => updateTask(task.id, { title: event.target.value })} />{fieldError('title') && <small id={errorId('title')} className="field-error">{fieldError('title')}</small>}</label>
          <label><span>分钟</span><MinutesInput aria-label="计划分钟" aria-invalid={Boolean(fieldError('plannedMinutes'))} aria-describedby={fieldError('plannedMinutes') ? errorId('plannedMinutes') : undefined} min={1} max={720} value={task.plannedMinutes} onChange={(plannedMinutes) => updateTask(task.id, { plannedMinutes })} onDraftChange={() => updateTask(task.id, {})} />{fieldError('plannedMinutes') && <small id={errorId('plannedMinutes')} className="field-error">{fieldError('plannedMinutes')}</small>}</label>
          <div className="week-task-footer"><label className="week-task-deliverable"><span>预期产物</span><input aria-label="预期产物" aria-invalid={Boolean(fieldError('deliverable'))} aria-describedby={fieldError('deliverable') ? errorId('deliverable') : undefined} value={task.deliverable} onChange={(event) => updateTask(task.id, { deliverable: event.target.value })} />{fieldError('deliverable') && <small id={errorId('deliverable')} className="field-error">{fieldError('deliverable')}</small>}</label>
          <div className="week-task-actions">
            <button aria-label={`复制 ${task.title || '未命名任务'}`} onClick={() => { if (!minuteInputError('.week-workspace')) setCopyDraft({ id: `copy-${crypto.randomUUID()}`, draft: newTaskDraft(task.date, task) }) }}>复制</button>
            <button aria-label={`上移 ${task.title || '未命名任务'}`} disabled={index === 0} onClick={() => moveTask(index, -1)}>↑</button>
            <button aria-label={`下移 ${task.title || '未命名任务'}`} disabled={index === draft.plan.tasks.length - 1} onClick={() => moveTask(index, 1)}>↓</button>
            <button className="quiet-danger" aria-label={`删除 ${task.title || '未命名任务'}`} onClick={() => setTaskPendingDeletion(task)}>删除</button>
          </div>
          </div>
        </article>})}</div> : <p className="week-plan-empty">还没有任务。先新增，或从上次计划中选择需要继续的项目。</p>}
      </section>

      <section className="week-notes">
        <div className="section-title-row"><h2>周说明</h2></div>
        <MarkdownEditor label="周说明" value={draft.body} onChange={(body) => onDraftChange({ ...draft, body })} />
      </section>

      {summaryErrorMessages.length > 0 && <div className="week-validation" role="alert"><strong>请修正计划</strong><ul>{summaryErrorMessages.map((message) => <li key={message}>{message}</li>)}</ul></div>}
      <footer className="week-save-bar">
        <span>{saveStatus === 'saving' ? '正在保存' : saveStatus === 'conflict' ? '检测到外部修改' : saveStatus === 'saved' && !dirty ? '已保存' : dirty ? '有未保存修改' : '没有修改'}</span>
        {dirty && <button className="secondary-button" disabled={saveStatus === 'saving'} onClick={() => setDiscardDialogOpen(true)}>放弃修改</button>}
        <button className="primary-button" disabled={!dirty || hasErrors || saveStatus === 'saving' || saveStatus === 'conflict'} onClick={() => { if (!minuteInputError('.week-workspace')) onSave(draft) }}>{context.current ? '保存更改' : '保存本周计划'}</button>
      </footer>
    </div>}
  </main>
  <MotionPresence>{copyDraft && <TaskComposer key={copyDraft.id} draft={copyDraft.draft} kind="copy" pending={false} error={null}
    minDate={draft.plan.startDate} maxDate={draft.plan.endDate} withNotes={false}
    onChange={(next) => setCopyDraft({ ...copyDraft, draft: next })} onCancel={() => setCopyDraft(null)}
    onSubmit={() => {
      const copy = weeklyTaskSchema.parse(buildDailyTask(copyDraft.draft, copyDraft.id))
      if (copy.date < draft.plan.startDate || copy.date > draft.plan.endDate) return
      onDraftChange({ ...draft, plan: { ...draft.plan, tasks: [...draft.plan.tasks, copy] } })
      setCopyDraft(null)
    }} />}</MotionPresence>
  <MotionPresence>{taskPendingDeletion && <ConfirmDialog
    title="删除本周任务？"
    description={`“${taskPendingDeletion.title || '未命名任务'}”将从本周计划移除。已经生成的每日记录不会改变。`}
    confirmLabel="删除任务"
    onCancel={() => setTaskPendingDeletion(null)}
    onConfirm={() => {
      removeTask(taskPendingDeletion.id)
      setTaskPendingDeletion(null)
    }}
  />}</MotionPresence>
  <MotionPresence>{discardDialogOpen && <ConfirmDialog title="放弃本周草案？" description="所有尚未保存的周计划修改都会丢失。" confirmLabel="放弃草案" onCancel={() => setDiscardDialogOpen(false)} onConfirm={() => { setDiscardDialogOpen(false); onDiscard() }} />}</MotionPresence>
  </>
}
