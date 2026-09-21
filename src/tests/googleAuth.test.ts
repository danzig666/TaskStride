import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_KEY = 'taskstride.google-auth'
const CLIENT_ID = 'client-id.apps.googleusercontent.com'
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const htmlResponse = () => new Response('<!doctype html><title>TaskStride</title>', { status: 200, headers: { 'content-type': 'text/html' } })
const storeSession = (token: string) => sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt: Date.now() + 600_000 }))

describe('GoogleAuthService session persistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.resetModules()
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('restores an unexpired access token after a page reload', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'stored-token', expiresAt: Date.now() + 60_000 }))

    const { googleAuth } = await import('../auth/googleAuth')

    expect(googleAuth.connected).toBe(true)
    expect(googleAuth.accessToken).toBe('stored-token')
  })

  it('removes expired and disconnected sessions', async () => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'expired-token', expiresAt: Date.now() - 1 }))
    const { googleAuth } = await import('../auth/googleAuth')

    expect(googleAuth.connected).toBe(false)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()

    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: 'new-token', expiresAt: Date.now() + 60_000 }))
    googleAuth.disconnect()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('restores a backend session without showing a Google popup', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ access_token: 'server-token', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchMock)

    const { googleAuth } = await import('../auth/googleAuth')
    expect(googleAuth.ready).toBe(false)
    expect(googleAuth.connected).toBe(false)
    const changes = vi.fn()
    googleAuth.addEventListener('change', changes)

    await googleAuth.restore()

    expect(googleAuth.backend).toBe('server')
    expect(googleAuth.ready).toBe(true)
    expect(googleAuth.connected).toBe(true)
    expect(await googleAuth.ensureAccessToken()).toBe('server-token')
    expect(changes).toHaveBeenCalledTimes(1)
    // The backend session is the durable half, so nothing is written to this tab.
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(String(url)).toBe('/api/token')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin' })
    expect(init.headers).toMatchObject({ 'x-taskstride-auth': '1' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('renews an expired access token through the backend', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'first-token', expires_in: 60 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'second-token', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchMock)

    const { googleAuth } = await import('../auth/googleAuth')
    await googleAuth.restore()

    expect(googleAuth.accessToken).toBeNull()
    expect(await googleAuth.ensureAccessToken()).toBe('second-token')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(googleAuth.connected).toBe(true)
  })

  it('falls back to the in-tab token flow when no backend is deployed', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse()))
    storeSession('stored-token')

    const { googleAuth } = await import('../auth/googleAuth')
    await googleAuth.restore()

    expect(googleAuth.backend).toBe('client')
    expect(googleAuth.connected).toBe(true)
    expect(await googleAuth.ensureAccessToken()).toBe('stored-token')
  })

  it('treats an unreachable backend as no backend', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { googleAuth } = await import('../auth/googleAuth')
    await googleAuth.restore()

    expect(googleAuth.backend).toBe('client')
    expect(googleAuth.ready).toBe(true)
  })

  it('drops a stale in-tab token when the backend rejects the session', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'no_session' }, 401)))
    storeSession('stale-token')

    const { googleAuth } = await import('../auth/googleAuth')
    await googleAuth.restore()

    expect(googleAuth.backend).toBe('server')
    expect(googleAuth.connected).toBe(false)
    expect(googleAuth.accessToken).toBeNull()
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })

  it('recovers from a rejected Google request by refreshing once', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'first-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ access_token: 'renewed-token', expires_in: 3600 }))
    vi.stubGlobal('fetch', fetchMock)

    const { googleAuth } = await import('../auth/googleAuth')
    await googleAuth.restore()

    await expect(googleAuth.recoverFromUnauthorized()).resolves.toBe(true)
    expect(googleAuth.accessToken).toBe('renewed-token')
    expect(googleAuth.connected).toBe(true)
  })

  it('reports a reconnect when the backend session is gone for good', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ access_token: 'first-token', expires_in: 3600 }))
      .mockResolvedValueOnce(jsonResponse({ error: 'invalid_grant' }, 401))
    vi.stubGlobal('fetch', fetchMock)

    const { googleAuth } = await import('../auth/googleAuth')
    await googleAuth.restore()
    const changes = vi.fn()
    googleAuth.addEventListener('change', changes)

    await expect(googleAuth.recoverFromUnauthorized()).resolves.toBe(false)
    expect(googleAuth.connected).toBe(false)
    expect(changes).toHaveBeenCalledTimes(1)
  })

  it('keeps the session when the backend cannot reach Google', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'upstream' }, 502)))

    const { googleAuth } = await import('../auth/googleAuth')
    await googleAuth.restore()

    expect(googleAuth.backend).toBe('server')
    expect(googleAuth.connected).toBe(true)
    expect(googleAuth.accessToken).toBeNull()
  })

  it('expires the in-tab session when there is no backend to refresh', async () => {
    storeSession('stored-token')
    const { googleAuth } = await import('../auth/googleAuth')

    await expect(googleAuth.recoverFromUnauthorized()).resolves.toBe(false)
    expect(googleAuth.connected).toBe(false)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
})
