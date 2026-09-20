import { beforeEach, describe, expect, it, vi } from 'vitest'

const SESSION_KEY = 'taskstride.google-auth'

describe('GoogleAuthService session persistence', () => {
  beforeEach(() => {
    sessionStorage.clear()
    vi.resetModules()
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
})
