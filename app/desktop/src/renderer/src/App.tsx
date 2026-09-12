import { MotionPresence, useListMotion } from './motion'
import { SelectionIndicator } from './SelectionIndicator'
import { useEffect, useMemo, useRef, useState } from 'react'
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, getDay, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { DndContext, KeyboardSensor, PointerSensor, useDraggable, useDroppable, useSensor, useSensors, type Announcements, type DragEndEvent, type KeyboardCoordinateGetter, type ScreenReaderInstructions } from '@dnd-kit/core'
import ReactMarkdown from 'react-markdown'
import type { DayOpenResult, EvidenceInspection, ProgressQueryResult, Result, WeekDocument, WeekPlanningContext } from '../../shared/api'
import type { AssignTimerRequest, AssignTimerResult, TimerTaskIntent } from '../../shared/timerTypes'
import type { DailyTask, PastExam } from '../../shared/schemas'
import type { DailyTimeSnapshot, MonthlyProgressCell, ParsedDailyRecord, RouteDocument, VersionedFile, WeekPlanDiff } from '../../shared/types'
import { MarkdownEditor } from './MarkdownEditor'
import { DeleteTaskDialog } from './DeleteTaskDialog'
import { TaskDetailView } from './TaskDetailView'
import { TaskStatusControl } from './TaskStatusControl'
import { categoryClass, categoryKeys, categoryLabels, previewTasks, toStudyTasks, studyTaskProgress, type StudyTask } from './studyTask'
import { isTaskPending } from '../../shared/taskProgress'
import { useTimerController } from './useTimerController'
import { restoreFocusWhenStable } from './focusRestore'
import { TimerView } from './TimerView'
import { TimerSidebarStatus } from './TimerSidebarStatus'
import { TimerCompletionDialog } from './TimerCompletionDialog'
import { TimerAssignmentDialog } from './TimerAssignmentDialog'
import { WeekWorkspace, type WeekSaveStatus, type WeekWorkspaceMode } from './WeekWorkspace'
import { newWeekDraft, validateWeekDraft, type WeekDraft } from './weekDraft'
import { persistLatestCalendarMove } from './calendarPlanning'
import { deriveCalendarTasks, type CalendarTask } from './calendarTasks'
import { formatChineseDateRange, formatChineseDuration, formatCompactDuration } from './displayFormat'
import { deriveRouteStage, naturalWeekRange } from '../../shared/weekPlanning'
import { CarryoverDialog, type CarryoverAction, type CarryoverPendingAction } from './CarryoverDialog'
import { PastExamSection } from './PastExamSection'
import { useCurrentLocalDate } from './useCurrentLocalDate'
import { WorkspaceFrame } from './WorkspaceFrame'
import { focusedTaskId, taskTimeTotals, timerTaskChoices } from './taskPresentation'
import { deriveWeekTimeTotals } from '../../shared/weekTimeTotals'
import { MinutesInput, minuteInputError } from './MinutesInput'
import { TaskComposer } from './TaskComposer'
import { ActionIcon } from './ActionIcon'
import { buildDailyTask, newTaskDraft, persistNewTask, type TaskDraft } from './taskCreation'

type TaskComposerState = { id: string; kind: 'new' | 'copy'; draft: TaskDraft }
type View = 'today' | 'calendar' | 'progress' | 'route' | 'timer'
const navigationPaths: Record<View, string> = {
  today: 'M5 2.5h10a2.5 2.5 0 0 1 2.5 2.5v10a2.5 2.5 0 0 1-2.5 2.5H5A2.5 2.5 0 0 1 2.5 15V5A2.5 2.5 0 0 1 5 2.5ZM6 7h8M6 11h5',
  calendar: 'M5 4h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM3 8h14M6 2v4M14 2v4M6 11h1M10 11h1M6 14h1M10 14h1',
  progress: 'M3 3v14h14M7 12V8M11 12V4M15 12V7',
  route: 'M5 4h7a4 4 0 0 1 0 8H8a2 2 0 0 0 0 4h6M2.5 4a1.5 1.5 0 1 0 3 0 1.5 1.5 0 1 0-3 0M13 14l2 2-2 2',
  timer: 'M10 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14ZM10 7v4l2 1M8 1h4M16 4l1-1'
}
const rejectedResult = (error: unknown): Result<never> => ({
  ok: false,
  error: { code: 'UNKNOWN', message: error instanceof Error ? error.message : String(error) }
})
const navItems: Array<{ id: View; label: string; shortcut: string }> = [
  { id: 'today', label: '今天', shortcut: '1' },
  { id: 'calendar', label: '日历', shortcut: '2' },
  { id: 'progress', label: '本周', shortcut: '3' },
  { id: 'route', label: '路线', shortcut: '4' },
  { id: 'timer', label: '计时器', shortcut: '5' }
]

const calendarScreenReaderInstructions: ScreenReaderInstructions = {
  draggable: '按空格键拾取任务，使用方向键移动，再按空格键放下；按 Escape 取消。'
}

const calendarAnnouncements: Announcements = {
  onDragStart: ({ active }) => `已拾取任务 ${String(active.data.current?.title ?? active.id)}。`,
  onDragOver: ({ active, over }) => over ? `任务 ${String(active.data.current?.title ?? active.id)} 位于 ${String(over.id)}。` : undefined,
  onDragEnd: ({ active, over }) => over ? `任务 ${String(active.data.current?.title ?? active.id)} 已移动到 ${String(over.id)}。` : `任务 ${String(active.data.current?.title ?? active.id)} 未移动。`,
  onDragCancel: ({ active }) => `已取消移动任务 ${String(active.data.current?.title ?? active.id)}。`
}

const calendarKeyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  const direction = event.code === 'ArrowLeft' || event.code === 'ArrowUp'
    ? -1
    : event.code === 'ArrowRight' || event.code === 'ArrowDown'
      ? 1
      : 0
  if (!direction || !context.collisionRect) return undefined

  const columns = context.droppableContainers.getEnabled()
    .map((container) => ({ id: container.id, rect: context.droppableRects.get(container.id) }))
    .filter((column): column is { id: typeof column.id; rect: NonNullable<typeof column.rect> } => Boolean(column.rect))
    .sort((left, right) => left.rect.left - right.rect.left)
  if (!columns.length) return undefined

  const currentCenter = context.collisionRect.left + context.collisionRect.width / 2
  let currentIndex = columns.findIndex((column) => column.id === context.over?.id)
  if (currentIndex < 0) currentIndex = columns.findIndex((column) => column.rect.left <= currentCenter && currentCenter <= column.rect.right)
  if (currentIndex < 0) currentIndex = columns.reduce((closest, column, index) => {
    const center = column.rect.left + column.rect.width / 2
    const closestCenter = columns[closest].rect.left + columns[closest].rect.width / 2
    return Math.abs(center - currentCenter) < Math.abs(closestCenter - currentCenter) ? index : closest
  }, 0)

  const target = columns[currentIndex + direction]
  if (!target) return undefined
  event.preventDefault()
  return {
    x: target.rect.left + Math.max(0, (target.rect.width - context.collisionRect.width) / 2),
    y: currentCoordinates.y
  }
}

function TodayView({
  tasks, setTasks, date, sourceWeek, missingPlan, hasWeekPlan, recordExists, recordPending, evidenceStatus, notes, onNotesChange, reflection, onReflectionChange, pastExams, onPastExamsChange, onSelectEvidence, onOpenEvidence, planDiff, onImportPlanTasks, onAddTask, onCopyTask, onOpenTask, onOpenWeekPlan, onStartRecord, backLabel, onBack, focusIntent
}: {
  tasks: StudyTask[]
  setTasks: (tasks: StudyTask[]) => void
  date: string
  focusIntent: TimerTaskIntent | null
  sourceWeek: number | null
  missingPlan: boolean
  hasWeekPlan: boolean
  recordExists: boolean
  recordPending: boolean
  evidenceStatus: Record<string, EvidenceInspection>
  notes: string
  onNotesChange: (value: string) => void
  reflection: ParsedDailyRecord['reflection']
  onReflectionChange: (value: ParsedDailyRecord['reflection']) => void
  pastExams: PastExam[]
  onPastExamsChange: (value: PastExam[]) => void
  onSelectEvidence: (taskId: string) => void
  onOpenEvidence: (path: string) => void
  planDiff: WeekPlanDiff | null
  onImportPlanTasks: () => void
  onAddTask: () => void
  onCopyTask: (taskId: string) => void
  onOpenTask: (taskId: string) => void
  onOpenWeekPlan: () => void
  onStartRecord: () => void
  backLabel?: string
  onBack?: () => void
}) {
  const { studyPlanned: planned, studyActual: actual } = taskTimeTotals(tasks)
  const focusId = focusedTaskId(tasks, date, focusIntent)
  const updateTask = (id: string, patch: Partial<StudyTask>) => setTasks(tasks.map((task) => task.id === id ? { ...task, ...patch } : task))
  const displayDate = new Date(`${date}T12:00:00`)
  const currentDate = new Date()
  const isToday = date === format(currentDate, 'yyyy-MM-dd')
  const dayTitle = isToday
    ? `今天，${displayDate.getMonth() + 1} 月 ${displayDate.getDate()} 日`
    : `${displayDate.getFullYear() === currentDate.getFullYear() ? '' : `${displayDate.getFullYear()} 年 `}${displayDate.getMonth() + 1} 月 ${displayDate.getDate()} 日`
  const weekday = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][displayDate.getDay()]
  const planDiffSummary = planDiff ? [
    planDiff.addedTaskIds.length ? `新增 ${planDiff.addedTaskIds.length} 项` : '',
    planDiff.changedTaskIds.length ? `已修改 ${planDiff.changedTaskIds.length} 项` : '',
    planDiff.removedTaskIds.length ? `已移除 ${planDiff.removedTaskIds.length} 项` : ''
  ].filter(Boolean).join('、') : ''
  const taskListRef = useListMotion(tasks.map((task) => task.id))
  const moveTask = (index: number, direction: -1 | 1): void => {
    const target = index + direction
    if (target < 0 || target >= tasks.length) return
    const next = [...tasks]
    ;[next[index], next[target]] = [next[target], next[index]]
    setTasks(next)
  }

  return (
    <main className="workspace today-view">
      <header className="page-header reveal reveal-1">
        <div>
          <h1>{dayTitle}</h1>
          <p className="subtle">{weekday}{sourceWeek ? ` · 第 ${sourceWeek} 周` : ''}</p>
        </div>
        <div className="day-header-actions">
          {backLabel && onBack && <button className="secondary-button" aria-keyshortcuts="Meta+[" onClick={onBack}>{backLabel}</button>}
          <div className="day-tally" aria-label={`${isToday ? '今日' : '当日'}学习时间进度`}>
            <strong>{formatChineseDuration(actual)}</strong>
            <span>/ {formatChineseDuration(planned)}</span>
          </div>
        </div>
      </header>

      {!recordExists ? <section className="empty-day-record reveal reveal-2">
        <p>这一天还没有学习记录。</p>
        <span>{hasWeekPlan ? '开始后会从周计划导入当天任务。' : '开始后会建立一份空白记录。'}</span>
        <button className="primary-button" disabled={recordPending} onClick={onStartRecord}>{recordPending ? '正在建立…' : '开始记录'}</button>
      </section> : <>
      <section className="task-section reveal reveal-2">
        {!hasWeekPlan && <div className="inline-notice missing-week-notice"><span>当前自然周还没有计划；每日记录会继续保留。</span>{isToday && <button onClick={onOpenWeekPlan}>建立本周计划</button>}</div>}
        {missingPlan && hasWeekPlan && <div className="inline-notice">这份每日记录尚未导入本周任务；已有内容不会被覆盖。</div>}
        {planDiff && planDiffSummary && <div className="inline-notice plan-diff-notice"><span>周计划差异：{planDiffSummary}。每日快照保持不变。</span>{planDiff.addedTaskIds.length > 0 && <button onClick={onImportPlanTasks}>导入新增任务</button>}</div>}
        <div className="section-title-row">
          <h2>{isToday ? '今日任务' : '当日任务'}</h2>
          <span title="时间达标或手动完成，不代表知识掌握">{tasks.filter((task) => ['done', 'met'].includes(studyTaskProgress(task))).length} / {tasks.filter((task) => task.state !== 'rescheduled').length} 达标 / 完成</span>
        </div>
        <div className="task-table" ref={taskListRef}>
          {tasks.map((task, index) => (
            <article
              className={`task-row${task.id === focusId ? ' is-focused' : ''}`}
              key={task.id}
              data-task-id={task.id}
              data-motion-id={task.id}
              tabIndex={0}
              aria-label={`任务卡片：${task.title}`}
              onClick={(event) => {
                if (!(event.target as Element).closest('button,input,select,textarea,a,label,.time-inputs,.task-meta,.evidence-links')) onOpenTask(task.id)
              }}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                  event.preventDefault()
                  onOpenTask(task.id)
                }
              }}
            >
              <div className="task-main">
                <select aria-label={`${task.title} 类别`} className={`category-mark ${categoryClass[task.category]}`} value={task.category} onChange={(event) => updateTask(task.id, { category: event.target.value as StudyTask['category'] })}>{Object.values(categoryLabels).map((category) => <option key={category}>{category}</option>)}</select>
                <div className="task-summary">
                  <button className="task-open-content" aria-label={`打开任务详情：${task.title}`} onClick={() => onOpenTask(task.id)}>
                    <strong>{task.title}</strong>
                    {task.deliverable && <small>{task.deliverable}</small>}
                  </button>
                  <div className="task-meta"><input aria-label={`${task.title} 日期`} type="date" value={task.date} onChange={(event) => updateTask(task.id, { date: event.target.value })} /><button disabled={index === 0} onClick={() => moveTask(index, -1)} aria-label={`上移 ${task.title}`} title="上移任务"><ActionIcon name="up" /></button><button disabled={index === tasks.length - 1} onClick={() => moveTask(index, 1)} aria-label={`下移 ${task.title}`} title="下移任务"><ActionIcon name="down" /></button><button aria-label={`复制 ${task.title}`} onClick={() => onCopyTask(task.id)}><ActionIcon name="copy" />复制</button><button aria-label={`为 ${task.title} 添加证据`} onClick={() => onSelectEvidence(task.id)}><ActionIcon name="attachment" />证据</button></div>
                  {task.evidence.length > 0 && <div className="evidence-links">{task.evidence.map((path) => {
                    const inspection = evidenceStatus[path]
                    const unavailable = inspection?.status === 'missing' || inspection?.status === 'blocked'
                    return <button className={unavailable ? 'evidence-unavailable' : ''} disabled={unavailable} title={inspection?.message} key={path} onClick={() => onOpenEvidence(path)}>{path.split('/').at(-1)}{unavailable && <span>{inspection?.status === 'missing' ? '缺失' : '不可用'}</span>}</button>
                  })}</div>}
                </div>
              </div>
              <div className="time-inputs">
                <label><span>计划分钟</span><MinutesInput aria-label={`${task.title} 计划分钟`} min={1} max={720} value={task.planned} onChange={(planned) => updateTask(task.id, { planned })} onDraftChange={() => updateTask(task.id, {})} /></label>
                <label className={task.actual ? 'has-value' : ''}>
                  <span>实际分钟</span>
                  <MinutesInput aria-label={`${task.title} 实际分钟`} min={0} max={1440 - tasks.filter((item) => item.id !== task.id).reduce((sum, item) => sum + item.actual, 0)} value={task.actual} onChange={(actual) => updateTask(task.id, { actual })} onDraftChange={() => updateTask(task.id, {})} />
                </label>
              </div>
              <TaskStatusControl taskTitle={task.title} state={task.state} planned={task.planned} actual={task.actual} onChange={(state) => updateTask(task.id, { state })} />
            </article>
          ))}
        </div>
        <button className="add-task" onClick={onAddTask}><span>＋</span> 添加一项任务</button>
      </section>

      <PastExamSection date={date} exams={pastExams} onChange={onPastExamsChange} />

      <section className="notes-section reveal reveal-3">
        <div className="notes-column">
          <div className="section-title-row"><h2>学习笔记</h2></div>
          <MarkdownEditor value={notes} onChange={onNotesChange} />
        </div>
        <div className="reflection-column">
          <h2>日终复盘</h2>
          <label><span>学习成果</span><textarea value={reflection.learned} onChange={(event) => onReflectionChange({ ...reflection, learned: event.target.value })} placeholder="今日理解与完成内容" /></label>
          <label><span>当前难点</span><textarea value={reflection.blockers} onChange={(event) => onReflectionChange({ ...reflection, blockers: event.target.value })} placeholder="未解决问题与原因" /></label>
          <label><span>明日计划调整</span><textarea value={reflection.tomorrow} onChange={(event) => onReflectionChange({ ...reflection, tomorrow: event.target.value })} placeholder="下一学习日的具体调整" /></label>
        </div>
      </section>
      </>}
    </main>
  )
}

