import { useEffect, useId, useRef, useState } from 'react'
import { MotionPresence, useIsPresent } from './motion'
import { format, parseISO } from 'date-fns'
import type { PastExam } from '../../shared/schemas'

interface ExamDraft {
  date: string
  subject: string
  paper: string
  score: string
  maxScore: string
}

const toDraft = (date: string, exam?: PastExam): ExamDraft => ({
  date: exam?.date ?? date,
  subject: exam?.subject ?? '',
  paper: exam?.paper ?? '',
  score: exam ? String(exam.score) : '',
  maxScore: exam ? String(exam.maxScore) : '100'
})

interface ExamValidationError {
  field?: keyof ExamDraft
  message: string
}

const validateDraft = (draft: ExamDraft): { value?: Omit<PastExam, 'id'>; error?: ExamValidationError } => {
  const parsedDate = parseISO(draft.date)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date) || Number.isNaN(parsedDate.valueOf()) || format(parsedDate, 'yyyy-MM-dd') !== draft.date) return { error: { field: 'date', message: '请选择有效日期。' } }
  if (!draft.subject.trim()) return { error: { field: 'subject', message: '请填写科目。' } }
  if (!draft.paper.trim()) return { error: { field: 'paper', message: '请填写试卷名称或年份。' } }
  const score = Number(draft.score)
  const maxScore = Number(draft.maxScore)
  if (draft.score.trim() === '' || !Number.isFinite(score) || score < 0) return { error: { field: 'score', message: '得分必须是大于或等于 0 的数字。' } }
  if (draft.maxScore.trim() === '' || !Number.isFinite(maxScore) || maxScore <= 0) return { error: { field: 'maxScore', message: '满分必须是大于 0 的数字。' } }
  if (score > maxScore) return { error: { field: 'score', message: '成绩不能超过满分。' } }
  return { value: { date: draft.date, subject: draft.subject.trim(), paper: draft.paper.trim(), score, maxScore } }
}

