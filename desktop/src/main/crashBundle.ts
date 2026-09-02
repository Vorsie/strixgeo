/**
 * The crash bundle a tester can be asked to send by hand — debt #16.
 *
 * One ``.zip``, assembled on demand, containing only files this module names.
 * It is the USER-DRIVEN half of crash reporting: the automatic half is the
 * consent-gated ``diagnosticsUploader.ts``, but "save a bundle to send by hand"
 * stays available for a user who has not opted in to transmission, or who wants
 * to open and inspect the artefact first.
 *
 * ## The promise the bundle keeps
 *
 * **Everything inside is safe to send.** Two different mechanisms get it there:
 *
 * * ``diagnostics.log`` is redacted *by construction* — every line went through
 *   the field whitelist and the redaction pass before it was ever written.
 * * ``backend.log`` is NOT — it carries the asyncpg DSN (password included) and
 *   raw file paths, because it is the backend's own stdout. So it is redacted
 *   **here**, on the way into the archive, line by line.
 *
 * Nothing else from the logs directory is included. A whitelist, not a sweep:
 * whatever else ends up in that directory in future does not silently start
 * travelling with support bundles.
 *
 * ## Bounded
 *
 * ``backend.log`` is trimmed to its tail ({@link BACKEND_LOG_TAIL_BYTES}) — the
 * end of the log is where the crash is, and a 5 MiB attachment is not a support
 * flow. The trim is marked in the file so nobody reads the first surviving line
 * as the start of the session.
 */

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

import { redactText } from './diagnosticsRedaction'
import {
  DIAGNOSTICS_MAX_FILES,
  diagnosticsBuildFacts,
  diagnosticsLogPath,
  readDiagnosticEvents,
} from './diagnosticsStore'
import { createZipArchive, type ZipEntry } from './zipArchive'

/** Manifest envelope discriminator. */
export const CRASH_BUNDLE_KIND = 'strixgeo.crash-bundle'

/** Manifest version. */
export const CRASH_BUNDLE_FORMAT_VERSION = 1

/** Name of the backend log inside Electron's logs directory. */
export const BACKEND_LOG_FILENAME = 'backend.log'

/**
 * How much of the backend log travels.
 *
 * 256 KiB is ~2 500 log lines — comfortably past the start of any crash — and
 * compresses to well under a megabyte.
 */
export const BACKEND_LOG_TAIL_BYTES = 256 * 1024

/** Marker written at the top of a trimmed log so the cut is visible. */
export const TRIM_MARKER = '[earlier lines trimmed]'

/** Inputs to {@link buildCrashBundle}. */
export interface CrashBundleOptions {
  /** Electron's ``app.getPath('logs')`` — where ``backend.log`` lives. */
  logsDir: string
  /** The recorded transmission-consent answer, recorded in the manifest. */
  consent: boolean
  /** Timestamp override — tests pin it; production leaves it unset. */
  nowIso?: string
}

/** What the bundle says about itself. */
export interface CrashBundleManifest {
  kind: string
  format_version: number
  bundleId: string
  createdAt: string
  appVersion: string
  platform: string
  buildId?: string
  /** Whether the user had opted in to transmission at bundle time. */
  transmissionOptIn: boolean
  /** How many diagnostic events the bundle carries. */
  eventCount: number
  /** Every entry in the archive except the manifest itself. */
  contents: string[]
  /** Plain-language statement of what was removed, for the person sending it. */
  redaction: string
}

/** The assembled archive. */
export interface CrashBundle {
  /** Suggested file name for the save dialog. */
  fileName: string
  /** The archive bytes. */
  bytes: Buffer
  /** The manifest, also embedded in the archive. */
  manifest: CrashBundleManifest
}

/**
 * Suggested file name for a bundle created at ``nowIso``.
 *
 * Colons are illegal in Windows file names, so the ISO timestamp is written
 * with dashes and the sub-second part dropped.
 *
 * Parameters
 * ----------
 * nowIso : string
 *     ISO-8601 creation timestamp.
 *
 * Returns
 * -------
 * string
 *     e.g. ``strixgeo-diagnostics-2026-08-26T12-34-56.zip``.
 */
