/**
 * Lifecycle of the bundled PostgreSQL server: initialise, start, wait, stop.
 *
 * The I/O half of the embedded stack. Everything decidable without touching
 * the disk lives in the sibling pure modules (paths, port, credentials, DSN)
 * and is unit-tested there; what remains here is process spawning, which is
 * verified by actually installing the app and booting it.
 *
 * @module main/embedded/postgresCluster
 */

import { spawn, spawnSync, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { EmbeddedLayout } from './embeddedPaths'
import type { InstallSecrets } from './installSecrets'

/** How long to wait for the server to accept connections, in milliseconds. */
const READY_TIMEOUT_MS = 60_000

/** Gap between readiness probes, in milliseconds. */
const READY_POLL_MS = 250

/**
 * A running server.
 */
export interface RunningCluster {
  process: ChildProcess
  port: number
  /**
   * Why the server died or never started, once that is known.
   *
   * Populated asynchronously — see {@link startCluster} — so that
   * {@link awaitClusterReady} can fail immediately and by name instead of
   * polling a process that is never coming back.
   */
  failure: string | null
}

/** Where log lines from this module go. */
export type LogLine = (line: string) => void

/** What {@link initialiseCluster} did. */
export type ClusterInitOutcome = 'reused' | 'created' | 'recovered'

/**
 * Create the data directory if this is the first launch.
 *
 * Three cases, all first-class — the third is the one that matters:
 *
 *  * ``PG_VERSION`` present → a finished cluster, reuse it.
 *  * nothing there → initialise.
 *  * something there but no ``PG_VERSION`` → a first launch that died
 *    part-way. ``initdb`` refuses any non-empty target, so leaving it would
 *    brick every subsequent start with the same error. The remains are moved
 *    aside rather than deleted: they were never a working cluster so there is
 *    no data to lose, but an unexplained directory is not ours to destroy,
 *    and keeping it makes the failure diagnosable.
 *
 * @param layout - Resolved install paths.
 * @param credentials - The role and password to initialise the cluster with.
 * @param log - Log sink.
 * @returns Which of the three cases applied.
 * @throws Error If the remains cannot be moved aside, or ``initdb`` fails.
 */
export function initialiseCluster(
  layout: EmbeddedLayout,
  credentials: InstallSecrets,
  log: LogLine,
): ClusterInitOutcome {
  // PG_VERSION is written last by initdb, so its presence means the previous
  // run finished.
  if (existsSync(join(layout.dataDir, 'PG_VERSION'))) return 'reused'

  let outcome: ClusterInitOutcome = 'created'
  if (existsSync(layout.dataDir)) {
    const asideDir = `${layout.dataDir}.incomplete-${Date.now()}`
    log(
      `[pg] ${layout.dataDir} exists but has no PG_VERSION — a previous first ` +
        `launch did not finish. Moving it to ${asideDir} and starting over.`,
    )
    try {
      renameSync(layout.dataDir, asideDir)
    } catch (error) {
      throw new Error(
        `could not move the incomplete data directory ${layout.dataDir} aside: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          'Close any other copy of StrixGeo and try again, or delete that ' +
          'folder by hand.',
      )
    }
    outcome = 'recovered'
  }
  mkdirSync(layout.dataDir, { recursive: true })

  // OUTSIDE the data directory — see EmbeddedLayout.initPasswordFile. A file
  // rather than an argument, because command lines are readable by any
  // process on the machine.
  const passwordFile = layout.initPasswordFile
  writeFileSync(passwordFile, credentials.password, { encoding: 'utf8' })

  log(`[pg] initialising cluster at ${layout.dataDir}`)
  const result = spawnSync(
    layout.initdbExe,
    [
      '-D', layout.dataDir,
      '-U', credentials.user,
      '--pwfile', passwordFile,
      // Explicit UTF-8 + C collation. The default is taken from the Windows
      // account locale, which on a non-English machine produces a cluster
      // whose sort order differs from every other install and, on profiles
      // with non-ASCII characters, an initdb that fails outright.
      '-E', 'UTF8',
      '--locale=C',
      // Password auth over loopback TCP. Local (named-pipe) connections do
      // not exist on Windows, so this is the only path in.
      '--auth-host=scram-sha-256',
      '--auth-local=trust',
    ],
    { encoding: 'utf8' },
  )
  rmSync(passwordFile, { force: true })

  // `error` means initdb never ran at all (missing, blocked by antivirus,
  // wrong architecture). Reported separately because in that case `status` is
  // null and stdout/stderr are empty, so the generic message below would say
  // "exited with code null:" and throw the real reason away.
  if (result.error) {
    throw new Error(`initdb could not be started: ${result.error.message}`)
  }
  if (result.status !== 0) {
    throw new Error(
      `initdb exited with code ${result.status}: ` +
        `${(result.stderr || result.stdout || '').trim().slice(0, 500)}`,
    )
  }
  log('[pg] cluster initialised')
  return outcome
}

/**
 * Stop any server still holding the data directory.
 *
 * Called before every start. An Electron process killed from Task Manager
 * leaves its ``postgres.exe`` running and owning the data directory, and the
 * next launch would fail to start with a message about another server — a
 * dead end for a non-technical tester. Failure here is expected and ignored:
 * the normal case is that nothing is running.
 *
 * @param layout - Resolved install paths.
 * @param log - Log sink.
 */
export function stopOrphanedCluster(layout: EmbeddedLayout, log: LogLine): void {
  if (!existsSync(join(layout.dataDir, 'postmaster.pid'))) return
  log('[pg] a postmaster.pid is present — stopping whatever owns the data directory')
  const result = spawnSync(
    join(layout.pgsqlRoot, 'bin', 'pg_ctl.exe'),
    ['stop', '-D', layout.dataDir, '-m', 'immediate', '-w', '-t', '20'],
    { encoding: 'utf8' },
  )
  log(`[pg] orphan stop returned ${result.status} (a failure here is normal on a clean start)`)
}

/**
 * Spawn the server.
 *
 * @param layout - Resolved install paths.
 * @param port - The TCP port to listen on.
 * @param log - Log sink; receives the server's own stdout and stderr.
 * @returns The running server.
 */
export function startCluster(layout: EmbeddedLayout, port: number, log: LogLine): RunningCluster {
  log(`[pg] starting postgres on 127.0.0.1:${port}`)
  const child = spawn(
    layout.postgresExe,
    [
      '-D', layout.dataDir,
      '-p', String(port),
      // Loopback only. The database holds every project the engineer has
      // imported and there is no reason for it to be reachable from the LAN
      // (the same reasoning that moved docker-compose to a 127.0.0.1 bind).
      '-c', 'listen_addresses=127.0.0.1',
      // Keep the server's log on our pipe instead of a rotating file inside
      // the data directory, so everything about a launch is in one place.
      '-c', 'logging_collector=off',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  const cluster: RunningCluster = { process: child, port, failure: null }

  // Whatever the server says on the way down is the only explanation there
  // will be, so keep the tail rather than only streaming it.
  let tail = ''
  const capture = (d: Buffer): void => {
    const text = d.toString()
    log(`[pg] ${text.trimEnd()}`)
    tail = `${tail}${text}`.slice(-1000)
  }
  child.stdout?.on('data', capture)
  child.stderr?.on('data', capture)

  // MANDATORY, not defensive. Node reports "the executable could not be
  // launched at all" as an asynchronous 'error' event; with no listener it
  // becomes an uncaughtException on the next tick, which is OUTSIDE the
  // try/catch around the boot sequence. The stage would stay open, the boot
  // log would truncate mid-way, and the user would get the generic
  // "unexpected error" box instead of the one naming what failed.
  //
  // The case is real: the distribution decision doc lists antivirus
  // quarantining postgres.exe as an expected failure on a clean machine, and
  // that is exactly this event.
  child.on('error', error => {
    cluster.failure = `the database server could not be started: ${error.message}`
    log(`[pg] ${cluster.failure}`)
  })

  // A server that starts and then exits (a corrupt data directory, a port
  // taken between the probe and the bind) is the same problem for the caller.
  child.on('exit', (code, signal) => {
    if (cluster.failure !== null) return
    cluster.failure =
      `the database server stopped unexpectedly (code ${code}, signal ${signal})` +
      `${tail.trim() ? `: ${tail.trim().slice(-400)}` : ''}`
    log(`[pg] ${cluster.failure}`)
  })

  return cluster
}

/**
 * Poll until the server accepts connections.
 *
 * Uses the bundled ``pg_isready`` rather than a bare TCP connect: a bound
 * port only proves the process started, while ``pg_isready`` completes a
 * startup packet and so also covers the window where the server is bound but
 * still replaying WAL after an unclean shutdown.
 *
 * @param layout - Resolved install paths.
 * @param port - The port the server was started on.
 * @param log - Log sink.
 * @param timeoutMs - Give up after this long. Defaults to 60 s.
 * @throws Error If the server is not ready before the timeout.
 */
export async function awaitClusterReady(
  layout: EmbeddedLayout,
  cluster: RunningCluster,
  log: LogLine,
  timeoutMs: number = READY_TIMEOUT_MS,
): Promise<void> {
  const { port } = cluster
  const pgIsReady = join(layout.pgsqlRoot, 'bin', 'pg_isready.exe')
  const deadline = Date.now() + timeoutMs
  let lastStatus: number | null = null

  while (Date.now() < deadline) {
    // Checked first and every iteration: a server that failed to launch is
    // never going to answer, and waiting out the full minute to say so both
    // wastes the user's time and reports the wrong thing.
    if (cluster.failure !== null) throw new Error(cluster.failure)

    const result = spawnSync(pgIsReady, ['-h', '127.0.0.1', '-p', String(port), '-t', '2'], {
      encoding: 'utf8',
    })
    if (result.status === 0) {
      log(`[pg] server is accepting connections on :${port}`)
      return
    }
    // `error` is set when pg_isready itself could not be launched, which is a
    // broken installation rather than a server that is still starting.
    if (result.error) {
      throw new Error(`could not run pg_isready: ${result.error.message}`)
    }
    lastStatus = result.status
    await new Promise(resolve => setTimeout(resolve, READY_POLL_MS))
  }
  if (cluster.failure !== null) throw new Error(cluster.failure)
  throw new Error(
    `the database did not accept connections on 127.0.0.1:${port} within ` +
      `${Math.round(timeoutMs / 1000)}s (last pg_isready status ${lastStatus})`,
  )
}

/**
 * Shut the server down cleanly.
 *
 * ``child.kill()`` on Windows is ``TerminateProcess`` — the server would never
 * checkpoint and the next launch would start with crash recovery. ``pg_ctl
 * stop -m fast`` disconnects clients and checkpoints properly; the kill stays
 * as the fallback for a server that will not go.
 *
 * @param layout - Resolved install paths.
 * @param cluster - The running server, if any.
 * @param log - Log sink.
 */
export function stopCluster(
  layout: EmbeddedLayout,
  cluster: RunningCluster | null,
  log: LogLine,
): void {
  log('[pg] stopping')
  const result = spawnSync(
    join(layout.pgsqlRoot, 'bin', 'pg_ctl.exe'),
    ['stop', '-D', layout.dataDir, '-m', 'fast', '-w', '-t', '30'],
    { encoding: 'utf8' },
  )
  if (result.status !== 0) {
    log(`[pg] pg_ctl stop returned ${result.status} — killing the process`)
    cluster?.process.kill()
    return
  }
  log('[pg] stopped cleanly')
}
