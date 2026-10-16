/**
 * Where consented diagnostics go. Open source 2026-10-17: there is no
 * licence server any more, so the endpoint is a plain setting with NO
 * default. Unset means "never transmit", in every build.
 *
 * @module main/diagnosticsEndpoint
 */

/** Environment variable naming the diagnostics server base URL. */
export const DIAGNOSTICS_URL_ENV = 'STRIXGEO_DIAGNOSTICS_URL'

/**
 * The diagnostics base URL, or null when none is configured.
 *
 * @param env - The process environment (or a stand-in in tests).
 * @returns The base URL without a trailing slash, or null.
 */
export function diagnosticsBaseUrl(env: Record<string, string | undefined>): string | null {
  const raw = env[DIAGNOSTICS_URL_ENV]?.trim()
  if (!raw) return null
  return raw.replace(/\/+$/, '')
}
