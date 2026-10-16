// Unit tests for the packaging check that the built main bundle carries its
// git SHA. The rule: a packaged build must carry its git SHA
// (compiledBuildProvenance reads it); a bundle without it fails the package,
// a missing bundle fails it too, and a build with no reachable git can only
// warn (that is not an injection failure). Open source 2026-10-17: there is no
// expiry stamp any more, so nothing here asks for one.
//
// Pure: the bundle text and the resolved SHA are arguments, so no build and no
// git subprocess run.
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { bundleShaVerdict } from './require-build-sha.mjs'
import { UNKNOWN_SHA } from './buildProvenance.mjs'

const SHA = '60e282c4aaaabbbbccccddddeeeeffff00001111'

describe('bundleShaVerdict', () => {
  it('RS1: a bundle that carries the build SHA passes', () => {
    const verdict = bundleShaVerdict({ bundleText: `const sha = "${SHA}"`, sha: SHA })
    expect(verdict.kind).toBe('ok')
  })

  it('RS2: a bundle without the build SHA fails the package', () => {
    const verdict = bundleShaVerdict({ bundleText: 'const sha = void 0', sha: SHA })
    expect(verdict.kind).toBe('fail')
    expect(verdict.message).toContain(SHA)
  })

  it('RS3: a missing bundle fails the package', () => {
    const verdict = bundleShaVerdict({ bundleText: null, sha: SHA })
    expect(verdict.kind).toBe('fail')
  })

  it('RS4: no reachable git only warns, it does not fail', () => {
    const verdict = bundleShaVerdict({ bundleText: 'anything', sha: UNKNOWN_SHA })
    expect(verdict.kind).toBe('warn')
  })

  it('RS5: the package script runs the SHA check and asks for no expiry stamp', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const pkg = JSON.parse(readFileSync(resolve(here, '..', 'package.json'), 'utf8'))
    const script: string = pkg.scripts.package
    expect(script).toContain('node scripts/require-build-sha.mjs')
    expect(script).not.toMatch(/\bpre\b/)
    expect(script).not.toContain('BETA')
    expect(script).not.toContain('require-beta-stamp')
  })
})
