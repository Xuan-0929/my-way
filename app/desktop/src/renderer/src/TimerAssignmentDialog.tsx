import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useIsPresent } from './motion'
import type { TimerAssignmentOptions } from '../../shared/timerTypes'
import { formatChineseDuration } from './displayFormat'
import { formatTimerClock } from './TimerSidebarStatus'

export function TimerAssignmentDialog({ options, pending, error, onAssign, onDefer }: {
  options: TimerAssignmentOptions
  pending: boolean
  error: string | null
  onAssign: (taskId: string, minutes: number) => void
  onDefer: () => void
}) {
  const proposal = Math.max(1, Math.round(options.session.durationSeconds / 60))
  const preferredTaskId = options.tasks.some((task) => task.id === options.session.taskIntent?.taskId)
    ? (options.session.taskIntent?.taskId ?? '')
    : (options.tasks[0]?.id ?? '')
  const [taskId, setTaskId] = useState(preferredTaskId)
  const [minutes, setMinutes] = useState(proposal)
  const dialogRef = useRef<HTMLElement>(null)
  const deferRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const present = useIsPresent()
  const titleId = useId()
  const contextId = useId()
  const durationId = useId()
  const validationId = useId()
  const pendingRef = useRef(pending)
  const onDeferRef = useRef(onDefer)
  const task = options.tasks.find((candidate) => candidate.id === taskId)
  const validation = useMemo(() => {
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) return '请输入 1–1440 的整数分钟'
    if (task && task.actualMinutes + minutes > 1440) return '该任务计入后会超过 1440 分钟'
    if (options.tasks.reduce((sum, candidate) => sum + candidate.actualMinutes, 0) + minutes > 1440) return '该日累计计入后会超过 1440 分钟'
    return ''
  }, [minutes, options.tasks, task])

  useEffect(() => { pendingRef.current = pending }, [pending])
  useEffect(() => { onDeferRef.current = onDefer }, [onDefer])

  useEffect(() => {
    if (!present) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    deferRef.current?.focus()
    const keydown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pendingRef.current) onDeferRef.current()
      if (event.key !== 'Tab') return
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled),input:not(:disabled)') ?? [])]
      const first = controls[0]
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); restoreRef.current?.focus() }
  }, [present])

  useEffect(() => {
    if (present && pending) dialogRef.current?.focus()
  }, [pending, present])

  return <div className="modal-backdrop timer-backdrop">
    <section ref={dialogRef} className="timer-assignment-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${contextId} ${durationId}`} aria-busy={pending} tabIndex={-1}>
      <p id={contextId} className="dialog-context">{options.date}</p>
      <h2 id={titleId}>学习时长分配</h2>
      <div id={durationId} className="assignment-duration"><strong>{formatTimerClock(options.session.durationSeconds)}</strong><span>实际计时</span></div>
      {options.tasks.length ? <>
        <label>任务<select value={taskId} disabled={pending} aria-invalid={Boolean(validation)} aria-describedby={validation ? validationId : undefined} onChange={(event) => setTaskId(event.target.value)}>{options.tasks.map((item) => <option value={item.id} key={item.id}>{item.title} · 已记 {formatChineseDuration(item.actualMinutes)}</option>)}</select></label>
        <label>计入分钟<input aria-label="计入分钟" type="number" min="1" max="1440" value={minutes} disabled={pending} aria-invalid={Boolean(validation)} aria-describedby={validation ? validationId : undefined} onChange={(event) => setMinutes(Number(event.target.value))} /></label>
        {validation && <p id={validationId} className="timer-field-error" role="alert">{validation}</p>}
      </> : <p className="timer-empty">{options.date} 没有可分配的任务。可以暂不分配，稍后补好当天任务再回来。</p>}
      {error && <p className="timer-field-error" role="alert">{error}</p>}
      <div className="dialog-actions">
        <button ref={deferRef} disabled={pending} onClick={onDefer}>暂不分配</button>
        <button className="timer-primary" disabled={pending || !taskId || Boolean(validation)} onClick={() => onAssign(taskId, minutes)}>{pending ? '正在分配…' : '分配到任务'}</button>
      </div>
    </section>
  </div>
}
