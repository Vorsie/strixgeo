/**
 * Build provenance: a build carries the git SHA and build time it was cut
 * with, and a dev run (nothing injected) carries none.
 *
 * ``import.meta.env`` is stubbed per case, standing in for the values
 * electron-vite bakes into a packaged bundle.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { compiledBuildProvenance } from './buildStamp'

describe('compiledBuildProvenance', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('BP1: a build with the SHA and the time injected reports both', () => {
    vi.stubEnv('MAIN_VITE_STRIX_BUILD_SHA', '60e282c4aaaabbbbccccddddeeeeffff00001111')
    vi.stubEnv('MAIN_VITE_STRIX_BUILD_TIME', '2026-10-17T00:00:00.000Z')

    expect(compiledBuildProvenance()).toEqual({
      sha: '60e282c4aaaabbbbccccddddeeeeffff00001111',
      builtAt: '2026-10-17T00:00:00.000Z',
    })
  })

  it('BP2: a dev run with nothing injected carries no provenance', () => {
    vi.stubEnv('MAIN_VITE_STRIX_BUILD_SHA', undefined)
    vi.stubEnv('MAIN_VITE_STRIX_BUILD_TIME', undefined)

    expect(compiledBuildProvenance()).toBeUndefined()
  })
})
