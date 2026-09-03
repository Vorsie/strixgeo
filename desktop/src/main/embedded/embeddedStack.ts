/**
 * Boot the packaged app's own database — the whole of it, in order.
 *
 * A dev session finds PostgreSQL already running in Docker on :5433. A
 * packaged build finds nothing, so before the window can open it has to pick a
 * free port, create a database cluster (first launch only), start the server,
 * wait for it, and bring an empty schema to head. Six steps, each of which can
 * fail on a machine with no terminal in front of someone who cannot read a
 * stack trace — which is why every one of them is recorded through
 * {@link BootSequence} and a failure names the step.
 *
 * **This module runs in the packaged app only.** ``index.ts`` calls it behind
 * ``app.isPackaged``; a dev session never reaches it and keeps talking to
 * Docker exactly as before.
 *
 * @module main/embedded/embeddedStack
 */

import { spawn } from 'child_process'
import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BootSequence, type BootFailure } from './bootSequence'
import { resolveEmbeddedLayout, type EmbeddedLayout } from './embeddedPaths'
import { acquireFreePort, probeEphemeralPort } from './freePort'
import { loadOrCreateSecrets, type InstallSecrets } from './installSecrets'
import { buildSqlAlchemyDsn, redactPasswords } from './pgDsn'
import {
  awaitClusterReady,
  initialiseCluster,
  startCluster,
  stopCluster,
  stopOrphanedCluster,
  type LogLine,
  type RunningCluster,
} from './postgresCluster'

/**
 * Fixed floor for how long the migration step may take before it is called
 * failed. The real ceiling is this plus a per-gigabyte allowance (see
 * {@link migrationTimeoutMs}) — a fixed 180 s killed a legitimately slow
 * migration on a large store and retried it on every launch (audit M8).
 */
export const BASE_MIGRATION_TIMEOUT_MS = 180_000

/** Extra migration headroom granted per whole gigabyte of data-directory size. */
export const MIGRATION_TIMEOUT_PER_GB_MS = 60_000

/** One gibibyte, in bytes — the unit {@link migrationTimeoutMs} scales by. */
const BYTES_PER_GB = 1024 * 1024 * 1024

/**
 * The migration timeout for a data directory of ``dataDirBytes`` bytes.
 *
 * A larger store legitimately takes longer to migrate (index rebuilds, table
 * rewrites), so the timeout is {@link BASE_MIGRATION_TIMEOUT_MS} plus
 * {@link MIGRATION_TIMEOUT_PER_GB_MS} per whole gigabyte. Never below the base.
 *
 * @param dataDirBytes - Total size of the PostgreSQL data directory.
 * @returns The timeout in milliseconds.
 */
export function migrationTimeoutMs(dataDirBytes: number): number {
  const wholeGb = Math.max(0, Math.floor(dataDirBytes / BYTES_PER_GB))
  return BASE_MIGRATION_TIMEOUT_MS + wholeGb * MIGRATION_TIMEOUT_PER_GB_MS
}

/**
 * Total size, in bytes, of every file under ``dir`` (recursive).
 *
 * Best-effort and never throws: a vanished or unreadable entry contributes 0
 * rather than aborting the walk, because this only sizes a timeout — an
 * approximate answer is fine and a thrown error here must never block boot.
 * Uses ``stat`` (metadata only, no reads), so it is cheap even on a multi-GB
 * cluster.
 *
 * @param dir - Directory to size.
 * @returns The summed byte size, or 0 when ``dir`` is missing/unreadable.
 */
export function directorySizeBytes(dir: string): number {
  let total = 0
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return 0
  }
  for (const name of entries) {
    const path = join(dir, name)
    try {
      const info = statSync(path)
      if (info.isDirectory()) total += directorySizeBytes(path)
      else total += info.size
    } catch {
      /* vanished/locked entry — contribute nothing */
    }
  }
  return total
}

/** A booted embedded stack, ready for the backend to be started against it. */
export interface EmbeddedStack {
  /** The port PostgreSQL ended up on. */
  port: number
  /** The bundled interpreter to run the backend with. */
  pythonExe: string
  /** Environment the backend child must inherit. */
  backendEnv: NodeJS.ProcessEnv
  /** Shut the database down cleanly. Safe to call more than once. */
  stop: () => void
}

/** Either a booted stack or the step that stopped it. */
export type EmbeddedStartResult =
  | { ok: true; stack: EmbeddedStack; bootLog: string }
  | { ok: false; failure: BootFailure }

/**
 * Start the bundled database and bring its schema to head.
 *
 * @param resourcesPath - Electron's ``process.resourcesPath``.
 * @param userDataPath - Electron's ``app.getPath('userData')``.
 * @param log - Log sink; in a packaged build this is the backend log file.
 * @returns The booted stack plus its boot log, or the failure that stopped it.
 *   Failures are returned rather than thrown so the caller cannot accidentally
 *   lose the stage attribution that makes them useful.
 */
