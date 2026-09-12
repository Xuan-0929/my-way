import { test, expect, _electron as electron } from '@playwright/test'
import matter from 'gray-matter'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { addDays, format, startOfWeek } from 'date-fns'
import { dailyRecordSchema } from '../../src/shared/schemas'

test('daily manual fitness minutes stay single-counted across save, refresh, navigation and restart', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  test.setTimeout(60_000)
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-week-time-'))
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-week-time-user-'))
  const date = format(new Date(), 'yyyy-MM-dd')
  const start = startOfWeek(new Date(), { weekStartsOn: 1 })
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
    const weekPath = join(workspace, '00-dashboard', 'weeks', 'week-01.md')
    const weekSource = matter.stringify('# 空周计划\n', {
      schemaVersion: 1, week: 1, startDate: format(start, 'yyyy-MM-dd'), endDate: format(addDays(start, 6), 'yyyy-MM-dd'), tasks: []
    })
    await writeFile(weekPath, weekSource)
    await writeFile(join(userData, 'workspace.json'), JSON.stringify({ root: workspace }))
    const dailyPath = join(workspace, 'data', 'daily', date.slice(0, 4), `${date}.md`)
    const savedDay = async () => dailyRecordSchema.parse(matter(await readFile(dailyPath, 'utf8')).data)

    app = await launch()
    let page = await app.firstWindow()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.getByRole('button', { name: '＋ 添加一项任务' }).click()
    const composer = page.getByRole('dialog', { name: '新建任务' })
    await composer.getByRole('textbox', { name: '任务标题' }).fill('背+胸')
    await composer.getByRole('combobox', { name: '任务类别' }).selectOption('fitness')
    await composer.getByRole('spinbutton', { name: '计划分钟', exact: true }).fill('150')
    await composer.getByRole('button', { name: '创建任务' }).click()
    await page.getByText('任务信息', { exact: true }).click()
    await page.getByRole('spinbutton', { name: '实际分钟', exact: true }).fill('150')
    await expect(page.getByRole('status', { name: '背+胸状态：已达标' })).toBeVisible()
    await page.getByRole('button', { name: '返回今天' }).click()
    await expect.poll(async () => (await savedDay()).tasks[0]).toMatchObject({
      title: '背+胸', category: 'fitness', plannedMinutes: 150, actualMinutes: 150, status: 'planned'
    })

    const expected = '实际 2 小时 30 分钟，目标 2 小时 30 分钟'
    await expect(page.getByRole('progressbar', { name: '本周健身时长' })).toHaveAttribute('aria-valuetext', expected)
    // Force another real file-watch cycle, as auto-save did in the reported bug.
    await writeFile(dailyPath, await readFile(dailyPath, 'utf8'))
    for (const destination of ['本周', '今天', '计时器', '日历', '今天']) {
      await page.getByRole('button', { name: destination, exact: true }).click()
      await expect(page.getByRole('progressbar', { name: '本周健身时长' })).toHaveAttribute('aria-valuetext', expected)
      await expect(page.getByRole('progressbar', { name: '本周学习时长' })).toHaveAttribute('aria-valuetext', '实际 0 分钟，目标 0 分钟')
    }
    await page.screenshot({ path: testInfo.outputPath('fitness-150-saved.png') })

    // A later real edit must be applied once too, not merely hidden after restart.
    await page.getByRole('spinbutton', { name: '背+胸 实际分钟' }).fill('175')
    await expect.poll(async () => (await savedDay()).tasks[0].actualMinutes).toBe(175)
    await page.getByRole('button', { name: '本周', exact: true }).click()
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect(page.getByRole('progressbar', { name: '本周健身时长' })).toHaveAttribute('aria-valuetext', '实际 2 小时 55 分钟，目标 2 小时 30 分钟')

    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByRole('progressbar', { name: '本周健身时长' })).toHaveAttribute('aria-valuetext', '实际 2 小时 55 分钟，目标 2 小时 30 分钟')
    const task = (await savedDay()).tasks
    expect(task).toHaveLength(1)
    expect(task[0].actualMinutes).toBe(175)
    expect(await readFile(weekPath, 'utf8')).toBe(weekSource)
  } finally {
    if (app) await app.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
