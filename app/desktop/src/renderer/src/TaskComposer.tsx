import { useEffect, useId, useRef, useState } from 'react'
import { useIsPresent } from './motion'
import { categoryLabels } from './studyTask'
import { taskDraftErrors, type TaskDraft } from './taskCreation'
import type { TaskCategory } from '../../shared/schemas'

export function TaskComposer({ draft, kind, pending, error, minDate, maxDate, withNotes = true, onChange, onCancel, onSubmit }: {
  draft: TaskDraft
  kind: 'new' | 'copy'
  pending: boolean
  error: string | null
  minDate?: string
  maxDate?: string
  withNotes?: boolean
  onChange: (draft: TaskDraft) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  const [attempted, setAttempted] = useState(false)
  const errors = taskDraftErrors(draft)
  const present = useIsPresent()
  const titleId = useId()
  const id = useId()
  const sectionRef = useRef<HTMLElement>(null)
  const titleRef = useRef<HTMLInputElement>(null)
  const callbacks = useRef({ pending, onCancel })
  useEffect(() => { callbacks.current = { pending, onCancel } }, [pending, onCancel])
  useEffect(() => {
    if (!present) return
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null
    titleRef.current?.focus()
    titleRef.current?.select()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!callbacks.current.pending) callbacks.current.onCancel()
      }
      if (event.key !== 'Tab') return
      const controls = [...(sectionRef.current?.querySelectorAll<HTMLElement>(':is(button,input,select,textarea):not(:disabled)') ?? [])]
      const first = controls[0]
      const last = controls.at(-1)
      if (!first) { event.preventDefault(); sectionRef.current?.focus() }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', keydown)
    return () => { document.removeEventListener('keydown', keydown); if (restore?.isConnected) restore.focus() }
  }, [present])
  const field = (key: keyof TaskDraft) => ({
    'aria-invalid': attempted && Boolean(errors[key]),
    'aria-describedby': attempted && errors[key] ? `${id}-${key}` : undefined
  })
  const hint = (key: keyof TaskDraft) => attempted && errors[key] ? <small className="minute-field-error" id={`${id}-${key}`}>{errors[key]}</small> : null
  const update = (key: keyof TaskDraft, value: string) => onChange({ ...draft, [key]: value })
  return <div className="modal-backdrop task-composer-backdrop">
    <section className="task-composer" ref={sectionRef} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-busy={pending} tabIndex={-1}>
      <h2 id={titleId}>{kind === 'copy' ? '复制任务' : '新建任务'}</h2>
      <form onSubmit={(event) => {
        event.preventDefault()
        setAttempted(true)
        if (!pending && Object.keys(errors).length === 0) onSubmit()
      }}>
        <fieldset disabled={pending}>
          <label className="composer-wide"><span>任务标题</span><input ref={titleRef} aria-label="任务标题" {...field('title')} value={draft.title} maxLength={300} placeholder="任务名称" onChange={(event) => update('title', event.target.value)} />{hint('title')}</label>
          <div className="composer-fields">
            <label><span>类别</span><select aria-label="任务类别" value={draft.category} onChange={(event) => onChange({ ...draft, category: event.target.value as TaskCategory })}>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label><span>日期</span><input aria-label="任务日期" type="date" min={minDate} max={maxDate} {...field('date')} value={draft.date} onChange={(event) => update('date', event.target.value)} />{hint('date')}</label>
            <label><span>计划分钟</span><input aria-label="计划分钟" type="number" inputMode="numeric" min={1} max={720} step={1} {...field('plannedMinutes')} value={draft.plannedMinutes} onChange={(event) => update('plannedMinutes', event.target.value)} />{hint('plannedMinutes')}</label>
          </div>
          <label><span>预期产物</span><input aria-label="预期产物" {...field('deliverable')} maxLength={500} value={draft.deliverable} placeholder="选填" onChange={(event) => update('deliverable', event.target.value)} />{hint('deliverable')}</label>
          {withNotes && <label><span>任务备注</span><textarea aria-label="任务备注" {...field('notes')} maxLength={50000} rows={3} value={draft.notes} placeholder="选填" onChange={(event) => update('notes', event.target.value)} />{hint('notes')}</label>}
        </fieldset>
        {error && <p className="composer-error" role="alert">{error}</p>}
        <div className="dialog-actions">
          <button type="button" disabled={pending} onClick={onCancel}>取消</button>
          <button type="submit" className="primary-button" disabled={pending}>{pending ? '正在保存…' : kind === 'copy' ? '创建副本' : '创建任务'}</button>
        </div>
      </form>
    </section>
  </div>
}
