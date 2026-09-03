// Pin for the prototype-only "Preview a state" control gate (senior review
// SHOULD-FIX 1). The demo preview jumps the activation store into any state so
// the owner can SEE each licensing screen; it must exist ONLY in a dev build and
// never ship in a packaged one — both the main-process IPC registration
// (prototypeIpc.ts) and the renderer row (LicensingDialog.tsx) consult this.
//
// Pure and Electron-free (vitest.config.ts includes src/main/**).

import { describe, expect, it } from 'vitest'

import { e2eLaunchFlag, previewControlAllowed } from './prototypeFlags'

describe('previewControlAllowed', () => {
  it('allows the preview control in a dev build', () => {
    expect(previewControlAllowed(false)).toBe(true)
  })

  it('withholds the preview control in a packaged build', () => {
    expect(previewControlAllowed(true)).toBe(false)
  })
})

// audit C3(b): STRIX_E2E must NOT open the gate in a packaged exe. The harness
// only ever runs an unpackaged build, so the flag is honoured there and ignored
// once packaged — a customer setting STRIX_E2E=1 cannot walk past the licence gate.
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
