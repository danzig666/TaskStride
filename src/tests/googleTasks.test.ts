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

  it('renews the session once and replays a request Google rejected', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 401 } }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ id: 'work', title: 'Work' }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const tokens = ['stale-token', 'fresh-token']
    let current = 0
    const onUnauthorized = vi.fn(async () => { current = 1; return true })
    const repository = new GoogleTasksRepository(() => tokens[current], onUnauthorized)

    await expect(repository.listTaskLists()).resolves.toEqual([{ id: 'work', title: 'Work' }])
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer stale-token')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh-token')
  })

  it('gives up after a single failed renewal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 401 } }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    const onUnauthorized = vi.fn(async () => false)
    const repository = new GoogleTasksRepository(() => 'stale-token', onUnauthorized)

    await expect(repository.listTaskLists()).rejects.toMatchObject({ status: 401, reconnectRequired: true })
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('asks for a session before the first request when no token is held', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    vi.stubGlobal('fetch', fetchMock)

    let token: string | null = null
    const onUnauthorized = vi.fn(async () => { token = 'fresh-token'; return true })
    const repository = new GoogleTasksRepository(() => token, onUnauthorized)

    await expect(repository.listTaskLists()).resolves.toEqual([])
    expect(onUnauthorized).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
