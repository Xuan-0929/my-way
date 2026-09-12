const paths = {
  plus: 'M10 4v12M4 10h12',
  up: 'm5 9 5-5 5 5M10 4v12',
  down: 'm5 11 5 5 5-5M10 4v12',
  back: 'm9 5-5 5 5 5M4 10h12',
  copy: 'M7 6V4a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2M4 7h8a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z',
  attachment: 'm7 11 5-5a2 2 0 0 1 3 3l-6 6a3.5 3.5 0 0 1-5-5l6-6'
} as const

export function ActionIcon({ name }: { name: keyof typeof paths }) {
  return <svg className="action-icon" width="16" height="16" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d={paths[name]} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
