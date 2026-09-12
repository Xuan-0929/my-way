import { ipcChannels, type AppError, type Result } from '../../shared/api'
import {
  assignmentOptionsSessionIdSchema,
  assignTimerRequestSchema,
  discardTimerRequestSchema,
  setTimerTaskIntentRequestSchema,
  startTimerRequestSchema,
  timerListRequestSchema
} from '../../shared/timerSchemas'
import {
  carryoverRequestSchema,
  deleteTaskRequestSchema,
  evidenceInspectRequestSchema,
  isoDateSchema,
  progressQueryArgumentsSchema,
  safeRelativePathSchema,
  saveWeekRequestSchema,
  versionedDailyRecordSchema,
  workspacePathSchema
} from '../../shared/schemas'
import { ZodError, z } from 'zod'
import { RevisionConflictError } from '../services/dailyFileService'

export interface IpcMainLike {
  handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown): void
}

export type HandlerMap = Record<string, (...args: never[]) => unknown | Promise<unknown>>

const filesystemErrorCode = (error: Error): AppError['code'] | null => {
  const errno = (error as NodeJS.ErrnoException).code
  if (errno === 'ENOENT') return 'NOT_FOUND'
  if (errno === 'EACCES' || errno === 'EPERM' || errno === 'EROFS') return 'READ_ONLY'
  if (errno === 'ENOSPC' || errno === 'EIO' || errno === 'EMFILE' || errno === 'ENFILE') return 'IO'
  return null
}

export const toAppError = (error: unknown): AppError => {
  if (error instanceof RevisionConflictError) {
    return { code: 'CONFLICT', message: error.message, currentRevision: error.currentRevision }
  }
  if (error instanceof ZodError) return { code: 'VALIDATION', message: error.message }
  if (error instanceof Error) {
    const filesystemCode = filesystemErrorCode(error)
    const filesystemPath = (error as NodeJS.ErrnoException).path
    if (filesystemCode) {
      return {
        code: filesystemCode,
        message: error.message,
        ...(typeof filesystemPath === 'string' ? { path: filesystemPath } : {})
      }
    }
    const timerPath = /^(.+?data\/timer\/(?:state\.json|\d{4}\/\d{4}-\d{2}-\d{2}\.md)):/.exec(error.message)?.[1]
    if (timerPath) return { code: 'READ_ONLY', message: error.message, path: timerPath }
    const code = /不存在|找不到/.test(error.message) ? 'NOT_FOUND'
      : /无效|必须|越界|schema|YAML|日期|工作区|超过/.test(error.message) ? 'VALIDATION'
        : 'UNKNOWN'
    return { code, message: error.message }
  }
  return { code: 'UNKNOWN', message: String(error) }
}

const noArgumentsSchema = z.tuple([])
const daySaveOptionsSchema = z.object({ asConflictCopy: z.boolean().optional() }).strict().optional()

const validatedArguments = (channel: string, args: unknown[]): unknown[] => {
  switch (channel) {
    case ipcChannels.windowGetFullScreen:
    case ipcChannels.windowExitFullScreen:
    case ipcChannels.workspaceSelect:
    case ipcChannels.workspaceGet:
    case ipcChannels.routeLoad:
    case ipcChannels.evidenceSelect:
    case ipcChannels.timerGet:
    case ipcChannels.timerPause:
    case ipcChannels.timerResume:
    case ipcChannels.timerEnd:
      noArgumentsSchema.parse(args)
      return []
    case ipcChannels.workspaceValidate:
      return z.tuple([workspacePathSchema]).parse(args)
    case ipcChannels.weekLoad:
    case ipcChannels.dayOpen:
    case ipcChannels.dayCreate:
      return z.tuple([isoDateSchema]).parse(args)
    case ipcChannels.timerStart:
      return z.tuple([startTimerRequestSchema]).parse(args)
    case ipcChannels.timerSetTaskIntent:
      return z.tuple([setTimerTaskIntentRequestSchema]).parse(args)
    case ipcChannels.timerList:
      return z.tuple([timerListRequestSchema]).parse(args)
    case ipcChannels.timerAssignmentOptions:
      return z.tuple([assignmentOptionsSessionIdSchema]).parse(args)
    case ipcChannels.timerAssign:
      return z.tuple([assignTimerRequestSchema]).parse(args)
    case ipcChannels.timerDiscard:
      return z.tuple([discardTimerRequestSchema]).parse(args)
    case ipcChannels.weekContext:
      return z.tuple([isoDateSchema]).parse(args)
    case ipcChannels.weekDiff:
      return z.tuple([isoDateSchema, versionedDailyRecordSchema.shape.value]).parse(args)
    case ipcChannels.weekSave:
      return z.tuple([saveWeekRequestSchema]).parse(args)
    case ipcChannels.taskDelete:
      return z.tuple([deleteTaskRequestSchema]).parse(args)
    case ipcChannels.daySave:
      return z.tuple([versionedDailyRecordSchema, daySaveOptionsSchema]).parse(args)
    case ipcChannels.dayResolveCarryover:
      return z.tuple([carryoverRequestSchema]).parse(args)
    case ipcChannels.progressQuery:
      return progressQueryArgumentsSchema.parse(args)
    case ipcChannels.evidenceInspect:
      return z.tuple([evidenceInspectRequestSchema]).parse(args)
    case ipcChannels.evidenceOpen:
      return z.tuple([safeRelativePathSchema]).parse(args)
    default:
      throw new Error(`缺少 IPC 参数 schema：${channel}`)
  }
}

export const registerIpcHandlers = (ipcMain: IpcMainLike, handlers: HandlerMap): void => {
  for (const channel of Object.values(ipcChannels)) {
    const handler = handlers[channel]
    if (!handler) throw new Error(`缺少 IPC handler：${channel}`)
    ipcMain.handle(channel, async (_event, ...args): Promise<Result<unknown>> => {
      try {
        return { ok: true, value: await handler(...validatedArguments(channel, args) as never[]) }
      } catch (error) {
        return { ok: false, error: toAppError(error) }
      }
    })
  }
}
