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
  classifyUpdaterError,
  shouldAutoCheckOnLaunch,
  shouldReplayOnLoad,
  shouldResumePendingDownload,
  summariseUpdateInfo,
} from './updaterPolicy'

describe('updaterPolicy', () => {
  // Owner ruling 2026-10-11 (option a): "Check for updates at start" is a
  // setting, default on. On = a packaged build checks once at start. Off = no
  // automatic check at all. A dev run never checks, whatever the setting says.
  it('CS1 - a packaged build with the setting ON checks at start', () => {
    expect(shouldAutoCheckOnLaunch(true, true)).toBe(true)
  })

  it('CS2 - a packaged build with the setting OFF does not check at start', () => {
    expect(shouldAutoCheckOnLaunch(true, false)).toBe(false)
  })

  it('CS3 - a dev run never checks at start, setting on or off', () => {
    expect(shouldAutoCheckOnLaunch(false, true)).toBe(false)
    expect(shouldAutoCheckOnLaunch(false, false)).toBe(false)
  })

  // Owner ruling 2026-10-11: a downloaded update installs at the NEXT START,
  // never on quit. electron-updater 6.8.9 cannot run the installer at launch
  // by itself; what it can do is serve the same version from its pending cache
  // without a new download. So at the next start the card must offer
  // "Install and restart" for the update already on disk.
  it('NS1 - the version offered at start is the one already downloaded: offer the install, no new download', () => {
    expect(
      shouldResumePendingDownload({ version: '0.1.6', downloadedFile: 'C:/c/pending/s.exe' }, '0.1.6', true),
    ).toBe(true)
  })

  it('NS2 - a NEWER version is on offer: ask again, the old download is not it', () => {
    expect(
      shouldResumePendingDownload({ version: '0.1.6', downloadedFile: 'C:/c/pending/s.exe' }, '0.1.7', true),
    ).toBe(false)
  })

  it('NS3 - the downloaded file is gone: ask again rather than download silently', () => {
    expect(
      shouldResumePendingDownload({ version: '0.1.6', downloadedFile: 'C:/c/pending/s.exe' }, '0.1.6', false),
    ).toBe(false)
  })

  it('NS4 - nothing was downloaded before: the normal offer', () => {
    expect(shouldResumePendingDownload(null, '0.1.6', false)).toBe(false)
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

describe('updaterService: an update installs at the next start, never on quit', () => {
  // Source-text pin (updaterService imports electron, so it cannot be imported
  // here). Owner ruling 2026-10-11: no quit-time install, signed or unsigned.
  const SERVICE_SOURCE = readFileSync(join(__dirname, 'updaterService.ts'), 'utf-8').replace(
    /\r\n/g,
    '\n',
  )
  const MAIN_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8').replace(/\r\n/g, '\n')
  const IPC_SOURCE = readFileSync(join(__dirname, 'updaterIpc.ts'), 'utf-8').replace(/\r\n/g, '\n')

  it('IQ1 - a downloaded update never installs when the app quits', () => {
    expect(SERVICE_SOURCE).toContain('autoUpdater.autoInstallOnAppQuit = false')
    expect(SERVICE_SOURCE).not.toMatch(/autoInstallOnAppQuit\s*=(?!\s*false\b)/)
    // No signing switch can turn it back on.
    expect(SERVICE_SOURCE).not.toContain('APP_IS_SIGNED')
  })

  it('IQ2 - the explicit "Install and restart" path is still exposed', () => {
    // quitAndInstall stays as the user-driven install, wired to
    // updater:quit-and-install in updaterIpc.
    expect(SERVICE_SOURCE).toContain('export function quitAndInstall()')
    expect(IPC_SOURCE).toContain("ipcMain.handle('updater:quit-and-install'")
  })

  it('IQ3 - the check runs only at start: no timer anywhere starts a check', () => {
    // The only callers of checkForUpdates are the start check and the manual
    // Help > Check for updates handler.
    expect(SERVICE_SOURCE).not.toMatch(/setInterval|setTimeout/)
    const serviceCalls = SERVICE_SOURCE.match(/\bcheckForUpdates\((true|false)\)/g) ?? []
    expect(serviceCalls).toEqual(['checkForUpdates(false)'])
    expect(IPC_SOURCE.match(/\bcheckForUpdates\((true|false)\)/g)).toEqual(['checkForUpdates(true)'])
    // index.ts calls the start check exactly once, never inside a timer.
    expect(MAIN_SOURCE.match(/checkForUpdatesOnLaunch\(/g)).toHaveLength(1)
    expect(MAIN_SOURCE).not.toMatch(/(setInterval|setTimeout)\([^)]*checkForUpdates/)
    expect(MAIN_SOURCE).not.toMatch(/autoUpdater\.checkForUpdates/)
  })

  it('IQ4 - the start check reads the "Check for updates at start" setting', () => {
    expect(SERVICE_SOURCE).toContain('shouldAutoCheckOnLaunch(app.isPackaged, readCheckAtStart())')
  })
})
