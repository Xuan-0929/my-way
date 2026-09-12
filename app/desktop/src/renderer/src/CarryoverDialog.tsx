import { format, parseISO } from 'date-fns'
import type { DailyTask } from '../../shared/schemas'
import { formatChineseDuration } from './displayFormat'

export type CarryoverAction = 'reschedule' | 'skip' | 'keep_overdue'
export interface CarryoverPendingAction { taskId: string; action: CarryoverAction }

const pendingLabels: Record<CarryoverAction, string> = {
  keep_overdue: '正在保留…',
  skip: '正在跳过…',
  reschedule: '正在顺延…'
}

// Native details deliberately stays non-modal: no auto-focus or keyboard trap.
export function CarryoverDialog({ sourceDate, tasks, pending, onResolve }: {
  sourceDate: string
  tasks: DailyTask[]
  pending: CarryoverPendingAction | null
  onResolve: (taskId: string, action: CarryoverAction) => void
}) {
  const sourceLabel = format(parseISO(sourceDate), 'M 月 d 日')
  return <details className="carryover-inbox" aria-busy={Boolean(pending)}>
    <summary>待处理任务 · {tasks.length} 项</summary>
    <div className="carryover-dialog">
      <p>{sourceLabel} · 不会自动顺延，可稍后再处理。</p>
      <div className="carryover-list">
        {tasks.map((task) => <article key={task.id}>
          <div className="carryover-task">
            <b>{task.title}</b>
            <span>实际 {formatChineseDuration(task.actualMinutes)} / 计划 {formatChineseDuration(task.plannedMinutes)}</span>
            <span>剩余 {formatChineseDuration(Math.max(0, task.plannedMinutes - task.actualMinutes))}</span>
          </div>
          <div className="carryover-actions">
            <button disabled={Boolean(pending)} aria-label={`保留逾期：${task.title}`} onClick={() => onResolve(task.id, 'keep_overdue')}>{pending?.taskId === task.id && pending.action === 'keep_overdue' ? pendingLabels.keep_overdue : '暂不处理'}</button>
            <button disabled={Boolean(pending)} aria-label={`跳过：${task.title}`} onClick={() => onResolve(task.id, 'skip')}>{pending?.taskId === task.id && pending.action === 'skip' ? pendingLabels.skip : '跳过'}</button>
            <button className="primary" disabled={Boolean(pending)} aria-label={`顺延到今天：${task.title}`} onClick={() => onResolve(task.id, 'reschedule')}>{pending?.taskId === task.id && pending.action === 'reschedule' ? pendingLabels.reschedule : '剩余顺延到今天'}</button>
          </div>
        </article>)}
      </div>
      <p className="carryover-note">只顺延剩余计划时间；原日实际时间、成果和证据保留在原记录。</p>
    </div>
  </details>
}
