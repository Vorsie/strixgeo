import { app, BrowserWindow, crashReporter, ipcMain, dialog, Menu, net, session, shell } from 'electron'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { spawn, ChildProcess } from 'child_process'
import {
  readFileSync,
  statSync,
  existsSync,
  mkdirSync,
  appendFileSync,
} from 'fs'
// Promise-based copy for the sample-install flow (fs.promises.copyFile).
import { copyFile } from 'fs/promises'

import { writeFileAtomic, writeFileAtomicKeepingGenerations } from './atomicWrite'
import {
  decodeStrix,
  encodeStrix,
  toStrixReadFailure,
  type ProjectReadResult,
} from './strixCodec'
import { evaluateBetaExpiry, type BetaVerdict } from './betaExpiry'
import { configureBetaExpiryStore, recordLaunch } from './betaExpiryStore'
import {
  buildDisplayInfo,
  compiledBuildProvenance,
  compiledBuildStamp,
  readBuildStamp,
  type BuildDisplayInfo,
} from './buildStamp'
import { buildCrashBundle } from './crashBundle'
import { readTransmissionConsent } from './diagnosticsConsent'
import {
  captureDiagnostic,
  configureDiagnosticsStore,
  diagnosticsBuildFacts,
  diagnosticsDirPath,
  readDiagnosticEvents,
} from './diagnosticsStore'
import { DiagnosticsUploader } from './diagnosticsUploader'
import { diagnosticsIdentityFor } from './diagnosticsPayload'
import { DIAGNOSTICS_QUEUE_DIR_NAME } from './diagnosticsUploaderConstants'
import { createRotatingAppender, rotateIfNeeded, realFsOps } from './logRotation'
import { registerSheetPdfIpc } from './sheetPdf'
import {
  LOCAL_CLIENT_TOKEN_ENV_VAR,
  LOCAL_CLIENT_TOKEN_HEADER,
  createTokenInjectionAudit,
  localApiRequestFilter,
  mintLocalClientToken,
} from './localClientToken'
import { QuitHandshake } from './quitHandshake'
import {
  consoleMethodForLevel,
  formatRendererMessage,
  shouldForwardRendererMessage,
} from './rendererConsoleForwarding'
import {
  configureRecoveryStore,
  declineRecovery,
  deleteDeclinedRecovery,
  deletePrimaryRecovery,
  deleteRecovery,
  listRecovery,
  readRecovery,
  writeRecovery,
  type RecoveryDescriptor,
} from './recoveryStore'
import { buildMenuTemplate } from './menuTemplate'
import { narrowMenuLanguage, type MenuLanguage } from './menuLabels'

import {
  buildContentSecurityPolicy,
  decideExternalOpen,
  isInAppNavigation,
  isValidRecentProjectEntry,
  normalizePathForCompare,
  rawBackendLogAffordanceEnabled,
  sanitizeSaveDialogDefault,
} from './security'
import { applyPackagedProfile } from './packagedProfile'
import { resolveMachineLocalStrixDir } from './machineLocalStores'
import { migratePgdata, realPgdataFsOps } from './pgdataMigration'
import {
  SAMPLE_INSTALL_DEFAULT_FILE_NAME,
  resolveSampleProjectPath,
} from './sampleProject'
import {
  prepareEmbeddedStack,
  startEmbeddedCluster,
  configureNumbaCacheRoot,
  type EmbeddedStack,
  type EmbeddedStackPrep,
} from './embedded/embeddedStack'
import { coordinatePackagedBoot } from './embedded/packagedBootCoordinator'
import { forceStopCluster, stopClusterClean, type RunningCluster } from './embedded/postgresCluster'
import { configurePgdataRoot } from './embedded/embeddedPaths'
import type { BootFailure } from './embedded/bootSequence'
import { crashActionFor, isBrokenPipe } from './mainCrashPolicy'
import { registerBackendLifecycle } from './backendLifecycle'
import { killProcessTreeSync } from './killProcessTree'
import { performShutdown, type ShutdownIo, type ShutdownMode } from './shutdownSequencer'
import { tailoredBootFailureCopy } from './bootFailureMessage'
import {
  backendProbeHeaders,
  classifyBackendProbe,
  type ProbeVerdict,
  backendReadyAttempts,
  BACKEND_READY_POLL_MS,
  readinessDeadlineResult,
} from './backendProbe'
import { decideExitAfterReady, BACKEND_RESPAWN_GUARD_MS } from './backendRespawnPolicy'
import { shouldReloadRendererAfterGone } from './rendererGonePolicy'
// Prototype slices (debt #3 / #6) — see docs/design/onboarding-activation-updater-proto.md.
import { configureActivationStore, readActivationState } from './activationStore'
import { ActivationService } from './activationService'
import { activationBlocksLaunch } from './activation'
import { activationBaseUrl, createActivationRepository } from './activationConfig'
import { chromiumFetch } from './chromiumFetch'
import { resolveDeviceIdentity } from './deviceIdentity'
import { e2eLaunchFlag, previewControlAllowed } from './prototypeFlags'
import { installE2eDialogStubs, installE2eShellStubs } from './e2eDialogs'
import { registerPrototypeIpc } from './prototypeIpc'
import { checkForUpdatesOnLaunch, configureUpdater } from './updaterService'

// FIRST userData-affecting statement in the process, deliberately ahead of the
// single-instance lock and every store — see packagedProfile.ts for why a
// packaged build must not share the dev profile. Dev: no-op. The %LOCALAPPDATA%
// argument moves the (large, churny) logs off the Roaming profile (M1); pgdata
// moves via the embedded layout below.
applyPackagedProfile(app, process.env.LOCALAPPDATA)

// Authorised filesystem paths (debt #37). Populated by:
//   * Every dialog.showOpen/showSave return value (the user just
//     picked the file in a Windows / macOS file picker — that's
//     their consent for us to read or write it).
//   * The recent-projects list at startup (paths the user
//     authorised in a prior session).
// fs:read-file / project:read-file / project:write-file all
// require the requested path to be in this set, defending against
// an XSS-escalated renderer from issuing arbitrary
// readFile('C:\\...\\AppData\\...\\key.db') calls.
const authorisedPaths = new Set<string>()

function authorisePath(p: string | null | undefined): void {
  const norm = normalizePathForCompare(p)
  if (norm !== null) authorisedPaths.add(norm)
}

function pathIsAuthorised(p: string): boolean {
  const norm = normalizePathForCompare(p)
  return norm !== null && authorisedPaths.has(norm)
}

// File extension for project files. Kept here (not imported from the
// renderer) so the main process is build-self-contained — Electron's
// ``out/main`` doesn't include the renderer source tree.
//
// ``.strix`` is the canonical extension; ``.gmproj`` is the legacy
// pre-rebrand extension that the open-dialog filter also accepts so
// users with old files can keep working. New saves always emit
// ``.strix``.
const PROJECT_FILE_EXTENSION = 'strix'
const PROJECT_FILE_OPEN_EXTENSIONS = ['strix', 'gmproj']

// File-size caps for the dialog-authorised read paths (debt #12).
// The API has its own 200 MiB upload cap, but Electron's main process
// reads the full bytes into a Buffer BEFORE handing them to the
// renderer / API, so a multi-gigabyte file would OOM the main thread
// regardless of any server-side limit. The caps below match the API's
// upload limits where applicable and apply a smaller cap to project
// files (typical .strix is a few MB; tens of MB for 500-CPT DOV
// imports — 500 MiB is generous headroom for "we got carried away").
const FS_READ_CAP_BYTES = 200 * 1024 * 1024 // mirrors API's _MAX_GEF_UPLOAD_BYTES
const PROJECT_READ_CAP_BYTES = 500 * 1024 * 1024 // bundle JSON ceiling

function assertFileSizeUnder(filePath: string, capBytes: number, label: string): void {
  // Use ``statSync`` instead of letting ``readFileSync`` swallow the
  // whole file — stat returns the on-disk size in O(1) so we can bail
  // BEFORE allocating a Buffer.
  const size = statSync(filePath).size
  if (size > capBytes) {
    throw new Error(
      `${label} refused — file ${filePath} (${size} bytes) exceeds ` +
        `the ${capBytes} byte cap. Files this large almost certainly ` +
        'indicate a malformed input or a corrupt save.',
    )
  }
}

// Recent-projects list — capped so the menu doesn't explode and we don't
// accidentally accumulate decade-old paths. List is ordered most-recent
// first; reopening a path moves it back to the head.
const RECENT_PROJECTS_MAX = 10
const RECENT_PROJECTS_FILENAME = 'recent-projects.json'

// Wraps a single recent-list entry. ``name`` is a snapshot for the menu —
// the actual project name might have drifted in the DB since the file was
// last opened, but the menu shows what we recorded at last-save time.
interface RecentProject {
  path: string
  name: string
  lastOpened: string  // ISO timestamp
}

const API_PORT = 8765
const API_BASE = `http://127.0.0.1:${API_PORT}`

// Secret shared with THIS launch's backend child, proving that a request
// claiming the ``null`` origin really comes from our window and not from a
// sandboxed iframe on some site the user has open (see ./localClientToken).
// Minted once at module load, before anything can spawn or fetch.
const localClientToken = mintLocalClientToken()

// Log rotation constants (#214c) — 5 MB max, 3 backup generations.
const LOG_MAX_BYTES = 5 * 1024 * 1024
const LOG_MAX_FILES = 3

let apiProcess: ChildProcess | null = null
// Readiness windows the current engine spawn has consumed. Reset per spawn so
// a respawn gets its own budget; bounded by BACKEND_READY_MAX_WINDOWS so a
// live-but-unreachable backend still reaches the boot-error screen.
let readinessWindowsUsed = 0

// Single-window app today; we cache the main window so menu rebuilds (after
// the recent-projects list changes) can target the right one without
// walking ``BrowserWindow.getAllWindows()``.
let mainWindow: BrowserWindow | null = null

// Interface language for the native menu bar. The renderer owns the real choice
// (localStorage ``groundmodel.language`` -> system -> English) and reports its
// resolved value over ``window:set-language`` on boot and on every Settings flip,
// which rebuilds the menu. This holds the last reported value; the first paint
// (before the renderer reports) is seeded from the OS locale at ``whenReady``.
let menuLanguage: MenuLanguage = 'en'

// Close-handshake state for the main window (see ./quitHandshake). Holds the
// "the user already confirmed the exit" flag that keeps programmatic
// ``app.quit()`` from re-triggering the close handler in a loop, plus the two
// escapes from a renderer that never answers.
//
// Replaced per window rather than kept for the app's lifetime: on macOS the
// app survives its last window, and a state carried over ("quit approved",
// "renderer gone") would make the NEXT window close without ever asking.
let quitHandshake = new QuitHandshake()

// Absolute path to the main log file. Set once in startApi (packaged) or
// left null in dev. Exposed to the main-process crash handlers so they can
// write a timestamped crash line even when no stream is open.
let mainLogPath: string | null = null

// The size-bounded appender for the main log (M8/L1). Set alongside mainLogPath
// in openMainLog; re-checks the file size every N appended bytes and rotates
// mid-session, so a long verbose run no longer grows backend.log past the cap
// until the next restart. Null in dev (writeMainLog falls back to the console).
let mainLogAppend: ((line: string) => void) | null = null

// Set by startApi after the ChildProcess is spawned. Called by the
// api:ready handler so the exit listener knows the backend started cleanly
// and a subsequent exit is a normal shutdown, not a startup crash.
let markBackendReady: (() => void) | null = null

// The bundled PostgreSQL, in packaged builds only (null in dev, where Docker
// on :5433 owns the database and none of this runs).
let embeddedStack: EmbeddedStack | null = null

// The running embedded cluster handle (packaged only). Set asynchronously by the
// cluster-boot phase, which runs CONCURRENTLY with the engine's cold import — so
// this can still be null while the engine is starting. ``embeddedStack.forceStop``
// closes over it, so a shutdown that races the boot stops whatever is up.
let embeddedCluster: RunningCluster | null = null

