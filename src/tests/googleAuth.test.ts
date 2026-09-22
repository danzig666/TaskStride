import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_KEY = 'taskstride.google-auth'
const CLIENT_ID = 'client-id.apps.googleusercontent.com'
const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const htmlResponse = () => new Response('<!doctype html><title>TaskStride</title>', { status: 200, headers: { 'content-type': 'text/html' } })
const storeSession = (token: string) => sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token, expiresAt: Date.now() + 600_000 }))

const edgeRedirect = () => new Response(null, { status: 302, headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/tasks.example.com' } })

describe('GoogleAuthService session persistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
    localStorage.clear()
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

  it('uses the in-tab flow when the network fails and no backend was ever seen', async () => {
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

  it('asks for the edge sign-in instead of falling back to the hourly flow', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    const fetchMock = vi.fn().mockResolvedValue(edgeRedirect())
    vi.stubGlobal('fetch', fetchMock)

    const { googleAuth, browser } = await import('../auth/googleAuth')
    const navigate = vi.spyOn(browser, 'navigate').mockImplementation(() => undefined)
    await googleAuth.restore()

    // The redirect proves a backend exists behind the gate, so the tab stays in server mode.
    expect(googleAuth.backend).toBe('server')
    expect(googleAuth.edgeSignInNeeded).toBe(true)
    expect(googleAuth.connected).toBe(false)
    expect((fetchMock.mock.calls[0] as [string, RequestInit])[1]).toMatchObject({ redirect: 'manual' })
    // On arrival the tab renews the edge session itself, through a route the worker leaves alone.
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate.mock.calls[0][0]).toMatch(/^\/api\/auth\/return\?to=%2F/)
  })

  it('does not bounce through the edge again right after a renewal', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(edgeRedirect()))
    sessionStorage.setItem('taskstride.edge-renewal-at', String(Date.now() - 10_000))

    const { googleAuth, browser } = await import('../auth/googleAuth')
    const navigate = vi.spyOn(browser, 'navigate').mockImplementation(() => undefined)
    await googleAuth.restore()

    expect(googleAuth.edgeSignInNeeded).toBe(true)
    expect(navigate).not.toHaveBeenCalled()
  })

  it('treats an HTML refusal from the gate as an edge sign-in', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('<html>Forbidden</html>', { status: 403, headers: { 'content-type': 'text/html' } })))

    const { googleAuth, browser } = await import('../auth/googleAuth')
    vi.spyOn(browser, 'navigate').mockImplementation(() => undefined)
    await googleAuth.restore()

    expect(googleAuth.edgeSignInNeeded).toBe(true)
  })

  it('clears the edge sign-in once the backend answers again', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(edgeRedirect())
      .mockResolvedValueOnce(jsonResponse({ access_token: 'after-renewal', expires_in: 3600 })))

    const { googleAuth, browser } = await import('../auth/googleAuth')
    vi.spyOn(browser, 'navigate').mockImplementation(() => undefined)
    await googleAuth.restore()
    expect(googleAuth.edgeSignInNeeded).toBe(true)

    await expect(googleAuth.recoverFromUnauthorized()).resolves.toBe(true)
    expect(googleAuth.edgeSignInNeeded).toBe(false)
    expect(googleAuth.connected).toBe(true)
  })

  it('sends a connect attempt through the edge sign-in rather than a Google popup', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(edgeRedirect()))
    sessionStorage.setItem('taskstride.edge-renewal-at', String(Date.now()))

    const { googleAuth, browser } = await import('../auth/googleAuth')
    const navigate = vi.spyOn(browser, 'navigate').mockImplementation(() => undefined)
    await googleAuth.restore()
    await googleAuth.connect()

    expect(navigate).toHaveBeenCalledTimes(1)
  })

  it('keeps a known backend when the network fails at start-up', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    localStorage.setItem('taskstride.auth-backend', 'server')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    const { googleAuth } = await import('../auth/googleAuth')
    await googleAuth.restore()

    expect(googleAuth.backend).toBe('server')
    expect(googleAuth.connected).toBe(true)
    // A request made now reports the outage rather than asking for a Google sign-in.
    await expect(googleAuth.ensureAccessToken()).rejects.toThrow('could not be reached')
  })

  it('remembers the backend once it has answered', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ error: 'no_session' }, 401)))

    const { googleAuth } = await import('../auth/googleAuth')
    await googleAuth.restore()

    expect(localStorage.getItem('taskstride.auth-backend')).toBe('server')
  })

  it('forgets the backend when the deployment turns out to be static', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', CLIENT_ID)
    localStorage.setItem('taskstride.auth-backend', 'server')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(htmlResponse()))

    const { googleAuth } = await import('../auth/googleAuth')
    await googleAuth.restore()

    expect(googleAuth.backend).toBe('client')
    expect(localStorage.getItem('taskstride.auth-backend')).toBeNull()
  })

  it('expires the in-tab session when there is no backend to refresh', async () => {
    storeSession('stored-token')
    const { googleAuth } = await import('../auth/googleAuth')

    await expect(googleAuth.recoverFromUnauthorized()).resolves.toBe(false)
    expect(googleAuth.connected).toBe(false)
    expect(sessionStorage.getItem(SESSION_KEY)).toBeNull()
  })
})
