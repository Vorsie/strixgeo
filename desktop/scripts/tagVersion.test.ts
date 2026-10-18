// Unit tests for the tag/version guard of the hosted installer build. The
// rule: a release tag v<semver> must name exactly the version in
// desktop/package.json, so a tag pushed on the wrong tree fails before any
// staging starts. Pure: tag and version are arguments.
import { describe, expect, it } from 'vitest'

import { tagMatchesVersion, tagVersionsExcludingBuildTag } from './tagVersion.mjs'

describe('tagMatchesVersion', () => {
  it('TV1: v0.2.1 matches package version 0.2.1', () => {
    expect(tagMatchesVersion('v0.2.1', '0.2.1')).toEqual({ ok: true, message: 'tag v0.2.1 matches package version 0.2.1' })
  })

  it('TV2: a tag of another version fails and names both', () => {
    const verdict = tagMatchesVersion('v0.2.1', '0.2.0')
    expect(verdict.ok).toBe(false)
    expect(verdict.message).toContain('v0.2.1')
    expect(verdict.message).toContain('0.2.0')
  })

  it('TV3: a tag without the v prefix fails', () => {
    expect(tagMatchesVersion('0.2.1', '0.2.1').ok).toBe(false)
  })

  it('TV4: a prerelease tag matches a prerelease version exactly', () => {
    expect(tagMatchesVersion('v0.3.0-beta.1', '0.3.0-beta.1').ok).toBe(true)
    expect(tagMatchesVersion('v0.3.0-beta.1', '0.3.0').ok).toBe(false)
  })

  it('TV5: an empty tag fails', () => {
    expect(tagMatchesVersion('', '0.2.1').ok).toBe(false)
  })
})

// The release guard's version check takes the max over the releases feed AND
// the v* git tags. On a tag-triggered CI build the tag being built is already
// in the checkout, so counting it as "published" would refuse every hosted
// release. The rule: the tag the workflow is building is not published yet
// (a draft is invisible to clients); every other tag still counts.
describe('tagVersionsExcludingBuildTag', () => {
  it('TV6: the tag being built is not counted as published', () => {
    expect(tagVersionsExcludingBuildTag(['0.2.0', '0.2.1'], 'v0.2.1')).toEqual(['0.2.0'])
  })

  it('TV7: every other tag still counts, so a stale version is still refused', () => {
    expect(tagVersionsExcludingBuildTag(['0.2.0', '0.2.1', '0.3.0'], 'v0.2.1')).toEqual(['0.2.0', '0.3.0'])
  })

  it('TV8: outside a tag build (no build tag) nothing is dropped', () => {
    expect(tagVersionsExcludingBuildTag(['0.2.0', '0.2.1'], undefined)).toEqual(['0.2.0', '0.2.1'])
  })
})
