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
//      than the latest PUBLISHED version. "Published" means what an installed
//      client can actually be offered: the GitHub releases feed of
//      Vorsie/strixgeo-releases (read-only, via `gh`) when reachable, else the
//      `v<semver>` git tags on the source repo. A local `dist/latest.yml` is
//      NEVER a source — every `npm run dist` rewrites it, and reading it as
//      "published" refused the first real release while the feed was empty
//      (Vorsie/Strix #9). electron-updater only offers an update when the feed's
//      `version` is a GREATER semver than the installed one, so re-publishing an
//      equal (or older) version is INVISIBLE to every installed client.
//
// Checks 1 and 2 are skippable with STRIX_ALLOW_DIRTY_DIST=1 — for a LOCAL test
// build (`dist`, never `release`). Check 3 has no opt-out: shipping a version an
// updater cannot see is never intentional.
//
// git is invoked with execFileSync (no shell) and fixed argument lists — there
// is no interpolated input, so there is no injection surface.
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { latestPublishedVersion, releaseVersionError } from './publishedVersion.mjs'

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

  // "Published" comes from the releases feed (preferred) or the git tags — never
  // a local build output. When the feed cannot be read (no GH_TOKEN, offline,
  // gh not installed) that is "cannot tell", not "nothing published", so the
  // guard says so and falls back to the git tags.
  const { version: published, source, feedReachable, feedDetail } = latestPublishedVersion()
  if (!feedReachable) {
    console.log(
      `[release-guard] releases feed unreachable (${feedDetail}); using git tags to find the published version`
    )
  }
  console.log(
    published
      ? `[release-guard] published version ${published} from ${source === 'releases feed' ? 'the releases feed' : 'git tags'}`
      : '[release-guard] published version: none published'
  )

  const error = releaseVersionError({ version, published })
  if (error) fail(error)

  console.log(
    published
      ? `[release-guard] version ${version} is newer than published ${published}`
      : `[release-guard] version ${version} — no prior published version found (first release)`
  )
}

console.log(`[release-guard] OK (${mode})`)
