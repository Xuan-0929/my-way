import { realpath } from 'node:fs/promises'
import type { FileChangeEvent } from '../../shared/api'
import { DailyFileService } from './dailyFileService'
import { TimerFileStore } from './timerFileStore'
import { TimerService } from './timerService'

export type TimerServiceFactory = (canonicalRoot: string) => TimerService

const defaultFactory: TimerServiceFactory = (root) => new TimerService(
  new TimerFileStore(root),
  new DailyFileService(root)
)

export class TimerServiceManager {
  private current: { root: string; service: TimerService } | undefined
  private tail: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(private readonly factory: TimerServiceFactory = defaultFactory) {}

  get(root: string): Promise<TimerService> {
    if (this.disposed) return Promise.reject(new Error('Timer service manager has been disposed'))
    return this.enqueue(async () => {
      if (this.disposed) throw new Error('Timer service manager has been disposed')
      const canonicalRoot = await realpath(root)
      if (this.current?.root === canonicalRoot) return this.current.service
      if (this.current) {
        await this.current.service.dispose()
        this.current = undefined
      }
      const service = this.factory(canonicalRoot)
      try {
        await service.load()
      } catch (error) {
        await service.dispose()
        throw error
      }
      this.current = { root: canonicalRoot, service }
      return service
    })
  }

  handleFileChange(event: FileChangeEvent): Promise<void> {
    if (this.disposed) return Promise.resolve()
    return this.enqueue(async () => {
      if (this.disposed || !this.current) return
      await this.current.service.handleExternalChange(event)
    })
  }

  clear(): Promise<void> {
    if (this.disposed) return Promise.resolve()
    return this.enqueue(async () => {
      if (!this.current) return
      const service = this.current.service
      this.current = undefined
      await service.dispose()
    })
  }

  dispose(): Promise<void> {
    if (this.disposed) return this.tail
    this.disposed = true
    return this.enqueue(async () => {
      if (!this.current) return
      const service = this.current.service
      this.current = undefined
      await service.dispose()
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.tail.then(operation)
    this.tail = result.then(() => undefined, () => undefined)
    return result
  }
}
