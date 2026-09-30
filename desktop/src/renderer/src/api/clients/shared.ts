/**
 * Shared HTTP primitives for all Ground Model API client modules.
 *
 * Provides the mutable base-URL state, the `setBaseUrl` configuration
 * function, the single `request` core every wrapper funnels through,
 * and the five typed fetch wrappers (`get`, `del`, `patch`, `put`,
 * `post`) consumed by every domain client. Nothing in this module
 * talks to any domain endpoint directly.
 *
 * @module clients/shared
 */
import { captureDiagnostic } from '../../utils/diagnostics'
import { log } from '../../utils/log'
import { noteNetworkFailure, noteNetworkSuccess } from '../networkHealth'
import { messageForDetail } from './apiCodeMessages'

/** Mutable backend origin — reconfigured once at boot by `setBaseUrl`. */
export let _base = 'http://127.0.0.1:8765'

/**
 * Override the base URL used by every API call.
 *
 * Parameters
 * ----------
 * url : string
 *   The new origin, e.g. ``"http://127.0.0.1:9000"``.
 */
export function setBaseUrl(url: string): void {
  _base = url
}

// Strip query-string before logging so future license keys / session tokens
// that might land in query params don't end up in the renderer log stream.
// The thrown Error messages retain the full path for developer diagnostics.
const stripQuery = (p: string): string => p.split('?')[0]

/** HTTP verbs that change server state — the ones that must not hang the UI. */
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Abort budget for a mutating request (audit M3, renderer half).
 *
 * A create / update / delete that never answers leaves the caller's busy state
 * stuck forever (the delete never finishes, the button spins). 60 s is far past
 * any healthy loopback round-trip — including a large GEF parse — so it only
 * fires on a genuinely wedged backend, where a visible error beats a silent
 * hang.
 */
const MUTATION_TIMEOUT_MS = 60_000

/**
 * Compute / build / export mutations that legitimately run FAR longer than the
 * 60 s budget and must NOT be aborted.
 *
 * The on-click voxel build, the geotech subdivision, the borehole divide, an
 * auto-correlation pass and the DXF / D-Series exports run for minutes on a
 * large model — a 60 s guillotine on those would be a far worse regression than
 * the hung busy state the timeout is here to fix, and each of these already has
 * its own progress UI. Matched as URL substrings because ``fetchTracked`` only
 * sees the URL. ⚠ A new long-running POST endpoint MUST be added here.
 */
const SLOW_MUTATION_HINTS = [
  'surfaces/rebuild',
  'build-voxel',
  'bodies/recompute',
  'ground-surface/build',
  'geotech/subdivide',
  'geotech/divide-boreholes',
  'geotech/auto-correlate',
  '/export/',
  // Bundle restore, multi-file GEF import, litho auto-correlate and the build
  // report all run for minutes on a real project as well.
  '/restore',
  '/cpt/import',
  'auto-correlate',
  'build-report',
] as const

/** Whether ``url`` is one of the long-running compute / export mutations. */
function isSlowMutation(url: string): boolean {
  return SLOW_MUTATION_HINTS.some(hint => url.includes(hint))
}

/**
 * GET endpoints the backend proxies from a flaky EXTERNAL service, whose
 * failure is an expected degraded state rather than a bug in our code.
 *
 * Today this is only the DOV Virtuele Boring model catalogue, an
 * informative-only overlay. When DOV is unreachable the endpoint answers
 * 502/503/504; the picker already shows "DOV layer models unavailable", and
 * ``useVirtueleBoringCatalog`` session-caches the failure so it is not
 * re-asked on every CPT / borehole open. A failure here therefore logs at
 * WARN ("degraded but continuing") and is NOT captured as an ``api-error``
 * diagnostic: nothing about an unreachable third-party host is actionable in
 * a user's crash bundle. (walker findings 1-9, 2026-09-06: a down DOV host
 * logged nine identical 502 ERRORs in one session.)
 */
