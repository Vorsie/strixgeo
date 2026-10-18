// Tag/version rule of the hosted installer build (.github/workflows/release.yml).
//
// A release tag is the ONLY trigger of a published build, so the tag and the
// package version must agree: electron-builder names the release v<version>
// from desktop/package.json, and a tag v0.2.1 pushed on a tree that still says
// 0.2.0 would build 0.2.0 again and attach it to the wrong release. The check
// is pure so it is unit tested; require-tag-matches-version.mjs is the CLI.

/**
 * Decide whether a release tag names the package version.
 *
 * @param {string} tag - The pushed tag, e.g. ``v0.2.1`` (GITHUB_REF_NAME).
 * @param {string} version - The ``version`` field of desktop/package.json.
 * @returns {{ ok: boolean, message: string }}
 */
export function tagMatchesVersion(tag, version) {
  const expected = `v${version}`
  if (tag === expected) {
    return { ok: true, message: `tag ${tag} matches package version ${version}` }
  }
  return {
    ok: false,
    message:
      `tag ${JSON.stringify(tag)} does not match package version ${version} (expected ${expected}); ` +
      'bump desktop/package.json on a branch, land it, then tag that commit',
  }
}

/**
 * Drop the tag a CI build is building from the git-tag versions the release
 * guard counts as "published".
 *
 * The guard's version check takes the max over the releases feed and the
 * ``v*`` git tags. On a tag-triggered GitHub Actions build the tag being built
 * is already in the checkout, but its release is still a draft that no client
 * can see, so it is not published. Every other tag still counts; a version
 * already published under this tag is still caught by the releases feed.
 *
 * @param {string[]} tagVersions - Bare semver strings from ``git tag --list v*``.
 * @param {string | undefined} buildTag - The tag being built (``GITHUB_REF_NAME``
 *   on a tag push), or undefined outside a tag build.
 * @returns {string[]} ``tagVersions`` without the version of ``buildTag``.
 */
export function tagVersionsExcludingBuildTag(tagVersions, buildTag) {
  if (!buildTag) return tagVersions
  return tagVersions.filter(version => `v${version}` !== buildTag)
}
