import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { format, parseISO, subDays } from 'date-fns'
import type { SaveWeekRequest, WeekDocument, WeekPlanningContext } from '../../shared/api'
import { weeklyPlanSchema, type WeeklyPlan } from '../../shared/schemas'
import { derivePreviousTaskOutcomes, naturalWeekRange, suggestWeekNumber } from '../../shared/weekPlanning'
import { parseWeeklyPlan, serializeWeeklyPlan } from '../domain/weeklyPlan'
import { deriveProgress } from '../domain/progress'
import { resolveSafePath } from './workspaceService'
import { StudyDataService } from './studyDataService'
import { RevisionConflictError, VersionedFileTransaction, revisionOf } from './versionedFileTransaction'
import { assertNaturalWeek, loadValidatedWeekDocuments } from './weekDocuments'

export class WeekPlanningService {
  private readonly files: VersionedFileTransaction

  constructor(
    private readonly workspaceRoot: string,
    private readonly now: () => Date = () => new Date(),
    files?: VersionedFileTransaction
  ) {
    this.files = files ?? new VersionedFileTransaction(this.now, {}, workspaceRoot)
  }

  private async listWeeks(): Promise<WeekDocument[]> {
    return loadValidatedWeekDocuments(this.workspaceRoot, this.files)
  }

  async context(date: string): Promise<WeekPlanningContext> {
    const { startDate, endDate } = naturalWeekRange(date)
    const documents = await this.listWeeks()
    const current = documents.find((document) => document.value.plan.startDate <= date && date <= document.value.plan.endDate) ?? null
    const suggestedWeek = current?.value.plan.week ?? suggestWeekNumber(
      documents.map((document) => ({ week: document.value.plan.week, startDate: document.value.plan.startDate })),
      startDate
    )
    const previousDocument = [...documents]
      .filter((document) => document.value.plan.endDate < startDate)
      .sort((left, right) => right.value.plan.endDate.localeCompare(left.value.plan.endDate))[0] ?? null
    const studyData = new StudyDataService(this.workspaceRoot)
    const currentRecords = await studyData.loadDailyRecords(startDate, endDate)
    let previous: WeekPlanningContext['previous'] = null
    if (previousDocument) {
      const outcomeEnd = format(subDays(parseISO(startDate), 1), 'yyyy-MM-dd')
      const outcomeRecords = await studyData.loadDailyRecords(previousDocument.value.plan.startDate, outcomeEnd)
      const summaryRecords = outcomeRecords.filter((record) => record.date <= previousDocument.value.plan.endDate)
      previous = {
        document: previousDocument,
        tasks: derivePreviousTaskOutcomes(previousDocument.value.plan, outcomeRecords),
        summary: deriveProgress(summaryRecords)
      }
    }
    return {
      date,
      startDate,
      endDate,
      suggestedWeek,
      current,
      previous,
      summary: deriveProgress(currentRecords)
    }
  }

  async save(request: SaveWeekRequest): Promise<WeekDocument> {
    const plan = weeklyPlanSchema.parse(request.plan)
    assertNaturalWeek(plan)
    if (request.asConflictCopy) return this.saveConflictCopy(plan, request.body)
    const filename = `week-${String(plan.week).padStart(2, '0')}.md`
    const overlap = (await this.listWeeks()).find((document) => {
      if (basename(document.path) === filename) return false
      const existing = document.value.plan
      return plan.startDate <= existing.endDate && existing.startDate <= plan.endDate
    })
    if (overlap) {
      throw new Error(`周计划日期范围重叠：Week ${overlap.value.plan.week} 与 Week ${plan.week}`)
    }
    const relativePath = `00-dashboard/weeks/${filename}`
    const content = serializeWeeklyPlan(plan, request.body)
    const path = await resolveSafePath(this.workspaceRoot, relativePath, request.expectedRevision !== null)
    if (basename(path) !== filename) throw new Error('周计划目标文件名无效')
    if (request.expectedRevision === null) {
      if (!(await this.files.create(path, content))) throw new RevisionConflictError('exists')
    } else {
      await this.files.replace(path, content, request.expectedRevision)
    }
    const authoritative = await readFile(await resolveSafePath(this.workspaceRoot, relativePath, true), 'utf8')
    return {
      path,
      revision: revisionOf(authoritative),
      value: parseWeeklyPlan(authoritative, path)
    }
  }

  private async saveConflictCopy(plan: WeeklyPlan, body: string): Promise<WeekDocument> {
    const content = serializeWeeklyPlan(plan, body)
    const stamp = this.now().toISOString().replace(/[-:.]/g, '')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const filename = `week-${String(plan.week).padStart(2, '0')}.conflict-${stamp}-${randomUUID()}.md`
      const path = await resolveSafePath(this.workspaceRoot, `00-dashboard/weeks/${filename}`, false)
      if (await this.files.create(path, content)) {
        return {
          path,
          revision: revisionOf(content),
          value: parseWeeklyPlan(content, path)
        }
      }
    }
    throw new Error('无法建立周计划冲突副本')
  }
}
