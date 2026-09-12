import { useEffect, useId, useRef } from 'react'
import { useIsPresent } from './motion'

export function ConfirmDialog({ title, description, confirmLabel, pending = false, pendingLabel = '正在处理…', onCancel, onConfirm }: {
  title: string
  description: string
  confirmLabel: string
  pending?: boolean
  pendingLabel?: string
  onCancel: () => void
  onConfirm: () => void
}) {
  const present = useIsPresent()
  const titleId = useId()
  const descriptionId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLElement>(null)
  const restoreFocusRef = useRef<HTMLElement | null>(null)
  const onCancelRef = useRef(onCancel)
  const pendingRef = useRef(pending)

  useEffect(() => { onCancelRef.current = onCancel }, [onCancel])
  useEffect(() => { pendingRef.current = pending }, [pending])

  useEffect(() => {
    if (!present) return
    restoreFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !pendingRef.current) onCancelRef.current()
      if (event.key !== 'Tab') return
      const buttons = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
      if (!buttons.length) {
        event.preventDefault()
        dialogRef.current?.focus()
        return
      }
      const first = buttons[0]
      const last = buttons.at(-1) as HTMLButtonElement
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

  useEffect(() => {
    if (present && pending) dialogRef.current?.focus()
  }, [pending, present])

  return <div className="modal-backdrop confirm-backdrop">
    <section ref={dialogRef} className="delete-task-dialog confirm-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId} tabIndex={-1}>
      <h2 id={titleId}>{title}</h2>
      <p id={descriptionId}>{description}</p>
      <div className="dialog-actions">
        <button ref={cancelRef} disabled={pending} onClick={onCancel}>取消</button>
        <button className="danger" disabled={pending} onClick={onConfirm}>{pending ? pendingLabel : confirmLabel}</button>
      </div>
    </section>
  </div>
}
