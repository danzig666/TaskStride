# TaskStride

TaskStride is a responsive, installable frontend for Google Tasks. It talks directly from the browser to Google Identity Services and the official Google Tasks REST API. There is no application backend, proprietary task database, or second account system.

> Screenshot placeholders: `docs/screenshots/desktop-light.png`, `desktop-dark.png`, and `mobile.png` can be added when publishing a branded release.

## Features

- All tasks is the default, top navigation view, with Today, Upcoming, No date, Completed, and Assigned views available below it.
- Fast task creation, completion, editing, deletion with Undo, date-only due dates, notes, subtasks, manual ordering, and cross-list movement.
- Typed Google Tasks adapter with pagination, PATCH updates, task/list CRUD, move semantics, clear-completed support, and friendly API errors.
- Google Identity Services token flow. Access tokens stay in memory and are never persisted.
- Responsive three-pane desktop, tablet sheet, and dedicated mobile navigation.
- Instant local search, command menu, keyboard shortcuts, dark mode, comfortable/compact density, JSON export, and list-specific task counts.
- Complete English and Hungarian interface selectable in Settings; the preference is stored locally.
- IndexedDB cache for read-only offline browsing; offline writes are intentionally disabled in this release.
- PWA manifest, service worker, install icons, cached app shell, and update-ready configuration.
- Accessible labels, visible focus styles, reduced-motion support, keyboard alternatives, and 44 px mobile targets.
- Development mock mode that uses the same repository interface as Google Tasks.

## Architecture

```text
React UI
  ├─ TanStack Query (remote state and optimistic updates)
  ├─ Zustand (small persistent UI preferences)
  ├─ Dexie / IndexedDB (cached task snapshot)
  └─ TaskRepository
       ├─ MockTasksRepository
       └─ GoogleTasksRepository → Google Tasks REST API

Browser → Google Identity Services → Google Tasks API
```

Google task IDs are canonical. Smart views are derived locally and never create duplicate tasks. List accent colors and appearance preferences are local-only.

## Prerequisites

- Node.js 22 or newer
- npm 10 or newer
- An HTTPS origin for production OAuth (localhost is supported for development)
- A Google Cloud project when using real data

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

Mock mode is enabled with `VITE_MOCK_MODE=true`. It includes Work, Personal, House, and Someday lists with normal, nested, completed, overdue, assigned-style, dated, and undated tasks.

## Google Cloud and OAuth setup

1. Open Google Cloud Console and select or create a project.
2. In **APIs & Services → Library**, enable **Google Tasks API**.
3. Configure the OAuth consent screen. Add the minimal `https://www.googleapis.com/auth/tasks` scope, your app information, and test users while the app is in testing.
4. In **APIs & Services → Credentials**, create an **OAuth client ID** of type **Web application**.
5. Add every development and production origin under **Authorized JavaScript origins**, for example `http://localhost:5173` and `https://tasks.example.com`. Origins do not include a path.
6. Copy the client ID—not a client secret—into `.env.local`:

```dotenv
VITE_GOOGLE_CLIENT_ID=1234567890-example.apps.googleusercontent.com
VITE_MOCK_MODE=false
```

TaskStride uses the Google Identity Services browser token model. Tokens are short-lived. When one expires, cached tasks remain visible in read-only mode and the user is asked to reconnect. A static SPA cannot securely hold a refresh token and TaskStride does not simulate silent refresh.

## Configuration

| Variable | Purpose | Default |
| --- | --- | --- |
| `VITE_GOOGLE_CLIENT_ID` | Google Web OAuth client ID | unset |
| `VITE_MOCK_MODE` | Use realistic local demo data | enabled when no client ID is present |
| `VITE_APP_NAME` | App/manifest display name | `TaskStride` |
| `VITE_APP_BASE_PATH` | Deployment base, e.g. `/tasks/` | `/` |
| `VITE_SOURCE_URL` | Open-source repository URL | unset |

Never put a Google client secret in any `VITE_` variable. Vite exposes these variables to the browser.

## Commands

```bash
npm run dev          # development server
npm run build        # strict TypeScript and production build
npm run preview      # preview the production build
npm run test         # unit and component tests
npm run test:e2e     # Playwright critical flows
npm run lint         # ESLint
npm run typecheck    # strict TypeScript only
```

## Static production deployment

```bash
npm install
npm run build
```

Publish the generated `dist/` directory on any HTTPS static host. For a subpath, build with `VITE_APP_BASE_PATH=/tasks/` and serve the SPA fallback from the same path.

### nginx

```nginx
location /tasks/ {
    alias /var/www/taskstride/;
    try_files $uri $uri/ /tasks/index.html;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' https://accounts.google.com; connect-src 'self' https://tasks.googleapis.com https://oauth2.googleapis.com; frame-src https://accounts.google.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'self'; object-src 'none'; frame-ancestors 'self'" always;
}
```

### Apache

```apache
RewriteEngine On
RewriteBase /tasks/
RewriteCond %{REQUEST_FILENAME} !-f
RewriteCond %{REQUEST_FILENAME} !-d
RewriteRule . /tasks/index.html [L]

Header always set Content-Security-Policy "default-src 'self'; script-src 'self' https://accounts.google.com; connect-src 'self' https://tasks.googleapis.com https://oauth2.googleapis.com; frame-src https://accounts.google.com; img-src 'self' data:; style-src 'self' 'unsafe-inline'; base-uri 'self'; object-src 'none'"
```

Use content-hashed cache headers for `assets/`, but serve `index.html`, `manifest.webmanifest`, and `sw.js` with revalidation so PWA updates are discovered. Do not force a page reload while a user is editing.

## Privacy and security

- OAuth access tokens exist only in JavaScript memory. They are not written to localStorage, sessionStorage, cookies, or IndexedDB.
- Task contents are cached in IndexedDB on the current device for offline browsing.
- localStorage contains only UI preferences such as theme, density, selected view, and favorites.
- **Clear local cache** deletes the IndexedDB task snapshot. **Disconnect Google** also clears cached task data.
- No telemetry is included.
- External links open with `noopener,noreferrer`; API data is rendered as text; `dangerouslySetInnerHTML` is not used.

## Google Tasks API limitations

- Due values contain a calendar date only. Google discards the time portion, so TaskStride never offers due times or reminders.
- Assigned and repeating tasks have move/nesting restrictions. TaskStride disables or rejects unsupported operations.
- Repeating rules can be returned but are not reliably writable through the Tasks API, so there is no recurrence editor.
- Google list colors do not exist in the Tasks data model; TaskStride accents are local preferences only.
- Cross-list movement of recurring tasks is not supported by Google.
- Browser access tokens expire and require a user-driven reconnect in a backend-free deployment.
- Offline task mutations are disabled until a robust conflict-aware queue can be provided.

## Troubleshooting

**OAuth popup closes or reports `origin_mismatch`**  
Confirm the exact protocol, host, and port are listed as an authorized JavaScript origin. Production must use HTTPS.

**Permission denied**  
Confirm the Tasks API is enabled, the consent screen includes the Tasks scope, and the signed-in account is an allowed test user while the app is in testing.

**Task lists are blank**  
Use Refresh, reconnect Google, then inspect the browser network panel for a 401 or 403 response. Verify `VITE_MOCK_MODE=false` and that the client ID belongs to the project where Tasks API is enabled.

**Deployed under a subpath but assets 404**  
Set `VITE_APP_BASE_PATH` before building and configure the host's SPA fallback to that same base.

## License

MIT. See [LICENSE](LICENSE).
