// Pins WHERE the beta gate sits in the startup sequence.
//
// ``index.ts`` imports ``electron`` at module scope, so vitest cannot run the
// startup path and observe the order. The test reads the source instead —
// coarse, and deliberate, for the same reason ``windowOptions.test.ts`` does
// it: the property being protected is invisible until the day it matters.
//
// WHY the order is the whole feature. "Waterproof" (owner ballot 2026-08-26)
// means an expired build never gets as far as a window: no backend spawned, no
// renderer running, nothing for a user to interact with while the check is
// pending. A refactor that moved the gate below ``createWindow()`` would leave
// every unit test in ``betaExpiry.test.ts`` green while the app happily opened
// an expired beta, because those tests pin the DECISION and this pins the
// PLACE the decision is acted on.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

// Line endings are normalised because the repo checks out CRLF on Windows and
// LF on CI — a needle containing "\n" would otherwise pass on one and fail on
// the other for reasons that have nothing to do with the property under test.
const MAIN_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8').replace(/\r\n/g, '\n')

/** Character offset of a needle, failing the test when it is absent. */
function offsetOf(needle: string): number {
  const at = MAIN_SOURCE.indexOf(needle)
  expect(at, `expected index.ts to contain ${needle}`).toBeGreaterThanOrEqual(0)
  return at
}

describe('the beta gate runs before anything the user can touch', () => {
  it('BG1 — the expiry check precedes the window and the backend', () => {
    const gate = offsetOf('if (enforceBetaExpiry()) return')
    const window = offsetOf('createWindow()\n')
    // Target the LAUNCH spawn specifically: the mid-session respawn path
    // (H3(a), handleReadyBackendExit) also calls startApi() and is defined
    // earlier in the file, so a bare 'startApi()' newline would match that
    // instead. The launch call is the one immediately followed by createWindow().
    const backend = offsetOf('startApi()\n    createWindow()')

    expect(gate).toBeLessThan(window)
    expect(gate).toBeLessThan(backend)
  })

  it('BG2 — a blocked launch returns instead of falling through', () => {
    // ``return`` and not merely ``app.quit()``: quitting is asynchronous, and
    // the statements after it would otherwise still run and open a window.
    expect(MAIN_SOURCE).toMatch(/if \(enforceBetaExpiry\(\)\) return/)
  })

  it('BG3 — a long-running session keeps re-checking', () => {
    expect(MAIN_SOURCE).toContain('startBetaExpiryWatch()')
  })

  it('BG4 — the renderer is told the status but never asked for the decision', () => {
    // The IPC surface is read-only: a status getter and no setter, so nothing
    // the renderer says can extend a beta.
    expect(MAIN_SOURCE).toContain("ipcMain.handle('app:beta-status'")
    expect(MAIN_SOURCE).not.toMatch(/ipcMain\.handle\('app:beta-(extend|override|set)/)
  })
})

describe('crashes reach the local diagnostics log', () => {
  it('BG5 — the diagnostics store is configured before the gate that may quit', () => {
    const store = offsetOf('configureDiagnosticsStore({')
    const gate = offsetOf('if (enforceBetaExpiry()) return')

    expect(store).toBeLessThan(gate)
  })

  it('BG6 — main-process crashes are captured, not only written as text', () => {
    const crashWriter = MAIN_SOURCE.slice(offsetOf('function writeMainCrashLine'))

    expect(crashWriter.slice(0, 1200)).toContain('captureDiagnostic(')
  })

  it('BG7 — the renderer error channel captures every path that arrives on it', () => {
    const handler = MAIN_SOURCE.slice(offsetOf("'app:log-renderer-error'"))

    expect(handler.slice(0, 900)).toContain("kind: 'renderer-error'")
  })
})
