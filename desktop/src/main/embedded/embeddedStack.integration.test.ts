/**
 * Drives the REAL embedded stack against the REAL staged binaries.
 *
 * Opt-in — it needs `desktop/embedded/` to have been built by
 * `scripts/build-embedded-{postgres,python}.ps1`, which is a ~950 MB tree that
 * is not in the repo. Run it with:
 *
 *     cd desktop
 *     STRIX_EMBEDDED_INTEGRATION=1 npx vitest run src/main/embedded/embeddedStack.integration
 *
 * WHY IT EXISTS. The unit tests around this slice all stop at the process
 * boundary, and the two worst bugs found while building it both lived exactly
 * there and were invisible to every one of them:
 *
 *  * the `initdb` password file was written INSIDE the data directory, so
 *    `initdb` refused ("directory exists but is not empty") on every machine,
 *    every launch — a 100 % first-boot failure;
 *  * `alembic upgrade` ran on a thread that already owned an event loop, which
 *    `migrations/env.py` cannot tolerate.
 *
 * A hand-written smoke script did not catch the first one, because the script
 * re-implemented the steps instead of calling this code. So this calls this
 * code.
 *
 * WHAT IT PROVES NOW. The packaged boot is split: {@link prepareEmbeddedStack}
 * picks a port + builds the env, {@link startEmbeddedCluster} brings PostgreSQL
 * up, and the schema migration runs IN THE ENGINE PROCESS (api/boot_migration.py).
 * This test drives the two boot phases on the real binaries and then runs the
 * SAME migrator the engine calls — through its `migrate.py` CLI (kept for dev/CI)
 * against the started cluster — to prove the whole chain (initdb → PostGIS → PROJ
 * grids → Alembic head) on the bundled interpreter.
 *
 * Safe to run while the app is in use: its own temporary user-data directory,
 * an OS-assigned ephemeral port, no Electron, no window, and it never touches
 * :8765 (the dev backend's port) or the developer's real profile.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import {
  prepareEmbeddedStack,
  startEmbeddedCluster,
  type EmbeddedStackPrep,
} from './embeddedStack'
import { resolveEmbeddedLayout } from './embeddedPaths'
import { stopCluster, type RunningCluster } from './postgresCluster'

/** The staging tree produced by the two build-embedded-* scripts. */
const RESOURCES = resolve(__dirname, '../../../embedded')

const STAGED = existsSync(join(RESOURCES, 'pgsql', 'bin', 'postgres.exe'))
const ENABLED = process.env.STRIX_EMBEDDED_INTEGRATION === '1' && STAGED

/** Bring PostgreSQL up on the real binaries: prepare + cluster, no migration. */
async function bootCluster(
  userData: string,
  log: (line: string) => void,
): Promise<{ prep: EmbeddedStackPrep; cluster: RunningCluster; bootLog: string }> {
  const prepared = await prepareEmbeddedStack(RESOURCES, userData, log)
  if (!prepared.ok) {
    throw new Error(`prepare failed at ${prepared.failure.stage}: ${prepared.failure.message}`)
  }
  const cluster = await startEmbeddedCluster(prepared.prep, log)
  if (!cluster.ok) {
    throw new Error(`cluster boot failed at ${cluster.failure.stage}: ${cluster.failure.message}`)
  }
  return { prep: prepared.prep, cluster: cluster.cluster, bootLog: cluster.bootLog }
}

/**
 * Run the schema migration the way the engine now does — the same
 * ``DatabaseMigrator`` code, invoked through its CLI against the live cluster
 * with the prepared backend env (so ``DATABASE_URL`` + the pg_dump checkpoint
 * vars are set exactly as at runtime).
 */
function runMigrationCli(prep: EmbeddedStackPrep): void {
  execFileSync(prep.layout.pythonExe, ['-m', 'groundmodel.infrastructure.db.migrate'], {
    env: prep.backendEnv,
    timeout: 280_000,
    stdio: 'inherit',
  })
}

