import { test, expect, _electron as electron } from '@playwright/test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

test('native fullscreen can be exited on launch and while editing without losing a draft', async ({ browserName }, testInfo) => {
  expect(browserName).toBe('chromium')
  test.skip(process.platform !== 'darwin', 'Native macOS fullscreen regression')
  test.setTimeout(60_000)
  const userData = await mkdtemp(join(tmpdir(), 'my-way-e2e-fullscreen-user-'))
  const workspace = await mkdtemp(join(tmpdir(), 'my-way-e2e-fullscreen-workspace-'))
  const executablePath = process.env.MY_WAY_E2E_EXECUTABLE
  const app = await electron.launch(executablePath
    ? { executablePath, args: [`--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } }
    : { args: [join(process.cwd(), 'out/main/index.js'), `--user-data-dir=${userData}`], env: { ...process.env, MY_WAY_E2E: '1' } })
  try {
    const page = await app.firstWindow()
    await expect(page.getByRole('heading', { name: '选择你的学习文件夹' })).toBeVisible()
    const nativeState = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen())
    const enterFullScreen = () => app.evaluate(({ BrowserWindow }) => new Promise<void>(resolve => {
      const window = BrowserWindow.getAllWindows()[0]
      window.once('enter-full-screen', () => resolve())
      window.setFullScreen(true)
    }))
    const menu = await app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items
      .flatMap(item => item.submenu?.items ?? []).filter(item => item.role === 'togglefullscreen')
      .map(item => ({ label: item.label, accelerator: item.accelerator, enabled: item.enabled })))
    expect(menu).toEqual([{ label: '切换全屏', accelerator: 'Control+Command+F', enabled: true }])

    await enterFullScreen()
    const exit = page.getByRole('button', { name: '退出全屏', exact: true })
    await expect(exit).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('fullscreen-launch.png') })
    await exit.click()
    await expect.poll(nativeState).toBe(false)
    await expect(exit).toBeHidden()

    await mkdir(join(workspace, '00-dashboard', 'weeks'), { recursive: true })
    await mkdir(join(workspace, '05-admissions'))
    await writeFile(join(workspace, 'README.md'), '# My Way\n')
    for (const name of ['12-week-roadmap', 'long-term-roadmap', 'current-status']) {
      await writeFile(join(workspace, '00-dashboard', `${name}.md`), `# ${name}\n`)
    }
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [root] })
    }, workspace)
    await page.getByRole('button', { name: '选择 my-way 文件夹' }).click()
    await page.getByRole('button', { name: '＋ 添加一项任务' }).click()
    const composer = page.getByRole('dialog', { name: '新建任务' })
    const title = composer.getByRole('textbox', { name: '任务标题' })
    await title.fill('全屏切换保留草稿')
    await enterFullScreen()
    await expect(exit).toBeVisible()
    // The application modal backdrop must not intercept the window escape control.
    await exit.click({ timeout: 2000 })
    await expect.poll(nativeState).toBe(false)
    await expect(title).toHaveValue('全屏切换保留草稿')
    await expect(composer).toBeVisible()
    await enterFullScreen()
    // The shortcut must work even while a text input/modal owns keyboard focus.
    // CDP keyboard.press targets Chromium, not AppKit's native menu accelerators.
    await title.focus()
    const pid = app.process().pid
    expect(Number.isInteger(pid)).toBe(true)
    await promisify(execFile)('osascript', ['-e', `tell application "System Events" to tell (first application process whose unix id is ${pid})`,
      '-e', 'set frontmost to true', '-e', 'keystroke "f" using {control down, command down}', '-e', 'end tell'], { timeout: 10_000 })
    await expect.poll(nativeState).toBe(false)
    await expect(title).toHaveValue('全屏切换保留草稿')
    await expect(composer).toBeVisible()
    await composer.getByRole('button', { name: '取消' }).click()

    // Route changes and dark mode do not remove the native escape affordance.
    await enterFullScreen()
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
    for (const name of ['计时器', '日历', '今天']) {
      await page.getByRole('button', { name, exact: true }).click()
      await expect(exit).toBeVisible()
    }
    await page.screenshot({ path: testInfo.outputPath('fullscreen-workspace-dark.png'), animations: 'disabled' })
    await exit.click()
    await expect.poll(nativeState).toBe(false)
    await expect(exit).toBeHidden()
  } finally {
    // An unconfirmed composer deliberately vetoes normal App shutdown.
    const composer = app.windows()[0]?.getByRole('dialog', { name: '新建任务' })
    if (await composer?.isVisible().catch(() => false)) await composer?.getByRole('button', { name: '取消' }).click({ timeout: 1000 }).catch(() => undefined)
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.setFullScreen(false) }).catch(() => undefined)
    await app.close()
    await rm(userData, { recursive: true, force: true })
    await rm(workspace, { recursive: true, force: true })
  }
})
