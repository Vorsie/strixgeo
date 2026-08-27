/**
 * Where a packaged build learns its own expiry date (Electron main process).
 *
 * Three sources, in strict precedence order:
 *
 * 1. **Baked into the bundle at build time** — ``import.meta.env.MAIN_VITE_
 *    STRIX_BETA_*``. electron-vite replaces each of those literal expressions
 *    with a string constant while building the main process, so a shipped beta
 *    carries its date in the binary and reads no environment variable at run
 *    time. This is the only source a packaged build uses.
 * 2. **Environment variables** — ``STRIX_BETA_*``, honoured **only when the app
 *    is not packaged**. They exist so the expiry flow can be rehearsed (and
 *    e2e-tested) without cutting a build. Honouring them in a packaged build
 *    would reduce the whole mechanism to one ``set`` command, so packaging
 *    switches them off.
 * 3. **Nothing** — an unstamped build never expires. ``npm run dev`` lands
 *    here, and so does any package cut without the build-time variables set.
 *
 * The module is pure: every input arrives as an argument (the compiled stamp
 * included), so vitest covers the precedence table without an Electron import
 * or a build (``vitest.config.ts``).
 *
 * ## Cutting a beta
 *
 *     MAIN_VITE_STRIX_BETA_BUILD_ID=2026.08.27-beta \
 *     MAIN_VITE_STRIX_BETA_BUILT_AT=2026-08-27T00:00:00.000Z \
 *     MAIN_VITE_STRIX_BETA_EXPIRES_AT=2026-10-11T00:00:00.000Z \
 *     npm run build
 *
 * ## Verifying that the package really carries its stamp
 *
 * Injection failure is SILENT — a build that lost its stamp looks exactly like
 * one that never had a stamp, and never expires. So check the bundle after
 * cutting a beta:
 *
 *     grep -A 4 "function compiledBuildStamp" desktop/out/main/index.js
 *
 * It must show the dates as string literals. The runtime backstop is in
 * ``index.ts``: a packaged build with no stamp warns at startup and records a
 * diagnostic, rather than quietly never expiring.
 *
 * **Do not switch this to Vite's ``define``.** electron-vite builds the main
 * process with ``build.ssr = true`` and define substitution does not reach an
 * SSR bundle: the config accepts the entry, the output is unchanged, and the
 * expiry silently never lands. Verified 2026-08-27 (see
 * ``buildStampGlobals.d.ts``).
 */

import type { BetaBuildStamp } from './betaExpiry'

/** Environment variable that sets the build id in a non-packaged run. */
export const BETA_BUILD_ID_ENV_VAR = 'STRIX_BETA_BUILD_ID'
/** Environment variable that sets the build timestamp in a non-packaged run. */
export const BETA_BUILT_AT_ENV_VAR = 'STRIX_BETA_BUILT_AT'
/** Environment variable that sets the expiry timestamp in a non-packaged run. */
export const BETA_EXPIRES_AT_ENV_VAR = 'STRIX_BETA_EXPIRES_AT'

/** The stamp as it is written by a build script — ISO strings, not epoch ms. */
export interface RawBuildStamp {
  /** Human-readable build identifier; defaults to ``builtAt`` when absent. */
  buildId?: string
  /** When the build was produced, ISO-8601. */
  builtAt?: string
  /** First instant at which the build refuses to open, ISO-8601. */
  expiresAt?: string
}

/** Everything {@link readBuildStamp} needs to pick a source. */
export interface BuildStampSource {
  /** ``app.isPackaged`` — gates the environment-variable source. */
  isPackaged: boolean
  /** Process environment, or a stand-in in tests. */
  env: Record<string, string | undefined>
  /** Compiled-in stamp; omitted by callers that read the globals themselves. */
  compiled?: RawBuildStamp
}

/** Epoch ms for an ISO-8601 string, or ``null`` when it is not a usable date. */
function instantFrom(value: string | undefined): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Turn a raw stamp into the epoch-ms shape {@link evaluateBetaExpiry} consumes.
 *
 * Parameters
 * ----------
 * raw : RawBuildStamp
 *     ISO-string stamp as written by the build script or read from the
 *     environment.
 *
 * Returns
 * -------
 * BetaBuildStamp | null
 *     The parsed stamp, or ``null`` when either date is missing or unreadable,
 *     or when the expiry does not follow the build date. A half-written stamp
 *     is treated as no stamp — see ``betaExpiry.ts`` for why a packaging bug
 *     must never present as an expired build.
 */
export function parseBuildStamp(raw: RawBuildStamp): BetaBuildStamp | null {
  const builtAtMs = instantFrom(raw.builtAt)
  const expiresAtMs = instantFrom(raw.expiresAt)
  if (builtAtMs === null || expiresAtMs === null) return null
  if (expiresAtMs <= builtAtMs) return null
  return {
    buildId: raw.buildId?.trim() || (raw.builtAt as string),
    builtAtMs,
    expiresAtMs,
  }
}

/**
 * Read the compiled-in stamp, if this build carries one.
 *
 * Returns
 * -------
 * RawBuildStamp | undefined
 *     The ``define``-injected values, or ``undefined`` in a build where the
 *     identifiers were never replaced.
 */
export function compiledBuildStamp(): RawBuildStamp | undefined {
  // ``import.meta.env.MAIN_VITE_*`` is electron-vite's own build-time
  // injection for the main bundle: each expression below is replaced with a
  // string literal during the build, so nothing reads an environment variable
  // at runtime. The accesses MUST stay literal member expressions — a computed
  // lookup (``env[KEY]``) is not statically replaceable and silently yields
  // nothing. See the module docstring for why ``define`` is not used.
  const buildId = import.meta.env.MAIN_VITE_STRIX_BETA_BUILD_ID
  const builtAt = import.meta.env.MAIN_VITE_STRIX_BETA_BUILT_AT
  const expiresAt = import.meta.env.MAIN_VITE_STRIX_BETA_EXPIRES_AT
  if (builtAt === undefined && expiresAt === undefined) return undefined
  return { buildId, builtAt, expiresAt }
}

/**
 * Resolve this build's expiry stamp from the highest-precedence source.
 *
 * Parameters
 * ----------
 * source : BuildStampSource
 *     ``isPackaged``, the environment, and optionally the compiled-in stamp.
 *
 * Returns
 * -------
 * BetaBuildStamp | null
 *     The stamp to enforce, or ``null`` for a build that never expires.
 */
export function readBuildStamp(source: BuildStampSource): BetaBuildStamp | null {
  if (source.compiled) {
    const compiled = parseBuildStamp(source.compiled)
    if (compiled) return compiled
  }
  // A shipped build takes its date from the binary and nowhere else.
  if (source.isPackaged) return null
  return parseBuildStamp({
    buildId: source.env[BETA_BUILD_ID_ENV_VAR],
    builtAt: source.env[BETA_BUILT_AT_ENV_VAR],
    expiresAt: source.env[BETA_EXPIRES_AT_ENV_VAR],
  })
}
