import { useState, type ReactNode } from 'react'

type SaveStatus = 'saved' | 'saving' | 'dirty' | 'conflict'
const saveLabels: Record<SaveStatus, string> = { saved: '本地保存', saving: '正在保存', dirty: '待保存修改', conflict: '文件冲突' }

export function WorkspaceFrame({ sidebar, rail, saveStatus, children }: {
  sidebar: ReactNode; rail: ReactNode; saveStatus: SaveStatus; children: ReactNode
}) {
  const [railOpen, setRailOpen] = useState(() => {
    try {
      const saved = window.localStorage.getItem('my-way.rail-open')
      if (saved === 'true' || saved === 'false') return saved === 'true'
    } catch { /* A layout preference must not prevent the workspace from opening. */ }
    return window.innerWidth >= 1280
  })
  return <div className="app-shell" data-rail-open={railOpen}>
    {sidebar}
    <div className="workspace-stage">
      <div className="workspace-utility">
        <span className={`save-state save-${saveStatus}`} role="status"><span className="save-dot" aria-hidden="true" />{saveLabels[saveStatus]}</span>
        <button type="button" aria-controls="weekly-context" aria-expanded={railOpen}
          aria-label={railOpen ? '收起本周摘要' : '展开本周摘要'} title={railOpen ? '收起本周摘要' : '展开本周摘要'}
          onClick={() => {
            const next = !railOpen
            setRailOpen(next)
            try { window.localStorage.setItem('my-way.rail-open', String(next)) } catch { /* Keep the in-memory preference. */ }
          }}>
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="2.5" y="3" width="15" height="14" rx="3" stroke="currentColor" strokeWidth="1.4" /><path d="M12 3v14" stroke="currentColor" strokeWidth="1.4" /></svg>
        </button>
      </div>
      {children}
    </div>
    <div id="weekly-context" hidden={!railOpen}>{rail}</div>
  </div>
}
