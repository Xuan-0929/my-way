import type { TimerPauseReason, TimerSnapshot } from '../../shared/timerTypes'

export interface TimerLifecycleTarget {
  pauseFor(reason: Extract<TimerPauseReason, 'app_close' | 'system_suspend'>): Promise<TimerSnapshot>
}

export interface TimerLifecycleDependencies {
  getTimer(): Promise<TimerLifecycleTarget | null>
  requestRendererFlush(): void
  permitClose(): void
  publishError(error: unknown): void
}

export class TimerLifecycle {
  private preparation: Promise<void> | undefined
  private awaitingRenderer = false

  constructor(private readonly dependencies: TimerLifecycleDependencies) {}

  prepareClose(): Promise<void> {
    if (this.preparation) return this.preparation
    const preparation = this.runClosePreparation()
    this.preparation = preparation
    void preparation.catch(() => {
      if (this.preparation === preparation) this.preparation = undefined
    })
    return preparation
  }

  private async runClosePreparation(): Promise<void> {
    try {
      const timer = await this.dependencies.getTimer()
      await timer?.pauseFor('app_close')
      this.awaitingRenderer = true
      this.dependencies.requestRendererFlush()
    } catch (error) {
      this.awaitingRenderer = false
      this.dependencies.publishError(error)
      throw error
    }
  }

  async handleSuspend(): Promise<void> {
    try {
      const timer = await this.dependencies.getTimer()
      await timer?.pauseFor('system_suspend')
    } catch (error) {
      this.dependencies.publishError(error)
      throw error
    }
  }

  handleResume(): void {
    // Wake never resumes study automatically; the user must opt in.
  }

  rendererReadyToClose(): void {
    if (!this.awaitingRenderer) return
    this.awaitingRenderer = false
    this.preparation = undefined
    this.dependencies.permitClose()
  }

  cancelClosePreparation(): void {
    this.awaitingRenderer = false
    this.preparation = undefined
  }
}
