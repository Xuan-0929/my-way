import { describe, expect, it, vi } from 'vitest'
import { denyRendererPermissions, restrictRendererNetwork, trustedDevelopmentRendererUrl } from './rendererPermissions'

describe('denyRendererPermissions', () => {
  it('denies permission checks, requests, and device access without prompting', () => {
    let check: ((...args: never[]) => boolean) | undefined
    let request: ((...args: never[]) => void) | undefined
    let device: ((...args: never[]) => boolean) | undefined
    const target = {
      setPermissionCheckHandler: vi.fn((handler) => { check = handler as typeof check }),
      setPermissionRequestHandler: vi.fn((handler) => { request = handler as typeof request }),
      setDevicePermissionHandler: vi.fn((handler) => { device = handler as typeof device })
    } as unknown as Parameters<typeof denyRendererPermissions>[0]

    denyRendererPermissions(target)

    expect(target.setPermissionCheckHandler).toHaveBeenCalledOnce()
    expect(target.setPermissionRequestHandler).toHaveBeenCalledOnce()
    expect(target.setDevicePermissionHandler).toHaveBeenCalledOnce()
    expect(check?.()).toBe(false)
    const decision = vi.fn()
    request?.(undefined as never, 'media' as never, decision as never, {} as never)
    expect(decision).toHaveBeenCalledOnce()
    expect(decision).toHaveBeenCalledWith(false)
    expect(device?.()).toBe(false)
  })
})

describe('restrictRendererNetwork', () => {
  const captureListener = () => {
    let listener: ((details: { url: string }, callback: (response: { cancel?: boolean }) => void) => void) | undefined
    const target = {
      webRequest: {
        onBeforeRequest: vi.fn((_filter, handler) => { listener = handler })
      }
    } as unknown as Parameters<typeof restrictRendererNetwork>[0]

    return { target, getListener: () => listener }
  }

  it('cancels every web request in a packaged renderer session', () => {
    const { target, getListener } = captureListener()
    restrictRendererNetwork(target)

    expect(target.webRequest.onBeforeRequest).toHaveBeenCalledWith({
      urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*']
    }, expect.any(Function))
    const decision = vi.fn()
    getListener()?.({ url: 'https://example.com/image.png' }, decision)
    expect(decision).toHaveBeenCalledWith({ cancel: true })
  })

  it('allows only the exact local development origin', () => {
    const { target, getListener } = captureListener()
    restrictRendererNetwork(target, 'http://127.0.0.1:5173')

    const listener = getListener()
    const localDecision = vi.fn()
    listener?.({ url: 'http://127.0.0.1:5173/src/main.tsx' }, localDecision)
    expect(localDecision).toHaveBeenCalledWith({ cancel: false })
    const hmrDecision = vi.fn()
    listener?.({ url: 'ws://127.0.0.1:5173/' }, hmrDecision)
    expect(hmrDecision).toHaveBeenCalledWith({ cancel: false })

    for (const url of [
      'http://127.0.0.1:9999/other',
      'http://example.com:5173/remote',
      'https://127.0.0.1:5173/wrong-protocol'
    ]) {
      const decision = vi.fn()
      listener?.({ url }, decision)
      expect(decision).toHaveBeenCalledWith({ cancel: true })
    }
  })

  it('does not trust a non-loopback development URL', () => {
    const { target, getListener } = captureListener()
    restrictRendererNetwork(target, 'https://dev.example.com')

    const decision = vi.fn()
    getListener()?.({ url: 'https://dev.example.com/app.js' }, decision)
    expect(decision).toHaveBeenCalledWith({ cancel: true })
  })
})

describe('trustedDevelopmentRendererUrl', () => {
  it('ignores renderer URL environment values in packaged builds', () => {
    expect(trustedDevelopmentRendererUrl(true, 'http://127.0.0.1:5173')).toBeUndefined()
  })

  it('accepts only loopback HTTP origins in development builds', () => {
    expect(trustedDevelopmentRendererUrl(false, 'http://127.0.0.1:5173')).toBe('http://127.0.0.1:5173/')
    expect(trustedDevelopmentRendererUrl(false, 'https://localhost:5173/path')).toBe('https://localhost:5173/path')
    expect(trustedDevelopmentRendererUrl(false, 'https://dev.example.com')).toBeUndefined()
    expect(trustedDevelopmentRendererUrl(false, 'file:///tmp/untrusted.html')).toBeUndefined()
    expect(trustedDevelopmentRendererUrl(false, 'not a url')).toBeUndefined()
  })
})
