const dateParts = (value: string): { year: number; month: number; day: number } => {
  const [year, month, day] = value.split('-').map(Number)
  return { year, month, day }
}

export const formatChineseDateRange = (startDate: string, endDate: string): string => {
  const start = dateParts(startDate)
  const end = dateParts(endDate)
  if (start.year !== end.year) {
    return `${start.year} 年 ${start.month} 月 ${start.day} 日 — ${end.year} 年 ${end.month} 月 ${end.day} 日`
  }
  return `${start.month} 月 ${start.day} 日 — ${end.month} 月 ${end.day} 日`
}

export const formatChineseDuration = (minutes: number): string => {
  const wholeMinutes = Math.max(0, Math.trunc(minutes))
  const hours = Math.floor(wholeMinutes / 60)
  const remainder = wholeMinutes % 60
  if (!hours) return `${remainder} 分钟`
  if (!remainder) return `${hours} 小时`
  return `${hours} 小时 ${remainder} 分钟`
}

export const formatCompactDuration = (minutes: number): string =>
  formatChineseDuration(minutes).replaceAll(' ', '').replace('小时', '时').replace('分钟', '分')
