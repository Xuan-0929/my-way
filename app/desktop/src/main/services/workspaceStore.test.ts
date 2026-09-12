import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { WorkspaceStore } from './workspaceStore'

describe('WorkspaceStore', () => {
  let root = ''
  afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }) })

  it('persists the selected workspace outside the repository', async () => {
    root = await mkdtemp(join(tmpdir(), 'my-way-userdata-'))
    const store = new WorkspaceStore(root)
    await expect(store.get()).resolves.toBeNull()
    await store.set('/Users/example/my-way')
    await expect(new WorkspaceStore(root).get()).resolves.toBe('/Users/example/my-way')
  })
})
