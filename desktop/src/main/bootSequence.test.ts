// Pins the startup order of index.ts by reading its source (index.ts imports
// electron at module scope, so vitest cannot run it). Open source 2026-10-17:
// there is no licence gate and no expiry check; the engine starts
// unconditionally and the window follows.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const MAIN_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8').replace(/\r\n/g, '\n')

function offsetOf(needle: string): number {
  const at = MAIN_SOURCE.indexOf(needle)
  expect(at, `expected index.ts to contain ${needle}`).toBeGreaterThanOrEqual(0)
  return at
}

describe('boot sequence (open source: no gate)', () => {
  it('BS1: the source carries no licence gate and no beta expiry', () => {
    expect(MAIN_SOURCE).not.toContain('enforceBetaExpiry')
    expect(MAIN_SOURCE).not.toContain('activationBlocksLaunch')
    expect(MAIN_SOURCE).not.toContain('ActivationService')
    expect(MAIN_SOURCE).not.toContain('launchBlocked')
  })
  it('BS2: a dev start spawns the engine before the window', () => {
    // Target the LAUNCH spawn specifically: the mid-session respawn path
    // (H3(a), handleReadyBackendExit) also calls startApi() and is defined
    // earlier in the file, so a bare 'startApi()' newline would match that
    // instead. The launch call is the dev branch's startApi(), closed by the
    // brace of the packaged/dev if-else.
    expect(offsetOf('startApi()\n    }')).toBeLessThan(offsetOf('createWindow()\n'))
  })
  it('BS3: a packaged start boots the embedded database, then the window', () => {
    const db = offsetOf('if (!(await bootEmbeddedDatabase(')
    const window = offsetOf('createWindow()\n')
    expect(db).toBeLessThan(window)
  })
  it('BS4: the diagnostics store is configured before the window', () => {
    expect(offsetOf('configureDiagnosticsStore({')).toBeLessThan(offsetOf('createWindow()\n'))
  })
  it('BS5: main-process crashes are captured, not only written as text', () => {
    const crashWriter = MAIN_SOURCE.slice(offsetOf('function writeMainCrashLine'))
    expect(crashWriter.slice(0, 1200)).toContain('captureDiagnostic(')
  })
  it('BS6: the renderer error channel captures every path that arrives on it', () => {
    const handler = MAIN_SOURCE.slice(offsetOf("'app:log-renderer-error'"))
    expect(handler.slice(0, 900)).toContain("kind: 'renderer-error'")
  })
})
