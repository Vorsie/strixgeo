// The "is this tree pushed?" rule of the release guard
// (require-clean-release.mjs). A publish must carry a tree CI could verify:
// locally that means an upstream exists and HEAD is not ahead of it. On
// GitHub Actions the checkout is detached (no upstream), and the proof is
// that HEAD is the commit GitHub handed the runner (GITHUB_SHA). Pure so it
// is unit tested; the guard gathers the facts and calls it.

/**
 * Decide whether HEAD is a pushed commit.
 *
 * @param {{ upstream: string | null, ahead: number | null, githubSha?: string, headSha?: string }} facts
 *   ``upstream`` is ``@{u}`` or null when none is configured; ``ahead`` is the
 *   count of commits in ``upstream..HEAD``; ``githubSha`` is GITHUB_SHA when
 *   running under GitHub Actions; ``headSha`` is ``git rev-parse HEAD``.
 * @returns {{ ok: boolean, message: string }}
 */
export function decidePushed({ upstream, ahead, githubSha, headSha }) {
  if (githubSha !== undefined) {
    if (githubSha === headSha) {
      return { ok: true, message: `HEAD ${headSha.slice(0, 9)} is the commit GitHub Actions checked out (GITHUB_SHA)` }
    }
    return {
      ok: false,
      message: `HEAD ${String(headSha).slice(0, 9)} differs from GITHUB_SHA ${githubSha.slice(0, 9)}; the workflow must build the checked-out commit`,
    }
  }
  if (upstream === null) {
    return {
      ok: false,
      message:
        'no upstream is configured for the current branch, so "is this pushed?" cannot be answered. ' +
        'Set one (git push -u origin <branch>) so CI can verify this tree, or STRIX_ALLOW_DIRTY_DIST=1 for a local-only test build.',
    }
  }
  if (ahead > 0) {
    return {
      ok: false,
      message:
        `${ahead} commit(s) ahead of ${upstream} are unpushed and unverified by CI. ` +
        'Push before building a release, or STRIX_ALLOW_DIRTY_DIST=1 for a local-only test build.',
    }
  }
  return { ok: true, message: `tree level with ${upstream}` }
}

/**
 * Read the GitHub Actions facts the release guard needs from the environment.
 *
 * Outside GitHub Actions both facts are undefined, so the local rules apply
 * unchanged (upstream for "pushed", every git tag counts as published).
 *
 * @param {Record<string, string | undefined>} env - The process environment.
 * @returns {{ githubSha: string | undefined, buildTag: string | undefined }}
 *   ``githubSha`` is GITHUB_SHA when GITHUB_ACTIONS is ``'true'``;
 *   ``buildTag`` is GITHUB_REF_NAME when, in addition, GITHUB_REF_TYPE is
 *   ``'tag'`` (the workflow was triggered by a tag push).
 */
export function ciFactsFromEnv(env) {
  if (env.GITHUB_ACTIONS !== 'true') return { githubSha: undefined, buildTag: undefined }
  return {
    githubSha: env.GITHUB_SHA,
    buildTag: env.GITHUB_REF_TYPE === 'tag' ? env.GITHUB_REF_NAME : undefined,
  }
}
