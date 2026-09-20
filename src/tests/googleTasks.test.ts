import { afterEach, describe, expect, it, vi } from 'vitest'
import { GoogleTasksRepository } from '../api/googleTasks'

describe('Google Tasks API requests', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('requests assigned tasks using only supported partial-response fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    const repository = new GoogleTasksRepository(() => 'token')
    await repository.listTasks('list id', { showAssigned: true, showHidden: true })

    const requestUrl = new URL(String(fetchMock.mock.calls[0][0]))
    expect(requestUrl.searchParams.get('showAssigned')).toBe('true')
    expect(requestUrl.searchParams.get('fields')).toContain('assignmentInfo')
    expect(requestUrl.searchParams.get('fields')).not.toContain('recurrence')
  })
})
