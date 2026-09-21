// POST /api/token — returns a fresh Google access token for the sealed session cookie.
// The client calls this on boot, shortly before expiry, and after any 401 from Google.
import { clearedSessionCookie, guardRequest, json, readConfig, readCookie, refreshAccessToken, SESSION_COOKIE, unseal, type FunctionContext } from './_session'

export const onRequestPost = async ({ request, env }: FunctionContext): Promise<Response> => {
  const blocked = guardRequest(request)
  if (blocked) return blocked

  const config = readConfig(env)
  if (!config) return json({ error: 'not_configured' }, 503)

  const cookie = readCookie(request, SESSION_COOKIE)
  if (!cookie) return json({ error: 'no_session' }, 401)

  const refreshToken = await unseal(cookie, config.sessionSecret)
  if (!refreshToken) return json({ error: 'no_session' }, 401, { 'set-cookie': clearedSessionCookie })

  const result = await refreshAccessToken(refreshToken, config)
  if (!result.ok) {
    // 502 keeps the session: Google was unreachable rather than rejecting the grant.
    if (result.status === 502) return json({ error: 'upstream', description: result.description }, 502)
    return json({ error: 'invalid_grant', description: result.description }, 401, { 'set-cookie': clearedSessionCookie })
  }
  return json({ access_token: result.accessToken, expires_in: result.expiresIn })
}
