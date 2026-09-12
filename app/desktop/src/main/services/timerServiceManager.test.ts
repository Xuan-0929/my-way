import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import type { FileChangeEvent } from '../../shared/api'
import { DailyFileService } from './dailyFileService'
import { TimerFileStore } from './timerFileStore'
import { TimerService, type TimerRuntime } from './timerService'
import { TimerServiceManager } from './timerServiceManager'

interface FakeService {
  load: ReturnType<typeof vi.fn>
  dispose: ReturnType<typeof vi.fn>
  handleExternalChange: ReturnType<typeof vi.fn>
}

const fakeService = (): FakeService => ({
  load: vi.fn(async () => ({ active: null, capturedAt: new Date(0).toISOString() })),
  dispose: vi.fn(async () => undefined),
  handleExternalChange: vi.fn(async () => undefined)
})

describe('TimerServiceManager', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  const workspace = async (): Promise<string> => {
    const root = await realpath(await mkdtemp(join(tmpdir(), 'my-way-timer-manager-')))
    roots.push(root)
    return root
  }

  it('returns one initialized service for repeated and concurrent canonical workspace requests', async () => {
    const root = await workspace()
    const service = fakeService()
    const factory = vi.fn(() => service as unknown as TimerService)
    const manager = new TimerServiceManager(factory)

    const [first, second, third] = await Promise.all([
      manager.get(root),
      manager.get(join(root, '.')),
      manager.get(root)
    ])

    expect(first).toBe(service)
    expect(second).toBe(service)
    expect(third).toBe(service)
    expect(factory).toHaveBeenCalledTimes(1)
    expect(service.load).toHaveBeenCalledTimes(1)
    await manager.dispose()
  })

  it('disposes the old service before switching workspaces and clear releases the current service', async () => {
    const firstRoot = await workspace()
    const secondRoot = await workspace()
    const order: string[] = []
    const first = fakeService()
    first.dispose.mockImplementation(async () => { order.push('dispose-first') })
    const second = fakeService()
    second.load.mockImplementation(async () => {
      order.push('load-second')
      return { active: null, capturedAt: new Date(0).toISOString() }
    })
    const factory = vi.fn((root: string) => (root === firstRoot ? first : second) as unknown as TimerService)
    const manager = new TimerServiceManager(factory)
    await manager.get(firstRoot)

    await expect(manager.get(secondRoot)).resolves.toBe(second)
    expect(order).toEqual(['dispose-first', 'load-second'])
    await manager.clear()
    expect(second.dispose).toHaveBeenCalledTimes(1)
    await manager.dispose()
    expect(second.dispose).toHaveBeenCalledTimes(1)
  })

  it('serializes watcher routing to the current workspace service', async () => {
    const root = await workspace()
    const service = fakeService()
    const manager = new TimerServiceManager(() => service as unknown as TimerService)
    await manager.get(root)
    const event: FileChangeEvent = {
      kind: 'changed',
      path: 'data/timer/state.json',
      at: '2026-08-20T00:00:00.000Z'
    }

    await manager.handleFileChange(event)

    expect(service.handleExternalChange).toHaveBeenCalledWith(event)
    await manager.dispose()
  })

  it('cancels the old workspace countdown when switching to a new workspace', async () => {
    const firstRoot = await workspace()
    const secondRoot = await workspace()
    const scheduled: Array<{ handle: object; cleared: boolean }> = []
    const runtime: TimerRuntime = {
      now: () => new Date('2026-08-20T00:00:00.000Z'),
      setTimeout: () => {
        const entry = { handle: {}, cleared: false }
        scheduled.push(entry)
        return entry.handle
      },
      clearTimeout: (handle) => {
        const entry = scheduled.find((candidate) => candidate.handle === handle)
        if (entry) entry.cleared = true
      }
    }
    const manager = new TimerServiceManager((root) => new TimerService(
      new TimerFileStore(root, runtime.now),
      new DailyFileService(root, runtime.now),
      runtime
    ))
    const first = await manager.get(firstRoot)
    await first.start({ sessionId: 'old-workspace', mode: 'countdown', countdownMinutes: 25 })

    await manager.get(secondRoot)

    expect(scheduled[0].cleared).toBe(true)
    await expect(first.resume()).rejects.toThrow(/disposed/)
    await manager.dispose()
  })
})
