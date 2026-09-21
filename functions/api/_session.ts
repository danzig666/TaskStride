// Shared helpers for the TaskStride authorization backend (Cloudflare Pages Functions).
// The browser never receives the Google refresh token: it is sealed with AES-GCM and
// stored in an HttpOnly cookie, and only short-lived access tokens cross the wire.

export const SESSION_COOKIE = 'taskstride_session'
export const AUTH_HEADER = 'x-taskstride-auth'
const SESSION_MAX_AGE = 60 * 60 * 24 * 390
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

export interface Env {
  GOOGLE_CLIENT_ID?: string
  GOOGLE_CLIENT_SECRET?: string
  SESSION_SECRET?: string
}
export interface FunctionContext { request: Request; env: Env }
export interface AuthConfig { clientId: string; clientSecret: string; sessionSecret: string }
export type TokenResult =
  | { ok: true; accessToken: string; expiresIn: number; refreshToken?: string }
  | { ok: false; status: number; error: string; description?: string }

export function readConfig(env: Env): AuthConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim()
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim()
  const sessionSecret = env.SESSION_SECRET?.trim()
  if (!clientId || !clientSecret || !sessionSecret) return null
  return { clientId, clientSecret, sessionSecret }
}

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', vary: 'Cookie', ...headers },
  })
}

/** Rejects requests that a third-party site could trigger without a CORS preflight. */
export function guardRequest(request: Request): Response | null {
  if (request.headers.get(AUTH_HEADER) !== '1') return json({ error: 'forbidden' }, 403)
  return null
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', digest, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
}

export async function seal(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sessionKey(secret), new TextEncoder().encode(value)))
  const payload = new Uint8Array(iv.length + cipher.length)
  payload.set(iv)
  payload.set(cipher, iv.length)
  return base64UrlEncode(payload)
}

export async function unseal(sealed: string, secret: string): Promise<string | null> {
  try {
    const payload = base64UrlDecode(sealed)
    if (payload.length <= 12) return null
    const iv = new Uint8Array(payload.subarray(0, 12))
    const cipher = new Uint8Array(payload.subarray(12))
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, await sessionKey(secret), cipher)
    return new TextDecoder().decode(plain)
  } catch {
    return null
  }
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie')
  if (!header) return null
  for (const part of header.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0) continue
    if (part.slice(0, separator).trim() !== name) continue
    return decodeURIComponent(part.slice(separator + 1).trim()) || null
  }
  return null
}

export function sessionCookie(value: string): string {
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}`
}

export const clearedSessionCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`

async function postToken(body: Record<string, string>): Promise<TokenResult> {
  let response: Response
  try {
    response = await fetch(TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString(),
    })
  } catch {
    return { ok: false, status: 502, error: 'network_error', description: 'Google’s token endpoint could not be reached.' }
  }
  const payload = await response.json().catch(() => null) as
    | { access_token?: string; expires_in?: number; refresh_token?: string; error?: string; error_description?: string }
    | null
  if (!response.ok || !payload?.access_token) {
    return {
      ok: false,
      status: response.status >= 500 ? 502 : 401,
      error: payload?.error ?? 'token_request_failed',
      description: payload?.error_description,
    }
  }
  return { ok: true, accessToken: payload.access_token, expiresIn: payload.expires_in ?? 3600, refreshToken: payload.refresh_token }
}

/**
 * Exchanges a Google Identity Services popup auth code. Google documents `postmessage`
 * for the popup code model but also accepts the calling page origin, so both are tried.
 */
export async function exchangeCode(code: string, config: AuthConfig, origin?: string): Promise<TokenResult> {
  const candidates = origin && origin !== 'postmessage' ? ['postmessage', origin] : ['postmessage']
  let last: TokenResult = { ok: false, status: 401, error: 'invalid_grant' }
  for (const redirectUri of candidates) {
    last = await postToken({ code, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', redirect_uri: redirectUri })
    if (last.ok || last.status === 502) return last
  }
  return last
}

export function refreshAccessToken(refreshToken: string, config: AuthConfig): Promise<TokenResult> {
  return postToken({ refresh_token: refreshToken, client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token' })
}

export async function revokeRefreshToken(refreshToken: string): Promise<void> {
  try {
    await fetch(REVOKE_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token: refreshToken }).toString(),
    })
  } catch {
    // A failed revoke still clears the local session; Google expires the token on its own.
  }
}
