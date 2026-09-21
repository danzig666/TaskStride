import { googleAuth } from '../auth/googleAuth'
import type { TaskRepository } from '../types/googleTasks'
import { GoogleTasksRepository } from './googleTasks'
import { MockTasksRepository } from './mockTasks'

export const mockMode = import.meta.env.VITE_MOCK_MODE === 'true' || !import.meta.env.VITE_GOOGLE_CLIENT_ID
export const repository: TaskRepository = mockMode
  ? new MockTasksRepository()
  : new GoogleTasksRepository(() => googleAuth.ensureAccessToken(), () => googleAuth.recoverFromUnauthorized())
