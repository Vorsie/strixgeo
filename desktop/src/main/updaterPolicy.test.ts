// Behavioural pins for the pure updater policy (prototype, debt #6).
//
// The rule the brief fixes: the auto-updater must be gated on ``app.isPackaged``
// so the dev workflow is untouched, and a manual "Check for updates" is the only
// path that runs in development (and even then, only reports "disabled"). These
// pins encode the gate and the safe shaping of an update-info blob, both pure and
// Electron-free (vitest.config.ts includes src/main/**).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { autoInstallOnQuit, shouldAutoCheckOnLaunch, summariseUpdateInfo } from './updaterPolicy'

describe('updaterPolicy', () => {
  it('auto-checks on launch ONLY when the app is packaged', () => {
    expect(shouldAutoCheckOnLaunch(true)).toBe(true)
    expect(shouldAutoCheckOnLaunch(false)).toBe(false)
  })

  it('H6 — never auto-installs an update on quit for an UNSIGNED build', () => {
    // An unsigned installer that silently swaps itself in on quit is
    // untrustworthy — the only trust is TLS to GitHub plus one account. Auto
    // install-on-quit is allowed only once the app is code-signed.
    expect(autoInstallOnQuit(false)).toBe(false)
    expect(autoInstallOnQuit(true)).toBe(true)
  })

  it('summarises an electron-updater UpdateInfo into a renderer-safe notice', () => {
    const notice = summariseUpdateInfo({
      version: '1.4.0',
      releaseName: 'Autumn build',
      releaseNotes: 'Fixes and polish.',
    })
    expect(notice.version).toBe('1.4.0')
    expect(notice.releaseName).toBe('Autumn build')
    expect(notice.releaseNotes).toBe('Fixes and polish.')
  })

  it('tolerates a sparse UpdateInfo (only version is guaranteed)', () => {
    const notice = summariseUpdateInfo({ version: '2.0.0' })
    expect(notice.version).toBe('2.0.0')
    expect(notice.releaseName).toBeNull()
    expect(notice.releaseNotes).toBeNull()
  })

  it('drops release notes that arrive as electron-updater block arrays', () => {
    // electron-updater can hand releaseNotes as an array of {version, note}.
    // The prototype notice keeps a plain string or null — never the raw array.
    const notice = summariseUpdateInfo({
      version: '2.1.0',
      releaseNotes: [{ version: '2.1.0', note: 'a' }],
    })
    expect(notice.version).toBe('2.1.0')
    expect(notice.releaseNotes).toBeNull()
  })
})

describe('updaterService wires autoInstallOnAppQuit through the signing gate', () => {
  // Source-text pin (updaterService imports electron, so it cannot be imported
  // here). Guards against a regression that hardcodes the flag true again.
  const SERVICE_SOURCE = readFileSync(join(__dirname, 'updaterService.ts'), 'utf-8').replace(
    /\r\n/g,
    '\n',
  )

  it('H6-wiring — the quit-time install flag is not hardcoded true', () => {
    expect(SERVICE_SOURCE).not.toMatch(/autoInstallOnAppQuit\s*=\s*true/)
    expect(SERVICE_SOURCE).toContain('autoInstallOnAppQuit = autoInstallOnQuit(APP_IS_SIGNED)')
    // The beta ships unsigned, so the gate is closed today.
    expect(SERVICE_SOURCE).toMatch(/const APP_IS_SIGNED = false/)
  })

  it('H6-wiring — the explicit "Install now" path is still exposed', () => {
    // quitAndInstall stays as the user-driven install, wired to
    // updater:quit-and-install in prototypeIpc.
    expect(SERVICE_SOURCE).toContain('export function quitAndInstall()')
  })
})