// When the backend was last respawned this session (H3(a)). A death within
// BACKEND_RESPAWN_GUARD_MS of this is a crash loop and gives up to the banner.
let lastBackendRespawnAtMs: number | null = null

// True while the shutdown sequence is deliberately killing the backend (a quit,
// or the uncaught-exception handler). The exit handler must NOT respawn or
// signal a failure for a death WE caused — otherwise quitting would spawn a
// lingering backend a second before the app exits (H3(a)). Reset when a fresh
// backend is spawned, so its later unintentional death is respawned normally.
let intentionalBackendStop = false

// Latched the moment the app begins quitting (window-all-closed, will-quit, a
// boot-failure quit, or a main-process crash). Guards ``runShutdown`` against
// running twice - a graceful quit fires window-all-closed AND will-quit - and
// tells ``startApi`` to STOP ACCEPTING NEW WORK: a respawn timer scheduled a
// second before the quit must not spawn a zombie engine the exit then orphans
// (owner ruling 2026-09-06 - "kill all lingering processes").
let shuttingDown = false

// Short delay before respawning a backend that died mid-session (H3(a)) — long
// enough to let the port free up, short enough to be invisible to the user.
const BACKEND_RESPAWN_BACKOFF_MS = 1_000

/**
 * Open the packaged build's backend log, rotating it first if it has grown
 * past the cap.
 *
 * #214c — 5 MB max, 3 backup generations. Rotation happens once, here; the
 * old contents live in .1 / .2.
 */
function openMainLog(): void {
  const logsDir = app.getPath('logs')
  mkdirSync(logsDir, { recursive: true })
  const logPath = join(logsDir, 'backend.log')
  const fs = realFsOps()
  // Launch-time rotation: a stale over-cap file from the previous run rolls to
  // .1 before the first line lands.
  rotateIfNeeded(logPath, LOG_MAX_BYTES, LOG_MAX_FILES, fs)
  // Mid-session rotation (M8/L1): every writeMainLog goes through this appender,
  // which re-checks the size periodically and rotates when the cap is crossed —
  // so a long verbose session cannot grow the active log without bound.
  mainLogAppend = createRotatingAppender(logPath, LOG_MAX_BYTES, LOG_MAX_FILES, {
    fs,
    append: (p, text) => appendFileSync(p, text),
  })
  mainLogPath = logPath
}

/**
 * Append to the backend log (packaged) or the console (dev).
 *
 * Backend and database stdout carry the DSN, which includes this install's
 * generated password — so in a packaged build it must never reach the
 * renderer console (debt #200 F5).
 *
 * Synchronous on purpose. This used to be a buffered ``WriteStream``, and the
 * first time a packaged build failed to start, the log it told the user to
 * send back was zero bytes: the process died with every line still in the
 * stream's buffer. A startup log that survives only a graceful exit is
 * useless precisely when it is needed, and the volume here — a boot log plus
 * backend stdout — does not justify the risk.
 */
function writeMainLog(line: string): void {
  if (mainLogAppend === null) {
    console.log(line)
    return
  }
  try {
    // The appender writes the trailing newline itself and rotates when the file
    // crosses the cap (M8/L1).
    mainLogAppend(line)
  } catch {
    // A log write must never be the thing that takes the app down.
  }
}

// ---------------------------------------------------------------------------
// Backend lifecycle
// ---------------------------------------------------------------------------

function startApi(): void {
  // Stop accepting new work once the quit has begun: a respawn timer that fires
  // during shutdown would spawn an engine the teardown has already passed, and
  // it would outlive the app on :8765 (owner ruling 2026-09-06).
  if (shuttingDown) {
    writeMainLog('[main] not starting the backend - the app is shutting down')
    return
  }
  // A freshly spawned backend's future death is "unintentional" until the
  // shutdown sequence says otherwise (H3(a)).
  intentionalBackendStop = false
  // In dev: __dirname = desktop/out/main/ → 3 levels up = repo root (Strix/).
  // A packaged build has no repo and no .venv — it runs the bundled
  // interpreter against the bundled source, pointed at the database the
  // embedded stack is bringing up (see ./embedded/embeddedStack). The engine
  // waits for + migrates that database itself at the start of its lifespan.
  const repoRoot = join(__dirname, '..', '..', '..')
  // The backend is started through its own entrypoint module rather than
  // `uvicorn.exe`, because the event loop has to be pinned through uvicorn's
  // own `loop` factory hook — and uvicorn's CLI has no flag for a custom one.
  //
  // Observed 2026-08-02 (dogfeed): `OSError [WinError 64]` out of
  // `asyncio/windows_events.py finish_accept` logged "Accept failed on a
  // socket", after which the process kept running while every connection to
  // :8765 was refused. CPython's proactor loop closes the listening socket on
  // an accept error and never re-arms it; the selector loop logs and keeps
  // serving. `groundmodel.api.serve` pins the selector loop on Windows (and
  // installs the loud CRITICAL diagnostics either way) — see its docstring.
  const pythonExe = embeddedStack
    ? embeddedStack.pythonExe
    : join(repoRoot, '.venv', 'Scripts', 'python.exe')

  apiProcess = spawn(pythonExe, [
    '-m', 'groundmodel.api.serve',
    '--host', '127.0.0.1',
    '--port', String(API_PORT),
  ], {
    // Packaged: the install directory is read-only, so the child runs from
    // the per-user data directory — anything that ever resolves a relative
    // path lands somewhere writable instead of failing under Program Files.
    cwd: embeddedStack ? app.getPath('userData') : repoRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    // A packaged build has no repo-root .env and won't have ENVIRONMENT set,
    // so the backend would default to "development" and only WARN on a
    // default SECRET_KEY. Force ENVIRONMENT=production for packaged builds so
    // the backend's hard SECRET_KEY guard actually fires (audit #16 Gap A).
    // The launch token goes to the child only — it is never written to disk,
    // never handed to the renderer, and dies with the process. A backend
    // started by hand (dev shell, e2e harness, scripts) simply doesn't get one
    // and keeps its pre-token behaviour.
    env: {
      ...(embeddedStack ? embeddedStack.backendEnv : process.env),
      [LOCAL_CLIENT_TOKEN_ENV_VAR]: localClientToken,
      ...(app.isPackaged ? { ENVIRONMENT: 'production' } : {}),
    }
  })

  // Backend stdout/stderr carry the asyncpg DSN (groundmodel:groundmodel@…)
  // plus every backend log line. In a packaged build View → Toggle DevTools
  // stays enabled, so echoing these to the renderer console would leak the DB
  // connection string to any user who opens DevTools (debt #200 F5). Route
  // them to a log file under the app's logs dir in production; keep the
  // console in dev for fast iteration.
  //
  // Opened once per launch (see openMainLog for the rotation), and normally
  // already open by now: the embedded database boots first and its stage log
  // is the first thing written, so a launch reads in order.
  if (app.isPackaged && mainLogPath === null) openMainLog()
  const writeLog = writeMainLog

  apiProcess.stdout?.on('data', (d: Buffer) => {
    if (mainLogPath) writeMainLog(`[api] ${d.toString().trimEnd()}`)
    else console.log('[api]', d.toString().trim())
  })
  apiProcess.stderr?.on('data', (d: Buffer) => {
    if (mainLogPath) writeMainLog(`[api:err] ${d.toString().trimEnd()}`)
    else console.error('[api]', d.toString().trim())
  })

  // Track whether the backend ever became ready so we can distinguish a
  // startup crash (exit before ready) from a normal shutdown (exit after
  // the user quit the app).
  let backendBecameReady = false

  // Fresh spawn, fresh readiness budget.
  readinessWindowsUsed = 0

  // A process that cannot be spawned at all (ENOENT on a missing or
  // quarantined interpreter after a partial install) emits 'error', never
  // 'exit'. Without this handler ``apiProcess`` stayed non-null and every
  // readiness window reported "still starting", so the app spun forever
  // instead of failing. Null it here so the deadline reports a real failure.
  apiProcess.on('error', (err) => {
    writeLog(`[api] process failed to start: ${err.message}`)
    apiProcess = null
  })

  apiProcess.on('exit', (code) => {
    writeLog(`[api] process exited with code ${code}`)
    apiProcess = null
    if (intentionalBackendStop) {
      // We killed it (shutdown, or the uncaught-exception handler). Do not
      // respawn and do not signal failure — the app is on its way down (H3(a)).
      return
    }
    if (backendBecameReady) {
      // The backend was serving and then died — respawn it once (H3(a)) rather
      // than leave the app talking to a dead API. Unless :8765 still answers:
      // then readiness was confirmed against an EXTERNAL backend (the dev
      // session's uvicorn, the e2e harness) and this exit is our child losing
      // the port race, not a crash (decideExitAfterReady).
      void handleReadyBackendExit()
      return
    }

    // The app's spawned backend exited before we confirmed readiness — but an
    // externally-run backend may still own :8765 (the dev session's own
    // uvicorn, or the e2e harness which starts its own). In that case the
    // app's child losing the port race is NOT a failure: the API is reachable.
    // Only surface BackendFailedModal when :8765 is genuinely unreachable, so
    // we don't false-positive over a live external backend (#214d — fixes the
    // e2e regression where the modal blocked the welcome screen).
    void (async () => {
      const verdict = await probeBackendOnce()
      if (verdict === 'reachable') {
        writeLog('[main] backend child exited but :8765 is reachable — not signalling failure')
        markBackendReady?.()
        return
      }
      if (verdict === 'foreign') {
        // Packaged only: :8765 is held by an orphaned uvicorn from a crashed
        // previous launch, whose token differs from ours — adopting it would
        // 403 every request (H3(b)). Refuse rather than adopt.
        writeLog(
          '[main] :8765 is held by a FOREIGN backend (wrong launch token, 403) — refusing to adopt it',
        )
      }
      writeLog('[main] backend exited before ready and :8765 unreachable — sending app:backend-failed')
      mainWindow?.webContents.send('app:backend-failed')
    })()
  })

  // Expose a function the api:ready handler can call to mark the backend
  // as having started successfully (so the exit handler knows it was normal).
  markBackendReady = (): void => {
    backendBecameReady = true
  }
}

/**
 * The real effects the shutdown sequencer drives (see ./shutdownSequencer).
 *
 * The engine is force-killed by its whole process tree - ``child.kill()`` on
 * Windows is ``TerminateProcess`` on the direct process only, orphaning the
 * ``ProcessPoolExecutor`` parse workers. The tree kill runs on the LIVE pid
 * BEFORE the direct terminate, so ``/T`` can still walk to the grandchildren
 * while the parent links them.
 */
const shutdownIo: ShutdownIo = {
  killEngineTree: (): void => {
    const pid = apiProcess?.pid ?? null
    // The kill is OURS - the exit handler must not respawn (H3(a)).
    intentionalBackendStop = true
    if (pid != null) killProcessTreeSync(pid, writeMainLog)
    // Belt-and-suspenders for the direct process (a no-op after taskkill /F;
    // on non-Windows dev it is the actual terminate). Guarded - never throw.
    try {
      apiProcess?.kill()
    } catch {
      // already gone
    }
    apiProcess = null
  },
  stopPostgresClean: (graceMs: number): boolean => {
    // Dev / e2e: Docker owns the database on :5433, so there is nothing of ours
    // to stop - report "clean" so the sequencer does not force a tree that does
    // not belong to us.
    if (!embeddedStack) return true
    return embeddedStack.stopClean(graceMs)
  },
  killPostgresTree: (): void => {
    embeddedStack?.forceStop()
    embeddedStack = null
  },
  log: writeMainLog,
  now: () => Date.now(),
}

/**
 * Begin the deterministic quit: bounded, tree-killing teardown of the engine +
 * database, then the caller exits the process.
 *
 * Idempotent - a graceful quit fires both ``window-all-closed`` and ``will-quit``
 * and the crash handler may race them. Cancels the diagnostics retry timer so a
 * pending drain cannot hold the event loop open, and latches ``shuttingDown`` so
 * no respawn timer spawns a zombie engine mid-teardown.
 *
 * @param mode - ``'graceful'`` gives PostgreSQL the 2s clean-stop window;
 *   ``'crash'`` force-kills both trees at once.
 */
