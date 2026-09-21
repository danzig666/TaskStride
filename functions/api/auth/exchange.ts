// POST /api/auth/exchange — trades a Google Identity Services auth code for a long-lived
// session. The refresh token never leaves this function; it is sealed into the cookie.
import { exchangeCode, guardRequest, json, readConfig, seal, sessionCookie, type FunctionContext } from '../_session'

export const onRequestPost = async ({ request, env }: FunctionContext): Promise<Response> => {
  const blocked = guardRequest(request)
  if (blocked) return blocked

  const config = readConfig(env)
  if (!config) return json({ error: 'not_configured' }, 503)

  const body = await request.json().catch(() => null) as { code?: unknown; origin?: unknown } | null
  const code = typeof body?.code === 'string' ? body.code.trim() : ''
  if (!code) return json({ error: 'missing_code' }, 400)
  const origin = typeof body?.origin === 'string' && body.origin.startsWith('http') ? body.origin : undefined

  const result = await exchangeCode(code, config, origin)
  if (!result.ok) return json({ error: result.error, description: result.description }, result.status)
  // Google only returns a refresh token on a first grant, so an existing grant must be
  // removed in the Google account before a server-side session can be established.
  if (!result.refreshToken) return json({ error: 'no_refresh_token' }, 409)

  return json(
    { access_token: result.accessToken, expires_in: result.expiresIn },
    200,
    { 'set-cookie': sessionCookie(await seal(result.refreshToken, config.sessionSecret)) },
  )
}
