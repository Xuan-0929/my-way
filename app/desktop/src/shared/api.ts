import type { ParsedDailyRecord, ProgressSummary, RouteDocument, VersionedFile, WeekPlanDiff, MonthlyProgressCell } from './types'
import type { WeeklyPlan } from './schemas'
import type { PreviousTaskOutcome } from './weekPlanning'
import type {
  AssignTimerRequest,
  AssignTimerResult,
  DiscardTimerRequest,
  EndedTimerResult,
  StartTimerRequest,
  SetTimerTaskIntentRequest,
  TimerAssignmentOptions,
  TimerListRequest,
  TimerListResult,
  TimerSnapshot,
  TimerSubscriptionListener
} from './timerTypes'

export type ErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'CONFLICT' | 'READ_ONLY' | 'IO' | 'UNKNOWN'

export interface AppError {
  code: ErrorCode
  message: string
  path?: string
  currentRevision?: string
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError }

export interface WorkspaceInfo { root: string }
export type WeekDocument = VersionedFile<{ plan: WeeklyPlan; body: string }>
export interface PreviousWeekContext {
  document: WeekDocument
  tasks: PreviousTaskOutcome[]
  summary: ProgressSummary
}
export interface WeekPlanningContext {
  date: string
  startDate: string
  endDate: string
  suggestedWeek: number
  current: WeekDocument | null
  previous: PreviousWeekContext | null
  summary: ProgressSummary
}
export interface SaveWeekRequest {
  expectedRevision: string | null
  plan: WeeklyPlan
  body: string
  asConflictCopy?: boolean
}
export interface DayOpenResult { file: VersionedFile<ParsedDailyRecord>; created: boolean; missingPlan: boolean }
export interface ProgressQueryResult { summary: ProgressSummary; month: MonthlyProgressCell[] }
export interface DeleteTaskRequest {
  day: Pick<VersionedFile<ParsedDailyRecord>, 'path' | 'revision'>
  taskId: string
}
export interface DeleteTaskResult {
  day: VersionedFile<ParsedDailyRecord>
  week?: WeekDocument
}
export interface CarryoverRequest {
  source: VersionedFile<ParsedDailyRecord>
  targetDate: string
  taskId: string
  choice: { action: 'skip' | 'keep_overdue' } | { action: 'reschedule'; targetDate: string }
}
export interface CarryoverResult {
  source: VersionedFile<ParsedDailyRecord>
  target?: VersionedFile<ParsedDailyRecord>
}

export interface EvidenceInspection {
  path: string
  status: 'available' | 'missing' | 'blocked'
  message?: string
}

export interface FileChangeEvent {
  kind: 'changed' | 'added' | 'removed'
  path: string
  at: string
}

export interface FileWatchErrorEvent {
  kind: 'error'
  message: string
  at: string
}

export type FileWatchEvent = FileChangeEvent | FileWatchErrorEvent

export const ipcChannels = {
  windowGetFullScreen: 'window:get-full-screen',
  windowExitFullScreen: 'window:exit-full-screen',
  workspaceSelect: 'workspace:select',
  workspaceValidate: 'workspace:validate',
  workspaceGet: 'workspace:get',
  routeLoad: 'route:load',
  weekLoad: 'week:load',
  weekDiff: 'week:diff',
  weekContext: 'week:context',
  weekSave: 'week:save',
  taskDelete: 'task:delete',
  dayOpen: 'day:open',
  daySave: 'day:save',
  dayCreate: 'day:create',
  dayResolveCarryover: 'day:resolveCarryover',
  progressQuery: 'progress:query',
  evidenceSelect: 'evidence:select',
  evidenceInspect: 'evidence:inspect',
  evidenceOpen: 'evidence:open',
  timerGet: 'timer:get',
  timerStart: 'timer:start',
  timerSetTaskIntent: 'timer:setTaskIntent',
  timerPause: 'timer:pause',
  timerResume: 'timer:resume',
  timerEnd: 'timer:end',
  timerList: 'timer:list',
  timerAssignmentOptions: 'timer:assignmentOptions',
  timerAssign: 'timer:assign',
  timerDiscard: 'timer:discard'
} as const

export const windowEvents = {
  fullScreenChanged: 'window:full-screen-changed'
} as const

export const timerEvents = {
  changed: 'timer:changed'
} as const

export const lifecycleEvents = {
  beforeClose: 'app:before-close',
  readyToClose: 'app:close-ready',
  cancelClose: 'app:close-cancelled'
} as const

export interface DesktopApi {
  window: {
    getFullScreen(): Promise<Result<boolean>>
    exitFullScreen(): Promise<Result<void>>
    onFullScreenChanged(listener: (fullScreen: boolean) => void): () => void
  }
  workspace: {
    select(): Promise<Result<WorkspaceInfo | null>>
    validate(path: string): Promise<Result<WorkspaceInfo>>
    get(): Promise<Result<WorkspaceInfo | null>>
  }
  route: { load(): Promise<Result<RouteDocument[]>> }
  week: {
    load(date: string): Promise<Result<WeekDocument | null>>
    diff(date: string, record: ParsedDailyRecord): Promise<Result<WeekPlanDiff | null>>
    context(date: string): Promise<Result<WeekPlanningContext>>
    save(request: SaveWeekRequest): Promise<Result<WeekDocument>>
  }
  task: {
    delete(payload: DeleteTaskRequest): Promise<Result<DeleteTaskResult>>
  }
  day: {
    open(date: string): Promise<Result<DayOpenResult | null>>
    create(date: string): Promise<Result<DayOpenResult>>
    save(file: VersionedFile<ParsedDailyRecord>, options?: { asConflictCopy?: boolean }): Promise<Result<VersionedFile<ParsedDailyRecord>>>
    resolveCarryover(payload: CarryoverRequest): Promise<Result<CarryoverResult>>
  }
  progress: { query(dateFrom: string, dateTo: string): Promise<Result<ProgressQueryResult>> }
  evidence: {
    select(): Promise<Result<string | null>>
    inspect(relativePaths: string[]): Promise<Result<EvidenceInspection[]>>
    open(relativePath: string): Promise<Result<void>>
  }
  timer: {
    get(): Promise<Result<TimerSnapshot>>
    start(request: StartTimerRequest): Promise<Result<TimerSnapshot>>
    setTaskIntent(request: SetTimerTaskIntentRequest): Promise<Result<TimerSnapshot>>
    pause(): Promise<Result<TimerSnapshot>>
    resume(): Promise<Result<TimerSnapshot>>
    end(): Promise<Result<EndedTimerResult>>
    list(request: TimerListRequest): Promise<Result<TimerListResult>>
    assignmentOptions(sessionId: string): Promise<Result<TimerAssignmentOptions>>
    assign(request: AssignTimerRequest): Promise<Result<AssignTimerResult>>
    discard(request: DiscardTimerRequest): Promise<Result<TimerListResult>>
    subscribe(listener: TimerSubscriptionListener): () => void
  }
  files: { subscribe(listener: (event: FileWatchEvent) => void): () => void }
  lifecycle: {
    onBeforeClose(listener: () => void): () => void
    readyToClose(): void
    cancelClose(): void
  }
}
