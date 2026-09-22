import { describe, expect, it } from 'vitest'
import { dedupeTasks, FULL_SYNC_INTERVAL_MS, incrementalSince, needsFullSync, SYNC_OVERLAP_MS } from '../lib/sync'

const now = Date.parse('2026-09-22T12:00:00.000Z')

describe('sync planning', () => {
  it('downloads everything the first time and after a cache format change', () => {
    expect(needsFullSync({}, '2', { now })).toBe(true)
    expect(needsFullSync({ lastSync: '2026-09-22T11:00:00.000Z', lastFullSync: '2026-09-22T11:00:00.000Z', syncVersion: '1' }, '2', { now })).toBe(true)
  })

  it('downloads everything when no full sync has been recorded yet', () => {
    expect(needsFullSync({ lastSync: '2026-09-22T11:59:00.000Z', syncVersion: '2' }, '2', { now })).toBe(true)
  })

  it('stays incremental between periodic full syncs', () => {
    const recent = new Date(now - FULL_SYNC_INTERVAL_MS + 60_000).toISOString()
    expect(needsFullSync({ lastSync: recent, lastFullSync: recent, syncVersion: '2' }, '2', { now })).toBe(false)
  })

  it('downloads everything again once the periodic interval has passed', () => {
    const stale = new Date(now - FULL_SYNC_INTERVAL_MS - 60_000).toISOString()
    expect(needsFullSync({ lastSync: '2026-09-22T11:59:00.000Z', lastFullSync: stale, syncVersion: '2' }, '2', { now })).toBe(true)
  })

  it('downloads everything when asked to, however recent the cache is', () => {
    const recent = new Date(now - 1000).toISOString()
    expect(needsFullSync({ lastSync: recent, lastFullSync: recent, syncVersion: '2' }, '2', { now, force: true })).toBe(true)
  })

  it('rewinds the incremental window so a fast device clock cannot skip changes', () => {
    expect(incrementalSince('2026-09-22T12:00:00.000Z')).toBe(new Date(now - SYNC_OVERLAP_MS).toISOString())
    expect(incrementalSince(undefined)).toBeUndefined()
    expect(incrementalSince('not a date')).toBeUndefined()
  })

  it('keeps the freshest copy of a task that surfaced in two lists', () => {
    const tasks = [
      { id: 'a', updated: '2026-09-22T10:00:00.000Z', taskListId: 'old' },
      { id: 'b', updated: '2026-09-22T10:00:00.000Z', taskListId: 'old' },
      { id: 'a', updated: '2026-09-22T11:00:00.000Z', taskListId: 'new' },
    ]
    expect(dedupeTasks(tasks)).toEqual([
      { id: 'a', updated: '2026-09-22T11:00:00.000Z', taskListId: 'new' },
      { id: 'b', updated: '2026-09-22T10:00:00.000Z', taskListId: 'old' },
    ])
  })
})