const DEGRADABLE_GET_PATHS = ['/dov/virtuele-boring/lagenmodellen'] as const

/**
 * ``detail.code`` values that mark a failed GET as the same degraded state,
 * whatever the path. The per-project Virtuele Boring predictions sweep answers
 * 503 ``dov_unreachable`` when DOV answered none of its calls (owner's dev log
 * 2026-09-27/29: a DOV timeout used to 500 that sweep and log as an ERROR). A
 * plain 5xx on the same path stays an ERROR: without the code it is a bug.
 */
const DEGRADABLE_DETAIL_CODES = ['dov_unreachable'] as const

/** Whether a failed request is a GET to a degradable external-overlay endpoint. */
function isDegradableGet(method: string, path: string, detail?: unknown): boolean {
  if (method.toUpperCase() !== 'GET') return false
  const code = detailCode(detail)
  if (code !== undefined && (DEGRADABLE_DETAIL_CODES as readonly string[]).includes(code)) return true
  const clean = stripQuery(path)
  return DEGRADABLE_GET_PATHS.some(p => clean === p)
}

/**
 * Attach a timeout abort signal to a mutating request that has none.
 *
 * GET/HEAD are left untouched (a read that hangs is annoying, not a stuck busy
 * state), a caller that supplied its own ``signal`` keeps full ownership of
 * cancellation, and the long-running compute / export endpoints
 * ({@link SLOW_MUTATION_HINTS}) opt out so a legitimate multi-minute build is
 * never cut off. ``AbortSignal.timeout`` rejects the fetch with a
 * ``TimeoutError`` DOMException, which propagates as a visible error rather
 * than an indefinite pending promise.
 *
 * Parameters
 * ----------
 * url : string
 *     The absolute request URL (used to detect the slow-mutation carve-out).
 * init : RequestInit, optional
 *     The fetch init as built by the caller.
 *
 * Returns
 * -------
 * RequestInit | undefined
 *     ``init`` unchanged for reads / caller-cancelled / slow-mutation requests,
 *     otherwise a copy carrying a 60 s timeout signal.
 */
function withMutationTimeout(url: string, init?: RequestInit): RequestInit | undefined {
  const method = (init?.method ?? 'GET').toUpperCase()
  if (!MUTATING_METHODS.has(method) || init?.signal || isSlowMutation(url)) return init
  return { ...init, signal: AbortSignal.timeout(MUTATION_TIMEOUT_MS) }
}

/**
 * Read a machine-readable ``code`` off a parsed server ``detail``.
 *
 * ~20 refusal routes send ``detail`` as an object with a ``code`` (e.g.
 * ``cpt_refresh_refused``). This lifts it for the diagnostics message so a 4xx
 * refusal is greppable in the local log without the prose.
 *
 * Parameters
 * ----------
 * detail : unknown
 *     The parsed ``detail`` field, any shape.
 *
 * Returns
 * -------
 * string | undefined
 *     The code when present, else ``undefined``.
 */
function detailCode(detail: unknown): string | undefined {
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    const code = (detail as { code?: unknown }).code
    if (typeof code === 'string' && code.length > 0) return code
  }
  return undefined
}

/**
 * HTTP failure carrying the status code as a typed field.
 *
 * WHY a class and not an error string: callers used to decide "the project
 * is gone" by matching the thrown message for ``'→ 404'``, which the client
 * only ever emits when the server sends NO ``detail``. FastAPI's 404s DO
 * send one (``"Project not found"``), so the match was dead code and the
 * .strix disaster-recovery restore behind it never fired. A cross-boundary
 * decision must read a field, never an incidental string.
 *
 * ``message`` is unchanged from the previous ``Error`` (server ``detail``
 * first, then the historical fallbacks), so every existing consumer that
 * shows ``err.message`` in a toast keeps its copy verbatim.
 *
 * Attributes
 * ----------
 * status : number
 *     HTTP status code of the failed response.
 * detail : unknown
 *     Parsed ``detail`` field from the server body, when present.
 * method : string
 *     HTTP verb of the failed request.
 * path : string
 *     Request path (query string included) of the failed request.
 */
