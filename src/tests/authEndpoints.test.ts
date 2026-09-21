// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest'
import { onRequestPost as token } from '../../functions/api/token'
import { onRequestPost as exchange } from '../../functions/api/auth/exchange'
import { onRequestPost as logout } from '../../functions/api/auth/logout'
import { seal, unseal, type Env } from '../../functions/api/_session'

const env: Env = { GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret', SESSION_SECRET: 'session-secret' }
const googleResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const request = (options: { cookie?: string; body?: unknown; guard?: boolean } = {}) => {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (options.guard !== false) headers.set('x-taskstride-auth', '1')
  if (options.cookie) headers.set('cookie', `taskstride_session=${options.cookie}`)
  return new Request('https://tasks.example.com/api/token', { method: 'POST', headers, body: options.body === undefined ? undefined : JSON.stringify(options.body) })
}
const formBody = (call: unknown[]) => Object.fromEntries(new URLSearchParams(String((call[1] as RequestInit).body)))

afterEach(() => vi.unstubAllGlobals())

describe('POST /api/token', () => {
  it('refuses a request a third-party page could forge', async () => {
    const response = await token({ request: request({ guard: false }), env })
    expect(response.status).toBe(403)
  })

  it('reports an unconfigured deployment so the client can fall back', async () => {
    const response = await token({ request: request(), env: {} })
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'not_configured' })
  })

  it('answers without a session when no cookie is present', async () => {
    const response = await token({ request: request(), env })
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'no_session' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('clears a cookie it cannot unseal', async () => {
    const response = await token({ request: request({ cookie: 'tampered-value' }), env })
    expect(response.status).toBe(401)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('exchanges the sealed refresh token for a fresh access token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(googleResponse({ access_token: 'fresh-access-token', expires_in: 3599 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await token({ request: request({ cookie: await seal('1//refresh', 'session-secret') }), env })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ access_token: 'fresh-access-token', expires_in: 3599 })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(formBody(fetchMock.mock.calls[0])).toEqual({ refresh_token: '1//refresh', client_id: 'client-id', client_secret: 'client-secret', grant_type: 'refresh_token' })
  })

  it('drops the session when Google rejects the refresh token', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(googleResponse({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400)))

    const response = await token({ request: request({ cookie: await seal('1//refresh', 'session-secret') }), env })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'invalid_grant' })
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })

  it('keeps the session when Google is merely unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(googleResponse({ error: 'backend_error' }, 503)))

    const response = await token({ request: request({ cookie: await seal('1//refresh', 'session-secret') }), env })

    expect(response.status).toBe(502)
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('POST /api/auth/exchange', () => {
  it('rejects a body without an auth code', async () => {
    expect((await exchange({ request: request({ body: {} }), env })).status).toBe(400)
  })

  it('seals the refresh token into an HttpOnly cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(googleResponse({ access_token: 'first-access-token', refresh_token: '1//granted', expires_in: 3599 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await exchange({ request: request({ body: { code: 'auth-code', origin: 'https://tasks.example.com' } }), env })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ access_token: 'first-access-token', expires_in: 3599 })
    const cookie = response.headers.get('set-cookie') ?? ''
    expect(cookie).toContain('HttpOnly')
    expect(cookie).not.toContain('1//granted')
    const sealed = /taskstride_session=([^;]+)/.exec(cookie)?.[1] ?? ''
    expect(await unseal(sealed, 'session-secret')).toBe('1//granted')
    expect(formBody(fetchMock.mock.calls[0])).toMatchObject({ code: 'auth-code', grant_type: 'authorization_code', redirect_uri: 'postmessage' })
  })

  it('retries the exchange with the page origin when postmessage is refused', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(googleResponse({ error: 'redirect_uri_mismatch' }, 400))
      .mockResolvedValueOnce(googleResponse({ access_token: 'access', refresh_token: '1//granted', expires_in: 3599 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await exchange({ request: request({ body: { code: 'auth-code', origin: 'https://tasks.example.com' } }), env })

    expect(response.status).toBe(200)
    expect(formBody(fetchMock.mock.calls[1]).redirect_uri).toBe('https://tasks.example.com')
  })

  it('explains that Google granted no long-lived session', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(googleResponse({ access_token: 'access', expires_in: 3599 })))

    const response = await exchange({ request: request({ body: { code: 'auth-code' } }), env })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'no_refresh_token' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})

describe('POST /api/auth/logout', () => {
  it('revokes the stored token and clears the cookie', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const response = await logout({ request: request({ cookie: await seal('1//refresh', 'session-secret') }), env })

    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
    expect(formBody(fetchMock.mock.calls[0])).toEqual({ token: '1//refresh' })
  })

  it('still clears the cookie when there is nothing to revoke', async () => {
    const response = await logout({ request: request(), env })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
  })
})
