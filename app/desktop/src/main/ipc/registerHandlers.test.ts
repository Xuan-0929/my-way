import { describe, expect, it, vi } from 'vitest'
import { ZodError } from 'zod'
import { ipcChannels } from '../../shared/api'
import { registerIpcHandlers, toAppError, type IpcMainLike } from './registerHandlers'
import { RevisionConflictError } from '../services/dailyFileService'

describe('registerIpcHandlers', () => {
  it('rejects arguments to the narrow fullscreen controls', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const handlers = Object.fromEntries(Object.values(ipcChannels).map(channel => [channel, vi.fn(async () => channel)]))
    registerIpcHandlers({ handle: (channel, handler) => { registered.set(channel, handler) } }, handlers)
    for (const channel of [ipcChannels.windowGetFullScreen, ipcChannels.windowExitFullScreen]) {
      await expect(registered.get(channel)?.({})).resolves.toEqual({ ok: true, value: channel })
      handlers[channel].mockClear()
      await expect(registered.get(channel)?.({}, '/tmp/other-window')).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
      expect(handlers[channel]).not.toHaveBeenCalled()
    }
  })
  it('accepts only a guarded task-intent request before calling the timer service', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const handlers = Object.fromEntries(Object.values(ipcChannels).map(channel => [channel, vi.fn(async () => channel)]))
    registerIpcHandlers({ handle: (channel, handler) => { registered.set(channel, handler) } }, handlers)
    const channel = ipcChannels.timerSetTaskIntent
    const intent = { date: '2026-09-02', taskId: 'task', taskTitle: '学习任务' }
    for (const taskIntent of [intent, null]) {
      const request = { sessionId: 'active', taskIntent }
      await expect(registered.get(channel)?.({}, request)).resolves.toEqual({ ok: true, value: channel })
      expect(handlers[channel]).toHaveBeenLastCalledWith(request)
    }
    handlers[channel].mockClear()
    for (const request of [{ taskIntent: intent }, { sessionId: 'active' }, { sessionId: 'active', taskIntent: { ...intent, date: '2026-02-30' } }, { sessionId: 'active', taskIntent: null, path: '/tmp/escape' }]) {
      await expect(registered.get(channel)?.({}, request)).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    }
    expect(handlers[channel]).not.toHaveBeenCalled()
  })
  it('includes the controlled task deletion channel', () => {
    expect((ipcChannels as Record<string, string>).taskDelete).toBe('task:delete')
    expect((ipcChannels as Record<string, string>).evidenceInspect).toBe('evidence:inspect')
  })

  it('registers every approved invoke channel and wraps success values', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain: IpcMainLike = { handle: (channel, handler) => { registered.set(channel, handler) } }
    const handlers = Object.fromEntries(Object.values(ipcChannels).map((channel) => [channel, vi.fn(async () => channel)]))
    registerIpcHandlers(ipcMain, handlers)
    expect([...registered.keys()].sort()).toEqual(Object.values(ipcChannels).sort())
    await expect(registered.get(ipcChannels.workspaceGet)?.({})).resolves.toEqual({ ok: true, value: ipcChannels.workspaceGet })
  })

  it('returns structured errors instead of leaking thrown objects', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain: IpcMainLike = { handle: (channel, handler) => { registered.set(channel, handler) } }
    const handlers = Object.fromEntries(Object.values(ipcChannels).map((channel) => [channel, async () => { throw new Error('磁盘不可读') }]))
    registerIpcHandlers(ipcMain, handlers)
    await expect(registered.get(ipcChannels.routeLoad)?.({})).resolves.toEqual({ ok: false, error: { code: 'UNKNOWN', message: '磁盘不可读' } })
  })

  it('rejects invalid timer payloads at the IPC boundary before calling services', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain: IpcMainLike = { handle: (channel, handler) => { registered.set(channel, handler) } }
    const handlers = Object.fromEntries(Object.values(ipcChannels).map((channel) => [channel, vi.fn(async () => channel)]))
    registerIpcHandlers(ipcMain, handlers)

    await expect(registered.get(ipcChannels.timerStart)?.({}, {
      sessionId: 'invalid-countdown',
      mode: 'countdown',
      countdownMinutes: 0
    })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(handlers[ipcChannels.timerStart]).not.toHaveBeenCalled()

    await expect(registered.get(ipcChannels.timerAssign)?.({}, {
      requestId: 'assign', sessionId: 'session', taskId: 'task', creditedMinutes: 1, path: '/tmp/escape'
    })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(handlers[ipcChannels.timerAssign]).not.toHaveBeenCalled()
  })

  it('rejects malformed or path-bearing weekly planning payloads before calling services', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain: IpcMainLike = { handle: (channel, handler) => { registered.set(channel, handler) } }
    const handlers = Object.fromEntries(Object.values(ipcChannels).map((channel) => [channel, vi.fn(async () => channel)]))
    registerIpcHandlers(ipcMain, handlers)

    await expect(registered.get(ipcChannels.weekContext)?.({}, '2026-02-30')).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    expect(handlers[ipcChannels.weekContext]).not.toHaveBeenCalled()

    const validRequest = {
      expectedRevision: null,
      plan: {
        schemaVersion: 1,
        week: 3,
        startDate: '2026-08-31',
        endDate: '2026-09-06',
        tasks: []
      },
      body: '# 第 3 周\n'
    }
    await expect(registered.get(ipcChannels.weekSave)?.({}, {
      ...validRequest,
      path: '/tmp/escape.md'
    })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    await expect(registered.get(ipcChannels.weekSave)?.({}, {
      ...validRequest,
      expectedRevision: 'not-a-revision'
    })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    await expect(registered.get(ipcChannels.weekSave)?.({}, {
      ...validRequest,
      body: 42
    })).resolves.toMatchObject({ ok: false, error: { code: 'VALIDATION' } })
    expect(handlers[ipcChannels.weekSave]).not.toHaveBeenCalled()

    const revision = 'a'.repeat(64)
    await expect(registered.get(ipcChannels.weekSave)?.({}, {
      ...validRequest,
      expectedRevision: revision
    })).resolves.toEqual({ ok: true, value: ipcChannels.weekSave })
    await expect(registered.get(ipcChannels.weekSave)?.({}, {
      ...validRequest,
      expectedRevision: revision,
      asConflictCopy: true
    })).resolves.toEqual({ ok: true, value: ipcChannels.weekSave })
    expect(handlers[ipcChannels.weekSave]).toHaveBeenCalledTimes(2)
    expect(handlers[ipcChannels.weekSave]).toHaveBeenNthCalledWith(1, { ...validRequest, expectedRevision: revision })
    expect(handlers[ipcChannels.weekSave]).toHaveBeenNthCalledWith(2, { ...validRequest, expectedRevision: revision, asConflictCopy: true })
  })

  it('validates bounded workspace-relative evidence inspection requests', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain: IpcMainLike = { handle: (channel, handler) => { registered.set(channel, handler) } }
    const handlers = Object.fromEntries(Object.values(ipcChannels).map((channel) => [channel, vi.fn(async (paths) => paths)]))
    registerIpcHandlers(ipcMain, handlers)

    await expect(registered.get(ipcChannels.evidenceInspect)?.({}, ['notes/result.md'])).resolves.toEqual({
      ok: true,
      value: ['notes/result.md']
    })
    await expect(registered.get(ipcChannels.evidenceInspect)?.({}, ['../escape.md'])).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
    await expect(registered.get(ipcChannels.evidenceInspect)?.({}, Array.from({ length: 201 }, (_, index) => `notes/${index}.md`))).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION' }
    })
  })

  it('rejects malformed arguments on every filesystem-facing channel before calling services', async () => {
    const registered = new Map<string, (...args: unknown[]) => unknown>()
    const ipcMain: IpcMainLike = { handle: (channel, handler) => { registered.set(channel, handler) } }
    const handlers = Object.fromEntries(Object.values(ipcChannels).map((channel) => [channel, vi.fn(async () => channel)]))
    registerIpcHandlers(ipcMain, handlers)

    const invalidCalls: Array<[string, ...unknown[]]> = [
      [ipcChannels.workspaceSelect, 'unexpected'],
      [ipcChannels.workspaceValidate, '   '],
      [ipcChannels.workspaceGet, 'unexpected'],
      [ipcChannels.routeLoad, { unexpected: true }],
      [ipcChannels.weekLoad, '2026-02-30'],
      [ipcChannels.weekDiff, '2026-09-01', {}],
      [ipcChannels.taskDelete, { day: { path: 'data/daily/2026/2026-09-01.md', revision: 'bad' }, taskId: 'task' }],
      [ipcChannels.dayOpen, 'not-a-date'],
      [ipcChannels.dayCreate, '2026-13-01'],
      [ipcChannels.daySave, { path: '/tmp/escape.md', revision: 'bad', value: {} }],
      [ipcChannels.dayResolveCarryover, { source: {}, targetDate: '2026-09-01', taskId: 'task', choice: { action: 'skip' } }],
      [ipcChannels.progressQuery, '1900-01-01', '2100-01-01'],
      [ipcChannels.evidenceSelect, 'unexpected'],
      [ipcChannels.evidenceOpen, '../escape.md']
    ]

    for (const [channel, ...args] of invalidCalls) {
      await expect(registered.get(channel)?.({}, ...args), channel).resolves.toMatchObject({
        ok: false,
        error: { code: 'VALIDATION' }
      })
      expect(handlers[channel], channel).not.toHaveBeenCalled()
    }
  })
})

