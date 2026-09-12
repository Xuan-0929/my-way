import { Component, type ErrorInfo, type ReactNode } from 'react'

interface AppErrorBoundaryProps {
  children: ReactNode
  onReload?: () => void
}

interface AppErrorBoundaryState {
  failed: boolean
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('My Way renderer failed', error, info.componentStack)
  }

  private reload = (): void => {
    if (this.props.onReload) this.props.onReload()
    else window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children

    return (
      <main className="launch-screen" role="alert">
        <div className="brand">My Way</div>
        <h1>界面暂时无法显示</h1>
        <p>本地学习文件不会因此被删除。重新载入后，App 会从最后一次成功保存的版本继续。</p>
        <button autoFocus onClick={this.reload}>重新载入 App</button>
      </main>
    )
  }
}
