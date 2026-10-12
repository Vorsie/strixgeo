/**
 * The walker's invariant checkers -- pure functions over observed data.
 *
 * The orchestrator gathers raw observations after every action (new console
 * lines, new refused responses, DOM vs API row ids, render emptiness, a
 * responsiveness timing, surviving pids at close) and passes them here. Each
 * checker returns zero or more {@link Finding}s. A finding is DATA: the walk
 * never aborts on one (owner ruling 2026-09-06). Keeping the checks pure lets
 * them be unit tested without the app, and keeps their wording -- the invariant
 * names below -- traceable to the brief.
 */

import type { BadResponse } from './walkerTypes'

/** One invariant violation at a step -- a row in the findings report. */
export interface Finding {
  /** The step whose action produced (or exposed) the violation. */
  readonly step: number
  /** Short invariant name (grep-stable), from the brief's list. */
  readonly invariant: string
  /** Human detail: the offending id / status / message / pid. */
  readonly detail: string
}

/** The responsiveness budget: a heartbeat click must answer within this. */
export const RESPONSIVENESS_BUDGET_MS = 5000

/**
 * Refusal statuses that are NOT findings.
 *
 * A 409 is the app's consented-conflict answer (cpt refresh, unsaved-changes,
 * concurrent body write) which the UI resolves with a dialog -- the brief calls
 * that fine. Everything else 4xx/5xx for an action the UI offered is a finding.
 */
export const IGNORED_REFUSAL_STATUSES: ReadonlySet<number> = new Set([409])

/** One captured renderer error, with where the browser says it came from. */
export interface CapturedConsoleError {
  /** ``console`` for a ``console.error`` line, ``pageerror`` for an uncaught error. */
  readonly source: 'console' | 'pageerror'
  /** The message text. */
  readonly text: string
  /** ``msg.location().url`` -- the resource or script the line belongs to ('' when unknown). */
  readonly locationUrl: string
}

/** Hosts that ARE the app: the backend port and the dev renderer server. */
const APP_HOSTS: ReadonlySet<string> = new Set(['127.0.0.1', 'localhost', '[::1]'])

/** Chromium's line for a resource the NETWORK failed (no HTTP answer at all). */
const NETWORK_LOAD_FAILURE = /^Failed to load resource: net::ERR_/

/**
 * Whether a location URL is the app itself: the ``file://`` renderer bundle or
 * a request to 127.0.0.1 / localhost (backend port, dev renderer). An empty or
 * unparsable location counts as the app, so an error is never dropped by doubt.
 */
function isAppLocation(locationUrl: string): boolean {
  if (locationUrl === '') return true
  let url: URL
  try {
    url = new URL(locationUrl)
  } catch {
    return true
  }
  if (url.protocol === 'file:') return true
  return APP_HOSTS.has(url.hostname)
}

/**
 * Whether a captured error is NOT an app finding.
 *
 * Only one shape is ignored: a resource-load failure with a ``net::`` code
 * (the network gave no answer) whose location is an EXTERNAL host -- a basemap
 * tile from Esri / Geopunt / OSM that the network reset (walker replay
 * 2026-10-12, a click on the Leaflet "+" zoom control). Every error from the
 * app's own origin or the backend port is kept (a backend 409 still logs
 * "Failed to load resource: the server responded with a status of 409" and is
 * still a finding), and every pageerror is kept.
 *
 * @param error - The captured error with its source and location.
 * @returns ``true`` when the error must not become a finding.
 */
export function isIgnoredConsoleError(error: CapturedConsoleError): boolean {
  if (error.source !== 'console') return false
  if (!NETWORK_LOAD_FAILURE.test(error.text)) return false
  return !isAppLocation(error.locationUrl)
}

/**
 * Every new renderer console error / uncaught page error is a finding.
 *
 * @param newErrors - Console/pageerror lines captured since the last step.
 * @param step - The step index to stamp on each finding.
 */
export function checkConsoleErrors(newErrors: readonly string[], step: number): Finding[] {
  return newErrors.map(line => ({
    step,
    invariant: 'console-error',
    detail: line.length > 300 ? `${line.slice(0, 300)}…` : line,
  }))
}

