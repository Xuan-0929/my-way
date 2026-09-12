import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export type MotionMode = 'full' | 'reduced' | 'instant'
const MotionContext = createContext<MotionMode>('full')
const PresenceContext = createContext(true)
export const useMotionMode = () => useContext(MotionContext)
export const useIsPresent = () => useContext(PresenceContext)

export function MotionProvider({ children }: { children: ReactNode }) {
  const [keyboard, setKeyboard] = useState(false)
  const [reduced, setReduced] = useState(() => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)
  const mode: MotionMode = keyboard ? 'instant' : reduced ? 'reduced' : 'full'

  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const preference = () => setReduced(query?.matches ?? false)
    const pointer = () => setKeyboard(false)
    const key = () => setKeyboard(true)
    query?.addEventListener('change', preference)
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('keydown', key, true)
    return () => {
      query?.removeEventListener('change', preference)
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('keydown', key, true)
    }
  }, [])

  useLayoutEffect(() => {
    const previous = document.documentElement.dataset.motion
    document.documentElement.dataset.motion = mode
    return () => {
      if (previous === undefined) delete document.documentElement.dataset.motion
      else document.documentElement.dataset.motion = previous
    }
  }, [mode])

  return <MotionContext.Provider value={mode}>{children}</MotionContext.Provider>
}

/** Retains visuals only: focus traps and accessibility leave as soon as the dialog closes. */
export function MotionPresence({ children }: { children: ReactNode }) {
  const mode = useMotionMode()
  const present = children !== null && children !== undefined && children !== false
  const [retained, setRetained] = useState(children)
  if (present && retained !== children) setRetained(children)

  useEffect(() => {
    if (present) return
    const timer = window.setTimeout(() => setRetained(null), mode === 'instant' ? 0 : mode === 'reduced' ? 100 : 160)
    return () => window.clearTimeout(timer)
  }, [present, mode])

  const content = present ? children : mode === 'instant' ? null : retained
  if (!content) return null
  return <PresenceContext.Provider value={present}>
    <div className="motion-presence" data-state={present ? 'present' : 'exiting'} inert={!present} aria-hidden={!present || undefined}>{content}</div>
  </PresenceContext.Provider>
}

const easeOut = 'cubic-bezier(0.23, 1, 0.32, 1)'
type Position = { x: number; y: number }

/** Owns only list-row transforms; never attach to dnd-kit draggable elements. */
export function useListMotion(keys: string[]) {
  const container = useRef<HTMLDivElement>(null)
  const previous = useRef<{ signature: string; positions: Map<string, Position> } | null>(null)
  const animations = useRef(new Map<HTMLElement, Animation>())
  const mode = useMotionMode()
  const signature = JSON.stringify(keys)

  useLayoutEffect(() => {
    const elements = [...(container.current?.querySelectorAll<HTMLElement>('[data-motion-id]') ?? [])]
    const changed = previous.current !== null && previous.current.signature !== signature
    const positions = new Map<string, Position>()
    for (const element of elements) {
      const id = element.dataset.motionId!
      const position = { x: element.offsetLeft, y: element.offsetTop }
      positions.set(id, position)
      if (!changed || mode !== 'full' || !element.animate) continue
      const before = element.getBoundingClientRect()
      animations.current.get(element)?.cancel()
      animations.current.delete(element)
      const after = element.getBoundingClientRect()
      const old = previous.current?.positions.get(id)
      const x = old ? old.x - position.x + before.left - after.left : 0
      const y = old ? old.y - position.y + before.top - after.top : 6
      if (old && Math.abs(x) < 0.5 && Math.abs(y) < 0.5) continue
      const animation = element.animate([
        { transform: `translate(${x}px, ${y}px)`, ...(old ? {} : { opacity: 0 }) },
        { transform: 'translate(0px, 0px)', ...(old ? {} : { opacity: 1 }) }
      ], { duration: 180, easing: easeOut })
      animations.current.set(element, animation)
      animation.onfinish = () => { if (animations.current.get(element) === animation) animations.current.delete(element) }
    }
    for (const [element, animation] of animations.current) {
      if (!elements.includes(element) || mode !== 'full') {
        animation.cancel()
        animations.current.delete(element)
      }
    }
    previous.current = { signature, positions }
  })

  useEffect(() => {
    const active = animations.current
    return () => { for (const animation of active.values()) animation.cancel(); active.clear() }
  }, [])
  return container
}
