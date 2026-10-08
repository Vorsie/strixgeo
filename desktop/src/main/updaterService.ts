/**
 * Auto-update wiring (Electron main process) — PROTOTYPE. Debt #6.
 *
 * The side-effecting half of the updater: it wires ``electron-updater``'s
 * ``autoUpdater`` events onto the renderer and exposes check / download /
 * quit-and-install. The pure decision + shaping half is {@link ./updaterPolicy}.
 *
 * ## Guards, so the dev workflow is untouched
 *
 * Every auto path is gated on ``app.isPackaged``:
 *   * a dev launch never auto-checks ({@link ./updaterPolicy.shouldAutoCheckOnLaunch});
 *   * a manual "Check for updates" in dev reports ``disabled`` and does nothing,
 *     so the renderer UX is still demonstrable without a feed.
 * ``electron-updater`` itself throws in an unpackaged app ("dev-app-update.yml
 * not found"), which is the other reason the gate matters.
 *
 * ## What is REAL vs MOCKED
 *
 * REAL: the event plumbing, the ``autoDownload = false`` (renderer decides), the
 * download-progress relay, the quit-and-install call, and — once a draft release
 * is published — the GitHub Releases feed. The feed is configured through
 * ``electron-builder``'s ``publish`` block in ``package.json`` (provider github,
 * Vorsie/strixgeo-releases), which generates the ``app-update.yml``
 * ``electron-updater`` reads; no ``setFeedURL`` call is needed. Until a release
 * is PUBLISHED (``releaseType: draft`` keeps new builds invisible until a human
 * clicks Publish), a packaged check resolves to ``not-available`` / ``error``.
 * The remaining production gap is code-signing (#6) so a downloaded update is
 * trusted.
 */

import { app, type BrowserWindow } from 'electron'
import { autoUpdater, type UpdateInfo, type ProgressInfo } from 'electron-updater'

import {
  autoInstallOnQuit,
  classifyUpdaterError,
  shouldAutoCheckOnLaunch,
  shouldReplayOnLoad,
  summariseUpdateInfo,
  type UpdateAvailableNotice,
  type UpdaterErrorReason,
} from './updaterPolicy'
import {
  createUpdaterLogger,
  describeCheckFailure,
  describeUpdaterEvent,
  shouldLogUpdaterEvent,
  type UpdaterLineWriter,
} from './updaterLog'

/**
 * Whether this build is code-signed. FALSE until the signing cert lands (debt
 * #6): the closed beta ships unsigned (owner ruling 2026-09-02). Flip to true in
 * the same change that wires electron-builder's signing, so ``autoInstallOnQuit``
 * turns the silent quit-time install back on only for a trusted binary.
 */
const APP_IS_SIGNED = false

/** The channel the renderer subscribes to for every updater state change. */
export const UPDATER_EVENT_CHANNEL = 'updater:event'

/** Where the updater is in its lifecycle — the renderer switches its UI on this. */
export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  // The feed answered, there is simply nothing published yet — the closed
  // beta's normal state (owner finding (g)). Calm, NOT a failure.
  | 'no-release'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled'

/** One update-state message pushed to the renderer. */
export interface UpdaterEvent {
  phase: UpdaterPhase
  /** Present on ``available`` / ``downloaded`` — what is on offer. */
  notice?: UpdateAvailableNotice
  /** Present on ``downloading`` — whole-percent 0..100. */
  progressPercent?: number
  /** Present on ``error`` / ``disabled`` — a loggable, showable line. */
  message?: string
  /** Present on ``error`` — which cause the renderer should name (finding (g)). */
  errorReason?: UpdaterErrorReason
}

/**
 * Shape an ``autoUpdater`` error into an event the renderer can present.
 *
 * A feed with no release published yet is the closed beta's normal state, not a
 * failure — it becomes the calm ``no-release`` phase. A genuine failure keeps
 * the ``error`` phase but carries a ``reason`` so the renderer can name the
 * cause (offline / blocked / unexpected). See {@link classifyUpdaterError}.
 */
function updaterErrorEvent(err: Error): UpdaterEvent {
  const code = (err as { code?: string }).code ?? null
  const classification = classifyUpdaterError({ message: err?.message, code })
  if (classification.kind === 'no-release') return { phase: 'no-release' }
  return {
    phase: 'error',
    errorReason: classification.reason,
    message: err?.message ?? 'update check failed',
  }
}

let targetWindow: BrowserWindow | null = null
let wired = false

/**
 * The last event pushed, so a renderer that loads AFTER the launch check has
 * answered still learns what it said (owner 2026-09-26: no prompt on startup,
 * a manual check worked). See {@link replayLastUpdaterEvent}.
 */
let lastEvent: UpdaterEvent | null = null

/**
 * Where updater lines go. The console until {@link attachUpdaterLogger} hands
 * over the main-log writer (a packaged app has no terminal, so a console line
 * there reaches nobody; owner finding 2026-10-08).
 */
let writeLine: UpdaterLineWriter = line => console.log(line)

/**
 * Route every updater line into the main log.
 *
 * Sets ``autoUpdater.logger`` to an ``[updater]``-prefixed adapter over
 * ``write``, so electron-updater's own messages (feed URL, versions, HTTP
 * errors) land in ``backend.log`` next to the service's phase lines.
 *
 * Parameters
 * ----------
 * write : UpdaterLineWriter
 *     The main-log writer (``writeMainLog`` in ``index.ts``).
 */
export function attachUpdaterLogger(write: UpdaterLineWriter): void {
  writeLine = write
  autoUpdater.logger = createUpdaterLogger(write)
}

