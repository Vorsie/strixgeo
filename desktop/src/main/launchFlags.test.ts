// audit C3(b): STRIX_E2E must NOT take effect in a packaged exe. The harness
// only ever runs an unpackaged build, so the flag is honoured there and ignored
// once packaged.
//
// Pure and Electron-free (vitest.config.ts includes src/main/**).

import { describe, expect, it } from 'vitest'

import { e2eLaunchFlag } from './launchFlags'

describe('e2eLaunchFlag', () => {
  it('is true for an unpackaged build with STRIX_E2E=1 (the harness)', () => {
    expect(e2eLaunchFlag({ STRIX_E2E: '1' }, false)).toBe(true)
  })

  it('is FALSE in a packaged build even with STRIX_E2E=1', () => {
    expect(e2eLaunchFlag({ STRIX_E2E: '1' }, true)).toBe(false)
  })

  it('is false when STRIX_E2E is unset', () => {
    expect(e2eLaunchFlag({}, false)).toBe(false)
  })
})
