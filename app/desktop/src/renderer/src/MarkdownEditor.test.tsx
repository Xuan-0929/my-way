// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { EditorView } from '@codemirror/view'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { MarkdownEditor } from './MarkdownEditor'

afterEach(cleanup)

describe('MarkdownEditor', () => {
  it('supports undo and redo, then resets history on an external reload', () => {
    const onChange = vi.fn()
    const rendered = render(<MarkdownEditor label="笔记" value="原始笔记" onChange={onChange} />)
    const element = screen.getByLabelText('笔记')
    const editor = EditorView.findFromDOM(element)!
    act(() => editor.dispatch({ changes: { from: 4, insert: ' 新内容' } }))
    fireEvent.keyDown(element, { key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(editor.state.doc.toString()).toBe('原始笔记')
    fireEvent.keyDown(element, { key: 'y', code: 'KeyY', ctrlKey: true })
    expect(editor.state.doc.toString()).toBe('原始笔记 新内容')
    onChange.mockClear()
    rendered.rerender(<MarkdownEditor label="笔记" value="外部文件版本" onChange={onChange} />)
    fireEvent.keyDown(element, { key: 'z', code: 'KeyZ', ctrlKey: true })
    expect(editor.state.doc.toString()).toBe('外部文件版本')
    expect(onChange).not.toHaveBeenCalled()
  })
  it('syncs an externally reloaded value without reporting it as a user edit', () => {
    const onChange = vi.fn()
    const view = render(<MarkdownEditor label="周说明" value="# 本地草案" onChange={onChange} />)

    view.rerender(<MarkdownEditor label="周说明" value="# 外部版本" onChange={onChange} />)

    expect(screen.getByLabelText('周说明').textContent).toContain('外部版本')
    expect(onChange).not.toHaveBeenCalled()
  })

  it('switches between the persistent editor and a safe rendered preview', async () => {
    render(<MarkdownEditor
      label="学习笔记"
      value={'## 结论\n\n**注意力** 可以并行。\n\n[资料](https://example.com/)'}
      onChange={vi.fn()}
    />)

    const editor = screen.getByLabelText('学习笔记').closest('.markdown-editor') as HTMLElement
    expect(editor.hidden).toBe(false)
    expect(screen.getByRole('group', { name: '学习笔记显示模式' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '学习笔记编辑' }).getAttribute('aria-pressed')).toBe('true')

    await userEvent.click(screen.getByRole('button', { name: '学习笔记预览' }))
    expect(editor.hidden).toBe(true)
    const preview = screen.getByLabelText('学习笔记内容预览')
    expect(preview.textContent).toContain('注意力')
    expect(screen.getByRole('heading', { name: '结论' })).toBeTruthy()
    const link = screen.getByRole('link', { name: '资料' })
    expect(link.getAttribute('target')).toBe('_blank')
    expect(link.getAttribute('rel')).toContain('noreferrer')
    expect(link.hasAttribute('node')).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: '学习笔记编辑' }))
    expect(editor.hidden).toBe(false)
    expect(preview.hidden).toBe(true)
  })
})
