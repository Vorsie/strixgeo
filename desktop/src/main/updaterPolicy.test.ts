// Behavioural pins for the pure updater policy (prototype, debt #6).
//
// The rule the brief fixes: the auto-updater must be gated on ``app.isPackaged``
// so the dev workflow is untouched, and a manual "Check for updates" is the only
// path that runs in development (and even then, only reports "disabled"). These
// pins encode the gate and the safe shaping of an update-info blob, both pure and
// Electron-free (vitest.config.ts includes src/main/**).

import { describe, expect, it } from 'vitest'

import { shouldAutoCheckOnLaunch, summariseUpdateInfo } from './updaterPolicy'

describe('updaterPolicy', () => {
  it('auto-checks on launch ONLY when the app is packaged', () => {
    expect(shouldAutoCheckOnLaunch(true)).toBe(true)
    expect(shouldAutoCheckOnLaunch(false)).toBe(false)
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