function runShutdown(mode: ShutdownMode): void {
  if (shuttingDown) return
  shuttingDown = true
  // Cancel the retry timer so a pending upload drain cannot keep the loop alive.
  diagnosticsUploader?.stop()
  performShutdown(shutdownIo, mode)
}

/**
 * Probe ``:8765`` once to decide whether the listener is a backend we may adopt.
 *
 * A packaged probe carries this launch's token + ``Origin: null`` so a foreign
 * (orphaned previous-launch) uvicorn answers 403 and is never adopted (H3(b));
 * a dev/e2e probe is header-free and adopts any listener. See ./backendProbe.
 *
 * @returns The probe verdict — reachable / foreign / unreachable.
 */
async function probeBackendOnce(): Promise<ProbeVerdict> {
  try {
    const res = await fetch(`${API_BASE}/openapi.json`, {
      headers: backendProbeHeaders(app.isPackaged, localClientToken),
    })
    return classifyBackendProbe(app.isPackaged, res.status)
  } catch {
    return 'unreachable'
  }
}

/**
 * Handle a backend exit that happened AFTER it had become ready (H3(a)).
 *
 * Respawn once with a short backoff, telling the renderer it is reconnecting;
 * poll the respawned backend to readiness and tell the renderer when it is back.
 * A second death inside the guard window is a crash loop — give up to the
 * existing backend-failed banner rather than respawn forever.
 */
async function handleReadyBackendExit(): Promise<void> {
  const verdict = await probeBackendOnce()
  const action = decideExitAfterReady(verdict, lastBackendRespawnAtMs, Date.now(), BACKEND_RESPAWN_GUARD_MS)
  if (action === 'ignore') {
    writeMainLog('[main] backend child exited after readiness but :8765 still answers — an external backend owns the port, not respawning')
    return
  }
  if (action === 'give-up') {
    writeMainLog('[main] backend died again within the guard window — not respawning (crash loop)')
    mainWindow?.webContents.send('app:backend-failed')
    return
  }
  lastBackendRespawnAtMs = Date.now()
  writeMainLog('[main] backend exited after readiness — respawning once')
  mainWindow?.webContents.send('app:backend-restarting')
  setTimeout(() => {
    startApi()
    void awaitRespawnedBackendReady()
  }, BACKEND_RESPAWN_BACKOFF_MS)
}

/**
 * Poll the just-respawned backend to readiness and notify the renderer (H3(a)).
 *
 * On success it marks the new process ready (so a later normal shutdown is not
 * misread as a startup crash) and sends ``app:backend-ready``; if the respawn
 * never answers — or dies again immediately — it falls back to the backend-failed
 * banner.
 */
async function awaitRespawnedBackendReady(): Promise<void> {
  for (let i = 0; i < 60; i++) {
    if (i > 0 && apiProcess === null) break // the respawn crashed before ready
    const verdict = await probeBackendOnce()
    if (verdict === 'reachable') {
      markBackendReady?.()
      writeMainLog('[main] respawned backend is ready')
      mainWindow?.webContents.send('app:backend-ready')
      return
    }
    await new Promise(r => setTimeout(r, 500))
  }
  writeMainLog('[main] respawned backend never became ready — sending app:backend-failed')
  mainWindow?.webContents.send('app:backend-failed')
}

/**
 * Move the large, machine-local stores off the Roaming profile and point the
 * embedded database at their new home (audit M1). Packaged builds only; a dev /
 * e2e / isolated run keeps everything where it was.
 *
 * The live PostgreSQL cluster must not sit on a Roaming share a domain-joined
 * consultancy syncs or redirects. Logs already moved in ``applyPackagedProfile``;
 * here the cluster does: an existing Roaming ``pgdata`` is relocated to
 * ``%LOCALAPPDATA%\StrixGeo`` BEFORE Postgres starts, and the embedded layout is
 * pointed there. A failed move keeps the (intact) Roaming cluster and boots from
 * it, retrying next launch.
 *
 * The numba compile cache moves too, via ``configureNumbaCacheRoot`` — it is a
 * rebuildable cache, so it carries no migration, only a pointer to where the
 * backend writes it next. Pointing it at Local keeps it off the synced Roaming
 * profile like the cluster; on a failed pgdata move both stay Roaming together.
 */
function relocateMachineLocalStores(): void {
  const localRoot = resolveMachineLocalStrixDir({
    packaged: app.isPackaged,
    isolated: app.commandLine.hasSwitch('user-data-dir'),
    localAppData: process.env.LOCALAPPDATA,
  })
  if (localRoot === null) return // dev / isolated / no %LOCALAPPDATA% → keep Roaming
  // Open the boot log first so the relocation is recorded in backend.log.
  if (mainLogPath === null) openMainLog()
  const roamingPgdata = join(app.getPath('userData'), 'pgdata')
  const localPgdata = join(localRoot, 'pgdata')
  const result = migratePgdata(roamingPgdata, localPgdata, realPgdataFsOps(), writeMainLog)
  // Point the cluster at Local unless the move failed — a failure keeps the
  // intact Roaming cluster, and configuring Local would boot against an empty or
  // half-copied directory. 'skipped' means Local already holds the cluster or it
  // is a fresh install (initdb will create it at Local); both want Local.
  if (result !== 'failed') {
    configurePgdataRoot(localRoot)
    configureNumbaCacheRoot(localRoot)
  }
}

/**
 * Show the native "could not start" dialog for a boot-stage failure, then quit.
 *
 * A native dialog because at prepare-time there is no renderer yet; the cluster
 * phase may fail once a window exists, in which case the dialog layers over the
 * splash. Either way it names the step that failed plus the log file — the only
 * thing a non-technical tester can usefully send back.
 *
 * @param failure - The boot failure (stage + summary + technical message).
 */
function showBootFailureAndQuit(failure: BootFailure): void {
  // A database written by a NEWER StrixGeo gets its own message (M8): the
  // generic stage sentence reads like corruption, when in fact the data is
  // intact and the cure is to install the current build. Any other failure
  // keeps the stage sentence + technical message.
  const tailored = tailoredBootFailureCopy(failure)
  const detailsPath = mainLogPath ?? app.getPath('logs')
  dialog.showErrorBox(
    tailored?.title ?? 'StrixGeo could not start',
    tailored
      ? `${tailored.detail}\n\nDetails were written to:\n${detailsPath}`
      : `${failure.summary}\n\n${failure.message}\n\nDetails were written to:\n${detailsPath}`,
  )
  // The database failed to boot, so there is nothing to save - tear the engine
  // and cluster trees down deterministically and exit, rather than routing
  // through the window's save-prompt handshake (whose renderer may not have
  // mounted its subscriber yet on a boot that never reached a project).
  runShutdown('graceful')
  app.exit(0)
}

/**
 * Bring the bundled database up (packaged only), spawning the engine CONCURRENTLY.
 *
 * The fast preparation (paths, secrets, port, env) is awaited so the engine can
 * be spawned against the DSN; the cluster boot (init-cluster → start-postgres →
 * await-postgres-ready) runs in the background so the engine's ~48 s cold import
 * overlaps it instead of running after it (owner report, installer #13). The
 * engine waits for + migrates the database itself (api/boot_migration.py); no
 * migrate.py child runs here.
 *
 * No engine before the licence gate passes: ``gateAllowsEngine`` gates only the
 * spawn — the DB boots regardless, so a licence-deferred build still has a
 * database ready for the engine that activation starts later.
 *
 * @param gateAllowsEngine - Whether the licence gate permits the engine now.
 * @returns True when preparation succeeded (the app continues to a window);
 *   false when preparation failed and the app is quitting.
 */
