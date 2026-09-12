import { test, expect, _electron as electron } from '@playwright/test'
import matter from 'gray-matter'
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { addDays, format, getISODay, parseISO, startOfWeek, subDays, subWeeks } from 'date-fns'
import { dailyRecordSchema, weeklyPlanSchema } from '../../src/shared/schemas'
import { timerLedgerFileSchema, timerStateFileSchema } from '../../src/shared/timerSchemas'
import { formatChineseDateRange } from '../../src/renderer/src/displayFormat'

const require = createRequire(import.meta.url)
const developmentElectronExecutable = require('electron') as string

const launchSecondaryProcess = async (options: { packagedExecutable?: string, userData: string }): Promise<number | null> => {
  const executable = options.packagedExecutable ?? developmentElectronExecutable
  const args = options.packagedExecutable
    ? [`--user-data-dir=${options.userData}`]
    : [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${options.userData}`]
  const child = spawn(executable, args, { env: { ...process.env, MY_WAY_E2E: '1' }, stdio: 'ignore' })
  return new Promise<number | null>((resolve, reject) => {
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new Error('secondary My Way process did not exit'))
    }, 5_000)
    child.once('error', (error) => {
      clearTimeout(timeout)
      reject(error)
    })
    child.once('exit', (code) => {
      clearTimeout(timeout)
      resolve(code)
    })
  })
}

const localDate = (): string => {
  const now = new Date()
  const offset = now.getTimezoneOffset() * 60_000
  return new Date(now.valueOf() - offset).toISOString().slice(0, 10)
}

const naturalWeekFor = (date: string): { startDate: string; endDate: string } => {
  const startDate = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  return { startDate, endDate: format(addDays(parseISO(startDate), 6), 'yyyy-MM-dd') }
}

test('packaged build ignores renderer URL environment overrides', async () => {
  const packagedExecutable = process.env.MY_WAY_E2E_EXECUTABLE
  test.skip(!packagedExecutable, 'requires a packaged My Way executable')
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-packaged-renderer-'))
  let runningApp: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    runningApp = await electron.launch({
      executablePath: packagedExecutable,
      args: [`--user-data-dir=${userData}`],
      env: { ...process.env, MY_WAY_E2E: '1', ELECTRON_RENDERER_URL: 'http://127.0.0.1:9/untrusted' }
    })
    const page = await runningApp.firstWindow()

    await expect(page.getByRole('heading', { name: '选择你的学习文件夹' })).toBeVisible()
    expect(await page.evaluate(() => location.protocol)).toBe('file:')
  } finally {
    if (runningApp) await runningApp.close().catch(() => undefined)
    await rm(userData, { recursive: true, force: true })
  }
})

test('selects and persists a first-run workspace', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-first-run-'))
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-first-run-userdata-'))
  const date = localDate()
  const weekRange = naturalWeekFor(date)
  const packagedExecutable = process.env.MY_WAY_E2E_EXECUTABLE
  const launch = () => electron.launch(packagedExecutable
    ? { executablePath: packagedExecutable, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
    : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
  let runningApp: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    await mkdir(join(workspace, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(workspace, '05-admissions'), { recursive: true })
    await writeFile(join(workspace, 'README.md'), '# My Way\n')
    await writeFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), '# 12 周路线\n')
    await writeFile(join(workspace, '00-dashboard', 'long-term-roadmap.md'), '# 长期路线\n')
    await writeFile(join(workspace, '00-dashboard', 'current-status.md'), '# 当前状态\n')
    await writeFile(join(workspace, '00-dashboard', 'weeks', 'week-01.md'), `---
schemaVersion: 1
week: 1
startDate: '${weekRange.startDate}'
endDate: '${weekRange.endDate}'
tasks:
  - id: first-run-task
    date: '${date}'
    category: nlp
    title: 首次启动任务
    plannedMinutes: 60
    deliverable: notes/first-run.md
---

# First run
`)

    runningApp = await launch()
    const page = await runningApp.firstWindow()
    await expect(page.getByRole('heading', { name: '选择你的学习文件夹' })).toBeVisible()
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.screenshot({ path: testInfo.outputPath('first-run-light-1280.png'), fullPage: true, animations: 'disabled' })
    await runningApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
    }, workspace)
    await page.getByRole('button', { name: '选择 my-way 文件夹' }).click()
    await expect(page.getByRole('button', { name: '打开任务详情：首次启动任务' })).toBeVisible()
    expect(JSON.parse(await readFile(join(userData, 'workspace.json'), 'utf8'))).toEqual({ root: await realpath(workspace) })

    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' })
    await page.getByRole('button', { name: '日历', exact: true }).click()
    const navigation = page.getByRole('navigation', { name: '主导航' })
    await expect.poll(() => navigation.evaluate((element) => {
      const selected = element.querySelector('[aria-current="page"]')!.getBoundingClientRect()
      const indicator = element.querySelector('.selection-indicator')!.getBoundingClientRect()
      return Math.max(Math.abs(selected.x - indicator.x), Math.abs(selected.y - indicator.y), Math.abs(selected.width - indicator.width), Math.abs(selected.height - indicator.height))
    })).toBeLessThan(0.5)
    await page.getByRole('button', { name: '今天', exact: true }).click()
    const openExam = page.getByRole('button', { name: '添加过去问记录' })
    await openExam.click()
    const cancel = page.getByRole('dialog').getByRole('button', { name: '取消', exact: true })
    await expect(cancel).toBeVisible()
    await expect(page.getByRole('dialog').getByLabel('日期', { exact: true })).toBeFocused()
    const exitFrame = await cancel.evaluate((button) => new Promise((resolve, reject) => {
      const seen: string[] = []
      const timeout = setTimeout(() => { observer.disconnect(); reject(new Error(`No exit frame; mode=${document.documentElement.dataset.motion}; seen=${seen.join('|')}; dialog=${document.querySelector('.past-exam-dialog')?.outerHTML.slice(0, 400)}`)) }, 1000)
      const observer = new MutationObserver(() => {
        seen.push([...document.querySelectorAll('.motion-presence')].map(node => node.getAttribute('data-state')).join(','))
        const exiting = document.querySelector<HTMLElement>('.motion-presence[data-state="exiting"]')
        if (!exiting) return
        observer.disconnect()
        clearTimeout(timeout)
        resolve({ inert: exiting.inert, hidden: exiting.getAttribute('aria-hidden'), focus: document.activeElement?.textContent })
      })
      observer.observe(document.body, { subtree: true, attributes: true, childList: true })
      ;(button as HTMLButtonElement).click()
    }))
    expect(exitFrame).toEqual({ inert: true, hidden: 'true', focus: '添加过去问记录' })
    await expect(page.locator('.motion-presence[data-state="exiting"]')).toHaveCount(0)
    await openExam.click()
    await page.keyboard.press('Escape')
    await expect(page.locator('.motion-presence')).toHaveCount(0)
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'instant')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await openExam.click()
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced')
    expect(await page.getByRole('dialog').evaluate((element) => getComputedStyle(element).transform)).toBe('none')
    await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await expect(page.locator('.motion-presence')).toHaveCount(0)

    await runningApp.close()
    runningApp = await launch()
    const reopenedPage = await runningApp.firstWindow()
    await expect(reopenedPage.getByRole('button', { name: '打开任务详情：首次启动任务' })).toBeVisible()
    await expect(reopenedPage.getByRole('button', { name: '选择 my-way 文件夹' })).toHaveCount(0)
  } finally {
    if (runningApp) await runningApp.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('opens workspace recovery when the saved preference file is malformed', async ({ browserName }) => {
  expect(browserName).toBe('chromium')
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-corrupt-preference-'))
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-recovery-workspace-'))
  const date = localDate()
  const weekRange = naturalWeekFor(date)
  const packagedExecutable = process.env.MY_WAY_E2E_EXECUTABLE
  let runningApp: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    await mkdir(join(workspace, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(workspace, '05-admissions'), { recursive: true })
    await writeFile(join(workspace, 'README.md'), '# My Way\n')
    await writeFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), '# 12 周路线\n')
    await writeFile(join(workspace, '00-dashboard', 'long-term-roadmap.md'), '# 长期路线\n')
    await writeFile(join(workspace, '00-dashboard', 'current-status.md'), '# 当前状态\n')
    await writeFile(join(workspace, '00-dashboard', 'weeks', 'week-01.md'), `---
schemaVersion: 1
week: 1
startDate: '${weekRange.startDate}'
endDate: '${weekRange.endDate}'
tasks:
  - id: recovery-task
    date: '${date}'
    category: nlp
    title: 恢复后的任务
    plannedMinutes: 60
    deliverable: notes/recovery.md
---

# Recovery
`)
    await writeFile(join(userData, 'workspace.json'), '{"root":')
    runningApp = await electron.launch(packagedExecutable
      ? { executablePath: packagedExecutable, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
      : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })

    await expect.poll(() => runningApp?.windows().length ?? 0, { timeout: 5_000 }).toBe(1)
    const page = runningApp.windows()[0]
    await expect(page.getByRole('heading', { name: '无法打开工作区' })).toBeVisible()
    await expect(page.getByRole('button', { name: '选择其他文件夹' })).toBeVisible()
    await runningApp.evaluate(({ dialog }, selectedPath) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selectedPath] })
    }, workspace)
    await page.getByRole('button', { name: '选择其他文件夹' }).click()
    await expect(page.getByRole('button', { name: '打开任务详情：恢复后的任务' })).toBeVisible()
    expect(JSON.parse(await readFile(join(userData, 'workspace.json'), 'utf8'))).toEqual({ root: await realpath(workspace) })
  } finally {
    if (runningApp) await runningApp.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('exits a duplicate process and restores the primary window', async ({ browserName }) => {
  expect(browserName).toBe('chromium')
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-single-instance-workspace-'))
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-single-instance-userdata-'))
  const packagedExecutable = process.env.MY_WAY_E2E_EXECUTABLE
  let runningApp: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    await mkdir(join(workspace, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(workspace, '05-admissions'), { recursive: true })
    await writeFile(join(workspace, 'README.md'), '# My Way\n')
    await writeFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), '# 12 周路线\n')
    await writeFile(join(workspace, '00-dashboard', 'long-term-roadmap.md'), '# 长期路线\n')
    await writeFile(join(workspace, '00-dashboard', 'current-status.md'), '# 当前状态\n')
    await writeFile(join(userData, 'workspace.json'), `${JSON.stringify({ root: workspace })}\n`)

    runningApp = await electron.launch(packagedExecutable
      ? { executablePath: packagedExecutable, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
      : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
    const page = await runningApp.firstWindow()
    await expect(page.getByRole('heading', { name: /今天/ })).toBeVisible()
    await runningApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.minimize())
    await expect.poll(() => runningApp?.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isMinimized())).toBe(true)

    expect(await launchSecondaryProcess({ packagedExecutable, userData })).toBe(0)

    await expect.poll(() => runningApp?.evaluate(({ BrowserWindow }) => ({
      count: BrowserWindow.getAllWindows().length,
      minimized: BrowserWindow.getAllWindows()[0]?.isMinimized(),
      visible: BrowserWindow.getAllWindows()[0]?.isVisible()
    }))).toEqual({ count: 1, minimized: false, visible: true })
  } finally {
    if (runningApp) await runningApp.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('persists elapsed timing and focused task work, synchronizes deletion, and keeps the renderer sandboxed', async ({ browserName }, testInfo) => {
  test.setTimeout(60_000)
  expect(browserName).toBe('chromium')
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-workspace-'))
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-userdata-'))
  const date = localDate()
  const weekRange = naturalWeekFor(date)
  const calendarTargetDate = format(getISODay(parseISO(date)) >= 6 ? subDays(parseISO(date), 1) : addDays(parseISO(date), 1), 'yyyy-MM-dd')
  const calendarKeyboardDirection = calendarTargetDate > date ? 'ArrowRight' : 'ArrowLeft'
  let runningApp: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    await mkdir(join(workspace, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(workspace, '05-admissions'), { recursive: true })
    await mkdir(userData, { recursive: true })
    await writeFile(join(workspace, 'README.md'), '# My Way\n')
    await writeFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), '# 12 周路线\n\n[外部资料](https://example.com/)\n')
    await writeFile(join(workspace, '00-dashboard', 'long-term-roadmap.md'), '# 长期路线\n')
    await writeFile(join(workspace, '00-dashboard', 'current-status.md'), '# 当前状态\n')
    await writeFile(join(workspace, '00-dashboard', 'weeks', 'week-01.md'), `---
schemaVersion: 1
week: 1
startDate: '${weekRange.startDate}'
endDate: '${weekRange.endDate}'
tasks:
  - id: e2e-nlp-01
    date: '${date}'
    category: nlp
    title: Electron 真实任务
    plannedMinutes: 90
    deliverable: notes/e2e.md
---

# E2E Week
`)
    await writeFile(join(userData, 'workspace.json'), `${JSON.stringify({ root: workspace })}\n`)

    const routeBefore = await readFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), 'utf8')
    const dailyPath = join(workspace, 'data', 'daily', date.slice(0, 4), `${date}.md`)
    const packagedExecutable = process.env.MY_WAY_E2E_EXECUTABLE
    const app = await electron.launch(packagedExecutable
      ? { executablePath: packagedExecutable, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
      : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
    runningApp = app
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '打开任务详情：Electron 真实任务' })).toBeVisible()
    await expect(page.locator('body')).toContainText('今天')
    expect(await page.evaluate(() => typeof (globalThis as { require?: unknown }).require)).toBe('undefined')
    expect(await page.evaluate(() => typeof (window as unknown as { myWay?: unknown }).myWay)).toBe('object')
    expect(await page.evaluate(async () => ({
      geolocation: (await navigator.permissions.query({ name: 'geolocation' })).state,
      notifications: (await navigator.permissions.query({ name: 'notifications' })).state
    }))).toEqual({ geolocation: 'denied', notifications: 'denied' })

    await expect(page.getByText('学习成果', { exact: true })).toBeVisible()
    await expect(page.getByText('当前难点', { exact: true })).toBeVisible()
    await expect(page.getByText('明日计划调整', { exact: true })).toBeVisible()
    await expect(page.getByText(/DAILY RECORD|FOCUS TIMER|CURRENT ROUTE/)).toHaveCount(0)
    await expect(page.locator('nav .nav-icon')).toHaveCount(5)
    const circleSizes = await page.locator('.category-mark, .status-mark, .save-dot, .timer-sidebar-status i').evaluateAll((elements) => elements.map((element) => {
      const bounds = element.getBoundingClientRect()
      return { width: bounds.width, height: bounds.height }
    }))
    expect(circleSizes.length).toBeGreaterThan(0)
    expect(circleSizes.every(({ width, height }) => Math.abs(width - height) < 0.5)).toBe(true)
    const slowWorkspaceStyle = await page.addStyleTag({ content: '.workspace { transition-duration: 900ms !important; }' })
    await page.getByRole('button', { name: '日历', exact: true }).click()
    const animatedWorkspace = page.locator('.workspace')
    await expect.poll(() => animatedWorkspace.evaluate((element) => element.getAnimations().filter((animation) => animation.playState === 'running').length)).toBeGreaterThan(0)
    await slowWorkspaceStyle.evaluate((element) => element.remove())
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect(page.getByRole('button', { name: '打开任务详情：Electron 真实任务' })).toBeVisible()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.screenshot({ path: testInfo.outputPath('today-light-1440.png'), fullPage: true, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await expect.poll(() => page.evaluate(() => ({
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      paper: getComputedStyle(document.documentElement).getPropertyValue('--paper').trim(),
      body: getComputedStyle(document.body).backgroundColor,
      backdrops: document.querySelectorAll('.modal-backdrop').length
    }))).toEqual({ dark: true, paper: '#292f28', body: 'rgb(32, 37, 31)', backdrops: 0 })
    await page.waitForTimeout(150)
    await page.screenshot({ path: testInfo.outputPath('today-dark-1440.png'), fullPage: true, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })

    await page.getByRole('button', { name: '添加过去问记录' }).click()
    const examDialog = page.getByRole('dialog', { name: '新增过去问记录' })
    await expect(examDialog).toBeVisible()
    await examDialog.getByLabel('科目').fill('数学')
    await examDialog.getByLabel('试卷').fill('2025 数学模拟卷')
    await examDialog.getByLabel('得分').fill('68')
    await page.screenshot({ path: testInfo.outputPath('past-exam-dialog-light-1440.png'), fullPage: true, animations: 'disabled' })
    await examDialog.getByRole('button', { name: '保存记录' }).click()
    await expect(page.getByRole('button', { name: '编辑过去问记录：数学 · 2025 数学模拟卷' })).toBeVisible()
    await expect.poll(async () => dailyRecordSchema.parse(matter(await readFile(dailyPath, 'utf8')).data).pastExams).toEqual([
      expect.objectContaining({ subject: '数学', paper: '2025 数学模拟卷', score: 68, maxScore: 100 })
    ])

    await page.getByRole('button', { name: '日历', exact: true }).click()
    await expect(page.getByText('六日学习安排', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: formatChineseDateRange(weekRange.startDate, weekRange.endDate) })).toBeVisible()
    await expect(page.getByText('近期节点')).toHaveCount(0)
    await page.screenshot({ path: testInfo.outputPath('calendar-light-1440.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '月', exact: true }).click()
    await expect(page.getByRole('button', { name: '月', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('heading', { name: format(parseISO(date), 'yyyy 年 M 月') })).toBeVisible()
    await page.waitForTimeout(150)
    await page.screenshot({ path: testInfo.outputPath('calendar-month-light-1440.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '周', exact: true }).click()
    await expect(page.getByRole('button', { name: '周', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: '回到本周' })).toBeDisabled()
    await page.getByRole('button', { name: '下一周期' }).click()
    await expect(page.getByRole('button', { name: '回到本周' })).toBeEnabled()
    await page.getByRole('button', { name: '回到本周' }).click()
    await expect(page.getByRole('heading', { name: formatChineseDateRange(weekRange.startDate, weekRange.endDate) })).toBeVisible()
    await expect(page.getByText('按空格键拾取任务，使用方向键移动，再按空格键放下；按 Escape 取消。')).toHaveCount(1)
    const sourceCalendarTask = page.locator(`[data-calendar-date="${date}"] [data-task-id="e2e-nlp-01"] .calendar-drag-handle`)
    await sourceCalendarTask.focus()
    await expect(sourceCalendarTask).toBeFocused()
    await page.keyboard.press('Space')
    await expect(sourceCalendarTask).toHaveAttribute('aria-pressed', 'true')
    // KeyboardSensor attaches its direction-key listener in a zero-delay task, not a frame callback.
    await page.evaluate(() => new Promise<void>((resolve) => setTimeout(resolve, 0)))
    await page.keyboard.press(calendarKeyboardDirection)
    await expect(page.locator('[role="status"][aria-live="assertive"]')).toContainText(calendarTargetDate)
    await page.keyboard.press('Space')
    await expect(page.locator(`[data-calendar-date="${calendarTargetDate}"] [data-task-id="e2e-nlp-01"]`)).toBeVisible()
    await expect.poll(async () => weeklyPlanSchema.parse(matter(await readFile(join(workspace, '00-dashboard', 'weeks', 'week-01.md'), 'utf8')).data).tasks[0].date).toBe(calendarTargetDate)

    const dragCalendarTask = async (from: string, to: string) => {
      const handle = await page.locator(`[data-calendar-date="${from}"] [data-task-id="e2e-nlp-01"] .calendar-drag-handle`).boundingBox()
      const target = await page.locator(`[data-calendar-date="${to}"]`).boundingBox()
      expect(handle).not.toBeNull()
      expect(target).not.toBeNull()
      await page.mouse.move(handle!.x + handle!.width / 2, handle!.y + handle!.height / 2)
      await page.mouse.down()
      // Cross the activation threshold and continue moving, as an actual drag does.
      await page.mouse.move(target!.x + target!.width / 2, target!.y + 100, { steps: 12 })
      await page.mouse.up()
    }
    await dragCalendarTask(calendarTargetDate, date)
    await expect(page.locator(`[data-calendar-date="${date}"] [data-task-id="e2e-nlp-01"]`)).toBeVisible()
    await expect.poll(async () => weeklyPlanSchema.parse(matter(await readFile(join(workspace, '00-dashboard', 'weeks', 'week-01.md'), 'utf8')).data).tasks[0].date).toBe(date)
    await dragCalendarTask(date, calendarTargetDate)
    await expect(page.locator(`[data-calendar-date="${calendarTargetDate}"] [data-task-id="e2e-nlp-01"]`)).toBeVisible()
    await expect.poll(async () => {
      try {
        const source = await readFile(join(workspace, '00-dashboard', 'weeks', 'week-01.md'), 'utf8')
        return weeklyPlanSchema.parse(matter(source).data).tasks[0].date
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
        throw error
      }
    }).toBe(calendarTargetDate)
    expect(dailyRecordSchema.parse(matter(await readFile(dailyPath, 'utf8')).data).tasks[0].date).toBe(date)
    await page.waitForTimeout(75)
    await page.getByRole('button', { name: '本周', exact: true }).click()
    await expect(page.getByRole('heading', { name: '第 1 周' })).toBeVisible()

    await page.getByRole('button', { name: /路线/ }).click()
    await expect(page.getByRole('heading', { name: '从基础到研究室' })).toBeVisible()
    await page.waitForTimeout(150)
    await page.screenshot({ path: testInfo.outputPath('route-light-1440.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('link', { name: '外部资料' }).click()
    await expect(page).toHaveURL(/^file:/)
    expect(app.windows()).toHaveLength(1)
    expect(await page.evaluate(() => typeof (window as unknown as { myWay?: unknown }).myWay)).toBe('object')
    await page.getByRole('button', { name: /今天/ }).click()

    await page.getByRole('button', { name: '打开任务详情：Electron 真实任务' }).click()
    await expect(page.getByRole('button', { name: '返回今天' })).toBeVisible()
    await page.getByRole('textbox', { name: '任务备注' }).fill('## 实验过程\n\n比较 unigram 与 bigram。')
    await page.getByRole('textbox', { name: '学习成果' }).fill('macro-F1 提升到 0.82。')
    await page.getByText('任务信息', { exact: true }).click()
    const actual = page.getByLabel('实际分钟')
    await actual.fill('45', { force: true })
    await expect(page.getByRole('status', { name: 'Electron 真实任务状态：进行中' })).toBeVisible()
    await expect(actual).toHaveValue('45')
    await expect(page.getByRole('textbox', { name: '任务备注' })).toContainText('比较 unigram 与 bigram。')
    await page.waitForTimeout(1_000)
    await expect(actual).toHaveValue('45')
    await expect(page.locator('.save-state')).toContainText('本地保存')
    await expect.poll(async () => readFile(dailyPath, 'utf8')).toContain('actualMinutes: 45')
    await expect.poll(async () => readFile(dailyPath, 'utf8')).toContain('macro-F1 提升到 0.82。')
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.screenshot({ path: testInfo.outputPath('task-detail-light-1440.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '任务备注预览' }).click()
    await expect(page.getByLabel('任务备注内容预览').getByRole('heading', { name: '实验过程' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('task-detail-preview-light-1440.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '任务备注编辑' }).click()
    await expect(page.getByRole('textbox', { name: '任务备注' })).toContainText('比较 unigram 与 bigram。')
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.screenshot({ path: testInfo.outputPath('task-detail-light-1280.png'), fullPage: true, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'dark' })
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(32, 37, 31)')
    await page.waitForTimeout(150)
    await page.screenshot({ path: testInfo.outputPath('task-detail-dark-1280.png'), fullPage: true, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.getByRole('button', { name: '返回今天' }).click()
    await page.getByRole('button', { name: '计时器', exact: true }).click()
    await expect(page.getByRole('heading', { name: '计时器' })).toBeVisible()
    await expect(page.getByText('本地计时 · 跨页面持续', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '开始' })).toBeVisible()
    await expect(page.getByRole('button', { name: '打开计时器' })).toHaveCount(0)
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.getByRole('button', { name: '倒计时', exact: true }).click()
    await page.getByRole('button', { name: '50 分钟', exact: true }).click()
    await expect(page.getByRole('button', { name: '50 分钟', exact: true })).toHaveAttribute('aria-pressed', 'true')
    await page.waitForTimeout(150)
    await page.screenshot({ path: testInfo.outputPath('timer-countdown-light-1280.png'), fullPage: true, animations: 'disabled' })
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await page.getByRole('button', { name: '打开任务详情：Electron 真实任务' }).click()
    await expect(page.getByRole('button', { name: '开始专注' })).toBeVisible()
    await page.getByRole('button', { name: '开始专注' }).click()
    await expect(page.getByRole('heading', { name: '计时器' })).toBeVisible()
    await expect(page.locator('.active-timer').getByText('Electron 真实任务')).toBeVisible()
    await expect(page.locator('.timer-sidebar-status small')).toHaveText('Electron 真实任务')
    await expect(page.getByRole('button', { name: '暂停' })).toBeVisible()
    await page.waitForTimeout(2_100)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.screenshot({ path: testInfo.outputPath('timer-running-light-1280.png'), fullPage: true, animations: 'disabled' })
    for (const destination of ['今天', '日历', '本周', '路线', '计时器']) {
      await page.getByRole('button', { name: destination, exact: true }).click()
    }
    await expect(page.getByRole('button', { name: '打开计时器' })).toBeVisible()
    const elapsedBeforeClose = await page.getByLabel('当前计时').textContent()
    expect(elapsedBeforeClose).toMatch(/^00:0[2-9]$/)
    await app.close()
    runningApp = null

    const daily = await readFile(dailyPath, 'utf8')
    expect(daily).toContain('actualMinutes: 45')
    expect(daily).toContain('status: planned')
    expect(daily).toContain('比较 unigram 与 bigram。')
    expect(daily).toContain('macro-F1 提升到 0.82。')
    expect(await readFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), 'utf8')).toBe(routeBefore)

    const relaunched = await electron.launch(packagedExecutable
      ? { executablePath: packagedExecutable, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
      : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
    runningApp = relaunched
    const reopenedPage = await relaunched.firstWindow()
    await reopenedPage.getByRole('button', { name: '计时器', exact: true }).click()
    await expect(reopenedPage.getByText('计时已暂停')).toBeVisible()
    await expect(reopenedPage.locator('.active-timer').getByText('Electron 真实任务')).toBeVisible()
    await expect(reopenedPage.getByText('关闭 App 时自动暂停')).toBeVisible()
    const pausedAtOpen = await reopenedPage.getByLabel('当前计时').textContent()
    await reopenedPage.waitForTimeout(1_500)
    await expect(reopenedPage.getByLabel('当前计时')).toHaveText(pausedAtOpen ?? '')
    await reopenedPage.setViewportSize({ width: 1280, height: 800 })
    await reopenedPage.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await expect(reopenedPage.locator('body')).toHaveCSS('background-color', 'rgb(32, 37, 31)')
    await expect(reopenedPage.locator('.modal-backdrop')).toHaveCount(0)
    await reopenedPage.waitForTimeout(150)
    expect(await reopenedPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await reopenedPage.screenshot({ path: testInfo.outputPath('timer-paused-dark-1280.png'), fullPage: true, animations: 'disabled' })
    await reopenedPage.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await reopenedPage.getByRole('button', { name: '继续' }).click()
    await reopenedPage.waitForTimeout(1_100)
    await reopenedPage.getByRole('button', { name: '暂停' }).click()
    await expect(reopenedPage.getByText('手动暂停')).toBeVisible()
    await reopenedPage.getByRole('button', { name: '继续' }).click()
    await reopenedPage.waitForTimeout(1_100)
    await reopenedPage.getByRole('button', { name: '结束并分配' }).click()
    const assignment = reopenedPage.getByRole('dialog', { name: '学习时长分配' })
    await expect(assignment).toBeVisible()
    await expect(assignment.getByRole('combobox', { name: '任务' })).toHaveValue('e2e-nlp-01')
    await assignment.getByRole('spinbutton', { name: '计入分钟' }).fill('5')
    await assignment.getByRole('button', { name: '分配到任务' }).click()
    await expect(assignment).toHaveCount(0)
    await reopenedPage.getByRole('button', { name: '今天' }).click()
    await expect(reopenedPage.getByRole('button', { name: '编辑过去问记录：数学 · 2025 数学模拟卷' })).toBeVisible()
    await reopenedPage.getByRole('button', { name: '打开任务详情：Electron 真实任务' }).click()
    await reopenedPage.getByText('任务信息', { exact: true }).click()
    await expect(reopenedPage.getByLabel('实际分钟')).toHaveValue('50')
    await expect(reopenedPage.getByRole('status', { name: 'Electron 真实任务状态：进行中' })).toContainText('进行中')
    await expect(reopenedPage.getByRole('textbox', { name: '任务备注' })).toContainText('比较 unigram 与 bigram。')
    await expect(reopenedPage.getByRole('textbox', { name: '学习成果' })).toContainText('macro-F1 提升到 0.82。')

    const timerStatePath = join(workspace, 'data', 'timer', 'state.json')
    const timerLedgerPath = join(workspace, 'data', 'timer', date.slice(0, 4), `${date}.md`)
    const state = timerStateFileSchema.parse(JSON.parse(await readFile(timerStatePath, 'utf8')))
    const ledger = timerLedgerFileSchema.parse(matter(await readFile(timerLedgerPath, 'utf8')).data)
    const assignedSession = ledger.sessions.find((session) => session.status === 'assigned')
    expect(state.active).toBeNull()
    expect(ledger.schemaVersion).toBe(1)
    expect(ledger.sessions).toHaveLength(1)
    expect(assignedSession?.taskIntent).toEqual({ date, taskId: 'e2e-nlp-01', taskTitle: 'Electron 真实任务' })
    expect(assignedSession?.assignment).toMatchObject({ taskId: 'e2e-nlp-01', taskTitle: 'Electron 真实任务', creditedMinutes: 5 })
    const assignedDaily = dailyRecordSchema.parse(matter(await readFile(join(workspace, 'data', 'daily', date.slice(0, 4), `${date}.md`), 'utf8')).data)
    expect(assignedDaily.tasks[0].actualMinutes).toBe(50)
    const workspaceFiles = await readdir(workspace, { recursive: true })
    for (const relativePath of workspaceFiles.filter((entry) => typeof entry === 'string')) {
      const absolutePath = join(workspace, relativePath)
      let source: string
      try { source = await readFile(absolutePath, 'utf8') } catch { continue }
      if (assignedSession && source.includes(assignedSession.id)) expect(relativePath).toBe(join('data', 'timer', date.slice(0, 4), `${date}.md`))
    }
    expect(await readFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), 'utf8')).toBe(routeBefore)

    await relaunched.close()
    runningApp = null
    const persistedApp = await electron.launch(packagedExecutable
      ? { executablePath: packagedExecutable, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
      : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
    runningApp = persistedApp
    const persistedPage = await persistedApp.firstWindow()
    await persistedPage.getByRole('button', { name: '计时器', exact: true }).click()
    await expect(persistedPage.getByRole('button', { name: '开始' })).toBeVisible()
    await expect(persistedPage.getByText('Electron 真实任务')).toBeVisible()
    await persistedPage.getByRole('button', { name: '今天' }).click()
    await persistedPage.getByRole('button', { name: '打开任务详情：Electron 真实任务' }).click()
    await expect(persistedPage.getByLabel('实际分钟')).toHaveValue('50')

    await persistedPage.getByRole('textbox', { name: '任务标题' }).fill('Electron 真实任务 · 本地待保存')
    await writeFile(dailyPath, `${await readFile(dailyPath, 'utf8')}\n外部编辑保留\n`)
    await persistedPage.getByRole('button', { name: '删除任务' }).click()
    await persistedPage.getByRole('button', { name: '确认删除' }).click()
    await expect(persistedPage.getByRole('alert')).toContainText('删除前保存失败')
    await expect(persistedPage.getByRole('textbox', { name: '任务标题' })).toBeVisible()
    await persistedPage.getByRole('button', { name: '取消' }).click()
    await persistedPage.getByRole('button', { name: '重新载入' }).click()
    await expect(persistedPage.getByRole('textbox', { name: '任务标题' })).toHaveValue('Electron 真实任务')

    await persistedPage.getByRole('button', { name: '删除任务' }).click()
    await expect(persistedPage.getByRole('dialog')).toContainText('week-01.md')
    await persistedPage.getByRole('button', { name: '确认删除' }).click()
    await expect(persistedPage.getByRole('heading', { name: '今日任务' })).toBeVisible()
    await expect(persistedPage.getByRole('button', { name: '打开任务详情：Electron 真实任务' })).toHaveCount(0)

    const deletedDaily = await readFile(join(workspace, 'data', 'daily', date.slice(0, 4), `${date}.md`), 'utf8')
    const deletedWeek = await readFile(join(workspace, '00-dashboard', 'weeks', 'week-01.md'), 'utf8')
    expect(deletedDaily).not.toContain('e2e-nlp-01')
    expect(deletedDaily).toContain('外部编辑保留')
    expect(deletedDaily).toContain('2025 数学模拟卷')
    expect(deletedWeek).not.toContain('e2e-nlp-01')
    expect(deletedWeek).toContain('# E2E Week')
    expect(await readFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), 'utf8')).toBe(routeBefore)
    await persistedApp.close()
    runningApp = null
  } finally {
    if (runningApp) await runningApp.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('creates the current week, imports Today explicitly, and protects a local draft from external edits', async ({ browserName }, testInfo) => {
  test.setTimeout(45_000)
  expect(browserName).toBe('chromium')
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-weekly-restart-'))
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-weekly-restart-userdata-'))
  const date = localDate()
  const currentMonday = format(startOfWeek(parseISO(date), { weekStartsOn: 1 }), 'yyyy-MM-dd')
  const currentSunday = format(addDays(parseISO(currentMonday), 6), 'yyyy-MM-dd')
  const previousMonday = format(subWeeks(parseISO(currentMonday), 2), 'yyyy-MM-dd')
  const previousTuesday = format(addDays(parseISO(previousMonday), 1), 'yyyy-MM-dd')
  const previousSunday = format(addDays(parseISO(previousMonday), 6), 'yyyy-MM-dd')
  const weekOnePath = join(workspace, '00-dashboard', 'weeks', 'week-01.md')
  const weekThreePath = join(workspace, '00-dashboard', 'weeks', 'week-03.md')
  const routePath = join(workspace, '00-dashboard', '12-week-roadmap.md')
  const todayPath = join(workspace, 'data', 'daily', date.slice(0, 4), `${date}.md`)
  let runningApp: Awaited<ReturnType<typeof electron.launch>> | null = null

  const launch = () => {
    const packagedExecutable = process.env.MY_WAY_E2E_EXECUTABLE
    return electron.launch(packagedExecutable
      ? { executablePath: packagedExecutable, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
      : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
  }

  try {
    await mkdir(join(workspace, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(workspace, '05-admissions'), { recursive: true })
    await mkdir(join(workspace, 'data', 'daily', previousMonday.slice(0, 4)), { recursive: true })
    await writeFile(join(workspace, 'README.md'), '# My Way\n')
    await writeFile(routePath, '# 12 周路线\n\n## Week 1–3 基础校准\n')
    await writeFile(join(workspace, '00-dashboard', 'long-term-roadmap.md'), '# 长期路线\n')
    await writeFile(join(workspace, '00-dashboard', 'current-status.md'), '# 当前状态\n')
    await writeFile(weekOnePath, `---
schemaVersion: 1
week: 1
startDate: '${previousMonday}'
endDate: '${previousSunday}'
tasks:
  - id: previous-nlp-baseline
    date: '${previousMonday}'
    category: nlp
    title: 继续 NLP 基线
    plannedMinutes: 90
    deliverable: evidence/previous-nlp.md
  - id: previous-exam-diagnostic
    date: '${previousTuesday}'
    category: exam
    title: 跳过的数学诊断
    plannedMinutes: 120
    deliverable: evidence/previous-exam.md
---

# 第 1 周
`)
    await writeFile(join(workspace, 'data', 'daily', previousMonday.slice(0, 4), `${previousMonday}.md`), `---
schemaVersion: 1
date: '${previousMonday}'
sourceWeek: 1
tasks:
  - id: previous-nlp-baseline
    date: '${previousMonday}'
    originalDate: '${previousMonday}'
    category: nlp
    title: 继续 NLP 基线
    plannedMinutes: 90
    deliverable: evidence/previous-nlp.md
    actualMinutes: 25
    status: planned
    evidence: []
    notes: ''
    outcomes: ''
  - id: previous-exam-diagnostic
    date: '${previousTuesday}'
    originalDate: '${previousTuesday}'
    category: exam
    title: 跳过的数学诊断
    plannedMinutes: 120
    deliverable: evidence/previous-exam.md
    actualMinutes: 0
    status: skipped
    evidence: []
    notes: ''
    outcomes: ''
reflection:
  learned: '完成 NLP 基线复盘'
  blockers: '概率论证明仍不稳定'
  tomorrow: '重做两道条件概率题'
pastExams: []
updatedAt: '2026-08-17T12:00:00.000Z'
---
`)
    await mkdir(join(workspace, 'data', 'daily', date.slice(0, 4)), { recursive: true })
    await writeFile(todayPath, `---
schemaVersion: 1
date: '${date}'
sourceWeek: null
tasks:
  - id: current-nlp-outcome
    date: '${date}'
    originalDate: '${date}'
    category: nlp
    title: NLP 分类基线
    plannedMinutes: 60
    deliverable: evidence/current-nlp.md
    actualMinutes: 45
    status: done
    evidence: []
    notes: ''
    outcomes: 'macro-F1 提升到 0.82'
reflection:
  learned: ''
  blockers: ''
  tomorrow: ''
pastExams: []
updatedAt: '2026-09-01T08:00:00.000Z'
---
`)
    await writeFile(join(userData, 'workspace.json'), `${JSON.stringify({ root: workspace })}\n`)

    const weekOneBefore = await readFile(weekOnePath, 'utf8')
    const routeBefore = await readFile(routePath, 'utf8')
    runningApp = await launch()
    const page = await runningApp.firstWindow()

    await expect(page.getByRole('button', { name: '建立本周计划' })).toBeVisible()
    await page.getByRole('textbox', { name: '学习成果' }).fill('完成 NLP 基线复盘')
    await page.getByRole('textbox', { name: '当前难点' }).fill('概率论证明仍不稳定')
    await page.getByRole('textbox', { name: '明日计划调整' }).fill('重做两道条件概率题')
    await page.getByRole('button', { name: '建立本周计划' }).click()
    await expect(page.getByRole('heading', { name: '第 3 周' })).toBeVisible()
    await expect(page.getByText(`${Number(currentMonday.slice(5, 7))} 月 ${Number(currentMonday.slice(8))} 日 — ${Number(currentSunday.slice(5, 7))} 月 ${Number(currentSunday.slice(8))} 日`)).toBeVisible()
    await expect(page.getByTestId('week-task-row')).toHaveCount(0)
    await expect(page.getByText('按需加入，不自动顺延', { exact: true })).toBeVisible()

    await page.getByRole('checkbox', { name: '选择 继续 NLP 基线' }).check()
    await page.getByRole('button', { name: '加入草案' }).click()
    await page.getByRole('button', { name: '新增任务' }).click()
    const rows = page.getByTestId('week-task-row')
    await expect(rows).toHaveCount(2)
    const newTask = rows.nth(1)
    const entryAnimations = await newTask.evaluate((element) => element.getAnimations().map((animation) => {
      animation.pause()
      animation.currentTime = 90
      return animation.effect?.getTiming().duration
    }))
    expect(entryAnimations).toContain(180)
    await newTask.screenshot({ path: testInfo.outputPath('weekly-task-motion-midpoint.png') })
    await newTask.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
    await newTask.getByLabel('任务日期').fill(date)
    await newTask.getByLabel('任务类别').selectOption('exam')
    await newTask.getByLabel('任务标题').fill('当日数学诊断')
    await newTask.getByLabel('计划分钟').fill('150')
    await newTask.getByLabel('预期产物').fill('evidence/week-03-math.md')
    await page.getByRole('button', { name: '保存本周计划' }).click()
    await expect(page.getByText('已保存', { exact: true })).toBeVisible()

    await expect.poll(async () => {
      const source = await readFile(weekThreePath, 'utf8')
      return weeklyPlanSchema.parse(matter(source).data).tasks.map((task) => task.title)
    }).toEqual(['继续 NLP 基线', '当日数学诊断'])
    const savedWeek = weeklyPlanSchema.parse(matter(await readFile(weekThreePath, 'utf8')).data)
    expect(savedWeek).toMatchObject({ week: 3, startDate: currentMonday, endDate: currentSunday })
    expect(await readFile(weekOnePath, 'utf8')).toBe(weekOneBefore)
    expect(await readFile(routePath, 'utf8')).toBe(routeBefore)

    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await page.getByRole('button', { name: '复盘', exact: true }).click()
    const reducedReview = page.getByLabel('本周复盘')
    await expect(reducedReview).toBeVisible()
    await expect(reducedReview.getByText('实际时间变化')).toBeVisible()
    await expect(reducedReview.getByText('完成率变化')).toBeVisible()
    await expect(reducedReview.getByRole('heading', { name: '日终复盘' })).toBeVisible()
    await expect(reducedReview.getByText('完成 NLP 基线复盘')).toBeVisible()
    await expect(reducedReview.getByText('概率论证明仍不稳定')).toBeVisible()
    await expect(reducedReview.getByRole('heading', { name: '任务成果' })).toBeVisible()
    await expect(reducedReview.getByText('macro-F1 提升到 0.82')).toBeVisible()
    expect(await reducedReview.evaluate((element) => getComputedStyle(element).transform)).toBe('none')
    await page.waitForTimeout(150)
    const reviewMode = page.getByRole('button', { name: '复盘', exact: true })
    await expect(page.locator('.week-mode-switch .selection-indicator')).toHaveCSS('background-color', 'rgb(71, 99, 78)')
    await expect(reviewMode).toHaveCSS('color', 'rgb(255, 255, 255)')
    await page.screenshot({ path: testInfo.outputPath('weekly-review-light-1440.png'), fullPage: true, animations: 'disabled' })
    await reducedReview.getByRole('button', { name: `打开 ${date} NLP 分类基线任务详情` }).click()
    await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveValue('NLP 分类基线')
    await expect(page.getByRole('textbox', { name: '学习成果' })).toHaveText('macro-F1 提升到 0.82')
    await page.keyboard.press('Meta+[')
    await expect(page.getByRole('button', { name: '返回本周', exact: true })).toBeVisible()
    await page.keyboard.press('Meta+[')
    await expect(page.getByLabel('本周复盘')).toBeVisible()
    await expect(reducedReview.getByRole('button', { name: `打开 ${date} NLP 分类基线任务详情` })).toBeFocused()
    const reflectionOpener = reducedReview.getByRole('button', { name: `打开 ${date} 日终复盘记录` })
    await reflectionOpener.click()
    await expect(page.getByRole('heading', { name: /今天/ })).toBeVisible()
    await page.getByRole('button', { name: '返回本周', exact: true }).click()
    await expect(page.getByLabel('本周复盘')).toBeVisible()
    await expect(reflectionOpener).toBeFocused()
    await page.getByRole('button', { name: '计划', exact: true }).click()
    const planMode = page.getByRole('button', { name: '计划', exact: true })
    await expect(page.locator('.week-mode-switch .selection-indicator')).toHaveCSS('background-color', 'rgb(71, 99, 78)')
    await expect(planMode).toHaveCSS('color', 'rgb(255, 255, 255)')
    await page.waitForTimeout(150)
    await page.locator('.week-workspace').evaluate((element) => { element.scrollTop = 0 })
    await page.screenshot({ path: testInfo.outputPath('weekly-restart-light-1440.png'), fullPage: true, animations: 'disabled' })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(32, 37, 31)')
    await page.waitForTimeout(150)
    await page.locator('.week-workspace').evaluate((element) => { element.scrollTop = 0 })
    await page.screenshot({ path: testInfo.outputPath('weekly-restart-dark-1280.png'), fullPage: true, animations: 'disabled' })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })

    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect(page.getByRole('button', { name: '导入新增任务' })).toBeVisible()
    await page.getByRole('button', { name: '导入新增任务' }).click()
    await expect(page.getByRole('button', { name: '打开任务详情：当日数学诊断' })).toBeVisible()
    await expect.poll(async () => dailyRecordSchema.parse(matter(await readFile(todayPath, 'utf8')).data).tasks.map((task) => task.title)).toContain('当日数学诊断')

    await runningApp.close()
    runningApp = null
    runningApp = await launch()
    const reopened = await runningApp.firstWindow()
    await expect(reopened.getByRole('button', { name: '打开任务详情：当日数学诊断' })).toBeVisible()
    await reopened.getByRole('button', { name: '本周', exact: true }).click()
    const carriedTitle = reopened.getByRole('textbox', { name: '任务标题', exact: true }).first()
    await expect(carriedTitle).toHaveValue('继续 NLP 基线')

    await carriedTitle.fill('本地草案不会覆盖外部版本')
    const externalSource = `${await readFile(weekThreePath, 'utf8')}\n<!-- external revision -->\n`
    await writeFile(weekThreePath, externalSource)
    await expect(reopened.getByText(/当前草案不会被静默覆盖/).first()).toBeVisible()
    await expect(carriedTitle).toHaveValue('本地草案不会覆盖外部版本')
    await expect(reopened.getByRole('button', { name: '保存更改' })).toBeDisabled()
    await reopened.waitForTimeout(900)
    expect(await readFile(weekThreePath, 'utf8')).toBe(externalSource)

    await reopened.getByRole('button', { name: '另存冲突副本' }).click()
    await expect(carriedTitle).toHaveValue('继续 NLP 基线')
    await expect.poll(async () => (
      await readdir(join(workspace, '00-dashboard', 'weeks'))
    ).filter((name) => /^week-03\.conflict-.+\.md$/.test(name))).toHaveLength(1)
    const [conflictName] = (await readdir(join(workspace, '00-dashboard', 'weeks')))
      .filter((name) => /^week-03\.conflict-.+\.md$/.test(name))
    const conflictPath = join(workspace, '00-dashboard', 'weeks', conflictName)
    expect(weeklyPlanSchema.parse(matter(await readFile(conflictPath, 'utf8')).data).tasks[0].title).toBe('本地草案不会覆盖外部版本')
    expect(await readFile(weekThreePath, 'utf8')).toBe(externalSource)
    await expect(reopened.getByText(`冲突草案已另存为 ${conflictName}；当前周计划已重新载入。`)).toBeVisible()
    await runningApp.close()
    runningApp = null
    expect(await readFile(weekOnePath, 'utf8')).toBe(weekOneBefore)
    expect(await readFile(routePath, 'utf8')).toBe(routeBefore)
  } finally {
    if (runningApp) await runningApp.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})

test('completes a one-minute countdown once and assigns it after restart', async ({ browserName }) => {
  test.setTimeout(90_000)
  expect(browserName).toBe('chromium')
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-countdown-'))
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-countdown-userdata-'))
  const date = localDate()
  const weekRange = naturalWeekFor(date)
  let runningApp: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    await mkdir(join(workspace, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(workspace, '05-admissions'), { recursive: true })
    await writeFile(join(workspace, 'README.md'), '# My Way\n')
    await writeFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), '# 12 周路线\n')
    await writeFile(join(workspace, '00-dashboard', 'long-term-roadmap.md'), '# 长期路线\n')
    await writeFile(join(workspace, '00-dashboard', 'current-status.md'), '# 当前状态\n')
    await writeFile(join(workspace, '00-dashboard', 'weeks', 'week-01.md'), `---
schemaVersion: 1
week: 1
startDate: '${weekRange.startDate}'
endDate: '${weekRange.endDate}'
tasks:
  - id: countdown-task
    date: '${date}'
    category: nlp
    title: 倒计时验证任务
    plannedMinutes: 60
    deliverable: notes/countdown.md
---

# Countdown E2E
`)
    await writeFile(join(userData, 'workspace.json'), `${JSON.stringify({ root: workspace })}\n`)
    const routeBefore = await readFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), 'utf8')
    const packagedExecutable = process.env.MY_WAY_E2E_EXECUTABLE
    const app = await electron.launch(packagedExecutable
      ? { executablePath: packagedExecutable, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
      : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
    runningApp = app
    const page = await app.firstWindow()
    await expect(page.getByRole('button', { name: '打开任务详情：倒计时验证任务' })).toBeVisible()
    await page.getByRole('button', { name: '计时器', exact: true }).click()
    await page.getByRole('button', { name: '倒计时' }).click()
    await page.getByRole('spinbutton', { name: '自定义倒计时分钟' }).fill('1')
    await page.getByRole('combobox', { name: '关联任务' }).click()
    await page.getByRole('option', { name: /倒计时验证任务/ }).click()
    await page.getByRole('button', { name: '开始' }).click()
    await expect(page.getByLabel('当前计时')).toHaveText(/^00:5[89]$/)
    const readCountdown = async () => timerStateFileSchema.parse(JSON.parse(await readFile(join(workspace, 'data', 'timer', 'state.json'), 'utf8'))).active
    const originalCountdown = await readCountdown()
    expect(originalCountdown?.taskIntent?.taskId).toBe('countdown-task')
    await page.getByRole('combobox', { name: '关联任务' }).click()
    await page.getByRole('option', { name: '不关联任务', exact: true }).click()
    await expect.poll(async () => (await readCountdown())?.taskIntent).toBeUndefined()
    await page.getByRole('combobox', { name: '关联任务' }).click()
    await page.getByRole('option', { name: /倒计时验证任务/ }).click()
    await expect.poll(async () => (await readCountdown())?.taskIntent?.taskId).toBe('countdown-task')
    expect(await readCountdown()).toMatchObject({ id: originalCountdown!.id, mode: 'countdown', targetSeconds: 60, accumulatedSeconds: 0, ...('segmentStartedAt' in originalCountdown! ? { segmentStartedAt: originalCountdown.segmentStartedAt } : {}) })
    await page.getByRole('button', { name: '今天' }).click()
    await page.waitForTimeout(1_000)
    await page.getByRole('button', { name: '打开计时器' }).click()
    const completion = page.getByRole('dialog', { name: '学习时段完成' })
    await expect(completion).toBeVisible({ timeout: 70_000 })
    await expect(page.getByText('00:00', { exact: true })).toBeVisible()
    await completion.getByRole('button', { name: '记录学习成果' }).click()
    const assignment = page.getByRole('dialog', { name: '学习时长分配' })
    await expect(assignment).toBeVisible()
    await assignment.getByRole('button', { name: '暂不分配' }).click()
    await expect(page.locator('.timer-ledger').first().getByRole('button', { name: '分配' })).toBeVisible()
    await expect(page.locator('.timer-ledger').nth(1).getByRole('button', { name: '稍后分配' })).toHaveCount(0)
    await app.close()
    runningApp = null

    const relaunched = await electron.launch(packagedExecutable
      ? { executablePath: packagedExecutable, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
      : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
    runningApp = relaunched
    const reopenedPage = await relaunched.firstWindow()
    await reopenedPage.getByRole('button', { name: '计时器', exact: true }).click()
    const pending = reopenedPage.locator('.timer-ledger').first().getByRole('button', { name: '分配' })
    await expect(pending).toBeVisible()
    await pending.click()
    const reopenedAssignment = reopenedPage.getByRole('dialog', { name: '学习时长分配' })
    await expect(reopenedAssignment.getByRole('spinbutton', { name: '计入分钟' })).toHaveValue('1')
    await reopenedAssignment.getByRole('button', { name: '分配到任务' }).click()
    await expect(reopenedAssignment).toHaveCount(0)
    await reopenedPage.getByRole('button', { name: '今天' }).click()
    await expect(reopenedPage.getByLabel('倒计时验证任务 实际分钟')).toHaveValue('1')

    const state = timerStateFileSchema.parse(JSON.parse(await readFile(join(workspace, 'data', 'timer', 'state.json'), 'utf8')))
    const ledgerSource = await readFile(join(workspace, 'data', 'timer', date.slice(0, 4), `${date}.md`), 'utf8')
    const ledger = timerLedgerFileSchema.parse(matter(ledgerSource).data)
    const daily = dailyRecordSchema.parse(matter(await readFile(join(workspace, 'data', 'daily', date.slice(0, 4), `${date}.md`), 'utf8')).data)
    expect(state).toMatchObject({ schemaVersion: 1, active: null })
    expect(ledger.sessions).toHaveLength(1)
    expect(ledger.sessions[0]).toMatchObject({ mode: 'countdown', targetSeconds: 60, durationSeconds: 60, status: 'assigned', taskIntent: { taskId: 'countdown-task' } })
    expect(ledger.sessions[0].status === 'assigned' ? ledger.sessions[0].assignment.creditedMinutes : null).toBe(1)
    expect(daily.tasks[0].actualMinutes).toBe(1)
    expect(await readFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), 'utf8')).toBe(routeBefore)
    await relaunched.close()
    runningApp = null
  } finally {
    if (runningApp) await runningApp.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
