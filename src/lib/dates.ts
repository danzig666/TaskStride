import { addDays, format, isAfter, isBefore, isSameDay, parseISO, startOfDay, type Locale } from 'date-fns'

export function dueToDateKey(due?: string): string | undefined {
  if (!due) return undefined
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(due)
  return match?.[1]
}

export function dateKeyToGoogleDue(dateKey?: string | null): string | undefined {
  if (!dateKey) return undefined
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new Error('Invalid date-only value')
  return `${dateKey}T00:00:00.000Z`
}

export function localDateKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function isDueToday(due?: string, today = new Date()): boolean {
  return dueToDateKey(due) === localDateKey(today)
}

export function isOverdue(due?: string, today = new Date()): boolean {
  const key = dueToDateKey(due)
  return Boolean(key && key < localDateKey(today))
}

export function isWithinHorizon(due: string | undefined, days: number, today = new Date()): boolean {
  const key = dueToDateKey(due)
  if (!key) return false
  const parsed = parseISO(key)
  const start = startOfDay(today)
  return !isBefore(parsed, start) && !isAfter(parsed, addDays(start, days))
}

export function formatDue(due?: string, today = new Date(), locale?: Locale): string | undefined {
  const key = dueToDateKey(due)
  if (!key) return undefined
  const parsed = parseISO(key)
  if (isSameDay(parsed, today)) return 'Today'
  if (isSameDay(parsed, addDays(today, 1))) return 'Tomorrow'
  if (isSameDay(parsed, addDays(today, -1))) return 'Yesterday'
  return format(parsed, parsed.getFullYear() === today.getFullYear() ? 'EEE, MMM d' : 'MMM d, yyyy', locale ? { locale } : undefined)
}
