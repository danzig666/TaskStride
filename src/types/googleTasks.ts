export type TaskStatus = 'needsAction' | 'completed'

export interface GoogleTaskLink {
  type?: string
  description?: string
  link?: string
}

export interface AssignmentInfo {
  linkToTask?: string
  surfaceType?: 'DOCUMENT' | 'SPACE' | string
  driveResourceInfo?: { driveFileId?: string; resourceKey?: string }
  spaceInfo?: { space?: string }
}

export interface GoogleTask {
  kind?: 'tasks#task'
  id: string
  etag?: string
  title: string
  updated?: string
  selfLink?: string
  parent?: string
  position: string
  notes?: string
  status: TaskStatus
  due?: string
  completed?: string
  deleted?: boolean
  hidden?: boolean
  links?: GoogleTaskLink[]
  webViewLink?: string
  assignmentInfo?: AssignmentInfo
  recurrence?: string[]
}

export interface GoogleTaskList {
  kind?: 'tasks#taskList'
  id: string
  etag?: string
  title: string
  updated?: string
  selfLink?: string
}

export interface TaskWithList extends GoogleTask {
  taskListId: string
  taskListTitle: string
}

export interface TaskPatch {
  title?: string
  notes?: string
  status?: TaskStatus
  due?: string | null
  completed?: string | null
}

export interface MoveTaskInput {
  taskListId: string
  taskId: string
  parent?: string
  previous?: string
  destinationTasklist?: string
}

export interface ListTasksOptions {
  pageToken?: string
  updatedMin?: string
  showCompleted?: boolean
  showDeleted?: boolean
  showHidden?: boolean
  maxResults?: number
}

export interface Page<T> { items: T[]; nextPageToken?: string }

export interface TaskRepository {
  listTaskLists(): Promise<GoogleTaskList[]>
  createTaskList(title: string): Promise<GoogleTaskList>
  renameTaskList(id: string, title: string): Promise<GoogleTaskList>
  deleteTaskList(id: string): Promise<void>
  listTasks(taskListId: string, options?: ListTasksOptions): Promise<Page<GoogleTask>>
  getTask(taskListId: string, taskId: string): Promise<GoogleTask>
  createTask(taskListId: string, task: Pick<GoogleTask, 'title'> & Partial<Pick<GoogleTask, 'notes' | 'due'>>, parent?: string, previous?: string): Promise<GoogleTask>
  patchTask(taskListId: string, taskId: string, patch: TaskPatch): Promise<GoogleTask>
  deleteTask(taskListId: string, taskId: string): Promise<void>
  moveTask(input: MoveTaskInput): Promise<GoogleTask>
  clearCompleted(taskListId: string): Promise<void>
}
