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
import { log } from '../../utils/log'

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
  const res = await fetch(`${_base}${path}`, init)
  if (!res.ok) {
    // Surface the server's `detail` (e.g. the 409 "delete the dependent
    // model first" guard) instead of an opaque "→ 409".
    const detail = await res.json().catch(() => ({}))
    log.error('api', method, stripQuery(path), res.status, detail.detail)
    throw new ApiError(
      detail.detail ??
        (errorLabel ? `${errorLabel} (${res.status})` : `${method} ${path} → ${res.status}`),
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