async function bootEmbeddedDatabase(gateAllowsEngine: () => boolean): Promise<boolean> {
  if (mainLogPath === null) openMainLog()
  const outcome = await coordinatePackagedBoot<EmbeddedStackPrep>({
    prepare: () =>
      prepareEmbeddedStack(process.resourcesPath, app.getPath('userData'), writeMainLog),
    onPrepared: prep => {
      embeddedStack = {
        port: prep.port,
        pythonExe: prep.layout.pythonExe,
        backendEnv: prep.backendEnv,
        // The cluster is set asynchronously by startCluster below; both closures
        // read the module-level handle so a shutdown that races the boot stops
        // whatever is up.
        stopClean: (graceMs: number) => stopClusterClean(prep.layout, writeMainLog, graceMs),
        forceStop: () => {
          forceStopCluster(embeddedCluster, writeMainLog)
          embeddedCluster = null
        },
      }
    },
    startCluster: prep =>
      startEmbeddedCluster(prep, writeMainLog).then(result => {
        if (result.ok) {
          embeddedCluster = result.cluster
          return
        }
        // A background cluster failure (init/start/await-ready) surfaces after
        // the window may already exist — show the native dialog and quit.
        showBootFailureAndQuit(result.failure)
      }),
    gateAllowsEngine,
    spawnEngine: startApi,
  })
  if (!outcome.ok && outcome.failure) {
    showBootFailureAndQuit(outcome.failure)
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Window
// ---------------------------------------------------------------------------

function createWindow(): void {
  const isDev = !!process.env.ELECTRON_RENDERER_URL
  const rendererBase = process.env.ELECTRON_RENDERER_URL ?? null
  // The packaged renderer directory as a ``file://`` prefix. In prod the
  // window loads ``<dir>/index.html`` and SPA navigations stay under this
  // directory; anything else (an arbitrary local file) is denied (audit #15).
  const rendererFileBase = isDev
    ? null
    : pathToFileURL(join(__dirname, '../renderer/')).href

  // Inject Content-Security-Policy at the response-header layer so
  // it's enforced BEFORE page parse (a CSP meta tag in index.html
  // can only stop loads after the parser hits it). Production CSP is
  // strict (``script-src 'self'``); dev CSP allows Vite's HMR
  // ``unsafe-eval``. Debt #36.
  // Attach this launch's token to every renderer request that goes to the
  // local API. Done here rather than in the renderer's API client so the
  // renderer never holds the secret (an XSS-escalated page inside our own
  // window cannot read it back out) and no call site can forget it. Headers
  // added at this layer are invisible to the renderer's fetch, so they do not
  // change any CORS preflight behaviour.
  //
  // The first injection is logged because the failure mode is invisible
  // otherwise: a URL filter that matches nothing would strip the token from
  // every request and leave a packaged build unable to reach its own backend,
  // with the backend's 403 as the only clue. One line, once per launch.
  let loggedTokenInjection = false
  const tokenFilter = localApiRequestFilter(API_BASE)
  // eslint-disable-next-line no-console
  const tokenAudit = createTokenInjectionAudit(tokenFilter.urls, { error: console.error })
  session.defaultSession.webRequest.onBeforeSendHeaders(
    tokenFilter,
    (details, callback) => {
      tokenAudit.noteInjection(details.url)
      if (!loggedTokenInjection) {
        loggedTokenInjection = true
        // eslint-disable-next-line no-console
        console.info(`[main] launch token attached to local API requests (${details.url})`)
      }
      callback({
        requestHeaders: {
          ...details.requestHeaders,
          [LOCAL_CLIENT_TOKEN_HEADER]: localClientToken,
        },
      })
    },
  )
  // The audit's observation point: an UNFILTERED listener on a different
  // webRequest event (Electron allows one listener per event, and injection
  // holds onBeforeSendHeaders), with the API-host check done by hand so the
  // observation cannot share the URL-filter failure mode it audits. The first
  // audit version armed on a wall clock instead and cried wolf on any session
  // that never left the start screen (owner dogfeed 2026-08-03).
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    if (details.url.startsWith(`${API_BASE}/`)) {
      tokenAudit.noteApiRequestObserved(details.url)
    }
    callback({})
  })

  const csp = buildContentSecurityPolicy(isDev)
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [csp],
      },
    })
  })

  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'StrixGeo',
    // StrixGeo owl — window/taskbar icon. ``resources/`` is bundled into the
    // package (see electron-builder ``files``), so ``out/main → ../../resources``
    // resolves in both dev and the packaged app. The installer/exe icon comes
    // from resources/icon.ico (electron-builder ``build.icon``).
    icon: join(__dirname, '../../resources/icon.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // Keep the renderer running at full speed when the window is not visible.
      //
      // The close flow HIDES the window as soon as the engineer answers the
      // save-or-discard prompt, then finishes the work — a replace-restore of the
      // whole bundle — and quits itself. Chromium backgrounds a hidden window by
      // default and throttles its timers, which starves exactly the work the hide
      // exists to let run: e2e caught it as a teardown that never completed (the
      // app never reached its own quit handshake), and a user would have seen the
      // window vanish and the process linger.
      backgroundThrottling: false,
      // Deny renderer access to obscure / dangerous webContents APIs
      // (clipboard, full-screen on file:// pages, etc.). Hardens
      // against the same XSS-as-RCE escalation #36 / #37 protect.
      sandbox: true,
      // DevTools off in packaged builds (debt #200, autosave design Q6).
      // Gating the View-menu role alone leaves ways back in — a stray
      // accelerator, ``openDevTools()`` from anywhere in main. This flag
      // closes all of them at the source: with it false the webContents
      // simply cannot open DevTools. Two reasons it matters here: backend
      // stdout carries the DB connection string, and DevTools is one keypress
      // from the Reload that discards the renderer-only session state crash
      // recovery exists to protect.
      devTools: !app.isPackaged,
    },
  })
  mainWindow = win
  quitHandshake = new QuitHandshake()
  // Anti-loop guard for the once-only reload after a renderer crash (H3(d)).
  // Cleared when a document next finishes loading, so a crash that recurs before
  // recovery cannot spin, while a later unrelated crash still gets its one reload.
  let rendererReloadedAfterCrash = false
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  // Deny-by-default ``window.open`` — the renderer should never spawn
  // a same-privileges Electron window. Trusted external URLs hand
  // off to the OS browser via shell.openExternal. Debt #36.
  win.webContents.setWindowOpenHandler(({ url }) => {
    const decision = decideExternalOpen(url)
    if (decision.external) {
      void shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  // Block navigation to anywhere outside the renderer base URL.
  // Without this, a malicious link in user-supplied content (a future
  // formation ``description`` field, etc.) could redirect the
  // top-level window to an attacker-controlled page that then has
  // access to the same preload + IPC surface. Debt #36.
  win.webContents.on('will-navigate', (event, url) => {
    if (!isInAppNavigation(url, rendererBase, rendererFileBase)) {
      event.preventDefault()
      // If the navigation looks like an external link the user
      // clicked, hand it off to the OS browser instead — same UX
      // as window.open above.
      const decision = decideExternalOpen(url)
      if (decision.external) void shell.openExternal(url)
    }
  })

  win.setMenuBarVisibility(true)
  buildMenu(win)

  // Prototype updater (#6): attach it to this window so update events reach the
  // renderer. Only registers listeners + flips autoDownload off — no network
  // until a check runs, which is itself gated on app.isPackaged.
  configureUpdater(win)

  // Window-close handler — runs on Windows X, Alt+F4, and any other
  // OS-level close. We preventDefault, hand control to the renderer
  // (which knows about the project's dirty state and runs the same
  // save-or-discard prompt the in-app close paths use), and wait for
  // the renderer to either approve or veto via ``app:quit-decision``.
  //
  // Both sides of this handshake are logged. A dogfeed came back "the app
  // discarded without asking", and the main-process half of the story was
  // invisible: there was no way to tell whether the renderer was ever asked,
  // whether it answered, or what it answered. These two lines make the
  // sequence readable in the same terminal as the rest of the main-process
  // diagnostics.
  //
  // The decision itself lives in ./quitHandshake so it can be unit-tested
  // without Electron — including its two escapes from a renderer that never
  // answers (a second close offers a native force-close; a dead renderer
  // process closes straight away).
  win.on('close', (event) => {
    const decision = quitHandshake.requestClose()
    // eslint-disable-next-line no-console
    console.info(`[main] close requested -> ${decision.action} (${decision.reason})`)
    if (decision.action === 'close') return
    event.preventDefault()
    if (decision.action === 'ask-renderer') {
      win.webContents.send('app:before-quit')
      return
    }
    // The renderer was asked and never answered — the user is pressing X
    // against a window that appears frozen. Offer the way out, defaulting to
    // Keep open because forcing the close can discard unsaved work.
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['Keep open', 'Close anyway'],
      defaultId: 0,
      cancelId: 0,
      title: 'Close StrixGeo?',
      message: 'StrixGeo has not responded to the close request.',
      detail:
        'The app was asked to close and did not answer — it may have hit an ' +
        'error. Closing anyway skips the usual save prompt, so anything not ' +
        'yet written to the project file stays unsaved. The crash-recovery ' +
        'copy of this session is kept and offered on the next launch.',
    })
    if (choice === 1) {
      quitHandshake.noteForceCloseConfirmed()
      // ``destroy`` rather than ``close``: we are inside the close handler and
      // the renderer is unresponsive, so there is nothing left to ask.
      win.destroy()
    } else {
      quitHandshake.noteForceCloseDeclined()
    }
  })

  // Log renderer-process death to the main-process stdout (the same
  // PowerShell window where ``npm run dev`` runs). Without this, a
  // renderer that crashes before DevTools attaches dies silently —
  // F12 / Ctrl+R just trigger another crash cycle. Reason codes:
  // ``crashed`` / ``oom`` / ``killed`` / ``launch-failed`` etc.
  // Dogfeed 2026-05-23: Robin hit a boot-time crash loop with no
  // visible diagnostics; this surfaces the why in his terminal.
  win.webContents.on('render-process-gone', (_event, details) => {
    // eslint-disable-next-line no-console
    console.error(
      `[main] renderer process gone — reason=${details.reason} ` +
        `exitCode=${details.exitCode}`,
    )
    captureDiagnostic(
      {
        kind: 'renderer-gone',
        severity: 'fatal',
        scope: 'window',
        message: `renderer process gone — reason=${details.reason} exitCode=${details.exitCode}`,
      },
      'main',
    )
    // Nobody is left to answer the close handshake, and a dead renderer holds
    // no unsaved state worth prompting about — stop intercepting closes so the
    // window doesn't become un-closable on top of the crash.
    quitHandshake.noteRendererGone()
    // Recreate the renderer ONCE on a genuine fault (H3(d)) — a packaged build
    // has no View → Reload / Ctrl+R to do it by hand. A deliberate teardown
    // (killed / clean-exit) is left alone; the guard blocks a reload-crash-loop.
    // The crash-recovery offer on the reloaded document takes over from there.
    if (shouldReloadRendererAfterGone(details.reason, rendererReloadedAfterCrash)) {
      rendererReloadedAfterCrash = true
      // eslint-disable-next-line no-console
      console.error('[main] reloading the window once after a renderer crash')
      win.reload()
    }
  })
  // A document finished loading — the window has a working renderer again, with
  // its own ``app:before-quit`` subscriber. Re-arm the handshake: after a crash
  // + reload (View → Reload in dev, the ErrorBoundary's Reload button) the app
  // holds the project once more, and closing it without the save prompt would
  // discard everything done since the reload.
  win.webContents.on('did-finish-load', () => {
    quitHandshake.noteRendererAlive()
    // A working renderer again — re-arm the once-only crash reload (H3(d)) so a
    // future, unrelated crash is also recovered.
    rendererReloadedAfterCrash = false
    // The token-injection audit needs nothing here any more: it arms itself
    // on the first OBSERVED API request (see the onBeforeRequest listener),
    // so an idle start-screen session no longer trips a false alarm.
  })
  win.webContents.on('unresponsive', () => {
    // eslint-disable-next-line no-console
    console.error('[main] renderer unresponsive (likely infinite loop or stuck await)')
    captureDiagnostic(
      {
        kind: 'renderer-unresponsive',
        severity: 'warning',
        scope: 'window',
        message: 'renderer unresponsive (likely infinite loop or stuck await)',
      },
      'main',
    )
  })

  // Mirror the renderer console into the terminal — DEV ONLY.
  //
  // A pasted bug report used to carry uvicorn's `[api]` lines and the main
  // process's `[main]` lines but nothing from the renderer, because those live
  // in a separate DevTools window. Interleaving them here means one paste shows
  // the click, the request it made and the reply, in order.
  //
  // Never in a packaged build: there is no terminal to write to, and renderer
  // output is untrusted text that a shipped app has no reason to re-emit.
  if (!app.isPackaged) {
    win.webContents.on('console-message', details => {
      if (!shouldForwardRendererMessage(details)) return
      const method = consoleMethodForLevel(details.level)
      // eslint-disable-next-line no-console
      console[method](formatRendererMessage(details))
    })
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
    // ``mode: 'detach'`` opens DevTools in its own window — it survives
    // a renderer-process crash, so the post-mortem console stays
    // available when the page itself goes white. Dogfeed 2026-05-23:
    // F12 brought up DevTools in-frame, but the renderer died before
    // it could render the panel and tore it down too. A detached
    // window is owned by the main process and persists.
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ---------------------------------------------------------------------------
// Native menu
// ---------------------------------------------------------------------------

// Native About dialog. Kept in the main process (native ``dialog.showMessageBox``)
// and deliberately English-only: the renderer LicensingDialog is the localised
// build-info surface, this is the OS "About" affordance. The "StrixGeo — …" title
// keeps its em-dash by convention.
function showAboutDialog(win: BrowserWindow): void {
  const provenance = compiledBuildProvenance()
  const buildLine = provenance?.sha
    ? `\nBuild ${provenance.sha.slice(0, 12)}${provenance.builtAt ? ` · ${provenance.builtAt}` : ''}`
    : ''
  // Owner finding (f): the About line carries the beta expiry too, so a
  // tester can read which build they hold and when it stops. Long date form
  // ("1 November 2026") via en-GB.
  const info = currentBuildInfo()
  const betaLine =
    info.expiresAtMs !== null
      ? `\nBeta build ${info.sha ?? '—'}, expires ${new Date(info.expiresAtMs).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`
      : ''
  dialog.showMessageBox(win, {
    type: 'info',
    title: 'StrixGeo',
    message: 'StrixGeo — ground model platform',
    detail: `Version ${app.getVersion()}${buildLine}${betaLine}\nGround model platform for geotechnical engineers.`,
  })
}

function buildMenu(win: BrowserWindow): void {
  // The template is a pure function of the language + packaging flags + the
  // recent list (./menuTemplate). Every visible label follows ``menuLanguage``,
  // which the renderer reports over ``window:set-language``. Rebuilt on every
  // language flip and after each open/save so "Open Recent" stays fresh, both
  // without an app restart.
  const template = buildMenuTemplate({
    language: menuLanguage,
    isPackaged: app.isPackaged,
    rawBackendLogAffordance: rawBackendLogAffordanceEnabled(app.isPackaged),
    recent: readRecentProjects(),
    send: (channel, ...args) => win.webContents.send(channel, ...args),
    onShowLogFile: () => {
      // shell.openPath (not openExternal) — a local filesystem path, not a URL.
      void shell.openPath(app.getPath('logs'))
    },
    onSaveLogsForSupport: () => {
      void saveDiagnosticsBundle(win)
    },
    onAbout: () => showAboutDialog(win),
  })

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// ---------------------------------------------------------------------------
// Recent-projects helpers — JSON file in the OS-standard userData dir.
// ---------------------------------------------------------------------------

function recentProjectsFile(): string {
  return join(app.getPath('userData'), RECENT_PROJECTS_FILENAME)
}

function readRecentProjects(): RecentProject[] {
  const path = recentProjectsFile()
  if (!existsSync(path)) return []
  try {
    const raw = readFileSync(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // ``isValidRecentProjectEntry`` enforces length caps so a
    // corrupted file with a 100-MB ``name`` can't freeze the menu
    // rebuild (debt #41).
    return parsed.filter(isValidRecentProjectEntry) as RecentProject[]
  } catch {
    // Corrupt / unreadable file shouldn't block startup — start fresh.
    return []
  }
}

function writeRecentProjects(entries: RecentProject[]): void {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  // Atomic write so a kill mid-write (or a second writer racing) can't
  // leave the file half-overwritten. Reader handles corruption by
  // falling back to an empty list, but recovery is friendlier than
  // silent data loss of the user's recent-projects list.
  writeFileAtomic(recentProjectsFile(), JSON.stringify(entries, null, 2))
}

function addRecentProject(path: string, name: string): RecentProject[] {
  // Move-to-front: drop existing entry for the same path so we don't
  // accumulate duplicates when a user opens the same project repeatedly.
  const existing = readRecentProjects().filter(r => r.path !== path)
  const updated: RecentProject[] = [
    { path, name, lastOpened: new Date().toISOString() },
    ...existing,
  ].slice(0, RECENT_PROJECTS_MAX)
  writeRecentProjects(updated)
  // Authorise both the freshly-added path and every other recent
  // entry — the renderer's File → Open Recent path skips the
  // dialog, so without this the read would be denied.
  for (const r of updated) authorisePath(r.path)
  return updated
}

/**
 * Bootstrap the authorised-paths set at app startup with every
 * path in the recent-projects list. Without this, the user's first
 * "Open Recent" click after launching the app would fail the
 * authorisation check (the renderer skips the dialog → no fresh
 * authorisation event).
 */
function bootstrapAuthorisedPaths(): void {
  for (const r of readRecentProjects()) authorisePath(r.path)
}


// ---------------------------------------------------------------------------
// IPC handlers
// ---------------------------------------------------------------------------

ipcMain.handle('api:base-url', () => API_BASE)

// Boot flags surfaced SYNCHRONOUSLY to the renderer through the preload, so the
// renderer can gate boot-time UI (the onboarding auto-open, the packaged
// activation start screen — see docs/design/onboarding-activation-updater-proto.md)
// with no async round-trip. STRIX_E2E is set by the e2e harness
// (tests/e2e/helpers/electron_launch.ts); isPackaged separates a dev dogfeed from
// a distributed build. Registered at module load, before any window's preload
// issues its sendSync.
ipcMain.on('launch:flags', (event) => {
  event.returnValue = {
    // STRIX_E2E is honoured ONLY in an unpackaged build — the harness never runs
    // a package, and a packaged exe must not let STRIX_E2E=1 walk past the licence
    // gate (audit C3(b)). The rule is pinned in prototypeFlags.test.ts.
    e2e: e2eLaunchFlag(process.env, app.isPackaged),
    packaged: app.isPackaged,
  }
})

// Under the e2e harness (STRIX_E2E, unpackaged only) the native Save / Open /
// message dialogs answer themselves: Playwright cannot dismiss an OS dialog,
// so a walker click on Export or Save otherwise blocks the run — or lands the
// dialog on the owner's screen (2026-09-10). See e2eDialogs.ts.
installE2eDialogStubs(dialog, { e2e: e2eLaunchFlag(process.env, app.isPackaged), log: writeMainLog })
// Same for external links: the walker clicks the map's attribution links and
// the OS browser would pile up windows on the owner's screen (2026-09-10).
installE2eShellStubs(shell, { e2e: e2eLaunchFlag(process.env, app.isPackaged), log: writeMainLog })

ipcMain.handle('dialog:open-file', async (_event, filters: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters
  })
  if (result.canceled) return null
  // Path returned by the OS dialog → the user just authorised it.
  // fs:read-file / project:read-file will check against this set.
  authorisePath(result.filePaths[0])
  return result.filePaths[0]
})

ipcMain.handle('dialog:open-files', async (_event, filters: Electron.FileFilter[]) => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters
  })
  if (result.canceled) return []
  for (const p of result.filePaths) authorisePath(p)
  return result.filePaths
})

