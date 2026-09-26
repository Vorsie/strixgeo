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

import {
  autoInstallOnQuit,
  classifyUpdaterError,
  shouldAutoCheckOnLaunch,
  shouldReplayOnLoad,
  summariseUpdateInfo,
} from './updaterPolicy'

describe('updaterPolicy', () => {
  it('auto-checks on launch ONLY when the app is packaged', () => {
    expect(shouldAutoCheckOnLaunch(true)).toBe(true)
    expect(shouldAutoCheckOnLaunch(false)).toBe(false)
  })


  // Owner 2026-09-26: "when launching release, i had to manually click check for
  // updates, i didn't get prompted on startup". The launch check fires as soon
  // as the window exists, and the feed answers before the renderer has loaded
  // and subscribed — so the "available" event went to nobody. The service now
  // latches the last event and replays it when a document finishes loading;
  // only the phases that ask something of the engineer are worth replaying.
  it('RP1 — an update on offer or downloaded is replayed to a renderer that loads later', () => {
    expect(shouldReplayOnLoad({ phase: 'available' })).toBe(true)
    expect(shouldReplayOnLoad({ phase: 'downloaded' })).toBe(true)
  })

  it('RP2 — transient or calm phases are not replayed: a reload must not re-toast them', () => {
    for (const phase of ['idle', 'checking', 'not-available', 'no-release', 'downloading', 'disabled'] as const) {
      expect(shouldReplayOnLoad({ phase }), phase).toBe(false)
    }
  })

  it('RP3 — a failure is replayed too: the engineer must learn the check could not run', () => {
    expect(shouldReplayOnLoad({ phase: 'error' })).toBe(true)
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

// The rule the owner's finding (g) fixes: "check for updates failed" when the
// releases feed simply has NO release published yet (the closed beta's normal
// state) is not a failure — it must read as a calm "no update available yet".
// A real network / auth failure keeps failure wording but names the cause. The
// classification is pure and Electron-free so vitest pins it directly. The
// exact electron-updater GitHubProvider error codes/messages are used
// (verified against node_modules/electron-updater/out/providers/GitHubProvider.js).
describe('classifyUpdaterError', () => {
  it('a feed with no release yet is not a failure', () => {
    // The closed beta ships with a draft-only releases repo: the provider sees
    // no published release and throws ERR_UPDATER_NO_PUBLISHED_VERSIONS.
    expect(
      classifyUpdaterError({
        message: 'No published versions on GitHub',
        code: 'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
      }).kind,
    ).toBe('no-release')
  })

  it('a 404 on latest.yml is not a failure — the release has no update file yet', () => {
    // A release exists but its latest.yml asset is missing (owner named this
    // case): ERR_UPDATER_CHANNEL_FILE_NOT_FOUND, "Cannot find latest.yml …: 404".
    expect(
      classifyUpdaterError({
        message:
          'Cannot find latest.yml in the latest release artifacts (https://…/latest.yml): HttpError: 404',
        code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
      }).kind,
    ).toBe('no-release')
  })

  it('an unreachable production release is not a failure', () => {
    // ERR_UPDATER_LATEST_VERSION_NOT_FOUND — "please ensure a production release exists".
    expect(
      classifyUpdaterError({
        message:
          'Unable to find latest version on GitHub (https://…), please ensure a production release exists',
        code: 'ERR_UPDATER_LATEST_VERSION_NOT_FOUND',
      }).kind,
    ).toBe('no-release')
  })

  it('the no-release verdict holds even when the error carries no code', () => {
    // Some paths hand only a message. The message must still classify.
    expect(classifyUpdaterError({ message: 'No published versions on GitHub' }).kind).toBe(
      'no-release',
    )
  })

  it('offline is a failure that says offline', () => {
    const result = classifyUpdaterError({
      message: 'net::ERR_INTERNET_DISCONNECTED',
    })
    expect(result.kind).toBe('error')
    expect(result.reason).toBe('offline')
  })

  it('a DNS failure with no route to the host is an offline failure', () => {
    const result = classifyUpdaterError({
      message: 'getaddrinfo ENOTFOUND github.com',
    })
    expect(result.kind).toBe('error')
    expect(result.reason).toBe('offline')
  })

  it('a 403 / proxy wall is a blocked failure', () => {
    const result = classifyUpdaterError({ message: 'HttpError: 403 Forbidden' })
    expect(result.kind).toBe('error')
    expect(result.reason).toBe('blocked')
  })

  it('anything else is an unexpected failure, still an error', () => {
    const result = classifyUpdaterError({
      message: 'Cannot parse releases feed: SyntaxError',
      code: 'ERR_UPDATER_INVALID_RELEASE_FEED',
    })
    expect(result.kind).toBe('error')
    expect(result.reason).toBe('unexpected')
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
