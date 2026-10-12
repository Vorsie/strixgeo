/**
 * Learn the engine origin from the main process, with the dev default as the
 * fallback.
 *
 * Dev and e2e pin the engine on 8765. A packaged app chooses the port at boot
 * (main's ``acquire-api-port`` stage; tester finding 2026-10-12: another program
 * on the PC owned 8765) and answers it over ``window.electron.getApiBaseUrl``.
 * A missing bridge (a plain browser, a test), a rejected call or an answer that
 * is not an http(s) URL falls back to {@link DEFAULT_API_BASE_URL}: a wrong
 * origin would fail every request, the default at least works in dev.
 *
 * @module api/apiBaseUrl
 */

import { DEFAULT_API_BASE_URL } from './clients/shared'

/** The slice of ``window.electron`` this reads. */
export interface ApiBaseUrlBridge {
  getApiBaseUrl?: () => Promise<string>
}

/**
 * Resolve the engine origin.
 *
 * Parameters
 * ----------
 * bridge : ApiBaseUrlBridge | undefined
 *     ``window.electron`` (or a stand-in).
 *
 * Returns
 * -------
 * Promise<string>
 *     The origin main reports, or ``DEFAULT_API_BASE_URL``.
 */
export async function resolveApiBaseUrl(bridge: ApiBaseUrlBridge | undefined): Promise<string> {
  if (typeof bridge?.getApiBaseUrl !== 'function') return DEFAULT_API_BASE_URL
  try {
    const base: unknown = await bridge.getApiBaseUrl()
    return typeof base === 'string' && /^https?:\/\/[^\s/]+$/.test(base) ? base : DEFAULT_API_BASE_URL
  } catch {
    return DEFAULT_API_BASE_URL
  }
}
