import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { buildBackendEnv, configureNumbaCacheRoot } from './embeddedStack'
import type { EmbeddedLayout } from './embeddedPaths'
import type { InstallSecrets } from './installSecrets'

// buildBackendEnv reads only backendSrcDir off the layout and secretKey off the
// secrets, so a minimal stub for each is enough to exercise the env it builds.
const LAYOUT = {
  backendSrcDir: join('C:', 'Program Files', 'StrixGeo', 'resources', 'backend', 'src'),
  pgsqlRoot: join('C:', 'Program Files', 'StrixGeo', 'resources', 'pgsql'),
} as EmbeddedLayout
const SECRETS: InstallSecrets = { user: 'u', password: 'p', database: 'd', secretKey: 'k' }
const DSN = 'postgresql+asyncpg://u:p@127.0.0.1:5433/d'

// The numba-cache root is module state (configured once at startup by index.ts).
// Reset after every test so a configured case never leaks into the default one.
// A real temp tree is used for the writable roots because buildBackendEnv mkdirs
// the cache directory it resolves.
let base: string

afterEach(() => {
  configureNumbaCacheRoot(null)
  if (base) rmSync(base, { recursive: true, force: true })
})

describe('buildBackendEnv numba cache location (audit M1)', () => {
  it('resolves the numba cache under the user profile by default (dev / unconfigured)', () => {
    base = mkdtempSync(join(tmpdir(), 'strix-numba-default-'))
    const userData = join(base, 'roaming')

    const env = buildBackendEnv(LAYOUT, userData, DSN, SECRETS)

    expect(env.NUMBA_CACHE_DIR).toBe(join(userData, 'numba-cache'))
  })

  it('resolves the numba cache under the configured machine-local root when set', () => {
    // A domain-joined consultancy syncs/redirects Roaming; the rebuildable numba
    // cache is churn on that sync, so a packaged launch points it at %LOCALAPPDATA%.
    base = mkdtempSync(join(tmpdir(), 'strix-numba-local-'))
    const userData = join(base, 'roaming')
    const localRoot = join(base, 'local')
    configureNumbaCacheRoot(localRoot)

    const env = buildBackendEnv(LAYOUT, userData, DSN, SECRETS)

    expect(env.NUMBA_CACHE_DIR).toBe(join(localRoot, 'numba-cache'))
    // The rest of the environment still keys off userDataPath / the layout.
    expect(env.PYTHONPATH).toBe(LAYOUT.backendSrcDir)
  })

  it('reverts to the user profile when the root is cleared', () => {
    base = mkdtempSync(join(tmpdir(), 'strix-numba-clear-'))
    const userData = join(base, 'roaming')
    configureNumbaCacheRoot(join(base, 'local'))
    configureNumbaCacheRoot(null)

    const env = buildBackendEnv(LAYOUT, userData, DSN, SECRETS)

    expect(env.NUMBA_CACHE_DIR).toBe(join(userData, 'numba-cache'))
  })
})
