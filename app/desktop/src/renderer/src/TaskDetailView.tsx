import { categoryLabels } from './studyTask'
import { MarkdownEditor } from './MarkdownEditor'
import { TaskStatusControl } from './TaskStatusControl'
import { categoryClass, type StudyTask } from './studyTask'
import type { EvidenceInspection } from '../../shared/api'
import { MinutesInput } from './MinutesInput'
import { ActionIcon } from './ActionIcon'

export function TaskDetailView({ task, evidenceStatus, backLabel = '返回今天', actualMax = 1440, saveStatus = 'saved', savePending = false, onSave, onCopy, canStartFocus = false, focusStarting = false, timerActive = false, onChange, onBack, onRequestDelete, onStartFocus = () => undefined, onOpenTimer = () => undefined, onSelectEvidence, onReplaceEvidence, onRemoveEvidence, onOpenEvidence }: {
  task: StudyTask
  evidenceStatus: Record<string, EvidenceInspection>
  backLabel?: string
  actualMax?: number
  saveStatus?: 'saved' | 'saving' | 'dirty' | 'conflict'
  savePending?: boolean
  onSave?: (returnToDay: boolean) => void
  onCopy?: () => void
  canStartFocus?: boolean
  focusStarting?: boolean
  timerActive?: boolean
  onChange: (patch: Partial<StudyTask>) => void
  onBack: () => void
  onRequestDelete: () => void
  onStartFocus?: () => void
  onOpenTimer?: () => void
  onSelectEvidence: () => void
  onReplaceEvidence: (path: string) => void
  onRemoveEvidence: (path: string) => void
  onOpenEvidence: (path: string) => void
}) {
  return (
    <main className="workspace task-detail-view">
      <header className="task-detail-toolbar">
        <button className="back-button" aria-label={backLabel} aria-keyshortcuts="Meta+[" title={`${backLabel}  ⌘[`} onClick={onBack}><ActionIcon name="back" />{backLabel}</button>
        <div className="task-detail-actions">
          {onCopy && <button className="task-copy-button" disabled={savePending} onClick={onCopy}><ActionIcon name="copy" />复制任务</button>}
          {timerActive
            ? <button className="focus-task-button" onClick={onOpenTimer}>查看计时</button>
            : canStartFocus
              ? <button className="focus-task-button" disabled={focusStarting} onClick={onStartFocus}>{focusStarting ? '正在开始…' : '开始专注'}</button>
              : null}
          {onSave && <div className="task-save-actions">
            <button className="secondary-button" aria-keyshortcuts="Meta+S" disabled={savePending || saveStatus === 'saving'} onClick={() => onSave(false)}>保存</button>
            <button className="primary-button" disabled={savePending || saveStatus === 'saving'} onClick={() => onSave(true)}>保存并返回</button>
          </div>}
        </div>
      </header>
      {onSave && <p className="task-save-feedback" role="status">{savePending || saveStatus === 'saving' ? '正在保存…' : saveStatus === 'conflict' ? '文件冲突，修改尚未保存' : saveStatus === 'dirty' ? '待保存修改' : '已保存'}</p>}

      <section className="task-detail-heading">
        <span className={`category-mark ${categoryClass[task.category]}`}>{task.category}</span>
        <textarea aria-label="任务标题" className="task-detail-title" rows={1} maxLength={300} value={task.title} onChange={(event) => onChange({ title: event.target.value.replace(/\n/g, ' ') })} />
        <TaskStatusControl taskTitle={task.title} state={task.state} planned={task.planned} actual={task.actual} onChange={(state) => onChange({ state })} />
      </section>

      <section className="task-information" aria-label="任务信息">
      <div className="section-title-row"><h2>任务信息</h2></div>
      <section className="task-detail-meta">
        <label><span>日期</span><input aria-label="任务日期" type="date" value={task.date} onChange={(event) => onChange({ date: event.target.value })} /></label>
        <label><span>类别</span><select aria-label="任务类别" value={task.category} onChange={(event) => onChange({ category: event.target.value as StudyTask['category'] })}>{Object.values(categoryLabels).map((category) => <option key={category}>{category}</option>)}</select></label>
        <label><span>计划分钟</span><MinutesInput aria-label="计划分钟" min={1} max={720} value={task.planned} onChange={(planned) => onChange({ planned })} onDraftChange={() => onChange({})} /></label>
        <label><span>实际分钟</span><MinutesInput aria-label="实际分钟" min={0} max={actualMax} value={task.actual} onChange={(actual) => onChange({ actual })} onDraftChange={() => onChange({})} /></label>
        <label className="task-detail-deliverable"><span>预期产物</span><input aria-label="预期产物" value={task.deliverable} onChange={(event) => onChange({ deliverable: event.target.value })} placeholder="文件、练习或可验证结果" /></label>
      </section>
      </section>

      <section className="task-markdown-grid">
        <div><div className="section-title-row"><h2>任务备注</h2></div><MarkdownEditor label="任务备注" value={task.notes} onChange={(notes) => onChange({ notes })} /></div>
        <div><div className="section-title-row"><h2>学习成果</h2></div><MarkdownEditor label="学习成果" value={task.outcomes} onChange={(outcomes) => onChange({ outcomes })} /></div>
      </section>
      <section className="task-detail-evidence">
        <div className="section-title-row"><h2>学习证据</h2><button aria-label="添加证据" onClick={onSelectEvidence}>＋ 添加证据</button></div>
        {task.evidence.length ? <div className="evidence-detail-list">{task.evidence.map((path) => {
          const inspection = evidenceStatus[path]
          const unavailable = inspection?.status === 'missing' || inspection?.status === 'blocked'
          const filename = path.split('/').at(-1)
          return <div className={`evidence-detail-item evidence-${inspection?.status ?? 'checking'}`} key={path}>
            <button className="evidence-path" aria-label={`打开 ${filename}`} disabled={unavailable} title={inspection?.message} onClick={() => onOpenEvidence(path)}>{path}</button>
            {unavailable && <span className="evidence-health">{inspection?.status === 'missing' ? '文件缺失' : '路径不可用'}</span>}
            <div className="evidence-actions">
              <button aria-label={`替换 ${filename}`} onClick={() => onReplaceEvidence(path)}>替换</button>
              <button aria-label={`移除 ${filename} 引用`} onClick={() => onRemoveEvidence(path)}>移除引用</button>
            </div>
          </div>
        })}</div> : <p className="subtle">尚未关联证据文件。</p>}
      </section>
      <footer className="task-detail-footer"><button className="delete-task-button" onClick={onRequestDelete}>删除任务</button></footer>
    </main>
  )
}
