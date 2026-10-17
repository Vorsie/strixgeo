/**
 * Boot the packaged app's own database — the fast preparation and the cluster.
 *
 * A dev session finds PostgreSQL already running in Docker on :5433. A packaged
 * build finds nothing, so before the engine can talk to a database it has to
 * pick a free port, create a database cluster (first launch only), start the
 * server, and wait for it. Each of those can fail on a machine with no terminal
 * in front of someone who cannot read a stack trace — which is why every step is
 * recorded through {@link BootSequence} and a failure names the step.
 *
 * The boot is split into two phases so the engine's cold import can OVERLAP the
 * database coming up (owner report, installer #13 — the two ran in series):
 *
 *  * {@link prepareEmbeddedStack} — the fast part (resolve paths, secrets, port,
 *    backend env). Returns as soon as the port is known, so the engine can be
 *    spawned against it.
 *  * {@link startEmbeddedCluster} — init-cluster, start-postgres,
 *    await-postgres-ready. Runs CONCURRENTLY with the engine's cold import.
 *
 * **This module runs in the packaged app only.** ``index.ts`` calls it behind
 * ``app.isPackaged``; a dev session never reaches it and keeps talking to Docker.
 * The schema migration is no longer run here — the engine brings the database to
 * head in its own process at the start of the FastAPI lifespan (see
 * ``groundmodel/api/boot_migration.py``), gated on the ``STRIX_ENGINE_MIGRATE``
 * env this module sets in {@link buildBackendEnv}.
 *
 * @module main/embedded/embeddedStack
 */

import { randomBytes } from 'crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { BootSequence, type BootFailure } from './bootSequence'
import { resolveEmbeddedLayout, type EmbeddedLayout } from './embeddedPaths'
import { chooseApiPort, describeApiPortChoice, isLoopbackPortFree } from './apiPort'
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

/** A booted embedded stack, ready for the backend to be started against it. */
export interface EmbeddedStack {
  /** The port PostgreSQL ended up on. */
  port: number
  /** The loopback port the engine listens on (8765 when it was free). */
  apiPort: number
  /** The bundled interpreter to run the backend with. */
  pythonExe: string
  /** Environment the backend child must inherit. */
  backendEnv: NodeJS.ProcessEnv
  /**
   * Ask PostgreSQL to stop with a fast checkpoint, waiting at most ``graceMs``.
   * Returns true when it confirmed stopped (no WAL replay next boot), false when
   * it did not stop in time. Idempotent; returns true when nothing is running.
   */
  stopClean: (graceMs: number) => boolean
  /**
   * Force PostgreSQL's whole process tree down (the fallback / crash path).
   * Idempotent; a no-op when nothing is running.
   */
  forceStop: () => void
}

/**
 * The fast-phase result: everything needed to spawn the engine, plus the
 * in-progress boot log so {@link startEmbeddedCluster} can continue it.
 */
export interface EmbeddedStackPrep {
  /** Resolved install layout (paths to the bundled trees + the data dir). */
  layout: EmbeddedLayout
  /** This install's generated secrets. */
  secrets: InstallSecrets
  /** The free TCP port PostgreSQL will bind. */
  port: number
  /**
   * The free loopback port the engine will bind: 8765 when free, else the next
   * free one, else an OS-assigned one (./apiPort; tester finding 2026-10-12).
   */
  apiPort: number
  /** The SQLAlchemy-form DSN for the freshly picked port. */
  databaseUrl: string
  /** The environment both Python children inherit (incl. ``STRIX_ENGINE_MIGRATE``). */
  backendEnv: NodeJS.ProcessEnv
  /** The boot log recorder, carried through into the cluster phase. */
  boot: BootSequence
}

/** Either a prepared stack or the step that stopped it. */
export type PrepareEmbeddedResult =
  | { ok: true; prep: EmbeddedStackPrep }
  | { ok: false; failure: BootFailure }

/** Either a running cluster (plus the full boot log) or the step that stopped it. */
export type EmbeddedClusterResult =
  | { ok: true; cluster: RunningCluster; bootLog: string }
  | { ok: false; failure: BootFailure }

