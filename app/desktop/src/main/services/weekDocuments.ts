import { readFile, readdir } from 'node:fs/promises'
import type { WeekDocument } from '../../shared/api'
import { naturalWeekRange } from '../../shared/weekPlanning'
import { parseWeeklyPlan } from '../domain/weeklyPlan'
import { resolveSafePath } from './workspaceService'
import { VersionedFileTransaction, revisionOf } from './versionedFileTransaction'

const STRICT_WEEK_NAME = /^week-(\d{2})\.md$/
const LOOSE_WEEK_NAME = /^week-\d+\.md$/

export const assertNaturalWeek = (plan: { startDate: string; endDate: string }): void => {
  const range = naturalWeekRange(plan.startDate)
  if (range.startDate !== plan.startDate || range.endDate !== plan.endDate) {
    throw new Error('周计划日期必须覆盖完整的周一至周日七天')
  }
}

export const loadValidatedWeekDocuments = async (
  workspaceRoot: string,
  files: VersionedFileTransaction = new VersionedFileTransaction(undefined, {}, workspaceRoot)
): Promise<WeekDocument[]> => {
  await files.recoverAll()
  const directory = await resolveSafePath(workspaceRoot, '00-dashboard/weeks', true)
  const names = (await readdir(directory)).filter((name) => LOOSE_WEEK_NAME.test(name)).sort()
  const documents: WeekDocument[] = []
  const seenWeeks = new Set<number>()

  for (const name of names) {
    const match = STRICT_WEEK_NAME.exec(name)
    if (!match) throw new Error(`周计划文件名必须使用 week-NN.md：${name}`)
    const path = await resolveSafePath(workspaceRoot, `00-dashboard/weeks/${name}`, true)
    const source = await readFile(path, 'utf8')
    const value = parseWeeklyPlan(source, path)
    const filenameWeek = Number(match[1])
    if (value.plan.week !== filenameWeek) throw new Error(`周计划文件名 ${name} 与 frontmatter 周次 ${value.plan.week} 不一致`)
    if (seenWeeks.has(value.plan.week)) throw new Error(`周计划周次重复：${value.plan.week}`)
    seenWeeks.add(value.plan.week)
    assertNaturalWeek(value.plan)
    documents.push({ path, revision: revisionOf(source), value })
  }

  documents.sort((left, right) => left.value.plan.startDate.localeCompare(right.value.plan.startDate))
  for (let index = 1; index < documents.length; index += 1) {
    const previous = documents[index - 1].value.plan
    const current = documents[index].value.plan
    if (current.startDate <= previous.endDate) {
      throw new Error(`周计划日期范围重叠：Week ${previous.week} 与 Week ${current.week}`)
    }
  }
  return documents
}
