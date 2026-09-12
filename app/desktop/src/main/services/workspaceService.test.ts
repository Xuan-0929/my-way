import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { resolveSafePath, validateWorkspace } from './workspaceService'

describe('workspace safety', () => {
  let root = ''
  let outside = ''

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'my-way-workspace-'))
    outside = await mkdtemp(join(tmpdir(), 'my-way-outside-'))
    await writeFile(join(root, 'README.md'), '# My Way\n')
    await mkdir(join(root, '00-dashboard'), { recursive: true })
    await mkdir(join(root, '05-admissions'), { recursive: true })
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('validates the required workspace markers and returns its real path', async () => {
    await expect(validateWorkspace(root)).resolves.toMatchObject({ root: await realpath(root), valid: true })
    await rm(join(root, 'README.md'))
    await expect(validateWorkspace(root)).rejects.toThrow('README.md')
  })

  it('rejects marker symlinks that make a workspace depend on outside content', async () => {
    await rm(join(root, '00-dashboard'), { recursive: true })
    await mkdir(join(outside, 'dashboard'))
    await symlink(join(outside, 'dashboard'), join(root, '00-dashboard'))

    await expect(validateWorkspace(root)).rejects.toThrow(/00-dashboard.*工作区外部/)
  })

  it('requires marker files and directories to have the expected kind', async () => {
    await rm(join(root, 'README.md'))
    await mkdir(join(root, 'README.md'))
    await expect(validateWorkspace(root)).rejects.toThrow(/README\.md.*文件/)
  })

  it('rejects absolute paths and traversal', async () => {
    await expect(resolveSafePath(root, '../secret.md', false)).rejects.toThrow('越界')
    await expect(resolveSafePath(root, '/tmp/secret.md', false)).rejects.toThrow('相对路径')
  })

  it('rejects a symlink that resolves outside the workspace', async () => {
    await writeFile(join(outside, 'secret.md'), 'secret')
    await symlink(outside, join(root, 'evidence'))
    await expect(resolveSafePath(root, 'evidence/secret.md', true)).rejects.toThrow('符号链接')
  })

  it('resolves an existing evidence file inside the workspace', async () => {
    await mkdir(join(root, 'evidence'))
    await writeFile(join(root, 'evidence', 'proof.md'), 'proof')
    await expect(resolveSafePath(root, 'evidence/proof.md', true)).resolves.toBe(await realpath(join(root, 'evidence', 'proof.md')))
  })
})
