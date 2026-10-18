// Release-integrity guard (production-readiness audit 2026-09-02, C4 / Codex row
// 1: "593 unpushed unverified commits; `npm run release` publishes whatever is
// on disk with no build; no version bump, no git SHA in the artifact"). Runs at
// the START of `dist` and `release`, so a publish can only ever carry a tree
// that is committed, pushed, and version-bumped.
//
// Checks (a failing one prints WHY and exits non-zero):
//   1. Clean tree — `git status --porcelain` shows no TRACKED changes. A build
//      cut from uncommitted edits is unreproducible and unverifiable.
//   2. Pushed: locally, an upstream MUST exist and HEAD must not be ahead of
//      it: CI has never seen an unpushed commit, so it is unverified
//      server-side. Under GitHub Actions (GITHUB_ACTIONS=true) the checkout is
//      detached and has no upstream, so the proof is HEAD == GITHUB_SHA: the
//      commit GitHub handed the runner. The rule lives in pushedCheck.mjs.
//   3. (release only) Version is new — package.json `version` is strictly newer
//      than the latest PUBLISHED version. "Published" means what an installed
//      client can actually be offered: the GitHub releases feed of
//      Vorsie/strixgeo (read-only, via `gh`) when reachable, else the
//      `v<semver>` git tags on the source repo. A local `dist/latest.yml` is
//      NEVER a source — every `npm run dist` rewrites it, and reading it as
//      "published" refused the first real release while the feed was empty
//      (Vorsie/Strix #9). electron-updater only offers an update when the feed's
//      `version` is a GREATER semver than the installed one, so re-publishing an
//      equal (or older) version is INVISIBLE to every installed client.
//      On a tag-triggered GitHub Actions build, the tag being built is left
//      out of the git tags (its release is still a draft; tagVersion.mjs).
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

import { latestPublishedVersion, readGitTagVersions, releaseVersionError } from './publishedVersion.mjs'
import { ciFactsFromEnv, decidePushed } from './pushedCheck.mjs'
import { tagVersionsExcludingBuildTag } from './tagVersion.mjs'

const scriptDir = dirname(fileURLToPath(import.meta.url)) // desktop/scripts
const desktopDir = resolve(scriptDir, '..') // desktop
const mode = process.argv[2] === 'release' ? 'release' : 'dist'
const allowDirty = process.env.STRIX_ALLOW_DIRTY_DIST === '1'
// Under GitHub Actions: the commit handed to the runner, and on a tag push the
// tag being built. Both undefined in a local shell (pushedCheck.mjs).
const ciFacts = ciFactsFromEnv(process.env)

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

  let upstream = null
  try {
    upstream = git(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])
  } catch {
    upstream = null
  }
  const ahead = upstream === null ? null : Number(git(['rev-list', '--count', `${upstream}..HEAD`]))
  // Under GitHub Actions the checkout is detached: the proof of "pushed" is
  // HEAD == GITHUB_SHA (the commit GitHub handed the runner). Peeled to its
  // commit, because an annotated tag push may name the tag object.
  const githubSha =
    ciFacts.githubSha === undefined ? undefined : git(['rev-parse', `${ciFacts.githubSha}^{commit}`])
  const headSha = git(['rev-parse', 'HEAD'])
  const pushed = decidePushed({ upstream, ahead, githubSha, headSha })
  if (!pushed.ok) fail(pushed.message)
  console.log(`[release-guard] tree clean; ${pushed.message}`)
}

// --- Check 3: version is newer than what is published (release only) ---------
if (mode === 'release') {
  const pkg = JSON.parse(readFileSync(resolve(desktopDir, 'package.json'), 'utf8'))
  const version = String(pkg.version)

  // "Published" comes from the releases feed (preferred) or the git tags — never
  // a local build output. When the feed cannot be read (no GH_TOKEN, offline,
  // gh not installed) that is "cannot tell", not "nothing published", so the
  // guard says so and falls back to the git tags.
  //
  // On a tag-triggered GitHub Actions build the tag being built is already in
  // the checkout, but its release is still a draft no client can see; it is
  // not "published", so it is left out of the tag versions. A version already
  // published under that tag is still caught by the releases feed.
  const { buildTag } = ciFacts
  const { version: published, source, feedReachable, feedDetail } = latestPublishedVersion({
    readTags: () => tagVersionsExcludingBuildTag(readGitTagVersions(), buildTag),
  })
  if (buildTag) console.log(`[release-guard] building tag ${buildTag}: not counted as published`)
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
