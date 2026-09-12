import type { EvidenceInspection } from '../../shared/api'
import { resolveSafePath } from './workspaceService'

const safeFailure = (path: string, error: unknown): EvidenceInspection => {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith('文件不存在：')) return { path, status: 'missing', message: `文件不存在：${path}` }
  if (/路径|符号链接|工作区/.test(message)) return { path, status: 'blocked', message }
  return { path, status: 'blocked', message: '证据路径暂时不可用' }
}

export class EvidenceService {
  constructor(private readonly root: string) {}

  async inspect(paths: string[]): Promise<EvidenceInspection[]> {
    const unique = [...new Set(paths)]
    return Promise.all(unique.map(async (path): Promise<EvidenceInspection> => {
      try {
        await resolveSafePath(this.root, path, true)
        return { path, status: 'available' }
      } catch (error) {
        return safeFailure(path, error)
      }
    }))
  }
}
