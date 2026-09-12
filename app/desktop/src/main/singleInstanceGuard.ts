export interface SingleInstanceApplication {
  requestSingleInstanceLock(): boolean
  quit(): void
  on(event: 'second-instance', listener: () => void): unknown
  isReady(): boolean
  whenReady(): Promise<void>
}

export interface FocusableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export interface SingleInstanceWindowController {
  getWindow(): FocusableWindow | null
  createWindow(): void
}

export const installSingleInstanceGuard = (
  target: SingleInstanceApplication,
  windows: SingleInstanceWindowController
): boolean => {
  if (!target.requestSingleInstanceLock()) {
    target.quit()
    return false
  }

  const revealPrimaryWindow = (): void => {
    let window = windows.getWindow()
    if (!window || window.isDestroyed()) {
      windows.createWindow()
      window = windows.getWindow()
    }
    if (!window || window.isDestroyed()) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  }

  target.on('second-instance', () => {
    if (target.isReady()) revealPrimaryWindow()
    else void target.whenReady().then(revealPrimaryWindow)
  })
  return true
}
