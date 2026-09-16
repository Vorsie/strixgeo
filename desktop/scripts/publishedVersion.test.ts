// Unit tests for the release guard's published-version resolution
// (Vorsie/Strix #9). The "published" version must come only from what actually
// means "published" — the releases feed of Vorsie/strixgeo-releases, or the
// git tags on the source repo — never from a local build output
// (`desktop/dist/latest.yml`), which every `npm run dist` rewrites with the
// current package version.
//
// The feed and git calls are injected, so the whole suite runs offline with no
// gh / git subprocess.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import {
  latestPublishedVersion,
  readGitTagVersions,
  readReleaseFeedVersion,
  releaseVersionError,
} from './publishedVersion.mjs'

const here = dirname(fileURLToPath(import.meta.url))

describe('release guard published-version resolution', () => {
  it('the published version comes from the releases feed when it is reachable', () => {
    const result = latestPublishedVersion({
      readFeed: () => ({ reachable: true, version: '0.2.0', detail: 'releases feed' }),
      readTags: () => ['0.1.0', '0.1.0-beta.1'],
    })
    expect(result.version).toBe('0.2.0')
    expect(result.source).toBe('releases feed')

    // Feed reachable but no release published yet → fall back to the git tags.
    const fromTags = latestPublishedVersion({
      readFeed: () => ({ reachable: true, version: null, detail: 'releases feed' }),
      readTags: () => ['0.1.0-beta.1'],
    })
    expect(fromTags.version).toBe('0.1.0-beta.1')
    expect(fromTags.source).toBe('git tags')
  })

  it('with no feed and no tag any version is allowed', () => {
    const published = latestPublishedVersion({
      readFeed: () => ({ reachable: false, version: null, detail: 'gh not found' }),
      readTags: () => [],
    })
    expect(published.version).toBeNull()
    expect(published.source).toBe('none')
    expect(published.feedReachable).toBe(false)

    // Nothing published → any package version may be released.
    expect(releaseVersionError({ version: '0.1.0', published: published.version })).toBeNull()
    expect(releaseVersionError({ version: '0.0.1', published: null })).toBeNull()
  })

  it('an equal or lower version than the published one is refused', () => {
    expect(releaseVersionError({ version: '0.1.0', published: '0.1.0' })).toMatch(/not newer/)
    expect(releaseVersionError({ version: '0.0.9', published: '0.1.0' })).toBeTruthy()
    // A prerelease ranks below its own stable release, so beta.1 is refused
    // once 0.1.0 stable is published; a strictly greater version is allowed.
    expect(releaseVersionError({ version: '0.1.0-beta.1', published: '0.1.0' })).toBeTruthy()
    expect(releaseVersionError({ version: '0.1.1', published: '0.1.0' })).toBeNull()
    // Stable outranks any prerelease of the same release, so it is allowed.
    expect(releaseVersionError({ version: '0.1.0', published: '0.1.0-beta.1' })).toBeNull()
  })

  it('a local dist/latest.yml at the same version does not block the release', () => {
    // Reproduces #9: local test builds leave dist/latest.yml at the current
    // version while the releases repo is still empty. The resolver draws only
    // from the feed and git tags, so an empty feed + no tag = nothing
    // published, and the same package version is releasable regardless of any
    // build output on disk.
    const published = latestPublishedVersion({
      readFeed: () => ({ reachable: false, version: null, detail: 'offline' }),
      readTags: () => [],
    })
    expect(published.version).toBeNull()
    expect(releaseVersionError({ version: '0.1.0', published: published.version })).toBeNull()

    // Regression pin: neither the guard nor the resolver may read the build
    // output feed manifest again. A quoted 'latest.yml' path literal is how the
    // old code reached it (`resolve(desktopDir, 'dist', 'latest.yml')`); the
    // filename may still be named in an explanatory comment.
    const guardSrc = readFileSync(resolve(here, 'require-clean-release.mjs'), 'utf8')
    const moduleSrc = readFileSync(resolve(here, 'publishedVersion.mjs'), 'utf8')
    expect(guardSrc).not.toMatch(/['"]latest\.yml['"]/)
    expect(moduleSrc).not.toMatch(/['"]latest\.yml['"]/)
  })

  it('the releases feed is unreachable when gh fails and reports the max published release when it succeeds', () => {
    const unreachable = readReleaseFeedVersion({
      run: () => {
        throw new Error('gh: To get started with GitHub CLI, please run: gh auth login')
      },
    })
    expect(unreachable.reachable).toBe(false)
    expect(unreachable.version).toBeNull()
    expect(unreachable.detail).toMatch(/auth/i)

    // Drafts are not published (excluded); prereleases count. Max non-draft wins.
    const reachable = readReleaseFeedVersion({
      run: () =>
        JSON.stringify([
          { tag_name: 'v0.1.0', draft: false, prerelease: false },
          { tag_name: 'v0.2.0', draft: true, prerelease: false },
          { tag_name: 'v0.1.1', draft: false, prerelease: true },
        ]),
    })
    expect(reachable.reachable).toBe(true)
    expect(reachable.version).toBe('0.1.1')
  })

  it('git tags are read as v<semver>, non-semver tags ignored', () => {
    const tags = readGitTagVersions({
      run: () => 'v0.1.0\nv0.1.0-beta.1\nnot-a-tag\nv1.2.3\n',
    })
    expect(tags).toContain('0.1.0')
    expect(tags).toContain('0.1.0-beta.1')
    expect(tags).toContain('1.2.3')
    expect(tags).not.toContain('not-a-tag')
  })
})
