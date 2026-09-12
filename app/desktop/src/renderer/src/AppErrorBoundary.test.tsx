// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppErrorBoundary } from './AppErrorBoundary'

const BrokenView = (): never => {
  throw new Error('renderer exploded')
}

describe('AppErrorBoundary', () => {
  it('replaces a crashed renderer with a calm reload screen', async () => {
    const onReload = vi.fn()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      render(<AppErrorBoundary onReload={onReload}><BrokenView /></AppErrorBoundary>)

      expect(screen.getByRole('heading', { name: '界面暂时无法显示' })).toBeTruthy()
      expect(screen.getByText(/本地学习文件不会因此被删除/)).toBeTruthy()
      await userEvent.click(screen.getByRole('button', { name: '重新载入 App' }))
      expect(onReload).toHaveBeenCalledOnce()
    } finally {
      consoleError.mockRestore()
    }
  })
})