/* dnd-kit returns callback refs and reactive transform objects; they are safe to consume during render. */
/* eslint-disable react-hooks/refs */
function DraggableCalendarTask({ task, onOpen }: { task: CalendarTask; onOpen: () => void }) {
  const draggable = useDraggable({ id: task.key, data: { title: task.title }, disabled: !task.weekTaskId })
  const content = <><b>{task.category}</b><span title={task.title}>{task.title}</span><small>{formatChineseDuration(task.planned)}{task.state === 'met' ? ' · 已达标' : task.state === 'done' ? ' · 完成' : task.state === 'in_progress' ? ' · 进行中' : task.state === 'skipped' ? ' · 跳过' : ''}</small></>
  if (!task.weekTaskId) return <button type="button" data-task-id={task.id} data-state={task.state} aria-label={`打开任务详情：${task.title}`} className={`calendar-task calendar-record-task ${categoryClass[task.category]}`} onClick={onOpen}>{content}</button>
  return <article ref={draggable.setNodeRef} data-task-id={task.id} data-state={task.state} style={{ transform: draggable.transform ? `translate3d(${draggable.transform.x}px, ${draggable.transform.y}px, 0)` : undefined, zIndex: draggable.isDragging ? 2 : undefined, opacity: draggable.isDragging ? .75 : 1 }} className={`calendar-task calendar-plan-task ${categoryClass[task.category]}`}>
    <button type="button" className="calendar-task-open" aria-label={`打开任务详情：${task.title}`} onClick={onOpen}>{content}</button>
    <button type="button" className="calendar-drag-handle" ref={draggable.setActivatorNodeRef} {...draggable.listeners} {...draggable.attributes} aria-label={`移动 ${task.title}`} title="拖动调整日期；键盘空格拾取，方向键移动">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M6 4h2v2H6zm6 0h2v2h-2zM6 9h2v2H6zm6 0h2v2h-2zM6 14h2v2H6zm6 0h2v2h-2z" /></svg>
    </button>
  </article>
}

function CalendarDayColumn({ date, today, dayLabel, tasks, minutes, rest, selected, opening, onOpen, onOpenTask }: { date: string; today: string; dayLabel: string; tasks: CalendarTask[]; minutes: number; rest: boolean; selected: boolean; opening: boolean; onOpen: () => void; onOpenTask: (task: CalendarTask) => void }) {
  const droppable = useDroppable({ id: date, disabled: rest })
  const fitnessMinutes = tasks.filter((task) => task.category === '健身').reduce((sum, task) => sum + task.planned, 0)
  return (
    <article ref={droppable.setNodeRef} data-calendar-date={date} className={`week-day ${selected ? 'selected' : ''} ${droppable.isOver ? 'drop-target' : ''} ${rest ? 'rest-day' : ''}`}>
      <header><button className="calendar-day-open" aria-label={`打开 ${date} 记录`} aria-current={date === today ? 'date' : undefined} disabled={opening} onClick={onOpen}><span>{dayLabel}</span><strong>{Number(date.slice(-2))}</strong></button></header>
      <div className="day-load"><span>{tasks.length ? `${tasks.length} 项` : rest ? '休息' : '无安排'}</span>{minutes > 0 && <span>学习 {formatChineseDuration(minutes)}</span>}{fitnessMinutes > 0 && <span className="fitness-load">健身 {formatChineseDuration(fitnessMinutes)}</span>}</div>
      {tasks.map((task) => <DraggableCalendarTask task={task} key={task.key} onOpen={() => onOpenTask(task)} />)}
    </article>
  )
}
/* eslint-enable react-hooks/refs */

function CalendarView({ tasks, records, week, loading, moves, onMove, referenceDate, today, selectedDate, monthCells, openingDate, onNavigate, onReturnToToday, onOpenDate }: { tasks: StudyTask[]; records: DailyTimeSnapshot[]; week: WeekDocument | null; loading: boolean; moves: Record<string, string>; onMove: (taskId: string, date: string) => void; referenceDate: string; today: string; selectedDate: string; monthCells: MonthlyProgressCell[]; openingDate: string | null; onNavigate: (direction: -1 | 1, mode: 'week' | 'month') => void; onReturnToToday: () => void; onOpenDate: (date: string, taskId?: string) => void }) {
  const [mode, setMode] = useState<'week' | 'month'>('week')
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: calendarKeyboardCoordinates })
  )
  const plan = week?.value.plan
  const fallbackStart = startOfWeek(parseISO(referenceDate), { weekStartsOn: 1 })
  const dates = plan
    ? eachDayOfInterval({ start: parseISO(plan.startDate), end: parseISO(plan.endDate) }).slice(0, 7).map((date) => format(date, 'yyyy-MM-dd'))
    : Array.from({ length: 7 }, (_, index) => format(addDays(fallbackStart, index), 'yyyy-MM-dd'))
  const plannedTasks: CalendarTask[] = (window.myWay
    ? deriveCalendarTasks({ plan: plan ?? null, records, startDate: dates[0], endDate: dates[6] })
    : tasks.map((task, index) => ({ ...task, key: task.id, weekTaskId: task.id, date: index < 3 ? dates[0] : dates[1] })))
    .map((task) => ({ ...task, date: task.weekTaskId ? moves[task.weekTaskId] ?? task.date : task.date }))
  const title = formatChineseDateRange(plan?.startDate ?? dates[0], plan?.endDate ?? dates[6])
  const monthStart = startOfMonth(parseISO(referenceDate))
  const monthDays = eachDayOfInterval({ start: monthStart, end: endOfMonth(monthStart) })
  const leading = (getDay(monthStart) + 6) % 7
  const monthByDate = new Map(monthCells.map((cell) => [cell.date, cell]))
  const currentPeriod = mode === 'week'
    ? naturalWeekRange(referenceDate).startDate === naturalWeekRange(today).startDate
    : referenceDate.slice(0, 7) === today.slice(0, 7)
  const handleDragEnd = (event: DragEndEvent): void => {
    const task = plannedTasks.find((item) => item.key === event.active.id)
    if (task?.weekTaskId && event.over && typeof event.over.id === 'string') onMove(task.weekTaskId, event.over.id)
  }
  return (
    <main className="workspace calendar-view">
      <header className="page-header"><div><h1>{mode === 'week' ? title : format(monthStart, 'yyyy 年 M 月')}</h1><p className="subtle">{mode === 'week' ? '六日学习安排' : '月度完成率与实际投入'}</p></div><div className="calendar-controls"><button onClick={() => onNavigate(-1, mode)} aria-label="上一周期">‹</button><div className="view-switch motion-selection" role="group" aria-label="日历视图"><SelectionIndicator value={mode} /><button className={mode === 'week' ? 'active' : ''} aria-pressed={mode === 'week'} onClick={() => setMode('week')}>周</button><button className={mode === 'month' ? 'active' : ''} aria-pressed={mode === 'month'} onClick={() => setMode('month')}>月</button></div><button onClick={() => onNavigate(1, mode)} aria-label="下一周期">›</button><button className="calendar-return" disabled={currentPeriod} onClick={onReturnToToday}>{mode === 'week' ? '回到本周' : '回到本月'}</button></div></header>
      {loading ? <div className="inline-notice view-loading" role="status">日历读取中</div> : mode === 'week' ? <>
        {!plan && window.myWay && !plannedTasks.length && <div className="inline-notice">当前日期没有匹配的周计划或每日任务，日历暂时为空。</div>}
        <DndContext accessibility={{ announcements: calendarAnnouncements, screenReaderInstructions: calendarScreenReaderInstructions }} sensors={sensors} onDragEnd={handleDragEnd}>
          <section className="week-grid">
            {dates.map((date, index) => {
              const dateTasks = plannedTasks.filter((task) => task.date === date)
              return <CalendarDayColumn key={date} date={date} today={today} dayLabel={`周${['一','二','三','四','五','六','日'][index]}`} tasks={dateTasks} minutes={dateTasks.filter((task) => task.category !== '健身').reduce((sum, task) => sum + task.planned, 0)} rest={index === 6} selected={selectedDate === date} opening={openingDate === date} onOpen={() => onOpenDate(date)} onOpenTask={(task) => onOpenDate(task.recordDate ?? task.date, task.recordDate ? task.id : undefined)} />
            })}
          </section>
        </DndContext>
      </> : <section className="month-overview"><header>{['一','二','三','四','五','六','日'].map((day) => <span key={day}>周{day}</span>)}</header><div>{Array.from({ length: leading }, (_, index) => <i key={`blank-${index}`} />)}{monthDays.map((day) => {
        const date = format(day, 'yyyy-MM-dd')
        const cell = monthByDate.get(date)
        return <button className={`month-day-open ${selectedDate === date ? 'selected' : ''}`} aria-label={`打开 ${date} 记录`} aria-current={date === today ? 'date' : undefined} disabled={openingDate === date} onClick={() => onOpenDate(date)} key={date}><strong>{day.getDate()}</strong>{cell ? <><span>{cell.completionRate}%</span><small>{formatChineseDuration(cell.actualMinutes)}</small></> : <small>—</small>}</button>
      })}</div></section>}
    </main>
  )
}

function RouteView({ documents, context, loading }: { documents: RouteDocument[]; context: WeekPlanningContext; loading: boolean }) {
  const [selected, setSelected] = useState<RouteDocument['id']>('twelve-week')
  const document = documents.find((item) => item.id === selected) ?? documents[0]
  const stage = deriveRouteStage(context.suggestedWeek)
  const futureStages = [
    ['02', '核心方法', 'Transformer、实验设计与论文阅读', 'Week 04 — 06'],
    ['03', '项目证据', '完成可复现实验并形成研究问题', 'Week 07 — 09'],
    ['04', '入试连接', '过去问、研究计划书与能力门槛复核', 'Week 10 — 12'],
    ['→', '长期', '按个人目标持续学习与复盘', '自主规划']
  ].filter((item) => stage.index === '→' ? false : item[0] === '→' || Number(item[0]) > Number(stage.index))
  return (
    <main className="workspace route-view">
      <header className="page-header"><div><h1>从基础到研究室</h1><p className="subtle">12 周执行路线 · 长期学习规划</p></div><span className="readonly">只读</span></header>
      <section className="route-current"><span>当前</span><div><p>第 {context.suggestedWeek} 周 · {stage.label}</p><h2>{stage.title}</h2><small>{stage.range}</small></div><strong>{stage.index}</strong></section>
      <section className="route-timeline">
        {futureStages.map((item) => <article key={item[0]}><span>{item[0]}</span><div><p>{item[1]}</p><h3>{item[2]}</h3></div><small>{item[3]}</small></article>)}
      </section>
      <section className="gate-row"><div><h2>当前能力门槛</h2></div><ol><li><span>01</span>稳定完成每周学习计划</li><li><span>02</span>定期检验阶段学习成果</li><li><span>03</span>完成可展示的实践项目</li></ol></section>
      {loading ? <div className="inline-notice view-loading" role="status">路线读取中</div> : document ? <section className="route-documents"><nav className="motion-selection" aria-label="路线文档"><SelectionIndicator value={document.id} />{documents.map((item) => <button className={item.id === document.id ? 'active' : ''} aria-current={item.id === document.id ? 'page' : undefined} onClick={() => setSelected(item.id)} key={item.id}>{item.title}</button>)}</nav><article className="markdown-document route-document-content" key={document.id}><ReactMarkdown components={{ a: ({ children, node, ...props }) => { void node; return <a {...props} target="_blank" rel="noreferrer">{children}</a> } }}>{document.content}</ReactMarkdown></article></section> : <div className="inline-notice">尚未读取到路线文件。</div>}
    </main>
  )
}

