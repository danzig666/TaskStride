import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Compile-time constants for the About section: the package version, and the commit the bundle
 * was built from. Cloudflare Pages provides CF_PAGES_COMMIT_SHA and GitHub Actions GITHUB_SHA;
 * elsewhere git is asked, and the commit is left empty when that fails too.
 */
export function buildInfo(env: Record<string, string | undefined> = process.env) {
  const { version } = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8')) as { version: string }
  let commit = env.CF_PAGES_COMMIT_SHA || env.GITHUB_SHA || ''
  if (!commit) {
    try { commit = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() } catch { commit = '' }
  }
  return { __APP_VERSION__: JSON.stringify(version), __APP_COMMIT__: JSON.stringify(commit.slice(0, 7)) }
}
