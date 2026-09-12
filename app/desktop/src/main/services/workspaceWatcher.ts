import chokidar, { type FSWatcher } from 'chokidar'
import { join, relative } from 'node:path'
import type { FileChangeEvent, FileWatchEvent } from '../../shared/api'

export class WorkspaceWatcher {
  private watcher: FSWatcher | null = null
  private readonly pending = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly watch: typeof chokidar.watch = chokidar.watch.bind(chokidar)) {}

  async start(root: string, listener: (event: FileWatchEvent) => void): Promise<void> {
    await this.stop()
    const paths = [
      join(root, 'data', 'daily'),
      join(root, 'data', 'timer'),
      join(root, '00-dashboard', 'weeks'),
      join(root, '00-dashboard', '12-week-roadmap.md'),
      join(root, '00-dashboard', 'long-term-roadmap.md'),
      join(root, '00-dashboard', 'current-status.md')
    ]
    this.watcher = this.watch(paths, {
      ignoreInitial: true,
      // The workspace has a small, fixed surface. Polling avoids macOS FSEvents
      // exhaustion without materially affecting local file-change latency.
      usePolling: true,
      persistent: false,
      interval: 250,
      awaitWriteFinish: { stabilityThreshold: 150, pollInterval: 50 }
    })
    const emit = (kind: FileChangeEvent['kind'], path: string): void => {
      const existing = this.pending.get(path)
      if (existing) clearTimeout(existing)
      this.pending.set(path, setTimeout(() => {
        this.pending.delete(path)
        listener({ kind, path: relative(root, path).split('\\').join('/'), at: new Date().toISOString() })
      }, 120))
    }
    this.watcher.on('change', (path) => emit('changed', path))
    this.watcher.on('add', (path) => emit('added', path))
    this.watcher.on('unlink', (path) => emit('removed', path))
    let ready = false
    this.watcher.on('error', (error) => {
      if (!ready) return
      listener({
        kind: 'error',
        message: `文件监听失败：${error instanceof Error ? error.message : String(error)}`,
        at: new Date().toISOString()
      })
    })
    try {
      await new Promise<void>((resolve, reject) => {
        const watcher = this.watcher
        const rejectStartup = (error: unknown): void => reject(error)
        watcher?.once('ready', () => {
          ready = true
          watcher.off('error', rejectStartup)
          resolve()
        })
        watcher?.once('error', rejectStartup)
      })
    } catch (error) {
      await this.stop()
      throw error
    }
  }

  async stop(): Promise<void> {
    for (const timeout of this.pending.values()) clearTimeout(timeout)
    this.pending.clear()
    if (this.watcher) await this.watcher.close()
    this.watcher = null
  }
}
