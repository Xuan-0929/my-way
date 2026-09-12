import { useLayoutEffect, useRef, useState } from 'react'

/** Decoration only: the surrounding native buttons retain focus and selection semantics. */
export function SelectionIndicator({ value }: { value: string }) {
  const indicator = useRef<HTMLSpanElement>(null)
  const [bounds, setBounds] = useState<{ x: number; y: number; width: number; height: number } | null>(null)
  useLayoutEffect(() => {
    const group = indicator.current?.parentElement
    if (!group) return
    const measure = () => {
      const selected = group.querySelector<HTMLElement>('button[aria-current="page"], button[aria-pressed="true"]')
      if (!selected) { setBounds(null); return }
      setBounds({ x: selected.offsetLeft, y: selected.offsetTop, width: selected.offsetWidth, height: selected.offsetHeight })
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(group)
    return () => observer?.disconnect()
  }, [value])
  return <span ref={indicator} aria-hidden="true" className="selection-indicator" data-ready={Boolean(bounds)} style={bounds ? { width: bounds.width, height: bounds.height, transform: `translate(${bounds.x}px, ${bounds.y}px)` } : undefined} />
}
