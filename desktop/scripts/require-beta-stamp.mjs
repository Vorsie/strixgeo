// Beta-stamp gate for packaging (production-readiness audit 2026-09-02, C1).
//
// `npm run package` rebuilds the main bundle, and electron-vite inlines
// `import.meta.env.MAIN_VITE_STRIX_BETA_EXPIRES_AT` at THAT build. Without the
// variable the compiled stamp is undefined and the packaged app never expires,
// which voids the owner's "beta builds expire" ruling. Two checks:
//   pre  — the variable must be set (opt out with STRIX_ALLOW_UNSTAMPED=1 for a
//          local dev package that will never leave this machine);
//   post — the ISO string must actually be present in out/main/index.js.
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

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
  if (!stamp && !optOut) fail('post-check reached without a stamp and without the opt-out')
  console.log(`[beta-stamp] verified: ${stamp ? `bundle carries ${stamp}` : 'unstamped local package (opt-out)'}`)
} else {
  fail(`usage: require-beta-stamp.mjs pre|post (got ${mode})`)
}

function fail(message) {
  console.error(`[beta-stamp] ${message}`)
  process.exit(1)
}
