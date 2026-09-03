// Beta-stamp gate for packaging (production-readiness audit 2026-09-02, C1).
//
// `npm run package` rebuilds the main bundle, and electron-vite inlines
// `import.meta.env.MAIN_VITE_STRIX_BETA_EXPIRES_AT` at THAT build. Without the
// variable the compiled stamp is undefined and the packaged app never expires,
// which voids the owner's "beta builds expire" ruling. Two checks:
//   pre  — the variable must be set (opt out with STRIX_ALLOW_UNSTAMPED=1 for a
//          local dev package that will never leave this machine);
//   post — the ISO string must actually be present in out/main/index.js.
//
// The post check ALSO verifies build provenance (audit 2026-09-02, C4): the git
// SHA is injected through the same MAIN_VITE_ channel (electron.vite.config.ts),
// so if that injection silently failed the SHA would be absent from the bundle
// and every build would ship with no provenance. Grep for it here and fail the
// package rather than ship it blind.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { resolveBuildSha, UNKNOWN_SHA } from './buildProvenance.mjs'

const mode = process.argv[2]
const stamp = process.env.MAIN_VITE_STRIX_BETA_EXPIRES_AT ?? ''
const optOut = process.env.STRIX_ALLOW_UNSTAMPED === '1'

if (mode === 'pre') {
  if (stamp) {
    if (Number.isNaN(Date.parse(stamp))) fail(`MAIN_VITE_STRIX_BETA_EXPIRES_AT is not an ISO date: ${stamp}`)
    console.log(`[beta-stamp] packaging with expiry ${stamp}`)
  } else if (optOut) {
    console.warn('[beta-stamp] WARNING: packaging WITHOUT an expiry stamp (STRIX_ALLOW_UNSTAMPED=1) — never distribute this build')
  } else {
    fail('MAIN_VITE_STRIX_BETA_EXPIRES_AT is not set. A packaged build must carry a beta expiry; set it (ISO date) or STRIX_ALLOW_UNSTAMPED=1 for a local-only package.')
  }
} else if (mode === 'post') {
  const bundle = resolve('out/main/index.js')
  if (!existsSync(bundle)) fail(`${bundle} missing after build`)
  const text = readFileSync(bundle, 'utf8')
  if (stamp && !text.includes(stamp)) fail(`the built main bundle does not contain the expiry ${stamp} — the stamp was not inlined`)
  // A stamp is only a stamp with a built-at instant (buildStamp.ts): the config
  // derives it from the build time, and the bundle must carry it as a literal.
  if (stamp && !/builtAt:\s*"[0-9]{4}-[0-9]{2}-[0-9]{2}T/.test(text)) fail('the built main bundle carries an expiry but no builtAt — readBuildStamp() would return null and the app would run unstamped')
  if (!stamp && !optOut) fail('post-check reached without a stamp and without the opt-out')
  console.log(`[beta-stamp] verified: ${stamp ? `bundle carries ${stamp}` : 'unstamped local package (opt-out)'}`)
  // Provenance: resolves the SAME way as electron.vite.config.ts (env override
  // else `git rev-parse HEAD`) from the SAME HEAD, so the grep target matches
  // what was inlined. A build with no reachable git (UNKNOWN_SHA) can't be
  // verified — warn rather than fail, since that is not an injection failure.
  const sha = resolveBuildSha()
  if (sha === UNKNOWN_SHA) {
    console.warn('[beta-stamp] WARNING: git SHA unavailable — build provenance in the bundle could not be verified')
  } else if (!text.includes(sha)) {
    fail(`the built main bundle does not contain the git SHA ${sha} — build provenance was not inlined (see electron.vite.config.ts / buildStamp.ts)`)
  } else {
    console.log(`[beta-stamp] verified: bundle carries git SHA ${sha.slice(0, 12)}`)
  }
} else {
  fail(`usage: require-beta-stamp.mjs pre|post (got ${mode})`)
}

function fail(message) {
  console.error(`[beta-stamp] ${message}`)
  process.exit(1)
}
