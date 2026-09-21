const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'
const SESSION_KEY = 'taskstride.google-auth'
const AUTH_API = (import.meta.env.VITE_AUTH_API_BASE as string | undefined)?.replace(/\/$/, '') || '/api'
// Google access tokens live an hour; refresh early so a request never races the expiry.
const REFRESH_MARGIN_MS = 5 * 60_000
const MIN_REFRESH_DELAY_MS = 30_000

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface CodeResponse { code?: string; scope?: string; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(config?: { prompt?: string }): void }
interface CodeClient { requestCode(): void }
interface GoogleOAuth {
  initTokenClient(config: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback?: (error: unknown) => void }): TokenClient
  initCodeClient(config: { client_id: string; scope: string; ux_mode: 'popup'; select_account?: boolean; callback: (response: CodeResponse) => void; error_callback?: (error: unknown) => void }): CodeClient
  revoke(token: string, callback: () => void): void
}
declare global { interface Window { google?: { accounts: { oauth2: GoogleOAuth } } } }

/** 'server' keeps the refresh token in an HttpOnly cookie; 'client' is the backend-free token flow. */
export type AuthBackend = 'unknown' | 'server' | 'client'
type ServerTokenOutcome = 'ok' | 'no-session' | 'unavailable' | 'upstream-error'

class GoogleAuthService extends EventTarget {
  private token: string | null = null
  private expiresAt = 0
  private tokenClient: TokenClient | null = null
  private clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined
  private backendMode: AuthBackend = 'unknown'
  private serverSession = false
  private restored = false
  private booted = false
  private restoring?: Promise<void>
  private refreshing?: Promise<boolean>
  private refreshTimer?: ReturnType<typeof setTimeout>
  private notified = { connected: false, ready: false }

