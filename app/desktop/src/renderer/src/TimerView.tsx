import { MotionPresence, useListMotion } from './motion'
import { SelectionIndicator } from './SelectionIndicator'
import { useState } from 'react'
import { format } from 'date-fns'
import type { TimerListResult, TimerSnapshot, TimerTaskIntent } from '../../shared/timerTypes'
import { formatTimerClock } from './TimerSidebarStatus'
import { ConfirmDialog } from './ConfirmDialog'
import { TimerDial } from './TimerDial'
import { TimerTaskPicker } from './TimerTaskPicker'
import type { StudyTask } from './studyTask'

const pauseReason = {
  user: '手动暂停', app_close: '关闭 App 时自动暂停', system_suspend: '电脑睡眠时自动暂停', recovered_after_interruption: '异常退出后已安全暂停'
} as const

const sessionActionLabel = (action: string, session: { startedAt: string; durationSeconds: number }): string =>
  `${action} ${format(new Date(session.startedAt), 'yyyy-MM-dd HH:mm')} 的 ${formatTimerClock(session.durationSeconds)} 计时记录`

export function TimerView({ snapshot, sessions, elapsedSeconds, remainingSeconds, pendingAction, error, tasks, taskIntent, onTaskIntentChange, onStartElapsed, onStartCountdown, onPause, onResume, onEnd, onAssign, onDiscard }: {
  tasks: StudyTask[]
  taskIntent: TimerTaskIntent | null
  onTaskIntentChange: (intent: TimerTaskIntent | null) => void
  snapshot: TimerSnapshot
  sessions: TimerListResult
  elapsedSeconds: number
  remainingSeconds: number | null
  pendingAction: string | null
  error: string | null
  onStartElapsed: () => void
  onStartCountdown: (minutes: number) => void
  onPause: () => void
  onResume: () => void
  onEnd: () => void
  onAssign: (sessionId: string) => void
  onDiscard: (sessionId: string) => void
}) {
  const [mode, setMode] = useState<'elapsed' | 'countdown'>('elapsed')
  const [minuteDraft, setMinuteDraft] = useState('25')
  const minutes = Number(minuteDraft)
  const [discardSessionId, setDiscardSessionId] = useState<string | null>(null)
  const active = snapshot.active
  const discardSession = discardSessionId ? sessions.pending.find((session) => session.id === discardSessionId) ?? null : null
  const todaySessionIds = new Set(sessions.today.map((session) => session.id))
  const crossDatePending = sessions.pending.filter((session) => !todaySessionIds.has(session.id))
  const ledgerRef = useListMotion([...sessions.today, ...crossDatePending].map((session) => session.id))
  const todayDurationSeconds = sessions.today.reduce((total, session) => total + session.durationSeconds, 0)
  const selectedMode = active?.mode ?? mode
  const display = active ? active.mode === 'countdown' ? remainingSeconds ?? 0 : elapsedSeconds
    : snapshot.completion || mode === 'elapsed' ? 0 : Number.isInteger(minutes) && minutes >= 1 && minutes <= 180 ? minutes * 60 : 0
  const remainingFraction = active?.mode === 'countdown' ? (remainingSeconds ?? 0) / active.targetSeconds
    : !active && mode === 'countdown' ? snapshot.completion ? 0 : 1 : null
  const invalid = !Number.isInteger(minutes) || minutes < 1 || minutes > 180
  const disabled = Boolean(pendingAction || snapshot.readOnlyError)
  return <>
  <main className="workspace timer-view">
    <header className="page-header"><h1>计时器</h1></header>
    {error && <div className="inline-notice timer-error" role="alert">{error}</div>}
    <section className={`timer-console${active ? ' active-timer' : ''}`}>
      <div className="timer-mode-switch motion-selection" role="group" aria-label="计时模式"><SelectionIndicator value={selectedMode} /><button disabled={Boolean(active) || disabled} className={selectedMode === 'countdown' ? 'active' : ''} aria-pressed={selectedMode === 'countdown'} onClick={() => setMode('countdown')}>倒计时</button><button disabled={Boolean(active) || disabled} className={selectedMode === 'elapsed' ? 'active' : ''} aria-pressed={selectedMode === 'elapsed'} onClick={() => setMode('elapsed')}>自由计时</button></div>
      <TimerTaskPicker tasks={tasks} value={taskIntent} disabled={disabled || Boolean(snapshot.completion)} onChange={onTaskIntentChange} />
      <TimerDial seconds={display} remainingFraction={remainingFraction} />
      {active ? <>
      <p className="timer-state-label" key={active.status}>{active.status === 'running' ? '正在专注' : '计时已暂停'}</p>
      {active.status === 'paused' && <p className="timer-pause-reason">{pauseReason[active.pauseReason]}</p>}
      <div className="timer-actions"><button disabled={disabled} onClick={active.status === 'running' ? onPause : onResume}><span className="state-content" key={active.status}>{active.status === 'running' ? '暂停' : '继续'}</span></button><button className="timer-end" disabled={disabled} onClick={onEnd}>结束并分配</button></div>
      </> : <>
      {mode === 'countdown' && <div className="timer-presets" role="group" aria-label="倒计时设置"><button disabled={disabled} className={minutes === 25 ? 'active' : ''} aria-pressed={minutes === 25} onClick={() => setMinuteDraft('25')}>25 分钟</button><button disabled={disabled} className={minutes === 50 ? 'active' : ''} aria-pressed={minutes === 50} onClick={() => setMinuteDraft('50')}>50 分钟</button><label>自定义 <input aria-label="自定义倒计时分钟" aria-invalid={invalid} aria-describedby={invalid ? 'countdown-error' : undefined} disabled={disabled} type="number" inputMode="numeric" min="1" max="180" step="1" value={minuteDraft} onChange={(event) => setMinuteDraft(event.target.value)} /> 分钟</label>{invalid && <small id="countdown-error" role="alert">请输入 1–180 的整数分钟</small>}</div>}
      <button className="timer-start" disabled={disabled || Boolean(snapshot.completion) || (mode === 'countdown' && invalid)} onClick={() => mode === 'elapsed' ? onStartElapsed() : onStartCountdown(minutes)}>开始</button>
      </>}
    </section>
    <div ref={ledgerRef} className="timer-ledgers">
    <section className="timer-ledger"><div className="section-title-row"><h2>今日记录</h2><span>{sessions.today.length ? `${sessions.today.length} 段 · ${formatTimerClock(todayDurationSeconds)}` : '0 段'}</span></div>{sessions.today.length ? sessions.today.map((session) => <article key={session.id} data-motion-id={session.id}><time>{new Date(session.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time><b>{formatTimerClock(session.durationSeconds)}</b><span title={session.status === 'assigned' ? session.assignment.taskTitle : session.taskIntent?.taskTitle}>{session.status === 'assigned' ? session.assignment.taskTitle : session.taskIntent?.taskTitle ?? '待分配'}</span>{session.status === 'pending' && <><button aria-label={sessionActionLabel('分配', session)} disabled={disabled} onClick={() => onAssign(session.id)}>分配</button><button className="quiet-danger" aria-label={sessionActionLabel('丢弃', session)} disabled={disabled} onClick={() => setDiscardSessionId(session.id)}>丢弃</button></>}</article>) : <p className="timer-empty">今天还没有计时记录。</p>}</section>
    {crossDatePending.length > 0 && <section className="timer-ledger"><div className="section-title-row"><h2>跨日待分配</h2><span>{crossDatePending.length} 段</span></div>{crossDatePending.map((session) => <article key={session.id} data-motion-id={session.id}><time dateTime={session.endedAt}>{format(new Date(session.endedAt), 'yyyy-MM-dd')}</time><b>{formatTimerClock(session.durationSeconds)}</b><span title={session.taskIntent?.taskTitle}>{session.taskIntent?.taskTitle ?? '尚未计入任务'}</span><button aria-label={sessionActionLabel('稍后分配', session)} disabled={disabled} onClick={() => onAssign(session.id)}>分配</button><button className="quiet-danger" aria-label={sessionActionLabel('丢弃', session)} disabled={disabled} onClick={() => setDiscardSessionId(session.id)}>丢弃</button></article>)}</section>}
    </div>
  </main>
  <MotionPresence>{discardSession && <ConfirmDialog title="丢弃这段计时？" description="该记录尚未分配，丢弃后无法恢复。" confirmLabel="确认丢弃" pendingLabel="正在丢弃…" pending={pendingAction === 'discard'} onCancel={() => setDiscardSessionId(null)} onConfirm={() => onDiscard(discardSession.id)} />}</MotionPresence>
  </>
}
