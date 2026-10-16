// Build-SHA gate for packaging (production-readiness audit 2026-09-02, C4).
//
// A packaged build must carry its git SHA (compiledBuildProvenance reads it);
// this check greps the built main bundle for it after electron-vite build. The
// SHA is injected through the MAIN_VITE_ channel (electron.vite.config.ts), so
// if that injection silently failed the SHA would be absent from the bundle and
// the build would ship with no provenance. Fail the package rather than ship it
// blind.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBuildSha, UNKNOWN_SHA } from './buildProvenance.mjs'

/**
 * Decide whether a built main bundle carries the build SHA.
 *
 * @param {{ bundleText: string | null, sha: string }} input
 *   ``bundleText`` is the content of out/main/index.js, or null when the file
 *   is missing; ``sha`` is the SHA resolved the same way electron.vite.config.ts
 *   resolves it (env override, else ``git rev-parse HEAD``).
 * @returns {{ kind: 'ok' | 'warn' | 'fail', message: string }}
 *   ``fail`` for a missing bundle or a bundle without the SHA; ``warn`` when no
 *   git was reachable (the SHA cannot be verified, which is not an injection
 *   failure); ``ok`` otherwise.
 */
export function bundleShaVerdict({ bundleText, sha }) {
  if (bundleText === null) {
    return { kind: 'fail', message: 'out/main/index.js is missing: run electron-vite build first' }
  }
  if (sha === UNKNOWN_SHA) {
    return { kind: 'warn', message: 'git SHA unavailable: build provenance in the bundle could not be verified' }
  }
  if (!bundleText.includes(sha)) {
    return {
      kind: 'fail',
      message: `the built main bundle does not contain the git SHA ${sha}: build provenance was not inlined (see electron.vite.config.ts / buildStamp.ts)`,
    }
  }
  return { kind: 'ok', message: `bundle carries git SHA ${sha.slice(0, 12)}` }
}

function main() {
  const bundle = resolve('out/main/index.js')
  const bundleText = existsSync(bundle) ? readFileSync(bundle, 'utf8') : null
  const verdict = bundleShaVerdict({ bundleText, sha: resolveBuildSha() })
  if (verdict.kind === 'fail') {
    console.error(`[build-sha] ${verdict.message}`)
    process.exit(1)
  }
  if (verdict.kind === 'warn') console.warn(`[build-sha] WARNING: ${verdict.message}`)
  else console.log(`[build-sha] verified: ${verdict.message}`)
}

// Run only when invoked as a script (``node scripts/require-build-sha.mjs``),
// so the test can import bundleShaVerdict without side effects.
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