  constructor() {
    super()
    if (!this.clientId) {
      // Without a client id the app runs on demo data; settle immediately so no splash shows.
      this.backendMode = 'client'
      this.restoreClientSession()
      this.restored = true
      this.booted = true
      this.notified = { connected: this.connected, ready: true }
      return
    }
    // With a client id the backend is probed first, so nothing is loaded from this tab yet:
    // a stale token must never be handed out once a server session takes over.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void this.refreshIfStale() })
    }
  }

  get configured() { return Boolean(this.clientId) }
  get backend(): AuthBackend { return this.backendMode }
  /** False until the stored session has been probed, so the UI can avoid a sign-in flash. */
  get ready() { return this.booted }
  get accessToken() { return this.token && Date.now() < this.expiresAt ? this.token : null }
  get connected() { return this.backendMode === 'server' ? this.serverSession : Boolean(this.accessToken) }

  /** Restores a session once per page load: a server cookie when available, otherwise this tab's token. */
  restore(): Promise<void> {
    if (this.restored) return Promise.resolve()
    if (this.restoring) return this.restoring
    this.restoring = (async () => {
      const outcome = await this.requestServerToken()
      if (outcome === 'unavailable') {
        this.backendMode = 'client'
        this.restoreClientSession()
      } else {
        this.backendMode = 'server'
        // A server session supersedes anything an earlier backend-free deployment stored.
        this.clearStoredSession()
      }
      this.restored = true
      this.booted = true
      this.notify()
    })()
    return this.restoring
  }

  async load(): Promise<void> {
    if (!this.clientId) return
    if (window.google?.accounts?.oauth2) return
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]')
      if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); existing.addEventListener('error', () => reject(new Error('Could not load Google Identity Services.')), { once: true }); return }
      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.dataset.googleIdentity = 'true'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load Google Identity Services.'))
      document.head.append(script)
    })
  }

  async connect(options: { switchAccount?: boolean } = {}): Promise<void> {
    if (!this.clientId) throw new Error('Add VITE_GOOGLE_CLIENT_ID to connect Google Tasks.')
    await this.restore()
    await this.load()
    if (!window.google?.accounts?.oauth2) throw new Error('Could not load Google Identity Services.')
    if (this.backendMode === 'server') await this.connectWithCode(options)
    else await this.connectWithToken(options)
    this.notify()
  }

  /** Returns a usable access token, refreshing through the backend when one is available. */
  async ensureAccessToken(): Promise<string | null> {
    if (!this.restored) await this.restore()
    const current = this.accessToken
    if (current) return current
    if (this.backendMode !== 'server') return null
    await this.refreshFromServer()
    return this.accessToken
  }

  /** Called after Google answers 401; resolves true when the request may be retried. */
  async recoverFromUnauthorized(): Promise<boolean> {
    if (!this.restored) await this.restore()
    if (this.backendMode !== 'server') { this.expire(); return false }
    this.token = null
    this.expiresAt = 0
    if (await this.refreshFromServer()) return true
    this.notify()
    return false
  }

  expire() {
    this.token = null
    this.expiresAt = 0
    this.clearStoredSession()
    this.clearRefreshTimer()
    this.notify()
  }

  disconnect() {
    if (this.backendMode === 'server' && this.serverSession) {
      void fetch(`${AUTH_API}/auth/logout`, { method: 'POST', credentials: 'same-origin', headers: { 'x-taskstride-auth': '1' } }).catch(() => undefined)
    } else if (this.token && window.google?.accounts?.oauth2) {
      window.google.accounts.oauth2.revoke(this.token, () => undefined)
    }
    this.serverSession = false
    this.expire()
  }

  revoke() { this.disconnect() }

  private async connectWithCode(options: { switchAccount?: boolean }): Promise<void> {
    const code = await new Promise<string>((resolve, reject) => {
      const client = window.google!.accounts.oauth2.initCodeClient({
        client_id: this.clientId!,
        scope: TASKS_SCOPE,
        ux_mode: 'popup',
        select_account: options.switchAccount === true,
        callback: (response) => {
          if (response.code) return resolve(response.code)
          reject(new Error(response.error_description || response.error || 'Authorization was cancelled.'))
        },
        error_callback: () => reject(new Error('The Google authorization window was closed.')),
      })
      client.requestCode()
    })

    const response = await fetch(`${AUTH_API}/auth/exchange`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-taskstride-auth': '1' },
      body: JSON.stringify({ code, origin: window.location.origin }),
    })
    const payload = await response.json().catch(() => null) as (TokenResponse & { description?: string }) | null
    if (response.status === 409 || payload?.error === 'no_refresh_token') {
      throw new Error('Google did not issue a long-lived session. Remove TaskStride under your Google account’s third-party access, then connect again.')
    }
    if (!response.ok || !payload?.access_token) {
      throw new Error(payload?.description || payload?.error || 'The Google session could not be established.')
    }
    this.serverSession = true
    this.applyToken(payload.access_token, payload.expires_in)
  }

  private async connectWithToken(options: { switchAccount?: boolean }): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.tokenClient = window.google!.accounts.oauth2.initTokenClient({
        client_id: this.clientId!,
        scope: TASKS_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) return reject(new Error(response.error_description || response.error || 'Authorization was cancelled.'))
          this.applyToken(response.access_token, response.expires_in)
          resolve()
        },
        error_callback: () => reject(new Error('The Google authorization window was closed.')),
      })
      this.tokenClient.requestAccessToken({ prompt: options.switchAccount ? 'select_account' : '' })
    })
  }

  private refreshFromServer(): Promise<boolean> {
    if (this.refreshing) return this.refreshing
    this.refreshing = (async () => {
      try {
        return await this.requestServerToken() === 'ok'
      } finally {
        this.refreshing = undefined
      }
    })()
    return this.refreshing
  }

  private async requestServerToken(): Promise<ServerTokenOutcome> {
    let response: Response
    try {
      response = await fetch(`${AUTH_API}/token`, { method: 'POST', credentials: 'same-origin', headers: { 'x-taskstride-auth': '1' } })
    } catch {
      return 'unavailable'
    }
    // A static deployment answers /api/token with the SPA shell or a 404 instead of JSON.
    if (!response.headers.get('content-type')?.includes('application/json')) return 'unavailable'
    const payload = await response.json().catch(() => null) as (TokenResponse & { description?: string }) | null
    if (!payload) return 'unavailable'
    if (payload.error === 'not_configured') return 'unavailable'

    if (response.ok && payload.access_token) {
      this.serverSession = true
      this.applyToken(payload.access_token, payload.expires_in)
      return 'ok'
    }
    if (response.status === 401) {
      this.serverSession = false
      this.token = null
      this.expiresAt = 0
      this.clearRefreshTimer()
      return 'no-session'
    }
    // Google was unreachable rather than rejecting the session. Assume the session is intact
    // so the user sees a retryable sync error; the next call corrects this with a real 401.
    this.serverSession = true
    return 'upstream-error'
  }

  private applyToken(token: string, expiresIn?: number) {
    this.token = token
    this.expiresAt = Date.now() + Math.max(0, (expiresIn ?? 3600) - 60) * 1000
    if (this.backendMode === 'server') this.clearStoredSession()
    else this.persistClientSession()
    this.scheduleRefresh()
    this.notify()
  }

  private scheduleRefresh() {
    this.clearRefreshTimer()
    if (this.backendMode !== 'server' || typeof setTimeout === 'undefined') return
    const delay = Math.max(MIN_REFRESH_DELAY_MS, this.expiresAt - Date.now() - REFRESH_MARGIN_MS)
    this.refreshTimer = setTimeout(() => { void this.refreshFromServer() }, delay)
  }

  private clearRefreshTimer() {
    if (this.refreshTimer !== undefined) clearTimeout(this.refreshTimer)
    this.refreshTimer = undefined
  }

  private async refreshIfStale() {
    if (this.backendMode !== 'server' || !this.serverSession) return
    if (this.token && Date.now() < this.expiresAt - REFRESH_MARGIN_MS) return
    await this.refreshFromServer()
  }

  private restoreClientSession() {
    if (typeof sessionStorage === 'undefined') return
    try {
      const stored = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as { token?: unknown; expiresAt?: unknown } | null
      if (typeof stored?.token === 'string' && typeof stored.expiresAt === 'number' && stored.expiresAt > Date.now()) {
        this.token = stored.token
        this.expiresAt = stored.expiresAt
      } else {
        sessionStorage.removeItem(SESSION_KEY)
      }
    } catch {
      sessionStorage.removeItem(SESSION_KEY)
    }
  }

  private persistClientSession() {
    if (typeof sessionStorage === 'undefined' || !this.token) return
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify({ token: this.token, expiresAt: this.expiresAt })) } catch { /* private mode */ }
  }

  private clearStoredSession() {
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(SESSION_KEY)
  }

  /** Only connection changes are announced, so a silent token refresh never remounts queries. */
  private notify() {
    // Nothing is announced during boot: restore() emits one event for the settled state.
    if (!this.booted) return
    const snapshot = { connected: this.connected, ready: this.booted }
    if (snapshot.connected === this.notified.connected && snapshot.ready === this.notified.ready) return
    this.notified = snapshot
    this.dispatchEvent(new Event('change'))
  }
}

export const googleAuth = new GoogleAuthService()
