// Decisions about how much of Google Tasks to download on a sync. Kept free of I/O so they can be
// tested directly; fetchWorkspace in App.tsx does the actual requests.

/**
 * Incremental syncs ask Google for tasks updated since the previous sync started. That start time
 * comes from this device's clock while `updated` comes from Google's, so a device running a little
 * fast would skip changes made just before the next sync. Rewinding the window absorbs the drift;
 * re-downloading a few unchanged tasks is harmless because merging is keyed by id.
 */
export const SYNC_OVERLAP_MS = 10 * 60_000

/**
 * Incremental syncs can only see what Google reports as changed. A task moved to another list, or
 * one whose deletion tombstone Google has already purged, would linger in the cache forever, so a
 * full download replaces the cache periodically.
 */
export const FULL_SYNC_INTERVAL_MS = 6 * 60 * 60_000

export interface SyncMeta { lastSync?: string; lastFullSync?: string; syncVersion?: string }

export function needsFullSync(meta: SyncMeta, currentVersion: string, options: { now?: number; force?: boolean } = {}): boolean {
  if (options.force) return true
  if (!meta.lastSync || meta.syncVersion !== currentVersion) return true
  const lastFull = meta.lastFullSync ? Date.parse(meta.lastFullSync) : Number.NaN
  if (!Number.isFinite(lastFull)) return true
  return (options.now ?? Date.now()) - lastFull > FULL_SYNC_INTERVAL_MS
}

/** Lower bound for an incremental request, rewound by the overlap window. */
export function incrementalSince(lastSync: string | undefined): string | undefined {
  if (!lastSync) return undefined
  const time = Date.parse(lastSync)
  if (!Number.isFinite(time)) return undefined
  return new Date(time - SYNC_OVERLAP_MS).toISOString()
}

/**
 * The same task can surface in two lists when it moved between them since the last full sync.
 * Keeping both would show it twice and give React duplicate keys, so the fresher copy wins.
 */
export function dedupeTasks<T extends { id: string; updated?: string }>(tasks: T[]): T[] {
  const indexById = new Map<string, number>()
  const result: T[] = []
  for (const task of tasks) {
    const index = indexById.get(task.id)
    if (index === undefined) {
      indexById.set(task.id, result.length)
      result.push(task)
    } else if ((task.updated ?? '') > (result[index].updated ?? '')) {
      result[index] = task
    }
  }
  return result
}
