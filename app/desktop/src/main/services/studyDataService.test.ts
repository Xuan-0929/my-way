import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { DailyFileService } from './dailyFileService'
import { StudyDataService } from './studyDataService'
import { revisionOf } from './versionedFileTransaction'
import { serializeDailyRecord } from '../domain/dailyRecord'

const week = `---
schemaVersion: 1
week: 1
startDate: '2026-08-17'
endDate: '2026-08-23'
tasks:
  - id: nlp-01
    date: '2026-08-17'
    category: nlp
    title: 注意力
    plannedMinutes: 120
    deliverable: notebooks/attention.ipynb
---

# Week 01
`

describe('StudyDataService', () => {
  let root = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'my-way-data-'))
    await mkdir(join(root, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(root, '05-admissions'), { recursive: true })
    await writeFile(join(root, 'README.md'), '# My Way')
    await writeFile(join(root, '00-dashboard', 'weeks', 'week-01.md'), week)
    await writeFile(join(root, '00-dashboard', '12-week-roadmap.md'), '# 12 周')
    await writeFile(join(root, '00-dashboard', 'long-term-roadmap.md'), '# 长期')
    await writeFile(join(root, '00-dashboard', 'current-status.md'), '# 当前')
  })

  afterEach(async () => rm(root, { recursive: true, force: true }))

  it('loads weekly plans and route sources without writing to them', async () => {
    const service = new StudyDataService(root)
    const before = await readFile(join(root, '00-dashboard', '12-week-roadmap.md'), 'utf8')
    const loadedWeek = await service.loadWeek('2026-08-17')
    const routes = await service.loadRoutes()
    expect(loadedWeek?.value.plan.week).toBe(1)
    expect(routes.map((route) => route.id)).toEqual(['twelve-week', 'long-term', 'current-status'])
    expect(await readFile(join(root, '00-dashboard', '12-week-roadmap.md'), 'utf8')).toBe(before)
  })

  it.each([
    ['non-padded filename', 'week-2.md', week.replace('week: 1', 'week: 2').replaceAll("2026-08-17", "2026-08-24").replace("2026-08-23", "2026-08-30"), /week-NN\.md/],
    ['filename mismatch', 'week-02.md', week, /文件名.*周次/],
    ['short date range', 'week-02.md', week.replace('week: 1', 'week: 2').replaceAll('2026-08-17', '2026-08-24').replace('2026-08-23', '2026-08-29'), /周一至周日|七天/]
  ])('rejects %s consistently while loading calendar data', async (_label, filename, source, message) => {
    await writeFile(join(root, '00-dashboard', 'weeks', filename), source)

    await expect(new StudyDataService(root).loadWeek('2026-08-24')).rejects.toThrow(message)
  })

  it('derives progress only from daily records in the requested range', async () => {
    const days = new DailyFileService(root, () => new Date('2026-08-17T10:00:00.000Z'))
    const opened = await days.open('2026-08-17', { create: true })
    if (!opened) throw new Error('expected record')
    await days.save(opened.file.path, {
      ...opened.file.value,
      tasks: opened.file.value.tasks.map((task) => ({ ...task, actualMinutes: 100, status: 'done' as const }))
    }, opened.file.revision)
    const result = await new StudyDataService(root).queryProgress('2026-08-17', '2026-08-23')
    expect(result.summary).toMatchObject({ plannedMinutes: 120, actualMinutes: 100, completedTasks: 1 })
    expect(result.summary.timeRecords[0].tasks[0]).toMatchObject({ id: 'nlp-01', title: '注意力', status: 'done' })
    expect(result.month).toHaveLength(1)
  })

  it('returns no records when the requested year directory does not exist', async () => {
    await expect(new StudyDataService(root).loadDailyRecords('2027-01-01', '2027-01-07')).resolves.toEqual([])
  })

  it('rejects a daily record whose frontmatter date differs from its filename', async () => {
    const days = new DailyFileService(root, () => new Date('2026-08-17T10:00:00.000Z'))
    const opened = await days.open('2026-08-17', { create: true })
    if (!opened) throw new Error('expected record')
    const mismatchedPath = join(root, 'data', 'daily', '2026', '2026-08-18.md')
    await writeFile(mismatchedPath, serializeDailyRecord(opened.file.value))

    await expect(new StudyDataService(root).loadDailyRecords('2026-08-18', '2026-08-18'))
      .rejects.toThrow(/日期.*文件名/)
  })

  it('recovers a crashed daily-and-week transaction before scanning weekly plans', async () => {
    const dayPath = join(root, 'data', 'daily', '2026', '2026-08-17.md')
    const weekPath = join(root, '00-dashboard', 'weeks', 'week-01.md')
    const transactionId = `99999999-${randomUUID()}`
    const dayBackup = join(root, 'data', 'daily', '2026', `.2026-08-17.md.swap-${transactionId}-${randomUUID()}.bak`)
    const weekBackup = join(root, '00-dashboard', 'weeks', `.week-01.md.swap-${transactionId}-${randomUUID()}.bak`)
    const dayTemporary = join(root, 'data', 'daily', '2026', `.2026-08-17.md.99999999.${randomUUID()}.tmp`)
    const weekTemporary = join(root, '00-dashboard', 'weeks', `.week-01.md.99999999.${randomUUID()}.tmp`)
    await mkdir(join(root, 'data', 'daily', '2026'), { recursive: true })
    await rm(weekPath)
    await writeFile(dayPath, 'day-v2')
    await writeFile(dayBackup, 'day-v1')
    await writeFile(weekBackup, week)
    await writeFile(dayTemporary, 'day-v2')
    await writeFile(weekTemporary, week.replace('注意力', '已删除'))
    await writeFile(join(root, `.my-way-transaction-${transactionId}.json`), JSON.stringify({
      schemaVersion: 1,
      id: transactionId,
      state: 'installing',
      entries: [
        { path: dayPath, temporaryPath: dayTemporary, backupPath: dayBackup, expectedRevision: revisionOf('day-v1'), nextRevision: revisionOf('day-v2') },
        { path: weekPath, temporaryPath: weekTemporary, backupPath: weekBackup, expectedRevision: revisionOf(week), nextRevision: revisionOf(week.replace('注意力', '已删除')) }
      ]
    }))

    const loaded = await new StudyDataService(root).loadWeek('2026-08-17')

    expect(loaded?.value.plan.tasks[0].title).toBe('注意力')
    await expect(readFile(dayPath, 'utf8')).resolves.toBe('day-v1')
  })
})
