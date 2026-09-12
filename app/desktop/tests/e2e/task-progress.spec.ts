import { test, expect, _electron as electron } from '@playwright/test'
import matter from 'gray-matter'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { format, subDays } from 'date-fns'
import { dailyRecordSchema } from '../../src/shared/schemas'

test('automatic time progress, optional residual carryover, corrections and timer assignment survive restart', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  test.setTimeout(60_000)
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-progress-'))
  const userData = await mkdtemp(join(tmpdir(), 'my-way-progress-user-'))
  const today = format(new Date(), 'yyyy-MM-dd')
  const yesterday = format(subDays(new Date(), 1), 'yyyy-MM-dd')
  const dailyPath = (date: string) => join(workspace, 'data', 'daily', date.slice(0, 4), `${date}.md`)
  const savedDay = async (date = today) => dailyRecordSchema.parse(matter(await readFile(dailyPath(date), 'utf8')).data)
  const task = (id: string, date: string, plannedMinutes: number, actualMinutes: number) => ({
    id, date, originalDate: date, title: id, category: 'japanese', plannedMinutes, actualMinutes,
    status: 'planned', deliverable: '', evidence: [], notes: '原有备注', outcomes: '原日成果'
  })
  const executablePath = process.env.MY_WAY_E2E_EXECUTABLE
  const launch = () => electron.launch(executablePath
    ? { executablePath, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
    : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
  let app: Awaited<ReturnType<typeof launch>> | null = null
  try {
    await mkdir(join(workspace, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(workspace, '05-admissions'))
    await writeFile(join(workspace, 'README.md'), '# My Way\n')
    for (const name of ['12-week-roadmap', 'long-term-roadmap', 'current-status']) {
      await writeFile(join(workspace, '00-dashboard', `${name}.md`), `# ${name}\n`)
    }
    for (const [date, tasks] of [
      [today, [task('已投入任务', today, 30, 33), task('计时任务', today, 30, 15)]],
      [yesterday, [task('剩余任务', yesterday, 90, 60), task('昨日达标', yesterday, 30, 33)]]
    ] as const) {
      await mkdir(join(workspace, 'data', 'daily', date.slice(0, 4)), { recursive: true })
      await writeFile(dailyPath(date), matter.stringify('# 每日笔记\n', {
        schemaVersion: 1, date, sourceWeek: null, tasks,
        reflection: { learned: '', blockers: '', tomorrow: '' }, pastExams: [], updatedAt: new Date().toISOString()
      }))
    }
    const ledgerDir = join(workspace, 'data', 'timer', today.slice(0, 4))
    await mkdir(ledgerDir, { recursive: true })
    await writeFile(join(ledgerDir, `${today}.md`), matter.stringify('', {
      schemaVersion: 1, date: today, updatedAt: new Date().toISOString(), sessions: [{
        id: 'pending-time', mode: 'elapsed', status: 'pending',
        startedAt: new Date(Date.now() - 19 * 60_000).toISOString(), endedAt: new Date(Date.now() - 60_000).toISOString(), durationSeconds: 1080
      }]
    }))
    await writeFile(join(userData, 'workspace.json'), JSON.stringify({ root: workspace }))
    app = await launch()
    let page = await app.firstWindow()
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
    await expect(page.getByRole('status', { name: '已投入任务状态：已达标' })).toBeVisible()
    await expect(page.getByRole('status', { name: '计时任务状态：进行中' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('.carryover-inbox')).not.toHaveAttribute('open')
    expect((await savedDay()).tasks[1].actualMinutes).toBe(15)
    await page.getByRole('button', { name: '日历', exact: true }).click()
    await expect(page.locator(`[data-calendar-date="${today}"] [data-state="met"]`)).toHaveCount(1)
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await page.getByText('待处理任务 · 1 项').click()
    await expect(page.locator('.carryover-inbox')).not.toContainText('昨日达标')
    await page.screenshot({ path: testInfo.outputPath('automatic-progress-inbox.png'), animations: 'disabled' })
    await page.getByRole('button', { name: '顺延到今天：剩余任务' }).click()
    await expect(page.getByRole('button', { name: '打开任务详情：剩余任务' })).toBeVisible()
    expect((await savedDay(yesterday)).tasks[0]).toMatchObject({ actualMinutes: 60, status: 'rescheduled', rescheduledMinutes: 30, outcomes: '原日成果' })
    expect((await savedDay()).tasks.find(({ title }) => title === '剩余任务')).toMatchObject({ plannedMinutes: 30, actualMinutes: 0, status: 'planned', outcomes: '', evidence: [] })
    await page.getByRole('spinbutton', { name: '已投入任务 实际分钟' }).fill('10')
    await expect(page.getByRole('status', { name: '已投入任务状态：进行中' })).toBeVisible()
    await page.getByRole('button', { name: '提前完成：已投入任务' }).click()
    await expect(page.getByRole('status', { name: '已投入任务状态：已完成' })).toBeVisible()
    await page.getByRole('spinbutton', { name: '已投入任务 实际分钟' }).fill('0')
    await expect(page.getByRole('status', { name: '已投入任务状态：已完成' })).toBeVisible()
    await page.getByRole('button', { name: '恢复自动：已投入任务' }).click()
    await expect(page.getByRole('status', { name: '已投入任务状态：未开始' })).toBeVisible()
    await page.getByRole('spinbutton', { name: '已投入任务 实际分钟' }).fill('33')
    await expect.poll(async () => (await savedDay()).tasks[0].actualMinutes).toBe(33)
    await page.getByRole('button', { name: '打开任务详情：计时任务' }).click()
    await page.getByRole('button', { name: '开始专注', exact: true }).click()
    await page.getByRole('button', { name: /^分配 / }).click()
    const assignment = page.getByRole('dialog', { name: '学习时长分配' })
    await assignment.getByRole('combobox').selectOption('计时任务')
    await assignment.getByRole('button', { name: '分配到任务' }).click()
    await expect(assignment).toHaveCount(0)
    expect(await page.evaluate(() => window.myWay!.timer.get())).toMatchObject({ ok: true, value: { active: { status: 'running' } } })
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect(page.getByRole('status', { name: '计时任务状态：已达标' })).toBeVisible()
    expect((await savedDay()).tasks[1]).toMatchObject({ actualMinutes: 33, status: 'planned' })
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
    await expect(page.getByRole('status', { name: '计时任务状态：已达标' })).toBeVisible()
    await expect(page.getByRole('status', { name: '已投入任务状态：已达标' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('automatic-progress-reopened.png'), animations: 'disabled' })
  } finally {
    if (app) await app.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
