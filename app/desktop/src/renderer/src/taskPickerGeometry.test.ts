import { describe, expect, it } from 'vitest'
import { taskPickerGeometry } from './taskPickerGeometry'
describe('task picker positioning', () => {
  it('clamps to the right edge and flips above a low trigger', () => {
    expect(taskPickerGeometry({ left: 1160, top: 700, bottom: 740, width: 300 }, 1280, 800, 400))
      .toMatchObject({ left: 932, top: 292, width: 336, maxHeight: 400, side: 'top' })
  })
  it('anchors a short menu tightly above its trigger', () => {
    expect(taskPickerGeometry({ left: 50, top: 700, bottom: 740, width: 250 }, 1280, 800, 130))
      .toMatchObject({ left: 50, top: 562, maxHeight: 130, side: 'top' })
  })
  it('positions below when space is available and constrains a narrow viewport', () => {
    expect(taskPickerGeometry({ left: 30, top: 50, bottom: 90, width: 250 }, 320, 600, 200))
      .toMatchObject({ left: 12, top: 98, width: 296, maxHeight: 200, side: 'bottom' })
  })
})
