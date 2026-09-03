// H3(a) — while the main process respawns a backend that died mid-session, the
// engineer sees a hopeful "reconnecting" banner, which clears itself when the
// backend is serving again (or the failed modal takes over).

import { cleanup, render, screen, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import BackendRestartingBanner from './BackendRestartingBanner'

const TEST_ID = 'backend-restarting-banner'

const originalElectron = window.electron

/** Stub the preload channels and hand back triggers to fire each event. */
function stubElectron(options: { withChannels?: boolean } = {}): {
  fireRestarting: () => void
  fireReady: () => void
  fireFailed: () => void
} {
  const listeners: Record<string, (() => void) | undefined> = {}
  const make =
    (name: string) =>
    (cb: () => void): (() => void) => {
      listeners[name] = cb
      return () => {
        listeners[name] = undefined
      }
    }
  const base = options.withChannels === false ? {} : {
    onAppBackendRestarting: make('restarting'),
    onAppBackendReady: make('ready'),
    onAppBackendFailed: make('failed'),
  }
  // Only the three channels matter to this component.
  ;(window as unknown as { electron: unknown }).electron = base
  return {
    fireRestarting: () => act(() => listeners['restarting']?.()),
    fireReady: () => act(() => listeners['ready']?.()),
    fireFailed: () => act(() => listeners['failed']?.()),
  }
}

afterEach(() => {
  cleanup()
  ;(window as unknown as { electron: unknown }).electron = originalElectron
})

describe('BackendRestartingBanner', () => {
  it('BR1 renders nothing before any restart', () => {
    stubElectron()
    render(<BackendRestartingBanner />)
    expect(screen.queryByTestId(TEST_ID)).toBeNull()
  })

  it('BR2 appears when the backend restart begins, saying it is reconnecting', () => {
    const events = stubElectron()
    render(<BackendRestartingBanner />)

    events.fireRestarting()

    const banner = screen.getByTestId(TEST_ID)
    expect(banner.textContent?.toLowerCase()).toContain('reconnecting')
  })

  it('BR3 is a polite status (not an alarming alert) — the app is recovering', () => {
    const events = stubElectron()
    render(<BackendRestartingBanner />)
    events.fireRestarting()
    expect(screen.getByTestId(TEST_ID).getAttribute('role')).toBe('status')
  })

  it('BR4 clears itself when the backend is ready again', () => {
    const events = stubElectron()
    render(<BackendRestartingBanner />)
    events.fireRestarting()
    expect(screen.queryByTestId(TEST_ID)).not.toBeNull()

    events.fireReady()

    expect(screen.queryByTestId(TEST_ID)).toBeNull()
  })

  it('BR5 clears itself if the respawn gives up (the failed modal takes over)', () => {
    const events = stubElectron()
    render(<BackendRestartingBanner />)
    events.fireRestarting()

    events.fireFailed()

    expect(screen.queryByTestId(TEST_ID)).toBeNull()
  })

  it('BR6 renders nothing and does not throw when the preload lacks the channels', () => {
    stubElectron({ withChannels: false })
    expect(() => render(<BackendRestartingBanner />)).not.toThrow()
    expect(screen.queryByTestId(TEST_ID)).toBeNull()
  })
})