export class ApiError extends Error {
  readonly status: number
  readonly detail: unknown
  readonly method: string
  readonly path: string

  constructor(
    message: string,
    status: number,
    options: { detail?: unknown; method?: string; path?: string } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.detail = options.detail
    this.method = options.method ?? ''
    this.path = options.path ?? ''
  }
}

/**
 * Narrow an unknown rejection to an ``ApiError`` with a given status.
 *
 * WHAT IT CANNOT NARROW (audit 2026-08-02): only rejections raised by
 * :func:`request` are ``ApiError``s. A handful of clients bypass it and
 * ``throw new Error(...)`` by hand, so this predicate is permanently
 * ``false`` for them — a caller that gates disaster recovery on
 * ``isApiStatus(err, 404)`` there gets a dead branch, which is exactly the
 * shape the ApiError class was introduced to kill. The bare-``fetch``
 * endpoints today are:
 *
 * * ``clients/cpt.ts`` — ``importFiles`` (multipart upload).
 * * ``clients/geology.ts`` — ``updateLayer``, ``deleteLayer``,
 *   ``linkLayerToGeo``, ``createContact``, ``updateContact``,
 *   ``clearLithoModel``, ``deleteContactCorrelation``,
 *   ``deleteAutoCorrelations``.
 *
 * They use a bare ``fetch`` because they carry a non-JSON body, read a
 * non-JSON response, or fold a 404 into a ``null`` return of their own.
 * Routing them through ``request`` is debt, not a one-liner; until then,
 * do not branch on their status.
 *
 * Parameters
 * ----------
 * err : unknown
 *     The caught rejection value.
 * status : number
 *     The HTTP status to test for.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when ``err`` is an ``ApiError`` carrying exactly ``status``.
 *     Always ``false`` for the bare-``fetch`` endpoints listed above.
 */
export function isApiStatus(err: unknown, status: number): boolean {
  return err instanceof ApiError && err.status === status
}

/**
 * Read a structured (object) server ``detail`` off a rejection.
 *
 * ~20 routes send ``detail`` as an object carrying a machine-readable
 * ``code`` plus whatever the client needs to offer a retry
 * (``suggested_horizontal_m``, ``layer_id``, ...). Callers that want to
 * branch on the code must read the object, never the prose — that is the
 * whole reason the backend sends a number instead of a sentence.
 *
 * Parameters
 * ----------
 * err : unknown
 *     The caught rejection value.
 *
 * Returns
 * -------
 * Record<string, unknown> | null
 *     The parsed detail object, or ``null`` when the rejection is not an
 *     ``ApiError``, carries no detail, or carries a plain-string detail
 *     (the majority case).
 */
export function apiErrorDetail(err: unknown): Record<string, unknown> | null {
  if (!(err instanceof ApiError)) return null
  const detail = err.detail
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return null
  return detail as Record<string, unknown>
}

/**
 * Best human sentence for a server ``detail`` of unknown shape.
 *
 * Exported because the bare-``fetch`` endpoints listed on
 * :func:`isApiStatus` build their own error text and hit exactly the same
 * object details (``litho_layer_overlap`` on the layer/contact PATCHes).
 * They call this instead of re-deriving the rule.
 *
 * WHY this exists: ``super(detailObject)`` stringifies an object to the
 * literal text ``"[object Object]"``. Live 2026-08-02 that swallowed a
 * ``voxel_grid_too_large`` refusal whole — the reason, the retry spacing and
 * the fact that nothing had been written were all on the wire and none of
 * them reached the engineer. An object detail keeps its ``message`` when it
 * has one (every structured producer in this backend writes one) and is
 * serialised otherwise, so the body is never silently destroyed.
 *
 * Parameters
 * ----------
 * detail : unknown
 *     The parsed ``detail`` field, any shape.
 *
 * Returns
 * -------
 * string | null
 *     Prose for the ``Error`` message, or ``null`` when there is no detail
 *     at all and the caller should use its own fallback copy.
 */
