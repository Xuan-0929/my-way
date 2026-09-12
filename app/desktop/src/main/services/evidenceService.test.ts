import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { EvidenceService } from './evidenceService'

const roots: string[] = []

const workspace = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), 'my-way-evidence-'))
  roots.push(root)
  await mkdir(join(root, 'notes'), { recursive: true })
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('EvidenceService', () => {
  it('reports available and missing workspace-relative files without exposing absolute paths', async () => {
    const root = await workspace()
    await writeFile(join(root, 'notes', 'result.md'), '# result\n')

    await expect(new EvidenceService(root).inspect(['notes/result.md', 'notes/missing.md', 'notes/result.md'])).resolves.toEqual([
      { path: 'notes/result.md', status: 'available' },
      { path: 'notes/missing.md', status: 'missing', message: '文件不存在：notes/missing.md' }
    ])
  })

  it('marks traversal and symlink escapes as blocked', async () => {
    const root = await workspace()
    const outside = await mkdtemp(join(tmpdir(), 'my-way-evidence-outside-'))
    roots.push(outside)
    await writeFile(join(outside, 'secret.md'), 'secret')
    await symlink(outside, join(root, 'notes', 'outside'))

    const result = await new EvidenceService(root).inspect(['../secret.md', 'notes/outside/secret.md'])
    expect(result.map(({ path, status }) => ({ path, status }))).toEqual([
      { path: '../secret.md', status: 'blocked' },
      { path: 'notes/outside/secret.md', status: 'blocked' }
    ])
    expect(result.every(({ message }) => message && !message.includes(outside))).toBe(true)
  })
})
