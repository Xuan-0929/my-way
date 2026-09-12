// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopApi, Result } from '../../shared/api'
import { FullScreenExit } from './FullScreenExit'

afterEach(() => { cleanup(); delete window.myWay })

const setup = (fullScreen = false) => {
  let notify: (value: boolean) => void = () => undefined
  const unsubscribe = vi.fn()
  const controls: DesktopApi['window'] = {
    getFullScreen: vi.fn(async () => ({ ok: true as const, value: fullScreen })),
    exitFullScreen: vi.fn(async () => ({ ok: true as const, value: undefined })),
    onFullScreenChanged: vi.fn(listener => { notify = listener; return unsubscribe })
  }
  window.myWay = { window: controls } as DesktopApi
  return { controls, unsubscribe, notify: (value: boolean) => act(() => notify(value)) }
}

describe('FullScreenExit', () => {
  it('only appears in native fullscreen and exits without reloading content', async () => {
    const { controls, notify, unsubscribe } = setup()
    const view = render(<><FullScreenExit /><input aria-label="未保存笔记" defaultValue="保持原样" /></>)
    await waitFor(() => expect(controls.getFullScreen).toHaveBeenCalledOnce())
    expect(screen.queryByRole('button', { name: '退出全屏' })).toBeNull()
    const input = screen.getByRole('textbox')
    notify(true)
    fireEvent.click(screen.getByRole('button', { name: '退出全屏' }))
    await waitFor(() => expect(controls.exitFullScreen).toHaveBeenCalledOnce())
    // The native transition event, not the invoke acknowledgement, owns the state.
    expect(screen.getByRole('button', { name: '退出全屏' })).toBeTruthy()
    notify(false)
    expect(screen.queryByRole('button', { name: '退出全屏' })).toBeNull()
    expect(screen.getByRole('textbox')).toBe(input)
    expect((input as HTMLInputElement).value).toBe('保持原样')
    view.unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('loads an already fullscreen window and preserves newer native events', async () => {
    const { controls, notify } = setup(true)
    let resolve!: (result: Result<boolean>) => void
    vi.mocked(controls.getFullScreen).mockImplementation(() => new Promise(done => { resolve = done }))
    render(<FullScreenExit />)
    notify(true)
    await act(async () => resolve({ ok: true, value: false }))
    expect(screen.getByRole('button', { name: '退出全屏' })).toBeTruthy()
  })

  it('offers a retry when the native exit request fails', async () => {
    const { controls } = setup(true)
    vi.mocked(controls.exitFullScreen).mockResolvedValueOnce({ ok: false, error: { code: 'UNKNOWN', message: '窗口忙碌' } })
    render(<FullScreenExit />)
    fireEvent.click(await screen.findByRole('button', { name: '退出全屏' }))
    expect((await screen.findByRole('alert')).textContent).toContain('窗口忙碌')
    fireEvent.click(screen.getByRole('button', { name: '退出全屏' }))
    await waitFor(() => expect(controls.exitFullScreen).toHaveBeenCalledTimes(2))
  })

  it('renders nothing in the browser preview without native APIs', () => {
    const { container } = render(<FullScreenExit />)
    expect(container.childElementCount).toBe(0)
  })
})
