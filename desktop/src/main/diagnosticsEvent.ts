/**
 * The shape of one captured diagnostic, and the whitelist that builds it.
 *
 * Every crash, unhandled rejection, renderer error and backend 5xx that the app
 * captures locally becomes exactly this record — no more fields, ever. Capture
 * sites hand over a loose object; {@link normaliseDiagnosticEvent} decides what
 * of it survives.
 *
 * ## Why a whitelist rather than a scrub
 *
 * The renderer is the least trusted process in the app (it runs our React tree,
 * Cesium, Leaflet and every parser response). A scrub-what-looks-sensitive
 * approach fails the moment a capture site passes an object nobody thought
 * about — a partition payload, a bundle, a project row. A whitelist fails
 * closed: an unknown field is not redacted, it is *absent*.
 *
 * The renderer also cannot state facts about the environment. ``appVersion``,
 * ``platform``, ``buildId`` and the timestamp are stamped by the main process
 * from its own state, so a forged renderer message cannot make a report claim
 * to come from a different build.
 */

import { redactText } from './diagnosticsRedaction'

/** Which process observed the problem. Decided by the capture site. */
export type DiagnosticSource = 'main' | 'renderer' | 'api'

/** How bad it was. */
export type DiagnosticSeverity = 'warning' | 'error' | 'fatal'

/**
 * Recognised diagnostic kinds.
 *
 * A closed set so the log can be grouped without parsing free text. Anything
 * else collapses to ``unknown`` rather than passing a renderer-supplied string
 * into the file.
 */
export const DIAGNOSTIC_KINDS = [
  'main-uncaught',
  'main-unhandled-rejection',
  'renderer-gone',
  'renderer-unresponsive',
  'renderer-error',
  'renderer-unhandled-rejection',
  'api-error',
  'backend-failed',
  'unknown',
] as const

/** One of {@link DIAGNOSTIC_KINDS}. */
export type DiagnosticKind = (typeof DIAGNOSTIC_KINDS)[number]

const KIND_SET = new Set<string>(DIAGNOSTIC_KINDS)
const SEVERITY_SET = new Set<string>(['warning', 'error', 'fatal'])

/**
 * Characters a scope may contain.
 *
 * Scopes are module labels from the renderer logger (``api``, ``sections``,
 * ``boot``). Anything with a separator or a space is not a scope — it is a
 * path or a sentence that leaked into the wrong field.
 */
const SCOPE_PATTERN = /^[A-Za-z0-9_.:-]{1,40}$/

/** Fallback when a scope is missing or unrecognisable. */
export const UNKNOWN_SCOPE = 'unknown'

/** One captured problem, as written to the local log. */
export interface DiagnosticEvent {
  /** When the main process recorded it, ISO-8601. */
  ts: string
  /** Which process observed it. */
  source: DiagnosticSource
  /** Which kind of problem. */
  kind: DiagnosticKind
  /** How bad. */
  severity: DiagnosticSeverity
  /** Module label, or ``unknown``. */
  scope: string
  /** Redacted, capped error message. */
  message: string
  /** Redacted, capped stack trace, when one was supplied. */
  stack?: string
  /** HTTP status, for a backend failure. */
  httpStatus?: number
  /** App version, stamped by the main process. */
  appVersion: string
  /** ``process.platform``, stamped by the main process. */
  platform: string
  /** Beta build id, when this build carries a stamp. */
  buildId?: string
}

/** Environment facts the main process stamps onto every event. */
export interface DiagnosticContext {
  /** ``app.getVersion()``. */
  appVersion: string
  /** ``process.platform``. */
  platform: string
  /** Beta build id, when stamped. */
  buildId?: string
  /** Timestamp override — tests pin it; production leaves it unset. */
  nowIso?: string
}

/** The recognised kind, or the catch-all. */
function kindOf(value: unknown): DiagnosticKind {
  return typeof value === 'string' && KIND_SET.has(value) ? (value as DiagnosticKind) : 'unknown'
}

/** The recognised severity, or ``error`` — the level a capture site implies. */
function severityOf(value: unknown): DiagnosticSeverity {
  return typeof value === 'string' && SEVERITY_SET.has(value)
    ? (value as DiagnosticSeverity)
    : 'error'
}

/** The scope when it looks like a module label, else {@link UNKNOWN_SCOPE}. */
function scopeOf(value: unknown): string {
  return typeof value === 'string' && SCOPE_PATTERN.test(value) ? value : UNKNOWN_SCOPE
}

/** An HTTP status when the value is one, else ``undefined``. */
function httpStatusOf(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isInteger(value)) return undefined
  return value >= 100 && value <= 599 ? value : undefined
}

/**
 * Build a captured event from a loose capture-site payload.
 *
 * Parameters
 * ----------
 * raw : unknown
 *     Whatever the capture site passed. IPC arguments arrive as ``any`` at
 *     runtime whatever the TypeScript signature claims, so every field is
 *     re-checked here.
 * source : DiagnosticSource
 *     Which process observed the problem — decided by the capture site, never
 *     read from ``raw``.
 * context : DiagnosticContext
 *     Build/machine facts stamped by the main process.
 *
 * Returns
 * -------
 * DiagnosticEvent | null
 *     The record to log, or ``null`` when there is nothing to say (no message,
 *     or a payload that is not an object) — an empty record is noise in a
 *     support bundle and a wasted line in a bounded file.
 */
export function normaliseDiagnosticEvent(
  raw: unknown,
  source: DiagnosticSource,
  context: DiagnosticContext,
): DiagnosticEvent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const input = raw as Record<string, unknown>

  const message = redactText(input.message).trim()
  if (message === '') return null

  const stack = redactText(input.stack).trim()
  const httpStatus = httpStatusOf(input.httpStatus)

  return {
    ts: context.nowIso ?? new Date().toISOString(),
    source,
    kind: kindOf(input.kind),
    severity: severityOf(input.severity),
    scope: scopeOf(input.scope),
    message,
    ...(stack === '' ? {} : { stack }),
    ...(httpStatus === undefined ? {} : { httpStatus }),
    appVersion: context.appVersion,
    platform: context.platform,
    ...(context.buildId === undefined ? {} : { buildId: context.buildId }),
  }
}
