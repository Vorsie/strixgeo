// Pin for the prototype-only "Preview a state" control gate (senior review
// SHOULD-FIX 1). The demo preview jumps the activation store into any state so
// the owner can SEE each licensing screen; it must exist ONLY in a dev build and
// never ship in a packaged one — both the main-process IPC registration
// (prototypeIpc.ts) and the renderer row (LicensingDialog.tsx) consult this.
//
// Pure and Electron-free (vitest.config.ts includes src/main/**).

import { describe, expect, it } from 'vitest'

import { previewControlAllowed } from './prototypeFlags'

describe('previewControlAllowed', () => {
  it('allows the preview control in a dev build', () => {
    expect(previewControlAllowed(false)).toBe(true)
  })

  it('withholds the preview control in a packaged build', () => {
    expect(previewControlAllowed(true)).toBe(false)
  })
})