ipcMain.handle('fs:read-file', (_event, filePath: string): Buffer => {
  if (!pathIsAuthorised(filePath)) {
    // Refuse rather than silently reading. The renderer that issued
    // this call either has a bug (didn't go through the dialog) or
    // is compromised (XSS trying to read AppData). Same error shape
    // either way so the renderer surfaces "couldn't read file".
    throw new Error(`fs:read-file refused — path not authorised: ${filePath}`)
  }
  assertFileSizeUnder(filePath, FS_READ_CAP_BYTES, 'fs:read-file')
  return readFileSync(filePath)
})

// Project file IPC. The renderer drives the file lifecycle:
//   1. New: dialog → write JSON → addRecent
//   2. Open: dialog → read JSON → addRecent
//   3. Save: write JSON to current path
// Recent-projects list is stored in userData/recent-projects.json.

ipcMain.handle('project:open-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      // Accept both the canonical ``.strix`` and the legacy
      // ``.gmproj`` extension so users with pre-rebrand files can
      // still open them.
      { name: 'StrixGeo Project', extensions: PROJECT_FILE_OPEN_EXTENSIONS },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled) return null
  authorisePath(result.filePaths[0])
  return result.filePaths[0]
})

ipcMain.handle(
  'project:save-dialog',
  async (_event, defaultName: string | undefined) => {
    const result = await dialog.showSaveDialog({
      filters: [{ name: 'StrixGeo Project', extensions: [PROJECT_FILE_EXTENSION] }],
      // Renderer-supplied name → bare filename only, so a crafted default cannot
      // pre-fill a path outside the dialog's directory (audit H4).
      defaultPath: sanitizeSaveDialogDefault(defaultName),
    })
    if (result.canceled) return null
    const path = result.filePath ?? null
    authorisePath(path)
    return path
  },
)

// Existence probe for the recents flow. The renderer asks BEFORE reading so a
// moved .strix gets its own message ("did you move it?") instead of the
// catch-all corruption/API banner — sniffing ENOENT out of the wrapped IPC
// error text is exactly the trap the 404-text gate fell into (see
// useProject.openProjectFile). Same path-authorisation as the read: an
// unauthorised path answers false rather than becoming a filesystem oracle
// for an XSS-escalated renderer.
ipcMain.handle('project:file-exists', (_event, filePath: string): boolean => {
  if (!pathIsAuthorised(filePath)) return false
  return existsSync(filePath)
})

ipcMain.handle('project:read-file', (_event, filePath: string): ProjectReadResult => {
  if (!pathIsAuthorised(filePath)) {
    // A path-auth refusal is a renderer bug / XSS attempt, not a "this file is
    // unreadable" answer the user needs worded — keep it an exceptional throw.
    throw new Error(`project:read-file refused — path not authorised: ${filePath}`)
  }
  assertFileSizeUnder(filePath, PROJECT_READ_CAP_BYTES, 'project:read-file')
  // Read raw bytes so the codec can SNIFF: a binary ``STRIXB1`` container is
  // reversed + integrity-checked here; a legacy plain-JSON file (leading ``{``)
  // is returned verbatim. Either way the renderer receives the plaintext JSON
  // and feeds it straight into ``parseProjectFile`` — the codec is a container
  // the renderer never sees.
  //
  // A damaged / truncated / newer file throws a TYPED StrixDecodeError which we
  // FLATTEN into a discriminated ``{ ok: false, reason }`` rather than let it
  // cross IPC as a wrapped, class-and-code-stripped Error. That lets the
  // renderer branch on ``reason.code`` (never on message text) and show the
  // specific, honest message — corruption detection stays LOUD, and a failed
  // read still degrades to "could not open", never bricking Close. The
  // decompressed size is capped at the read ceiling so a hostile ``.strix``
  // cannot bomb the process with a few KB that inflate to gigabytes.
  try {
    const json = decodeStrix(readFileSync(filePath), {
      maxPlaintextBytes: PROJECT_READ_CAP_BYTES,
    })
    return { ok: true, json }
  } catch (err) {
    // ``toStrixReadFailure`` rethrows anything that is NOT a StrixDecodeError
    // (an unexpected I/O bug), so genuine faults are not swallowed as "corrupt".
    return { ok: false, reason: toStrixReadFailure(err) }
  }
})

// ``writeFileAtomic`` lives in ./atomicWrite — shared with the recovery-file
// store so there is exactly one implementation of the temp-write + rename
// dance (and one place where its rationale is documented).

ipcMain.handle(
  'project:write-file',
  (_event, filePath: string, contents: string): void => {
    if (!pathIsAuthorised(filePath)) {
      throw new Error(`project:write-file refused — path not authorised: ${filePath}`)
    }
    // ``contents`` is the plaintext project JSON the renderer built
    // (``serialiseProjectFile``); the codec wraps it in the binary ``STRIXB1``
    // container (gzip + seeded keystream) so the interpreted data is not stored
    // in plaintext on disk. The bundle ``format_version`` lives INSIDE that
    // JSON and is untouched. Every save path (New / Save / Save As) funnels
    // through here, so this one line makes them all binary.
    // Three previous saves survive beside the file (audit H2a).
    writeFileAtomicKeepingGenerations(filePath, encodeStrix(contents))
  },
)

// Generic export-file save flow — used by the DXF section export
// today; future Plaxis / D-Sheet exporters will share the same
// dialog + write IPC pair. Caller supplies the dialog's filter +
// suggested filename; the main process returns the chosen path and
// writes the binary payload. Path authorisation flows through the
// same set as the project-file IPC.
ipcMain.handle(
  'export:save-dialog',
  async (
    _event,
    defaultName: string,
    filters: Electron.FileFilter[],
  ): Promise<string | null> => {
    const result = await dialog.showSaveDialog({
      filters,
      // Renderer-supplied name → bare filename only (audit H4), same as the
      // project save dialog above.
      defaultPath: sanitizeSaveDialogDefault(defaultName),
    })
    if (result.canceled) return null
    const path = result.filePath ?? null
    authorisePath(path)
    return path
  },
)

ipcMain.handle(
  'export:write-file',
  (_event, filePath: string, contents: ArrayBuffer): void => {
    if (!pathIsAuthorised(filePath)) {
      throw new Error(
        `export:write-file refused — path not authorised: ${filePath}`,
      )
    }
    // Atomic, exactly like the project-file write. An export almost always
    // overwrites the previous export of the same section (the suggested
    // filename is derived from the section name), and that previous file is a
    // deliverable the engineer may already have sent out. A plain
    // ``writeFileSync`` truncates the destination first, so a failure after
    // truncation — disk full, the file open in AutoCAD, a network share
    // dropping — replaces a good DXF with an empty or half-written one.
    writeFileAtomic(filePath, Buffer.from(contents))
  },
)

// Worked-example sample project (#93, owner ruling A8). The .strix ships as an
// installer resource (build.extraResources maps resources/sample → resources/sample,
// OUTSIDE the asar so copyFile can read it). "Load sample project" in the
// onboarding overlay asks the renderer, which drives these two handlers.
//
// ``sample:available`` — is a bundled sample present? False until the owner
// builds it, so the onboarding fallback (start empty) stays.
ipcMain.handle('sample:available', (): boolean => {
  const path = resolveSampleProjectPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  })
  writeMainLog(`[sample] available check → ${path !== null}`)
  return path !== null
})

// ``sample:install`` — copy the bundled sample to a user-chosen location and
// return its path (null when cancelled or when no sample is bundled). The
// bundled resource is READ-ONLY-by-convention: a Save from the app rewrites the
// .strix at its own path, so the resource must stay pristine — hence a copy the
// user owns, never opening the resource in place.
ipcMain.handle('sample:install', async (): Promise<string | null> => {
  const source = resolveSampleProjectPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
  })
  if (source === null) {
    writeMainLog('[sample] install requested but no bundled sample is present')
    return null
  }
  const result = await dialog.showSaveDialog({
    defaultPath: join(app.getPath('documents'), SAMPLE_INSTALL_DEFAULT_FILE_NAME),
    filters: [{ name: 'StrixGeo Project', extensions: [PROJECT_FILE_EXTENSION] }],
  })
  if (result.canceled || !result.filePath) {
    writeMainLog('[sample] install cancelled by user')
    return null
  }
  const destination = result.filePath
  // fs.promises.copyFile — copy the pristine resource to the user's copy.
  await copyFile(source, destination)
  // The user just chose this path through the OS save dialog → authorise it so
  // the subsequent openProjectFile (project:file-exists / project:read-file)
  // is not refused by the path-authorisation guard.
  authorisePath(destination)
  writeMainLog(`[sample] installed worked example → ${destination}`)
  return destination
})