function WeekTimeProgress({ scope, label, actual, target, kind }: { scope: string; label: string; actual: number; target: number; kind: 'study' | 'fitness' }) {
  const maximum = Math.max(1, target)
  const ratio = target > 0 ? Math.min(1, Math.max(0, actual / target)) : 0
  const valueText = `实际 ${formatChineseDuration(actual)}，目标 ${formatChineseDuration(target)}`
  return <div className={`quota quota-${kind}`}>
    <div className="quota-heading" aria-label={`${scope}${label}：${valueText}`}><span>{label}时长</span><strong>{formatCompactDuration(actual)}</strong><small>/ {formatCompactDuration(target)}</small></div>
    <div className="quota-track" role="progressbar" aria-label={`${scope}${label}时长`} aria-valuemin={0} aria-valuemax={maximum} aria-valuenow={Math.min(maximum, Math.max(0, actual))} aria-valuetext={valueText}><i aria-hidden="true" style={{ transform: `scaleX(${ratio})` }} /></div>
  </div>
}

function RightRail({ tasks, date, today, liveDay, evidenceStatus, context, progress, onOpenEvidence }: { tasks: StudyTask[]; date: string; today: string; liveDay: DailyTimeSnapshot; evidenceStatus: Record<string, EvidenceInspection>; context: WeekPlanningContext; progress: ProgressQueryResult | null; onOpenEvidence: (path: string) => void }) {
  const summary = progress?.summary ?? context.summary
  const displayedDay = liveDay.date === date ? liveDay : summary.timeRecords.find((record) => record.date === date)
  const todayStudyActual = (displayedDay?.tasks ?? []).filter((task) => task.category !== 'fitness').reduce((sum, task) => sum + task.actualMinutes, 0)
  const todayFitnessActual = (displayedDay?.tasks ?? []).filter((task) => task.category === 'fitness').reduce((sum, task) => sum + task.actualMinutes, 0)
  const plan = context.current?.value.plan
  const totals = deriveWeekTimeTotals({
    startDate: context.startDate,
    endDate: context.endDate,
    plan: plan ?? null,
    records: summary.timeRecords,
    liveDay
  })
  const scope = date === today ? '本周' : '所在周'
  const weekDates = eachDayOfInterval({ start: parseISO(context.startDate), end: parseISO(context.endDate) }).slice(0, 7).map((date, index) => {
    const iso = format(date, 'yyyy-MM-dd')
    const dateTasks = totals.plannedTasks.filter((task) => task.date === iso)
    const studyMinutes = dateTasks.filter((task) => task.category !== 'fitness').reduce((sum, task) => sum + task.plannedMinutes, 0)
    const fitnessMinutes = dateTasks.filter((task) => task.category === 'fitness').reduce((sum, task) => sum + task.plannedMinutes, 0)
    return { day: ['一','二','三','四','五','六','日'][index], iso, date: format(date, 'dd'), studyMinutes, fitnessMinutes, total: dateTasks.length }
  })
  const evidence = tasks.flatMap((task) => task.evidence.map((path) => ({ path, category: task.category }))).slice(0, 3)
  return (
    <aside className="right-rail" aria-label="学习摘要">
      <section className="week-context"><div className="rail-heading"><span>{scope}</span><small>{context.startDate.slice(5).replace('-', '.')} — {context.endDate.slice(5).replace('-', '.')}</small></div><div className="week-progress-pair"><WeekTimeProgress scope={scope} label="学习" kind="study" actual={totals.studyActual} target={totals.studyPlanned} /><WeekTimeProgress scope={scope} label="健身" kind="fitness" actual={totals.fitnessActual} target={totals.fitnessPlanned} /></div><div className="mini-week" role="list" aria-label={`${scope}每日计划`}>{weekDates.map((item) => <div className={item.iso === date ? 'active' : ''} role="listitem" aria-label={`星期${item.day} ${item.iso}，学习计划 ${formatChineseDuration(item.studyMinutes)}，健身计划 ${formatChineseDuration(item.fitnessMinutes)}，${item.total} 项任务`} key={item.iso}><span aria-hidden="true">{item.day}</span><i aria-hidden="true" style={{ height: `${Math.min(60, Math.max(3, item.studyMinutes / 4))}px` }} /><small aria-hidden="true">{item.date}</small></div>)}</div>{!plan && <p className="rail-empty">尚未建立本周计划</p>}</section>
      <section className="rail-section"><div className="rail-heading"><span>最近证据</span></div>{evidence.length ? evidence.map((item) => {
        const inspection = evidenceStatus[item.path]
        const unavailable = inspection?.status === 'missing' || inspection?.status === 'blocked'
        return <button className={`rail-evidence ${unavailable ? 'evidence-unavailable' : ''}`} disabled={unavailable} title={inspection?.message} key={item.path} onClick={() => onOpenEvidence(item.path)}><span className="file-icon">{item.path.split('.').at(-1)?.slice(0,3).toUpperCase()}</span><div><b>{item.path.split('/').at(-1)}</b><small>{inspection?.status === 'missing' ? '文件缺失' : inspection?.status === 'blocked' ? '路径不可用' : `${date === today ? '今天' : '当日'} · ${item.category}`}</small></div></button>
      }) : <p className="rail-empty">{date === today ? '今天' : '当日'}还没有添加证据</p>}</section>
      <div className="rail-actual">{date === today ? '今日' : '当日'}学习 {formatChineseDuration(todayStudyActual)} · 健身 {formatChineseDuration(todayFitnessActual)}</div>
    </aside>
  )
}

