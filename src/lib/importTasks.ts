import type { GoogleTaskList, TaskWithList } from '../types/googleTasks'
import { dueToDateKey } from './dates'

export interface ImportedList { id?: string; title: string }
export interface ImportedTask {
  id?: string
  title: string
  notes?: string
  due?: string
  status?: string
  completed?: string
  parent?: string
  position?: string
  deleted?: boolean
  hidden?: boolean
  taskListId?: string
  taskListTitle?: string
}
export interface ImportFile { lists: ImportedList[]; tasks: ImportedTask[] }

export interface ImportEntry {
  sourceId?: string
  parentSourceId?: string
  parentExistingId?: string
  title: string
  notes?: string
  due?: string
  completed: boolean
  completedAt?: string
  listTitle: string
  /** Set when the destination list already exists; otherwise the list is created first. */
  listId?: string
}
export interface ImportPlan {
  entries: ImportEntry[]
  newListTitles: string[]
  skipped: number
  total: number
}

export const fallbackImportListTitle = 'TaskStride import'

/** Accent- and case-insensitive comparison key, matching how search folds text. */
function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').trim().toLocaleLowerCase()
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/** Reads a TaskStride export, ignoring unknown fields and unusable records. */
export function parseImportFile(raw: unknown): ImportFile | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as { lists?: unknown; tasks?: unknown }
  if (!Array.isArray(source.tasks)) return null

  const lists: ImportedList[] = []
  if (Array.isArray(source.lists)) {
    for (const item of source.lists) {
      if (!item || typeof item !== 'object') continue
      const record = item as { id?: unknown; title?: unknown }
      const title = asString(record.title)
      if (!title) continue
      lists.push({ id: asString(record.id), title })
    }
  }

  const tasks: ImportedTask[] = []
  for (const item of source.tasks) {
    if (!item || typeof item !== 'object') continue
    const record = item as Record<string, unknown>
    const title = asString(record.title)
    if (!title) continue
    tasks.push({
      id: asString(record.id),
      title,
      notes: asString(record.notes),
      due: asString(record.due),
      status: asString(record.status),
      completed: asString(record.completed),
      parent: asString(record.parent),
      position: asString(record.position),
      deleted: record.deleted === true,
      hidden: record.hidden === true,
      taskListId: asString(record.taskListId),
      taskListTitle: asString(record.taskListTitle),
    })
  }
  return { lists, tasks }
}

/**
 * Works out which tasks of an export are genuinely missing. A task is skipped when its id
 * already exists, or when its destination list already holds a task with the same title and
 * due date. Parents are always emitted before their subtasks.
 */
export function planImport(file: ImportFile, existing: { lists: GoogleTaskList[]; tasks: TaskWithList[] }): ImportPlan {
  const importedListTitles = new Map<string, string>()
  for (const list of file.lists) if (list.id) importedListTitles.set(list.id, list.title)

  const existingListById = new Map(existing.lists.map((list) => [list.id, list]))
  const existingListByTitle = new Map(existing.lists.map((list) => [fold(list.title), list]))

  const existingById = new Map(existing.tasks.map((task) => [task.id, task]))
  const existingByContent = new Map<string, TaskWithList>()
  for (const task of existing.tasks) {
    if (task.deleted || task.hidden) continue
    const key = `${task.taskListId}\u0000${fold(task.title)}\u0000${dueToDateKey(task.due) ?? ''}`
    if (!existingByContent.has(key)) existingByContent.set(key, task)
  }

  // Stable order: grouped by list, then by Google position, so parents precede subtasks.
  const ordered = [...file.tasks].sort((a, b) => {
    const byList = (a.taskListId ?? a.taskListTitle ?? '').localeCompare(b.taskListId ?? b.taskListTitle ?? '')
    return byList || (a.position ?? '').localeCompare(b.position ?? '')
  })

  const defaultListTitle = existing.lists[0]?.title ?? fallbackImportListTitle
  const newListTitles: string[] = []
  const newListTitleKeys = new Set<string>()
  const plannedBySource = new Map<string, ImportEntry>()
  const existingBySource = new Map<string, TaskWithList>()
  const plannedKeys = new Set<string>()
  const plannedOrder: ImportEntry[] = []
  let skipped = 0

  for (const task of ordered) {
    if (task.deleted || task.hidden) { skipped += 1; continue }

    const sourceListTitle = (task.taskListId ? importedListTitles.get(task.taskListId) : undefined) ?? task.taskListTitle ?? defaultListTitle
    const targetList = (task.taskListId ? existingListById.get(task.taskListId) : undefined) ?? existingListByTitle.get(fold(sourceListTitle))
    const listTitle = targetList?.title ?? sourceListTitle
    const dueKey = dueToDateKey(task.due) ?? ''
    const contentKey = `${targetList?.id ?? `new\u0000${fold(listTitle)}`}\u0000${fold(task.title)}\u0000${dueKey}`

    const existingMatch = (task.id ? existingById.get(task.id) : undefined) ?? existingByContent.get(contentKey)
    if (existingMatch) {
      if (task.id) existingBySource.set(task.id, existingMatch)
      skipped += 1
      continue
    }
    if (plannedKeys.has(contentKey)) { skipped += 1; continue }

    const entry: ImportEntry = {
      sourceId: task.id,
      parentSourceId: task.parent,
      title: task.title,
      notes: task.notes,
      due: task.due,
      completed: task.status === 'completed',
      completedAt: task.completed,
      listTitle,
      listId: targetList?.id,
    }
    plannedKeys.add(contentKey)
    plannedOrder.push(entry)
    if (task.id) plannedBySource.set(task.id, entry)
    if (!targetList && !newListTitleKeys.has(fold(listTitle))) {
      newListTitleKeys.add(fold(listTitle))
      newListTitles.push(listTitle)
    }
  }

  // Resolve parents and keep subtasks in the same list as the parent Google Tasks requires.
  for (const entry of plannedOrder) {
    const parentSourceId = entry.parentSourceId
    entry.parentSourceId = undefined
    if (!parentSourceId) continue
    const plannedParent = plannedBySource.get(parentSourceId)
    if (plannedParent && plannedParent !== entry) {
      entry.parentSourceId = parentSourceId
      entry.listTitle = plannedParent.listTitle
      entry.listId = plannedParent.listId
      continue
    }
    const existingParent = existingBySource.get(parentSourceId)
    if (existingParent) {
      entry.parentExistingId = existingParent.id
      entry.listTitle = existingParent.taskListTitle
      entry.listId = existingParent.taskListId
    }
  }

  const emitted = new Set<ImportEntry>()
  const entries: ImportEntry[] = []
  const emit = (entry: ImportEntry, seen: Set<ImportEntry>) => {
    if (emitted.has(entry) || seen.has(entry)) return
    seen.add(entry)
    const parent = entry.parentSourceId ? plannedBySource.get(entry.parentSourceId) : undefined
    if (parent) emit(parent, seen)
    if (emitted.has(entry)) return
    emitted.add(entry)
    entries.push(entry)
  }
  for (const entry of plannedOrder) emit(entry, new Set())

  return { entries, newListTitles, skipped, total: file.tasks.length }
}
