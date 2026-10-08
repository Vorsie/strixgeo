// Wiring pins for the 2026-10-08 owner finding (0.1.4 over a 0.1.5 store: the
// generic backend-failed dialog, no update prompt, nothing in the log). The
// helpers are tested on their own (backendFailureReason.test.ts,
// updaterLog.test.ts); these pins prove the Electron-bound modules, which a
// jsdom test may not import, actually use them.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** Read a main-process source file with normalised line endings. */
function source(name: string): string {
  return readFileSync(join(__dirname, name), 'utf-8').replace(/\r\n/g, '\n')
}

describe('updater + backend-failed wiring', () => {
  const MAIN = source('index.ts')
  const UPDATER = source('updaterService.ts')
  const IPC = source('prototypeIpc.ts')
  const PRELOAD = readFileSync(join(__dirname, '..', 'preload', 'index.ts'), 'utf-8')

  it('UW1 - every app:backend-failed send carries the failure payload', () => {
    // No bare send left: each one goes through the helper that adds the reason.
    expect(MAIN).not.toMatch(/send\('app:backend-failed'\)/)
    expect(MAIN).toContain("send('app:backend-failed', backendFailedPayload(")
  })

  it('UW2 - the backend output feeds the failure-reason tracker', () => {
    expect(MAIN).toContain('createBackendFailureReasonTracker()')
    // Both streams: the traceback is on stderr, a logged line may be on stdout.
    expect(MAIN).toContain("apiProcess.stdout?.on('data', (d: Buffer | string) => tracker.observe(")
    expect(MAIN).toContain("apiProcess.stderr?.on('data', (d: Buffer | string) => tracker.observe(")
  })

  it('UW3 - the updater logs to the main log', () => {
    expect(UPDATER).toContain('autoUpdater.logger = createUpdaterLogger(')
    expect(MAIN).toContain('attachUpdaterLogger(writeMainLog)')
    // The packaged app lost this line: it now goes to the main log.
    expect(UPDATER).not.toContain("console.warn(`[updater] check failed")
  })

  it('UW4 - a renderer that mounts late can pull the latched updater event', () => {
    expect(IPC).toContain("ipcMain.handle('updater:last-event'")
    expect(PRELOAD).toContain("ipcRenderer.invoke('updater:last-event')")
  })
})
