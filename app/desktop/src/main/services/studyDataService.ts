import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { ProgressQueryResult, WeekDocument } from '../../shared/api'
import type { ParsedDailyRecord, RouteDocument, WeekPlanDiff } from '../../shared/types'
import { parseDailyRecord } from '../domain/dailyRecord'
import { diffWeeklyPlan } from '../domain/planDiff'
import { deriveMonthlyCells, deriveProgress } from '../domain/progress'
import { resolveSafePath } from './workspaceService'
import { VersionedFileTransaction } from './versionedFileTransaction'
import { loadValidatedWeekDocuments } from './weekDocuments'

const routeDefinitions: Array<Pick<RouteDocument, 'id' | 'title'> & { relativePath: string }> = [
  { id: 'twelve-week', title: '12 周路线', relativePath: '00-dashboard/12-week-roadmap.md' },
  { id: 'long-term', title: '长期路线', relativePath: '00-dashboard/long-term-roadmap.md' },
  { id: 'current-status', title: '当前能力门槛', relativePath: '00-dashboard/current-status.md' }
]

export class StudyDataService {
  constructor(private readonly workspaceRoot: string) {}

  async loadWeek(date: string): Promise<WeekDocument | null> {
    const documents = await loadValidatedWeekDocuments(this.workspaceRoot)
    return documents.find((document) => document.value.plan.startDate <= date && date <= document.value.plan.endDate) ?? null
  }

  async diffWeek(date: string, record: ParsedDailyRecord): Promise<WeekPlanDiff | null> {
    const week = await this.loadWeek(date)
    return week ? diffWeeklyPlan(week.value.plan, record) : null
  }

  async loadRoutes(): Promise<RouteDocument[]> {
    return Promise.all(routeDefinitions.map(async (route) => {
      const path = await resolveSafePath(this.workspaceRoot, route.relativePath, true)
      return { id: route.id, title: route.title, path, content: await readFile(path, 'utf8') }
    }))
  }

  async queryProgress(dateFrom: string, dateTo: string): Promise<ProgressQueryResult> {
    if (dateFrom > dateTo) throw new Error('进度查询的结束日期不能早于开始日期')
    await new VersionedFileTransaction(undefined, {}, this.workspaceRoot).recoverAll()
    const records = await this.loadDailyRecords(dateFrom, dateTo)
    return { summary: deriveProgress(records), month: deriveMonthlyCells(records) }
  }

  async loadDailyRecords(dateFrom: string, dateTo: string): Promise<ParsedDailyRecord[]> {
    const records: ParsedDailyRecord[] = []
    for (let year = Number(dateFrom.slice(0, 4)); year <= Number(dateTo.slice(0, 4)); year += 1) {
      let directory: string
      try {
        directory = await resolveSafePath(this.workspaceRoot, `data/daily/${year}`, true)
      } catch (error) {
        if (error instanceof Error && error.message.includes('不存在')) continue
        throw error
      }
      const names = (await readdir(directory)).filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name)).sort()
      for (const name of names) {
        const date = name.slice(0, 10)
        if (date < dateFrom || date > dateTo) continue
        const path = join(directory, name)
        const record = parseDailyRecord(await readFile(path, 'utf8'), path)
        if (record.date !== date) throw new Error(`每日记录日期 ${record.date} 与文件名 ${name} 不一致`)
        records.push(record)
      }
    }
    return records
  }
}
