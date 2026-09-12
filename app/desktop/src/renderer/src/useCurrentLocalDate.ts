import { useEffect, useState } from 'react'
import { format } from 'date-fns'

const MIDNIGHT_SETTLE_MILLISECONDS = 25

export const millisecondsUntilNextLocalDate = (now: Date): number => {
  const next = new Date(now)
  next.setHours(24, 0, 0, MIDNIGHT_SETTLE_MILLISECONDS)
  return Math.max(1, next.valueOf() - now.valueOf())
}

export const useCurrentLocalDate = (): string => {
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    let disposed = false
    let handle: number | undefined
    const schedule = (): void => {
      if (handle !== undefined) window.clearTimeout(handle)
      handle = window.setTimeout(() => {
        if (disposed) return
        handle = undefined
        setDate(format(new Date(), 'yyyy-MM-dd'))
        schedule()
      }, millisecondsUntilNextLocalDate(new Date()))
    }
    const reconcile = (): void => {
      if (disposed) return
      setDate(format(new Date(), 'yyyy-MM-dd'))
      schedule()
    }
    const reconcileWhenVisible = (): void => {
      if (document.visibilityState !== 'hidden') reconcile()
    }
    schedule()
    window.addEventListener('focus', reconcile)
    document.addEventListener('visibilitychange', reconcileWhenVisible)
    return () => {
      disposed = true
      window.removeEventListener('focus', reconcile)
      document.removeEventListener('visibilitychange', reconcileWhenVisible)
      if (handle !== undefined) window.clearTimeout(handle)
    }
  }, [])

  return date
}
