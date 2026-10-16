/**
 * Local diagnostics log (Electron main process) — debt #16, capture half.
 *
 * Writes one NDJSON line per captured problem to
 * ``<userData>/diagnostics/diagnostics.log``, rotated by size through the same
 * helper the backend log uses (``logRotation.ts``). Nothing is transmitted:
 * this file is a local artefact the user owns, exactly like ``backend.log``.
 * Sending it anywhere is a separate, opt-in step — see
 * ``diagnosticsConsent.ts`` and ``diagnosticsUploader.ts``.
 *
 * ## Why capture is always on but transmission is not
 *
 * A log file the user can read, delete and hand over deliberately is not
 * telemetry — it is the thing that makes "it crashed on my machine" answerable
 * at all. Every byte of it has been through the redaction pass
 * (``diagnosticsRedaction.ts``) and the field whitelist
 * (``diagnosticsEvent.ts``), so the artefact is safe to hand over *by
 * construction* rather than by the user's judgement in the moment.
 *
 * ## Why the userData directory is injected
 *
 * Same reason as ``recoveryStore.ts`` — this module must not ``import
 * 'electron'`` so vitest can exercise it (``vitest.config.ts``). ``index.ts``
 * calls {@link configureDiagnosticsStore} once at startup.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs'
import { join } from 'path'

import {
  normaliseDiagnosticEvent,
  type DiagnosticEvent,
  type DiagnosticSource,
} from './diagnosticsEvent'
import { realFsOps, rotateIfNeeded } from './logRotation'

/** Sub-directory of ``userData`` that holds the diagnostics artefacts. */
export const DIAGNOSTICS_DIR_NAME = 'diagnostics'

/** Name of the primary log file. Rotated copies get ``.1`` / ``.2`` suffixes. */
export const DIAGNOSTICS_FILENAME = 'diagnostics.log'

/**
 * Rotation threshold.
 *
 * 1 MiB is roughly 2 000 captured events — far more than any support question
 * needs, and small enough that the whole file fits in a mail attachment after
 * zipping. The backend log's 5 MiB budget is separate and unaffected.
 */
export const DIAGNOSTICS_MAX_BYTES = 1024 * 1024

/** Rotated generations kept, matching the backend log's ``LOG_MAX_FILES``. */
export const DIAGNOSTICS_MAX_FILES = 3

/** Injected configuration — where to write, and what to stamp on each event. */
export interface DiagnosticsStoreConfig {
  /** Absolute path to Electron's ``userData`` directory. */
  userDataDir: string
  /** ``app.getVersion()``, stamped on every event. */
  appVersion: string
  /** ``process.platform``, stamped on every event. */
  platform: string
  /** Build id (the git SHA), when this build carries provenance. */
  buildId?: string
}

let config: DiagnosticsStoreConfig | null = null

/**
 * Point the store at a user-data directory and give it the build facts.
 *
 * Parameters
 * ----------
 * next : DiagnosticsStoreConfig
 *     Directory plus the version/platform/build facts stamped on every event.
 */
export function configureDiagnosticsStore(next: DiagnosticsStoreConfig): void {
  config = next
}

/** Drop the configuration — test-only, so one spec cannot leak into the next. */
export function resetDiagnosticsStoreForTests(): void {
  config = null
}

/** The configuration, or a loud failure naming the call that was skipped. */
function requireConfig(): DiagnosticsStoreConfig {
  if (!config) {
    throw new Error('diagnostics store used before configureDiagnosticsStore() — call it at startup')
  }
  return config
}

/**
 * Absolute path of the diagnostics directory.
 *
 * Returns
 * -------
 * string
 *     ``<userData>/diagnostics``.
 */
export function diagnosticsDirPath(): string {
  return join(requireConfig().userDataDir, DIAGNOSTICS_DIR_NAME)
}

/**
 * Absolute path of the primary diagnostics log.
 *
 * Returns
 * -------
 * string
 *     ``<userData>/diagnostics/diagnostics.log``.
 *
 * Raises
 * ------
 * Error
 *     When {@link configureDiagnosticsStore} has not run.
 */
export function diagnosticsLogPath(): string {
  return join(diagnosticsDirPath(), DIAGNOSTICS_FILENAME)
}

/**
 * The build facts stamped on every event, for callers that describe the whole
 * installation rather than one event (the crash bundle's manifest).
 *
 * Returns
 * -------
 * { appVersion: string, platform: string, buildId?: string }
 *     The configured facts.
 *
 * Raises
 * ------
 * Error
 *     When {@link configureDiagnosticsStore} has not run.
 */
export function diagnosticsBuildFacts(): {
  appVersion: string
  platform: string
  buildId?: string
} {
  const cfg = requireConfig()
  return { appVersion: cfg.appVersion, platform: cfg.platform, buildId: cfg.buildId }
}

/**
 * Capture one problem to the local log.
 *
 * Normalises through the field whitelist, redacts, rotates the file if it has
 * grown past {@link DIAGNOSTICS_MAX_BYTES}, then appends a single NDJSON line.
 *
 * **Never throws.** Every caller is an error path already — a crash handler, an
 * IPC handler, a process-gone listener — and a diagnostics write failure that
 * masked the original error would be the worst possible trade.
 *
 * Parameters
 * ----------
 * raw : unknown
 *     Capture-site payload; see {@link normaliseDiagnosticEvent}.
 * source : DiagnosticSource
 *     Which process observed the problem.
 *
 * Returns
 * -------
 * DiagnosticEvent | null
 *     The event as written, or ``null`` when the payload carried nothing worth
 *     logging or the write failed.
 */
export function captureDiagnostic(raw: unknown, source: DiagnosticSource): DiagnosticEvent | null {
  let event: DiagnosticEvent | null = null
  try {
    const cfg = requireConfig()
    event = normaliseDiagnosticEvent(raw, source, {
      appVersion: cfg.appVersion,
      platform: cfg.platform,
      buildId: cfg.buildId,
    })
    if (!event) return null

    // The directory is (re)created on every capture, not once at startup: a
    // user who cleaned out AppData between two crashes should still get the
    // second one recorded.
    mkdirSync(diagnosticsDirPath(), { recursive: true })
    const path = diagnosticsLogPath()
    rotateIfNeeded(path, DIAGNOSTICS_MAX_BYTES, DIAGNOSTICS_MAX_FILES, realFsOps())
    appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf-8')
    return event
  } catch {
    // Swallowed on purpose — see the docstring.
    return null
  }
}

/**
 * Read back the captured events from the primary log.
 *
 * Unparseable lines are skipped: a log truncated by a power cut mid-write must
 * still yield the events before the tear.
 *
 * Returns
 * -------
 * DiagnosticEvent[]
 *     Events in write order; empty when nothing has been captured yet.
 */
export function readDiagnosticEvents(): DiagnosticEvent[] {
  const path = diagnosticsLogPath()
  if (!existsSync(path)) return []

  let text: string
  try {
    text = readFileSync(path, 'utf-8')
  } catch {
    return []
  }

  const events: DiagnosticEvent[] = []
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue
    try {
      events.push(JSON.parse(line) as DiagnosticEvent)
    } catch {
      // Skip the torn line, keep the rest.
    }
  }
  return events
}
