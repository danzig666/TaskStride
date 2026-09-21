// POST /api/auth/logout — revokes the stored refresh token and clears the session cookie.
import { clearedSessionCookie, guardRequest, json, readConfig, readCookie, revokeRefreshToken, SESSION_COOKIE, unseal, type FunctionContext } from '../_session'

export const onRequestPost = async ({ request, env }: FunctionContext): Promise<Response> => {
  const blocked = guardRequest(request)
  if (blocked) return blocked

  const config = readConfig(env)
  const cookie = readCookie(request, SESSION_COOKIE)
  if (config && cookie) {
    const refreshToken = await unseal(cookie, config.sessionSecret)
    if (refreshToken) await revokeRefreshToken(refreshToken)
  }
  return json({ ok: true }, 200, { 'set-cookie': clearedSessionCookie })
}