export function detailMessage(detail: unknown): string | null {
  if (detail === undefined || detail === null) return null
  if (typeof detail === 'string') return detail
  if (typeof detail === 'object' && !Array.isArray(detail)) {
    const message = (detail as { message?: unknown }).message
    if (typeof message === 'string' && message.length > 0) return message
  }
  // No `message` key — serialise rather than drop. Unlovely prose beats a
  // toast that says nothing.
  try {
    return JSON.stringify(detail)
  } catch {
    return null
  }
}

/**
 * ``fetch`` with the backend-reachability signal attached.
 *
 * THE single transport boundary of the renderer. Everything that talks to the
 * backend goes through here — the typed wrappers below via {@link request},
 * and the hand-rolled clients that need their own status/body handling
 * (``geology.updateContact``, ``cpt.import``, …) directly.
 *
 * WHY it exists separately from {@link request}: the signal used to be taken
 * inside ``request()`` only, and nine endpoints used a bare ``fetch`` — among
 * them the everyday litho editing gestures (create/update contact,
 * update/delete layer, disconnect a tie). A session spent editing contacts
 * against a dead backend could therefore rack up dozens of transport failures
 * without ever reaching the threshold, so the banner — the whole point of the
 * feature — never appeared.
 *
 * Semantics, unchanged from ``request()``: a REJECTED fetch means nothing
 * answered; ANY response — including a 500 — means the backend is alive and the
 * app must stop claiming otherwise. An ``AbortError`` is the app's own doing
 * (unmount, superseded fetch) and never counts.
 *
 * Parameters
 * ----------
 * url : string
 *   Absolute URL to fetch.
 * init : RequestInit, optional
 *   Standard ``fetch`` init.
 *
 * Returns
 * -------
 * Promise<Response>
 *   The response, whatever its status — status handling stays with the caller.
 *
 * Throws
 * ------
 * unknown
 *   Re-throws whatever ``fetch`` rejected with, after counting it.
 */
export async function fetchTracked(url: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(url, withMutationTimeout(url, init))
  } catch (err) {
    // An abort the app asked for (unmount, superseded fetch) is not the backend
    // dying — it never counts as a reachability failure. A timeout (our own
    // ``AbortSignal.timeout`` below) DOES count: 60 s of silence on a mutation
    // is exactly "the backend stopped answering", and it also stops the caller's
    // busy state hanging forever — the rejection surfaces as a visible error.
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      noteNetworkFailure()
    }
    throw err
  }
  noteNetworkSuccess()
  return res
}

/**
 * Single request core — every typed wrapper funnels through here.
 *
 * Performs the fetch, and on non-2xx parses the server ``detail``,
 * logs the failure, and throws. Callers that need the response body
 * pick the shape themselves (``res.json()`` / ``res.arrayBuffer()``).
 *
 * Parameters
 * ----------
 * method : string
 *   HTTP verb, e.g. ``'GET'``.
 * path : string
 *   URL path relative to `_base`, including leading slash.
 * body : unknown, optional
 *   Request body; serialised as JSON when provided.
 * errorLabel : string, optional
 *   Overrides the default ```${method} ${path} → ${status}``` fallback
 *   error text with ```${errorLabel} (${status})``` — used by client
 *   methods whose historical error copy predates the shared core.
 *
 * Returns
 * -------
 * Promise<Response>
 *   The raw successful response.
 *
 * Throws
 * ------
 * ApiError
 *   On non-2xx HTTP status; message includes server `detail` when
 *   parseable, and `.status` carries the HTTP status code.
 */
