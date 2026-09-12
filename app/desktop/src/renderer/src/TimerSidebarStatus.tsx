import { useId } from 'react'
import type { ActiveTimer } from '../../shared/timerTypes'

const clock = (seconds: number): string => {
  const safe = Math.max(0, seconds)
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  const rest = safe % 60
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
}

export function TimerSidebarStatus({ active, seconds, onOpen }: {
  active: ActiveTimer
  seconds: number
  onOpen: () => void
}) {
  const contextId = useId()
  const status = active.status === 'running' ? '计时中' : '已暂停'
  const context = active.taskIntent ? `${active.taskIntent.taskTitle}，${status}` : status
  return <button className="timer-sidebar-status" onClick={onOpen} aria-label="打开计时器" aria-describedby={contextId}>
    <i className={active.status === 'running' ? 'running' : ''} />
    <span><b>{clock(seconds)}</b><small title={active.taskIntent?.taskTitle}>{active.taskIntent?.taskTitle ?? status}</small></span>
    <span id={contextId} className="sr-only">{context}</span>
    <em>›</em>
  </button>
}

export { clock as formatTimerClock }