/**
 * Every refused request (4xx/5xx) for an action the UI offered is a finding,
 * except the consented-conflict statuses in {@link IGNORED_REFUSAL_STATUSES}.
 *
 * @param newBad - Responses with status >= 400 captured since the last step.
 * @param step - The step index to stamp on each finding.
 */
export function checkRefusedRequests(newBad: readonly BadResponse[], step: number): Finding[] {
  const out: Finding[] = []
  for (const r of newBad) {
    if (IGNORED_REFUSAL_STATUSES.has(r.status)) continue
    out.push({
      step,
      invariant: 'refused-request',
      detail: `${r.status} ${r.method} ${r.url}`,
    })
  }
  return out
}

/**
 * No row on screen the server does not have.
 *
 * Any id rendered on the canvas / in a list (``domIds``) that is absent from
 * the server's set for the same entity (``apiIds``) is a phantom row -- a
 * finding, never an abort.
 *
 * @param kind - Entity label for the report (``contact`` / ``section`` / ...).
 * @param domIds - Ids extracted from the DOM.
 * @param apiIds - Ids the server returned (the union across relevant models).
 * @param step - The step index to stamp on each finding.
 */
export function checkPhantomRows(
  kind: string,
  domIds: readonly string[],
  apiIds: readonly string[],
  step: number,
): Finding[] {
  const known = new Set(apiIds)
  const out: Finding[] = []
  const flagged = new Set<string>()
  for (const id of domIds) {
    if (known.has(id) || flagged.has(id)) continue
    flagged.add(id)
    out.push({
      step,
      invariant: 'phantom-row',
      detail: `${kind} ${id} is on screen but the server has no such row`,
    })
  }
  return out
}

/**
 * No empty view after an action where the model still has data.
 *
 * When the server reports rows for an entity the current view is supposed to
 * render (``expectRows``) but the DOM shows none, the view went blank on data
 * that exists -- a finding.
 *
 * @param kind - Entity label for the report.
 * @param domCount - Rows currently rendered.
 * @param apiCount - Rows the server has for this entity in scope.
 * @param expectRows - Whether the current stage/axis is meant to render them.
 * @param step - The step index to stamp on the finding.
 */
export function checkEmptyView(
  kind: string,
  domCount: number,
  apiCount: number,
  expectRows: boolean,
  step: number,
): Finding[] {
  if (expectRows && apiCount > 0 && domCount === 0) {
    return [
      {
        step,
        invariant: 'empty-view',
        detail: `${kind}: server has ${apiCount} but the view rendered 0`,
      },
    ]
  }
  return []
}

/**
 * The app stays responsive: a heartbeat click on the stage tab answers within
 * {@link RESPONSIVENESS_BUDGET_MS}.
 *
 * @param ms - Round-trip time of the heartbeat, or a negative value when the
 *   heartbeat never answered (timed out).
 * @param step - The step index to stamp on the finding.
 */
export function checkResponsiveness(ms: number, step: number): Finding[] {
  if (ms < 0) {
    return [{ step, invariant: 'unresponsive', detail: 'heartbeat click never answered' }]
  }
  if (ms > RESPONSIVENESS_BUDGET_MS) {
    return [
      {
        step,
        invariant: 'unresponsive',
        detail: `heartbeat took ${Math.round(ms)} ms (budget ${RESPONSIVENESS_BUDGET_MS} ms)`,
      },
    ]
  }
  return []
}

/**
 * After the final close, no Electron helper or ``groundmodel`` engine survives.
 *
 * @param survivorPids - Watched pids still alive 5 s after the close.
 * @param step - The step index (the closing pseudo-step) to stamp.
 */
export function checkSurvivors(survivorPids: readonly number[], step: number): Finding[] {
  if (survivorPids.length === 0) return []
  return [
    {
      step,
      invariant: 'lingering-process',
      detail: `pids still alive 5 s after close: ${survivorPids.join(', ')}`,
    },
  ]
}
