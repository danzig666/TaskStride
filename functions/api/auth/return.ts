// GET /api/auth/return?to=/path — a navigation target that deliberately passes through the edge.
// The app's service worker answers every other navigation from its cache, so without this route an
// expired Cloudflare Access session could never be renewed: the gate would never see a request.
// The function itself only sends the browser back to the app, and only to a same-origin path.

export const onRequestGet = ({ request }: { request: Request }): Response => {
  const target = new URL(request.url).searchParams.get('to') ?? '/'
  return new Response(null, { status: 302, headers: { location: safeReturnPath(target), 'cache-control': 'no-store' } })
}

export function safeReturnPath(target: string): string {
  // Only plain absolute paths: `//host` and `/\host` are protocol-relative in browsers.
  if (!target.startsWith('/') || target.startsWith('//') || target.startsWith('/\\')) return '/'
  // Never bounce straight back into this route or the edge's own endpoints.
  if (target.startsWith('/api/') || target.startsWith('/cdn-cgi/')) return '/'
  return target
}
