// Pins the one BrowserWindow option whose absence fails invisibly.
//
// ``index.ts`` imports ``electron`` at module scope, so vitest cannot construct the
// window and read its options back. The test reads the source instead. That is
// coarse, and it is deliberate: this flag has no observable effect until the window
// is hidden, and the only thing that hides it is the close flow, so nothing short of
// a multi-spec e2e run notices when it goes missing.
//
// WHY the flag matters. Answering the save-or-discard prompt hides the window and
// lets the remaining work — a replace-restore of the whole bundle — finish in the
// background, so the engineer gets the desktop back straight away. Chromium
// backgrounds a hidden window by default and throttles its timers, which starves
// exactly that work: the app never reached its own quit handshake and the process
// lingered with no window to show for it.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const MAIN_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8')

describe('main window options', () => {
  it('keeps the renderer unthrottled so the close flow can finish while hidden', () => {
    expect(MAIN_SOURCE).toMatch(/backgroundThrottling:\s*false/)
  })
})
