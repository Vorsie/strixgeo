/**
 * Build provenance compiled into a packaged build (Electron main process).
 *
 * The git SHA and the build time are baked into the bundle at build time
 * through ``import.meta.env.MAIN_VITE_STRIX_BUILD_*``: electron-vite replaces
 * each of those literal expressions with a string constant while building the
 * main process, so a shipped build carries its provenance in the binary and
 * reads no environment variable at run time. A dev run, where the variables
 * were never set, carries none.
 *
 * **Do not switch this to Vite's ``define``.** electron-vite builds the main
 * process with ``build.ssr = true`` and define substitution does not reach an
 * SSR bundle: the config accepts the entry, the output is unchanged, and the
 * provenance silently never lands. Verified 2026-08-27 (see
 * ``buildStampGlobals.d.ts``).
 */

/** Build provenance baked into a packaged build: the commit and the moment. */
export interface BuildProvenance {
  /** Full git commit SHA the build was cut from, or ``"unknown"``. */
  sha?: string
  /** Build timestamp, ISO-8601. */
  builtAt?: string
}

/**
 * Read the compiled-in build provenance (git SHA + build time), if present.
 *
 * Set in ``electron.vite.config.ts`` from ``scripts/buildProvenance.mjs`` and
 * replaced with string literals while the main bundle builds
 * (production-readiness audit 2026-09-02, C4: the artifact carried no git SHA).
 * A dev run, where the variables were never set, returns ``undefined``.
 *
 * Returns
 * -------
 * BuildProvenance | undefined
 *     ``{ sha, builtAt }`` for a build that carries provenance, else undefined.
 */
export function compiledBuildProvenance(): BuildProvenance | undefined {
  // Literal member expressions only: a computed lookup (``env[KEY]``) is not
  // statically replaceable and silently yields nothing.
  const sha = import.meta.env.MAIN_VITE_STRIX_BUILD_SHA
  const builtAt = import.meta.env.MAIN_VITE_STRIX_BUILD_TIME
  if (sha === undefined && builtAt === undefined) return undefined
  return { sha, builtAt }
}