/**
 * Fast phase — resolve the install, read secrets, pick a port, build the env.
 *
 * Returns as soon as the port is known and the backend env is built, so the
 * engine can be spawned against the DSN while {@link startEmbeddedCluster} is
 * still bringing PostgreSQL up.
 *
 * @param resourcesPath - Electron's ``process.resourcesPath``.
 * @param userDataPath - Electron's ``app.getPath('userData')``.
 * @param log - Log sink; in a packaged build this is the backend log file.
 * @returns The prepared stack, or the failure that stopped it. Failures are
 *   returned rather than thrown so the caller cannot lose the stage attribution.
 */
export async function prepareEmbeddedStack(
  resourcesPath: string,
  userDataPath: string,
  log: LogLine,
): Promise<PrepareEmbeddedResult> {
  const boot = new BootSequence()
  try {
    boot.begin('resolve-paths')
    const layout = resolveEmbeddedLayout(resourcesPath, userDataPath)
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

    // Its own stage: another program on the PC may own 8765 (AnkiConnect and
    // several vendor tools use it), and a hard-coded engine port then dies on
    // bind with only a generic dialog. The Postgres port is excluded so the two
    // children never race for one number.
    boot.begin('acquire-api-port')
    const apiPortChoice = await chooseApiPort({
      isFree: isLoopbackPortFree,
      osAssigned: probeEphemeralPort,
      taken: new Set([port]),
    })
    const apiPort = apiPortChoice.port
    boot.succeed(describeApiPortChoice(apiPortChoice))

    const databaseUrl = buildSqlAlchemyDsn({
      host: '127.0.0.1',
      port,
      user: secrets.user,
      password: secrets.password,
      database: secrets.database,
    })
    const backendEnv = buildBackendEnv(layout, userDataPath, databaseUrl, secrets)

    return { ok: true, prep: { layout, secrets, port, apiPort, databaseUrl, backendEnv, boot } }
  } catch (error) {
    const failure = boot.fail(
      redactPasswords(error instanceof Error ? error.message : String(error)),
    )
    log(failure.log)
    return { ok: false, failure }
  }
}

/**
 * Cluster phase — initialise (first launch), start PostgreSQL, wait for it.
 *
 * Runs CONCURRENTLY with the engine's cold import: the engine has already been
 * spawned against ``prep.databaseUrl`` and is importing while this brings the
 * server up. The engine waits for and migrates the database itself, so no
 * migration runs here.
 *
 * @param prep - The prepared stack from {@link prepareEmbeddedStack}.
 * @param log - Log sink.
 * @returns The running cluster + the full boot log, or the failure that stopped
 *   it. A cluster started before a later failure is stopped so it does not lock
 *   the data directory against the next launch.
 */
export async function startEmbeddedCluster(
  prep: EmbeddedStackPrep,
  log: LogLine,
): Promise<EmbeddedClusterResult> {
  const { layout, secrets, port, boot } = prep
  let cluster: RunningCluster | null = null
  try {
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

    log(boot.format())
    return { ok: true, cluster, bootLog: boot.format() }
  } catch (error) {
    const failure = boot.fail(
      redactPasswords(error instanceof Error ? error.message : String(error)),
    )
    log(failure.log)
    // A cluster started before the failing step keeps the data directory locked
    // and would block the next launch too.
    if (cluster) stopCluster(layout, cluster, log)
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
 * cluster; it is otherwise an internal step of {@link prepareEmbeddedStack}.
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
    // The engine brings the schema to head IN ITS OWN PROCESS at the start of
    // the lifespan (api/boot_migration.py) — the packaged app no longer spawns a
    // separate migrate.py child. This flag is what turns that on; it is set only
    // here (the packaged/embedded path), so dev/CI/e2e keep external migrations.
    STRIX_ENGINE_MIGRATE: '1',
    // Pre-migration checkpoint (database_migrator.py): the bundled pg_dump and a
    // machine-local backups directory; without both the migrator skips the dump.
    STRIX_PG_DUMP_PATH: join(layout.pgsqlRoot, 'bin', 'pg_dump.exe'),
    STRIX_BACKUP_DIR: join(configuredNumbaCacheRoot ?? userDataPath, 'backups'),
    // matplotlib renders report figures head-less. Without this it probes for
    // an interactive backend and can pick TkAgg, which needs a display.
    MPLBACKEND: 'Agg',
  }
}
