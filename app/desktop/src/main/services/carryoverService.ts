import type { CarryoverRequest, CarryoverResult, DayOpenResult } from '../../shared/api'
import type { ParsedDailyRecord, VersionedFile } from '../../shared/types'
import { resolveCarryover } from '../domain/carryover'
import { isTaskPending } from '../../shared/taskProgress'

export interface CarryoverStore {
  open(date: string, options: { create: boolean }): Promise<DayOpenResult | null>
  save(path: string, record: ParsedDailyRecord, expectedRevision: string): Promise<VersionedFile<ParsedDailyRecord>>
}

export const resolveAndPersistCarryover = async (service: CarryoverStore, request: CarryoverRequest): Promise<CarryoverResult> => {
  const sourceTask = request.source.value.tasks.find((task) => task.id === request.taskId)
  if (!sourceTask) throw new Error(`找不到待处理任务：${request.taskId}`)
  if (!isTaskPending(sourceTask)) throw new Error(`任务 ${request.taskId} 已经结束，不能顺延`)
  if (request.choice.action === 'keep_overdue') return { source: request.source }
  if (request.choice.action !== 'reschedule') {
    const resolved = resolveCarryover(request.source.value, request.source.value, request.taskId, request.choice)
    return { source: await service.save(request.source.path, resolved.source, request.source.revision) }
  }

  const opened = await service.open(request.targetDate, { create: true })
  if (!opened) throw new Error('无法创建顺延目标记录')
  const lineageId = sourceTask.sourceTaskId ?? sourceTask.id
  const existingTarget = opened.file.value.tasks.find((task) => task.originalDate === sourceTask.originalDate && (task.sourceTaskId === lineageId || task.id === `${lineageId}@${request.targetDate}`))
  if (existingTarget) {
    const sourceOnly = resolveCarryover(request.source.value, { ...opened.file.value, tasks: [] }, request.taskId, request.choice).source
    // A retry may be finishing an old full-budget transfer. Reflect the
    // budget already present at the destination without adding another copy.
    sourceOnly.tasks = sourceOnly.tasks.map((task) => task.id === request.taskId
      ? { ...task, rescheduledMinutes: Math.min(task.plannedMinutes, existingTarget.plannedMinutes) }
      : task)
    const source = await service.save(request.source.path, sourceOnly, request.source.revision)
    return { source, target: opened.file }
  }
  const resolved = resolveCarryover(request.source.value, opened.file.value, request.taskId, request.choice)

  // Write the target first: a target failure leaves the source untouched. If the
  // source then conflicts, conditionally restore the target's original snapshot.
  const target = await service.save(opened.file.path, resolved.target, opened.file.revision)
  try {
    const source = await service.save(request.source.path, resolved.source, request.source.revision)
    return { source, target }
  } catch (sourceError) {
    try {
      await service.save(target.path, opened.file.value, target.revision)
    } catch (rollbackError) {
      throw new AggregateError([sourceError, rollbackError], '顺延源记录保存失败，目标记录回滚也失败；任务副本已保留以避免丢失')
    }
    throw sourceError
  }
}
