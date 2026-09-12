export interface FocusRestoreOptions {
  selector: string
  scrollTop: number
  onStable: () => void
  maxFrames?: number
  stableFrames?: number
  schedule?: (callback: FrameRequestCallback) => number
  cancel?: (id: number) => void
}

/**
 * Restore focus after a view transition without retaining a DOM node that React
 * may replace between renders. The current matching node must remain focused
 * for consecutive frames before the restoration is considered complete.
 */
export function restoreFocusWhenStable({
  selector,
  scrollTop,
  onStable,
  maxFrames = 8,
  stableFrames = 2,
  schedule = window.requestAnimationFrame.bind(window),
  cancel = window.cancelAnimationFrame.bind(window)
}: FocusRestoreOptions): () => void {
  let cancelled = false
  let frameId: number | null = null
  let attempts = 0
  let stableCount = 0
  let previousElement: HTMLElement | null = null

  const inspect = (): void => {
    if (cancelled) return
    attempts += 1
    const element = document.querySelector<HTMLElement>(selector)

    if (!element) {
      previousElement = null
      stableCount = 0
    } else {
      if (document.activeElement !== element) element.focus({ preventScroll: true })
      const focused = document.activeElement === element
      stableCount = focused && previousElement === element ? stableCount + 1 : focused ? 1 : 0
      previousElement = element

      const workspace = element.closest<HTMLElement>('.workspace')
      if (workspace) workspace.scrollTop = scrollTop

      if (stableCount >= Math.max(1, stableFrames)) {
        frameId = null
        onStable()
        return
      }
    }

    if (attempts < Math.max(1, maxFrames)) frameId = schedule(inspect)
    else frameId = null
  }

  frameId = schedule(inspect)
  return () => {
    cancelled = true
    if (frameId !== null) cancel(frameId)
  }
}
