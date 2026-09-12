import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EventEmitter } from 'node:events'
import type { FSWatcher } from 'chokidar'
import { WorkspaceWatcher } from './workspaceWatcher'

describe('WorkspaceWatcher', () => {
  let root = ''
  const watcher = new WorkspaceWatcher()

  afterEach(async () => {
    await watcher.stop()
    if (root) await rm(root, { recursive: true, force: true })
  })

  it('debounces external edits and reports workspace-relative paths', async () => {
    root = await mkdtemp(join(tmpdir(), 'my-way-watcher-'))
    const directory = join(root, 'data', 'daily', '2026')
    const path = join(directory, '2026-08-17.md')
    await mkdir(directory, { recursive: true })
    await writeFile(path, 'first')
    const events: Array<{ kind: string; path: string }> = []
    await watcher.start(root, (event) => { if (event.kind !== 'error') events.push(event) })
    await appendFile(path, 'second')
    await new Promise((resolve) => setTimeout(resolve, 30))
    await appendFile(path, 'third')
    await vi.waitFor(() => expect(events).toHaveLength(1), { timeout: 2_000 })
    expect(events[0]).toMatchObject({ kind: 'changed', path: 'data/daily/2026/2026-08-17.md' })
  })

  it('watches timer state and dated ledgers using normalized workspace-relative paths', async () => {
    root = await mkdtemp(join(tmpdir(), 'my-way-watcher-'))
    const timerDirectory = join(root, 'data', 'timer')
    const ledgerDirectory = join(timerDirectory, '2026')
    const statePath = join(timerDirectory, 'state.json')
    const ledgerPath = join(ledgerDirectory, '2026-08-20.md')
    await mkdir(ledgerDirectory, { recursive: true })
    const events: Array<{ kind: string; path: string }> = []
    await watcher.start(root, (event) => { if (event.kind !== 'error') events.push(event) })
    await new Promise((resolve) => setTimeout(resolve, 100))

    await writeFile(statePath, 'state-v1')
    await vi.waitFor(
      () => expect(events.some(({ path }) => path === 'data/timer/state.json')).toBe(true),
      { timeout: 2_000 }
    )
    await writeFile(ledgerPath, 'ledger-v1')
    await vi.waitFor(
      () => expect(events.some(({ path }) => path === 'data/timer/2026/2026-08-20.md')).toBe(true),
      { timeout: 2_000 }
    )
    expect(events.map(({ path }) => path).sort()).toEqual([
      'data/timer/2026/2026-08-20.md',
      'data/timer/state.json'
    ])
    expect(events.every(({ kind }) => kind === 'added' || kind === 'changed')).toBe(true)
  }, 10_000)

  it('reports every watcher error after startup without leaving an unhandled error event', async () => {
    const nativeWatcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> }
    nativeWatcher.close = vi.fn(async () => undefined)
    const watcherWithErrors = new WorkspaceWatcher(vi.fn(() => nativeWatcher as unknown as FSWatcher))
    const events: Array<{ kind: string; message?: string }> = []

    const started = watcherWithErrors.start('/workspace', (event) => events.push(event))
    await Promise.resolve()
    nativeWatcher.emit('ready')
    await started

    nativeWatcher.emit('error', new Error('watcher offline'))
    nativeWatcher.emit('error', new Error('watcher still offline'))

    expect(events).toEqual([
      { kind: 'error', message: '文件监听失败：watcher offline', at: expect.any(String) },
      { kind: 'error', message: '文件监听失败：watcher still offline', at: expect.any(String) }
    ])
    await watcherWithErrors.stop()
  })

  it('closes a watcher that fails before ready and leaves startup reporting to its caller', async () => {
    const nativeWatcher = new EventEmitter() as EventEmitter & { close: ReturnType<typeof vi.fn> }
    nativeWatcher.close = vi.fn(async () => undefined)
    const failedWatcher = new WorkspaceWatcher(vi.fn(() => nativeWatcher as unknown as FSWatcher))
    const listener = vi.fn()

    const started = failedWatcher.start('/workspace', listener)
    await Promise.resolve()
    nativeWatcher.emit('error', new Error('startup failed'))

    await expect(started).rejects.toThrow('startup failed')
    expect(listener).not.toHaveBeenCalled()
    expect(nativeWatcher.close).toHaveBeenCalledOnce()
  })
})
