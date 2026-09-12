import { test, expect, _electron as electron, type Page } from '@playwright/test'
import matter from 'gray-matter'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { addDays, format, startOfWeek } from 'date-fns'
import { timerStateFileSchema } from '../../src/shared/timerSchemas'
import { dailyRecordSchema } from '../../src/shared/schemas'

async function noHorizontalOverflow(page: Page) {
  expect(await page.evaluate(() => ({
    document: document.documentElement.scrollWidth <= innerWidth,
    stage: document.querySelector('.workspace-stage')!.scrollWidth <= document.querySelector('.workspace-stage')!.clientWidth + 1,
    workspace: document.querySelector('.workspace')!.scrollWidth <= document.querySelector('.workspace')!.clientWidth + 1
  }))).toEqual({ document: true, stage: true, workspace: true })
}

test('soft-native layout and task intent survive navigation, resize, clear, pause, restart and manual fitness allocation', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  test.setTimeout(90_000)
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-soft-native-'))
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-soft-native-user-'))
  const date = format(new Date(), 'yyyy-MM-dd')
  const firstDay = startOfWeek(new Date(), { weekStartsOn: 1 })
  const title = '自然语言处理：文本表示、相似度实验与误差分析，记录复现结果和下一步假设'
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
      await writeFile(join(workspace, '00-dashboard', `${name}.md`), `# ${name}\n\n临时工作区路线，保持只读。\n`)
    }
    const weekPath = join(workspace, '00-dashboard', 'weeks', 'week-01.md')
    await writeFile(weekPath, matter.stringify('# 本周\n', {
      schemaVersion: 1, week: 1, startDate: format(firstDay, 'yyyy-MM-dd'), endDate: format(addDays(firstDay, 6), 'yyyy-MM-dd'),
      tasks: [
        { id: 'nlp', date, category: 'nlp', title, plannedMinutes: 60, deliverable: 'notes/analysis.md' },
        { id: 'fitness', date, category: 'fitness', title: '力量训练与拉伸', plannedMinutes: 45, deliverable: '' }
      ]
    }))
    const weekBefore = await readFile(weekPath, 'utf8')
    await writeFile(join(userData, 'workspace.json'), JSON.stringify({ root: workspace }))
    const statePath = join(workspace, 'data', 'timer', 'state.json')
    const dailyPath = join(workspace, 'data', 'daily', date.slice(0, 4), `${date}.md`)
    const state = async () => timerStateFileSchema.parse(JSON.parse(await readFile(statePath, 'utf8')))
    const day = async () => dailyRecordSchema.parse(matter(await readFile(dailyPath, 'utf8')).data)

    app = await launch()
    let page = await app.firstWindow()
    await expect(page.getByRole('button', { name: `打开任务详情：${title}` })).toBeVisible()
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(size)
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme })
        for (const destination of ['今天', '日历', '本周', '路线', '计时器']) {
          await page.getByRole('button', { name: destination, exact: true }).click()
          await noHorizontalOverflow(page)
          if (destination === '计时器') {
            const dial = await page.locator('.timer-dial').boundingBox()
            expect(dial).not.toBeNull()
            expect(Math.abs(dial!.width - dial!.height)).toBeLessThan(.5)
            expect(Math.round(dial!.width)).toBe(size.width === 1440 ? 334 : 300)
            await page.getByRole('combobox', { name: '关联任务' }).click()
            await expect(page.getByRole('option', { name: new RegExp(title) })).toBeVisible()
            const menu = await page.getByRole('listbox').boundingBox()
            expect(menu!.x).toBeGreaterThanOrEqual(12)
            expect(menu!.x + menu!.width).toBeLessThanOrEqual(size.width - 12)
            expect(menu!.y + menu!.height).toBeLessThanOrEqual(size.height - 12)
            await page.screenshot({ path: testInfo.outputPath(`picker-${colorScheme}-${size.width}.png`), animations: 'disabled' })
            await page.keyboard.press('Escape')
            await expect(page.getByRole('listbox')).toHaveCount(0)
            await expect(page.getByRole('combobox', { name: '关联任务' })).toBeFocused()
          } else {
            await page.screenshot({ path: testInfo.outputPath(`${destination}-${colorScheme}-${size.width}.png`), animations: 'disabled' })
          }
        }
      }
    }
    const clock = await page.getByLabel('当前计时').elementHandle()
    await page.getByRole('button', { name: '收起本周摘要' }).click()
    await expect(page.getByRole('complementary', { name: '学习摘要' })).toHaveCount(0)
    await expect(page.getByRole('status')).toContainText('本地保存')
    expect(await clock!.evaluate(element => element === document.querySelector('[aria-label="当前计时"]'))).toBe(true)
    await page.setViewportSize({ width: 1180, height: 760 })
    await noHorizontalOverflow(page)
    await page.getByRole('button', { name: '展开本周摘要' }).click()
    await noHorizontalOverflow(page)
    await page.screenshot({ path: testInfo.outputPath('timer-1180-expanded.png'), animations: 'disabled' })

    const picker = page.getByRole('combobox', { name: '关联任务' })
    await picker.focus()
    await page.keyboard.press('Home')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(picker).toContainText(title)
    await page.getByRole('button', { name: '开始', exact: true }).click()
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible()
    const original = (await state()).active!
    await expect.poll(async () => page.getByLabel('当前计时').textContent()).not.toBe('00:00')
    await picker.click()
    await page.getByRole('option', { name: /力量训练与拉伸/ }).click()
    await expect.poll(async () => ({ intent: (await state()).active?.taskIntent?.taskId, error: await page.locator('.timer-error').allTextContents(), label: await picker.textContent() })).toMatchObject({ intent: 'fitness', error: [] })
    const retargeted = (await state()).active!
    expect(retargeted).toMatchObject({ id: original.id, mode: original.mode, createdAt: original.createdAt, accumulatedSeconds: original.accumulatedSeconds, ...('segmentStartedAt' in original ? { segmentStartedAt: original.segmentStartedAt } : {}) })
    expect((await day()).tasks.map(task => task.actualMinutes)).toEqual([0, 0])
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect(page.locator('.task-row.is-focused')).toHaveAttribute('data-task-id', 'fitness')
    await page.getByRole('button', { name: '计时器', exact: true }).click()
    await picker.click()
    await page.getByRole('option', { name: '不关联任务', exact: true }).click()
    await expect.poll(async () => (await state()).active?.taskIntent).toBeUndefined()
    expect((await state()).active?.id).toBe(original.id)
    await page.getByRole('button', { name: '暂停', exact: true }).click()
    await expect(page.getByRole('button', { name: '继续', exact: true })).toBeVisible()
    await expect.poll(async () => (await state()).active?.status).toBe('paused')
    const paused = (await state()).active!
    await picker.click()
    await page.getByRole('option', { name: /力量训练与拉伸/ }).click()
    await expect.poll(async () => (await state()).active?.taskIntent?.taskId).toBe('fitness')
    expect((await state()).active).toMatchObject({ id: original.id, status: 'paused', accumulatedSeconds: paused.accumulatedSeconds, pauseReason: 'user' })
    await page.getByRole('button', { name: '继续', exact: true }).click()
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible()
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await page.getByRole('button', { name: '计时器', exact: true }).click()
    await expect(page.getByRole('combobox', { name: '关联任务' })).toContainText('力量训练与拉伸')
    await expect(page.getByText('关闭 App 时自动暂停')).toBeVisible()
    expect((await state()).active).toMatchObject({ id: original.id, status: 'paused', taskIntent: { taskId: 'fitness' } })
    await page.getByRole('button', { name: '结束并分配' }).click()
    const assignment = page.getByRole('dialog', { name: '学习时长分配' })
    await expect(assignment.getByRole('combobox', { name: '任务' })).toHaveValue('fitness')
    expect((await day()).tasks.map(task => task.actualMinutes)).toEqual([0, 0])
    await assignment.getByRole('spinbutton', { name: '计入分钟' }).fill('2')
    await assignment.getByRole('button', { name: '分配到任务' }).click()
    await expect(assignment).toHaveCount(0)
    expect((await day()).tasks.map(task => task.actualMinutes)).toEqual([0, 2])
    expect(await readFile(weekPath, 'utf8')).toBe(weekBefore)
    expect(await readFile(join(workspace, '00-dashboard', '12-week-roadmap.md'), 'utf8')).toBe('# 12-week-roadmap\n\n临时工作区路线，保持只读。\n')
  } finally {
    if (app) await app.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
