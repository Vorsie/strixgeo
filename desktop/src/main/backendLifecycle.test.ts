// H1 — the backend and the database stop only AFTER the renderer has answered
// the close prompt.
//
// The bug: ``app.on('before-quit')`` called ``stopApi()`` unconditionally.
// Electron fires ``before-quit`` BEFORE a window's ``close`` handler runs the
// save-or-discard prompt, so File → Quit / Ctrl+Q / the beta watchdog tore the
// backend + Postgres down while the renderer's Save was still to come — a Save
// against a dead API, which docs/design/autosave-recovery.md §4 forbids.
//
// The fix moves the teardown to ``will-quit`` (which fires only once the quit is
// actually proceeding — after every window closed, i.e. after the renderer
// answered) and keeps it on ``window-all-closed`` (same "windows already gone"
// point). ``before-quit`` must never stop the backend.
//
// The lifecycle registration is extracted here so the ORDER property is testable
// with a fake app + event order, without importing Electron.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { registerBackendLifecycle, type QuitLifecycleApp } from './backendLifecycle'

/** A fake ``app`` that records the handlers registered per lifecycle event. */
type FakeApp = QuitLifecycleApp & {
  fire: (event: string) => void
  registered: (event: string) => boolean
}

function fakeApp(): FakeApp {
  const handlers = new Map<string, Array<() => void>>()
  return {
    on(event: string, handler: () => void): void {
      const list = handlers.get(event) ?? []
      list.push(handler)
      handlers.set(event, list)
    },
    fire(event: string): void {
      for (const handler of handlers.get(event) ?? []) handler()
    },
    registered(event: string): boolean {
      return (handlers.get(event) ?? []).length > 0
    },
  }
}

describe('the backend stops only after the renderer has answered the close prompt', () => {
  it('BL1 — before-quit never stops the backend (the prompt has not run yet)', () => {
    const app = fakeApp()
    const stopBackend = vi.fn()
    registerBackendLifecycle(app, { stopBackend })

    app.fire('before-quit')

    expect(stopBackend).not.toHaveBeenCalled()
  })

  it('BL2 — window-all-closed stops the backend, then quits the platform', () => {
    const app = fakeApp()
    const order: string[] = []
    const stopBackend = vi.fn(() => order.push('stop'))
    const onWindowAllClosed = vi.fn(() => order.push('platform-quit'))
    registerBackendLifecycle(app, { stopBackend, onWindowAllClosed })

    app.fire('window-all-closed')

    expect(stopBackend).toHaveBeenCalledTimes(1)
    expect(onWindowAllClosed).toHaveBeenCalledTimes(1)
    // The database client is torn down BEFORE the app quits, so the shutdown
    // log stays free of "server closed the connection" error lines.
    expect(order).toEqual(['stop', 'platform-quit'])
  })

  it('BL3 — will-quit stops the backend (the definitive teardown)', () => {
    const app = fakeApp()
    const order: string[] = []
    const stopBackend = vi.fn(() => order.push('stop'))
    const onWillQuit = vi.fn(() => order.push('will-quit-extra'))
    registerBackendLifecycle(app, { stopBackend, onWillQuit })

    app.fire('will-quit')

    expect(stopBackend).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['stop', 'will-quit-extra'])
  })

  it('BL4 — a cancelled quit (before-quit only, no window closed) leaves the backend alive', () => {
    // The renderer answering "Cancel" on the save prompt aborts the quit: the
    // window never closes, so window-all-closed / will-quit never fire. The
    // backend must still be running for the next Save.
    const app = fakeApp()
    const stopBackend = vi.fn()
    registerBackendLifecycle(app, { stopBackend })

    app.fire('before-quit')

    expect(stopBackend).not.toHaveBeenCalled()
  })
})

describe('index.ts wires the teardown to the lifecycle, not to before-quit', () => {
  // Source-text pin (betaGateWiring.test.ts style): the property is invisible to
  // a runtime test because index.ts imports electron at module scope. A refactor
  // re-adding ``stopApi()`` to a ``before-quit`` handler would reopen H1 while
  // every behavioural test above stayed green.
  const MAIN_SOURCE = readFileSync(join(__dirname, 'index.ts'), 'utf-8').replace(/\r\n/g, '\n')

  it('BL5 — the lifecycle wiring is used', () => {
    expect(MAIN_SOURCE).toContain('registerBackendLifecycle(app, {')
  })

  it('BL6 — no before-quit handler stops the backend', () => {
    // Match ``app.on('before-quit', ... stopApi() ... )`` across lines. The stop
    // now lives only inside registerBackendLifecycle's window-all-closed /
    // will-quit branches.
    const beforeQuitStops = /app\.on\(\s*'before-quit'[\s\S]*?stopApi\(\)/.test(MAIN_SOURCE)
    expect(beforeQuitStops).toBe(false)
  })
})
