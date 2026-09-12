import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, readFile, readdir, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseDailyRecord } from '../domain/dailyRecord'
import { DailyFileService } from './dailyFileService'
import { StudyDataService } from './studyDataService'
import { TaskDeletionService } from './taskDeletionService'
import { VersionedFileTransaction } from './versionedFileTransaction'

const weekPlan = `---
schemaVersion: 1
week: 1
startDate: '2026-08-17'
endDate: '2026-08-23'
tasks:
  - id: nlp-01
    date: '2026-08-17'
    category: nlp
    title: 复现注意力
    plannedMinutes: 120
    deliverable: notebooks/attention.ipynb
---

# Week 01
`

const required = <T>(value: T | null): T => {
  if (value === null) throw new Error('expected a value')
  return value
}

describe('TaskDeletionService', () => {
  let root = ''
  let weekPath = ''
  let days: DailyFileService
  let deletion: TaskDeletionService
  const now = () => new Date('2026-08-17T09:30:00.000Z')

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'my-way-delete-'))
    weekPath = join(root, '00-dashboard', 'weeks', 'week-01.md')
    await mkdir(join(root, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(root, '05-admissions'), { recursive: true })
    await writeFile(join(root, 'README.md'), '# My Way\n')
    await writeFile(weekPath, weekPlan)
    weekPath = await realpath(weekPath)
    days = new DailyFileService(root, now)
    deletion = new TaskDeletionService(root, now)
  })

  afterEach(async () => rm(root, { recursive: true, force: true }))

  it('deletes a manual task only from the daily record', async () => {
    const opened = required(await days.open('2026-08-17', { create: true }))
    const manual = { ...opened.file.value.tasks[0], id: 'reading-01', sourceTaskId: undefined, notes: '', outcomes: '' }
    const saved = await days.save(opened.file.path, { ...opened.file.value, tasks: [...opened.file.value.tasks, manual] }, opened.file.revision)

    const result = await deletion.deleteTask({ day: saved, taskId: 'reading-01' })

    expect(result.day.value.tasks.map((task) => task.id)).not.toContain('reading-01')
    expect(result.week).toBeUndefined()
    expect(await readFile(weekPath, 'utf8')).toContain('id: nlp-01')
  })

  it('deletes a planned task from both files without changing the week body', async () => {
    const opened = required(await days.open('2026-08-17', { create: true }))
    const before = required(await new StudyDataService(root).loadWeek('2026-08-17'))

    const result = await deletion.deleteTask({ day: opened.file, taskId: 'nlp-01' })

    expect(result.day.value.tasks).toHaveLength(0)
    expect(result.week?.value.plan.tasks.map((task) => task.id)).not.toContain('nlp-01')
    expect(result.week?.value.body).toBe(before.value.body)
  })

  it('deletes the same planned lineage after its weekly date was rescheduled', async () => {
    const opened = required(await days.open('2026-08-17', { create: true }))
    await writeFile(weekPath, weekPlan.replace("date: '2026-08-17'", "date: '2026-08-18'"))

    const result = await deletion.deleteTask({ day: opened.file, taskId: 'nlp-01' })

    expect(result.day.value.tasks).toHaveLength(0)
    expect(result.week?.value.plan.tasks).toHaveLength(0)
    expect(result.week?.value.body).toBe('# Week 01')
  })

  it('uses sourceTaskId to delete a carried task lineage', async () => {
    const opened = required(await days.open('2026-08-17', { create: true }))
    const carried = { ...opened.file.value.tasks[0], id: 'nlp-01@2026-08-19', sourceTaskId: 'nlp-01', date: '2026-08-19' }
    const saved = await days.save(opened.file.path, { ...opened.file.value, tasks: [carried] }, opened.file.revision)

    const result = await deletion.deleteTask({ day: saved, taskId: carried.id })

    expect(result.week?.value.plan.tasks).toHaveLength(0)
  })

  it('uses the canonical daily file instead of renderer-authored task lineage', async () => {
    const opened = required(await days.open('2026-08-17', { create: true }))
    const manual = { ...opened.file.value.tasks[0], id: 'manual-01', sourceTaskId: undefined }
    const saved = await days.save(opened.file.path, { ...opened.file.value, tasks: [...opened.file.value.tasks, manual] }, opened.file.revision)
    const forged = {
      ...saved,
      value: {
        ...saved.value,
        tasks: saved.value.tasks.map((task) => task.id === manual.id ? { ...task, sourceTaskId: 'nlp-01' } : task)
      }
    }

    const result = await deletion.deleteTask({ day: forged, taskId: manual.id })

    expect(result.week).toBeUndefined()
    expect(result.day.value.tasks.map((task) => task.id)).toEqual(['nlp-01'])
    expect(await readFile(weekPath, 'utf8')).toContain('id: nlp-01')
  })

  it('rejects a planned lineage that points outside its source week', async () => {
    const opened = required(await days.open('2026-08-17', { create: true }))
    const contradictory = { ...opened.file.value.tasks[0], originalDate: '2026-08-24' }
    const saved = await days.save(opened.file.path, { ...opened.file.value, tasks: [contradictory] }, opened.file.revision)

    await expect(deletion.deleteTask({ day: saved, taskId: contradictory.id })).rejects.toThrow(/来源任务|周计划/)
    expect(await readFile(weekPath, 'utf8')).toContain('id: nlp-01')
  })

  it('rejects a carried lineage whose weekly source no longer exists', async () => {
    const opened = required(await days.open('2026-08-17', { create: true }))
    const missingSource = { ...opened.file.value.tasks[0], id: 'missing@2026-08-19', sourceTaskId: 'missing', date: '2026-08-19' }
    const saved = await days.save(opened.file.path, { ...opened.file.value, tasks: [missingSource] }, opened.file.revision)

    await expect(deletion.deleteTask({ day: saved, taskId: missingSource.id })).rejects.toThrow(/来源任务|周计划/)
  })

  it('keeps the daily task and external week edit when installation races', async () => {
    const opened = required(await days.open('2026-08-17', { create: true }))
    const externalWeek = weekPlan.replace('# Week 01', '# External Week')
    const files = new VersionedFileTransaction(now, {
      afterClaim: async (path) => { if (path === weekPath) await writeFile(weekPath, externalWeek) }
    }, root)
    const racingDeletion = new TaskDeletionService(root, now, files)

    await expect(racingDeletion.deleteTask({ day: opened.file, taskId: 'nlp-01' })).rejects.toThrow()

    expect(parseDailyRecord(await readFile(opened.file.path, 'utf8'), opened.file.path).tasks.map((task) => task.id)).toContain('nlp-01')
    expect(await readFile(weekPath, 'utf8')).toBe(externalWeek)
    expect((await readdir(join(root, '00-dashboard', 'weeks'))).some((name) => name.startsWith('week-01.conflict-external-'))).toBe(true)
  })

  it('rejects a daily payload that points at a weekly file', async () => {
    const opened = required(await days.open('2026-08-17', { create: true }))
    await expect(deletion.deleteTask({ day: { ...opened.file, path: weekPath }, taskId: 'nlp-01' })).rejects.toThrow(/data\/daily/)
  })

  it('rejects a daily symlink that resolves outside the workspace', async () => {
    const opened = required(await days.open('2026-08-17', { create: true }))
    const parked = `${opened.file.path}.parked`
    const outside = join(await mkdtemp(join(tmpdir(), 'my-way-outside-')), 'outside.md')
    await writeFile(outside, 'outside')
    await rename(opened.file.path, parked)
    await symlink(outside, opened.file.path)
    try {
      await expect(deletion.deleteTask({ day: opened.file, taskId: 'nlp-01' })).rejects.toThrow(/越界|工作区/)
    } finally {
      await rm(join(outside, '..'), { recursive: true, force: true })
    }
  })
})
