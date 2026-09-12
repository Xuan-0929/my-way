import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative } from 'node:path'
import type { ParsedDailyRecord, VersionedFile } from '../../shared/types'
import type { WeeklyPlan } from '../../shared/schemas'
import { parseDailyRecord, serializeDailyRecord } from '../domain/dailyRecord'
import { resolveSafePath } from './workspaceService'
import { VersionedFileTransaction, revisionOf, type VersionedFileTransactionHooks } from './versionedFileTransaction'
import { loadValidatedWeekDocuments } from './weekDocuments'

export { RevisionConflictError } from './versionedFileTransaction'

export interface OpenDayResult {
  file: VersionedFile<ParsedDailyRecord>
  created: boolean
  missingPlan: boolean
}

export type DailyFileServiceHooks = VersionedFileTransactionHooks

const assertDate = (date: string): void => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) {
    throw new Error(`无效日期：${date}`)
  }
}

export class DailyFileService {
  private readonly files: VersionedFileTransaction

  constructor(
    private readonly workspaceRoot: string,
    private readonly now: () => Date = () => new Date(),
    hooks: DailyFileServiceHooks = {}
  ) {
    this.files = new VersionedFileTransaction(now, hooks, workspaceRoot)
  }

  async open(date: string, options: { create: boolean } = { create: false }): Promise<OpenDayResult | null> {
    assertDate(date)
    const path = await this.dayPath(date)
    const existing = await this.readExisting(path)
    if (existing) return { file: existing, created: false, missingPlan: existing.value.sourceWeek === null }
    if (!options.create) return null

    const plan = await this.findPlan(date)
    const record: ParsedDailyRecord = {
      schemaVersion: 1,
      date,
      sourceWeek: plan?.week ?? null,
      tasks: (plan?.tasks ?? []).filter((task) => task.date === date).map((task) => ({
        ...task,
        sourceTaskId: task.id,
        originalDate: task.date,
        actualMinutes: 0,
        status: 'planned' as const,
        evidence: [],
        notes: '',
        outcomes: ''
      })),
      reflection: { learned: '', blockers: '', tomorrow: '' },
      pastExams: [],
      updatedAt: this.now().toISOString(),
      notes: ''
    }
    const content = serializeDailyRecord(record)
    const installed = await this.files.create(path, content)
    if (!installed) {
      const raced = await this.readExisting(path)
      if (!raced) throw new Error(`每日记录并发创建失败：${path}`)
      return { file: raced, created: false, missingPlan: raced.value.sourceWeek === null }
    }
    return { file: { path, revision: revisionOf(content), value: record }, created: true, missingPlan: !plan }
  }

  async save(path: string, record: ParsedDailyRecord, expectedRevision: string): Promise<VersionedFile<ParsedDailyRecord>> {
    const safePath = await this.validateDailyPath(path, false)
    this.assertRecordDate(safePath, record)
    await this.files.recover(safePath)
    const value = { ...record, updatedAt: this.now().toISOString() }
    const content = serializeDailyRecord(value)
    await this.files.replace(safePath, content, expectedRevision)
    return { path: safePath, revision: revisionOf(content), value }
  }

  async saveConflictCopy(path: string, record: ParsedDailyRecord): Promise<VersionedFile<ParsedDailyRecord>> {
    const safePath = await this.validateDailyPath(path, false)
    this.assertRecordDate(safePath, record)
    const value = { ...record, updatedAt: this.now().toISOString() }
    const content = serializeDailyRecord(value)
    const stamp = this.now().toISOString().replace(/[-:.]/g, '')
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const copyPath = join(dirname(safePath), `${basename(safePath, '.md')}.conflict-${stamp}-${randomUUID()}.md`)
      if (await this.files.create(copyPath, content)) return { path: copyPath, revision: revisionOf(content), value }
    }
    throw new Error('无法建立冲突副本')
  }

  private async dayPath(date: string): Promise<string> {
    return resolveSafePath(this.workspaceRoot, `data/daily/${date.slice(0, 4)}/${date}.md`, false)
  }

  private async validateDailyPath(path: string, mustExist = true): Promise<string> {
    const canonicalRoot = await realpath(this.workspaceRoot)
    const relativePath = (isAbsolute(path) ? relative(canonicalRoot, path) : path).split('\\').join('/')
    if (!/^data\/daily\/\d{4}\/\d{4}-\d{2}-\d{2}\.md$/.test(relativePath)) {
      throw new Error('只能写入 data/daily/YYYY/YYYY-MM-DD.md')
    }
    return resolveSafePath(this.workspaceRoot, relativePath, mustExist)
  }

  private assertRecordDate(path: string, record: ParsedDailyRecord): void {
    const fileDate = basename(path, '.md')
    if (record.date !== fileDate) throw new Error(`每日记录日期 ${record.date} 与文件名 ${fileDate}.md 不一致`)
  }

  private async readExisting(path: string): Promise<VersionedFile<ParsedDailyRecord> | null> {
    try {
      await this.files.recover(path)
      const content = await readFile(path, 'utf8')
      return { path, revision: revisionOf(content), value: parseDailyRecord(content, path) }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'ENOENT') return null
      throw error
    }
  }

  private async findPlan(date: string): Promise<WeeklyPlan | null> {
    const documents = await loadValidatedWeekDocuments(this.workspaceRoot, this.files)
    return documents.find((document) => document.value.plan.startDate <= date && date <= document.value.plan.endDate)?.value.plan ?? null
  }

}
