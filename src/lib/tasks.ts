import type { GoogleTask, GoogleTaskList, TaskWithList } from '../types/googleTasks'
import { isDueToday, isOverdue, isWithinHorizon } from './dates'

export type SmartView = 'today' | 'upcoming' | 'all' | 'no-date' | 'completed' | 'assigned'

export function sortByPosition<T extends Pick<GoogleTask, 'position'>>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => a.position.localeCompare(b.position))
}

export function sortByGoogleOrder(tasks: TaskWithList[], lists: GoogleTaskList[]): TaskWithList[] {
  const listOrder = new Map(lists.map((list, index) => [list.id, index]))
  return [...tasks].sort((a, b) => {
    const byList = (listOrder.get(a.taskListId) ?? Number.MAX_SAFE_INTEGER) - (listOrder.get(b.taskListId) ?? Number.MAX_SAFE_INTEGER)
    return byList || a.position.localeCompare(b.position)
  })
}

export function buildTaskTree(tasks: GoogleTask[]): Array<GoogleTask & { children: GoogleTask[] }> {
  const byId = new Map(tasks.map((task) => [task.id, { ...task, children: [] as GoogleTask[] }]))
  const roots: Array<GoogleTask & { children: GoogleTask[] }> = []
  for (const task of sortByPosition([...byId.values()])) {
    if (task.parent && byId.has(task.parent)) byId.get(task.parent)!.children.push(task)
    else roots.push(task)
  }
  for (const task of byId.values()) task.children = sortByPosition(task.children)
  return roots
}

export function inSmartView(task: GoogleTask, view: SmartView, horizon = 7, today = new Date()): boolean {
  if (task.deleted || task.hidden) return false
  if (view === 'completed') return task.status === 'completed'
  if (task.status === 'completed') return false
  if (view === 'today') return isDueToday(task.due, today) || isOverdue(task.due, today)
  if (view === 'upcoming') return isWithinHorizon(task.due, horizon, today)
  if (view === 'no-date') return !task.due
  if (view === 'assigned') return Boolean(task.assignmentInfo)
  return true
}

export function searchTasks(tasks: TaskWithList[], query: string): TaskWithList[] {
  const needle = query.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase()
  if (!needle) return tasks
  return tasks.filter((task) => `${task.title} ${task.notes ?? ''} ${task.taskListTitle}`.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase().includes(needle))
}

export function canNest(task: GoogleTask, parent?: GoogleTask): { allowed: boolean; reason?: string } {
  if (task.assignmentInfo || task.recurrence?.length) return { allowed: false, reason: 'Assigned and repeating tasks cannot be nested.' }
  if (parent?.assignmentInfo || parent?.recurrence?.length) return { allowed: false, reason: 'Assigned and repeating tasks cannot contain subtasks.' }
  if (task.status === 'completed' && task.hidden) return { allowed: false, reason: 'Hidden completed tasks cannot be nested.' }
  return { allowed: true }
}

export function canMoveAcrossLists(task: GoogleTask): { allowed: boolean; reason?: string } {
  if (task.recurrence?.length) return { allowed: false, reason: 'Repeating tasks cannot be moved between lists.' }
  return { allowed: true }
}

export function reconcileTasks(current: GoogleTask[], incoming: GoogleTask[]): GoogleTask[] {
  const merged = new Map(current.map((task) => [task.id, task]))
  for (const task of incoming) {
    if (task.deleted) merged.delete(task.id)
    else merged.set(task.id, task)
  }
  return sortByPosition([...merged.values()])
}
