import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { TimerTaskIntent } from '../../shared/timerTypes'
import type { StudyTask } from './studyTask'
import { MotionPresence, useIsPresent } from './motion'
import { taskPickerGeometry, type PickerAnchor } from './taskPickerGeometry'

interface Choice { id: string; title: string; metadata: string; intent: TimerTaskIntent | null }
interface PickerProps {
  tasks: StudyTask[]
  value: TimerTaskIntent | null
  disabled: boolean
  onChange: (intent: TimerTaskIntent | null) => void
}

function TaskMenu({ choices, selected, active, listId, menuRef, style, side, onActive, onChoose }: {
  choices: Choice[]; selected: number; active: number; listId: string
  menuRef: RefObject<HTMLDivElement | null>; style: CSSProperties; side?: string
  onActive: (index: number) => void; onChoose: (index: number) => void
}) {
  const present = useIsPresent()
  return <div ref={menuRef} className="timer-task-menu" id={listId} role="listbox" aria-label="今日任务" style={style} data-side={side}>
    {choices.map((choice, index) => <div id={`${listId}-${index}`} role="option" key={choice.id}
      aria-selected={selected === index} data-active={active === index} className="timer-task-option"
      onPointerMove={() => { if (present) onActive(index) }}
      onPointerDown={event => event.preventDefault()}
      onClick={() => { if (present) onChoose(index) }}>
      <span className="timer-task-copy"><strong>{choice.title}</strong>{choice.metadata && <small>{choice.metadata}</small>}</span>
      {selected === index && <span className="task-picker-check" aria-hidden="true">✓</span>}
    </div>)}
    {choices.length === 1 && <p className="task-picker-empty">今日暂无可关联任务</p>}
  </div>
}

export function TimerTaskPicker({ tasks, value, disabled, onChange }: PickerProps) {
  const listId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const anchor = useRef<PickerAnchor | null>(null)
  const typeahead = useRef({ text: '', at: 0 })
  const choices = useMemo<Choice[]>(() => [
    { id: '', title: '不关联任务', metadata: '', intent: null },
    ...tasks.map(task => ({
      id: task.id, title: task.title, metadata: `${task.category} · ${task.planned} 分钟`,
      intent: { date: task.date, taskId: task.id, taskTitle: task.title }
    }))
  ], [tasks])
  const signature = JSON.stringify(choices)
  const [selection, setSelection] = useState<{ signature: string; index: number } | null>(null)
  const [geometry, setGeometry] = useState<ReturnType<typeof taskPickerGeometry> | null>(null)
  const open = selection !== null && !disabled && selection.signature === signature
  if (selection !== null && !open) setSelection(null)
  const activeIndex = selection?.index ?? 0
  const selectedIndex = choices.findIndex(choice => choice.id === (value?.taskId ?? '') && (!value || choice.intent?.date === value.date))
  const unavailable = value !== null && selectedIndex < 0

  const close = useCallback((restoreFocus = false): void => {
    setSelection(null)
    typeahead.current = { text: '', at: 0 }
    if (restoreFocus) triggerRef.current?.focus({ preventScroll: true })
  }, [])
  const show = (): void => {
    if (disabled) return
    anchor.current = triggerRef.current?.getBoundingClientRect() ?? null
    setGeometry(null)
    setSelection({ signature, index: Math.max(0, selectedIndex) })
  }
  const choose = (index: number): void => {
    if (!open || disabled || !choices[index]) return
    onChange(choices[index].intent)
    close(true)
  }
  const setActiveIndex = (index: number): void => setSelection(current => current ? { ...current, index } : null)
  const position = useCallback((): void => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const rect = trigger.getBoundingClientRect()
    anchor.current = rect
    const width = Math.min(Math.max(336, rect.width), window.innerWidth - 24)
    menu.style.width = `${width}px`
    setGeometry(taskPickerGeometry(rect, window.innerWidth, window.innerHeight, menu.scrollHeight + 2))
  }, [])

  useLayoutEffect(() => { if (open) position() }, [open, position])
  useLayoutEffect(() => {
    if (!open) return
    const menu = menuRef.current
    const option = menu?.querySelector<HTMLElement>(`[id="${listId}-${activeIndex}"]`)
    if (!menu || !option) return
    if (option.offsetTop < menu.scrollTop) menu.scrollTop = option.offsetTop
    else if (option.offsetTop + option.offsetHeight > menu.scrollTop + menu.clientHeight) {
      menu.scrollTop = option.offsetTop + option.offsetHeight - menu.clientHeight
    }
  }, [open, activeIndex, listId])

  useEffect(() => {
    if (!open) return
    const outside = (event: PointerEvent): void => {
      const target = event.target as Node
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) close()
    }
    const scroll = (event: Event): void => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return
      const rect = triggerRef.current?.getBoundingClientRect()
      const previous = anchor.current
      if (!rect || !previous || Math.abs(rect.top - previous.top) > .5 || Math.abs(rect.left - previous.left) > .5) close()
    }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', position)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(position)
    if (triggerRef.current) observer?.observe(triggerRef.current)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', position)
      observer?.disconnect()
    }
  }, [open, close, position])

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (disabled) return
    if (event.key === 'Tab') { close(); return }
    if (event.key === 'Escape') { if (open) { event.preventDefault(); event.stopPropagation(); close(true) }; return }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault()
      const current = open ? activeIndex : Math.max(0, selectedIndex)
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
        : Math.max(0, Math.min(choices.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))
      if (!open) show()
      setSelection({ signature, index })
      return
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      if (open) choose(activeIndex)
      else show()
      return
    }
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      const now = Date.now()
      const text = (now - typeahead.current.at < 650 ? typeahead.current.text : '') + event.key.toLocaleLowerCase()
      typeahead.current = { text, at: now }
      if (!open) show()
      const index = choices.findIndex(choice => choice.title.toLocaleLowerCase().startsWith(text) || choice.metadata.toLocaleLowerCase().startsWith(text))
      if (index >= 0) setSelection({ signature, index })
    }
  }
  const menuStyle = geometry
    ? { left: geometry.left, top: geometry.top, width: geometry.width, maxHeight: geometry.maxHeight, '--picker-origin-x': `${geometry.originX}px` } as CSSProperties
    : { visibility: 'hidden', left: 0, top: 0 } as CSSProperties

  return <>
    <button ref={triggerRef} type="button" className="timer-task-trigger" role="combobox"
      aria-label="关联任务" aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? listId : undefined}
      aria-activedescendant={open ? `${listId}-${activeIndex}` : undefined} disabled={disabled}
      onClick={() => open ? close() : show()} onKeyDown={handleKeyDown}>
      <svg className="task-picker-symbol" width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="3" y="2.5" width="14" height="15" rx="4" stroke="currentColor" strokeWidth="1.5" /><path d="M7 7h6M7 11h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
      <span className="task-picker-label" title={value?.taskTitle}>{value?.taskTitle ?? '不关联任务'}</span>
      {unavailable && <span className="task-picker-unavailable">任务不可用</span>}
      <svg className="task-picker-chevron" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m4 6 4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
    </button>
    {createPortal(<MotionPresence>{open && <TaskMenu choices={choices} selected={selectedIndex} active={activeIndex} listId={listId}
      menuRef={menuRef} style={menuStyle} side={geometry?.side} onActive={setActiveIndex} onChoose={choose} />}</MotionPresence>, document.body)}
  </>
}