/** Push one event to the renderer, if a window is attached; remember it; log it. */
function emit(event: UpdaterEvent): void {
  if (shouldLogUpdaterEvent(event, lastEvent)) writeLine(describeUpdaterEvent(event))
  lastEvent = event
  targetWindow?.webContents.send(UPDATER_EVENT_CHANNEL, event)
}

/**
 * The latched event a renderer should still be shown, or null.
 *
 * Only phases that ask something of the engineer ({@link shouldReplayOnLoad}).
 * Served to the renderer on request (``updater:last-event``) so a notification
 * that MOUNTS late (App switches render branches, or the backend never became
 * ready and the card mounts on the loading screen) still shows the answer the
 * launch check gave before it existed.
 *
 * Returns
 * -------
 * UpdaterEvent | null
 *     The last replayable event, or null.
 */
export function lastReplayableUpdaterEvent(): UpdaterEvent | null {
  return lastEvent !== null && shouldReplayOnLoad(lastEvent) ? lastEvent : null
}

/**
 * Re-send the last updater event to the attached window.
 *
 * Called from the window's ``did-finish-load``: the launch check fires as soon
 * as the window exists, and the feed usually answers before the document has
 * loaded and the renderer has subscribed, so the first send went to nobody.
 * Only phases that ask something of the engineer are replayed
 * ({@link shouldReplayOnLoad}); a reload never re-toasts a calm result.
 */
export function replayLastUpdaterEvent(): void {
  const replay = lastReplayableUpdaterEvent()
  if (replay === null) return
  targetWindow?.webContents.send(UPDATER_EVENT_CHANNEL, replay)
}

/**
 * Attach the updater to a window and wire ``autoUpdater``'s events once.
 *
 * Safe to call in dev: it only registers listeners and flips ``autoDownload``
 * off. No network happens until {@link checkForUpdates} runs, which is itself
 * gated on ``app.isPackaged``.
 *
 * Parameters
 * ----------
 * win : BrowserWindow
 *     The renderer that receives {@link UPDATER_EVENT_CHANNEL} messages.
 */
export function configureUpdater(win: BrowserWindow): void {
  targetWindow = win
  if (wired) return
  wired = true

  // The renderer decides when to download (the "Download / Later" choice), so
  // the updater must not pull bytes on its own.
  autoUpdater.autoDownload = false
  // Never silently install an unsigned update on quit (audit H6). The explicit
  // "Install now" path (``updater:quit-and-install`` → {@link quitAndInstall})
  // stays available. Turns back on for a signed build via APP_IS_SIGNED.
  autoUpdater.autoInstallOnAppQuit = autoInstallOnQuit(APP_IS_SIGNED)

  autoUpdater.on('checking-for-update', () => emit({ phase: 'checking' }))
  autoUpdater.on('update-available', (info: UpdateInfo) =>
    emit({ phase: 'available', notice: summariseUpdateInfo(info) }),
  )
  autoUpdater.on('update-not-available', () => emit({ phase: 'not-available' }))
  autoUpdater.on('download-progress', (progress: ProgressInfo) =>
    emit({ phase: 'downloading', progressPercent: Math.round(progress.percent) }),
  )
  autoUpdater.on('update-downloaded', (info: UpdateInfo) =>
    emit({ phase: 'downloaded', notice: summariseUpdateInfo(info) }),
  )
  // A feed with no published release yet reaches us here as an error event; it
  // is classified into the calm ``no-release`` phase rather than a failure
  // (owner finding (g)). A real failure keeps ``error`` and names its cause.
  autoUpdater.on('error', (err: Error) => emit(updaterErrorEvent(err)))
}

/**
 * Check for updates.
 *
 * Parameters
 * ----------
 * manual : boolean
 *     True when the user asked (Help → Check for updates), false for the launch
 *     check. A manual check in dev reports ``disabled`` so the UX still responds;
 *     a launch check in dev is a silent no-op.
 */
export function checkForUpdates(manual: boolean): void {
  writeLine(`[updater] check requested (${manual ? 'manual' : 'launch'}, packaged=${app.isPackaged})`)
  if (!app.isPackaged) {
    // Dev: no feed, and electron-updater would throw. Tell the user only when
    // they asked; stay silent on the launch path.
    if (manual) {
      emit({
        phase: 'disabled',
        message: 'Updates are disabled in development. A packaged build checks the release feed.',
      })
    }
    return
  }
  // The feed comes from electron-builder's `publish` block (app-update.yml).
  // Until a draft release is PUBLISHED on Vorsie/strixgeo-releases, this
  // resolves to `not-available` / `error`.
  // A feed with no published release (draft-only, as the closed beta ships)
  // rejects; that is a warning for the log, never an unhandled rejection.
  // The line goes to the main log: a packaged app has no console to read.
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    writeLine(describeCheckFailure(err))
  })
}

/**
 * Auto-check on launch, gated on ``app.isPackaged``.
 *
 * Called from ``app.whenReady`` after the window exists. A dev launch returns
 * immediately.
 */
export function checkForUpdatesOnLaunch(): void {
  if (!shouldAutoCheckOnLaunch(app.isPackaged)) return
  checkForUpdates(false)
}

/** Begin downloading the available update (the renderer's "Download" choice). */
export function downloadUpdate(): void {
  if (!app.isPackaged) return
  writeLine('[updater] download requested')
  // A failed download also arrives as an ``error`` event (shown + logged by
  // emit); the rejection is caught so it is never an unhandled one.
  autoUpdater.downloadUpdate().catch((err: unknown) => {
    writeLine(`[updater] download failed: ${err instanceof Error ? err.message : String(err)}`)
  })
}

/** Quit and install a downloaded update (the renderer's "Restart" choice). */
export function quitAndInstall(): void {
  if (!app.isPackaged) return
  writeLine('[updater] quit and install requested')
  autoUpdater.quitAndInstall()
}
