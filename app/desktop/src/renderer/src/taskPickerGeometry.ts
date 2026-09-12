export interface PickerAnchor { left: number; top: number; bottom: number; width: number }

export function taskPickerGeometry(rect: PickerAnchor, viewportWidth: number, viewportHeight: number, contentHeight: number) {
  const edge = 12
  const gap = 8
  const width = Math.min(Math.max(336, rect.width), Math.max(0, viewportWidth - edge * 2))
  const below = Math.max(0, viewportHeight - rect.bottom - gap - edge)
  const above = Math.max(0, rect.top - gap - edge)
  const side = below >= Math.min(240, contentHeight) || below >= above ? 'bottom' : 'top'
  const maxHeight = Math.min(400, contentHeight, side === 'bottom' ? below : above)
  const left = Math.max(edge, Math.min(rect.left, viewportWidth - width - edge))
  return {
    left,
    top: side === 'bottom' ? rect.bottom + gap : rect.top - gap - maxHeight,
    width, maxHeight, side,
    originX: Math.max(0, Math.min(width, rect.left + rect.width / 2 - left))
  }
}
