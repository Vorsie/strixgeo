/**
 * One-shot JSON POST with a timeout that never throws (Electron main process).
 *
 * Extracted from {@link ./httpActivationRepository}'s private ``send`` when the
 * diagnostics uploader (debt #16) became a second caller of the same
 * fetch + AbortController-timeout + parse-or-null plumbing. One copy, one set of
 * behaviours: a finished round-trip carries its status and parsed body; any
 * thrown error — a DNS/connection failure, or the ``AbortError`` the timeout
 * raises — collapses to a single ``network-failure`` sentinel the caller can
 * branch on without a try/catch of its own.
 *
 * It imports only the Electron-main global ``fetch`` (injectable for tests), so
 * it stays unit-testable under ``src/main/**`` with no Electron import.
 */

/** A finished HTTP round-trip, or the flag that no answer came back. */
export type HttpPostResult =
  | { kind: 'response'; status: number; body: unknown }
  | { kind: 'network-failure' }

/** Default per-request timeout: long enough for a slow link, short enough not to hang. */
export const DEFAULT_POST_TIMEOUT_MS = 10_000

/** Options for {@link postJson}. */
export interface PostJsonOptions {
  /** ``fetch`` to use; defaults to the global one. Injected in tests. */
  fetchImpl?: typeof fetch
  /** Per-request timeout in ms; defaults to {@link DEFAULT_POST_TIMEOUT_MS}. */
  timeoutMs?: number
  /** Extra request headers, merged over the JSON content-type/accept defaults. */
  headers?: Record<string, string>
}

/**
 * POST ``body`` as JSON to ``url`` and shape the answer, never throwing.
 *
 * Parameters
 * ----------
 * url : string
 *     The absolute request URL.
 * body : unknown
 *     The value to ``JSON.stringify`` into the request body.
 * options : PostJsonOptions, optional
 *     Injected ``fetch``, the timeout, and any extra headers.
 *
 * Returns
 * -------
 * Promise<HttpPostResult>
 *     ``{ kind: 'response', status, body }`` for a completed request (``body`` is
 *     the parsed JSON, or ``null`` when the response carried none/invalid JSON);
 *     ``{ kind: 'network-failure' }`` for any thrown error — which includes the
 *     ``AbortError`` from the timeout and every DNS / connection failure.
 */
export async function postJson(
  url: string,
  body: unknown,
  options: PostJsonOptions = {},
): Promise<HttpPostResult> {
  const fetchImpl = options.fetchImpl ?? fetch
  const timeoutMs = options.timeoutMs ?? DEFAULT_POST_TIMEOUT_MS

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', ...options.headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    let parsed: unknown = null
    try {
      parsed = await response.json()
    } catch {
      // A 2xx with no/invalid JSON is unreadable; a non-2xx with none maps by
      // status alone. Either way, a null body is a fine sentinel here.
      parsed = null
    }
    return { kind: 'response', status: response.status, body: parsed }
  } catch {
    return { kind: 'network-failure' }
  } finally {
    clearTimeout(timer)
  }
}
