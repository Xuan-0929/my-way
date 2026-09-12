import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels, lifecycleEvents, timerEvents, windowEvents, type DesktopApi, type FileWatchEvent } from '../shared/api'
import type { TimerSnapshot } from '../shared/timerTypes'

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>

const api: DesktopApi = {
  window: {
    getFullScreen: () => invoke(ipcChannels.windowGetFullScreen),
    exitFullScreen: () => invoke(ipcChannels.windowExitFullScreen),
    onFullScreenChanged: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, fullScreen: boolean): void => listener(fullScreen)
      ipcRenderer.on(windowEvents.fullScreenChanged, handler)
      return () => ipcRenderer.removeListener(windowEvents.fullScreenChanged, handler)
    }
  },
  workspace: {
    select: () => invoke(ipcChannels.workspaceSelect),
    validate: (path) => invoke(ipcChannels.workspaceValidate, path),
    get: () => invoke(ipcChannels.workspaceGet)
  },
  route: { load: () => invoke(ipcChannels.routeLoad) },
  week: {
    load: (date) => invoke(ipcChannels.weekLoad, date),
    diff: (date, record) => invoke(ipcChannels.weekDiff, date, record),
    context: (date) => invoke(ipcChannels.weekContext, date),
    save: (request) => invoke(ipcChannels.weekSave, request)
  },
  task: {
    delete: (payload) => invoke(ipcChannels.taskDelete, payload)
  },
  day: {
    open: (date) => invoke(ipcChannels.dayOpen, date),
    create: (date) => invoke(ipcChannels.dayCreate, date),
    save: (file, options) => invoke(ipcChannels.daySave, file, options),
    resolveCarryover: (payload) => invoke(ipcChannels.dayResolveCarryover, payload)
  },
  progress: { query: (dateFrom, dateTo) => invoke(ipcChannels.progressQuery, dateFrom, dateTo) },
  evidence: {
    select: () => invoke(ipcChannels.evidenceSelect),
    inspect: (relativePaths) => invoke(ipcChannels.evidenceInspect, relativePaths),
    open: (relativePath) => invoke(ipcChannels.evidenceOpen, relativePath)
  },
  timer: {
    get: () => invoke(ipcChannels.timerGet),
    start: (request) => invoke(ipcChannels.timerStart, request),
    setTaskIntent: (request) => invoke(ipcChannels.timerSetTaskIntent, request),
    pause: () => invoke(ipcChannels.timerPause),
    resume: () => invoke(ipcChannels.timerResume),
    end: () => invoke(ipcChannels.timerEnd),
    list: (request) => invoke(ipcChannels.timerList, request),
    assignmentOptions: (sessionId) => invoke(ipcChannels.timerAssignmentOptions, sessionId),
    assign: (request) => invoke(ipcChannels.timerAssign, request),
    discard: (request) => invoke(ipcChannels.timerDiscard, request),
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, snapshot: TimerSnapshot): void => listener(snapshot)
      ipcRenderer.on(timerEvents.changed, handler)
      return () => ipcRenderer.removeListener(timerEvents.changed, handler)
    }
  },
  files: {
    subscribe: (listener) => {
      const handler = (_event: Electron.IpcRendererEvent, event: FileWatchEvent): void => listener(event)
      ipcRenderer.on('files:changed', handler)
      return () => ipcRenderer.removeListener('files:changed', handler)
    }
  },
  lifecycle: {
    onBeforeClose: (listener) => {
      const handler = (): void => listener()
      ipcRenderer.on(lifecycleEvents.beforeClose, handler)
      return () => ipcRenderer.removeListener(lifecycleEvents.beforeClose, handler)
    },
    readyToClose: () => ipcRenderer.send(lifecycleEvents.readyToClose),
    cancelClose: () => ipcRenderer.send(lifecycleEvents.cancelClose)
  }
}

contextBridge.exposeInMainWorld('myWay', api)