describe.skipIf(!ENABLED)('embedded stack — real binaries', () => {
  let userData: string
  let lines: string[]
  let prep: EmbeddedStackPrep | null = null
  let cluster: RunningCluster | null = null

  const log = (line: string): void => {
    lines.push(line)
  }

  beforeAll(() => {
    userData = mkdtempSync(join(tmpdir(), 'strix-embedded-'))
    lines = []
  })

  afterAll(() => {
    if (prep && cluster) stopCluster(prep.layout, cluster, log)
    rmSync(userData, { recursive: true, force: true })
  })

  it('brings an empty machine to a migrated database', async () => {
    const booted = await bootCluster(userData, log)
    prep = booted.prep
    cluster = booted.cluster

    // The boot log is the artefact a tester is asked to send back, so its
    // shape is part of the contract. The migration is no longer part of this
    // phase — it runs in the engine — so the cluster boot log ends at
    // await-postgres-ready.
    expect(booted.bootLog).toContain('resolve-paths')
    expect(booted.bootLog).toContain('init-cluster')
    expect(booted.bootLog).toContain('await-postgres-ready')
    expect(booted.bootLog).not.toContain('failed')

    // Then the engine's migrator (via its CLI) takes the empty cluster to head.
    runMigrationCli(booted.prep)

    // eslint-disable-next-line no-console
    console.log(`\n--- FIRST BOOT ---\n${booted.bootLog}\n`)
  }, 300_000)

  it('put the cluster under the user profile and nothing under the install dir', () => {
    const layout = resolveEmbeddedLayout(RESOURCES, userData)

    expect(existsSync(join(layout.dataDir, 'PG_VERSION'))).toBe(true)
    expect(existsSync(layout.credentialsFile)).toBe(true)
    // The transient initdb password file must never be left behind.
    expect(existsSync(layout.initPasswordFile)).toBe(false)
  })

  it('reports the schema at head with PostGIS installed', () => {
    const layout = resolveEmbeddedLayout(RESOURCES, userData)
    const psql = join(layout.pgsqlRoot, 'bin', 'psql.exe')
    const secrets = JSON.parse(readFileSync(layout.credentialsFile, 'utf8')) as {
      user: string
      password: string
      database: string
    }

    const query = (sql: string): string =>
      execFileSync(
        psql,
        ['-h', '127.0.0.1', '-p', String(prep?.port), '-U', secrets.user, '-d', secrets.database, '-t', '-A', '-c', sql],
        { encoding: 'utf8', env: { ...process.env, PGPASSWORD: secrets.password } },
      ).trim()

    expect(query('select postgis_version()')).toContain('USE_PROJ=1')
    // A real Lambert72 reprojection — proves the PROJ grids shipped and work
    // with no network, which is the whole point of keeping them.
    expect(query('select round(ST_X(ST_Transform(ST_SetSRID(ST_MakePoint(4.35,51.22),4326),31370)))')).toBe('148689')
    expect(Number(query("select count(*) from information_schema.tables where table_schema='public'"))).toBeGreaterThan(30)
    expect(query('select count(*) from alembic_version')).toBe('1')
  })

  it('skips initdb on the next launch and keeps the data', async () => {
    if (prep && cluster) stopCluster(prep.layout, cluster, log)
    prep = null
    cluster = null
    lines = []

    const booted = await bootCluster(userData, log)
    prep = booted.prep
    cluster = booted.cluster

    expect(booted.bootLog).toContain('data directory already initialised')

    // eslint-disable-next-line no-console
    console.log(`\n--- SECOND BOOT ---\n${booted.bootLog}\n`)
  }, 300_000)
})

describe.skipIf(!ENABLED)('embedded stack — a first launch that died part-way', () => {
  let userData: string

  beforeAll(() => {
    userData = mkdtempSync(join(tmpdir(), 'strix-embedded-broken-'))
  })

  afterAll(() => {
    rmSync(userData, { recursive: true, force: true })
  })

  // The exact state a killed first launch leaves behind. Before this was
  // handled, initdb refused the non-empty directory on every subsequent
  // start and the app was bricked for good.
  it('recovers instead of failing forever', async () => {
    const layout = resolveEmbeddedLayout(RESOURCES, userData)
    mkdirSync(layout.dataDir, { recursive: true })
    writeFileSync(join(layout.dataDir, 'leftover.tmp'), 'debris from a killed initdb')

    const booted = await bootCluster(userData, line => void line)
    stopCluster(booted.prep.layout, booted.cluster, line => void line)

    expect(booted.bootLog).toContain('unfinished first launch')
    expect(existsSync(join(layout.dataDir, 'PG_VERSION'))).toBe(true)
  }, 300_000)
})
