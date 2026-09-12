import { SelectionIndicator } from './SelectionIndicator'
import { useEffect, useRef, useState } from 'react'
import { markdown } from '@codemirror/lang-markdown'
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import { EditorView, keymap } from '@codemirror/view'
import ReactMarkdown from 'react-markdown'

const editorState = (doc: string, label: string, onChange: (value: string) => void) => EditorState.create({
  doc,
  extensions: [
    markdown(), history(), keymap.of([...defaultKeymap, ...historyKeymap]),
    EditorView.lineWrapping,
    EditorView.contentAttributes.of({ 'aria-label': label }),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) onChange(update.state.doc.toString())
    })
  ]
})

export function MarkdownEditor({ value, onChange, label = '学习笔记' }: { value: string; onChange: (value: string) => void; label?: string }) {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const initialValue = useRef(value)
  const [mode, setMode] = useState<'edit' | 'preview'>('edit')

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    if (!host.current) return
    view.current = new EditorView({
      parent: host.current,
      state: editorState(initialValue.current, label, (value) => onChangeRef.current(value))
    })
    return () => {
      view.current?.destroy()
      view.current = null
    }
  }, [label])

  useEffect(() => {
    const editor = view.current
    if (!editor || editor.state.doc.toString() === value) return
    // A different external value is a new file revision, not an undoable edit.
    // Normal controlled echoes match the doc above and preserve its history.
    editor.setState(editorState(value, label, (next) => onChangeRef.current(next)))
  }, [value, label])

  return <div className="markdown-composer">
    <div className="markdown-mode-switch motion-selection" role="group" aria-label={`${label}显示模式`}><SelectionIndicator value={mode} />
      <button type="button" className={mode === 'edit' ? 'active' : ''} aria-label={`${label}编辑`} aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>编辑</button>
      <button type="button" className={mode === 'preview' ? 'active' : ''} aria-label={`${label}预览`} aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>预览</button>
    </div>
    <div className="markdown-editor" hidden={mode !== 'edit'} ref={host} />
    <article className="markdown-preview" aria-label={`${label}内容预览`} hidden={mode !== 'preview'}>
      {value.trim() ? <ReactMarkdown components={{ a: ({ children, node, ...props }) => { void node; return <a {...props} target="_blank" rel="noreferrer">{children}</a> } }}>{value}</ReactMarkdown> : <p className="markdown-preview-empty">暂无内容</p>}
    </article>
  </div>
}