export function App() {
  const today = useCurrentLocalDate()
  const fallbackRange = naturalWeekRange(today)
  const [view, setView] = useState<View>('today')
  const [tasks, setTasks] = useState(previewTasks)
  const [workspaceState, setWorkspaceState] = useState<'loading' | 'missing' | 'ready' | 'error'>(window.myWay ? 'loading' : 'ready')
  const [workspaceError, setWorkspaceError] = useState('')
  const [dayFile, setDayFile] = useState<VersionedFile<ParsedDailyRecord> | null>(null)
  const [missingPlan, setMissingPlan] = useState(false)
  const [notes, setNotes] = useState('## 注意力机制\n\n缩放点积中的 `√dₖ` 用于控制 softmax 前的方差。今天需要再确认多头拼接后的维度变化。')
  const [reflection, setReflection] = useState<ParsedDailyRecord['reflection']>({ learned: '', blockers: '', tomorrow: '' })
  const [pastExams, setPastExams] = useState<PastExam[]>([])
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'dirty' | 'conflict'>('saved')
  const [weekDocument, setWeekDocument] = useState<WeekDocument | null>(null)
  const [calendarLoading, setCalendarLoading] = useState(false)
  const [calendarMoves, setCalendarMoves] = useState<Record<string, string>>({})
  const [calendarSaveStatus, setCalendarSaveStatus] = useState<'saved' | 'saving' | 'conflict'>('saved')
  const [calendarDate, setCalendarDate] = useState(today)
  const [calendarMonth, setCalendarMonth] = useState<MonthlyProgressCell[]>([])
  const [calendarRecords, setCalendarRecords] = useState<DailyTimeSnapshot[]>([])
  const [progressData, setProgressData] = useState<ProgressQueryResult | null>(null)
  const [routeDocuments, setRouteDocuments] = useState<RouteDocument[]>([])
  const [routeLoading, setRouteLoading] = useState(false)
  const [activeDayDate, setActiveDayDate] = useState(today)
  const [dayReturnView, setDayReturnView] = useState<'calendar' | 'progress' | null>(null)
  const [todayTasksSnapshot, setTodayTasksSnapshot] = useState(previewTasks)
  const [activeDayWeek, setActiveDayWeek] = useState<WeekDocument | null>(null)
  const [activeDayContext, setActiveDayContext] = useState<WeekPlanningContext | null>(null)
  const [activeDayPlanDiff, setActiveDayPlanDiff] = useState<WeekPlanDiff | null>(null)
  const [openingDayDate, setOpeningDayDate] = useState<string | null>(null)
  const [weekContext, setWeekContext] = useState<WeekPlanningContext | null>(null)
  const [weekDraft, setWeekDraft] = useState<WeekDraft | null>(null)
  const [weekDirty, setWeekDirty] = useState(false)
  const [weekSaveStatus, setWeekSaveStatus] = useState<WeekSaveStatus>('idle')
  const [weekConflictAction, setWeekConflictAction] = useState<'reload' | 'copy' | null>(null)
  const [weekError, setWeekError] = useState<string | null>(null)
  const [weekNotice, setWeekNotice] = useState<string | null>(null)
  const [weekMode, setWeekMode] = useState<WeekWorkspaceMode>('plan')
  const [carryoverFile, setCarryoverFile] = useState<VersionedFile<ParsedDailyRecord> | null>(null)
  const [carryoverPending, setCarryoverPending] = useState<CarryoverPendingAction | null>(null)
  const [saveError, setSaveError] = useState('')
  const [viewError, setViewError] = useState('')
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [selectedTaskWeek, setSelectedTaskWeek] = useState<number | null>(null)
  const [selectedTaskSourceState, setSelectedTaskSourceState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)
  const [deletePending, setDeletePending] = useState(false)
  const [composer, setComposerState] = useState<TaskComposerState | null>(null)
  const [composerPending, setComposerPending] = useState(false)
  const [composerError, setComposerError] = useState<string | null>(null)
  const composerRef = useRef<TaskComposerState | null>(null)
  const composerPendingRef = useRef(false)
  const [manualSavePending, setManualSavePending] = useState(false)
  const manualSavePendingRef = useRef(false)
  const setComposer = (next: TaskComposerState | null): void => { composerRef.current = next; setComposerState(next) }
  const [evidenceStatus, setEvidenceStatus] = useState<Record<string, EvidenceInspection>>({})
  const [externalRefreshVersion, setExternalRefreshVersion] = useState(0)
  const [watchError, setWatchError] = useState('')
  const dirtyRef = useRef(false)
  const editVersion = useRef(0)
  const dayFileRef = useRef<VersionedFile<ParsedDailyRecord> | null>(null)
  const saveStatusRef = useRef(saveStatus)
  const activeDayDateRef = useRef(activeDayDate)
  const taskReturnRef = useRef<{ id: string; scrollTop: number } | null>(null)
  const dayReturnFocusRef = useRef<{ view: 'calendar' | 'progress'; ariaLabel: string; scrollTop: number } | null>(null)
  const sourceLoadTokenRef = useRef(0)
  const fileMutationTailRef = useRef<Promise<void>>(Promise.resolve())
  const deletePendingRef = useRef(false)
  const weekContextRef = useRef<WeekPlanningContext | null>(null)
  const weekDraftRef = useRef<WeekDraft | null>(null)
  const weekDirtyRef = useRef(false)
  const calendarDateRef = useRef(calendarDate)
  const weekEditVersion = useRef(0)
  const weekSaveStatusRef = useRef<WeekSaveStatus>('idle')
  const weekMutationTailRef = useRef<Promise<void>>(Promise.resolve())
  const evidenceInspectionTokenRef = useRef(0)
  const viewNavigationTokenRef = useRef(0)
  const evidencePathsRef = useRef<string[]>([])
  const carryoverPendingRef = useRef(false)
  const observedTodayRef = useRef(today)
  const keyboardActionsRef = useRef<null | {
    ready: boolean
    view: View
    hasSelectedTask: boolean
    returnView: 'calendar' | 'progress' | null
    navigate: (next: View) => void
    saveDay: () => void
    saveWeek: () => void
    closeTask: () => void
  }>(null)

  const activeWeekContext: WeekPlanningContext = weekContext ?? {
    date: today,
    ...fallbackRange,
    suggestedWeek: 1,
    current: null,
    previous: null,
    summary: {
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
  }
  const activeWeekDraft = weekDraft ?? newWeekDraft(activeWeekContext)
  const evidencePaths = useMemo(() => [...new Set([...tasks, ...todayTasksSnapshot].flatMap((task) => task.evidence))].sort(), [tasks, todayTasksSnapshot])
  const evidencePathKey = evidencePaths.join('\u0000')

  const hydrateWeekContext = (context: WeekPlanningContext, options?: { preserveDraft?: boolean }): void => {
    if (weekContextRef.current && weekContextRef.current.startDate !== context.startDate) setWeekNotice(null)
    setWeekContext(context)
    weekContextRef.current = context
    if (activeDayDateRef.current === today) {
      setActiveDayWeek(context.current)
      setActiveDayContext(context)
    }
    setProgressData((current) => ({ summary: context.summary, month: current?.month ?? [] }))
    if (!options?.preserveDraft) {
      const draft = context.current
        ? { plan: context.current.value.plan, body: context.current.value.body }
        : newWeekDraft(context)
      setWeekDraft(draft)
      weekDraftRef.current = draft
      setWeekDirty(false)
      weekDirtyRef.current = false
      setWeekSaveStatus(context.current ? 'saved' : 'idle')
      weekSaveStatusRef.current = context.current ? 'saved' : 'idle'
      setWeekError(null)
    }
  }

  const hydrateDay = (opened: DayOpenResult): void => {
    const hydratedTasks = toStudyTasks(opened.file.value.tasks)
    setDayFile(opened.file)
    dayFileRef.current = opened.file
    setTasks(hydratedTasks)
    if (opened.file.value.date === today) setTodayTasksSnapshot(hydratedTasks)
    setNotes(opened.file.value.notes)
    setReflection(opened.file.value.reflection)
    setPastExams(opened.file.value.pastExams)
    setMissingPlan(opened.missingPlan)
    dirtyRef.current = false
    setSaveError('')
    setSaveStatus('saved')
  }

  const hydrateEmptyDay = (date: string, week: WeekDocument | null): void => {
    setActiveDayDate(date)
    activeDayDateRef.current = date
    setDayFile(null)
    dayFileRef.current = null
    setTasks([])
    if (date === today) setTodayTasksSnapshot([])
    setNotes('')
    setReflection({ learned: '', blockers: '', tomorrow: '' })
    setPastExams([])
    setMissingPlan(!week)
    setActiveDayWeek(week)
    setActiveDayPlanDiff(null)
    dirtyRef.current = false
    editVersion.current += 1
    setSaveError('')
    setSaveStatus('saved')
  }

  const refreshCarryoverFor = async (date: string): Promise<void> => {
    const api = window.myWay
    if (!api) return
    try {
      const previousDate = format(addDays(parseISO(date), -1), 'yyyy-MM-dd')
      const previous = await api.day.open(previousDate)
      if (!previous.ok) {
        setCarryoverFile(null)
        setViewError(`无法检查未完成任务：${previous.error.message}`)
        return
      }
      const unresolved = previous.value?.file.value.tasks.some(isTaskPending)
      setCarryoverFile(unresolved ? previous.value?.file ?? null : null)
    } catch (error) {
      setCarryoverFile(null)
      setViewError(`无法检查未完成任务：${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const loadToday = async (): Promise<void> => {
    const api = window.myWay
    if (!api) return
    const result = await api.day.open(today)
    if (!result.ok) throw new Error(result.error.message)
    let opened: DayOpenResult
    if (result.value) opened = result.value
    else {
      const created = await api.day.create(today)
      if (!created.ok) throw new Error(created.error.message)
      opened = created.value
    }
    setActiveDayDate(today)
    activeDayDateRef.current = today
    hydrateDay(opened)
    const [contextResult, diff] = await Promise.all([api.week.context(today), api.week.diff(today, opened.file.value)])
    if (!contextResult.ok) throw new Error(contextResult.error.message)
    if (!diff.ok) throw new Error(diff.error.message)
    hydrateWeekContext(contextResult.value)
    setActiveDayWeek(contextResult.value.current)
    setActiveDayContext(contextResult.value)
    setActiveDayPlanDiff(diff.value)
    const rangeStart = contextResult.value.startDate
    const rangeEnd = contextResult.value.endDate
    const currentProgress = await api.progress.query(rangeStart, rangeEnd)
    if (!currentProgress.ok) throw new Error(currentProgress.error.message)
    setProgressData(currentProgress.value)
    await refreshCarryoverFor(today)
  }

  useEffect(() => {
    const api = window.myWay
    if (!api) return
    let active = true
    void (async () => {
      try {
        const workspace = await api.workspace.get()
        if (!active) return
        if (!workspace.ok) throw new Error(workspace.error.message)
        if (!workspace.value) {
          setWorkspaceState('missing')
          return
        }
        await loadToday()
        if (active) setWorkspaceState('ready')
      } catch (error) {
        if (active) {
          setWorkspaceError(error instanceof Error ? error.message : String(error))
          setWorkspaceState('error')
        }
      }
    })()
    return () => { active = false }
  // loadToday is intentionally captured once for first-launch hydration.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const api = window.myWay
    if (!api || workspaceState !== 'ready' || observedTodayRef.current === today) return
    observedTodayRef.current = today
    let active = true
    void (async () => {
      try {
        const [opened, contextResult] = await Promise.all([api.day.open(today), api.week.context(today)])
        if (!active) return
        if (!opened.ok) {
          setViewError(opened.error.message)
        } else {
          setTodayTasksSnapshot(opened.value ? toStudyTasks(opened.value.file.value.tasks) : [])
        }
        if (!contextResult.ok) {
          setViewError(contextResult.error.message)
          return
        }
        if (weekDirtyRef.current) return
        hydrateWeekContext(contextResult.value)
        const progress = await api.progress.query(contextResult.value.startDate, contextResult.value.endDate)
        if (!active) return
        if (progress.ok) setProgressData(progress.value)
        else setViewError(progress.error.message)
      } catch (error) {
        if (active) setViewError(`今日摘要刷新失败：${error instanceof Error ? error.message : String(error)}`)
      }
    })()
    return () => { active = false }
  // The date rollover refreshes read-only snapshots; the viewed day changes only after the user opens Today.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, workspaceState])

  const selectWorkspace = async (): Promise<void> => {
    const api = window.myWay
    if (!api) return
    setWorkspaceState('loading')
    try {
      const selected = await api.workspace.select()
      if (!selected.ok) {
        setWorkspaceError(selected.error.message)
        setWorkspaceState('error')
        return
      }
      if (!selected.value) {
        setWorkspaceState('missing')
        return
      }
      await loadToday()
      setWorkspaceState('ready')
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error))
      setWorkspaceState('error')
    }
  }

  const retryWorkspace = async (): Promise<void> => {
    const api = window.myWay
    if (!api) return
    setWorkspaceState('loading')
    setWorkspaceError('')
    try {
      const workspace = await api.workspace.get()
      if (!workspace.ok) throw new Error(workspace.error.message)
      if (!workspace.value) {
        setWorkspaceState('missing')
        return
      }
      await loadToday()
      setWorkspaceState('ready')
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : String(error))
      setWorkspaceState('error')
    }
  }

  const updateRecord = (update: (record: ParsedDailyRecord) => ParsedDailyRecord): void => {
    setDayFile((current) => {
      const next = current ? { ...current, value: update(current.value) } : current
      dayFileRef.current = next
      return next
    })
    dirtyRef.current = true
    editVersion.current += 1
    setSaveError('')
    setSaveStatus('dirty')
  }

  const updateTasks = (nextTasks: StudyTask[]): void => {
    if (nextTasks.reduce((sum, task) => sum + task.actual, 0) > 1440) {
      setSaveError('一天的实际学习时间不能超过 1440 分钟')
      return
    }
    setTasks(nextTasks)
    if (activeDayDateRef.current === today) setTodayTasksSnapshot(nextTasks)
    updateRecord((record) => ({
      ...record,
      tasks: nextTasks.map((edited) => {
        const task = record.tasks.find((candidate) => candidate.id === edited.id)
        if (!task) throw new Error(`找不到任务：${edited.id}`)
        return { ...task, date: edited.date, originalDate: edited.originalDate, sourceTaskId: edited.sourceTaskId, category: categoryKeys[edited.category], title: edited.title, deliverable: edited.deliverable, plannedMinutes: edited.planned, actualMinutes: edited.actual, status: edited.state, evidence: [...edited.evidence], notes: edited.notes, outcomes: edited.outcomes }
      })
    }))
  }

  const updateTask = (taskId: string, patch: Partial<StudyTask>): void => {
    const current = dayFileRef.current ? toStudyTasks(dayFileRef.current.value.tasks) : tasks
    updateTasks(current.map((task) => task.id === taskId ? { ...task, ...patch } : task))
  }

  const selectEvidence = (taskId: string, replacePath?: string): void => {
    const api = window.myWay
    if (!api) return
    void (async () => {
      try {
        const result = await api.evidence.select()
        if (!result.ok) {
          setSaveError(`无法选择证据：${result.error.message}`)
          return
        }
        if (!result.value) return
        const source = dayFileRef.current ? toStudyTasks(dayFileRef.current.value.tasks) : tasks
        const task = source.find((candidate) => candidate.id === taskId)
        if (!task) return
        const replaced = replacePath
          ? task.evidence.map((path) => path === replacePath ? result.value as string : path)
          : [...task.evidence, result.value as string]
        updateTask(taskId, { evidence: [...new Set(replaced)] })
      } catch (error) {
        setSaveError(`无法选择证据：${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  }

  const removeEvidence = (taskId: string, path: string): void => {
    const source = dayFileRef.current ? toStudyTasks(dayFileRef.current.value.tasks) : tasks
    const task = source.find((candidate) => candidate.id === taskId)
    if (task) updateTask(taskId, { evidence: task.evidence.filter((candidate) => candidate !== path) })
  }

  const openEvidence = (path: string): void => {
    const api = window.myWay
    if (!api) return
    void (async () => {
      try {
        const result = await api.evidence.open(path)
        if (result.ok) return
        setSaveError(`无法打开证据：${result.error.message}`)
        inspectEvidencePaths()
      } catch (error) {
        setSaveError(`无法打开证据：${error instanceof Error ? error.message : String(error)}`)
        inspectEvidencePaths()
      }
    })()
  }

  const inspectEvidencePaths = (paths: string[] = evidencePathsRef.current): void => {
    const api = window.myWay
    const unique = [...new Set(paths)]
    if (!api) {
      setEvidenceStatus(Object.fromEntries(unique.map((path) => [path, { path, status: 'available' as const }])))
      return
    }
    const token = ++evidenceInspectionTokenRef.current
    void (async () => {
      try {
        const result = await api.evidence.inspect(unique)
        if (token !== evidenceInspectionTokenRef.current) return
        if (!result.ok) {
          setSaveError(`无法检查证据：${result.error.message}`)
          return
        }
        setEvidenceStatus(Object.fromEntries(result.value.map((inspection) => [inspection.path, inspection])))
      } catch (error) {
        if (token === evidenceInspectionTokenRef.current) {
          setSaveError(`无法检查证据：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })()
  }

  const importTodayPlanTasks = (): void => {
    if (!activeDayWeek || !activeDayPlanDiff?.addedTaskIds.length) return
    const selected = new Set(activeDayPlanDiff.addedTaskIds)
    const additions: DailyTask[] = activeDayWeek.value.plan.tasks
      .filter((task) => task.date === activeDayDate && selected.has(task.id))
      .map((task) => ({ ...task, sourceTaskId: task.id, originalDate: task.date, actualMinutes: 0, status: 'planned', evidence: [], notes: '', outcomes: '' }))
    if (!additions.length) return
    const nextTasks = [...tasks, ...toStudyTasks(additions)]
    setTasks(nextTasks)
    if (activeDayDateRef.current === today) setTodayTasksSnapshot(nextTasks)
    updateRecord((record) => ({ ...record, sourceWeek: activeDayWeek.value.plan.week, tasks: [...record.tasks, ...additions] }))
    setActiveDayPlanDiff((current) => current ? { ...current, addedTaskIds: current.addedTaskIds.filter((id) => !selected.has(id)) } : current)
    setMissingPlan(false)
  }

  const startTaskComposer = (taskId?: string): void => {
    const error = minuteInputError('.today-view, .task-detail-view')
    if (error) { setSaveError(error); return }
    const preview = tasks.find((item) => item.id === taskId)
    const source = dayFileRef.current?.value.tasks.find((item) => item.id === taskId)
      ?? (preview ? { ...preview, category: categoryKeys[preview.category], plannedMinutes: preview.planned } : undefined)
    const date = dayFileRef.current?.value.date ?? activeDayDate
    setComposerError(null)
    setComposer({ id: `manual-${date}-${crypto.randomUUID()}`, kind: taskId ? 'copy' : 'new', draft: newTaskDraft(date, source) })
  }

  const submitTaskComposer = (): void => {
    const current = composerRef.current
    if (!current || composerPendingRef.current) return
    let task: DailyTask
    try { task = buildDailyTask(current.draft, current.id) }
    catch { setComposerError('请检查任务标题、日期和计划分钟。'); return }
    composerPendingRef.current = true
    setComposerPending(true)
    setComposerError(null)
    void enqueueFileMutation(async () => {
      try {
        const api = window.myWay
        if (!api) {
          setTasks((items) => [...items, ...toStudyTasks([task])])
          setComposer(null)
          activateTaskDetail(toStudyTasks([task])[0], { id: task.id, scrollTop: 0 })
          return
        }
        while (dirtyRef.current) {
          const saved = await saveCurrentDayNow()
          if (!saved || !saved.ok) { setComposerError(saved?.ok === false ? saved.error.message : '每日记录不可用'); return }
        }
        const saved = await persistNewTask(api.day, task)
        if (!saved.ok) { setComposerError(saved.error.message); return }
        setComposer(null)
        setActiveDayDate(task.date)
        activeDayDateRef.current = task.date
        hydrateDay({ file: saved.value, created: false, missingPlan: saved.value.value.sourceWeek === null })
        setActiveDayWeek(null)
        setActiveDayContext(null)
        setActiveDayPlanDiff(null)
        setView('today')
        setDayReturnView(null)
        activateTaskDetail(toStudyTasks([task])[0], { id: task.id, scrollTop: 0 })
        const [context, diff] = await Promise.all([api.week.context(task.date), api.week.diff(task.date, saved.value.value)])
        if (context.ok) { setActiveDayWeek(context.value.current); setActiveDayContext(context.value) }
        else setViewError(context.error.message)
        if (diff.ok) setActiveDayPlanDiff(diff.value)
        else setViewError(diff.error.message)
      } catch (error) {
        if (composerRef.current) setComposerError(error instanceof Error ? error.message : String(error))
        else setViewError(`任务已保存，摘要刷新失败：${error instanceof Error ? error.message : String(error)}`)
      } finally {
        composerPendingRef.current = false
        setComposerPending(false)
      }
    })
  }

  const activateTaskDetail = (task: StudyTask, returnTarget: { id: string; scrollTop: number }): void => {
    taskReturnRef.current = returnTarget
    setSelectedTaskId(task.id)
    setDeleteDialogOpen(false)
    setSelectedTaskWeek(null)
    setSelectedTaskSourceState('loading')
    const api = window.myWay
    if (!api) {
      setSelectedTaskSourceState('ready')
      return
    }
    const token = ++sourceLoadTokenRef.current
    void (async () => {
      try {
        const result = await api.week.load(task.originalDate)
        if (sourceLoadTokenRef.current !== token) return
        if (!result.ok) {
          setSelectedTaskSourceState('error')
          setSaveError(`无法确认任务来源：${result.error.message}`)
          return
        }
        const rootId = task.sourceTaskId ?? task.id
        const source = result.value?.value.plan.tasks.find((candidate) => candidate.id === rootId)
        setSelectedTaskWeek(source ? result.value?.value.plan.week ?? null : null)
        setSelectedTaskSourceState('ready')
      } catch (error) {
        if (sourceLoadTokenRef.current !== token) return
        setSelectedTaskSourceState('error')
        setSaveError(`无法确认任务来源：${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  }

  const openTaskDetail = (taskId: string): void => {
    const error = minuteInputError('.today-view')
    if (error) { setSaveError(error); return }
    const task = tasks.find((candidate) => candidate.id === taskId)
    if (!task) return
    const row = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(taskId)}"]`)
    const workspace = row?.closest<HTMLElement>('.workspace')
    activateTaskDetail(task, { id: taskId, scrollTop: workspace?.scrollTop ?? 0 })
  }

  const closeTaskDetail = (): void => {
    const error = minuteInputError('.task-detail-view')
    if (error) { setSaveError(error); return }
    setSelectedTaskId(null)
    setDeleteDialogOpen(false)
    const target = taskReturnRef.current
    window.requestAnimationFrame(() => {
      if (!target) return
      const row = document.querySelector<HTMLElement>(`[data-task-id="${CSS.escape(target.id)}"]`)
      const workspace = row?.closest<HTMLElement>('.workspace')
      if (workspace) workspace.scrollTop = target.scrollTop
      row?.focus()
    })
  }

  const handleCarryover = (taskId: string, action: CarryoverAction): void => {
    const api = window.myWay
    if (!api || !carryoverFile || carryoverPendingRef.current) return
    const sourceFile = carryoverFile
    const choice = action === 'reschedule' ? { action, targetDate: today } as const : { action } as const
    const actionLabel = action === 'reschedule' ? '顺延' : action === 'skip' ? '跳过' : '保留逾期'
    carryoverPendingRef.current = true
    setCarryoverPending({ taskId, action })
    void enqueueFileMutation(async () => {
      try {
        if (action === 'reschedule') {
          do {
            const saved = await saveCurrentDayNow()
            if (!saved || !saved.ok) return
          } while (dirtyRef.current)
        }
        const targetVersion = editVersion.current
        const targetBase = dayFileRef.current?.value
        const originalTargetIds = new Set(targetBase?.tasks.map((task) => task.id))
        const result = await api.day.resolveCarryover({ source: sourceFile, targetDate: today, taskId, choice })
        if (!result.ok) {
          const message = `${actionLabel}失败：${result.error.message}。已保留任务副本，请检查今天的任务后重试。`
          const refreshedSource = await api.day.open(sourceFile.value.date)
          if (refreshedSource.ok && refreshedSource.value) setCarryoverFile(refreshedSource.value.file)
          // A failed transaction must not reload over edits made while it ran.
          // The next save still uses its revision and surfaces any conflict.
          setSaveError(message)
          return
        }
        setSaveError('')
        const remaining = result.value.source.value.tasks.filter((task) => task.id !== taskId && isTaskPending(task))
        setCarryoverFile(remaining.length ? result.value.source : null)
        if (result.value.target) {
          const target = result.value.target
          setTodayTasksSnapshot(toStudyTasks(target.value.tasks))
          if (activeDayDateRef.current === today) {
            const latest = dayFileRef.current
            if (targetVersion === editVersion.current || !latest) {
              hydrateDay({ file: target, created: false, missingPlan: target.value.sourceWeek === null })
            } else {
              // Only adopting a new revision for an append-only carryover is
              // safe. Concurrent external edits to existing fields require
              // explicit conflict resolution, not a silent local overwrite.
              const remoteBase = { ...target.value, tasks: target.value.tasks.filter((task) => originalTargetIds.has(task.id)), updatedAt: '' }
              if (!targetBase || JSON.stringify(remoteBase) !== JSON.stringify({ ...targetBase, updatedAt: '' })) {
                setSaveStatus('conflict')
                setSaveError('顺延已保存，但今天的文件同时出现外部修改；当前编辑已保留，请解决文件冲突。')
                return
              }
              const localIds = new Set(latest.value.tasks.map((task) => task.id))
              const merged = { ...target, value: { ...latest.value, tasks: [
                ...latest.value.tasks,
                ...target.value.tasks.filter((task) => !originalTargetIds.has(task.id) && !localIds.has(task.id))
              ] } }
              dayFileRef.current = merged
              setDayFile(merged)
              setTasks(toStudyTasks(merged.value.tasks))
              setTodayTasksSnapshot(toStudyTasks(merged.value.tasks))
              dirtyRef.current = true
              setSaveStatus('dirty')
            }
          }
        }
      } catch (error) {
        setSaveError(`${actionLabel}失败：${error instanceof Error ? error.message : String(error)}。任务仍保留，请重试。`)
      } finally {
        carryoverPendingRef.current = false
        setCarryoverPending(null)
      }
    })
  }

  const updateNotes = (value: string): void => {
    setNotes(value)
    updateRecord((record) => ({ ...record, notes: value }))
  }

  const updateReflection = (value: ParsedDailyRecord['reflection']): void => {
    setReflection(value)
    updateRecord((record) => ({ ...record, reflection: value }))
  }

  const updatePastExams = (value: PastExam[]): void => {
    setPastExams(value)
    updateRecord((record) => ({ ...record, pastExams: value }))
  }

  const enqueueFileMutation = <T,>(operation: () => Promise<T>): Promise<T> => {
    const run = fileMutationTailRef.current.then(operation, operation)
    fileMutationTailRef.current = run.then(() => undefined, () => undefined)
    return run
  }

  const enqueueWeekMutation = <T,>(operation: () => Promise<T>): Promise<T> => {
    const run = weekMutationTailRef.current.then(operation, operation)
    weekMutationTailRef.current = run.then(() => undefined, () => undefined)
    return run
  }

  const updateWeekDraft = (next: WeekDraft): void => {
    setWeekNotice(null)
    setWeekDraft(next)
    weekDraftRef.current = next
    setWeekDirty(true)
    weekDirtyRef.current = true
    weekEditVersion.current += 1
    setWeekSaveStatus('idle')
    weekSaveStatusRef.current = 'idle'
    setWeekError(null)
  }

  const saveCurrentWeekNow = async () => {
    const minuteError = minuteInputError('.week-workspace')
    if (minuteError) {
      setWeekError(minuteError)
      return { ok: false as const, error: { code: 'VALIDATION' as const, message: minuteError } }
    }
    const api = window.myWay
    const draft = weekDraftRef.current
    const context = weekContextRef.current
    if (!api || !draft || !context) return null
    if (!weekDirtyRef.current) return context.current ? { ok: true as const, value: context.current } : null
    const validation = Object.values(validateWeekDraft(draft))
    if (validation.length) {
      const error = { code: 'VALIDATION' as const, message: validation[0] }
      setWeekError(error.message)
      return { ok: false as const, error }
    }

    const version = weekEditVersion.current
    setWeekSaveStatus('saving')
    weekSaveStatusRef.current = 'saving'
    let result: Awaited<ReturnType<typeof api.week.save>>
    try {
      result = await api.week.save({
        expectedRevision: context.current?.revision ?? null,
        plan: draft.plan,
        body: draft.body
      })
    } catch (error) {
      result = rejectedResult(error)
    }
    if (!result.ok) {
      const status: WeekSaveStatus = result.error.code === 'CONFLICT' ? 'conflict' : 'idle'
      setWeekSaveStatus(status)
      weekSaveStatusRef.current = status
      setWeekError(result.error.message)
      return result
    }

    let refreshed: Awaited<ReturnType<typeof api.week.context>>
    try {
      refreshed = await api.week.context(today)
    } catch (error) {
      refreshed = rejectedResult(error)
    }
    const nextContext: WeekPlanningContext = refreshed.ok
      ? { ...refreshed.value, current: result.value }
      : { ...context, current: result.value }
    setWeekContext(nextContext)
    weekContextRef.current = nextContext
    const viewedDate = activeDayDateRef.current
    const savedPlan = result.value.value.plan
    if (savedPlan.startDate <= viewedDate && viewedDate <= savedPlan.endDate) setActiveDayWeek(result.value)
    setProgressData((current) => ({ summary: nextContext.summary, month: current?.month ?? [] }))

    if (weekEditVersion.current === version) {
      const authoritative = { plan: result.value.value.plan, body: result.value.value.body }
      setWeekDraft(authoritative)
      weekDraftRef.current = authoritative
      setWeekDirty(false)
      weekDirtyRef.current = false
      setWeekSaveStatus('saved')
      weekSaveStatusRef.current = 'saved'
    } else {
      setWeekDirty(true)
      weekDirtyRef.current = true
      setWeekSaveStatus('idle')
      weekSaveStatusRef.current = 'idle'
    }
    setWeekError(refreshed.ok ? null : `计划已保存，但重新读取失败：${refreshed.error.message}`)

    const currentDay = dayFileRef.current
    if (currentDay && savedPlan.startDate <= currentDay.value.date && currentDay.value.date <= savedPlan.endDate) {
      try {
        const diff = await api.week.diff(currentDay.value.date, currentDay.value)
        if (diff.ok) setActiveDayPlanDiff(diff.value)
        else setWeekError(diff.error.message)
      } catch (error) {
        setWeekError(`计划已保存，但无法刷新每日差异：${error instanceof Error ? error.message : String(error)}`)
      }
    }
    return result
  }

  const saveCurrentWeek = (): Promise<Awaited<ReturnType<typeof saveCurrentWeekNow>>> => enqueueWeekMutation(saveCurrentWeekNow)

  const refreshPlanningContext = async (): Promise<boolean> => {
    const api = window.myWay
    if (!api) return false
    const result = await api.week.context(today)
    if (!result.ok) {
      setViewError(result.error.message)
      return false
    }
    hydrateWeekContext(result.value)
    const progress = await api.progress.query(result.value.startDate, result.value.endDate)
    if (!progress.ok) {
      setViewError(progress.error.message)
      return true
    }
    setProgressData(progress.value)
    setViewError('')
    return true
  }

  const saveCurrentDayNow = async (options?: { asConflictCopy?: boolean }) => {
    const minuteError = minuteInputError('.today-view, .task-detail-view')
    if (minuteError) {
      setSaveError(minuteError)
      return { ok: false as const, error: { code: 'VALIDATION' as const, message: minuteError } }
    }
    const api = window.myWay
    if (!api) return null
    const snapshot = dayFileRef.current
    if (!snapshot) return null
    if (!dirtyRef.current && !options) return { ok: true as const, value: snapshot }
    const version = editVersion.current
    setSaveStatus('saving')
    let result: Awaited<ReturnType<typeof api.day.save>>
    try {
      result = await api.day.save(snapshot, options)
    } catch (error) {
      result = rejectedResult(error)
    }
    if (!result.ok) {
      setSaveStatus(result.error.code === 'CONFLICT' ? 'conflict' : 'dirty')
      setSaveError(result.error.message)
      return result
    }
    if (editVersion.current === version) {
      dirtyRef.current = false
      dayFileRef.current = result.value
      setDayFile(result.value)
      setSaveStatus('saved')
      setSaveError('')
    } else {
      const merged = dayFileRef.current ? { ...result.value, value: dayFileRef.current.value } : result.value
      dayFileRef.current = merged
      setDayFile(merged)
      setSaveStatus('dirty')
    }
    return result
  }

  const saveCurrentDay = (options?: { asConflictCopy?: boolean }) => enqueueFileMutation(() => saveCurrentDayNow(options))

  const saveTaskDetail = (returnToDay: boolean): void => {
    if (manualSavePendingRef.current) return
    const navigationToken = viewNavigationTokenRef.current
    manualSavePendingRef.current = true
    setManualSavePending(true)
    void (async () => {
      try {
        if (!window.myWay) { if (returnToDay) closeTaskDetail(); return }
        do {
          const result = await saveCurrentDay()
          if (!result || !result.ok) return
        } while (dirtyRef.current)
        if (returnToDay && navigationToken === viewNavigationTokenRef.current) closeTaskDetail()
      } finally {
        manualSavePendingRef.current = false
        setManualSavePending(false)
      }
    })()
  }

  const loadDayRecordNow = async (date: string, options: { showDay?: boolean; flushEdits?: boolean; createIfMissing?: boolean } = {}): Promise<boolean> => {
    const api = window.myWay
    if (!api) return false
    try {
      if (options.flushEdits !== false) {
        while (dirtyRef.current) {
          const saved = await saveCurrentDayNow()
          if (!saved || !saved.ok) return false
        }
      }

      const [openResult, contextResult] = await Promise.all([api.day.open(date), api.week.context(date)])
      if (!openResult.ok) {
        setViewError(openResult.error.message)
        return false
      }
      if (!contextResult.ok) {
        setViewError(contextResult.error.message)
        return false
      }

      let opened = openResult.value
      if (!opened && options.createIfMissing) {
        const created = await api.day.create(date)
        if (!created.ok) {
          setViewError(created.error.message)
          return false
        }
        opened = created.value
      }

      if (options.showDay) {
        setSelectedTaskId(null)
        setDeleteDialogOpen(false)
      }
      setActiveDayDate(date)
      activeDayDateRef.current = date
      setActiveDayWeek(contextResult.value.current)
      setActiveDayContext(contextResult.value)
      if (opened) {
        hydrateDay(opened)
        const diff = await api.week.diff(date, opened.file.value)
        if (diff.ok) {
          setActiveDayPlanDiff(diff.value)
          setViewError('')
        } else {
          setActiveDayPlanDiff(null)
          setViewError(diff.error.message)
        }
      } else {
        hydrateEmptyDay(date, contextResult.value.current)
        setViewError('')
      }
      if (options.showDay) setView('today')
      return true
    } catch (error) {
      setViewError(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  const openDayRecord = (date: string, returnView: 'calendar' | 'progress' | null = null, taskId?: string): void => {
    if (openingDayDate) return
    if (returnView && document.activeElement instanceof HTMLElement) {
      const ariaLabel = document.activeElement.getAttribute('aria-label')
      const workspace = document.activeElement.closest<HTMLElement>('.workspace')
      if (ariaLabel) dayReturnFocusRef.current = { view: returnView, ariaLabel, scrollTop: workspace?.scrollTop ?? 0 }
    }
    setOpeningDayDate(date)
    setViewError('')
    void enqueueFileMutation(async () => {
      const loaded = await loadDayRecordNow(date, { showDay: true, createIfMissing: date === today })
      if (loaded) {
        setDayReturnView(returnView)
        if (taskId) {
          const task = dayFileRef.current?.value.tasks.find((candidate) => candidate.id === taskId)
          if (task) activateTaskDetail(toStudyTasks([task])[0], { id: task.id, scrollTop: 0 })
          else setViewError('该任务已不在对应的每日记录中。')
        }
        if (date === today) await refreshCarryoverFor(date)
      }
    }).finally(() => setOpeningDayDate(null))
  }

  const createActiveDayRecord = (): void => {
    const api = window.myWay
    const date = activeDayDateRef.current
    if (!api || openingDayDate || dayFileRef.current) return
    setOpeningDayDate(date)
    setViewError('')
    void enqueueFileMutation(async () => {
      try {
        const created = await api.day.create(date)
        if (!created.ok) {
          setViewError(created.error.message)
          return
        }
        hydrateDay(created.value)
        const [contextResult, diff] = await Promise.all([api.week.context(date), api.week.diff(date, created.value.file.value)])
        if (contextResult.ok) {
          setActiveDayWeek(contextResult.value.current)
          setActiveDayContext(contextResult.value)
        } else setViewError(contextResult.error.message)
        if (diff.ok) setActiveDayPlanDiff(diff.value)
        else setViewError(diff.error.message)
      } catch (error) {
        setViewError(error instanceof Error ? error.message : String(error))
      }
    }).finally(() => setOpeningDayDate(null))
  }

  const commitTimerAssignment = (request: AssignTimerRequest): Promise<Result<AssignTimerResult>> => {
    const api = window.myWay
    if (!api) return Promise.resolve({ ok: false, error: { code: 'UNKNOWN', message: '计时服务不可用' } })
    return enqueueFileMutation(async () => {
      const options = await api.timer.assignmentOptions(request.sessionId)
      if (!options.ok) return { ok: false, error: options.error }
      if (options.value.date === today && activeDayDateRef.current === today) {
        const saved = await saveCurrentDayNow()
        if (!saved || !saved.ok) return saved?.ok === false
          ? { ok: false, error: saved.error }
          : { ok: false, error: { code: 'UNKNOWN', message: '每日记录不可用' } }
      }
      const result = await api.timer.assign(request)
      if (result.ok && options.value.date === today) {
        setTodayTasksSnapshot(toStudyTasks(result.value.day.value.tasks))
        if (activeDayDateRef.current === today) hydrateDay({ file: result.value.day, created: false, missingPlan: result.value.day.value.sourceWeek === null })
        const currentWeek = weekContextRef.current?.current
        const progress = await api.progress.query(
          currentWeek?.value.plan.startDate ?? format(startOfWeek(parseISO(today), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
          currentWeek?.value.plan.endDate ?? format(endOfWeek(parseISO(today), { weekStartsOn: 1 }), 'yyyy-MM-dd')
        )
        if (progress.ok) setProgressData(progress.value)
      }
      return result
    })
  }

  const timerController = useTimerController({
    enabled: workspaceState === 'ready',
    api: window.myWay,
    date: today,
    commitAssignment: commitTimerAssignment
  })
  const [idleTimerIntent, setIdleTimerIntent] = useState<TimerTaskIntent | null>(null)
  const timerChoices = timerTaskChoices(activeDayDate === today ? tasks : todayTasksSnapshot, today)
  const idleTask = idleTimerIntent?.date === today ? timerChoices.find(task => task.id === idleTimerIntent.taskId) : undefined
  const validIdleIntent = idleTask ? { date: today, taskId: idleTask.id, taskTitle: idleTask.title } : null
  const selectedTimerIntent = timerController.snapshot.active
    ? timerController.snapshot.active.taskIntent ?? null : validIdleIntent
  const selectTimerIntent = (intent: TimerTaskIntent | null): void => {
    if (timerController.snapshot.active) void timerController.setTaskIntent(intent)
    else setIdleTimerIntent(intent)
  }

  useEffect(() => {
    const api = window.myWay
    if (!api || !dayFile || !dirtyRef.current || saveStatus === 'conflict' || deletePendingRef.current) return
    const timer = window.setTimeout(() => {
      if (!deletePendingRef.current) void saveCurrentDay()
    }, 500)
    return () => window.clearTimeout(timer)
  // Saving is coordinated through refs; edits and status changes own the debounce lifecycle.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dayFile, saveStatus])

  useEffect(() => {
    const api = window.myWay
    const current = weekContextRef.current?.current
    const draft = weekDraftRef.current
    if (!api || !current || !draft || !weekDirty || weekSaveStatus === 'conflict' || Object.keys(validateWeekDraft(draft)).length) return
    const timer = window.setTimeout(() => { void saveCurrentWeek() }, 700)
    return () => window.clearTimeout(timer)
  // Week writes use their own serialized queue; draft/status changes restart the debounce.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDraft, weekDirty, weekSaveStatus])

  useEffect(() => {
    evidencePathsRef.current = evidencePaths
    inspectEvidencePaths(evidencePaths)
  // Only path membership controls inspections; task time and status edits must not trigger filesystem work.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evidencePathKey])

  useEffect(() => {
    const api = window.myWay
    if (!api) return
    try {
      return api.files.subscribe((event) => {
      const reportWeekWatchError = (message: string): void => {
        setWeekError(message)
        setViewError(message)
      }
      if (event.kind === 'error') {
        setWatchError(`${event.message}。外部文件变化可能无法自动显示；请保存当前编辑并重新启动 App。`)
        return
      }
      const isDailyRecord = /(?:^|\/)data\/daily\/\d{4}\/\d{4}-\d{2}-\d{2}\.md$/.test(event.path)
      const isRouteDocument = /(?:^|\/)00-dashboard\/(?:12-week-roadmap|long-term-roadmap|current-status)\.md$/.test(event.path)
      if (isDailyRecord || isRouteDocument) setExternalRefreshVersion((version) => version + 1)
      const observed = dayFileRef.current
      const observedDate = activeDayDateRef.current
      if (observed && event.path.endsWith(`${observedDate}.md`)) {
        void api.day.open(observedDate).then((result) => {
          if (!result.ok) {
            setSaveError(`无法核对外部文件变化：${result.error.message}`)
            return
          }
          const current = dayFileRef.current
          if (!current || result.value?.file.revision === current.revision) return
          if (dirtyRef.current) setSaveStatus('conflict')
          else void loadDayRecordNow(observedDate, { flushEdits: false })
        }).catch((error: unknown) => {
          setSaveError(`无法核对外部文件变化：${error instanceof Error ? error.message : String(error)}`)
        })
      }
      if (evidencePathsRef.current.includes(event.path)) inspectEvidencePaths()
      if (/00-dashboard\/weeks\/week-\d+\.md$/.test(event.path) && weekSaveStatusRef.current !== 'saving') {
        const viewedDate = activeDayDateRef.current
        const viewedContext = api.week.context(viewedDate)
        void viewedContext.then(async (loaded) => {
          if (!loaded.ok) {
            reportWeekWatchError(`无法核对周计划变化：${loaded.error.message}`)
            return
          }
          if (activeDayDateRef.current !== viewedDate) return
          setActiveDayWeek(loaded.value.current)
          setActiveDayContext(loaded.value)
          const currentDay = dayFileRef.current
          if (!currentDay || currentDay.value.date !== viewedDate) return
          const diff = await api.week.diff(viewedDate, currentDay.value)
          if (diff.ok && activeDayDateRef.current === viewedDate) setActiveDayPlanDiff(diff.value)
          else if (!diff.ok) reportWeekWatchError(`无法核对周计划变化：${diff.error.message}`)
        }).catch((error: unknown) => {
          reportWeekWatchError(`无法核对周计划变化：${error instanceof Error ? error.message : String(error)}`)
        })
        const currentContext = viewedDate === today ? viewedContext : api.week.context(today)
        void currentContext.then((result) => {
          if (!result.ok) {
            reportWeekWatchError(`无法核对周计划变化：${result.error.message}`)
            return
          }
          const previousRevision = weekContextRef.current?.current?.revision ?? null
          const nextRevision = result.value.current?.revision ?? null
          if (previousRevision === nextRevision) {
            if (!weekDirtyRef.current) hydrateWeekContext(result.value)
            return
          }
          if (weekDirtyRef.current) {
            setWeekNotice(null)
            setWeekSaveStatus('conflict')
            weekSaveStatusRef.current = 'conflict'
            setWeekError('本周计划已在 App 外部发生变化。当前草案不会被静默覆盖。')
          } else hydrateWeekContext(result.value)
        }).catch((error: unknown) => {
          reportWeekWatchError(`无法核对周计划变化：${error instanceof Error ? error.message : String(error)}`)
        })
      }
      })
    } catch (error) {
      let mounted = true
      queueMicrotask(() => {
        if (mounted) setWatchError(`无法启动文件监听：${error instanceof Error ? error.message : String(error)}。外部文件变化可能无法自动显示；请保存当前编辑并重新启动 App。`)
      })
      return () => { mounted = false }
    }
  // Revisions are compared lazily so delayed self-write events are ignored.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [today, activeDayDate])

  useEffect(() => { dayFileRef.current = dayFile }, [dayFile])
  useEffect(() => { saveStatusRef.current = saveStatus }, [saveStatus])
  useEffect(() => { activeDayDateRef.current = activeDayDate }, [activeDayDate])
  useEffect(() => { weekContextRef.current = weekContext }, [weekContext])
  useEffect(() => { weekDraftRef.current = weekDraft }, [weekDraft])
  useEffect(() => { weekDirtyRef.current = weekDirty }, [weekDirty])
  useEffect(() => { weekSaveStatusRef.current = weekSaveStatus }, [weekSaveStatus])
  useEffect(() => { calendarDateRef.current = calendarDate }, [calendarDate])

  useEffect(() => {
    const target = dayReturnFocusRef.current
    if (!target || target.view !== view) return
    return restoreFocusWhenStable({
      selector: `[aria-label="${CSS.escape(target.ariaLabel)}"]`,
      scrollTop: target.scrollTop,
      onStable: () => {
        if (dayReturnFocusRef.current === target) dayReturnFocusRef.current = null
      }
    })
  }, [view, weekDocument, progressData, calendarLoading, weekMode])

  useEffect(() => {
    const api = window.myWay
    if (!api) return
    try {
      return api.lifecycle.onBeforeClose(() => {
      void (async () => {
        try {
          while (true) {
            const queuedDay = fileMutationTailRef.current
            const queuedWeek = weekMutationTailRef.current
            await Promise.all([queuedDay, queuedWeek])
            if (queuedDay !== fileMutationTailRef.current || queuedWeek !== weekMutationTailRef.current) continue
            if (composerRef.current) {
              setComposerError('任务尚未创建。请先创建任务，或取消后关闭 App。')
              api.lifecycle.cancelClose()
              return
            }
            if (document.querySelector('.motion-presence[data-state="present"] .task-composer')) {
              setSaveError('任务表单尚未确认，请创建或取消后再关闭 App。')
              api.lifecycle.cancelClose()
              return
            }
            if (dayFileRef.current && dirtyRef.current) {
              let saved = await saveCurrentDay(saveStatusRef.current === 'conflict' ? { asConflictCopy: true } : undefined)
              if (saved && !saved.ok && saved.error.code === 'CONFLICT') saved = await saveCurrentDay({ asConflictCopy: true })
              if (!saved || !saved.ok) {
                setSaveStatus(saved?.ok === false && saved.error.code === 'CONFLICT' ? 'conflict' : 'dirty')
                setSaveError(`关闭前保存失败：${saved?.ok === false ? saved.error.message : '每日记录不可用'}。窗口已保持打开。`)
                api.lifecycle.cancelClose()
                return
              }
              continue
            }
            if (weekDirtyRef.current) {
              if (!weekContextRef.current?.current) {
                setView('progress')
                setWeekMode('plan')
                setWeekError('本周计划尚未创建。请先保存本周计划，或撤销草案修改后再关闭 App。')
                api.lifecycle.cancelClose()
                return
              }
              if (weekSaveStatusRef.current === 'conflict') {
                setView('progress')
                setWeekMode('plan')
                setWeekError('关闭前无法保存：本周计划已被外部修改。请重新载入后再关闭 App。')
                api.lifecycle.cancelClose()
                return
              }
              const saved = await saveCurrentWeekNow()
              if (!saved || !saved.ok) {
                setView('progress')
                setWeekMode('plan')
                setWeekError(`关闭前保存本周计划失败：${saved?.ok === false ? saved.error.message : '周计划不可用'}。窗口已保持打开。`)
                api.lifecycle.cancelClose()
                return
              }
              continue
            }
            await Promise.resolve()
            if (queuedDay === fileMutationTailRef.current && queuedWeek === weekMutationTailRef.current && !dirtyRef.current && !weekDirtyRef.current) break
          }
          api.lifecycle.readyToClose()
        } catch (error) {
          setSaveError(`关闭前保存失败：${error instanceof Error ? error.message : String(error)}。窗口已保持打开。`)
          api.lifecycle.cancelClose()
        }
        })()
      })
    } catch (error) {
      let mounted = true
      queueMicrotask(() => {
        if (mounted) setWatchError(`无法注册关闭保护：${error instanceof Error ? error.message : String(error)}。关闭 App 前请先等待保存状态显示为已保存。`)
      })
      return () => { mounted = false }
    }
  // The close listener is registered once and reads the current mutation/file refs.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const api = window.myWay
    if (!api || workspaceState !== 'ready') return
    let active = true
    void (async () => {
      if (view === 'calendar') {
        const monthStart = format(startOfMonth(parseISO(calendarDate)), 'yyyy-MM-dd')
        const monthEnd = format(endOfMonth(parseISO(calendarDate)), 'yyyy-MM-dd')
        const range = naturalWeekRange(calendarDate)
        const from = range.startDate < monthStart ? range.startDate : monthStart
        const to = range.endDate > monthEnd ? range.endDate : monthEnd
        const [weekResult, progressResult] = await Promise.all([api.week.load(calendarDate), api.progress.query(from, to)])
        if (!active) return
        if (!weekResult.ok) { setCalendarLoading(false); setViewError(weekResult.error.message); return }
        if (!progressResult.ok) { setCalendarLoading(false); setViewError(progressResult.error.message); return }
        setViewError('')
        setWeekDocument(weekResult.value)
        setCalendarMoves({})
        setCalendarSaveStatus('saved')
        setCalendarMonth(progressResult.value.month)
        setCalendarRecords(progressResult.value.summary.timeRecords)
        setCalendarLoading(false)
      } else if (view === 'progress') {
        const contextResult = await api.week.context(today)
        if (!active) return
        if (!contextResult.ok) { setViewError(contextResult.error.message); return }
        hydrateWeekContext(contextResult.value, { preserveDraft: weekDirtyRef.current })
        const result = await api.progress.query(contextResult.value.startDate, contextResult.value.endDate)
        if (!active) return
        if (!result.ok) { setViewError(result.error.message); return }
        setViewError('')
        setProgressData(result.value)
      } else if (view === 'route') {
        const result = await api.route.load()
        if (!active) return
        if (!result.ok) { setRouteLoading(false); setViewError(result.error.message); return }
        setViewError('')
        setRouteDocuments(result.value)
        setRouteLoading(false)
      } else if (view === 'today' && externalRefreshVersion > 0) {
        const viewedDate = activeDayDateRef.current
        const contextResult = await api.week.context(viewedDate)
        if (!active) return
        if (!contextResult.ok) { setViewError(contextResult.error.message); return }
        setViewError('')
        if (viewedDate === today) hydrateWeekContext(contextResult.value, { preserveDraft: weekDirtyRef.current })
        else {
          setActiveDayContext(contextResult.value)
          setActiveDayWeek(contextResult.value.current)
        }
      }
    })().catch((error) => {
      if (!active) return
      if (view === 'calendar') setCalendarLoading(false)
      if (view === 'route') setRouteLoading(false)
      setViewError(error instanceof Error ? error.message : String(error))
    })
    return () => { active = false }
  // View loading is keyed by the explicit navigation state; hydration reads refs for mutable drafts.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, workspaceState, today, calendarDate, externalRefreshVersion])

  const navigateCalendar = (direction: -1 | 1, mode: 'week' | 'month'): void => {
    const current = parseISO(calendarDate)
    setViewError('')
    setWeekDocument(null)
    setCalendarMonth([])
    setCalendarRecords([])
    setCalendarDate(format(mode === 'week' ? addWeeks(current, direction) : addMonths(current, direction), 'yyyy-MM-dd'))
    setCalendarMoves({})
    setCalendarSaveStatus('saved')
    setCalendarLoading(true)
  }

  const applyView = (next: View): void => {
    setViewError('')
    setSelectedTaskId(null)
    setDeleteDialogOpen(false)
    if (next === 'calendar') { setWeekDocument(null); setCalendarMoves({}); setCalendarSaveStatus('saved'); setCalendarMonth([]); setCalendarRecords([]); setCalendarLoading(true) }
    if (next === 'progress') setProgressData(null)
    if (next === 'route') { setRouteDocuments([]); setRouteLoading(true) }
    if (next !== 'today') setDayReturnView(null)
    setView(next)
  }

  const changeView = (next: View): void => {
    const navigationToken = ++viewNavigationTokenRef.current
    if (view === 'today' && dayReturnView && next !== dayReturnView) dayReturnFocusRef.current = null
    if (next === 'today' && activeDayDateRef.current !== today) {
      openDayRecord(today)
      return
    }
    if (next === view) {
      if (next === 'today') setDayReturnView(null)
      return
    }
    const saveWeekBeforeLeaving = view === 'progress' && next !== 'progress'
    if (!dirtyRef.current && !(saveWeekBeforeLeaving && weekDirtyRef.current)) {
      applyView(next)
      return
    }
    void (async () => {
      while (dirtyRef.current) {
        const saved = await saveCurrentDay()
        if (!saved || !saved.ok || viewNavigationTokenRef.current !== navigationToken) return
      }
      while (saveWeekBeforeLeaving && weekDirtyRef.current) {
        const saved = await saveCurrentWeek()
        if (!saved || !saved.ok || viewNavigationTokenRef.current !== navigationToken) return
      }
      if (viewNavigationTokenRef.current === navigationToken) applyView(next)
    })()
  }

  const openReviewedDay = (date: string, taskId?: string): void => {
    const navigationToken = ++viewNavigationTokenRef.current
    void (async () => {
      while (weekDirtyRef.current) {
        const saved = await saveCurrentWeek()
        if (!saved || !saved.ok || viewNavigationTokenRef.current !== navigationToken) return
      }
      if (viewNavigationTokenRef.current === navigationToken) openDayRecord(date, 'progress', taskId)
    })()
  }

  useEffect(() => {
    keyboardActionsRef.current = {
      ready: workspaceState === 'ready',
      view,
      hasSelectedTask: Boolean(selectedTaskId),
      returnView: dayReturnView,
      navigate: changeView,
      saveDay: () => { void saveCurrentDay() },
      saveWeek: () => { void saveCurrentWeek() },
      closeTask: closeTaskDetail
    }
  })

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      const actions = keyboardActionsRef.current
      if (!actions?.ready || event.defaultPrevented || event.repeat || event.altKey || event.shiftKey || (!event.metaKey && !event.ctrlKey)) return
      if (document.querySelector('[role="dialog"]')) return
      const key = event.key.toLowerCase()
      if (key === 's') {
        event.preventDefault()
        if (actions.view === 'progress') actions.saveWeek()
        else actions.saveDay()
        return
      }
      if (key === '[') {
        if (actions.hasSelectedTask) {
          event.preventDefault()
          actions.closeTask()
          return
        }
        if (actions.view === 'today' && actions.returnView) {
          event.preventDefault()
          actions.navigate(actions.returnView)
          return
        }
      }
      const destination = navItems.find((item) => item.shortcut === key)
      if (!destination) return
      event.preventDefault()
      actions.navigate(destination.id)
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  const moveCalendarTask = (taskId: string, targetDate: string): void => {
    const sourceTask = weekDocument?.value.plan.tasks.find((task) => task.id === taskId)
    if (!sourceTask || sourceTask.date === targetDate) return
    const requestedCalendarDate = calendarDate
    setCalendarMoves((current) => ({ ...current, [taskId]: targetDate }))
    setCalendarSaveStatus('saving')
    setViewError('')
    const api = window.myWay
    if (!api) { setCalendarSaveStatus('saved'); return }
    const clearOptimisticMove = (): void => setCalendarMoves((current) => {
      const next = { ...current }
      delete next[taskId]
      return next
    })
    const failMove = (message: string, conflict = false): void => {
      clearOptimisticMove()
      setCalendarSaveStatus(conflict ? 'conflict' : 'saved')
      setViewError(`无法移动任务：${message}`)
    }

    void enqueueWeekMutation(async () => {
      if (weekDirtyRef.current) {
        const pending = await saveCurrentWeekNow()
        if (!pending || !pending.ok) {
          failMove(pending?.ok === false ? pending.error.message : '本周草案尚未保存', pending?.ok === false && pending.error.code === 'CONFLICT')
          return
        }
      }

      const result = await persistLatestCalendarMove(api.week, requestedCalendarDate, taskId, targetDate)
      if (!result.ok) {
        failMove(result.error.message, result.error.code === 'CONFLICT')
        return
      }

      clearOptimisticMove()
      setCalendarSaveStatus('saved')
      setViewError('')
      if (calendarDateRef.current === requestedCalendarDate) setWeekDocument(result.value)

      const currentContext = weekContextRef.current
      if (currentContext && result.value.value.plan.startDate === currentContext.startDate) {
        const nextContext = { ...currentContext, current: result.value }
        setWeekContext(nextContext)
        weekContextRef.current = nextContext
        if (!weekDirtyRef.current) {
          const nextDraft = { plan: result.value.value.plan, body: result.value.value.body }
          setWeekDraft(nextDraft)
          weekDraftRef.current = nextDraft
        }
      }
      const movedPlan = result.value.value.plan
      const currentDay = dayFileRef.current
      if (movedPlan.startDate <= activeDayDateRef.current && activeDayDateRef.current <= movedPlan.endDate) setActiveDayWeek(result.value)
      if (currentDay && movedPlan.startDate <= currentDay.value.date && currentDay.value.date <= movedPlan.endDate) {
        try {
          const diff = await api.week.diff(currentDay.value.date, currentDay.value)
          if (diff.ok) setActiveDayPlanDiff(diff.value)
          else setViewError(`任务已移动，但每日差异刷新失败：${diff.error.message}`)
        } catch (error) {
          setViewError(`任务已移动，但每日差异刷新失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }
    })
  }

  const resolveFileConflict = (action: 'reload' | 'copy'): void => {
    const api = window.myWay
    if (!api || !dayFile) return
    void (async () => {
      if (action === 'copy') {
        const copied = await saveCurrentDay({ asConflictCopy: true })
        if (!copied || !copied.ok) return
      }
      dirtyRef.current = false
      await loadDayRecordNow(activeDayDateRef.current, { flushEdits: false })
    })()
  }

  const resolveWeekConflict = (action: 'reload' | 'copy'): void => {
    const api = window.myWay
    if (!api || weekConflictAction) return
    setWeekConflictAction(action)
    setWeekError(null)
    setWeekNotice(null)
    void enqueueWeekMutation(async () => {
      try {
        if (action === 'copy') {
          const draft = weekDraftRef.current
          const current = weekContextRef.current?.current
          if (!draft || !current) {
            setWeekError('当前周计划草案不可用，无法另存冲突副本。')
            return
          }
          const copied = await api.week.save({
            expectedRevision: current.revision,
            plan: draft.plan,
            body: draft.body,
            asConflictCopy: true
          })
          if (!copied.ok) {
            setWeekError(`另存冲突副本失败：${copied.error.message}`)
            return
          }
          const reloaded = await refreshPlanningContext()
          if (!reloaded) {
            setWeekNotice(`冲突草案已另存为 ${copied.value.path.split(/[\\/]/).at(-1) ?? copied.value.path}。`)
            setWeekError('当前周计划重新载入失败，请稍后重试。')
            return
          }
          setWeekNotice(`冲突草案已另存为 ${copied.value.path.split(/[\\/]/).at(-1) ?? copied.value.path}；当前周计划已重新载入。`)
          return
        }

        const reloaded = await refreshPlanningContext()
        if (!reloaded) {
          setWeekSaveStatus('conflict')
          weekSaveStatusRef.current = 'conflict'
        }
      } catch (error) {
        setWeekError(`${action === 'copy' ? '另存冲突副本' : '重新载入周计划'}失败：${error instanceof Error ? error.message : String(error)}`)
        setWeekSaveStatus('conflict')
        weekSaveStatusRef.current = 'conflict'
      } finally {
        setWeekConflictAction(null)
      }
    })
  }

  const discardWeekDraft = (): void => {
    const context = weekContextRef.current
    if (!context) return
    setWeekNotice(null)
    hydrateWeekContext(context)
  }

  const deleteSelectedTask = (): void => {
    const api = window.myWay
    if (!api || !selectedTaskId || !dayFileRef.current || deletePendingRef.current) return
    deletePendingRef.current = true
    setDeletePending(true)
    setSaveError('')
    void enqueueFileMutation(async () => {
      try {
        const saved = await saveCurrentDayNow()
        if (!saved || !saved.ok) {
          setSaveError(`删除前保存失败：${saved && !saved.ok ? saved.error.message : '每日记录不可用'}。任务没有删除。`)
          return
        }
        const currentDay = dayFileRef.current
        if (!currentDay) {
          setSaveError('删除前无法读取最新每日记录。任务没有删除。')
          return
        }
        const result = await api.task.delete({
          day: { path: currentDay.path, revision: currentDay.revision },
          taskId: selectedTaskId
        })
        if (!result.ok) {
          setSaveError(`删除失败：${result.error.message}。任务仍保留在详情中。`)
          if (result.error.code === 'CONFLICT') setSaveStatus('conflict')
          return
        }
        setSelectedTaskId(null)
        setDeleteDialogOpen(false)
        setSelectedTaskSourceState('idle')
        hydrateDay({ file: result.value.day, created: false, missingPlan })
        if (result.value.week) setActiveDayWeek(result.value.week)
        const [diff, progress] = await Promise.all([
          api.week.diff(result.value.day.value.date, result.value.day.value),
          api.progress.query(
            (result.value.week ?? activeDayWeek)?.value.plan.startDate ?? format(startOfWeek(parseISO(result.value.day.value.date), { weekStartsOn: 1 }), 'yyyy-MM-dd'),
            (result.value.week ?? activeDayWeek)?.value.plan.endDate ?? format(endOfWeek(parseISO(result.value.day.value.date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
          )
        ])
        if (diff.ok) setActiveDayPlanDiff(diff.value)
        else setViewError(diff.error.message)
        if (progress.ok) {
          if (activeDayDateRef.current === today) setProgressData(progress.value)
        } else setViewError(progress.error.message)
      } catch (error) {
        setSaveError(`删除失败：${error instanceof Error ? error.message : String(error)}。任务仍保留在详情中。`)
      } finally {
        deletePendingRef.current = false
        setDeletePending(false)
      }
    })
  }

  const selectedTask = selectedTaskId ? tasks.find((task) => task.id === selectedTaskId) ?? null : null
  const historicalDayVisible = view === 'today' && activeDayDate !== today
  const railContext = historicalDayVisible && activeDayContext ? activeDayContext : activeWeekContext
  const railTasks = view === 'today' ? tasks : todayTasksSnapshot
  const railDate = view === 'today' ? activeDayDate : today
  const railProgress = historicalDayVisible ? null : progressData
  const railLiveDay: DailyTimeSnapshot = {
    date: activeDayDate,
    tasks: tasks.map((task) => ({
      id: task.id, title: task.title, sourceTaskId: task.sourceTaskId, originalDate: task.originalDate, date: task.date, category: categoryKeys[task.category],
      plannedMinutes: task.planned, actualMinutes: task.actual, status: task.state, rescheduledMinutes: task.rescheduledMinutes
    }))
  }

  useEffect(() => {
    if (selectedTaskId && !selectedTask && workspaceState === 'ready') {
      const timer = window.setTimeout(() => {
        setSelectedTaskId(null)
        setDeleteDialogOpen(false)
        setSaveError('当前任务已在文件刷新后移除，已返回今天列表。')
      }, 0)
      return () => window.clearTimeout(timer)
    }
  }, [selectedTaskId, selectedTask, workspaceState])

  const content = useMemo(() => {
    if (view === 'timer') return <TimerView tasks={timerChoices} taskIntent={selectedTimerIntent} onTaskIntentChange={selectTimerIntent} snapshot={timerController.snapshot} sessions={timerController.sessions} elapsedSeconds={timerController.displayElapsedSeconds} remainingSeconds={timerController.displayRemainingSeconds} pendingAction={timerController.pendingAction} error={timerController.error} onStartElapsed={() => void timerController.startElapsed(validIdleIntent ?? undefined)} onStartCountdown={(minutes) => void timerController.startCountdown(minutes, validIdleIntent ?? undefined)} onPause={() => void timerController.pause()} onResume={() => void timerController.resume()} onEnd={() => void timerController.end()} onAssign={(sessionId) => void timerController.openAssignment(sessionId)} onDiscard={(sessionId) => void timerController.confirmDiscard(sessionId)} />
    if (view === 'calendar') return <CalendarView tasks={tasks} records={calendarRecords} week={weekDocument} loading={calendarLoading} moves={calendarMoves} onMove={moveCalendarTask} referenceDate={calendarDate} today={today} selectedDate={activeDayDate} monthCells={calendarMonth} openingDate={openingDayDate} onNavigate={navigateCalendar} onReturnToToday={() => { setCalendarLoading(true); setCalendarMoves({}); setWeekDocument(null); setCalendarDate(today) }} onOpenDate={(date, taskId) => openDayRecord(date, 'calendar', taskId)} />
    if (view === 'progress') return <WeekWorkspace context={activeWeekContext} draft={activeWeekDraft} dirty={weekDirty} saveStatus={weekSaveStatus} error={weekError} notice={weekNotice} mode={weekMode} onModeChange={setWeekMode} onDraftChange={updateWeekDraft} onSave={(draft) => { weekDraftRef.current = draft; void saveCurrentWeek() }} onDiscard={discardWeekDraft} onOpenDay={openReviewedDay} />
    if (view === 'route') return <RouteView documents={routeDocuments} context={activeWeekContext} loading={routeLoading} />
    if (selectedTask) return <TaskDetailView key={selectedTask.id} task={selectedTask} actualMax={1440 - tasks.filter((item) => item.id !== selectedTask.id).reduce((sum, item) => sum + item.actual, 0)} saveStatus={saveStatus} savePending={manualSavePending} onSave={saveTaskDetail} onCopy={() => startTaskComposer(selectedTask.id)} evidenceStatus={evidenceStatus} backLabel={activeDayDate === today ? '返回今天' : '返回当日'} canStartFocus={activeDayDate === today && Boolean(selectedTask.title.trim())} focusStarting={timerController.pendingAction === 'start'} timerActive={Boolean(timerController.snapshot.active)} onChange={(patch) => updateTask(selectedTask.id, patch)} onBack={closeTaskDetail} onStartFocus={() => {
      void (async () => {
        while (dirtyRef.current) {
          const saved = await saveCurrentDay()
          if (!saved || !saved.ok) return
        }
        await timerController.startElapsed({
          date: selectedTask.date,
          taskId: selectedTask.id,
          taskTitle: selectedTask.title
        })
        changeView('timer')
      })()
    }} onOpenTimer={() => changeView('timer')} onRequestDelete={() => {
      if (selectedTaskSourceState !== 'ready') {
        setSaveError(selectedTaskSourceState === 'error' ? '任务来源读取失败，暂时不能删除。' : '正在确认任务来源，请稍候。')
        return
      }
      setDeleteDialogOpen(true)
    }} onSelectEvidence={() => selectEvidence(selectedTask.id)} onReplaceEvidence={(path) => selectEvidence(selectedTask.id, path)} onRemoveEvidence={(path) => removeEvidence(selectedTask.id, path)} onOpenEvidence={openEvidence} />
    return <TodayView focusIntent={activeDayDate === today ? timerController.snapshot.active?.taskIntent ?? null : null} tasks={tasks} setTasks={updateTasks} date={activeDayDate} sourceWeek={dayFile?.value.sourceWeek ?? activeDayWeek?.value.plan.week ?? null} missingPlan={missingPlan} hasWeekPlan={Boolean(activeDayWeek)} recordExists={Boolean(dayFile) || !window.myWay} recordPending={openingDayDate === activeDayDate} evidenceStatus={evidenceStatus} notes={notes} onNotesChange={updateNotes} reflection={reflection} onReflectionChange={updateReflection} pastExams={pastExams} onPastExamsChange={updatePastExams} onSelectEvidence={selectEvidence} onOpenEvidence={openEvidence} planDiff={activeDayPlanDiff} onImportPlanTasks={importTodayPlanTasks} onAddTask={() => startTaskComposer()} onCopyTask={startTaskComposer} onOpenTask={openTaskDetail} onOpenWeekPlan={() => { setWeekMode('plan'); changeView('progress') }} onStartRecord={createActiveDayRecord} backLabel={dayReturnView === 'progress' ? '返回本周' : dayReturnView === 'calendar' ? '返回日历' : undefined} onBack={dayReturnView ? () => changeView(dayReturnView) : undefined} />
  // View callbacks intentionally close over the same render state represented in this dependency list.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, tasks, dayFile, activeDayDate, dayReturnView, activeDayWeek, missingPlan, evidenceStatus, notes, reflection, pastExams, weekDocument, calendarLoading, calendarMoves, calendarDate, calendarMonth, calendarRecords, progressData, routeDocuments, routeLoading, activeDayPlanDiff, openingDayDate, selectedTask, selectedTaskSourceState, timerController, activeWeekContext, activeWeekDraft, weekDirty, weekSaveStatus, weekError, weekNotice, weekMode, today, idleTimerIntent, todayTasksSnapshot, saveStatus, manualSavePending])

  if (workspaceState === 'loading') {
    return <div className="launch-screen"><div className="brand">My Way</div><p>正在读取本地学习工作区…</p></div>
  }

  if (workspaceState === 'missing' || workspaceState === 'error') {
    return <div className="launch-screen"><div className="brand">My Way</div><h1>{workspaceState === 'missing' ? '选择你的学习文件夹' : '无法打开工作区'}</h1><p>{workspaceState === 'missing' ? 'My Way 只会读写你选择的本地 my-way 文件夹。' : workspaceError}</p>{workspaceState === 'missing'
      ? <button onClick={() => void selectWorkspace()}>选择 my-way 文件夹</button>
      : <div className="launch-actions"><button className="primary-button" onClick={() => void retryWorkspace()}>重新读取</button><button className="secondary-button" onClick={() => void selectWorkspace()}>选择其他文件夹</button></div>}</div>
  }

  const visibleError = saveError || watchError || viewError
  const dismissVisibleError = (): void => {
    if (saveError) setSaveError('')
    else if (watchError) setWatchError('')
    else setViewError('')
  }

  return (
    <>
      {visibleError && <div className="error-bar" role="alert"><span>{visibleError}</span><button onClick={dismissVisibleError}>知道了</button></div>}
      {saveStatus === 'conflict' && <div className={`conflict-bar ${visibleError ? 'with-error' : ''}`}><span>每日文件已在 App 外部发生变化。当前编辑不会被静默覆盖。</span><button onClick={() => resolveFileConflict('reload')}>重新载入</button><button onClick={() => resolveFileConflict('copy')}>另存冲突副本</button></div>}
      {weekSaveStatus === 'conflict' && <div className={`conflict-bar ${visibleError ? 'with-error' : ''}`}><span>本周计划已在 App 外部发生变化。当前草案不会被静默覆盖。</span><button disabled={Boolean(weekConflictAction)} onClick={() => resolveWeekConflict('reload')}>{weekConflictAction === 'reload' ? '正在重新载入…' : '重新载入周计划'}</button><button disabled={Boolean(weekConflictAction)} onClick={() => resolveWeekConflict('copy')}>{weekConflictAction === 'copy' ? '正在另存…' : '另存冲突副本'}</button></div>}
      <MotionPresence>{composer && <TaskComposer key={composer.id} draft={composer.draft} kind={composer.kind} pending={composerPending} error={composerError}
        onChange={(draft) => { setComposer({ ...composer, draft }); setComposerError(null) }}
        onCancel={() => { if (!composerPendingRef.current) setComposer(null) }} onSubmit={submitTaskComposer} />}</MotionPresence>
      <MotionPresence>{deleteDialogOpen && selectedTask && <DeleteTaskDialog taskTitle={selectedTask.title} sourceWeek={selectedTaskWeek} pending={deletePending} onCancel={() => setDeleteDialogOpen(false)} onConfirm={deleteSelectedTask} />}</MotionPresence>
      <MotionPresence>{timerController.completion && <TimerCompletionDialog onAcknowledge={() => void timerController.acknowledgeCompletion()} />}</MotionPresence>
      <MotionPresence>{timerController.assignment && <TimerAssignmentDialog key={timerController.assignment.session.id} options={timerController.assignment} pending={timerController.pendingAction === 'assign'} error={timerController.error} onAssign={(taskId, minutes) => void timerController.confirmAssignment(taskId, minutes)} onDefer={timerController.deferAssignment} />}</MotionPresence>
      <p className="sr-only" aria-live="polite">{timerController.ariaAnnouncement}</p>
      <WorkspaceFrame saveStatus={view === 'progress' ? weekSaveStatus === 'conflict' ? 'conflict' : weekSaveStatus === 'saving' ? 'saving' : weekDirty ? 'dirty' : 'saved' : view === 'calendar' ? calendarSaveStatus : saveStatus}
        rail={<RightRail tasks={railTasks} date={railDate} today={today} liveDay={railLiveDay} evidenceStatus={evidenceStatus} context={railContext} progress={railProgress} onOpenEvidence={openEvidence} />}
        sidebar={<aside className="sidebar" aria-label="应用导航">
        <div className="brand">My Way</div>
        <nav className="motion-selection" aria-label="主导航"><SelectionIndicator value={`${view}-${activeDayDate}`} />{navItems.map((item) => {
          const active = view === item.id && (item.id !== 'today' || activeDayDate === today)
          return <button aria-label={item.label} aria-keyshortcuts={`Meta+${item.shortcut}`} title={`${item.label}  ⌘${item.shortcut}`} aria-current={active ? 'page' : undefined} className={active ? 'active' : ''} onClick={() => changeView(item.id)} key={item.id}><svg className="nav-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={navigationPaths[item.id]} stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" /></svg>{item.label}</button>
        })}</nav>
        {timerController.snapshot.active && <div className="timer-sidebar-entry"><TimerSidebarStatus active={timerController.snapshot.active} seconds={timerController.snapshot.active.mode === 'countdown' ? timerController.displayRemainingSeconds ?? 0 : timerController.displayElapsedSeconds} onOpen={() => changeView('timer')} /></div>}
        <div className="sidebar-bottom"><div className="workspace-chip"><i>MW</i><div><b>my-way</b><small>本地工作区</small></div></div></div>
      </aside>}>
      {content}
      {view === 'today' && activeDayDate === today && !selectedTask && carryoverFile && <CarryoverDialog sourceDate={carryoverFile.value.date} tasks={carryoverFile.value.tasks.filter(isTaskPending)} pending={carryoverPending} onResolve={handleCarryover} />}
      </WorkspaceFrame>
    </>
  )
}
