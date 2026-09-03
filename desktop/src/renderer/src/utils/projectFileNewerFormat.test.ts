// Production-readiness audit L4: a .strix whose INNER bundle format_version is
// NEWER than this build read as "corrupt" — parseProjectFile returns null, and
// the caller shows the generic "may be corrupt, or the API isn't reachable"
// banner. That is dishonest: the file is fine, the build is just too old. The
// rule pinned here, in the audit's words: a newer inner format_version is
// distinguished from corruption so the open flow can say "saved by a newer
// build" instead.

import { describe, expect, it } from 'vitest'

import { BUNDLE_NEWER_FORMAT_CODE, newerBundleFormatVersion } from './projectFile'

/** A JSON string whose top-level format_version is exactly `version`. */
function fileWithVersion(version: unknown): string {
  return JSON.stringify({ format_version: version, project: { id: 'p1' } })
}

describe('newerBundleFormatVersion — "saved by a newer build" vs "corrupt"', () => {
  it('reports the version number when the file is from a NEWER build', () => {
    expect(newerBundleFormatVersion(fileWithVersion(4))).toBe(4)
    expect(newerBundleFormatVersion(fileWithVersion(99))).toBe(99)
  })

  it('reports null for the current on-disk version 3 (not newer)', () => {
    expect(newerBundleFormatVersion(fileWithVersion(3))).toBeNull()
  })

  it('reports null for an OLDER version — an old file is corrupt-path, not newer', () => {
    expect(newerBundleFormatVersion(fileWithVersion(2))).toBeNull()
    expect(newerBundleFormatVersion(fileWithVersion(1))).toBeNull()
  })

  it('reports null for non-JSON, a non-object, a missing or non-numeric version', () => {
    expect(newerBundleFormatVersion('this is not json {')).toBeNull()
    expect(newerBundleFormatVersion('[1,2,3]')).toBeNull()
    expect(newerBundleFormatVersion('42')).toBeNull()
    expect(newerBundleFormatVersion(JSON.stringify({ project: { id: 'p1' } }))).toBeNull()
    // A stringified number is not a newer *numeric* version.
    expect(newerBundleFormatVersion(fileWithVersion('4'))).toBeNull()
  })

  it('exposes a stable discriminator code for the open flow to branch on', () => {
    expect(BUNDLE_NEWER_FORMAT_CODE).toBe('bundle-newer-format')
  })
})
