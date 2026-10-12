/**
 * Updater preferences on disk (Electron main process). Owner ruling 2026-10-11.
 *
 * Two small files in ``<userData>``:
 *
 * * ``updater-preferences.json`` - the "Check for updates at start" setting.
 *   The updater runs in MAIN at launch, before any renderer exists, so the
 *   setting cannot live in renderer localStorage. Default ON; every damaged-file
 *   case reads as the default, so a corrupt file never silently stops the
 *   start check.
 * * ``updater-pending-download.json`` - the version and file of the last
 *   finished download, so the next start can offer "Install and restart" for it
 *   without a new download (see ``updaterPolicy.shouldResumePendingDownload``).
 *
 * Same injection pattern as ``betaExpiryStore.ts``: no ``import 'electron'``,
 * so vitest exercises it; ``index.ts`` calls
 * {@link configureUpdaterPreferenceStore} once at startup.
 */

import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'

import { writeFileAtomic } from './atomicWrite'
import type { PendingDownload } from './updaterPolicy'

/** Name of the preference file inside the user-data directory. */
export const UPDATER_PREFERENCES_FILENAME = 'updater-preferences.json'

/** Name of the pending-download record inside the user-data directory. */
export const UPDATER_PENDING_FILENAME = 'updater-pending-download.json'

/** Envelope discriminator of the preference file. */
export const UPDATER_PREFERENCES_KIND = 'strixgeo.updater-preferences'

/** Envelope discriminator of the pending-download record. */
export const UPDATER_PENDING_KIND = 'strixgeo.updater-pending'

/** Envelope version of both files. */
export const UPDATER_STORE_FORMAT_VERSION = 1

/** The ruling's default: check at start. */
export const CHECK_AT_START_DEFAULT = true

/** Read cap: each file holds a flag or a version and a path. */
const UPDATER_STORE_CAP_BYTES = 8 * 1024

/** Injected configuration: the directory the files live in. */
export interface UpdaterPreferenceStoreConfig {
  /** Absolute path to Electron's ``userData`` directory. */
  userDataDir: string
}

let config: UpdaterPreferenceStoreConfig | null = null

/**
 * Point the store at a user-data directory.
 *
 * Parameters
 * ----------
 * next : UpdaterPreferenceStoreConfig
 *     Directory the files live in.
 */
export function configureUpdaterPreferenceStore(next: UpdaterPreferenceStoreConfig): void {
  config = next
}

/** Drop the configuration (test-only, so one spec cannot leak into the next). */
export function resetUpdaterPreferenceStoreForTests(): void {
  config = null
}

/** Read one of our JSON envelopes, or null when absent, oversized, foreign or unreadable. */
function readEnvelope(filename: string, kind: string): Record<string, unknown> | null {
  if (config === null) return null
  const path = join(config.userDataDir, filename)
  if (!existsSync(path)) return null
  try {
    const text = readFileSync(path, 'utf-8')
    if (text.length > UPDATER_STORE_CAP_BYTES) return null
    const raw: unknown = JSON.parse(text)
    if (typeof raw !== 'object' || raw === null) return null
    const envelope = raw as Record<string, unknown>
    return envelope.kind === kind ? envelope : null
  } catch {
    return null
  }
}

/** Write one of our JSON envelopes atomically. Throws when the store is not configured. */
function writeEnvelope(filename: string, body: Record<string, unknown>): void {
  if (config === null) throw new Error('updater preference store is not configured')
  mkdirSync(config.userDataDir, { recursive: true })
  writeFileAtomic(join(config.userDataDir, filename), `${JSON.stringify(body, null, 2)}\n`)
}

/**
 * Whether the app checks for updates at start.
 *
 * Returns
 * -------
 * boolean
 *     The recorded choice; ``true`` (the default) when nothing readable is
 *     recorded or the store is not configured.
 */
export function readCheckAtStart(): boolean {
  const envelope = readEnvelope(UPDATER_PREFERENCES_FILENAME, UPDATER_PREFERENCES_KIND)
  // Strictly a boolean: the string "false" must not be read as a choice.
  if (envelope === null || typeof envelope.checkAtStart !== 'boolean') return CHECK_AT_START_DEFAULT
  return envelope.checkAtStart
}

/**
 * Record the "Check for updates at start" choice.
 *
 * Parameters
 * ----------
 * enabled : boolean
 *     True to check at start, false for no automatic check at all.
 *
 * Raises
 * ------
 * Error
 *     When the store is not configured, or the write fails.
 */
export function writeCheckAtStart(enabled: boolean): void {
  writeEnvelope(UPDATER_PREFERENCES_FILENAME, {
    kind: UPDATER_PREFERENCES_KIND,
    format_version: UPDATER_STORE_FORMAT_VERSION,
    checkAtStart: enabled,
  })
}

/**
 * The update downloaded in an earlier session, if any.
 *
 * Returns
 * -------
 * PendingDownload | null
 *     The record, or null when none is readable.
 */
export function readPendingDownload(): PendingDownload | null {
  const envelope = readEnvelope(UPDATER_PENDING_FILENAME, UPDATER_PENDING_KIND)
  if (envelope === null) return null
  if (typeof envelope.version !== 'string' || typeof envelope.downloadedFile !== 'string') return null
  return { version: envelope.version, downloadedFile: envelope.downloadedFile }
}

/**
 * Remember (or forget, with null) the finished download.
 *
 * Parameters
 * ----------
 * record : PendingDownload | null
 *     The download to remember, or null to remove the record.
 *
 * Raises
 * ------
 * Error
 *     When the store is not configured, or the write fails.
 */
export function writePendingDownload(record: PendingDownload | null): void {
  if (record === null) {
    if (config === null) return
    rmSync(join(config.userDataDir, UPDATER_PENDING_FILENAME), { force: true })
    return
  }
  writeEnvelope(UPDATER_PENDING_FILENAME, {
    kind: UPDATER_PENDING_KIND,
    format_version: UPDATER_STORE_FORMAT_VERSION,
    version: record.version,
    downloadedFile: record.downloadedFile,
  })
}
