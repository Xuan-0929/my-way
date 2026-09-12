import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { parseDailyRecord, serializeDailyRecord } from '../domain/dailyRecord'
import { DailyFileService, RevisionConflictError } from './dailyFileService'

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
  - id: english-01
    date: '2026-08-18'
    category: english
    title: 四级阅读
    plannedMinutes: 60
    deliverable: notes/cet4.md
---

# Week 01
`

const required = <T>(value: T | null): T => {
  if (value === null) throw new Error('expected a daily record')
  return value
}

describe('DailyFileService', () => {
  let root = ''
  let service: DailyFileService

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'my-way-days-'))
    await mkdir(join(root, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(root, '05-admissions'), { recursive: true })
    await writeFile(join(root, 'README.md'), '# My Way\n')
    await writeFile(join(root, '00-dashboard', 'weeks', 'week-01.md'), weekPlan)
    service = new DailyFileService(root, () => new Date('2026-08-17T09:30:00.000Z'))
  })

  afterEach(async () => rm(root, { recursive: true, force: true }))

  it('auto-creates today from the matching weekly plan', async () => {
    const opened = required(await service.open('2026-08-17', { create: true }))
    expect(opened.created).toBe(true)
    expect(opened.missingPlan).toBe(false)
    expect(opened.file.value.tasks).toHaveLength(1)
    expect(opened.file.value.tasks[0]).toMatchObject({ id: 'nlp-01', sourceTaskId: 'nlp-01', actualMinutes: 0, status: 'planned' })
    await expect(readFile(join(root, 'data/daily/2026/2026-08-17.md'), 'utf8')).resolves.toContain('复现注意力')
  })

  it('does not auto-create from a weekly plan whose filename and week number disagree', async () => {
    await writeFile(join(root, '00-dashboard', 'weeks', 'week-01.md'), weekPlan.replace('week: 1', 'week: 2'))

    await expect(service.open('2026-08-17', { create: true })).rejects.toThrow(/文件名.*周次/)
    await expect(readFile(join(root, 'data/daily/2026/2026-08-17.md'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('creates a blank record with a missing-plan signal', async () => {
    const opened = required(await service.open('2026-08-24', { create: true }))
    expect(opened.missingPlan).toBe(true)
    expect(opened.file.value).toMatchObject({ date: '2026-08-24', sourceWeek: null, tasks: [] })
  })

  it('defaults to read-only open until creation is explicitly requested', async () => {
    await expect(service.open('2026-08-18')).resolves.toBeNull()
    await expect(readFile(join(root, 'data/daily/2026/2026-08-18.md'), 'utf8')).rejects.toThrow()
  })

  it('never replaces an existing record during open', async () => {
    const first = required(await service.open('2026-08-17', { create: true }))
    const changed = { ...first.file.value, notes: '保留我的原始笔记' }
    await service.save(first.file.path, changed, first.file.revision)
    await writeFile(join(root, '00-dashboard', 'weeks', 'week-01.md'), weekPlan.replace('复现注意力', '计划已变化'))
    const reopened = required(await service.open('2026-08-17', { create: true }))
    expect(reopened.file.value.notes).toBe('保留我的原始笔记')
    expect(reopened.file.value.tasks[0].title).toBe('复现注意力')
  })

  it('writes atomically and rejects stale revisions', async () => {
    const opened = required(await service.open('2026-08-17', { create: true }))
    const saved = await service.save(opened.file.path, { ...opened.file.value, notes: '第一次保存' }, opened.file.revision)
    expect(saved.revision).not.toBe(opened.file.revision)
    await expect(service.save(opened.file.path, { ...opened.file.value, notes: '过期写入' }, opened.file.revision)).rejects.toBeInstanceOf(RevisionConflictError)
    const names = await readdir(join(root, 'data/daily/2026'))
    expect(names.some((name) => name.includes('.tmp'))).toBe(false)
  })

  it('rejects a record whose date does not match its daily filename', async () => {
    const opened = required(await service.open('2026-08-17', { create: true }))
    const mismatched = { ...opened.file.value, date: '2026-08-18' }

    await expect(service.save(opened.file.path, mismatched, opened.file.revision)).rejects.toThrow(/日期.*文件名/)
    await expect(service.saveConflictCopy(opened.file.path, mismatched)).rejects.toThrow(/日期.*文件名/)
    expect(parseDailyRecord(await readFile(opened.file.path, 'utf8'), opened.file.path).date).toBe('2026-08-17')
  })

  it('does not overwrite an external edit that arrives during replacement', async () => {
    const opened = required(await service.open('2026-08-17', { create: true }))
    const external = serializeDailyRecord({ ...opened.file.value, notes: '外部编辑器刚写入的内容' })
    const racingService = new DailyFileService(root, () => new Date('2026-08-17T09:31:00.000Z'), {
      afterClaim: async (path) => { await writeFile(path, external) }
    })

    await expect(racingService.save(opened.file.path, { ...opened.file.value, notes: 'App 的待保存内容' }, opened.file.revision)).rejects.toBeInstanceOf(RevisionConflictError)
    expect(await readFile(opened.file.path, 'utf8')).toBe(external)
  })

  it('keeps a concurrently created daily record instead of replacing it', async () => {
    const externalRecord = {
      schemaVersion: 1 as const,
      date: '2026-08-18',
      sourceWeek: 1,
      tasks: [],
      reflection: { learned: '', blockers: '', tomorrow: '' },
      pastExams: [],
      updatedAt: '2026-08-17T09:30:00.000Z',
      notes: '另一个进程先创建的记录'
    }
    const racingService = new DailyFileService(root, () => new Date('2026-08-17T09:31:00.000Z'), {
      beforeCreateInstall: async (path) => { await writeFile(path, serializeDailyRecord(externalRecord)) }
    })

    const opened = required(await racingService.open('2026-08-18', { create: true }))
    expect(opened.created).toBe(false)
    expect(opened.file.value.notes).toBe('另一个进程先创建的记录')
  })

  it('can save a conflict copy without overwriting the current record', async () => {
    const opened = required(await service.open('2026-08-17', { create: true }))
    const copy = await service.saveConflictCopy(opened.file.path, { ...opened.file.value, notes: '冲突版本' })
    expect(copy.path).toMatch(/2026-08-17\.conflict-/)
    expect(parseDailyRecord(await readFile(copy.path, 'utf8'), copy.path).notes).toBe('冲突版本')
    expect(parseDailyRecord(await readFile(opened.file.path, 'utf8'), opened.file.path).notes).toBe('')
  })

  it('can save a conflict copy after the original daily file was externally deleted', async () => {
    const opened = required(await service.open('2026-08-17', { create: true }))
    await rm(opened.file.path)

    const copy = await service.saveConflictCopy(opened.file.path, { ...opened.file.value, notes: '删除冲突中的未保存笔记' })

    expect(copy.path).toMatch(/2026-08-17\.conflict-/)
    expect(parseDailyRecord(await readFile(copy.path, 'utf8'), copy.path).notes).toBe('删除冲突中的未保存笔记')
    await expect(readFile(opened.file.path, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('recovers the last complete file after an interrupted conditional replacement', async () => {
    const opened = required(await service.open('2026-08-17', { create: true }))
    const backup = join(root, `data/daily/2026/.2026-08-17.md.swap-99999999-${randomUUID()}-${randomUUID()}.bak`)
    await rename(opened.file.path, backup)

    const recovered = required(await service.open('2026-08-17', { create: false }))
    expect(recovered.file.revision).toBe(opened.file.revision)
    await expect(readFile(opened.file.path, 'utf8')).resolves.toContain('复现注意力')
    await expect(readFile(backup, 'utf8')).rejects.toThrow()
  })
})
