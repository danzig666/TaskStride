import type { GoogleTask, GoogleTaskList, ListTasksOptions, MoveTaskInput, Page, TaskPatch, TaskRepository } from '../types/googleTasks'

const API_ROOT = 'https://tasks.googleapis.com/tasks/v1'

export class GoogleApiError extends Error {
  constructor(public status: number, message: string, public details?: unknown) { super(message) }
  get reconnectRequired() { return this.status === 401 }
  get rateLimited() { return this.status === 429 }
}

export class GoogleTasksRepository implements TaskRepository {
  constructor(private readonly getToken: () => string | null, private readonly onExpired?: () => void) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = this.getToken()
    if (!token) throw new GoogleApiError(401, 'Reconnect Google to continue.')
    let response: Response
    try {
      response = await fetch(`${API_ROOT}${path}`, {
        ...init,
        signal: init?.signal ?? AbortSignal.timeout(30_000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init?.headers },
      })
    } catch (error) {
      if (error instanceof DOMException && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new GoogleApiError(0, 'Google Tasks did not respond. Try refreshing again.')
      }
      throw error
    }
    if (response.status === 401) this.onExpired?.()
    if (!response.ok) {
      let details: unknown
      try { details = await response.json() } catch { details = await response.text() }
      const messages: Record<number, string> = { 401: 'Your Google connection expired.', 403: 'Google denied this action.', 404: 'This task no longer exists.', 409: 'This task changed elsewhere.', 429: 'Google Tasks is busy. Try again shortly.' }
      throw new GoogleApiError(response.status, messages[response.status] ?? (response.status >= 500 ? 'Google Tasks is temporarily unavailable.' : 'The task could not be updated.'), details)
    }
    if (response.status === 204 || response.headers.get('content-length') === '0') return undefined as T
    return response.json() as Promise<T>
  }

  async listTaskLists(): Promise<GoogleTaskList[]> {
    const all: GoogleTaskList[] = []
    let pageToken: string | undefined
    do {
      const query = new URLSearchParams({ maxResults: '100' }); if (pageToken) query.set('pageToken', pageToken)
      const page = await this.request<Page<GoogleTaskList>>(`/users/@me/lists?${query}`)
      all.push(...(page.items ?? [])); pageToken = page.nextPageToken
    } while (pageToken)
    return all
  }
  createTaskList(title: string) { return this.request<GoogleTaskList>('/users/@me/lists', { method: 'POST', body: JSON.stringify({ title }) }) }
  renameTaskList(id: string, title: string) { return this.request<GoogleTaskList>(`/users/@me/lists/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) }) }
  deleteTaskList(id: string) { return this.request<void>(`/users/@me/lists/${encodeURIComponent(id)}`, { method: 'DELETE' }) }
  listTasks(taskListId: string, options: ListTasksOptions = {}) {
    const query = new URLSearchParams()
    for (const [key, value] of Object.entries(options)) if (value !== undefined) query.set(key, String(value))
    if (!query.has('maxResults')) query.set('maxResults', '100')
    return this.request<Page<GoogleTask>>(`/lists/${encodeURIComponent(taskListId)}/tasks?${query}`)
  }
  getTask(taskListId: string, taskId: string) { return this.request<GoogleTask>(`/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`) }
  createTask(taskListId: string, task: Pick<GoogleTask, 'title'> & Partial<Pick<GoogleTask, 'notes' | 'due'>>, parent?: string, previous?: string) {
    const query = new URLSearchParams(); if (parent) query.set('parent', parent); if (previous) query.set('previous', previous)
    return this.request<GoogleTask>(`/lists/${encodeURIComponent(taskListId)}/tasks?${query}`, { method: 'POST', body: JSON.stringify(task) })
  }
  patchTask(taskListId: string, taskId: string, patch: TaskPatch) {
    const safe = Object.fromEntries(Object.entries(patch).filter(([key]) => ['title', 'notes', 'status', 'due', 'completed'].includes(key)))
    return this.request<GoogleTask>(`/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'PATCH', body: JSON.stringify(safe) })
  }
  deleteTask(taskListId: string, taskId: string) { return this.request<void>(`/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}`, { method: 'DELETE' }) }
  moveTask({ taskListId, taskId, parent, previous, destinationTasklist }: MoveTaskInput) {
    const query = new URLSearchParams(); if (parent) query.set('parent', parent); if (previous) query.set('previous', previous); if (destinationTasklist) query.set('destinationTasklist', destinationTasklist)
    return this.request<GoogleTask>(`/lists/${encodeURIComponent(taskListId)}/tasks/${encodeURIComponent(taskId)}/move?${query}`, { method: 'POST' })
  }
  clearCompleted(taskListId: string) { return this.request<void>(`/lists/${encodeURIComponent(taskListId)}/clear`, { method: 'POST' }) }
}