export function crashBundleFileName(nowIso: string): string {
  const stamp = nowIso.replace(/\.\d+Z?$/, '').replace(/:/g, '-')
  return `strixgeo-diagnostics-${stamp}.zip`
}

/** The tail of a log file, redacted line by line, with the cut marked. */
function readRedactedLogTail(path: string): string | null {
  if (!existsSync(path)) return null

  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return null
  }

  let trimmed = false
  if (text.length > BACKEND_LOG_TAIL_BYTES) {
    text = text.slice(text.length - BACKEND_LOG_TAIL_BYTES)
    // Drop the partial first line so the tail starts on a real record.
    const firstBreak = text.indexOf('\n')
    if (firstBreak >= 0) text = text.slice(firstBreak + 1)
    trimmed = true
  }

  const body = text
    .split('\n')
    .map(line => redactText(line))
    .join('\n')

  return trimmed ? `${TRIM_MARKER}\n${body}` : body
}

/** Raw content of a file, or ``null`` when it is absent or unreadable. */
function readIfPresent(path: string): string | null {
  if (!existsSync(path)) return null
  try {
    return readFileSync(path, 'utf-8')
  } catch {
    return null
  }
}

/**
 * Assemble a crash bundle from the local artefacts.
 *
 * Parameters
 * ----------
 * options : CrashBundleOptions
 *     Logs directory, the consent answer, and an optional timestamp override.
 *
 * Returns
 * -------
 * CrashBundle
 *     File name, archive bytes and the manifest.
 *
 * Raises
 * ------
 * Error
 *     When the diagnostics store has not been configured — assembling a bundle
 *     without knowing which build it describes would produce a useless
 *     artefact, so this one does not degrade quietly.
 */
export function buildCrashBundle(options: CrashBundleOptions): CrashBundle {
  const facts = diagnosticsBuildFacts()
  const createdAt = options.nowIso ?? new Date().toISOString()

  const entries: ZipEntry[] = []

  const primary = readIfPresent(diagnosticsLogPath())
  if (primary !== null) entries.push({ name: 'diagnostics.log', data: primary })

  // Rotated generations, when the tester has been crashing enough to fill one.
  for (let generation = 1; generation <= DIAGNOSTICS_MAX_FILES; generation++) {
    const rotated = readIfPresent(`${diagnosticsLogPath()}.${generation}`)
    if (rotated !== null) entries.push({ name: `diagnostics.log.${generation}`, data: rotated })
  }

  const backend = readRedactedLogTail(join(options.logsDir, BACKEND_LOG_FILENAME))
  if (backend !== null) entries.push({ name: BACKEND_LOG_FILENAME, data: backend })

  const manifest: CrashBundleManifest = {
    kind: CRASH_BUNDLE_KIND,
    format_version: CRASH_BUNDLE_FORMAT_VERSION,
    bundleId: `${createdAt}-${facts.appVersion}`,
    createdAt,
    appVersion: facts.appVersion,
    platform: facts.platform,
    ...(facts.buildId === undefined ? {} : { buildId: facts.buildId }),
    transmissionOptIn: options.consent,
    eventCount: readDiagnosticEvents().length,
    contents: entries.map(entry => entry.name),
    redaction:
      'User names, home directories, project and data-file paths, email ' +
      'addresses, database connection strings, routable IP addresses, URL ' +
      'query strings and site coordinates have been removed. Record ids ' +
      '(UUIDs), routes, HTTP statuses and stack frames are kept.',
  }

  entries.unshift({ name: 'manifest.json', data: `${JSON.stringify(manifest, null, 2)}\n` })

  return {
    fileName: crashBundleFileName(createdAt),
    bytes: createZipArchive(entries, new Date(createdAt)),
    manifest,
  }
}
