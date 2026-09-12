import matter from 'gray-matter'
import yaml from 'js-yaml'
import type { ZodType } from 'zod'

export interface ParsedFrontmatter<T> {
  data: T
  body: string
}

export const parseFrontmatter = <T>(source: string, filePath: string, schema: ZodType<T>): ParsedFrontmatter<T> => {
  try {
    const parsed = matter(source)
    const result = schema.safeParse(parsed.data)
    if (!result.success) {
      const details = result.error.issues
        .map((issue) => `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`)
        .join('; ')
      throw new Error(details)
    }
    return { data: result.data, body: parsed.content.replace(/^\n/, '').trimEnd() }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(`${filePath}: ${message}`, { cause: error })
  }
}

export const serializeFrontmatter = (data: object, body: string): string => {
  const header = yaml.dump(data, {
    noRefs: true,
    lineWidth: -1,
    noCompatMode: true,
    sortKeys: false
  }).trimEnd()
  const content = body.trim()
  return `---\n${header}\n---\n${content ? `\n${content}\n` : '\n'}`
}
