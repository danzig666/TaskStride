import { addDays, subDays } from 'date-fns'
import { dateKeyToGoogleDue, localDateKey } from '../lib/dates'
import type { GoogleTask, GoogleTaskList, ListTasksOptions, MoveTaskInput, Page, TaskPatch, TaskRepository } from '../types/googleTasks'

const now = () => new Date().toISOString()
const pos = (n: number) => String(n).padStart(12, '0')
const due = (days: number) => dateKeyToGoogleDue(localDateKey(days < 0 ? subDays(new Date(), Math.abs(days)) : addDays(new Date(), days)))

const seedLists: GoogleTaskList[] = [
  { id: 'work', title: 'Work' }, { id: 'personal', title: 'Personal' }, { id: 'house', title: 'House' }, { id: 'someday', title: 'Someday' },
]
const seedTasks: Record<string, GoogleTask[]> = {
  work: [
    { id: 'w1', title: 'Review Q4 product brief', notes: 'Focus on the new onboarding flow and open questions.', due: due(0), status: 'needsAction', position: pos(1), updated: now() },
    { id: 'w1a', title: 'Check onboarding metrics', parent: 'w1', status: 'completed', completed: now(), position: pos(1), updated: now() },
    { id: 'w1b', title: 'Collect launch questions', parent: 'w1', status: 'needsAction', position: pos(2), updated: now() },
    { id: 'w2', title: 'Send updated launch timeline', notes: 'Share the revised milestones with the product team.', due: due(3), status: 'needsAction', position: pos(2), updated: now() },
    { id: 'w3', title: 'Approve accessibility audit', due: due(-2), status: 'needsAction', position: pos(3), updated: now(), assignmentInfo: { surfaceType: 'DOCUMENT', linkToTask: 'https://docs.google.com/' }, webViewLink: 'https://tasks.google.com/' },
    { id: 'w4', title: 'Archive summer project notes', status: 'completed', completed: now(), position: pos(4), updated: now() },
  ],
  personal: [
    { id: 'p1', title: 'Book dentist appointment', due: due(0), status: 'needsAction', position: pos(1), updated: now() },
    { id: 'p2', title: 'Research weekend train routes', notes: 'Compare direct trains and flexible return fares.', status: 'needsAction', position: pos(2), updated: now() },
    { id: 'p3', title: 'Renew library card', due: due(8), status: 'needsAction', position: pos(3), updated: now() },
  ],
  house: [
    { id: 'h1', title: 'Order replacement filters', due: due(5), status: 'needsAction', position: pos(1), updated: now() },
    { id: 'h2', title: 'Measure hallway shelf', status: 'needsAction', position: pos(2), updated: now() },
  ],
  someday: [{ id: 's1', title: 'Learn basic bookbinding', notes: 'Start with a simple pamphlet stitch.', status: 'needsAction', position: pos(1), updated: now() }],
}

const clone = <T,>(value: T): T => structuredClone(value)
const delay = () => new Promise((resolve) => setTimeout(resolve, 90))

export class MockTasksRepository implements TaskRepository {
  private lists = clone(seedLists)
  private tasks = clone(seedTasks)
  async listTaskLists() { await delay(); return clone(this.lists) }
  async createTaskList(title: string) { const list = { id: crypto.randomUUID(), title, updated: now() }; this.lists.push(list); this.tasks[list.id] = []; return clone(list) }
  async renameTaskList(id: string, title: string) { const list = this.lists.find((item) => item.id === id); if (!list) throw new Error('List not found'); list.title = title; list.updated = now(); return clone(list) }
  async deleteTaskList(id: string) { this.lists = this.lists.filter((item) => item.id !== id); delete this.tasks[id] }
  async listTasks(taskListId: string, options: ListTasksOptions = {}): Promise<Page<GoogleTask>> { await delay(); const items = (this.tasks[taskListId] ?? []).filter((task) => options.showCompleted !== false || task.status !== 'completed'); return { items: clone(items) } }
  async getTask(taskListId: string, taskId: string) { const task = this.tasks[taskListId]?.find((item) => item.id === taskId); if (!task) throw new Error('Task not found'); return clone(task) }
  async createTask(taskListId: string, input: Pick<GoogleTask, 'title'> & Partial<Pick<GoogleTask, 'notes' | 'due'>>, parent?: string, previous?: string) { const tasks = this.tasks[taskListId] ?? (this.tasks[taskListId] = []); const index = previous ? tasks.findIndex((task) => task.id === previous) + 1 : tasks.length; const task: GoogleTask = { id: crypto.randomUUID(), title: input.title, notes: input.notes, due: input.due, parent, status: 'needsAction', position: pos(index + 1), updated: now() }; tasks.splice(index, 0, task); return clone(task) }
  async patchTask(taskListId: string, taskId: string, patch: TaskPatch) { const task = this.tasks[taskListId]?.find((item) => item.id === taskId); if (!task) throw new Error('Task not found'); Object.assign(task, patch, { updated: now() }); if (patch.status === 'completed' && !patch.completed) task.completed = now(); if (patch.status === 'needsAction') delete task.completed; if (patch.due === null) delete task.due; return clone(task) }
  async deleteTask(taskListId: string, taskId: string) { this.tasks[taskListId] = (this.tasks[taskListId] ?? []).filter((task) => task.id !== taskId && task.parent !== taskId) }
  async moveTask(input: MoveTaskInput) { const source = this.tasks[input.taskListId] ?? []; const index = source.findIndex((task) => task.id === input.taskId); if (index < 0) throw new Error('Task not found'); const [task] = source.splice(index, 1); task.parent = input.parent; const target = this.tasks[input.destinationTasklist ?? input.taskListId] ?? []; const targetIndex = input.previous ? target.findIndex((item) => item.id === input.previous) + 1 : 0; target.splice(targetIndex, 0, task); target.forEach((item, order) => item.position = pos(order + 1)); return clone(task) }
  async clearCompleted(taskListId: string) { this.tasks[taskListId] = (this.tasks[taskListId] ?? []).filter((task) => task.status !== 'completed') }
}
