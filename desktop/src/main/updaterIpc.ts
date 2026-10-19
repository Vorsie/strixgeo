/**
 * IPC registration for the updater slice (Electron main process).
 *
 * Extracted from ``index.ts`` so the god-component (debt #201) does not grow:
 * the updater (#6) handlers live here, and ``index.ts`` only calls
 * {@link registerUpdaterIpc} once.
 *
 * Every handler is a thin adapter — it validates the argument shape and forwards
 * to the updater module. No business logic lives here.
 */

import { ipcMain } from 'electron'

import {
  checkForUpdates,
  downloadUpdate,
  lastReplayableUpdaterEvent,
  quitAndInstall,
  type UpdaterEvent,
} from './updaterService'
import { readCheckAtStart, writeCheckAtStart } from './updaterPreferenceStore'

/** Register the updater IPC handlers. */
export function registerUpdaterIpc(): void {
  // ---- Updater (#6) -------------------------------------------------------
  // Manual check — the renderer's "Check for updates". Fire-and-forget: results
  // arrive as UPDATER_EVENT_CHANNEL messages, not as this call's return value.
  ipcMain.handle('updater:check', (): void => checkForUpdates(true))
  ipcMain.handle('updater:download', (): void => downloadUpdate())
  ipcMain.handle('updater:quit-and-install', (): void => quitAndInstall())
  // Pull the latched answer (owner finding 2026-10-08): an update card that
  // mounts AFTER the launch check answered, and after the did-finish-load
  // replay, still learns there is an update. Additive; an old renderer never asks.
  ipcMain.handle('updater:last-event', (): UpdaterEvent | null => lastReplayableUpdaterEvent())
  // "Check for updates at start" (owner ruling 2026-10-11). Main owns the value
  // because the start check runs before any renderer exists; the Settings
  // dialog mirrors it. Additive; a non-boolean argument changes nothing and the
  // handler answers the stored value either way.
  ipcMain.handle('updater:get-check-at-start', (): boolean => readCheckAtStart())
  ipcMain.handle('updater:set-check-at-start', (_event, enabled: unknown): boolean => {
    if (typeof enabled !== 'boolean') return readCheckAtStart()
    writeCheckAtStart(enabled)
    console.info(`[main] updater check at start -> ${enabled ? 'on' : 'off'}`)
    return readCheckAtStart()
  })
}
