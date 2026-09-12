import { app, BrowserWindow, dialog, ipcMain, Menu, powerMonitor, shell, type OpenDialogOptions, type OpenDialogReturnValue } from 'electron'
import { join } from 'node:path'
import type { CarryoverRequest, CarryoverResult, DeleteTaskRequest, FileWatchErrorEvent, FileWatchEvent, SaveWeekRequest } from '../shared/api'
import { ipcChannels, lifecycleEvents, timerEvents, windowEvents } from '../shared/api'
import type { ParsedDailyRecord, VersionedFile } from '../shared/types'
import type { TimerSnapshot } from '../shared/timerTypes'
import { registerIpcHandlers, toAppError, type HandlerMap, type IpcMainLike } from './ipc/registerHandlers'
import { resolveAndPersistCarryover } from './services/carryoverService'
import { DailyFileService } from './services/dailyFileService'
import { StudyDataService } from './services/studyDataService'
import { WeekPlanningService } from './services/weekPlanningService'
import { TaskDeletionService } from './services/taskDeletionService'
import { resolveSafePath, toWorkspaceRelativePath, validateWorkspace } from './services/workspaceService'
import { WorkspaceStore } from './services/workspaceStore'
import { WorkspaceWatcher } from './services/workspaceWatcher'
import { TimerFileStore } from './services/timerFileStore'
import { TimerLifecycle } from './services/timerLifecycle'
import { TimerService } from './services/timerService'
import { TimerServiceManager } from './services/timerServiceManager'
import { EvidenceService } from './services/evidenceService'
import { denyRendererPermissions, restrictRendererNetwork, trustedDevelopmentRendererUrl } from './rendererPermissions'
import { installSingleInstanceGuard } from './singleInstanceGuard'
import { applicationMenuTemplate } from './applicationMenu'

let mainWindow: BrowserWindow | null = null
let allowWindowClose = false
let quitRequested = false
let workspaceStore: WorkspaceStore
const workspaceWatcher = new WorkspaceWatcher()
let latestTimerSnapshot: TimerSnapshot | undefined
let activeWorkspaceRoot: string | null = null
let latestWatcherError: FileWatchErrorEvent | null = null

const publishTimerSnapshot = (snapshot: TimerSnapshot): void => {
  latestTimerSnapshot = snapshot
  mainWindow?.webContents.send(timerEvents.changed, snapshot)
}

const publishTimerError = (error: unknown): void => {
  const appError = toAppError(error)
  publishTimerSnapshot(Object.freeze({
    ...(latestTimerSnapshot ?? { active: null, capturedAt: new Date().toISOString() }),
    readOnlyError: Object.freeze({ message: appError.message, ...(appError.path ? { path: appError.path } : {}) })
  }))
}

const timerManager = new TimerServiceManager((root) => {
  const service = new TimerService(new TimerFileStore(root), new DailyFileService(root))
  service.subscribe(publishTimerSnapshot)
  return service
})

const currentTimer = async (): Promise<TimerService> => timerManager.get(await requireWorkspace())

const timerLifecycle = new TimerLifecycle({
  getTimer: async () => {
    if (!activeWorkspaceRoot) {
      try {
        const stored = await workspaceStore.get()
        if (!stored) return null
        activeWorkspaceRoot = (await validateWorkspace(stored)).root
      } catch {
        // A recovery screen has no active timer to persist and must still close.
        return null
      }
    }
    const service = await timerManager.get(activeWorkspaceRoot)
    latestTimerSnapshot = await service.get()
    return service
  },
  requestRendererFlush: () => mainWindow?.webContents.send(lifecycleEvents.beforeClose),
  permitClose: () => {
    allowWindowClose = true
    mainWindow?.close()
    if (quitRequested) app.quit()
  },
  publishError: publishTimerError
})

const showOpenDialog = (options: OpenDialogOptions): Promise<OpenDialogReturnValue> => (
  mainWindow ? dialog.showOpenDialog(mainWindow, options) : dialog.showOpenDialog(options)
)

const requireString = (value: unknown, label: string): string => {
  if (typeof value !== 'string' || !value) throw new Error(`${label} 必须是非空字符串`)
  return value
}

const requireDeleteTaskRequest = (value: unknown): DeleteTaskRequest => {
  if (!value || typeof value !== 'object') throw new Error('删除任务请求无效')
  const request = value as Record<string, unknown>
  if (!request.day || typeof request.day !== 'object') throw new Error('删除任务的每日文件句柄无效')
  const day = request.day as Record<string, unknown>
  return {
    day: {
      path: requireString(day.path, '每日文件路径'),
      revision: requireString(day.revision, '每日文件修订值')
    },
    taskId: requireString(request.taskId, '任务 ID')
  }
}

