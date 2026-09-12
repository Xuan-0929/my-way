import type { DailyTask } from '../../shared/schemas'
import { effectiveTaskState } from '../../shared/taskProgress'

export type TaskState = DailyTask['status']
export type StudyCategory = '入试' | 'NLP' | '英语' | '日语' | '健身'

export interface StudyTask {
  id: string
  date: string
  originalDate: string
  sourceTaskId?: string
  category: StudyCategory
  title: string
  deliverable: string
  planned: number
  actual: number
  state: TaskState
  rescheduledMinutes?: number
  evidence: string[]
  notes: string
  outcomes: string
}

export const categoryLabels: Record<DailyTask['category'], StudyCategory> = {
  exam: '入试', nlp: 'NLP', english: '英语', japanese: '日语', fitness: '健身'
}

export const categoryKeys: Record<StudyCategory, DailyTask['category']> = {
  入试: 'exam', NLP: 'nlp', 英语: 'english', 日语: 'japanese', 健身: 'fitness'
}

export const categoryClass: Record<StudyCategory, string> = {
  入试: 'exam', NLP: 'nlp', 英语: 'english', 日语: 'japanese', 健身: 'fitness'
}

export const toStudyTasks = (tasks: DailyTask[]): StudyTask[] => tasks.map((task) => ({
  id: task.id,
  date: task.date,
  originalDate: task.originalDate,
  sourceTaskId: task.sourceTaskId,
  category: categoryLabels[task.category],
  title: task.title,
  deliverable: task.deliverable,
  planned: task.plannedMinutes,
  actual: task.actualMinutes,
  state: task.status,
  ...(task.rescheduledMinutes === undefined ? {} : { rescheduledMinutes: task.rescheduledMinutes }),
  evidence: [...task.evidence],
  notes: task.notes,
  outcomes: task.outcomes
}))

export const studyTaskProgress = (task: Pick<StudyTask, 'state' | 'planned' | 'actual'>) => effectiveTaskState({
  status: task.state, plannedMinutes: task.planned, actualMinutes: task.actual
})

export const previewTasks: StudyTask[] = [
  { id: 'preview-nlp', date: '2026-08-16', originalDate: '2026-08-16', category: 'NLP', title: '复现 Transformer 的多头注意力', deliverable: 'notebooks/attention.ipynb', planned: 120, actual: 95, state: 'in_progress', evidence: ['notebooks/attention.ipynb'], notes: '', outcomes: '' },
  { id: 'preview-exam', date: '2026-08-16', originalDate: '2026-08-16', category: '入试', title: '线性代数：特征值与对角化', deliverable: 'notes/math/eigenvalue.md', planned: 90, actual: 90, state: 'done', evidence: ['notes/math/eigenvalue.md'], notes: '', outcomes: '' },
  { id: 'preview-english', date: '2026-08-16', originalDate: '2026-08-16', category: '英语', title: '四级真题阅读 · 2025 年 12 月', deliverable: '记录错因并整理 12 个词组', planned: 60, actual: 0, state: 'planned', evidence: [], notes: '', outcomes: '' },
  { id: 'preview-japanese', date: '2026-08-16', originalDate: '2026-08-16', category: '日语', title: 'N3 文法：条件表达整理', deliverable: '完成 20 道辨析题', planned: 45, actual: 0, state: 'planned', evidence: [], notes: '', outcomes: '' }
]