export async function startEmbeddedStack(
  resourcesPath: string,
  userDataPath: string,
  log: LogLine,
): Promise<EmbeddedStartResult> {
  const boot = new BootSequence()
  let cluster: RunningCluster | null = null
  let layout: EmbeddedLayout | null = null

  try {
    boot.begin('resolve-paths')
    layout = resolveEmbeddedLayout(resourcesPath, userDataPath)
    assertBundledFilesPresent(layout)
    boot.succeed(layout.pgsqlRoot)

    // Its own stage rather than part of the one above: an unreadable secrets
    // file is a completely different problem from a broken install, and the
    // dialog says which.
    boot.begin('load-secrets')
    const secrets = loadOrCreateSecrets(
      secretsFileIo(layout.credentialsFile),
      layout.credentialsFile,
      size => randomBytes(size),
    )
    boot.succeed()

    boot.begin('acquire-port')
    const port = await acquireFreePort(probeEphemeralPort, new Set())
    boot.succeed(`port ${port}`)

    boot.begin('init-cluster')
    const outcome = initialiseCluster(layout, secrets, log)
    if (outcome === 'reused') boot.skip('data directory already initialised')
    else if (outcome === 'recovered') boot.succeed('re-created after an unfinished first launch')
    else boot.succeed('created')

    boot.begin('start-postgres')
    stopOrphanedCluster(layout, log)
    cluster = startCluster(layout, port, log)
    boot.succeed()

    boot.begin('await-postgres-ready')
    await awaitClusterReady(layout, cluster, log)
    boot.succeed()

    boot.begin('run-migrations')
    const databaseUrl = buildSqlAlchemyDsn({
      host: '127.0.0.1',
      port,
      user: secrets.user,
      password: secrets.password,
      database: secrets.database,
    })
    const backendEnv = buildBackendEnv(layout, userDataPath, databaseUrl, secrets)
    await runMigrations(layout, backendEnv, log)
    boot.succeed()

    log(boot.format())
    // Re-bound to consts so the shutdown closure captures values TypeScript
    // has already narrowed, rather than the mutable outer bindings the catch
    // block needs (which are, and must stay, nullable).
    const started = cluster
    const resolved = layout
    return {
      ok: true,
      bootLog: boot.format(),
      stack: {
        port,
        pythonExe: layout.pythonExe,
        backendEnv,
        stop: () => stopCluster(resolved, started, log),
      },
    }
  } catch (error) {
    // Redacted here, at the single point where a message becomes user-facing:
    // the text below is shown in a dialog and written to a log the user is
    // asked to send back.
    const failure = boot.fail(
      redactPasswords(error instanceof Error ? error.message : String(error)),
    )
    log(failure.log)
    // A cluster started before the failing step keeps the data directory
    // locked and would block the next launch too.
    if (layout && cluster) stopCluster(layout, cluster, log)
    return { ok: false, failure }
  }
}

/**
 * Fail early and by name when a bundled file is missing.
 *
 * Without this, a packaging mistake surfaces as ``spawn ENOENT`` from whichever
 * step happens to run first, which names nothing useful.
 */
function assertBundledFilesPresent(layout: EmbeddedLayout): void {
  const required: Array<[string, string]> = [
    ['the database server', layout.postgresExe],
    ['the database initialiser', layout.initdbExe],
    ['the Python runtime', layout.pythonExe],
    ['the backend source', join(layout.backendSrcDir, 'groundmodel')],
    // Sentinel for the native-compilation step: the engine + parsers ship as
    // compiled .pyd (scripts/compile-backend-natives.ps1), never as .py. If a
    // stage skipped compilation this file is absent, and the app fails by name
    // at boot rather than shipping the readable source it was meant to hide.
    [
      'the compiled engine',
      join(
        layout.backendSrcDir,
        'groundmodel',
        'domain',
        'services',
        'voxel_litho',
        'label_voxels.cp311-win_amd64.pyd',
      ),
    ],
  ]
  for (const [what, path] of required) {
    if (!existsSync(path)) {
      throw new Error(`${what} is missing from this installation: ${path}`)
    }
  }
}

/** Read/write the secrets file, creating its directory on first launch. */
function secretsFileIo(path: string): { read: () => string | null; write: (t: string) => void } {
  return {
    read: () => (existsSync(path) ? readFileSync(path, 'utf8') : null),
    write: text => {
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, text, { encoding: 'utf8' })
    },
  }
}

/**
 * Where the numba compile cache is rooted, when it has been moved off the
 * Roaming profile (audit M1).
 *
 * ``null`` (the default) keeps it under ``userDataPath`` — the original
 * behaviour, and what dev, e2e and isolated runs want. ``index.ts`` sets this to
 * ``%LOCALAPPDATA%\StrixGeo`` on a packaged launch, alongside the pgdata move, so
 * the rebuildable cache is not churn on a synced/redirected Roaming profile. Set
 * once at startup, before the backend env is built, exactly like
 * ``configurePgdataRoot``.
 */