function PastExamDialog({ date, exam, onCancel, onSave, onDelete }: {
  date: string
  exam?: PastExam
  onCancel: () => void
  onSave: (value: PastExam) => void
  onDelete: () => void
}) {
  const [draft, setDraft] = useState(() => toDraft(date, exam))
  const [error, setError] = useState<ExamValidationError | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const present = useIsPresent()
  const titleId = useId()
  const descriptionId = useId()
  const errorId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const firstInputRef = useRef<HTMLInputElement>(null)
  const subjectInputRef = useRef<HTMLInputElement>(null)
  const paperInputRef = useRef<HTMLInputElement>(null)
  const scoreInputRef = useRef<HTMLInputElement>(null)
  const maxScoreInputRef = useRef<HTMLInputElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const onCancelRef = useRef(onCancel)

  useEffect(() => { onCancelRef.current = onCancel }, [onCancel])
  useEffect(() => {
    if (!present) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    firstInputRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      if (event.key !== 'Tab') return
      const controls = [...(dialogRef.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? [])]
      if (!controls.length) return
      const first = controls[0]
      const last = controls.at(-1) as HTMLElement
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      restoreFocusRef.current?.focus()
    }
  }, [present])

  const setField = <Key extends keyof ExamDraft>(field: Key, value: ExamDraft[Key]): void => {
    setDraft((current) => ({ ...current, [field]: value }))
    setError(null)
    setConfirmDelete(false)
  }

  const submit = (): void => {
    const validated = validateDraft(draft)
    if (!validated.value) {
      const nextError = validated.error ?? { message: '记录内容无效。' }
      setError(nextError)
      const target = nextError.field === 'date' ? firstInputRef
        : nextError.field === 'subject' ? subjectInputRef
          : nextError.field === 'paper' ? paperInputRef
            : nextError.field === 'score' ? scoreInputRef
              : nextError.field === 'maxScore' ? maxScoreInputRef
                : null
      target?.current?.focus()
      return
    }
    const id = exam?.id ?? `past-exam-${draft.date}-${globalThis.crypto?.randomUUID?.() ?? Date.now().toString(36)}`
    onSave({ id, ...validated.value })
  }

  return <div className="modal-backdrop past-exam-backdrop">
    <section ref={dialogRef} className="past-exam-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      <header>
        <div>
          <h2 id={titleId}>{exam ? '编辑过去问记录' : '新增过去问记录'}</h2>
          <p id={descriptionId}>科目、试卷与成绩会保存到当天学习记录。</p>
        </div>
      </header>
      <form onSubmit={(event) => { event.preventDefault(); submit() }}>
        <div className="past-exam-form">
          <label><span>日期</span><input ref={firstInputRef} type="date" value={draft.date} aria-invalid={error?.field === 'date'} aria-describedby={error?.field === 'date' ? errorId : undefined} onChange={(event) => setField('date', event.target.value)} /></label>
          <label><span>科目</span><input ref={subjectInputRef} aria-label="科目" maxLength={100} value={draft.subject} placeholder="数学 / 专业基础" aria-invalid={error?.field === 'subject'} aria-describedby={error?.field === 'subject' ? errorId : undefined} onChange={(event) => setField('subject', event.target.value)} /></label>
          <label className="past-exam-paper"><span>试卷</span><input ref={paperInputRef} aria-label="试卷" maxLength={300} value={draft.paper} placeholder="例如：2025 数学模拟卷" aria-invalid={error?.field === 'paper'} aria-describedby={error?.field === 'paper' ? errorId : undefined} onChange={(event) => setField('paper', event.target.value)} /></label>
          <label><span>得分</span><input ref={scoreInputRef} aria-label="得分" type="number" min="0" step="any" inputMode="decimal" value={draft.score} placeholder="0" aria-invalid={error?.field === 'score'} aria-describedby={error?.field === 'score' ? errorId : undefined} onChange={(event) => setField('score', event.target.value)} /></label>
          <label><span>满分</span><input ref={maxScoreInputRef} aria-label="满分" type="number" min="0.01" step="any" inputMode="decimal" value={draft.maxScore} aria-invalid={error?.field === 'maxScore'} aria-describedby={error?.field === 'maxScore' ? errorId : undefined} onChange={(event) => setField('maxScore', event.target.value)} /></label>
        </div>
        {error && <p id={errorId} className="past-exam-error" role="alert">{error.message}</p>}
        {confirmDelete && <div className="past-exam-delete-confirm" role="alert"><span>删除这条过去问记录？</span><button type="button" onClick={() => setConfirmDelete(false)}>取消删除</button><button type="button" className="danger" onClick={onDelete}>确认删除</button></div>}
        <footer className="past-exam-dialog-actions">
          {exam && !confirmDelete && <button type="button" className="past-exam-delete" onClick={() => setConfirmDelete(true)}>删除记录</button>}
          <span />
          <button type="button" onClick={onCancel}>取消</button>
          <button type="submit" className="primary-button">保存记录</button>
        </footer>
      </form>
    </section>
  </div>
}

export function PastExamSection({ date, exams, onChange }: {
  date: string
  exams: PastExam[]
  onChange: (exams: PastExam[]) => void
}) {
  const [editingId, setEditingId] = useState<string | 'new' | null>(null)
  const editingExam = editingId && editingId !== 'new' ? exams.find((exam) => exam.id === editingId) : undefined

  const close = (): void => setEditingId(null)
  const save = (value: PastExam): void => {
    onChange(editingId === 'new' ? [...exams, value] : exams.map((exam) => exam.id === value.id ? value : exam))
    close()
  }
  const remove = (): void => {
    if (!editingExam) return
    onChange(exams.filter((exam) => exam.id !== editingExam.id))
    close()
  }

  return <section className="past-exam-section reveal reveal-4">
    <div className="section-title-row">
      <div><h2>过去问记录</h2><span>{exams.length ? `${exams.length} 份成绩` : '成绩与试卷记录'}</span></div>
      <button className="secondary-button" onClick={() => setEditingId('new')}>添加过去问记录</button>
    </div>
    {exams.length ? <div className="past-exam-list">{exams.map((exam) => <article key={exam.id}>
      <time dateTime={exam.date}>{format(parseISO(exam.date), 'M 月 d 日')}</time>
      <div><strong>{exam.subject}</strong><span>{exam.paper}</span></div>
      <b>{exam.score} / {exam.maxScore}</b>
      <button aria-label={`编辑过去问记录：${exam.subject} · ${exam.paper}`} onClick={() => setEditingId(exam.id)}>编辑</button>
    </article>)}</div> : <p className="past-exam-empty">尚无记录。完成一份过去问后，在这里留下成绩基线。</p>}
    <MotionPresence>{editingId && <PastExamDialog key={editingId} date={date} exam={editingExam} onCancel={close} onSave={save} onDelete={remove} />}</MotionPresence>
  </section>
}
