import { lstat, realpath, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export interface WorkspaceValidation {
  root: string
  valid: true
}

const isContained = (root: string, candidate: string): boolean => {
  const pathFromRoot = relative(root, candidate)
  return pathFromRoot === '' || (!pathFromRoot.startsWith(`..${sep}`) && pathFromRoot !== '..' && !isAbsolute(pathFromRoot))
}

export const validateWorkspace = async (candidate: string): Promise<WorkspaceValidation> => {
  if (!candidate || !isAbsolute(candidate)) throw new Error('工作区必须是绝对路径')
  const root = await realpath(candidate)
  const markers = [
    { name: 'README.md', kind: 'file' as const },
    { name: '00-dashboard', kind: 'directory' as const },
    { name: '05-admissions', kind: 'directory' as const }
  ]
  for (const marker of markers) {
    let resolvedMarker: string
    try {
      resolvedMarker = await realpath(join(root, marker.name))
    } catch {
      throw new Error(`不是有效的 my-way 工作区：缺少 ${marker.name}`)
    }
    if (!isContained(root, resolvedMarker)) {
      throw new Error(`不是有效的 my-way 工作区：${marker.name} 指向工作区外部`)
    }
    const details = await stat(resolvedMarker)
    if (marker.kind === 'file' && !details.isFile()) {
      throw new Error(`不是有效的 my-way 工作区：${marker.name} 必须是文件`)
    }
    if (marker.kind === 'directory' && !details.isDirectory()) {
      throw new Error(`不是有效的 my-way 工作区：${marker.name} 必须是文件夹`)
    }
  }
  return { root, valid: true }
}

export const resolveSafePath = async (workspaceRoot: string, relativePath: string, mustExist: boolean): Promise<string> => {
  if (!relativePath || isAbsolute(relativePath)) throw new Error('路径必须是工作区内的相对路径')
  const segments = relativePath.split(/[\\/]/)
  if (segments.includes('..')) throw new Error('路径越界：不允许使用 ..')

  const root = await realpath(workspaceRoot)
  const candidate = resolve(root, relativePath)
  if (!isContained(root, candidate)) throw new Error('路径越界：目标不在工作区内')

  let existing = candidate
  while (true) {
    try {
      await lstat(existing)
      break
    } catch {
      const parent = resolve(existing, '..')
      if (parent === existing || !isContained(root, parent)) throw new Error('路径越界：找不到安全父目录')
      existing = parent
    }
  }

  const existingRealPath = await realpath(existing)
  if (!isContained(root, existingRealPath)) {
    throw new Error('符号链接越界：解析后的路径不在工作区内')
  }

  if (mustExist) {
    try {
      const candidateRealPath = await realpath(candidate)
      if (!isContained(root, candidateRealPath)) throw new Error('符号链接越界：解析后的路径不在工作区内')
      return candidateRealPath
    } catch (error) {
      if (error instanceof Error && error.message.includes('符号链接')) throw error
      throw new Error(`文件不存在：${relativePath}`)
    }
  }

  return candidate
}

export const toWorkspaceRelativePath = async (workspaceRoot: string, absolutePath: string): Promise<string> => {
  const root = await realpath(workspaceRoot)
  const resolved = await realpath(absolutePath)
  if (!isContained(root, resolved)) throw new Error('所选文件不在 my-way 工作区内')
  return relative(root, resolved).split(sep).join('/')
}
