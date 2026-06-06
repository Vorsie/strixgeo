/**
 * Shared HTTP primitives for all Ground Model API client modules.
 *
 * Provides the mutable base-URL state, the `setBaseUrl` configuration
 * function, and the five typed fetch wrappers (`get`, `del`, `patch`,
 * `put`, `post`) consumed by every domain client. Nothing in this
 * module talks to any domain endpoint directly.
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
  const res = await fetch(`${_base}${path}`)
  if (!res.ok) {
    log.error('api', 'GET', stripQuery(path), res.status)
    throw new Error(`GET ${path} → ${res.status}`)
  }
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
  const res = await fetch(`${_base}${path}`, { method: 'DELETE' })
  if (!res.ok) {
    // Surface the server's `detail` (e.g. the 409 "delete the dependent
    // model first" guard) instead of an opaque "→ 409" — mirrors patch/put.
    const detail = await res.json().catch(() => ({}))
    log.error('api', 'DELETE', stripQuery(path), res.status)
    throw new Error(detail.detail ?? `DELETE ${path} → ${res.status}`)
  }
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
export async function patch<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${_base}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    log.error('api', 'PATCH', stripQuery(path), res.status)
    throw new Error(detail.detail ?? `PATCH ${path} → ${res.status}`)
  }
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
export async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${_base}${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    log.error('api', 'PUT', stripQuery(path), res.status)
    throw new Error(detail.detail ?? `PUT ${path} → ${res.status}`)
  }
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
export async function post<T>(path: string, body?: unknown): Promise<T> {
  const init: RequestInit = { method: 'POST' }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await fetch(`${_base}${path}`, init)
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}))
    log.error('api', 'POST', stripQuery(path), res.status)
    throw new Error(detail.detail ?? `POST ${path} → ${res.status}`)
  }
  return res.json()
}
