/**
 * Build-time environment keys the main bundle reads.
 *
 * electron-vite exposes environment variables prefixed ``MAIN_VITE_`` to the
 * main process through ``import.meta.env``, statically replacing each literal
 * ``import.meta.env.MAIN_VITE_X`` with the value present when the build ran.
 * That is the injection mechanism for the beta expiry stamp — see
 * ``buildStamp.ts``.
 *
 * Why not Vite's ``define``: electron-vite builds the main process with
 * ``build.ssr = true``, and Vite's define substitution does not reach an SSR
 * bundle. A ``main.define`` entry is accepted by the config, changes nothing in
 * the output, and fails **silently** — the expiry stamp simply never lands.
 * Verified 2026-08-27 by building with the variables set and grepping
 * ``out/main/index.js`` for the injected date.
 */

interface ImportMetaEnv {
  /** Human-readable build identifier, e.g. ``2026.08.26-beta``. */
  readonly MAIN_VITE_STRIX_BETA_BUILD_ID?: string
  /** Build timestamp, ISO-8601. */
  readonly MAIN_VITE_STRIX_BETA_BUILT_AT?: string
  /** Expiry timestamp, ISO-8601. */
  readonly MAIN_VITE_STRIX_BETA_EXPIRES_AT?: string
  /** Git commit SHA the build was cut from (build provenance, audit C4). */
  readonly MAIN_VITE_STRIX_BUILD_SHA?: string
  /** Build timestamp, ISO-8601 (build provenance, audit C4). */
  readonly MAIN_VITE_STRIX_BUILD_TIME?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
