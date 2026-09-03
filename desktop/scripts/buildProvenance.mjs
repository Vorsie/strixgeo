// Build provenance — the single source of truth for the git SHA and build time
// stamped into a packaged build (production-readiness audit 2026-09-02, C4 /
// Codex row 1: "no version bump, no git SHA in the artifact"). Two consumers
// share this so they can never disagree:
//
//   * electron.vite.config.ts sets process.env.MAIN_VITE_STRIX_BUILD_{SHA,TIME}
//     at config-load, and electron-vite inlines import.meta.env.MAIN_VITE_* into
//     the main bundle — the SAME channel the beta stamp rides (see
//     src/main/buildStamp.ts). Vite's `define` is deliberately NOT used: it does
//     not reach the SSR main bundle (buildStampGlobals.d.ts).
//   * require-beta-stamp.mjs post greps out/main/index.js for the resolved SHA,
//     so a silent failure to inline fails the package instead of shipping a
//     build that carries no provenance.
//
// Both prefer an already-set environment override (so CI can pin an exact SHA)
// and otherwise resolve `git rev-parse HEAD`. Because both resolve the SAME way
// from the SAME HEAD during one build, the config's stamp and the post-check's
// grep target always match.
//
// git is invoked with execFileSync (no shell) and a fixed, hard-coded argument
// list — there is no interpolated input, so there is no shell-injection surface.
import { execFileSync } from 'node:child_process'

/** Sentinel returned when git cannot be reached (a source tarball, no .git). */
export const UNKNOWN_SHA = 'unknown'

/**
 * Resolve the git commit the build is cut from.
 *
 * @returns {string} an env override, the full 40-char HEAD SHA, or UNKNOWN_SHA.
 */
export function resolveBuildSha() {
  const override = process.env.MAIN_VITE_STRIX_BUILD_SHA
  if (override && override.trim()) return override.trim()
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return UNKNOWN_SHA
  }
}

/**
 * Resolve the build timestamp (ISO-8601). An env override wins so a reproducible
 * build can pin it; otherwise it is the moment the build ran.
 *
 * @returns {string} ISO-8601 timestamp.
 */
export function resolveBuildTime() {
  const override = process.env.MAIN_VITE_STRIX_BUILD_TIME
  if (override && override.trim()) return override.trim()
  return new Date().toISOString()
}
