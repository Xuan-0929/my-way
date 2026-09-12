import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const appRoot = join(dirname(fileURLToPath(import.meta.url)), '..')

const rendererOnlyDependencies = [
  '@codemirror/lang-markdown',
  '@codemirror/state',
  '@codemirror/view',
  '@dnd-kit/core',
  'react',
  'react-dom',
  'react-markdown'
] as const

const mainRuntimeDependencies = [
  'chokidar',
  'date-fns',
  'gray-matter',
  'js-yaml',
  'zod'
] as const

type Manifest = {
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}

type Lockfile = {
  packages: Record<string, { dev?: boolean }>
}

const loadJson = async <T,>(path: string): Promise<T> => JSON.parse(await readFile(path, 'utf8')) as T

describe('packaged runtime dependency boundary', () => {
  it('keeps renderer bundles in devDependencies and main imports in dependencies', async () => {
    const manifest = await loadJson<Manifest>(join(appRoot, 'package.json'))

    for (const name of rendererOnlyDependencies) {
      expect(manifest.dependencies, `${name} should not be copied into app.asar`).not.toHaveProperty(name)
      expect(manifest.devDependencies, `${name} must remain available to Vite`).toHaveProperty(name)
    }
    for (const name of mainRuntimeDependencies) {
      expect(manifest.dependencies, `${name} is imported by the Electron main bundle`).toHaveProperty(name)
      expect(manifest.devDependencies).not.toHaveProperty(name)
    }
  })

  it('records the same production boundary in package-lock.json', async () => {
    const lockfile = await loadJson<Lockfile>(join(appRoot, 'package-lock.json'))

    for (const name of rendererOnlyDependencies) {
      expect(lockfile.packages[`node_modules/${name}`]?.dev, name).toBe(true)
    }
    for (const name of mainRuntimeDependencies) {
      expect(lockfile.packages[`node_modules/${name}`]?.dev, name).not.toBe(true)
    }
  })

  it('does not import renderer-only packages from main, preload, or shared source', async () => {
    const roots = ['src/main', 'src/preload', 'src/shared']
    const violations: string[] = []
    for (const root of roots) {
      const directory = join(appRoot, root)
      const entries = await readdir(directory, { recursive: true })
      for (const entry of entries) {
        if (!['.ts', '.tsx'].includes(extname(entry))) continue
        const path = join(directory, entry)
        const source = await readFile(path, 'utf8')
        for (const dependency of rendererOnlyDependencies) {
          const escaped = dependency.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          if (new RegExp(`(?:from\\s+|import\\s*\\()(['"])${escaped}(?:/|\\1)`).test(source)) {
            violations.push(`${root}/${entry}: ${dependency}`)
          }
        }
      }
    }

    expect(violations).toEqual([])
  })
})
