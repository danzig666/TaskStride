# Cloudflare Pages setup for long-lived Google sessions

Without a backend, TaskStride can only use the Google Identity Services *token* flow. That
flow issues a one-hour access token and no refresh token, so the browser has to send the user
back to Google roughly every hour — and every time the tab is closed, because a token may
only be kept for the lifetime of the tab.

The `functions/` directory in this repository is a Cloudflare Pages Functions backend that
removes that limit. It is optional: when the environment variables below are missing, the
endpoints answer `503 not_configured` and the app silently falls back to the old in-tab flow.

## How it works

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/exchange` | Trades the Google auth code for an access **and** refresh token, then seals the refresh token into an HttpOnly cookie. |
| `POST /api/token` | Returns a fresh access token for that cookie. Called on load, five minutes before expiry, when the tab becomes visible, and after any 401 from Google. |
| `POST /api/auth/logout` | Revokes the refresh token at Google and clears the cookie. |

The refresh token never reaches the browser. It is encrypted with AES-GCM using a key derived
from `SESSION_SECRET` and stored in a `HttpOnly; Secure; SameSite=Lax` cookie, so page
JavaScript cannot read it and other sites cannot send it. Every endpoint also requires an
`x-taskstride-auth: 1` request header, which a cross-site request cannot set without a CORS
preflight that the functions never grant.

## 1. Google Cloud

1. **APIs & Services → Credentials →** open the existing **Web application** OAuth client.
2. Under **Authorized JavaScript origins**, list every origin that serves the app, for example
   `https://tasks.example.com` and `http://localhost:5173`. Origins never include a path.
3. Add a **client secret** to the same client and copy it. This value must only ever be stored
   as a Cloudflare secret — never in a `VITE_` variable, which Vite inlines into the bundle.
4. **Google Auth Platform → Audience →** press **Publish app** so the publishing status becomes
   **In production**. In *Testing* status Google expires every refresh token after seven days,
   which would reintroduce the problem this backend solves. Publishing does not require
   verification; until the app is verified, the consent screen shows an "unverified app" notice
   that can be dismissed with **Advanced → Go to TaskStride**, and unverified apps are capped
   at 100 users.

## 2. Cloudflare Pages

Build configuration (**Settings → Build**):

| Setting | Value |
| --- | --- |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | repository root |

Pages picks up `functions/` automatically — no `wrangler.toml` and no extra build step are
needed. `public/_routes.json` keeps the worker off the static asset paths, and
`public/_headers` carries the Content-Security-Policy and caching rules.

Variables and secrets (**Settings → Variables and Secrets**). Add them to **both** the
Production and Preview environments, otherwise preview deployments break:

| Name | Type | Value |
| --- | --- | --- |
| `GOOGLE_CLIENT_ID` | plaintext | The OAuth client ID. Runtime only. |
| `GOOGLE_CLIENT_SECRET` | **secret** | The client secret from step 1.3. |
| `SESSION_SECRET` | **secret** | 32+ random bytes, e.g. `openssl rand -base64 48`. |
| `VITE_GOOGLE_CLIENT_ID` | plaintext | The same client ID. Read at **build** time by the browser bundle. |
| `VITE_MOCK_MODE` | plaintext | `false`, or leave it unset. `true` serves demo data. |

Redeploy after adding them: `VITE_` variables are baked into the bundle at build time, so an
existing deployment will not pick them up.

## 3. Verify

```bash
curl -si -X POST https://tasks.example.com/api/token -H 'x-taskstride-auth: 1' | head -1
```

* `HTTP/2 401` with `{"error":"no_session"}` — the backend is live and waiting for a sign-in.
* `HTTP/2 503` with `{"error":"not_configured"}` — a variable is missing or the deployment
  predates them.
* An HTML body or `404` — the functions are not deployed; the app will use the in-tab flow.

Then open the app, press **Connect Google Tasks** once, and reload. The reload must not ask
for Google again. Leaving it for a day and returning must not ask either.

## Operational notes

* **Rotating `SESSION_SECRET` invalidates every session.** Existing cookies can no longer be
  unsealed, so everyone reconnects once. Google's own grant is untouched.
* **Disconnect Google** in Settings revokes the refresh token at Google and clears the cookie.
* Google can still invalidate a refresh token on its own: the user revokes access, six months
  of inactivity, a password change, or more than 100 live tokens for one client and user. The
  app handles this by asking for a reconnect.

## Troubleshooting

**`redirect_uri_mismatch` during sign-in**
The exchange tries `postmessage` first and then the page origin, so this usually means the
origin is missing from **Authorized JavaScript origins**. Protocol, host and port must match
exactly.

**"Google did not issue a long-lived session" (`409 no_refresh_token`)**
Google only returns a refresh token on a first grant. Remove TaskStride at
[myaccount.google.com/connections](https://myaccount.google.com/connections) and connect again.

**Sessions still expire after seven days**
The consent screen is still in *Testing*. Finish step 1.4.

**Sessions still expire after an hour**
The app is using the fallback flow. Check step 3 — most often `GOOGLE_CLIENT_SECRET` or
`SESSION_SECRET` is missing from the environment that serves the deployment.
