// Rule: the packaged migrate step must be able to take its pre-migration
// checkpoint — the bundled pg_dump and a machine-local backups directory reach
// database_migrator.py through the backend env (the 07:03 installer migrated
// without a dump because neither variable was set).
import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

import { buildBackendEnv, configureNumbaCacheRoot } from './embeddedStack'
import type { EmbeddedLayout } from './embeddedPaths'
import type { InstallSecrets } from './installSecrets'

const LAYOUT = {
  backendSrcDir: join('C:', 'Program Files', 'StrixGeo', 'resources', 'backend', 'src'),
  pgsqlRoot: join('C:', 'Program Files', 'StrixGeo', 'resources', 'pgsql'),
} as EmbeddedLayout
const SECRETS: InstallSecrets = { user: 'u', password: 'p', database: 'd', secretKey: 'k' }
const DSN = 'postgresql+asyncpg://u:p@127.0.0.1:5433/d'

let base: string

afterEach(() => {
  configureNumbaCacheRoot(null)
  if (base) rmSync(base, { recursive: true, force: true })
})

describe('buildBackendEnv pre-migration checkpoint (audit H2b)', () => {
  it('names the bundled pg_dump and a backups directory under the user profile by default', () => {
    base = mkdtempSync(join(tmpdir(), 'strix-backup-default-'))
    const userData = join(base, 'roaming')
    const env = buildBackendEnv(LAYOUT, userData, DSN, SECRETS)
    expect(env.STRIX_PG_DUMP_PATH).toBe(join(LAYOUT.pgsqlRoot, 'bin', 'pg_dump.exe'))
    expect(env.STRIX_BACKUP_DIR).toBe(join(userData, 'backups'))
  })

  it('puts the backups beside the machine-local stores when a local root is configured', () => {
    base = mkdtempSync(join(tmpdir(), 'strix-backup-local-'))
    const userData = join(base, 'roaming')
    const localRoot = join(base, 'local')
    configureNumbaCacheRoot(localRoot)
    const env = buildBackendEnv(LAYOUT, userData, DSN, SECRETS)
    expect(env.STRIX_BACKUP_DIR).toBe(join(localRoot, 'backups'))
  })
})
