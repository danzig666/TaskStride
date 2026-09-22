import Dexie, { type EntityTable } from 'dexie'
import type { GoogleTaskList, TaskWithList } from '../types/googleTasks'

interface CacheMeta { key: string; value: string }
export const syncCacheVersion = '2'
class TaskStrideDatabase extends Dexie {
  taskLists!: EntityTable<GoogleTaskList, 'id'>
  tasks!: EntityTable<TaskWithList, 'id'>
  meta!: EntityTable<CacheMeta, 'key'>
  constructor() { super('taskstride-cache'); this.version(1).stores({ taskLists: 'id, title, updated', tasks: 'id, taskListId, status, due, parent, updated', meta: 'key' }) }
}
export const cacheDb = new TaskStrideDatabase()
export async function cacheSnapshot(lists: GoogleTaskList[], tasks: TaskWithList[], lastSync = new Date().toISOString(), lastFullSync?: string) { await cacheDb.transaction('rw', cacheDb.taskLists, cacheDb.tasks, cacheDb.meta, async () => { await cacheDb.taskLists.clear(); await cacheDb.taskLists.bulkPut(lists); await cacheDb.tasks.clear(); await cacheDb.tasks.bulkPut(tasks); await cacheDb.meta.bulkPut([{ key: 'lastSync', value: lastSync }, { key: 'syncVersion', value: syncCacheVersion }, ...(lastFullSync ? [{ key: 'lastFullSync', value: lastFullSync }] : [])]) }) }
export async function readSnapshot() { return { lists: await cacheDb.taskLists.toArray(), tasks: await cacheDb.tasks.toArray(), lastSync: (await cacheDb.meta.get('lastSync'))?.value, lastFullSync: (await cacheDb.meta.get('lastFullSync'))?.value, syncVersion: (await cacheDb.meta.get('syncVersion'))?.value } }
export async function clearCache() { await cacheDb.delete(); await cacheDb.open() }
