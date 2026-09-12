import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { format, addDays, parseISO } from 'date-fns'
import matter from 'gray-matter'
import { naturalWeekRange } from '../../src/shared/weekPlanning'

test('reviewed workspace: readable controls, calendar actions, editor history and persisted data', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  test.setTimeout(90_000)
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-experience-'))
  const userData = await mkdtemp(join(tmpdir(), 'my-way-experience-user-'))
  const today = format(new Date(), 'yyyy-MM-dd')
  const range = naturalWeekRange(today)
  const dailyPath = join(workspace, 'data/daily', today.slice(0, 4), `${today}.md`)
  const tasks = [
    ['nlp', '复现 Transformer 的多头注意力', 90, 'notebooks/attention.ipynb'],
    ['exam', '线性代数：特征值与对角化', 60, '完成例题与错题整理'],
    ['english', '英语阅读与词汇', 30, ''],
    ['japanese', '日语基础语法与跟读', 30, ''],
    ['fitness', '力量训练与拉伸', 150, '']
  ].map(([category, title, plannedMinutes, deliverable], index) => ({ id: `audit-${index}`, category, title, plannedMinutes, deliverable, date: today }))
  const weekSource = matter.stringify('# 本周安排\n', { schemaVersion: 1, week: 1, ...range, tasks })
  const longTitle = '注意力机制复现：从张量维度检查到多头拼接，整理实验结果与实现过程中的问题'
  const launch = () => electron.launch({
    ...(process.env.MY_WAY_E2E_EXECUTABLE ? { executablePath: process.env.MY_WAY_E2E_EXECUTABLE } : {}),
    args: [...(process.env.MY_WAY_E2E_EXECUTABLE ? [] : [join(process.cwd(), 'out/main/index.js')]), `--user-data-dir=${userData}`],
    env: { ...process.env, MY_WAY_E2E: '1' }
  })
  let app: Awaited<ReturnType<typeof launch>> | null = null
  try {
    await mkdir(join(workspace, '00-dashboard/weeks'), { recursive: true })
    await mkdir(join(workspace, '05-admissions'))
    await writeFile(join(workspace, 'README.md'), '# My Way\n')
    for (const name of ['12-week-roadmap', 'long-term-roadmap', 'current-status']) {
      await writeFile(join(workspace, '00-dashboard', `${name}.md`), '# 学习路线\n\n## 本阶段目标\n\n数学基础、语言能力与 NLP 实验。\n\n- 线性代数与概率\n- 阅读与复现\n- 过去问复盘\n')
    }
    await writeFile(join(workspace, '00-dashboard/weeks/week-01.md'), weekSource)
    await writeFile(join(userData, 'workspace.json'), JSON.stringify({ root: workspace }))
    app = await launch()
    let page = await app.firstWindow()
    const capture = (name: string) => page.screenshot({ path: testInfo.outputPath(`${name}.png`), animations: 'disabled' })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' })
    await expect(page.getByRole('button', { name: `打开任务详情：${tasks[0].title}` })).toBeVisible()
    const controls = await page.locator('.task-meta button, .time-inputs input').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height))
    expect(controls.every(height => height >= 30)).toBe(true)
    await capture('today-light-1440')

    await page.getByRole('button', { name: `打开任务详情：${tasks[0].title}` }).click()
    await expect(page.getByRole('spinbutton', { name: '计划分钟', exact: true })).toBeVisible()
    await page.getByRole('textbox', { name: '任务标题' }).fill(longTitle)
    const notes = page.getByRole('textbox', { name: '任务备注', exact: true })
    await notes.fill('保留的学习备注')
    await notes.press('End')
    await notes.press('Enter')
    await notes.pressSequentially('undo-test')
    await notes.press('Meta+z')
    await expect(notes).not.toContainText('undo-test')
    await notes.press('Meta+Shift+z')
    await expect(notes).toContainText('undo-test')
    await page.getByRole('textbox', { name: '学习成果', exact: true }).fill('完成维度验证与基础实验。')
    // The primary actions remain reachable while writing further down the page.
    await page.locator('.task-detail-view').evaluate(element => { element.scrollTop = element.scrollHeight })
    await expect(page.getByRole('button', { name: '保存并返回' })).toBeInViewport()
    await page.getByRole('button', { name: '保存' , exact: true }).click()
    await page.locator('.task-detail-view').evaluate(element => { element.scrollTop = 0 })
    await page.setViewportSize({ width: 1280, height: 800 })
    await capture('detail-light-1280')
    await page.getByRole('button', { name: '保存并返回' }).click()

    await page.getByRole('button', { name: '日历', exact: true }).click()
    const column = page.locator(`[data-calendar-date="${today}"]`)
    await expect(column.locator('.calendar-task')).toHaveCount(5)
    await expect(column.locator('.day-load')).toContainText('学习 3 小时 30 分钟')
    await expect(column.locator('.day-load')).toContainText('健身 2 小时 30 分钟')
    const todayColors = await column.locator('[aria-current="date"] strong').evaluate(element => ({ color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor }))
    expect(todayColors.color).not.toBe(todayColors.background)
    await capture('calendar-light-1280')
    await column.getByRole('button', { name: `打开任务详情：${longTitle}` }).click()
    await expect(page.getByRole('textbox', { name: '任务标题' })).toHaveValue(longTitle)
    await page.getByRole('button', { name: '保存并返回' }).click()
    await page.getByRole('button', { name: '日历', exact: true }).click()
    await page.getByRole('button', { name: '月', exact: true }).click()
    await capture('month-light-1280')
    await page.getByRole('button', { name: '周', exact: true }).click()
    const emptyDate = format(addDays(parseISO(range.startDate), today === range.startDate ? 1 : 0), 'yyyy-MM-dd')
    await page.getByRole('button', { name: `打开 ${emptyDate} 记录` }).click()
    await expect(page.getByRole('button', { name: '开始记录' })).toBeVisible()
    await expect(readFile(join(workspace, 'data/daily', emptyDate.slice(0, 4), `${emptyDate}.md`))).rejects.toThrow()
    await capture('empty-day-light-1280')

    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' })
      for (const view of ['本周', '路线', '计时器']) {
        await page.getByRole('button', { name: view, exact: true }).click()
        await expect(page.locator('main.workspace')).toBeVisible()
        if (view === '路线') await expect(page.locator('.markdown-document')).toContainText('本阶段目标')
        if (view === '计时器') await page.getByRole('button', { name: '倒计时', exact: true }).click()
        await capture(`${view}-${colorScheme}-1280`)
        expect(await page.locator('.workspace').evaluate(element => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
      }
    }
    const input = page.getByRole('spinbutton', { name: '自定义倒计时分钟' })
    await input.fill('')
    await expect(input).toHaveValue('')
    await expect(page.getByRole('button', { name: '开始', exact: true })).toBeDisabled()
    await input.fill('35')
    await page.getByRole('button', { name: '开始', exact: true }).click()
    await expect(page.getByRole('button', { name: '暂停', exact: true })).toBeVisible()
    for (let index = 0; index < 3; index += 1) {
      await page.getByRole('combobox', { name: '关联任务' }).click()
      await page.getByRole('option', { name: /力量训练与拉伸/ }).click()
      await expect(page.getByRole('combobox', { name: '关联任务' })).toContainText('力量训练与拉伸')
      await page.getByRole('combobox', { name: '关联任务' }).click()
      await page.getByRole('option', { name: '不关联任务', exact: true }).click()
    }
    await page.getByRole('button', { name: '今天', exact: true }).click()
    await expect(page.locator('.timer-sidebar-status')).toContainText('34:')
    await capture('today-dark-1280')
    const savedBeforeClose = matter(await readFile(dailyPath, 'utf8')).data
    await app.close()
    app = await launch()
    page = await app.firstWindow()
    await expect(page.getByRole('button', { name: `打开任务详情：${longTitle}` })).toBeVisible()
    await page.getByRole('button', { name: '计时器', exact: true }).click()
    await expect(page.getByText('关闭 App 时自动暂停')).toBeVisible()
    expect(matter(await readFile(dailyPath, 'utf8')).data.tasks).toEqual(savedBeforeClose.tasks)
    expect(await readFile(join(workspace, '00-dashboard/weeks/week-01.md'), 'utf8')).toBe(weekSource)
  } finally {
    if (app) await app.close().catch(() => undefined)
    await rm(workspace, { recursive: true, force: true })
    await rm(userData, { recursive: true, force: true })
  }
})
