import { describe, expect, it } from 'vitest'
import type { StudyTask } from './studyTask'
import { focusedTaskId, taskTimeTotals, timerTaskChoices } from './taskPresentation'

const task = (id: string, patch: Partial<StudyTask> = {}): StudyTask => ({
  id, date: '2026-09-02', originalDate: '2026-09-02', category: 'NLP', title: id,
  deliverable: '', planned: 60, actual: 15, state: 'planned', evidence: [], notes: '', outcomes: '', ...patch
})
describe('task presentation', () => {
  it('does not recommend a time-met task but permits continuing its bound timer', () => {
    const tasks = [task('met', { actual: 65 }), task('next', { actual: 10 })]
    expect(focusedTaskId(tasks, '2026-09-02', null)).toBe('next')
    expect(focusedTaskId(tasks, '2026-09-02', { date: '2026-09-02', taskId: 'met', taskTitle: 'met' })).toBe('met')
  })
  it('separates fitness from study time without changing task counts', () => {
    expect(taskTimeTotals([task('nlp'), task('gym', { category: '健身', planned: 45, actual: 30 })]))
      .toEqual({ studyPlanned: 60, studyActual: 15, fitnessPlanned: 45, fitnessActual: 30 })
  })
  it('only offers titled tasks from today', () => {
    const tasks = [task('nlp'), task('gym', { category: '健身' }), task('old', { date: '2026-09-01' }), task('blank', { title: ' ' })]
    expect(timerTaskChoices(tasks, '2026-09-02').map(t => t.id)).toEqual(['nlp', 'gym'])
  })
  it('focuses matching intent then progress then saved order without mutation', () => {
    const tasks = [task('a', { actual: 0 }), task('b', { state: 'in_progress' }), task('c', { state: 'done' })]
    expect(focusedTaskId(tasks, '2026-09-02', null)).toBe('b')
    expect(focusedTaskId(tasks, '2026-09-02', { date: '2026-09-02', taskId: 'a', taskTitle: 'a' })).toBe('a')
    expect(focusedTaskId(tasks, '2026-09-02', { date: '2026-09-01', taskId: 'a', taskTitle: 'a' })).toBe('b')
    expect(focusedTaskId([task('a')], '2026-09-02', null)).toBe('a')
    expect(tasks.map(t => t.id)).toEqual(['a', 'b', 'c'])
  })
  it('does not invent a focused task for an empty or completed day', () => {
    expect(focusedTaskId([], '2026-09-02', null)).toBeNull()
    expect(focusedTaskId([task('c', { state: 'done' })], '2026-09-02', null)).toBeNull()
  })
})
