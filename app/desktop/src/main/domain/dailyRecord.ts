import { dailyRecordSchema, type DailyRecordData } from '../../shared/schemas'
import type { ParsedDailyRecord } from '../../shared/types'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'

export const parseDailyRecord = (source: string, filePath: string): ParsedDailyRecord => {
  const parsed = parseFrontmatter(source, filePath, dailyRecordSchema)
  return { ...parsed.data, notes: parsed.body }
}

export const serializeDailyRecord = (record: ParsedDailyRecord): string => {
  const { notes, ...frontmatter } = record
  const validated: DailyRecordData = dailyRecordSchema.parse(frontmatter)
  return serializeFrontmatter(validated, notes)
}
