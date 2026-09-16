// Published-version resolution for the release guard (Vorsie/Strix #9).
//
// "Published" means a release the auto-updater can actually offer to installed
// clients. Only two things carry that meaning:
//   (a) the GitHub releases feed of Vorsie/strixgeo-releases — the
//       electron-updater feed (provider: github). Read-only, via `gh api` with
//       the same GH_TOKEN the release publish uses; and
//   (b) the git tags on the source repo (`v<semver>`, prerelease identifiers
//       included), which electron-builder's GitHub publish creates.
//
// A local `desktop/dist/latest.yml` is DELIBERATELY not a source: every
// `npm run dist` rewrites it with the current package version, so reading it as
// "published" refused the first real release while the releases repo was still
// empty (#9). This module never touches it.
import { execFileSync } from 'node:child_process'

// The electron-updater feed repo. Its releases (not the private source repo's
// tags) are what an installed client sees, so it is the primary "published"
// source. Kept here as the single source of truth for both the feed read and
// the human-facing guard message.
export const RELEASES_REPO = 'Vorsie/strixgeo-releases'

/**
 * Run `gh` with a fixed argument list and return trimmed stdout.
 *
 * Fixed args only — there is no interpolated input, so no shell and no
 * injection surface. `gh` picks up GH_TOKEN / its stored auth from the
 * environment, the same credential the release publish uses.
 *
 * @param {string[]} args - gh subcommand + arguments.
 * @returns {string} Trimmed stdout.
 */
