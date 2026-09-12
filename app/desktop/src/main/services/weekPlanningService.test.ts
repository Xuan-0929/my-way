import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DailyTask, WeeklyPlan, WeeklyTask } from '../../shared/schemas'
import { parseWeeklyPlan, serializeWeeklyPlan } from '../domain/weeklyPlan'
import { serializeDailyRecord } from '../domain/dailyRecord'
import { RevisionConflictError } from './versionedFileTransaction'
import { WeekPlanningService } from './weekPlanningService'

const task = (id: string, date: string, category: WeeklyTask['category'] = 'exam'): WeeklyTask => ({
  id,
  date,
  category,
  title: `任务 ${id}`,
  plannedMinutes: 60,
  deliverable: `notes/${id}.md`
})

const plan = (week: number, startDate: string, endDate: string, tasks = [task(`task-${week}`, startDate)]): WeeklyPlan => ({
  schemaVersion: 1,
  week,
  startDate,
  endDate,
  tasks
})

const dailyTask = (source: WeeklyTask, status: DailyTask['status'], actualMinutes = 0): DailyTask => ({
  ...source,
  originalDate: source.date,
  sourceTaskId: source.id,
  actualMinutes,
  status,
  evidence: actualMinutes ? [source.deliverable] : [],
  notes: '',
  outcomes: ''
})

