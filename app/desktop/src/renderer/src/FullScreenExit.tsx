import { useEffect, useState } from 'react'

/** Kept outside the study view so fullscreen remains escapable on launch/error pages too. */
export function FullScreenExit() {
  const [fullScreen, setFullScreen] = useState(false)
  const [error, setError] = useState('')
  const controls = window.myWay?.window

  useEffect(() => {
    if (!controls) return
    let disposed = false
    let receivedEvent = false
    const unsubscribe = controls.onFullScreenChanged(value => {
      receivedEvent = true
      setFullScreen(value)
      setError('')
    })
    void controls.getFullScreen().then(result => {
      if (!disposed && !receivedEvent && result.ok) setFullScreen(result.value)
    }).catch(() => { /* Native menu and shortcut remain available if IPC fails. */ })
    return () => { disposed = true; unsubscribe() }
  }, [controls])

  if (!fullScreen || !controls) return null

  const exit = async (): Promise<void> => {
    setError('')
    try {
      const result = await controls.exitFullScreen()
      if (!result.ok) setError(result.error.message)
    } catch {
      setError('退出失败，请重试或使用“窗口 → 切换全屏”。')
    }
  }

  return <div className="fullscreen-controls">
    <button type="button" className="fullscreen-exit" onClick={() => { void exit() }} title="退出全屏">
      <svg width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3 7h4V3m10 4h-4V3M3 13h4v4m10-4h-4v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      退出全屏
    </button>
    {error && <span className="fullscreen-error" role="alert">{error}</span>}
  </div>
}
