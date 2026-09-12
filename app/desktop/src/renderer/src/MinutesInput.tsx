import { useId, useState, type InputHTMLAttributes } from 'react'

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'min' | 'max' | 'type'> & {
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  onDraftChange?: () => void
}

/** Keep incomplete text in the editor, never in the persisted numeric task. */
export function MinutesInput({ value, min, max, onChange, onDraftChange, ...props }: Props) {
  const [draft, setDraft] = useState(String(value))
  const [seenValue, setSeenValue] = useState(value)
  if (value !== seenValue) {
    setSeenValue(value)
    setDraft(String(value))
  }
  const errorId = useId()
  const number = Number(draft)
  const valid = (draft !== '' || min === 0) && Number.isInteger(number) && number >= min && number <= max
  const message = `请输入 ${min}–${max} 的整数分钟`
  return <>
    <input {...props} data-minute-input data-minute-error={message} type="number" inputMode="numeric"
      min={min} max={max} step="1" required={min > 0} value={draft}
      aria-invalid={!valid || props['aria-invalid'] || false}
      aria-describedby={!valid ? errorId : props['aria-describedby']}
      onChange={(event) => {
        const text = event.target.value
        setDraft(text)
        const next = Number(text)
        if ((text !== '' || min === 0) && Number.isInteger(next) && next >= min && next <= max) onChange(next)
        else onDraftChange?.()
      }} />
    {!valid && <small className="minute-field-error" id={errorId}>{message}</small>}
  </>
}

/** Scoped so an unsaved weekly/editor modal cannot block an unrelated daily write. */
export function minuteInputError(scope: string): string | null {
  const roots = document.querySelectorAll(scope)
  for (const root of roots) {
    const input = root.querySelector<HTMLInputElement>('input[data-minute-input]:invalid')
    if (input) return `${input.getAttribute('aria-label') ?? '时长'}：${input.dataset.minuteError}`
  }
  return null
}
