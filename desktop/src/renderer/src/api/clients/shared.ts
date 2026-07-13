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
 * Error
 *   On non-2xx HTTP status; includes server `detail` when parseable.
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
    throw new Error(
      detail.detail ??
        (errorLabel ? `${errorLabel} (${res.status})` : `${method} ${path} → ${res.status}`),
    )
  }
  return res
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
