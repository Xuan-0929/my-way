import { describe, expect, it } from 'vitest'
import { parseDailyRecord, serializeDailyRecord } from './dailyRecord'
import { parseWeeklyPlan, serializeWeeklyPlan } from './weeklyPlan'

const weeklyMarkdown = `---
schemaVersion: 1
week: 1
startDate: '2026-08-17'
endDate: '2026-08-23'
tasks:
  - id: nlp-attention-01
    date: '2026-08-17'
    category: nlp
    title: 复现多头注意力
    plannedMinutes: 120
    deliverable: notebooks/attention.ipynb
---

# Week 01

本周完成注意力机制复现。
`

// Synthetic fixtures keep the App test suite independent of personal files.
const categoryFixture = `---
schemaVersion: 1
week: 1
startDate: '2026-08-17'
endDate: '2026-08-23'
tasks:
${['exam', 'nlp', 'english', 'japanese', 'fitness'].map((category, index) => `  - id: example-${category}
    date: '2026-08-17'
    category: ${category}
    title: Example ${category}
    plannedMinutes: ${(index + 1) * 15}
    deliverable: ''`).join('\n')}
---
# Example week
`

describe('weekly plan codec', () => {
  it('loads all supported categories from a synthetic weekly template', () => {
    const parsed = parseWeeklyPlan(categoryFixture, '/workspace/weekly-template.md')
    expect(parsed.plan.schemaVersion).toBe(1)
    expect(parsed.plan.tasks.map((task) => task.category)).toEqual(['exam', 'nlp', 'english', 'japanese', 'fitness'])
  })

  it('loads an empty natural-week plan without personal workspace files', () => {
    const { plan, body } = parseWeeklyPlan(`---
schemaVersion: 1
week: 1
startDate: '2026-08-31'
endDate: '2026-09-06'
tasks: []
---
# Empty week
`, '/workspace/empty-week.md')

    expect(plan).toMatchObject({ week: 1, startDate: '2026-08-31', endDate: '2026-09-06', tasks: [] })
    expect(body).toContain('# Empty week')
  })

  it('keeps category budgets and unique IDs when reading an archived plan', () => {
    const { plan } = parseWeeklyPlan(categoryFixture, '/workspace/archive/week-01.md')
    const categoryMinutes = Object.fromEntries(['exam', 'nlp', 'english', 'japanese'].map((category) => [
      category,
      plan.tasks.filter((task) => task.category === category).reduce((sum, task) => sum + task.plannedMinutes, 0)
    ]))

    expect(plan).toMatchObject({ week: 1, startDate: '2026-08-17', endDate: '2026-08-23' })
    expect(plan.tasks.reduce((sum, task) => sum + task.plannedMinutes, 0)).toBe(225)
    expect(categoryMinutes).toEqual({ exam: 15, nlp: 30, english: 45, japanese: 60 })
    expect(new Set(plan.tasks.map((task) => task.id)).size).toBe(plan.tasks.length)
  })

  it('parses YAML frontmatter and Markdown body', () => {
    const parsed = parseWeeklyPlan(weeklyMarkdown, '/workspace/00-dashboard/weeks/week-01.md')
    expect(parsed.plan.week).toBe(1)
    expect(parsed.plan.tasks[0].category).toBe('nlp')
    expect(parsed.body).toContain('# Week 01')
  })

  it('reports the source path for invalid YAML and schema errors', () => {
    expect(() => parseWeeklyPlan('---\nschemaVersion: 1\nweek: [\n---', '/tmp/broken.md')).toThrow('/tmp/broken.md')
    expect(() => parseWeeklyPlan(weeklyMarkdown.replace("date: '2026-08-17'", "date: '2026-08-24'"), '/tmp/range.md')).toThrow('/tmp/range.md')
  })

  it('round trips deterministically with one trailing newline', () => {
    const parsed = parseWeeklyPlan(weeklyMarkdown, 'week-01.md')
    const serialized = serializeWeeklyPlan(parsed.plan, parsed.body)
    expect(serialized.endsWith('\n')).toBe(true)
    expect(serialized.endsWith('\n\n')).toBe(false)
    expect(parseWeeklyPlan(serialized, 'week-01.md').plan).toEqual(parsed.plan)
  })
})

describe('daily record codec', () => {
  const dailyMarkdown = `---
schemaVersion: 1
date: '2026-08-17'
sourceWeek: 1
tasks:
  - id: nlp-attention-01
    date: '2026-08-17'
    originalDate: '2026-08-17'
    category: nlp
    title: 复现多头注意力
    plannedMinutes: 120
    deliverable: notebooks/attention.ipynb
    actualMinutes: 95
    status: in_progress
    evidence:
      - notebooks/attention.ipynb
    notes: |-
      比较 unigram 与 bigram
    outcomes: |-
      macro-F1 提升到 0.82
reflection:
  learned: 理解了缩放点积
  blockers: 多头维度
  tomorrow: 完成测试
updatedAt: '2026-08-17T08:00:00.000Z'
---

## 注意力机制

自由 Markdown 笔记必须保留。
`

  it('parses structured state without losing notes', () => {
    const record = parseDailyRecord(dailyMarkdown, '/workspace/data/daily/2026/2026-08-17.md')
    expect(record.tasks[0].actualMinutes).toBe(95)
    expect(record.tasks[0]).toMatchObject({ notes: '比较 unigram 与 bigram', outcomes: 'macro-F1 提升到 0.82' })
    expect(record.notes).toContain('自由 Markdown 笔记必须保留')
  })

  it('round trips all frontmatter and body fields', () => {
    const record = parseDailyRecord(dailyMarkdown, 'day.md')
    const serialized = serializeDailyRecord(record)
    expect(serialized.endsWith('\n')).toBe(true)
    expect(serialized.endsWith('\n\n')).toBe(false)
    expect(parseDailyRecord(serialized, 'day.md')).toEqual(record)
  })
})