export async function request(
  method: string,
  path: string,
  body?: unknown,
  errorLabel?: string,
): Promise<Response> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  // Reachability is measured at the transport boundary, not in a poller — see
  // fetchTracked above for why, and for the abort exclusion.
  const res = await fetchTracked(`${_base}${path}`, init)
  if (!res.ok) {
    // Surface the server's `detail` (e.g. the 409 "delete the dependent
    // model first" guard) instead of an opaque "→ 409".
    const detail = await res.json().catch(() => ({}))
    const cleanPath = stripQuery(path)
    if (isDegradableGet(method, path, detail.detail)) {
      // Degraded external-overlay state (DOV unreachable): WARN, no
      // diagnostic. See DEGRADABLE_GET_PATHS for the full rationale.
      log.warn('api', method, cleanPath, res.status, detail.detail)
    } else {
      log.error('api', method, cleanPath, res.status, detail.detail)
      // #16 — a 5xx is a bug nobody else witnesses (the traceback stays in the
      // backend log on the user's own machine), captured as an error. A 4xx is
      // the backend REFUSING something the user did (a 409 refresh confirmation,
      // a 422 validation) — the app working, but "it refused to delete the
      // contact" needs a file trace too (audit L2), so it is captured as a
      // warning-severity ``api-refusal`` carrying the machine ``code``.
      if (res.status >= 500) {
        captureDiagnostic({
          kind: 'api-error',
          scope: 'api',
          message: `${method} ${cleanPath} → ${res.status}`,
          httpStatus: res.status,
        })
      } else if (res.status >= 400) {
        const code = detailCode(detail.detail)
        captureDiagnostic({
          kind: 'api-refusal',
          severity: 'warning',
          scope: 'api',
          message: `${method} ${cleanPath} → ${res.status}${code ? ` (${code})` : ''}`,
          httpStatus: res.status,
        })
      }
    }
    // A known refusal code shows in the app's language; anything else keeps the
    // server's own message (apiCodeMessages.ts).
    throw new ApiError(
      messageForDetail(
        detail.detail,
        detailMessage(detail.detail) ??
          (errorLabel ? `${errorLabel} (${res.status})` : `${method} ${path} → ${res.status}`),
      ),
      res.status,
      { detail: detail.detail, method, path },
    )
  }
  return res
}

/**
 * GET helper for binary export endpoints — returns the raw bytes.
 *
 * Callers pipe the ``ArrayBuffer`` straight to a file write (Electron
 * save dialog → fs.writeFileSync); nothing is parsed on success.
 *
 * Parameters
 * ----------
 * path : string
 *   URL path relative to `_base`, including leading slash.
 * errorLabel : string, optional
 *   Fallback error copy when the server sends no ``detail`` —
 *   defaults to the historical ``"Export failed"``.
 *
 * Returns
 * -------
 * Promise<ArrayBuffer>
 *   Raw response bytes.
 *
 * Throws
 * ------
 * Error
 *   On non-2xx HTTP status (e.g. the 404 missing-section / missing-model
 *   case, which surfaces through the caller's toast).
 */
export async function getBytes(
  path: string,
  errorLabel = 'Export failed',
): Promise<ArrayBuffer> {
  const res = await request('GET', path, undefined, errorLabel)
  return res.arrayBuffer()
}

/**
 * POST helper for binary export endpoints — sends JSON, returns raw bytes.
 *
 * The byte-pipe sibling of {@link getBytes}, for the exports whose INPUT is
 * too large for a query string: the Deltares D-Series targets need the
 * section's drawn partition fill, which is computed in the renderer and can
 * run to thousands of polygons.
 *
 * Parameters
 * ----------
 * path : string
 *   URL path relative to `_base`, including leading slash.
 * body : unknown
 *   Request payload, JSON-serialised by {@link request}.
 * errorLabel : string, optional
 *   Fallback error copy when the server sends no ``detail``.
 *
 * Returns
 * -------
 * Promise<ArrayBuffer>
 *   Raw response bytes.
 *
 * Throws
 * ------
 * ApiError
 *   On non-2xx HTTP status. The server's structured ``detail.message``
 *   reaches the caller's toast verbatim — which is how the 422
 *   "draw the section fill first" refusal becomes readable copy.
 */
