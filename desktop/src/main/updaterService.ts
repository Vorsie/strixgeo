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
  shouldAutoCheckOnLaunch,
  summariseUpdateInfo,
  type UpdateAvailableNotice,
} from './updaterPolicy'

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
}

let targetWindow: BrowserWindow | null = null
let wired = false

/** Push one event to the renderer, if a window is attached. */
function emit(event: UpdaterEvent): void {
  targetWindow?.webContents.send(UPDATER_EVENT_CHANNEL, event)
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
  autoUpdater.on('error', (err: Error) =>
    emit({ phase: 'error', message: err?.message ?? 'update check failed' }),
  )
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
  autoUpdater.checkForUpdates().catch((err: unknown) => {
    console.warn(`[updater] check failed: ${err instanceof Error ? err.message : String(err)}`)
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
  void autoUpdater.downloadUpdate()
}

/** Quit and install a downloaded update (the renderer's "Restart" choice). */
export function quitAndInstall(): void {
  if (!app.isPackaged) return
  autoUpdater.quitAndInstall()
}