const openExternalHttpUrl = (url: string): void => {
  try {
    const protocol = new URL(url).protocol
    if ((protocol === 'https:' || protocol === 'http:') && process.env.MY_WAY_E2E !== '1') void shell.openExternal(url)
  } catch { /* malformed and non-web URLs stay blocked */ }
}

const requireWorkspace = async (): Promise<string> => {
  const stored = await workspaceStore.get()
  if (!stored) throw new Error('尚未选择 my-way 工作区')
  activeWorkspaceRoot = (await validateWorkspace(stored)).root
  return activeWorkspaceRoot
}

const startWatcher = async (root: string): Promise<void> => {
  const publishWatcherError = (event: FileWatchErrorEvent): void => {
    latestWatcherError = event
    mainWindow?.webContents.send('files:changed', event)
  }
  try {
    await workspaceWatcher.start(root, (event: FileWatchEvent) => {
      if (event.kind === 'error') {
        publishWatcherError(event)
        return
      }
      latestWatcherError = null
      void (async () => {
        try {
          await timerManager.handleFileChange(event)
        } catch (error) {
          publishTimerError(error)
        } finally {
          mainWindow?.webContents.send('files:changed', event)
        }
      })()
    })
    latestWatcherError = null
  } catch (error) {
    publishWatcherError({
      kind: 'error',
      message: `文件监听启动失败：${error instanceof Error ? error.message : String(error)}`,
      at: new Date().toISOString()
    })
  }
}

const createHandlers = (): HandlerMap => ({
  [ipcChannels.windowGetFullScreen]: async () => mainWindow?.isFullScreen() ?? false,
  [ipcChannels.windowExitFullScreen]: async () => { mainWindow?.setFullScreen(false) },
  [ipcChannels.workspaceSelect]: async () => {
    const selection = await showOpenDialog({ properties: ['openDirectory'], title: '选择 my-way 学习文件夹' })
    if (selection.canceled || !selection.filePaths[0]) return null
    const workspace = await validateWorkspace(selection.filePaths[0])
    await workspaceStore.set(workspace.root)
    activeWorkspaceRoot = workspace.root
    latestTimerSnapshot = undefined
    await timerManager.get(workspace.root)
    await startWatcher(workspace.root)
    return { root: workspace.root }
  },
  [ipcChannels.workspaceValidate]: async (path: unknown) => {
    const workspace = await validateWorkspace(requireString(path, '工作区路径'))
    return { root: workspace.root }
  },
  [ipcChannels.workspaceGet]: async () => {
    const root = await workspaceStore.get()
    if (!root) return null
    const workspace = await validateWorkspace(root)
    activeWorkspaceRoot = workspace.root
    return { root: workspace.root }
  },
  [ipcChannels.routeLoad]: async () => new StudyDataService(await requireWorkspace()).loadRoutes(),
  [ipcChannels.weekLoad]: async (date: unknown) => new StudyDataService(await requireWorkspace()).loadWeek(requireString(date, '日期')),
  [ipcChannels.weekDiff]: async (date: unknown, record: unknown) => new StudyDataService(await requireWorkspace()).diffWeek(requireString(date, '日期'), record as ParsedDailyRecord),
  [ipcChannels.weekContext]: async (date: unknown) => new WeekPlanningService(await requireWorkspace()).context(requireString(date, '日期')),
  [ipcChannels.weekSave]: async (request: unknown) => new WeekPlanningService(await requireWorkspace()).save(request as SaveWeekRequest),
  [ipcChannels.taskDelete]: async (payload: unknown) => new TaskDeletionService(await requireWorkspace()).deleteTask(requireDeleteTaskRequest(payload)),
  [ipcChannels.dayOpen]: async (date: unknown) => {
    const value = requireString(date, '日期')
    return new DailyFileService(await requireWorkspace()).open(value)
  },
  [ipcChannels.dayCreate]: async (date: unknown) => {
    const opened = await new DailyFileService(await requireWorkspace()).open(requireString(date, '日期'), { create: true })
    if (!opened) throw new Error('无法创建每日记录')
    return opened
  },
  [ipcChannels.daySave]: async (payload: unknown, options: unknown) => {
    const file = payload as VersionedFile<ParsedDailyRecord>
    const service = new DailyFileService(await requireWorkspace())
    return (options as { asConflictCopy?: boolean } | undefined)?.asConflictCopy
      ? service.saveConflictCopy(file.path, file.value)
      : service.save(file.path, file.value, file.revision)
  },
  [ipcChannels.dayResolveCarryover]: async (payload: unknown): Promise<CarryoverResult> => {
    const request = payload as CarryoverRequest
    const service = new DailyFileService(await requireWorkspace())
    return resolveAndPersistCarryover(service, request)
  },
  [ipcChannels.progressQuery]: async (dateFrom: unknown, dateTo: unknown) => new StudyDataService(await requireWorkspace()).queryProgress(requireString(dateFrom, '开始日期'), requireString(dateTo, '结束日期')),
  [ipcChannels.evidenceSelect]: async () => {
    const root = await requireWorkspace()
    const selection = await showOpenDialog({ properties: ['openFile'], defaultPath: root, title: '选择学习证据' })
    if (selection.canceled || !selection.filePaths[0]) return null
    return toWorkspaceRelativePath(root, selection.filePaths[0])
  },
  [ipcChannels.evidenceInspect]: async (relativePaths: unknown) => new EvidenceService(await requireWorkspace()).inspect(relativePaths as string[]),
  [ipcChannels.evidenceOpen]: async (relativePath: unknown) => {
    const path = await resolveSafePath(await requireWorkspace(), requireString(relativePath, '证据路径'), true)
    const failure = await shell.openPath(path)
    if (failure) throw new Error(failure)
  },
  [ipcChannels.timerGet]: async () => {
    const snapshot = await (await currentTimer()).get()
    latestTimerSnapshot = snapshot
    return snapshot
  },
  [ipcChannels.timerStart]: async (request: unknown) => (await currentTimer()).start(request as never),
  [ipcChannels.timerSetTaskIntent]: async (request: unknown) => (await currentTimer()).setTaskIntent(request as never),
  [ipcChannels.timerPause]: async () => (await currentTimer()).pause(),
  [ipcChannels.timerResume]: async () => (await currentTimer()).resume(),
  [ipcChannels.timerEnd]: async () => (await currentTimer()).end(),
  [ipcChannels.timerList]: async (request: unknown) => (await currentTimer()).list(request as never),
  [ipcChannels.timerAssignmentOptions]: async (sessionId: unknown) => (
    (await currentTimer()).assignmentOptions(sessionId as string)
  ),
  [ipcChannels.timerAssign]: async (request: unknown) => (await currentTimer()).assign(request as never),
  [ipcChannels.timerDiscard]: async (request: unknown) => (await currentTimer()).discard(request as never)
})

