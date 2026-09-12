// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceFrame } from './WorkspaceFrame'

afterEach(() => { cleanup(); window.localStorage.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('WorkspaceFrame', () => {
  it('remembers the rail preference across remounts without depending on storage availability', () => {
    vi.stubGlobal('innerWidth', 1440)
    const props = { sidebar: <nav />, rail: <aside />, saveStatus: 'saved' as const, children: <main /> }
    const first = render(<WorkspaceFrame {...props} />)
    fireEvent.click(screen.getByRole('button', { name: '收起本周摘要' }))
    first.unmount()
    render(<WorkspaceFrame {...props} />)
    expect(screen.getByRole('button', { name: '展开本周摘要' })).toBeTruthy()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('unavailable') })
    fireEvent.click(screen.getByRole('button', { name: '展开本周摘要' }))
    expect(screen.getByRole('button', { name: '收起本周摘要' })).toBeTruthy()
  })
  it('keeps the content, navigation and save feedback mounted when the rail closes', () => {
    vi.stubGlobal('innerWidth', 1440)
    render(<WorkspaceFrame sidebar={<nav>导航</nav>} rail={<aside>周摘要</aside>} saveStatus="dirty"><main><input aria-label="笔记" defaultValue="保留" /></main></WorkspaceFrame>)
    const input = screen.getByRole('textbox', { name: '笔记' })
    const nav = screen.getByRole('navigation')
    fireEvent.click(screen.getByRole('button', { name: '收起本周摘要' }))
    expect(screen.getByRole('textbox', { name: '笔记' })).toBe(input)
    expect(screen.getByRole('navigation')).toBe(nav)
    expect(screen.getByRole('status').textContent).toBe('待保存修改')
    expect(screen.queryByRole('complementary')).toBeNull()
    expect(screen.getByRole('button', { name: '展开本周摘要' }).getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(screen.getByRole('button', { name: '展开本周摘要' }))
    expect(screen.getByRole('complementary')).toBeTruthy()
  })
  it('defaults to a wider writing area in a narrow window and keeps conflict feedback visible', () => {
    vi.stubGlobal('innerWidth', 1180)
    render(<WorkspaceFrame sidebar={<nav />} rail={<aside />} saveStatus="conflict"><main /></WorkspaceFrame>)
    expect(screen.getByRole('button', { name: '展开本周摘要' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toBe('文件冲突')
  })
})
