import { studyTaskProgress, type TaskState } from './studyTask'

export function TaskStatusControl({ taskTitle, state, planned, actual, onChange }: { taskTitle: string; state: TaskState; planned: number; actual: number; onChange: (next: TaskState) => void }) {
  const progress = studyTaskProgress({ state, planned, actual })
  const label = { planned: '未开始', in_progress: '进行中', met: '已达标', done: '已完成', skipped: '已跳过', rescheduled: '已顺延' }
  const mark = { planned: '', in_progress: '◐', met: '✓', done: '✓', skipped: '×', rescheduled: '↗' }
  return (
    <div className="task-progress-control">
      <span role="status" className={`status status-${progress}`} aria-label={`${taskTitle}状态：${label[progress]}`} title={progress === 'met' ? '时间投入已达标，不代表知识掌握；仍可继续计时。' : undefined}>
        <span className="status-content state-content" key={progress}><span className="status-mark">{mark[progress]}</span>{label[progress]}</span>
      </span>
      {(progress === 'planned' || progress === 'in_progress') && <button className="task-status-action" aria-label={`提前完成：${taskTitle}`} onClick={() => onChange('done')}>提前完成</button>}
      {(state === 'done' || state === 'skipped') && <button className="task-status-action" aria-label={`恢复自动：${taskTitle}`} onClick={() => onChange('planned')}>恢复自动</button>}
    </div>
  )
}
