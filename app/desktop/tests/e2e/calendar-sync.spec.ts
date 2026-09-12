import { test, expect, _electron as electron } from '@playwright/test'
import matter from 'gray-matter'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { format } from 'date-fns'
import { dailyRecordSchema } from '../../src/shared/schemas'
import { naturalWeekRange } from '../../src/shared/weekPlanning'

for (const hasWeek of [true, false]) {
  test(`daily cards sync with the calendar: ${hasWeek ? 'empty weekly plan' : 'no weekly plan'}`, async ({ browserName }, testInfo) => {
    expect(browserName).toBe('chromium')
    test.setTimeout(60_000)
    const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-calendar-sync-'))
    const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-calendar-sync-user-'))
    const today = format(new Date(), 'yyyy-MM-dd')
    const weekPath = join(workspace, '00-dashboard', 'weeks', 'week-01.md')
    const weekSource = matter.stringify('# 本周\n', { schemaVersion: 1, week: 1, ...naturalWeekRange(today), tasks: [] })
    const dailyPath = join(workspace, 'data', 'daily', today.slice(0, 4), `${today}.md`)
    const savedDay = async () => dailyRecordSchema.parse(matter(await readFile(dailyPath, 'utf8')).data)
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
      if (hasWeek) await writeFile(weekPath, weekSource)
      await writeFile(join(userData, 'workspace.json'), JSON.stringify({ root: workspace }))
      app = await launch()
      let page = await app.firstWindow()
      await page.setViewportSize({ width: 1280, height: 800 })
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
      for (const title of ['N1单词', 'N1语法']) {
        await page.getByRole('button', { name: /添加一项任务/ }).click()
        const dialog = page.getByRole('dialog', { name: '新建任务' })
        await dialog.getByLabel('任务标题').fill(title)
        await dialog.getByLabel('任务类别').selectOption('japanese')
        await dialog.getByLabel('计划分钟').fill('30')
        await dialog.getByLabel('任务备注').fill('保留原有学习备注')
        await dialog.getByRole('button', { name: '创建任务' }).click()
        await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveValue(title)
        await page.getByText('任务信息', { exact: true }).click()
        await page.getByLabel('实际分钟', { exact: true }).fill('30')
        await expect(page.getByRole('status', { name: `${title}状态：已达标` })).toBeVisible()
        await page.getByRole('button', { name: '保存并返回' }).click()
      }
      await expect(async () => {
        const saved = await savedDay()
        expect(saved.tasks).toHaveLength(2)
        expect(saved.tasks.every((task) => task.status === 'planned' && task.actualMinutes === 30)).toBe(true)
      }).toPass({ timeout: 5000 })
      const beforeBrowsing = await readFile(dailyPath, 'utf8')
      await page.getByRole('button', { name: '日历', exact: true }).click()
      let column = page.locator(`[data-calendar-date="${today}"]`)
      await expect(column.locator('.calendar-task')).toHaveCount(2)
      await expect(column).toContainText('N1单词')
      await expect(column).toContainText('N1语法')
      await expect(column.locator('.day-load')).toContainText('1 小时')
      await expect(column.locator('[data-state="met"]')).toHaveCount(2)
      await expect(column.locator('.calendar-record-task').first()).toHaveCSS('border-right-width', '0px')
      await page.screenshot({ path: testInfo.outputPath('calendar-daily-light-1280.png'), animations: 'disabled' })
      await page.getByRole('button', { name: '月', exact: true }).click()
      const monthDay = page.getByRole('button', { name: `打开 ${today} 记录` })
      await expect(monthDay).toContainText('100%')
      await expect(monthDay).toContainText('1 小时')
      await page.getByRole('button', { name: '周', exact: true }).click()
      expect(await readFile(dailyPath, 'utf8')).toBe(beforeBrowsing)

      // Calendar entries open the original daily card, never a copied placeholder.
      await column.getByRole('button', { name: '打开任务详情：N1单词' }).click()
      await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveValue('N1单词')
      await expect(page.getByRole('textbox', { name: '任务备注' })).toContainText('保留原有学习备注')
      await page.getByText('任务信息', { exact: true }).click()
      await page.getByRole('spinbutton', { name: '计划分钟', exact: true }).fill('45')
      await page.getByRole('button', { name: '保存并返回' }).click()
      await page.getByRole('button', { name: '日历', exact: true }).click()
      await expect(column.getByRole('button', { name: '打开任务详情：N1单词' })).toContainText('45 分钟')
      await expect(column.locator('.calendar-task')).toHaveCount(2)

      await column.getByRole('button', { name: '打开任务详情：N1语法' }).click()
      await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveValue('N1语法')
      await page.getByRole('button', { name: '删除任务', exact: true }).click()
      await page.getByRole('button', { name: '确认删除' }).click()
      await expect(page.getByRole('button', { name: '打开任务详情：N1语法' })).toHaveCount(0)
      await page.getByRole('button', { name: '日历', exact: true }).click()
      await expect(column.locator('.calendar-task')).toHaveCount(1)
      await app.close()
      app = await launch()
      page = await app.firstWindow()
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' })
      await page.getByRole('button', { name: '日历', exact: true }).click()
      column = page.locator(`[data-calendar-date="${today}"]`)
      await expect(column.locator('.calendar-task')).toHaveCount(1)
      await expect(column.getByRole('button', { name: '打开任务详情：N1单词' })).toContainText('45 分钟')
      await page.screenshot({ path: testInfo.outputPath('calendar-daily-dark-1440.png'), animations: 'disabled' })
      expect((await savedDay()).tasks[0]).toMatchObject({ title: 'N1单词', notes: '保留原有学习备注', plannedMinutes: 45, actualMinutes: 30, status: 'planned' })
      if (hasWeek) expect(await readFile(weekPath, 'utf8')).toBe(weekSource)
      else expect(await readdir(join(workspace, '00-dashboard', 'weeks'))).toEqual([])
    } finally {
      if (app) {
        const page = await app.firstWindow().catch(() => null)
        const cancel = page?.getByRole('dialog').getByRole('button', { name: '取消', exact: true })
        if (cancel && await cancel.isVisible().catch(() => false)) await cancel.click()
        await app.close().catch(() => undefined)
      }
      await rm(workspace, { recursive: true, force: true })
      await rm(userData, { recursive: true, force: true })
    }
  })
}