// Cross-section PDF sheet: render sheet.html in a hidden window and print it
// through Chromium (docs/superpowers/specs/2026-09-02-section-pdf-sheet-design.md).
registerSheetPdfIpc()

ipcMain.handle(
  'project:add-recent',
  (_event, filePath: string, name: string): RecentProject[] => {
    // Refuse a path the user has not already authorised through a dialog or the
    // startup recents bootstrap (audit H4, debt #37). ``addRecentProject``
    // authorises every entry it keeps, so without this guard the renderer could
    // inject an arbitrary path into the authorised-path set — voiding the guard
    // that ``fs:read-file`` / ``export:write-file`` rely on — by naming it here.
    // Every legitimate add-recent follows an open/save dialog (or a recents open)
    // that already authorised the path. The ONE exception is the e2e harness,
    // which seeds its fixture project into recents by this IPC with a temp path
    // it wrote itself: the launch flag is never honoured in a packaged build
    // (prototypeFlags.ts), so the carve-out cannot reach a customer.
    if (!pathIsAuthorised(filePath) && !e2eLaunchFlag(process.env, app.isPackaged)) {
      throw new Error(`project:add-recent refused — path not authorised: ${filePath}`)
    }
    const updated = addRecentProject(filePath, name)
    // Rebuild the native menu so the new entry appears under "Open Recent"
    // without an app restart. Single-window today; if the user closed the
    // window we just skip the rebuild (no menu to refresh).
    if (mainWindow !== null) buildMenu(mainWindow)
    return updated
  },
)

ipcMain.handle('project:get-recent', (): RecentProject[] => readRecentProjects())

// Window title — driven by the renderer so the title stays in sync with
// the live project state (name + dirty marker). Empty / undefined falls
// back to the default app title.
// Debt #113: cap the title string so a renderer bug or a crafted IPC call
// can't inject an unbounded string into the OS title bar / log lines.
// 256 chars covers any real project name + dirty asterisk comfortably.
const _WINDOW_TITLE_MAX_LEN = 256
ipcMain.handle('window:set-title', (_event, title: string | null) => {
  if (mainWindow === null) return
  const safe = title && title !== '' ? title.slice(0, _WINDOW_TITLE_MAX_LEN) : 'StrixGeo'
  mainWindow.setTitle(safe)
})

// The renderer owns the interface language (localStorage ``groundmodel.language``
// -> system -> English) and reports its resolved value here on boot and on every
// Settings flip. Main mirrors it into the native menu the same way it mirrors the
// title — it does not re-resolve the choice, only narrows the reported value for
// safety. Rebuilds the menu only on a real change so an unchanged report is free.
ipcMain.handle('window:set-language', (_event, language: string | null) => {
  const next = narrowMenuLanguage(language)
  if (next === menuLanguage) return
  menuLanguage = next
  if (mainWindow !== null) buildMenu(mainWindow)
})

// Renderer's response to ``app:before-quit``. ``allowed=true`` means the
// renderer has either saved or discarded any unsaved state and we can
// finish the close; ``allowed=false`` means the user hit Cancel and we
// abort the quit. ``confirmedQuit`` short-circuits the next ``close``
// event so the renderer doesn't get re-asked.
ipcMain.handle('app:quit-decision', (_event, allowed: boolean) => {
  // Paired with the ``close intercepted`` line in the window-close handler:
  // together they show whether the renderer answered at all, and with what.
  // eslint-disable-next-line no-console
  console.info(`[main] quit decision from renderer: allowed=${allowed}`)
  quitHandshake.noteRendererDecision(allowed)
  if (!allowed || mainWindow === null) return
  mainWindow.close()
})

ipcMain.handle('app:set-window-visible', (_event, visible: boolean) => {
  // Lets the renderer take the window away the moment the engineer answers the
  // save-or-discard question, instead of after the work that answer causes. A
  // discard replace-restores the whole bundle, which on a real project is seconds
  // of apparent hang on a window that has already been told to close.
  //
  // Safe because that restore is ONE transaction — the route commits once and the
  // restore never commits internally — so a process that dies mid-flight rolls
  // back. The worst case is "the discard did not happen", never a half-written
  // project. HIDE, not close: the process must stay alive to finish the write,
  // and it quits itself through the existing handshake when it lands.
  if (mainWindow === null) return
  if (visible) mainWindow.show()
  else mainWindow.hide()
})

ipcMain.handle('api:ready', async () => {
  // Poll /openapi.json — FastAPI serves it without a DB connection, so it
  // passes as soon as uvicorn is listening regardless of PostgreSQL state.
  // The deadline is packaged-aware (backendProbe.ts): 30 s in dev, three
  // minutes for a packaged cold start — a freshly installed engine took 33 s on
  // the owner's machine and the old 30 s deadline called it dead. After the
  // first tick, if the process has already exited we bail immediately rather
  // than waiting out the deadline.
  const attempts = backendReadyAttempts(app.isPackaged)
  for (let i = 0; i < attempts; i++) {
    if (i > 0 && apiProcess === null) return false  // process crashed
    const verdict = await probeBackendOnce()
    if (verdict === 'reachable') {
      // Backend is up — mark it so the exit handler knows this is a
      // normal shutdown, not a startup crash (#214d).
      markBackendReady?.()
      return true
    }
    if (verdict === 'foreign') {
      // A foreign backend (orphaned previous launch, wrong token) owns the port
      // — never adopt it (H3(b)); report not-ready so the failed banner shows.
      return false
    }
    await new Promise(r => setTimeout(r, BACKEND_READY_POLL_MS))
  }
  readinessWindowsUsed += 1
  return readinessDeadlineResult(apiProcess !== null, readinessWindowsUsed)
})

// ---------------------------------------------------------------------------
// Crash-recovery file IPC — app-managed files under
// ``<userData>/recovery/<projectId>.recovery.json``.
//
// NOTE the deliberate difference from the project-file IPC above: these
// handlers never take a path. The authorised-path set only covers files the
// user picked in a native dialog, which recovery files by definition are not,
// so routing them through ``authorisePath`` would weaken that set. Instead the
// only input is a project UUID that ``recoveryStore`` validates before it
// builds the path itself. See the module docstring in ./recoveryStore.ts.
//
// The arguments are typed ``unknown`` on purpose: everything here crosses the
// context bridge from the renderer, where a type annotation is a comment, not
// a guarantee. The store's entry points take ``unknown`` too and narrow it
// themselves, so nothing here launders an untrusted value with a cast —
// ``writeRecovery`` re-validates the id, the options object, and the
// serialised size before anything touches the disk.
// ---------------------------------------------------------------------------

ipcMain.handle(
  'recovery:write',
  (_event, projectId: unknown, payload: unknown, options: unknown): RecoveryDescriptor =>
    writeRecovery(projectId, payload, options),
)

ipcMain.handle('recovery:list', (): RecoveryDescriptor[] => listRecovery())

ipcMain.handle('recovery:read', (_event, projectId: unknown): unknown => readRecovery(projectId))

ipcMain.handle('recovery:delete', (_event, projectId: unknown): boolean =>
  deleteRecovery(projectId),
)

// The autosave scheduler's clear, and every DECIDED exit that is not the
// prompt's Discard (save, discard-and-close, clean close, quit). Those paths
// mean "this session's delta has a home now" — they must not take a copy the
// user declined in an EARLIER session with them, which ``recovery:delete``
// would (owner decision 2026-08-03).
ipcMain.handle('recovery:delete-primary', (_event, projectId: unknown): boolean =>
  deletePrimaryRecovery(projectId),
)

// "Open without restoring" — preserve the copy instead of destroying it, so a
// restart re-offers the same unsaved work (owner decision 2026-08-03). The
// store moves it to a second slot the autosave scheduler never writes; only
// ``recovery:delete`` (the prompt's Discard) ever removes it.
ipcMain.handle('recovery:decline', (_event, projectId: unknown): boolean =>
  declineRecovery(projectId),
)

// The end of a decline: a copy that came OUT of the declined slot has just
// been restored, so it is live session state again and the declined file
// behind it must go — otherwise the same work is re-offered at every launch
// forever. The restore writes the primary slot BEFORE calling this, so there
// is never a moment where the only copy of at-risk content is gone.
ipcMain.handle('recovery:delete-declined', (_event, projectId: unknown): boolean =>
  deleteDeclinedRecovery(projectId),
)

// ---------------------------------------------------------------------------
// Close-flow notes from the renderer
//
// The close flow never touches the API, so a report of the shape "it discarded
// my work without asking" has no server log behind it. The renderer logs each
// decision point — but a packaged build has DevTools disabled and forwards its
// console nowhere, so those lines are invisible exactly where the reports come
// from. Dogfeed reports arrive as pasted TERMINAL output, and the terminal
// shows the main process only.
//
// Deliberately NOT a general log bridge: one channel, one string, close-flow
// lines only. A pipe that carries the whole renderer console would flood
// stdout, and every renderer-supplied string it printed would be one more
// thing to bound.
// ---------------------------------------------------------------------------
const CLOSE_FLOW_NOTE_MAX_LEN = 500

ipcMain.handle('app:close-flow-note', (_event, note: unknown): void => {
  // IPC arguments arrive as ``any`` at runtime whatever the signature claims;
  // a non-string here would print "[object Object]" at best.
  if (typeof note !== 'string') return
  // eslint-disable-next-line no-console
  console.info(`[renderer] ${note.slice(0, CLOSE_FLOW_NOTE_MAX_LEN)}`)
})

// ---------------------------------------------------------------------------
// #214 — distribution robustness IPC handlers
// ---------------------------------------------------------------------------

// Return the logs directory path so the renderer can display it in
// ErrorBoundary and BackendFailedModal.
ipcMain.handle('app:logs-path', (): string => app.getPath('logs'))

// Forward a renderer render error to the main log file so it appears
// alongside backend stack traces (useful when the packaged build sends
// backend.log to support). Best-effort: failures are swallowed.
ipcMain.handle(
  'app:log-renderer-error',
  (_event, message: string, componentStack: string): void => {
    const ts = new Date().toISOString()
    const line = `[${ts}] [main] renderer error: ${message}\n${componentStack}`
    // #16 — every renderer error path already arrives here (window.onerror,
    // unhandledrejection, ErrorBoundary), so capturing at this one handler
    // covers all three without a renderer-side change.
    captureDiagnostic(
      { kind: 'renderer-error', scope: 'renderer', message, stack: componentStack },
      'renderer',
    )
    if (mainLogPath) {
      try {
        appendFileSync(mainLogPath, `${line}\n`)
      } catch {
        // Swallow — don't crash the main process on a log-write failure.
      }
    } else {
      // eslint-disable-next-line no-console
      console.error('[main] renderer error:', message, componentStack)
    }
  },
)

// ---------------------------------------------------------------------------
// #16 — local diagnostics IPC
// ---------------------------------------------------------------------------

// Capture a renderer-observed problem. The renderer states WHAT went wrong;
// the whitelist, the redaction pass and the file live in ./diagnosticsStore,
// so a compromised renderer cannot widen what gets written or where.
ipcMain.handle('diagnostics:capture', (_event, diagnostic: unknown): void => {
  captureDiagnostic(diagnostic, 'renderer')
})

// Beta-expiry status for an in-app notice. Display only — the blocking
// decision is made before the window exists (see enforceBetaExpiry).
ipcMain.handle('app:beta-status', (): BetaVerdict | null => currentBetaVerdict())

