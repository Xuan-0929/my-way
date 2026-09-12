import { test, expect, _electron as electron } from '@playwright/test'
import matter from 'gray-matter'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { addDays, format } from 'date-fns'
import { dailyRecordSchema } from '../../src/shared/schemas'

test('task creation, duplication, minute editing and explicit saves survive a restart', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  test.setTimeout(90_000)
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-task-editing-'))
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-task-editing-user-'))
  const today = format(new Date(), 'yyyy-MM-dd')
  const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')
  const executablePath = process.env.MY_WAY_E2E_EXECUTABLE
  const launch = () => electron.launch(executablePath
    ? { executablePath, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
    : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
  let app: Awaited<ReturnType<typeof launch>> | null = null
  const dailyPath = (date: string) => join(workspace, 'data', 'daily', date.slice(0, 4), `${date}.md`)
  const savedDay = async (date: string) => dailyRecordSchema.parse(matter(await readFile(dailyPath(date), 'utf8')).data)
  try {
    await mkdir(join(workspace, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(workspace, '05-admissions'))
    await writeFile(join(workspace, 'README.md'), '# My Way\n')
    for (const name of ['12-week-roadmap', 'long-term-roadmap', 'current-status']) {
      await writeFile(join(workspace, '00-dashboard', `${name}.md`), `# ${name}\n`)
    }
    await writeFile(join(userData, 'workspace.json'), JSON.stringify({ root: workspace }))
    app = await launch()
    let page = await app.firstWindow()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'light' })
    await page.getByRole('button', { name: /添加一项任务/ }).click()
    let dialog = page.getByRole('dialog', { name: '新建任务' })
    await expect(dialog.getByRole('textbox', { name: '任务标题' })).toBeFocused()
    await dialog.getByRole('textbox', { name: '任务标题' }).press('Shift+Tab')
    await expect(dialog.getByRole('button', { name: '创建任务' })).toBeFocused()
    await dialog.getByRole('button', { name: '创建任务' }).press('Tab')
    await expect(dialog.getByRole('textbox', { name: '任务标题' })).toBeFocused()
    await dialog.getByRole('textbox', { name: '任务标题' }).fill('背+胸')
    await dialog.getByRole('combobox', { name: '任务类别' }).selectOption('fitness')
    await dialog.getByRole('spinbutton', { name: '计划分钟' }).fill('150')
    await dialog.getByRole('textbox', { name: '任务备注' }).fill('组间休息 90 秒')
    await page.screenshot({ path: testInfo.outputPath('create-task-light-1280.png') })
    await dialog.getByRole('button', { name: '创建任务' }).click()
    await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveValue('背+胸')
    await page.getByText('任务信息', { exact: true }).click()
    await page.getByRole('spinbutton', { name: '实际分钟', exact: true }).fill('150')
    await page.getByRole('textbox', { name: '学习成果' }).fill('完成训练')
    await expect(page.getByRole('status', { name: '背+胸状态：已达标' })).toBeVisible()
    await page.getByRole('button', { name: '保存', exact: true }).click()
    // The raw filesystem reader can observe the transaction's brief backup-claim phase.
    // Retry the complete assertion, including the read, until the save is committed.
    await expect(async () => {
      expect((await savedDay(today)).tasks[0].outcomes).toBe('完成训练')
    }).toPass({ timeout: 5000 })
    await expect(page.getByRole('textbox', { name: '任务标题' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('task-detail-light-1280.png') })
    await page.getByRole('button', { name: '保存并返回' }).click()
    const card = page.getByRole('article', { name: '任务卡片：背+胸' })
    await card.getByText('计划分钟', { exact: true }).click()
    await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveCount(0)
    const minutes = card.getByRole('spinbutton', { name: '背+胸 计划分钟' })
    await minutes.click()
    await minutes.press('End')
    await minutes.press('Backspace')
    await minutes.press('Backspace')
    await minutes.press('Backspace')
    await expect(minutes).toHaveValue('')
    await minutes.pressSequentially('150')
    await expect(minutes).toHaveValue('150')
    await page.getByRole('button', { name: '复制 背+胸', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '复制任务' })
    await expect(dialog.getByRole('textbox', { name: '任务备注' })).toHaveValue('组间休息 90 秒')
    await dialog.getByRole('textbox', { name: '任务标题' }).fill('背+胸 · 第二次')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'no-preference' })
    await expect.poll(() => dialog.getByRole('button', { name: '取消' }).evaluate((element) => getComputedStyle(element).color)).toBe('rgb(233, 237, 227)')
    await page.screenshot({ path: testInfo.outputPath('copy-task-dark-1440.png'), animations: 'disabled' })
    await dialog.getByRole('button', { name: '创建副本' }).click()
    await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveValue('背+胸 · 第二次')
    await expect(page.getByRole('textbox', { name: '学习成果' })).toHaveText('')
    await page.getByRole('button', { name: '保存并返回' }).click()
    let tasks = (await savedDay(today)).tasks
    expect(tasks).toHaveLength(2)
    expect(tasks[0]).toMatchObject({ actualMinutes: 150, plannedMinutes: 150, status: 'planned', outcomes: '完成训练' })
    expect(tasks[1]).toMatchObject({ actualMinutes: 0, plannedMinutes: 150, status: 'planned', outcomes: '', evidence: [], notes: '组间休息 90 秒' })
    expect(tasks[1].sourceTaskId).toBeUndefined()
    await expect(page.getByRole('progressbar', { name: '本周健身时长' })).toHaveAttribute('aria-valuetext', '实际 2 小时 30 分钟，目标 5 小时')
    await expect.poll(() => page.locator('.today-view').evaluate((element) => getComputedStyle(element).opacity)).toBe('1')
    await page.screenshot({ path: testInfo.outputPath('copied-cards-dark-1440.png'), animations: 'disabled' })

    // Copy to another date, not a misleading date field inside today's file.
    const before = await readFile(dailyPath(today), 'utf8')
    await page.getByRole('button', { name: '复制 背+胸', exact: true }).click()
    dialog = page.getByRole('dialog', { name: '复制任务' })
    await dialog.getByLabel('任务日期').fill(tomorrow)
    await dialog.getByRole('button', { name: '创建副本' }).click()
    await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveValue('背+胸')
    await expect.poll(async () => (await savedDay(tomorrow)).tasks.length).toBe(1)
    expect(await readFile(dailyPath(today), 'utf8')).toBe(before)
    await page.getByRole('button', { name: '保存并返回' }).click()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '打开任务详情：背+胸 · 第二次' })).toBeVisible()
    tasks = (await savedDay(today)).tasks
    expect(tasks).toHaveLength(2)
    expect(tasks[0].actualMinutes).toBe(150)
    expect(tasks[1].actualMinutes).toBe(0)
  } finally {
    if (app) await app.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
