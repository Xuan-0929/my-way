import { formatTimerClock } from './TimerSidebarStatus'

export function TimerDial({ seconds, remainingFraction }: { seconds: number; remainingFraction: number | null }) {
  const fraction = remainingFraction === null ? null : Math.max(0, Math.min(1, remainingFraction))
  return <div className="timer-dial">
    <svg viewBox="0 0 334 334" aria-hidden="true">
      <circle className="timer-dial-track" cx="167" cy="167" r="144" fill="none" strokeWidth="3" />
      {fraction !== null && <circle className="timer-dial-progress" cx="167" cy="167" r="144" fill="none" strokeWidth="3" pathLength="100" strokeDasharray={`${fraction * 100} 100`} transform="rotate(-90 167 167)" />}
      {Array.from({ length: 60 }, (_, index) => <line key={index} x1="167" y1={index % 5 === 0 ? 10 : 14} x2="167" y2="20" transform={`rotate(${index * 6} 167 167)`} stroke="currentColor" strokeWidth={index % 5 === 0 ? 1.5 : 1} />)}
    </svg>
    <div className="timer-clock" aria-label="当前计时">{formatTimerClock(Math.max(0, seconds))}</div>
  </div>
}