// Build facts for Help → Licence and the About dialog (owner finding (f)):
// the beta expiry stamp + the git SHA, so a tester can verify which build they
// hold. Assembled from the SAME two sources the beta gate reads — the compiled
// provenance (SHA) and the parsed beta stamp (expiry). Display only.
ipcMain.handle('app:build-info', (): BuildDisplayInfo => currentBuildInfo())

/**
 * Assemble a diagnostics bundle and let the user choose where to put it.
 *
 * Driven from Help → "Save diagnostics bundle…". The file is written from the
 * main process to a path the user just picked in a native dialog, so it needs
 * no entry in the authorised-path set — that set exists to bound what the
 * RENDERER may touch, and the renderer never sees this file.
 *
 * @param win - Parent window for the dialogs.
 */
async function saveDiagnosticsBundle(win: BrowserWindow): Promise<void> {
  try {
    const bundle = buildCrashBundle({
      logsDir: app.getPath('logs'),
      consent: readTransmissionConsent(),
    })
    const result = await dialog.showSaveDialog(win, {
      title: 'Save diagnostics bundle',
      defaultPath: bundle.fileName,
      filters: [{ name: 'Zip archive', extensions: ['zip'] }],
    })
    if (result.canceled || !result.filePath) return

    writeFileAtomic(result.filePath, bundle.bytes)
    await dialog.showMessageBox(win, {
      type: 'info',
      title: 'Diagnostics bundle saved',
      message: 'The bundle is ready to send.',
      detail:
        `It contains ${bundle.manifest.contents.join(', ')} and a manifest. ` +
        `${bundle.manifest.redaction}`,
      buttons: ['OK'],
      noLink: true,
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.error('[main] diagnostics bundle failed:', detail)
    dialog.showErrorBox('StrixGeo — could not save diagnostics', detail)
  }
}

/**
 * The diagnostics uploader for this run, so ``before-quit`` can stop its timer.
 * Declared above its writer/reader on purpose (TDZ discipline).
 */
let diagnosticsUploader: DiagnosticsUploader | null = null

/**
 * Wire the consent-gated diagnostics transmitter (#16, transmit half).
 *
 * Called once at startup AFTER the activation setup: the endpoint is the SAME
 * origin as the activation service (owner ruling 2026-08-31), so it comes from
 * the activation config. When no base URL is configured (the mock/dogfeed
 * default) or consent is off, every call below is inert — nothing is queued and
 * nothing leaves the machine. It enqueues whatever was captured since the last
 * upload, then drains on an interval while the queue is non-empty.
 *
 * Best-effort: any failure here is swallowed with a log line. Transmission must
 * never keep the app from starting, and the local capture log is untouched.
 */
function startDiagnosticsUpload(): void {
  try {
    const uploader = new DiagnosticsUploader({
      queueDir: join(diagnosticsDirPath(), DIAGNOSTICS_QUEUE_DIR_NAME),
      baseUrl: activationBaseUrl({ env: process.env, packaged: app.isPackaged }),
      consent: readTransmissionConsent,
      // Through Chromium, so the company proxy and certificate store apply
      // (see chromiumFetch) — the same path the activation issuer takes.
      fetchImpl: chromiumFetch(net),
    })
    diagnosticsUploader = uploader

    // Identity (licence key + device id) is attached only when the capture
    // design's "no device id" invariant is deliberately lifted — the gate lives
    // in diagnosticsIdentityFor and is OFF today (see the constant's note).
    const activation = readActivationState()
    const identity = diagnosticsIdentityFor(
      activation.licence ? { key: activation.licence.key, deviceId: activation.deviceId } : null,
    )
    uploader.enqueueRecentDiagnostics(readDiagnosticEvents(), {
      facts: diagnosticsBuildFacts(),
      identity,
    })
    uploader.start()
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    // eslint-disable-next-line no-console
    console.warn('[main] diagnostics upload wiring failed:', detail)
  }
}

// ---------------------------------------------------------------------------
// App lifecycle
// ---------------------------------------------------------------------------

// Opt-out for hardware acceleration. Must be called BEFORE app.whenReady().
//
// Dogfeed 2026-05-23: Robin hit a boot-time renderer crash with exit code
// 0xC0000005 (Windows access violation) — a NATIVE crash before any of
// our React code runs. The most common cause on Windows Electron is the
// GPU process / driver going down (Cesium + WebGL on an older or
// recently-updated driver is a known offender). Setting
// ``STRIXGEO_DISABLE_GPU=1`` in the env disables hardware acceleration
// entirely; the app still renders fine via software (slower 3D, but
// boots). Off by default so production isn't slowed for everyone.
if (process.env.STRIXGEO_DISABLE_GPU === '1') {
  app.disableHardwareAcceleration()
  // eslint-disable-next-line no-console
  console.warn('[main] STRIXGEO_DISABLE_GPU=1 — hardware acceleration disabled')
}

// ---------------------------------------------------------------------------
// #214b — main-process crash handlers
//
// Catchall for exceptions that escape all try/catch blocks in the main
// process. Without these, a thrown error just kills the Electron main
// process silently — the window goes blank and there is nothing in the
// log to diagnose it from afar. We write a timestamped line to the log
// file (or console in dev) and, for uncaughtException, show a dialog so
// the user knows something went wrong before the app exits.
// ---------------------------------------------------------------------------

/**
 * Has our stdout/stderr gone away? Latched on the first broken-pipe write so
 * the main process stops trying to talk to a reader that no longer exists.
 * Declared ABOVE its first reader on purpose (TDZ discipline).
 */
let consolePipeBroken = false

function writeMainCrashLine(label: string, err: unknown): void {
  const ts = new Date().toISOString()
  const msg = err instanceof Error ? err.stack ?? err.message : String(err)
  const line = `[${ts}] [main] ${label}: ${msg}`
  // #16 — the same crash, in the structured local log. Separate from the text
  // line above on purpose: that one is for a human reading backend.log, this
  // one is redacted and machine-readable so a crash bundle is safe to send.
  captureDiagnostic(
    {
      // A broken pipe IS an uncaught exception in main, so it keeps that kind —
      // but at warning severity, because the app survives it. Grouping a dead
      // console with real crashes would make the fatal count meaningless.
      kind: label === 'unhandledRejection' ? 'main-unhandled-rejection' : 'main-uncaught',
      severity:
        label === 'uncaughtException' ? 'fatal' : label === 'brokenPipe' ? 'warning' : 'error',
      scope: 'main',
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    },
    'main',
  )
  if (mainLogPath) {
    try {
      appendFileSync(mainLogPath, `${line}\n`)
    } catch {
      // If we can't write the log, at least try the console.
    }
  }
  // Guarded: when the crash we are reporting IS a dead stdout, an unguarded
  // write here throws a SECOND EPIPE from inside the handler that is meant to
  // contain the first one. Once the pipe is gone it stays gone, so stop
  // writing to it entirely rather than re-throwing on every later log line.
  if (!consolePipeBroken) {
    try {
      // eslint-disable-next-line no-console
      console.error(line)
    } catch (writeErr) {
      if (isBrokenPipe(writeErr)) consolePipeBroken = true
    }
  }
}

process.on('uncaughtException', (err: Error): void => {
  // A broken output pipe is NOT an application fault — see ./mainCrashPolicy.
  // Nobody is reading our console any more (terminal closed, parent exited,
  // a harness killed us); the app's own state is intact, so it keeps running
  // and the user is never asked to dismiss a modal about it.
  if (crashActionFor(err) === 'ignore-broken-pipe') {
    consolePipeBroken = true
    writeMainCrashLine('brokenPipe', err)
    return
  }
  writeMainCrashLine('uncaughtException', err)
  // Show a synchronous dialog — at this point the event loop may be
  // in an unrecoverable state, so we use the blocking variant.
  dialog.showErrorBox(
    'StrixGeo — unexpected error',
    `An unexpected error occurred in the StrixGeo main process:\n\n${err.message}\n\nStrixGeo will now exit. Check the log file for details.`,
  )
  // Force-kill the engine + database process trees BEFORE exiting (H3(c)). A
  // bare hard exit skips before-quit/will-quit, so it would orphan the uvicorn
  // child + its parse-pool grandchildren (leaving a foreign backend on :8765)
  // and the Postgres cluster (leaving the data directory locked) for the next
  // launch to trip over. Crash mode skips the polite wait - both trees at once.
  runShutdown('crash')
  // Exit with a non-zero code so the OS knows it was a crash.
  process.exit(1)
})

process.on('unhandledRejection', (reason: unknown): void => {
  // Unhandled promise rejections in the main process are usually non-fatal
  // (e.g. a one-off fetch that was never awaited). Log the rejection but
  // do not exit — the app may still be functional.
  writeMainCrashLine('unhandledRejection', reason)
})

// Initialise Crashpad BEFORE app.whenReady() so the crashpad_handler
// process is connected when renderer/utility processes spawn. Without
// this, Electron's renderer prints the cosmetic
// ``crashpad_client_win.cc:867] not connected`` error on every dev-build
// boot. We collect crashes locally (no upload) — telemetry is a Tier B
// debt item (#16) gated on the commercial release window.
crashReporter.start({
  productName: 'StrixGeo',
  companyName: 'StrixGeo',
  submitURL: '',
  uploadToServer: false,
})

// ---------------------------------------------------------------------------
// Beta expiry (debt #3/#5 slice — owner ballot 2026-08-26: "beta builds must
// expire; a beta licence must not be usable for years")
//
// The rules live in ./betaExpiry, the anchor file in ./betaExpiryStore and the
// stamp in ./buildStamp. What is here is only the wiring: read the stamp once,
// decide before the window exists, re-decide periodically, and stop the app
// when the answer is no.
// ---------------------------------------------------------------------------

/**
 * Where an expired build sends the user.
 *
 * The exact path is an owner decision (checkout lives on the landing page
 * today); the host is what matters for the dialog to be useful.
 */
const BETA_RENEW_URL = 'https://strixgeo.com'

/**
 * How often a running app re-checks its own expiry.
 *
 * Six hours rather than a flat day: a workstation that is never restarted
 * would otherwise keep an expired beta open until the next launch, and six
 * hours bounds that to a single working session.
 */
const BETA_RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

// Read once, at module load: the stamp is compiled into the binary and cannot
// change while the process runs.
{
  const provenance = compiledBuildProvenance()
  writeMainLog(`[boot] StrixGeo ${app.getVersion()} build ${provenance?.sha?.slice(0, 12) ?? 'dev'} (${provenance?.builtAt ?? 'unstamped'})`)
}
const betaBuildStamp = readBuildStamp({
  isPackaged: app.isPackaged,
  env: process.env,
  compiled: compiledBuildStamp(),
})

let betaVerdict: BetaVerdict | null = null

/** The last verdict, for the renderer's display-only status call. */
function currentBetaVerdict(): BetaVerdict | null {
  return betaVerdict
}

/**
 * Renderer-safe build facts (git SHA + beta expiry) for Help → Licence and the
 * About dialog. Reads the compiled provenance and the resolved beta stamp — the
 * same two sources the beta gate uses (owner finding (f)).
 */
function currentBuildInfo(): BuildDisplayInfo {
  return buildDisplayInfo({ provenance: compiledBuildProvenance(), stamp: betaBuildStamp })
}

/**
 * Timestamps the app itself wrote while genuinely running.
 *
 * Feeds the same high-water mark as the anchor file, so deleting the anchor is
 * not on its own enough to make a wound-back clock believable.
 */
function betaCorroboratingTimestamps(): number[] {
  return readRecentProjects()
    .map(entry => Date.parse(entry.lastOpened))
    .filter(ms => Number.isFinite(ms))
}

/** Re-read the anchor, advance it, and decide. Caches the verdict. */
function refreshBetaVerdict(): BetaVerdict {
  const now = Date.now()
  const anchor = betaBuildStamp ? recordLaunch(now) : null
  betaVerdict = evaluateBetaExpiry(betaBuildStamp, anchor, now, betaCorroboratingTimestamps())
  return betaVerdict
}

/** Tell the user the beta is over, offer the renewal page, and quit. */
function stopForExpiredBeta(verdict: BetaVerdict): void {
  // eslint-disable-next-line no-console
  console.warn(`[main] beta build blocked — ${verdict.reason}`)
  const expiredOn = verdict.expiresAtMs ? new Date(verdict.expiresAtMs).toLocaleDateString() : ''
  const detail =
    verdict.state === 'clock-rollback'
      ? 'This build cannot verify the date. Set your system clock to the ' +
        'correct time and start StrixGeo again — if it is already correct, ' +
        'the beta period has ended.'
      : `This beta build stopped working on ${expiredOn}. Your projects are ` +
        'untouched: they live in your own database and .strix files, and a ' +
        'current build opens them exactly as you left them.'

  const choice = dialog.showMessageBoxSync({
    type: 'info',
    title: 'StrixGeo — this beta build has ended',
    message: 'Thanks for testing StrixGeo.',
    detail,
    buttons: ['Get the current version', 'Quit'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  })
  if (choice === 0) {
    void shell.openExternal(BETA_RENEW_URL)
  }
  app.quit()
}

/**
 * Decide whether this launch may proceed.
 *
 * Called before the window is created, so a blocked build never renders — the
 * renderer is not part of the decision and cannot be patched around it.
 *
 * @returns True when the app must stop.
 */
function enforceBetaExpiry(): boolean {
  // A packaged build with no stamp never expires, and looks exactly like one
  // whose stamp failed to inject — so say so, loudly and in the local log.
  // The failure mode this catches: cutting a release without
  // MAIN_VITE_STRIX_BETA_EXPIRES_AT set (see ./buildStamp.ts).
  if (app.isPackaged && !betaBuildStamp) {
    const warning = 'packaged build carries no beta expiry stamp — it will never expire'
    // eslint-disable-next-line no-console
    console.warn(`[main] ${warning}`)
    captureDiagnostic({ kind: 'unknown', severity: 'warning', scope: 'beta', message: warning }, 'main')
  }

  const verdict = refreshBetaVerdict()
  if (!verdict.blocked) {
    if (verdict.state !== 'unstamped') {
      // eslint-disable-next-line no-console
      console.info(`[main] ${verdict.reason}`)
    }
    return false
  }
  stopForExpiredBeta(verdict)
  return true
}

/** Re-decide periodically so a long-running session cannot outlive the date. */
function startBetaExpiryWatch(): void {
  if (!betaBuildStamp) return
  const timer = setInterval(() => {
    const verdict = refreshBetaVerdict()
    if (verdict.blocked) {
      clearInterval(timer)
      stopForExpiredBeta(verdict)
    }
  }, BETA_RECHECK_INTERVAL_MS)
  // Never hold the event loop open for this alone — quitting must not wait for
  // a six-hour timer.
  timer.unref?.()
}

// ---------------------------------------------------------------------------
// Single-instance lock (autosave design Q4)
//
// A second instance is never something the user wanted. Two of them already
// fight over :8765 — the second spawns a uvicorn that loses the bind, so the
// new window silently talks to the FIRST instance's backend and its dev DB,
// and both windows then edit the same project through one API with no idea the
// other exists. Symptoms read as data corruption, not as "you double-clicked
// the icon twice". The lock turns that confusing double-boot into a focus of
// the window that is already open.
//
// Acquired before ``whenReady`` and before any window is created, so the
// losing instance exits without ever spawning a backend or flashing a frame.
//
// WHY the escape hatch: the Playwright harness launches this binary ~166 times
// against ONE shared userData directory, sequentially. A single lingering
// process from a previous spec — a hung teardown, a renderer that ignored the
// quit — turns the NEXT ``launchApp`` into a lock loser, which exits before
// creating a window and fails the spec with a confusing "no first window"
// rather than with whatever actually went wrong. So the harness
// (``tests/e2e/helpers/electron_launch.ts``) sets
// ``STRIX_DISABLE_SINGLE_INSTANCE=1`` and gets the pre-lock behaviour back.
// A packaged build ALWAYS locks, whatever the environment says — the env var
// is a test seam, not a supported user setting. Dev keeps the lock too,
// because the confusing double-boot is the real bug it fixes.
// ---------------------------------------------------------------------------
const singleInstanceLockRequested = app.isPackaged || !process.env.STRIX_DISABLE_SINGLE_INSTANCE
const gotSingleInstanceLock = singleInstanceLockRequested ? app.requestSingleInstanceLock() : true

if (!gotSingleInstanceLock) {
  // eslint-disable-next-line no-console
  console.info('[main] another StrixGeo instance owns the lock — focusing it and exiting')
  app.quit()
} else {
  // Electron delivers this in the FIRST instance when a second one starts and
  // fails the lock. The user's intent was "show me StrixGeo", so treat the
  // launch as a focus request.
  //
  // ``argv`` is LOGGED AND OTHERWISE DROPPED, on purpose and visibly. A second
  // instance can carry a file path ("Open with… StrixGeo" on a .strix, a
  // shell drag onto the icon) and today that path goes nowhere — the user sees
  // the already-open project and no error. Opening it is a deep-link feature
  // with its own dirty-project handshake to design (docs/debt.md #200); until
  // then the log line is what makes the drop findable instead of a mystery.
  app.on('second-instance', (_event, argv) => {
    const shown = argv.map(a => `"${a}"`).join(' ').slice(0, 500)
    // eslint-disable-next-line no-console
    console.info(`[main] second instance launched: ${shown}`)
    if (mainWindow === null) {
      // Between ``app.quit()`` and process exit, or before the first window
      // exists. Nothing to focus, and nothing to hand the argv to.
      // eslint-disable-next-line no-console
      console.info('[main] second instance ignored — no window to focus yet')
      return
    }
    // ``show`` alone does not un-minimise on Windows, and ``focus`` on a
    // minimised window does nothing visible — restore first.
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    // Pre-authorise every path in the recent-projects list — without
    // this the first "Open Recent" click after launch would hit the
    // path-validation in project:read-file and get refused (debt #37).
    bootstrapAuthorisedPaths()
    // Seed the menu language from the OS locale so the very first paint matches a
    // Dutch machine instead of flashing English. This is only the SYSTEM-language
    // tier of the renderer's rule; the renderer reports its full resolved choice
    // (which includes the Settings override) over ``window:set-language`` once it
    // has loaded, and the menu rebuilds then. ``app.getLocale()`` is reliable
    // after ``whenReady`` and mirrors the renderer's ``navigator.language``.
    menuLanguage = narrowMenuLanguage(app.getLocale())
    // Packaged builds move the live cluster off the Roaming profile and point
    // the embedded layout at Local BEFORE the database starts (M1). The DB boot
    // itself is deferred to just below, after the licence gate is known, so the
    // engine can be spawned CONCURRENTLY with the cluster coming up (installer
    // #13: the two ran in series). A dev session has no embedded stack and keeps
    // talking to Docker on :5433 (debt #2, Fork A).
    if (app.isPackaged) {
      relocateMachineLocalStores()
    }
    // The recovery store has no Electron dependency of its own (so it stays
    // unit-testable), so it learns the userData directory and app version here.
    // Must happen before any renderer can issue a ``recovery:*`` call.
    configureRecoveryStore({
      userDataDir: app.getPath('userData'),
      appVersion: app.getVersion(),
    })
    // #16 — local diagnostics. Configured before anything can crash into it,
    // and before the beta gate below, so a gate failure is itself captured.
    configureDiagnosticsStore({
      userDataDir: app.getPath('userData'),
      appVersion: app.getVersion(),
      platform: process.platform,
      buildId: betaBuildStamp?.buildId,
    })
    configureBetaExpiryStore({ userDataDir: app.getPath('userData') })

    // Activation (#3). The store learns userData + the stable hardware-derived
    // device id (so a reinstall re-binds the same seat); the issuer is the mock
    // when no base URL is configured, the real HTTP client when one is
    // (activationConfig) — the default (mock) keeps the dogfeed unchanged.
    // Registered before any renderer can issue an ``activation:*`` call.
    const deviceIdentity = resolveDeviceIdentity()
    configureActivationStore({
      userDataDir: app.getPath('userData'),
      deviceIdSeed: deviceIdentity.deviceId,
    })
    const activationService = new ActivationService({
      repository: createActivationRepository({
        env: process.env,
        packaged: app.isPackaged,
        appVersion: app.getVersion(),
        // Electron's net.fetch: the Windows proxy settings and the OS
        // certificate store apply, like the browser that DID reach the server
        // from the owner's work PC (2026-09-23). Node's global fetch honours
        // neither, which is what made the activation server "unreachable".
        fetchImpl: chromiumFetch(net),
      }),
      deviceLabel: deviceIdentity.deviceLabel,
    })
    // A deferred backend (launch blocked on the licence gate below) starts the
    // moment activation succeeds; a running backend is left alone.
    registerPrototypeIpc(activationService, {
      previewControl: previewControlAllowed(app.isPackaged),
      onActivated: () => {
        if (apiProcess === null) startApi()
      },
    })

    if (enforceBetaExpiry()) return
    startBetaExpiryWatch()

    // Licence gate (audit C3d): a packaged, non-beta build with a blocked
    // verdict shows the window (the licensing dialog talks to main over IPC,
    // not to the backend) but does NOT start the engine until activation
    // succeeds. Dev, e2e and stamped beta builds never block.
    const launchBlocked = activationBlocksLaunch({
      packaged: app.isPackaged,
      e2e: e2eLaunchFlag(process.env, app.isPackaged),
      verdict: activationService.getStatus().verdict,
    })
    // Packaged: boot the embedded DB and — if the gate allows — spawn the engine
    // CONCURRENTLY with the cluster coming up (no engine before the gate passes;
    // the DB boots regardless so a deferred build has a database ready for the
    // engine that activation starts later). Dev: no embedded DB, so start the
    // backend directly unless the gate blocks (it never does in dev).
    if (app.isPackaged) {
      if (!(await bootEmbeddedDatabase(() => !launchBlocked))) return
      if (launchBlocked) {
        writeMainLog(
          '[activation] launch blocked by the licence gate — backend deferred until activation',
        )
      }
    } else if (!launchBlocked) {
      startApi()
    }
    createWindow()
    // Renewals reach the client on the next launch (audit H5); dormant without an issuer.
    void activationService.refreshOnLaunch()

    // #16 transmit half — flush any consented, captured diagnostics to the
    // activation origin. Inert unless consent is on AND an activation URL is
    // configured, so the mock/dogfeed default sends nothing.
    startDiagnosticsUpload()

    // Auto-update check (#6) — a no-op in dev (gated on app.isPackaged). The
    // window exists now, so its renderer can receive update events.
    checkForUpdatesOnLaunch()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

// H1 — the backend + database are torn down only on the events that fire AFTER
// every window has closed (i.e. after the renderer answered the save-or-discard
// prompt), never on ``before-quit``. Electron fires ``before-quit`` ahead of the
// window ``close`` handler that runs the prompt, so a stop there ran the Save
// against a dead API (docs/design/autosave-recovery.md §4). The ordering is
// pinned in ./backendLifecycle so it is testable without Electron.
//
// The teardown is the deterministic ``runShutdown`` (owner ruling 2026-09-06):
// it kills the engine + database process trees with a 2s hard deadline, then the
// per-event hook exits the process. Idempotent, so the two events a graceful
// quit fires run it once.
registerBackendLifecycle(app, {
  stopBackend: () => runShutdown('graceful'),
  onWindowAllClosed: () => {
    // macOS keeps the app (and its backend) alive after its last window closes;
    // every other platform exits now that the teardown has run. ``app.exit``
    // forces an immediate, deterministic process exit - no blocking wait can
    // keep ``StrixGeo.exe`` alive for the installer to trip over.
    if (process.platform !== 'darwin') app.exit(0)
  },
  onWillQuit: () => {
    // Any ``app.quit()`` with no window to close (beta expiry, the lost
    // single-instance lock) reaches here - exit once the teardown has run.
    app.exit(0)
  },
})
