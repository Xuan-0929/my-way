import { readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative } from 'node:path'
import type { DeleteTaskRequest, DeleteTaskResult } from '../../shared/api'
import { parseDailyRecord, serializeDailyRecord } from '../domain/dailyRecord'
import { serializeWeeklyPlan } from '../domain/weeklyPlan'
import { resolveSafePath } from './workspaceService'
import { StudyDataService } from './studyDataService'
import { RevisionConflictError, VersionedFileTransaction, revisionOf } from './versionedFileTransaction'

const validateDailyPath = async (workspaceRoot: string, path: string): Promise<string> => {
  const canonicalRoot = await realpath(workspaceRoot)
  const relativePath = isAbsolute(path) ? relative(canonicalRoot, path) : path
  if (!/^data\/daily\/\d{4}\/\d{4}-\d{2}-\d{2}\.md$/.test(relativePath)) {
    throw new Error('只能删除 data/daily/YYYY/YYYY-MM-DD.md 中的任务')
  }
  return resolveSafePath(workspaceRoot, relativePath, true)
}

export class TaskDeletionService {
  private readonly files: VersionedFileTransaction

  constructor(
    private readonly workspaceRoot: string,
    private readonly now: () => Date = () => new Date(),
    files?: VersionedFileTransaction
  ) {
    this.files = files ?? new VersionedFileTransaction(now, {}, workspaceRoot)
  }

  async deleteTask(request: DeleteTaskRequest): Promise<DeleteTaskResult> {
    await this.files.recoverAll()
    const dayPath = await validateDailyPath(this.workspaceRoot, request.day.path)
    const diskContent = await readFile(dayPath, 'utf8')
    const diskRevision = revisionOf(diskContent)
    if (diskRevision !== request.day.revision) throw new RevisionConflictError(diskRevision)
    const diskDay = parseDailyRecord(diskContent, dayPath)
    const task = diskDay.tasks.find((candidate) => candidate.id === request.taskId)
    if (!task) throw new Error(`找不到待删除任务：${request.taskId}`)

    const nextDay = {
      ...diskDay,
      tasks: diskDay.tasks.filter((candidate) => candidate.id !== request.taskId),
      updatedAt: this.now().toISOString()
    }
    const dayContent = serializeDailyRecord(nextDay)
    const rootId = task.sourceTaskId ?? task.id
    const week = await new StudyDataService(this.workspaceRoot).loadWeek(task.originalDate)
    const plannedTasks = week?.value.plan.tasks.filter((candidate) => candidate.id === rootId) ?? []
    const expectsWeeklySource = Boolean(task.sourceTaskId)

    if (!week || plannedTasks.length === 0) {
      if (expectsWeeklySource) throw new Error(`找不到任务 ${request.taskId} 的周计划来源任务：${rootId}`)
      const revision = await this.files.replace(dayPath, dayContent, request.day.revision)
      return { day: { path: dayPath, revision, value: nextDay } }
    }
    if (plannedTasks.length !== 1) throw new Error(`周计划来源任务不唯一：${rootId}`)
    if (!expectsWeeklySource && plannedTasks[0].date !== task.originalDate) {
      throw new Error(`任务来源日期 ${task.originalDate} 与周计划日期 ${plannedTasks[0].date} 不一致`)
    }

    const nextWeekValue = {
      plan: {
        ...week.value.plan,
        tasks: week.value.plan.tasks.filter((candidate) => candidate.id !== rootId)
      },
      body: week.value.body
    }
    const weekContent = serializeWeeklyPlan(nextWeekValue.plan, nextWeekValue.body)
    const [dayRevision, weekRevision] = await this.files.replaceMany([
      { path: dayPath, content: dayContent, expectedRevision: request.day.revision },
      { path: week.path, content: weekContent, expectedRevision: week.revision }
    ])

    return {
      day: { path: dayPath, revision: dayRevision, value: nextDay },
      week: { path: week.path, revision: weekRevision, value: nextWeekValue }
    }
  }
}