describe('WeekPlanningService', () => {
  let root = ''
  let outside = ''
  const firstPlan = plan(1, '2026-08-17', '2026-08-23', [
    task('done-task', '2026-08-17'),
    task('open-task', '2026-08-18', 'nlp')
  ])

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'my-way-week-planning-'))
    outside = await mkdtemp(join(tmpdir(), 'my-way-week-outside-'))
    await mkdir(join(root, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(root, '05-admissions'), { recursive: true })
    await writeFile(join(root, 'README.md'), '# My Way\n')
    await writeFile(join(root, '00-dashboard', '12-week-roadmap.md'), '# 12 周\n')
    await writeFile(join(root, '00-dashboard', 'long-term-roadmap.md'), '# 长期\n')
    await writeFile(join(root, '00-dashboard', 'current-status.md'), '# 当前\n')
    await writeFile(join(root, '00-dashboard', 'weeks', 'week-01.md'), serializeWeeklyPlan(firstPlan, '# Week 01\n'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('builds W3 context from the route anchor and the closest prior plan', async () => {
    await mkdir(join(root, 'data', 'daily', '2026'), { recursive: true })
    await writeFile(join(root, 'data', 'daily', '2026', '2026-08-17.md'), serializeDailyRecord({
      schemaVersion: 1,
      date: '2026-08-17',
      sourceWeek: 1,
      tasks: [dailyTask(firstPlan.tasks[0], 'done', 45)],
      reflection: { learned: '', blockers: '', tomorrow: '' },
      pastExams: [],
      updatedAt: '2026-08-17T12:00:00.000Z',
      notes: ''
    }))

    const context = await new WeekPlanningService(root).context('2026-09-01')

    expect(context).toMatchObject({
      date: '2026-09-01',
      startDate: '2026-08-31',
      endDate: '2026-09-06',
      suggestedWeek: 3,
      current: null,
      summary: { actualMinutes: 0, totalTasks: 0 }
    })
    expect(context.previous?.document.value.plan.week).toBe(1)
    expect(context.previous?.tasks.map(({ task: previousTask, state }) => [previousTask.id, state])).toEqual([
      ['done-task', 'done'],
      ['open-task', 'not_started']
    ])
    expect(context.previous?.summary).toMatchObject({ actualMinutes: 45, completedTasks: 1 })
  })

  it('selects the closest prior plan rather than the earliest anchor', async () => {
    const second = plan(2, '2026-08-24', '2026-08-30')
    await writeFile(join(root, '00-dashboard', 'weeks', 'week-02.md'), serializeWeeklyPlan(second, '# Week 02\n'))

    const context = await new WeekPlanningService(root).context('2026-09-01')

    expect(context.suggestedWeek).toBe(3)
    expect(context.previous?.document.value.plan.week).toBe(2)
  })

  it.each([
    ['filename mismatch', 'week-02.md', serializeWeeklyPlan(firstPlan, '# mismatch\n'), /文件名.*周次/],
    ['overlap', 'week-02.md', serializeWeeklyPlan(plan(2, '2026-08-17', '2026-08-23'), '# overlap\n'), /日期范围重叠/],
    ['bad yaml', 'week-02.md', '---\nweek: [broken\n---\n', /unexpected end/]
  ])('fails closed for %s', async (_name, filename, content, message) => {
    await writeFile(join(root, '00-dashboard', 'weeks', filename), content)
    await expect(new WeekPlanningService(root).context('2026-09-01')).rejects.toThrow(message)
  })

  it('creates then revision-updates the authoritative week document', async () => {
    const service = new WeekPlanningService(root, () => new Date('2026-09-01T08:00:00.000Z'))
    const third = plan(3, '2026-08-31', '2026-09-06', [task('new-task', '2026-09-01', 'english')])
    const created = await service.save({ expectedRevision: null, plan: third, body: '# Week 03\n\n初始目标\n' })

    expect(created.path).toBe(join(await realpath(root), '00-dashboard', 'weeks', 'week-03.md'))
    expect(parseWeeklyPlan(await readFile(created.path, 'utf8'), created.path)).toEqual(created.value)
    await expect(service.save({ expectedRevision: null, plan: third, body: '# duplicate\n' })).rejects.toBeInstanceOf(RevisionConflictError)

    const updated = await service.save({
      expectedRevision: created.revision,
      plan: { ...third, tasks: [...third.tasks, task('second-task', '2026-09-02')] },
      body: '# Week 03\n\n更新目标\n'
    })
    expect(updated.revision).not.toBe(created.revision)
    expect(updated.value.plan.tasks).toHaveLength(2)
    expect(updated.value.body).toContain('更新目标')
  })

  it('rejects a newly saved week that overlaps an existing date range', async () => {
    const service = new WeekPlanningService(root)
    const overlapping = plan(2, '2026-08-17', '2026-08-23')

    await expect(service.save({ expectedRevision: null, plan: overlapping, body: '# overlap\n' }))
      .rejects.toThrow(/日期范围重叠.*Week 1.*Week 2/)
    await expect(readFile(join(root, '00-dashboard', 'weeks', 'week-02.md'), 'utf8'))
      .rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects an overlapping update and preserves the existing week file byte-for-byte', async () => {
    const service = new WeekPlanningService(root)
    const second = plan(2, '2026-08-24', '2026-08-30')
    const path = join(root, '00-dashboard', 'weeks', 'week-02.md')
    await writeFile(path, serializeWeeklyPlan(second, '# Week 02\n'))
    const current = (await service.context('2026-08-25')).current
    if (!current) throw new Error('expected current week')
    const before = await readFile(path, 'utf8')

    await expect(service.save({
      expectedRevision: current.revision,
      plan: plan(2, '2026-08-17', '2026-08-23'),
      body: '# overlapping update\n'
    })).rejects.toThrow(/日期范围重叠.*Week 1.*Week 2/)

    await expect(readFile(path, 'utf8')).resolves.toBe(before)
  })

  it('rejects stale updates and leaves the external edit intact', async () => {
    const service = new WeekPlanningService(root)
    const third = plan(3, '2026-08-31', '2026-09-06')
    const created = await service.save({ expectedRevision: null, plan: third, body: '# Week 03\n' })
    await writeFile(created.path, `${await readFile(created.path, 'utf8')}\n外部编辑 ${randomUUID()}\n`)

    await expect(service.save({ expectedRevision: created.revision, plan: third, body: '# stale\n' })).rejects.toBeInstanceOf(RevisionConflictError)
    await expect(readFile(created.path, 'utf8')).resolves.toContain('外部编辑')
  })

  it('saves a stale local draft as an ignored conflict copy without changing the authoritative week', async () => {
    const service = new WeekPlanningService(root, () => new Date('2026-09-01T08:09:10.123Z'))
    const third = plan(3, '2026-08-31', '2026-09-06')
    const created = await service.save({ expectedRevision: null, plan: third, body: '# Week 03\n' })
    const externalSource = `${await readFile(created.path, 'utf8')}\n外部版本\n`
    await writeFile(created.path, externalSource)

    const copied = await service.save({
      expectedRevision: created.revision,
      plan: { ...third, tasks: [{ ...third.tasks[0], title: '本地冲突草案' }] },
      body: '# 本地冲突草案\n',
      asConflictCopy: true
    })

    expect(copied.path).toMatch(/week-03\.conflict-20260901T080910123Z-[0-9a-f-]+\.md$/)
    expect(await readFile(created.path, 'utf8')).toBe(externalSource)
    expect(await readFile(copied.path, 'utf8')).toContain('本地冲突草案')
    const context = await service.context('2026-09-01')
    expect(context.current?.path).toBe(created.path)
    expect(context.current?.value.body).toContain('外部版本')
  })

  it('requires an exact natural week and refuses escaped week directories', async () => {
    const service = new WeekPlanningService(root)
    await expect(service.save({
      expectedRevision: null,
      plan: plan(3, '2026-08-31', '2026-09-05'),
      body: '# short\n'
    })).rejects.toThrow(/周一至周日|七天/)

    await rm(join(root, '00-dashboard', 'weeks'), { recursive: true })
    await symlink(outside, join(root, '00-dashboard', 'weeks'))
    await expect(service.context('2026-09-01')).rejects.toThrow(/工作区|符号链接|越界/)
  })
})