describe('toAppError', () => {
  it('classifies optimistic concurrency conflicts', () => {
    expect(toAppError(new RevisionConflictError('new-revision'))).toEqual({ code: 'CONFLICT', message: '文件已在外部发生变化，禁止覆盖', currentRevision: 'new-revision' })
  })

  it('classifies Zod validation and path-specific timer read-only errors', () => {
    expect(toAppError(new ZodError([]))).toMatchObject({ code: 'VALIDATION' })
    const path = '/workspace/data/timer/state.json'
    expect(toAppError(new Error(`${path}: 活动计时期间计时文件被外部修改`))).toEqual({
      code: 'READ_ONLY',
      message: `${path}: 活动计时期间计时文件被外部修改`,
      path
    })
  })

  it.each([
    ['ENOENT', 'NOT_FOUND'],
    ['EACCES', 'READ_ONLY'],
    ['EPERM', 'READ_ONLY'],
    ['EROFS', 'READ_ONLY'],
    ['ENOSPC', 'IO'],
    ['EIO', 'IO'],
    ['EMFILE', 'IO'],
    ['ENFILE', 'IO']
  ] as const)('classifies filesystem error %s as %s and preserves its path', (errno, code) => {
    const error = Object.assign(new Error(`${errno}: filesystem failure`), {
      code: errno,
      path: '/workspace/data/daily/2026/2026-09-01.md'
    })

    expect(toAppError(error)).toEqual({
      code,
      message: `${errno}: filesystem failure`,
      path: '/workspace/data/daily/2026/2026-09-01.md'
    })
  })
})
