import { describe, expect, it } from 'vitest'
import { dateKeyToGoogleDue, dueToDateKey, formatDue, isDueToday, isOverdue, localDateKey } from '../lib/dates'

describe('date-only handling', () => {
  it('preserves the calendar date regardless of the timestamp offset', () => {
    expect(dueToDateKey('2026-03-29T23:00:00-07:00')).toBe('2026-03-29')
    expect(dueToDateKey('2026-10-25T01:30:00+02:00')).toBe('2026-10-25')
  })
  it('serializes a date key without applying the local timezone', () => expect(dateKeyToGoogleDue('2026-09-20')).toBe('2026-09-20T00:00:00.000Z'))
  it('uses local calendar fields at UTC boundaries', () => {
    const local = new Date(2026, 0, 1, 0, 15)
    expect(localDateKey(local)).toBe('2026-01-01')
    expect(isDueToday('2026-01-01T00:00:00.000Z', local)).toBe(true)
    expect(isOverdue('2025-12-31T00:00:00.000Z', local)).toBe(true)
  })
  it('formats relative labels', () => expect(formatDue('2026-09-20T00:00:00.000Z', new Date(2026, 8, 20))).toBe('Today'))
  it('rejects date-time input as a date key', () => expect(() => dateKeyToGoogleDue('2026-09-20T12:00:00Z')).toThrow())
})