export async function postBytes(
  path: string,
  body: unknown,
  errorLabel = 'Export failed',
): Promise<ArrayBuffer> {
  const res = await request('POST', path, body, errorLabel)
  return res.arrayBuffer()
}

/**
 * Typed GET helper.
 *
 * Parameters
 * ----------
 * path : string
 *   URL path relative to `_base`, including leading slash.
 *
 * Returns
 * -------
 * Promise<T>
 *   Parsed JSON response body.
 *
 * Throws
 * ------
 * Error
 *   On non-2xx HTTP status.
 */
export async function get<T>(path: string): Promise<T> {
  const res = await request('GET', path)
  return res.json()
}

/**
 * Typed DELETE helper (no response body expected).
 *
 * Parameters
 * ----------
 * path : string
 *   URL path relative to `_base`, including leading slash.
 *
 * Returns
 * -------
 * Promise<void>
 *
 * Throws
 * ------
 * Error
 *   On non-2xx HTTP status; includes server `detail` when parseable.
 */
export async function del(path: string): Promise<void> {
  await request('DELETE', path)
}

/**
 * Typed DELETE helper that parses the JSON response body.
 *
 * For DELETE endpoints that return a result (e.g. a deleted-count summary)
 * rather than 204 No Content.
 *
 * Parameters
 * ----------
 * path : string
 *   URL path relative to `_base`, including leading slash.
 *
 * Returns
 * -------
 * Promise<T>
 *   Parsed JSON response body.
 *
 * Throws
 * ------
 * Error
 *   On non-2xx HTTP status; includes server `detail` when parseable.
 */
export async function delReturning<T>(path: string): Promise<T> {
  const res = await request('DELETE', path)
  return res.json()
}

/**
 * Typed PATCH helper.
 *
 * Parameters
 * ----------
 * path : string
 *   URL path relative to `_base`, including leading slash.
 * body : unknown
 *   Request body; serialised as JSON.
 * errorLabel : string, optional
 *   Historical fallback error copy — see `request`.
 *
 * Returns
 * -------
 * Promise<T>
 *   Parsed JSON response body.
 *
 * Throws
 * ------
 * Error
 *   On non-2xx HTTP status; includes server `detail` when parseable.
 */
export async function patch<T>(path: string, body: unknown, errorLabel?: string): Promise<T> {
  const res = await request('PATCH', path, body, errorLabel)
  return res.json()
}

/**
 * Typed PUT helper.
 *
 * Parameters
 * ----------
 * path : string
 *   URL path relative to `_base`, including leading slash.
 * body : unknown
 *   Request body; serialised as JSON.
 * errorLabel : string, optional
 *   Historical fallback error copy — see `request`.
 *
 * Returns
 * -------
 * Promise<T>
 *   Parsed JSON response body.
 *
 * Throws
 * ------
 * Error
 *   On non-2xx HTTP status; includes server `detail` when parseable.
 */
export async function put<T>(path: string, body: unknown, errorLabel?: string): Promise<T> {
  const res = await request('PUT', path, body, errorLabel)
  return res.json()
}

/**
 * Typed POST helper.
 *
 * Parameters
 * ----------
 * path : string
 *   URL path relative to `_base`, including leading slash.
 * body : unknown, optional
 *   Request body; omitted for bodyless POSTs.
 * errorLabel : string, optional
 *   Historical fallback error copy — see `request`.
 *
 * Returns
 * -------
 * Promise<T>
 *   Parsed JSON response body.
 *
 * Throws
 * ------
 * Error
 *   On non-2xx HTTP status; includes server `detail` when parseable.
 */
export async function post<T>(path: string, body?: unknown, errorLabel?: string): Promise<T> {
  const res = await request('POST', path, body, errorLabel)
  return res.json()
}
