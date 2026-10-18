// Unit tests for the "is this tree pushed?" rule of the release guard. The
// rule: locally, an upstream must exist and HEAD must not be ahead of it; on
// GitHub Actions the checkout is detached, so the proof is HEAD == GITHUB_SHA
// (the commit the runner checked out is the one GitHub has). Pure: the git
// facts and the environment facts are arguments.
import { describe, expect, it } from 'vitest'

import { ciFactsFromEnv, decidePushed } from './pushedCheck.mjs'

const SHA = 'a'.repeat(40)

describe('decidePushed', () => {
  it('PC1: locally, an upstream with zero commits ahead is pushed', () => {
    expect(decidePushed({ upstream: 'origin/develop', ahead: 0 })).toEqual({ ok: true, message: 'tree level with origin/develop' })
  })

  it('PC2: locally, commits ahead of the upstream fail with the count', () => {
    const verdict = decidePushed({ upstream: 'origin/develop', ahead: 2 })
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('2 commit(s)')
  })

  it('PC3: locally, no upstream fails', () => {
    expect(decidePushed({ upstream: null, ahead: null }).ok).toBe(false)
  })

  it('PC4: on GitHub Actions, HEAD equal to GITHUB_SHA is pushed even without an upstream', () => {
    const verdict = decidePushed({ upstream: null, ahead: null, githubSha: SHA, headSha: SHA })
    expect(verdict.ok).toBe(true)
    expect(verdict.message).toContain('GITHUB_SHA')
  })

  it('PC5: on GitHub Actions, HEAD different from GITHUB_SHA fails', () => {
    const verdict = decidePushed({ upstream: null, ahead: null, githubSha: SHA, headSha: 'b'.repeat(40) })
    expect(verdict.ok).toBe(false)
  })
})

// The guard reads two facts from the environment: the commit GitHub handed the
// runner (only under GitHub Actions) and the tag being built (only when the
// workflow was triggered by a tag). Outside Actions both are absent, so the
// local rules apply unchanged.
describe('ciFactsFromEnv', () => {
  it('CF1: a local shell gives neither a GitHub SHA nor a build tag', () => {
    expect(ciFactsFromEnv({ GITHUB_SHA: SHA, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.2.1' })).toEqual({
      githubSha: undefined,
      buildTag: undefined,
    })
  })

  it('CF2: GitHub Actions on a branch gives the GitHub SHA only', () => {
    expect(
      ciFactsFromEnv({ GITHUB_ACTIONS: 'true', GITHUB_SHA: SHA, GITHUB_REF_TYPE: 'branch', GITHUB_REF_NAME: 'develop' })
    ).toEqual({ githubSha: SHA, buildTag: undefined })
  })

  it('CF3: GitHub Actions on a tag gives the GitHub SHA and the tag being built', () => {
    expect(
      ciFactsFromEnv({ GITHUB_ACTIONS: 'true', GITHUB_SHA: SHA, GITHUB_REF_TYPE: 'tag', GITHUB_REF_NAME: 'v0.2.1' })
    ).toEqual({ githubSha: SHA, buildTag: 'v0.2.1' })
  })
})
