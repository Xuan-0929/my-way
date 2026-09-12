import { describe, expect, it } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { applicationMenuTemplate } from './applicationMenu'

const flatten = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => items.flatMap((item) => {
  const children = Array.isArray(item.submenu) ? flatten(item.submenu) : []
  return [item, ...children]
})

describe('applicationMenuTemplate', () => {
  it.each([
    [true, 'Control+Command+F'],
    [false, 'F11']
  ])('provides an explicit native fullscreen action and shortcut (macOS: %s)', (isMac, accelerator) => {
    const items = flatten(applicationMenuTemplate({ isMac, appName: 'My Way' }))
    expect(items.find(item => item.role === 'togglefullscreen')).toMatchObject({
      label: '切换全屏', accelerator
    })
  })

  it('keeps standard macOS editing and lifecycle actions without unsafe reload tools', () => {
    const items = flatten(applicationMenuTemplate({ isMac: true, appName: 'My Way' }))
    const roles = items.map((item) => item.role).filter(Boolean)

    expect(items[0].label).toBe('My Way')
    expect(roles).toContain('about')
    expect(roles).toContain('quit')
    expect(roles).toContain('close')
    expect(roles).toContain('copy')
    expect(roles).toContain('paste')
    expect(roles).not.toContain('reload')
    expect(roles).not.toContain('forceReload')
    expect(roles).not.toContain('toggleDevTools')
  })

  it('provides the same safe lifecycle and editing surface off macOS', () => {
    const items = flatten(applicationMenuTemplate({ isMac: false, appName: 'My Way' }))
    const roles = items.map((item) => item.role).filter(Boolean)

    expect(items.map((item) => item.label)).toContain('文件')
    expect(roles).toContain('quit')
    expect(roles).toContain('copy')
    expect(roles).not.toContain('reload')
    expect(roles).not.toContain('toggleDevTools')
  })
})
