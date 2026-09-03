// Release-integrity guard (production-readiness audit 2026-09-02, C4 / Codex row
// 1: "593 unpushed unverified commits; `npm run release` publishes whatever is
// on disk with no build; no version bump, no git SHA in the artifact"). Runs at
// the START of `dist` and `release`, so a publish can only ever carry a tree
// that is committed, pushed, and version-bumped.
//
// Checks (a failing one prints WHY and exits non-zero):
//   1. Clean tree — `git status --porcelain` shows no TRACKED changes. A build
//      cut from uncommitted edits is unreproducible and unverifiable.
//   2. Pushed — an upstream MUST exist and HEAD must not be ahead of it. CI has
//      never seen an unpushed commit, so it is unverified server-side.
//   3. (release only) Version is new — package.json `version` is strictly newer
//      than the latest published version (a `v<semver>` git tag or dist/latest.yml).
//      electron-updater only offers an update when the feed's `version` is a
//      GREATER semver than the installed one, so re-publishing an equal (or
//      older) version is INVISIBLE to every installed client.
//
// Checks 1 and 2 are skippable with STRIX_ALLOW_DIRTY_DIST=1 — for a LOCAL test
// build (`dist`, never `release`). Check 3 has no opt-out: shipping a version an
// updater cannot see is never intentional.
//
// git is invoked with execFileSync (no shell) and fixed argument lists — there
// is no interpolated input, so there is no injection surface.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const scriptDir = dirname(fileURLToPath(import.meta.url)) // desktop/scripts
const desktopDir = resolve(scriptDir, '..') // desktop
const mode = process.argv[2] === 'release' ? 'release' : 'dist'
const allowDirty = process.env.STRIX_ALLOW_DIRTY_DIST === '1'

function fail(message) {
  console.error(`[release-guard] ${message}`)
  process.exit(1)
}

/** Run git with a fixed argument list; returns trimmed stdout. */
function git(args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
}

// --- Checks 1 + 2: clean + pushed --------------------------------------------
if (allowDirty) {
  console.log('[release-guard] STRIX_ALLOW_DIRTY_DIST=1 — skipping clean-tree and pushed checks (local test build)')
} else {
  // Only TRACKED changes matter — build outputs (out/, dist/, embedded/) are
  // gitignored and must not block a build.
  const dirty = git(['status', '--porcelain', '--untracked-files=no'])
  if (dirty) {
    fail(
      `working tree has uncommitted tracked changes:\n${dirty}\n` +
        'commit them (a publish must be reproducible from a commit), or set ' +
        'STRIX_ALLOW_DIRTY_DIST=1 for a local-only test build.'
    )
  }

  let upstream
  try {
    upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  } catch {
    fail(
      'no upstream is configured for the current branch, so "is this pushed?" ' +
        'cannot be answered. Set one (git push -u origin <branch>) so CI can ' +
        'verify this tree, or STRIX_ALLOW_DIRTY_DIST=1 for a local-only test build.'
    )
  }
  const ahead = Number(git(['rev-list', '--count', `${upstream}..HEAD`]))
  if (ahead > 0) {
    fail(
      `${ahead} commit(s) ahead of ${upstream} are unpushed and unverified by ` +
        'CI. Push before building a release, or STRIX_ALLOW_DIRTY_DIST=1 for a ' +
        'local-only test build.'
    )
  }
  console.log(`[release-guard] tree clean and level with ${upstream}`)
}

// --- Check 3: version is newer than what is published (release only) ---------
if (mode === 'release') {
  const pkg = JSON.parse(readFileSync(resolve(desktopDir, 'package.json'), 'utf8'))
  const version = String(pkg.version)
  if (!parseSemver(version)) fail(`package.json version is not a semver: ${version}`)
  const published = latestPublishedVersion()
  if (published && compareSemver(version, published) <= 0) {
    fail(
      `package.json version ${version} is not newer than the latest published ` +
        `version ${published}. electron-updater offers an update only for a ` +
        `GREATER semver, so publishing ${version} would be invisible to installed ` +
        'clients. Bump "version" in desktop/package.json before releasing.'
    )
  }
  console.log(
    published
      ? `[release-guard] version ${version} is newer than published ${published}`
      : `[release-guard] version ${version} — no prior published version found (first release)`
  )
}

console.log(`[release-guard] OK (${mode})`)

// --- Helpers -----------------------------------------------------------------

/**
 * Latest already-published version, from the tags electron-builder's GitHub
 * publish creates (`v<semver>`) and, if present, the last built/published feed
 * manifest (dist/latest.yml). Returns null when nothing has been published.
 */
function latestPublishedVersion() {
  const candidates = []
  try {
    for (const tag of git(['tag', '--list', 'v*']).split('\n')) {
      const v = tag.trim().replace(/^v/, '')
      if (parseSemver(v)) candidates.push(v)
    }
  } catch {
    // no tags / no git — nothing published this way
  }
  const latestYml = resolve(desktopDir, 'dist', 'latest.yml')
  if (existsSync(latestYml)) {
    const m = readFileSync(latestYml, 'utf8').match(/^version:\s*(.+)$/m)
    if (m && parseSemver(m[1].trim())) candidates.push(m[1].trim())
  }
  if (candidates.length === 0) return null
  return candidates.sort(compareSemver).at(-1)
}

/** Parse a semver into release triple + prerelease identifiers, or null. */
function parseSemver(v) {
  const m = String(v).trim().match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  if (!m) return null
  return { release: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}

/**
 * Compare two semvers by SemVer 2.0 precedence (a stable outranks any
 * prerelease of the same release; numeric prerelease identifiers sort below
 * alphanumeric ones). Accepts strings or parsed objects. Returns -1/0/1.
 */
function compareSemver(a, b) {
  const pa = typeof a === 'string' ? parseSemver(a) : a
  const pb = typeof b === 'string' ? parseSemver(b) : b
  for (let i = 0; i < 3; i++) {
    if (pa.release[i] !== pb.release[i]) return pa.release[i] < pb.release[i] ? -1 : 1
  }
  if (pa.pre.length === 0 && pb.pre.length === 0) return 0
  if (pa.pre.length === 0) return 1 // stable > prerelease
  if (pb.pre.length === 0) return -1
  const n = Math.max(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    if (x === undefined) return -1 // shorter prerelease is smaller
    if (y === undefined) return 1
    const xn = /^\d+$/.test(x)
    const yn = /^\d+$/.test(y)
    if (xn && yn) {
      const d = Number(x) - Number(y)
      if (d !== 0) return d < 0 ? -1 : 1
    } else if (xn) {
      return -1 // numeric identifiers rank below alphanumeric
    } else if (yn) {
      return 1
    } else if (x !== y) {
      return x < y ? -1 : 1
    }
  }
  return 0
}
