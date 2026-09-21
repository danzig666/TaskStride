// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { clearedSessionCookie, readConfig, readCookie, seal, sessionCookie, unseal, SESSION_COOKIE } from '../../functions/api/_session'

const secret = 'a-long-enough-session-secret'

describe('authorization backend session sealing', () => {
  it('round-trips a refresh token through the sealed cookie value', async () => {
    const sealed = await seal('1//refresh-token-value', secret)
    expect(sealed).not.toContain('refresh-token-value')
    expect(sealed).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(await unseal(sealed, secret)).toBe('1//refresh-token-value')
  })

  it('produces a different ciphertext for the same token each time', async () => {
    expect(await seal('same', secret)).not.toBe(await seal('same', secret))
  })

  it('refuses a value sealed with another secret or tampered with', async () => {
    const sealed = await seal('refresh', secret)
    expect(await unseal(sealed, 'different-secret')).toBeNull()
    expect(await unseal(`${sealed.slice(0, -2)}xy`, secret)).toBeNull()
    expect(await unseal('not-base64!!', secret)).toBeNull()
    expect(await unseal('', secret)).toBeNull()
  })

  it('reads the session cookie out of a request header', () => {
    const request = new Request('https://tasks.example.com/api/token', { headers: { cookie: `other=1; ${SESSION_COOKIE}=sealed-value; last=2` } })
    expect(readCookie(request, SESSION_COOKIE)).toBe('sealed-value')
    expect(readCookie(request, 'missing')).toBeNull()
    expect(readCookie(new Request('https://tasks.example.com/api/token'), SESSION_COOKIE)).toBeNull()
  })

  it('keeps the session cookie inaccessible to scripts and cross-site requests', () => {
    const cookie = sessionCookie('sealed-value')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(clearedSessionCookie).toContain('Max-Age=0')
  })

  it('reports a half-configured deployment as unconfigured', () => {
    expect(readConfig({})).toBeNull()
    expect(readConfig({ GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'secret' })).toBeNull()
    expect(readConfig({ GOOGLE_CLIENT_ID: ' id ', GOOGLE_CLIENT_SECRET: 'secret', SESSION_SECRET: 'session' }))
      .toEqual({ clientId: 'id', clientSecret: 'secret', sessionSecret: 'session' })
  })
})
