/**
 * The updater's main-log lines (pure half of the updater logging).
 *
 * A packaged app has no terminal: the updater's old ``console.warn`` on a failed
 * check reached nobody, and when no update prompt appeared there was no trace of
 * why (owner finding 2026-10-08). Every updater line now goes to the main log
 * (``backend.log``) with an ``[updater]`` prefix: ``electron-updater``'s own
 * logger output, each phase the service emits, and a rejected check.
 *
 * Pure: the writer is injected, so this module is unit-testable in jsdom. The
 * Electron-bound wiring is in ``./updaterService``.
 *
 * @module main/updaterLog
 */

/** Writes one line to the main log. */
export type UpdaterLineWriter = (line: string) => void

/** Prefix of every updater line in the main log. */
export const UPDATER_LOG_PREFIX = '[updater]'

/** Download progress is logged once per this many percent, not per tick. */
const PROGRESS_LOG_STEP_PERCENT = 25

/** The ``electron-updater`` ``Logger`` shape (info / warn / error / debug). */
export interface UpdaterLogger {
  info(message?: unknown): void
  warn(message?: unknown): void
  error(message?: unknown): void
  debug(message: string): void
}

/** The event fields this module reads (a structural subset of ``UpdaterEvent``). */
export interface LoggableUpdaterEvent {
  phase: string
  notice?: { version: string }
  progressPercent?: number
  message?: string
  errorReason?: string
}

/** Render any logged value as text; an Error as its message. */
function asText(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/**
 * Build the ``autoUpdater.logger`` adapter over a main-log writer.
 *
 * Parameters
 * ----------
 * write : UpdaterLineWriter
 *     The main-log writer. A writer that throws is swallowed: a log line must
 *     never take the updater down.
 *
 * Returns
 * -------
 * UpdaterLogger
 *     Writes ``[updater] <level> <message>`` for every level.
 */
export function createUpdaterLogger(write: UpdaterLineWriter): UpdaterLogger {
  const line = (level: string, message: unknown): void => {
    try {
      write(`${UPDATER_LOG_PREFIX} ${level} ${asText(message)}`)
    } catch {
      // A failing log write is never the updater's failure.
    }
  }
  return {
    info: message => line('info', message),
    warn: message => line('warn', message),
    error: message => line('error', message),
    debug: message => line('debug', message),
  }
}

/**
 * One log line for an emitted updater event.
 *
 * Parameters
 * ----------
 * event : LoggableUpdaterEvent
 *     The event the service pushes to the renderer.
 *
 * Returns
 * -------
 * string
 *     ``[updater] phase <phase>`` plus the version, percent or error detail.
 */
export function describeUpdaterEvent(event: LoggableUpdaterEvent): string {
  const base = `${UPDATER_LOG_PREFIX} phase ${event.phase}`
  if (event.notice) return `${base} (version ${event.notice.version})`
  if (event.phase === 'downloading') return `${base} (${event.progressPercent ?? 0}%)`
  if (event.phase === 'error') {
    return `${base} (reason ${event.errorReason ?? 'unknown'}: ${event.message ?? 'no message'})`
  }
  if (event.message) return `${base} (${event.message})`
  return base
}

/** The progress step a percent falls in. */
function progressStep(percent: number | undefined): number {
  return Math.floor((percent ?? 0) / PROGRESS_LOG_STEP_PERCENT)
}

/**
 * Whether an emitted event earns a log line.
 *
 * Every phase change does; download progress only when it crosses into a new
 * quarter, so a large download writes a handful of lines, not hundreds.
 *
 * Parameters
 * ----------
 * event : LoggableUpdaterEvent
 *     The event being emitted.
 * previous : LoggableUpdaterEvent | null
 *     The event emitted before it, or null.
 *
 * Returns
 * -------
 * boolean
 *     True when the event should be written to the main log.
 */
export function shouldLogUpdaterEvent(
  event: LoggableUpdaterEvent,
  previous: LoggableUpdaterEvent | null,
): boolean {
  if (event.phase !== 'downloading' || previous?.phase !== 'downloading') return true
  return progressStep(event.progressPercent) !== progressStep(previous.progressPercent)
}

/**
 * The log line for a rejected ``autoUpdater.checkForUpdates()``.
 *
 * Parameters
 * ----------
 * err : unknown
 *     The rejection value.
 *
 * Returns
 * -------
 * string
 *     ``[updater] check failed: <message>``.
 */
export function describeCheckFailure(err: unknown): string {
  return `${UPDATER_LOG_PREFIX} check failed: ${asText(err)}`
}
