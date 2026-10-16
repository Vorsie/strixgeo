// Pins for the packaged app's OWN user profile (owner ruling 2026-08-27:
// "yes clean profile, do it").
//
// Electron derives userData from package.json's `name` — `ground-model-desktop`,
// the SAME folder the dev app uses — because `build.productName` does not move
// `app.getPath('userData')`. A packaged build must therefore claim
// %APPDATA%\StrixGeo itself, and must do it before ANYTHING reads userData:
// the single-instance lock, the recovery store, the
// diagnostics store and the embedded stack all resolve paths off it.
//
// PP1 — a packaged app moves userData (and sessionData) to <appData>\StrixGeo.
// PP2 — a dev app is left completely alone; the ruling changes nothing for dev.
// PP3 — WIRING (source-order, betaGateWiring.test.ts style): index.ts applies
//       the profile before the single-instance lock and before every
//       userData-reading configure call. The unit pins the DECISION; this pins
//       the PLACE — a refactor that hoisted a store above the call would leave
//       PP1 green while the packaged app silently wrote to the dev profile.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { PACKAGED_PROFILE_DIR_NAME, applyPackagedProfile } from './packagedProfile'

function fakeApp(isPackaged: boolean, hasUserDataDirSwitch = false) {
  return {
    isPackaged,
    getPath: vi.fn((_name: 'appData') => 'C:\\Users\\test\\AppData\\Roaming'),
    setPath: vi.fn((_name: 'userData' | 'sessionData' | 'logs', _value: string) => undefined),
    commandLine: { hasSwitch: vi.fn((_name: string) => hasUserDataDirSwitch) },
  }
}

const LOCAL_APP_DATA = 'C:\\Users\\test\\AppData\\Local'

describe('the packaged app claims its own profile', () => {
  it('PP1 — packaged: userData and sessionData move to <appData>\\StrixGeo', () => {
    const app = fakeApp(true)

    expect(applyPackagedProfile(app)).toBe(true)

    const expected = join('C:\\Users\\test\\AppData\\Roaming', PACKAGED_PROFILE_DIR_NAME)
    expect(PACKAGED_PROFILE_DIR_NAME).toBe('StrixGeo')
    expect(app.setPath).toHaveBeenCalledWith('userData', expected)
    expect(app.setPath).toHaveBeenCalledWith('sessionData', expected)
  })

  it('PP2 — dev: nothing moves, the dev profile stays where it always was', () => {
    const app = fakeApp(false)

    expect(applyPackagedProfile(app)).toBe(false)

    expect(app.getPath).not.toHaveBeenCalled()
    expect(app.setPath).not.toHaveBeenCalled()
  })

  it('PP5 — packaged: logs move to %LOCALAPPDATA%\\StrixGeo\\logs (M1), off the Roaming share', () => {
    const app = fakeApp(true)

    expect(applyPackagedProfile(app, LOCAL_APP_DATA)).toBe(true)

    // userData stays Roaming (small stores follow the user); logs — a large,
    // machine-local, churny store — go to Local.
    const roaming = join('C:\\Users\\test\\AppData\\Roaming', PACKAGED_PROFILE_DIR_NAME)
    expect(app.setPath).toHaveBeenCalledWith('userData', roaming)
    expect(app.setPath).toHaveBeenCalledWith(
      'logs',
      join(LOCAL_APP_DATA, PACKAGED_PROFILE_DIR_NAME, 'logs'),
    )
  })

  it('PP6 — packaged but no %LOCALAPPDATA%: logs are left at their default (no crash)', () => {
    const app = fakeApp(true)

    expect(applyPackagedProfile(app, undefined)).toBe(true)

    expect(app.setPath).not.toHaveBeenCalledWith('logs', expect.anything())
  })

  it('PP4 — an explicit --user-data-dir wins over the claimed profile', () => {
    // The distribution doc tells test runs to isolate with --user-data-dir; a
    // setPath here would silently defeat that isolation and point the test at
    // the REAL future-install profile — the exact class of accident that put
    // an error dialog on the owner's desktop on 2026-08-27.
    const app = fakeApp(true, true)

    expect(applyPackagedProfile(app)).toBe(false)

    expect(app.setPath).not.toHaveBeenCalled()
  })
})

describe('the profile is applied before anything reads userData', () => {
  // Line endings normalised for the same CRLF/LF reason bootSequence.test.ts gives.
  const MAIN_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8').replace(/\r\n/g, '\n')

  function offsetOf(needle: string): number {
    const at = MAIN_SOURCE.indexOf(needle)
    expect(at, `expected index.ts to contain ${needle}`).toBeGreaterThanOrEqual(0)
    return at
  }

  it('PP3 — applyPackagedProfile precedes the lock and every store', () => {
    const profile = offsetOf('applyPackagedProfile(app')

    expect(profile).toBeLessThan(offsetOf('requestSingleInstanceLock()'))
    expect(profile).toBeLessThan(offsetOf('configureRecoveryStore('))
    expect(profile).toBeLessThan(offsetOf('configureDiagnosticsStore('))
    expect(profile).toBeLessThan(offsetOf('prepareEmbeddedStack('))
  })

  it('PP7 — logs are relocated by passing %LOCALAPPDATA% to the profile (M1)', () => {
    expect(MAIN_SOURCE).toContain('applyPackagedProfile(app, process.env.LOCALAPPDATA)')
  })

  it('PP8 — the cluster is relocated BEFORE the database boots (M1)', () => {
    const relocate = offsetOf('relocateMachineLocalStores()')
    const boot = offsetOf('bootEmbeddedDatabase(')
    // The move + configurePgdataRoot must land before Postgres starts, or the
    // cluster would boot from the wrong directory.
    expect(relocate).toBeLessThan(boot)
    expect(MAIN_SOURCE).toContain('configurePgdataRoot(localRoot)')
  })
})
