// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ConfirmDialog } from './ConfirmDialog'

afterEach(cleanup)

describe('ConfirmDialog', () => {
  it('focuses the safe action, traps focus, supports Escape, and restores focus', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const onCancel = vi.fn()
    const view = render(<ConfirmDialog title="放弃草案？" description="未保存内容将丢失。" confirmLabel="放弃" onCancel={onCancel} onConfirm={vi.fn()} />)

    expect(screen.getByRole('button', { name: '取消' })).toBe(document.activeElement)
    await userEvent.tab({ shift: true })
    expect(screen.getByRole('button', { name: '放弃' })).toBe(document.activeElement)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledOnce()
    view.unmount()
    expect(opener).toBe(document.activeElement)
    opener.remove()
  })

  it('locks controls and focuses the dialog while an operation is pending', () => {
    render(<ConfirmDialog title="丢弃记录？" description="无法恢复。" confirmLabel="确认丢弃" pending pendingLabel="正在丢弃…" onCancel={vi.fn()} onConfirm={vi.fn()} />)

    const dialog = screen.getByRole('dialog', { name: '丢弃记录？' })
    expect(dialog).toBe(document.activeElement)
    expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: '正在丢弃…' }) as HTMLButtonElement).disabled).toBe(true)
  })
})
