const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface TokenClient { requestAccessToken(config?: { prompt?: string }): void }
interface GoogleOAuth { initTokenClient(config: { client_id: string; scope: string; callback: (response: TokenResponse) => void; error_callback?: (error: unknown) => void }): TokenClient; revoke(token: string, callback: () => void): void }
declare global { interface Window { google?: { accounts: { oauth2: GoogleOAuth } } } }

class GoogleAuthService extends EventTarget {
  private token: string | null = null
  private expiresAt = 0
  private client: TokenClient | null = null
  private clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined

  get configured() { return Boolean(this.clientId) }
  get accessToken() { return this.token && Date.now() < this.expiresAt ? this.token : null }
  get connected() { return Boolean(this.accessToken) }

  async load(): Promise<void> {
    if (!this.clientId || this.client) return
    if (!window.google?.accounts?.oauth2) {
      await new Promise<void>((resolve, reject) => {
        const existing = document.querySelector<HTMLScriptElement>('script[data-google-identity]')
        if (existing) { existing.addEventListener('load', () => resolve(), { once: true }); return }
        const script = document.createElement('script'); script.src = 'https://accounts.google.com/gsi/client'; script.async = true; script.dataset.googleIdentity = 'true'; script.onload = () => resolve(); script.onerror = () => reject(new Error('Could not load Google Identity Services.')); document.head.append(script)
      })
    }
    this.client = window.google!.accounts.oauth2.initTokenClient({ client_id: this.clientId, scope: TASKS_SCOPE, callback: () => undefined })
  }

  async connect(prompt: '' | 'consent' | 'select_account' = ''): Promise<void> {
    await this.load()
    if (!this.client) throw new Error('Add VITE_GOOGLE_CLIENT_ID to connect Google Tasks.')
    await new Promise<void>((resolve, reject) => {
      this.client = window.google!.accounts.oauth2.initTokenClient({
        client_id: this.clientId!, scope: TASKS_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) return reject(new Error(response.error_description || response.error || 'Authorization was cancelled.'))
          this.token = response.access_token; this.expiresAt = Date.now() + Math.max(0, (response.expires_in ?? 3600) - 60) * 1000; this.dispatchEvent(new Event('change')); resolve()
        },
        error_callback: () => reject(new Error('The Google authorization window was closed.')),
      })
      this.client.requestAccessToken({ prompt })
    })
  }

  expire() { this.expiresAt = 0; this.dispatchEvent(new Event('change')) }
  disconnect() { this.token = null; this.expiresAt = 0; this.dispatchEvent(new Event('change')) }
  revoke() { const token = this.token; if (!token || !window.google) return this.disconnect(); window.google.accounts.oauth2.revoke(token, () => this.disconnect()) }
}

export const googleAuth = new GoogleAuthService()
