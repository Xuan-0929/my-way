import { useEffect, useId, useRef } from 'react'
import { useIsPresent } from './motion'

export function TimerCompletionDialog({ onAcknowledge }: { onAcknowledge: () => void }) {
  const buttonRef = useRef<HTMLButtonElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)
  const present = useIsPresent()
  const titleId = useId()
  const descriptionId = useId()
  useEffect(() => {
    if (!present) return
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    buttonRef.current?.focus()
    const keepFocus = (event: KeyboardEvent): void => {
      if (event.key === 'Tab') {
        event.preventDefault()
        buttonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', keepFocus)
    return () => {
      document.removeEventListener('keydown', keepFocus)
      restoreRef.current?.focus()
    }
  }, [present])
  return <div className="modal-backdrop timer-backdrop">
    <section className="timer-completion-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={descriptionId}>
      <h2 id={titleId}>学习时段完成</h2>
      <p id={descriptionId}>计时已停在准确的结束时刻。接下来把时长记到对应任务。</p>
      <button ref={buttonRef} onClick={onAcknowledge}>记录学习成果</button>
    </section>
  </div>
}