let configuredNumbaCacheRoot: string | null = null

/**
 * Point the numba compile cache at a machine-local root (or clear the override).
 *
 * @param root - The directory to root ``numba-cache`` under, or ``null`` to keep
 *   it under ``userDataPath`` (the default / dev behaviour).
 */
export function configureNumbaCacheRoot(root: string | null): void {
  configuredNumbaCacheRoot = root
}

/**
 * Build the environment both Python children inherit.
 *
 * Exported so the numba-cache location is unit-testable without booting a
 * cluster; it is otherwise an internal step of {@link startEmbeddedStack}.
 *
 * @param layout - Resolved install paths.
 * @param userDataPath - Per-user writable root.
 * @param databaseUrl - The DSN for the freshly started cluster.
 * @param secrets - This install's generated secrets.
 * @returns The child environment.
 */
export function buildBackendEnv(
  layout: EmbeddedLayout,
  userDataPath: string,
  databaseUrl: string,
  secrets: InstallSecrets,
): NodeJS.ProcessEnv {
  // numba's @njit(cache=True) writes its compiled kernels next to the source
  // it compiled. The source ships under the install directory, which is
  // read-only for a normal account — so without a writable cache dir the
  // voxel mesh kernel recompiles on every single launch (the 38.6x speed-up
  // that justified taking numba as a dependency is a CACHED-compile win).
  // Rooted under the machine-local root when one is configured (audit M1) — a
  // rebuildable cache is pure churn on a synced Roaming profile — else under
  // the (Roaming) user profile, which is the dev / e2e default.
  const numbaCacheDir = join(configuredNumbaCacheRoot ?? userDataPath, 'numba-cache')
  mkdirSync(numbaCacheDir, { recursive: true })

  return {
    ...process.env,
    // The backend ships as source rather than as an installed wheel, so the
    // interpreter is pointed at it rather than finding it on sys.path.
    PYTHONPATH: layout.backendSrcDir,
    DATABASE_URL: databaseUrl,
    // Generated per install: a packaged build runs as production, and the
    // backend refuses to start on the shipped default key.
    SECRET_KEY: secrets.secretKey,
    ENVIRONMENT: 'production',
    // Windows still defaults stdio to the ANSI code page; the backend logs
    // Dutch DOV tokens and project names that are not representable there.
    PYTHONUTF8: '1',
    NUMBA_CACHE_DIR: numbaCacheDir,
    // Pre-migration checkpoint (database_migrator.py): the bundled pg_dump and a
    // machine-local backups directory; without both the migrator skips the dump.
    STRIX_PG_DUMP_PATH: join(layout.pgsqlRoot, 'bin', 'pg_dump.exe'),
    STRIX_BACKUP_DIR: join(configuredNumbaCacheRoot ?? userDataPath, 'backups'),
    // matplotlib renders report figures head-less. Without this it probes for
    // an interactive backend and can pick TkAgg, which needs a display.
    MPLBACKEND: 'Agg',
  }
}

/**
 * Run the schema migration to completion.
 *
 * The timeout scales with the data-directory size (see
 * {@link migrationTimeoutMs}) so a legitimately slow migration on a large store
 * is not killed and retried every launch; the failure copy names the timeout
 * actually used (audit M8).
 *
 * @throws Error If the migrator exits non-zero, cannot be spawned, or does not
 *   finish inside the scaled timeout.
 */
function runMigrations(
  layout: EmbeddedLayout,
  env: NodeJS.ProcessEnv,
  log: LogLine,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutMs = migrationTimeoutMs(directorySizeBytes(layout.dataDir))
    log(`[migrate] bringing the database schema to head (timeout ${Math.round(timeoutMs / 1000)}s)`)
    const child = spawn(layout.pythonExe, ['-m', 'groundmodel.infrastructure.db.migrate'], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    // The migrator's own last line is what a failure report needs to quote,
    // so keep the tail rather than only streaming it to the log.
    let tail = ''
    const capture = (d: Buffer): void => {
      // The migrator logs its resolved DSN; SQLAlchemy quotes the whole URL on
      // a parse error. Both land in the log and the second lands in a dialog.
      const text = redactPasswords(d.toString())
      log(`[migrate] ${text.trimEnd()}`)
      tail = `${tail}${text}`.slice(-2000)
    }
    child.stdout?.on('data', capture)
    child.stderr?.on('data', capture)

    const timer = setTimeout(() => {
      child.kill()
      reject(
        new Error(
          `the migration did not finish within ${Math.round(timeoutMs / 1000)}s ` +
            `(scaled to the size of the database)`,
        ),
      )
    }, timeoutMs)

    child.on('error', err => {
      clearTimeout(timer)
      reject(new Error(`could not run the migrator: ${err.message}`))
    })
    child.on('exit', code => {
      clearTimeout(timer)
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`the migrator exited with code ${code}: ${tail.trim().slice(-500)}`))
    })
  })
}
