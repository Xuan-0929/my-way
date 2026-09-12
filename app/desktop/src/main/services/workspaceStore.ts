import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export class WorkspaceStore {
  private readonly path: string

  constructor(userDataDirectory: string) {
    this.path = join(userDataDirectory, 'workspace.json')
  }

  async get(): Promise<string | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as { root?: unknown }
      return typeof parsed.root === 'string' ? parsed.root : null
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
      throw new Error('无法读取已保存的工作区设置', { cause: error })
    }
  }

  async set(root: string): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temporaryPath = `${this.path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporaryPath, `${JSON.stringify({ root }, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
      await rename(temporaryPath, this.path)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }
}