function defaultRunGh(args) {
  return execFileSync('gh', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()
}

/**
 * Run `git` with a fixed argument list and return trimmed stdout.
 *
 * @param {string[]} args - git subcommand + arguments.
 * @returns {string} Trimmed stdout.
 */
function defaultRunGit(args) {
  return execFileSync('git', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim()
}

/**
 * Read the highest already-published version from the releases feed.
 *
 * Reachability is the whole point: a failed `gh` call (no GH_TOKEN, not
 * authenticated, offline, gh not installed) is NOT "nothing published" — it is
 * "cannot tell", so the caller must fall back to git tags rather than treat the
 * feed as empty. The returned ``reachable`` flag carries that distinction.
 *
 * Drafts are excluded (a draft is not visible to any client); prereleases are
 * included (a published prerelease IS offered). Only the first page of releases
 * is read (per_page=100, newest first) — more than enough for a beta, and the
 * max semver over that window is the latest published version in practice.
 *
 * @param {object} [deps] - Injection seam for tests.
 * @param {(args: string[]) => string} [deps.run] - gh runner; defaults to a
 *     real `gh api` call.
 * @returns {{reachable: boolean, version: string | null, detail: string}}
 *     ``reachable`` false when the feed could not be read; ``version`` the max
 *     published semver (or null); ``detail`` a short human-facing reason.
 */
export function readReleaseFeedVersion({ run = defaultRunGh } = {}) {
  let raw
  try {
    raw = run([
      'api',
      `repos/${RELEASES_REPO}/releases?per_page=100`,
      '-H',
      'Accept: application/vnd.github+json',
    ])
  } catch (error) {
    return { reachable: false, version: null, detail: describeGhError(error) }
  }
  let releases
  try {
    releases = JSON.parse(raw)
  } catch {
    // Reachable but the payload was not the expected JSON array — treat as
    // "reached, nothing usable" rather than fall through to tags silently.
    return { reachable: true, version: null, detail: 'releases feed returned no parseable JSON' }
  }
  const versions = []
  for (const release of Array.isArray(releases) ? releases : []) {
    if (release && release.draft) continue // a draft is not visible to clients
    const tag = String((release && release.tag_name) || '').replace(/^v/, '')
    if (parseSemver(tag)) versions.push(tag)
  }
  const version = versions.length ? versions.slice().sort(compareSemver).at(-1) : null
  return { reachable: true, version, detail: 'releases feed' }
}

/**
 * Read `v<semver>` tags on the current repo, as bare semver strings.
 *
 * @param {object} [deps] - Injection seam for tests.
 * @param {(args: string[]) => string} [deps.run] - git runner; defaults to a
 *     real `git tag --list v*` call.
 * @returns {string[]} Semver strings (prerelease identifiers kept); non-semver
 *     tags dropped. Order is git's; the caller picks the max.
 */
export function readGitTagVersions({ run = defaultRunGit } = {}) {
  let raw
  try {
    raw = run(['tag', '--list', 'v*'])
  } catch {
    return [] // no tags / no git — nothing published this way
  }
  const versions = []
  for (const line of raw.split('\n')) {
    const v = line.trim().replace(/^v/, '')
    if (parseSemver(v)) versions.push(v)
  }
  return versions
}

/**
 * Combine a feed result and git tag versions into the single published version
 * and the source it came from.
 *
 * Both the feed and the tags mean "published", so the reported version is the
 * max semver across them; the ``source`` names where that winning version came
 * from (the feed wins an exact tie, since the feed is what clients actually
 * see).
 *
 * @param {object} args
 * @param {{reachable: boolean, version: string | null, detail: string}} args.feed
 *     The result of {@link readReleaseFeedVersion}.
 * @param {string[]} args.tagVersions - The result of {@link readGitTagVersions}.
 * @returns {{version: string | null, source: 'releases feed' | 'git tags' | 'none', feedReachable: boolean, feedDetail: string}}
 */
export function resolvePublishedVersion({ feed, tagVersions }) {
  const versions = []
  if (feed.reachable && feed.version) versions.push(feed.version)
  for (const v of tagVersions) versions.push(v)
  if (versions.length === 0) {
    return { version: null, source: 'none', feedReachable: feed.reachable, feedDetail: feed.detail }
  }
  const max = versions.slice().sort(compareSemver).at(-1)
  const fromFeed = feed.reachable && feed.version != null && compareSemver(feed.version, max) === 0
  return {
    version: max,
    source: fromFeed ? 'releases feed' : 'git tags',
    feedReachable: feed.reachable,
    feedDetail: feed.detail,
  }
}

/**
 * The latest already-published version, from the releases feed with a git-tag
 * fallback. Readers are injectable so the whole thing runs offline in tests.
 *
 * @param {object} [deps] - Injection seam for tests.
 * @param {() => {reachable: boolean, version: string | null, detail: string}} [deps.readFeed]
 * @param {() => string[]} [deps.readTags]
 * @returns {{version: string | null, source: 'releases feed' | 'git tags' | 'none', feedReachable: boolean, feedDetail: string}}
 */
export function latestPublishedVersion({
  readFeed = readReleaseFeedVersion,
  readTags = readGitTagVersions,
} = {}) {
  const feed = readFeed()
  const tagVersions = readTags()
  return resolvePublishedVersion({ feed, tagVersions })
}

/**
 * Decide whether a package version may be released against the published one.
 *
 * electron-updater offers an update only for a GREATER semver, so a version
 * equal to or lower than the published one is invisible to installed clients
 * and is refused. When nothing is published (``published`` null) any valid
 * semver is allowed (first release).
 *
 * @param {object} args
 * @param {string} args.version - The candidate package.json version.
 * @param {string | null} args.published - The latest published version, or null.
 * @returns {string | null} A refusal message, or null when the release may proceed.
 */
export function releaseVersionError({ version, published }) {
  if (!parseSemver(version)) return `package.json version is not a semver: ${version}`
  if (published && compareSemver(version, published) <= 0) {
    return (
      `package.json version ${version} is not newer than the latest published ` +
      `version ${published}. electron-updater offers an update only for a ` +
      `GREATER semver, so publishing ${version} would be invisible to installed ` +
      'clients. Bump "version" in desktop/package.json before releasing.'
    )
  }
  return null
}

/**
 * Turn a thrown `gh` error into a short, human-facing reason for the guard log.
 *
 * @param {unknown} error - The error execFileSync threw.
 * @returns {string} A one-line reason, truncated.
 */
function describeGhError(error) {
  if (error && error.code === 'ENOENT') return 'gh CLI not found on PATH'
  const stderr = error && error.stderr ? error.stderr.toString().trim() : ''
  const message = stderr || (error && error.message) || 'unknown error'
  const firstLine = message.split('\n').find((line) => line.trim()) || 'unknown error'
  return firstLine.trim().slice(0, 200)
}

/**
 * Parse a semver into its release triple + prerelease identifiers, or null.
 *
 * @param {string} v - The version string.
 * @returns {{release: number[], pre: string[]} | null}
 */
export function parseSemver(v) {
  const m = String(v)
    .trim()
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/)
  if (!m) return null
  return { release: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ? m[4].split('.') : [] }
}

/**
 * Compare two semvers by SemVer 2.0 precedence (a stable outranks any
 * prerelease of the same release; numeric prerelease identifiers sort below
 * alphanumeric ones). Accepts strings or parsed objects. Returns -1/0/1.
 *
 * @param {string | {release: number[], pre: string[]}} a
 * @param {string | {release: number[], pre: string[]}} b
 * @returns {number} -1, 0, or 1.
 */
export function compareSemver(a, b) {
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
