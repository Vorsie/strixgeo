/**
 * IPC registration for the launch-prototype slices (Electron main process).
 *
 * Extracted from ``index.ts`` so the god-component (debt #201) does not grow:
 * the activation (#3) and updater (#6) handlers live here, and ``index.ts`` only
 * creates the {@link ActivationService} and calls {@link registerPrototypeIpc}
 * once.
 *
 * Every handler is a thin adapter — it validates the argument shape and forwards
 * to the service / updater module. No business logic lives here.
 */

import { ipcMain } from 'electron'

import type { LicenceState } from './activation'
import type { ActivationService, ActivationStatus, ActivationActionResult } from './activationService'
import { checkForUpdates, downloadUpdate, quitAndInstall } from './updaterService'

/** Every licence state the prototype preview control may request. */
const PREVIEWABLE_STATES: ReadonlySet<LicenceState> = new Set<LicenceState>([
  'unactivated',
  'trial',
  'active',
  'grace',
  'expired',
  'clock-rollback',
])

/** Options controlling which prototype-only handlers are registered. */
export interface PrototypeIpcOptions {
  /**
   * Whether to register the dev-only ``activation:preview-state`` handler. False
   * in a packaged build so the demo control cannot ship (senior review
   * SHOULD-FIX 1); ``index.ts`` passes ``previewControlAllowed(app.isPackaged)``.
   */
  previewControl: boolean
}

/**
 * Register the activation + updater IPC handlers.
 *
 * Parameters
 * ----------
 * service : ActivationService
 *     The configured activation orchestrator (created in ``index.ts`` after the
 *     store is pointed at ``userData``).
 * options : PrototypeIpcOptions
 *     Which prototype-only handlers to register (see {@link PrototypeIpcOptions}).
 */
export function registerPrototypeIpc(service: ActivationService, options: PrototypeIpcOptions): void {
  // ---- Activation (#3) ----------------------------------------------------
  ipcMain.handle('activation:status', (): ActivationStatus => service.getStatus())

  ipcMain.handle('activation:activate', (_event, key: unknown): Promise<ActivationActionResult> => {
    if (typeof key !== 'string' || key.trim() === '') {
      return Promise.resolve({ ok: false, code: 'unknown_key', message: 'enter a licence key' })
    }
    return service.activate(key.trim())
  })

  ipcMain.handle('activation:start-trial', (): Promise<ActivationActionResult> => service.startTrial())

  ipcMain.handle('activation:deactivate', async (): Promise<ActivationActionResult> => {
    // Self-service deactivate / transfer (ruling 15). The service frees the seat
    // on the server and clears the local licence on success (or a 404 = already
    // released there); a 401 / network failure keeps the local licence. Log the
    // outcome so a support report can see whether the seat was actually freed —
    // never the licence key.
    const result = await service.deactivate()
    if (result.ok) {
      console.info(`[main] activation deactivate -> ${result.status.verdict.state}`)
    } else {
      console.warn(`[main] activation deactivate refused (${result.code}) — local licence kept`)
    }
    return result
  })

  // Prototype-only: force a state so the owner can see each screen. Registered
  // ONLY in a dev build — a packaged build never carries the demo control (senior
  // review SHOULD-FIX 1; see the design note).
  if (options.previewControl) {
    ipcMain.handle('activation:preview-state', (_event, state: unknown): ActivationStatus => {
      if (typeof state !== 'string' || !PREVIEWABLE_STATES.has(state as LicenceState)) {
        return service.getStatus()
      }
      return service.previewState(state as LicenceState)
    })
  }

  // ---- Updater (#6) -------------------------------------------------------
  // Manual check — the renderer's "Check for updates". Fire-and-forget: results
  // arrive as UPDATER_EVENT_CHANNEL messages, not as this call's return value.
  ipcMain.handle('updater:check', (): void => checkForUpdates(true))
  ipcMain.handle('updater:download', (): void => downloadUpdate())
  ipcMain.handle('updater:quit-and-install', (): void => quitAndInstall())
}
