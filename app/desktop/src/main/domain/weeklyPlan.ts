import { weeklyPlanSchema, type WeeklyPlan } from '../../shared/schemas'
import { parseFrontmatter, serializeFrontmatter } from './frontmatter'

export interface WeeklyPlanDocument {
  plan: WeeklyPlan
  body: string
}

export const parseWeeklyPlan = (source: string, filePath: string): WeeklyPlanDocument => {
  const parsed = parseFrontmatter(source, filePath, weeklyPlanSchema)
  return { plan: parsed.data, body: parsed.body }
}

export const serializeWeeklyPlan = (plan: WeeklyPlan, body: string): string => {
  const validated = weeklyPlanSchema.parse(plan)
  return serializeFrontmatter(validated, body)
}