const createWindow = (): void => {
  allowWindowClose = false
  const rendererUrl = trustedDevelopmentRendererUrl(app.isPackaged, process.env.ELECTRON_RENDERER_URL)
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 760,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 18 },
    backgroundColor: '#f2f0e9',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  denyRendererPermissions(mainWindow.webContents.session)
  restrictRendererNetwork(mainWindow.webContents.session, rendererUrl)
  const window = mainWindow
  // Native fullscreen is asynchronous; publish only after AppKit completes the transition.
  const publishFullScreen = (): void => {
    if (!window.isDestroyed()) window.webContents.send(windowEvents.fullScreenChanged, window.isFullScreen())
  }
  window.on('enter-full-screen', publishFullScreen)
  window.on('leave-full-screen', publishFullScreen)
  mainWindow.on('closed', () => { mainWindow = null })
  mainWindow.on('close', (event) => {
    if (allowWindowClose) return
    event.preventDefault()
    void timerLifecycle.prepareClose().catch(() => undefined)
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    openExternalHttpUrl(url)
  })
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternalHttpUrl(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.once('did-finish-load', () => {
    if (latestWatcherError) mainWindow?.webContents.send('files:changed', latestWatcherError)
  })
  if (rendererUrl) void mainWindow.loadURL(rendererUrl)
  else void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
}

const isPrimaryInstance = installSingleInstanceGuard(app, {
  getWindow: () => mainWindow,
  createWindow
})

if (isPrimaryInstance) {
  app.whenReady().then(async () => {
    Menu.setApplicationMenu(Menu.buildFromTemplate(applicationMenuTemplate({
      isMac: process.platform === 'darwin',
      appName: 'My Way'
    })))
    workspaceStore = new WorkspaceStore(app.getPath('userData'))
    registerIpcHandlers(ipcMain as unknown as IpcMainLike, createHandlers())
    ipcMain.on(lifecycleEvents.readyToClose, () => {
      timerLifecycle.rendererReadyToClose()
    })
    ipcMain.on(lifecycleEvents.cancelClose, () => {
      timerLifecycle.cancelClosePreparation()
    })
    try {
      const stored = await workspaceStore.get()
      if (stored) {
        const root = (await validateWorkspace(stored)).root
        activeWorkspaceRoot = root
        await timerManager.get(root)
        await startWatcher(root)
      }
    } catch { /* renderer opens and shows the recoverable workspace error */ }
    createWindow()
    powerMonitor.on('suspend', () => { void timerLifecycle.handleSuspend().catch(() => undefined) })
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
  })

  app.on('before-quit', () => {
    quitRequested = true
  })
  app.on('will-quit', () => {
    void workspaceWatcher.stop()
    void timerManager.dispose()
  })
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
}
