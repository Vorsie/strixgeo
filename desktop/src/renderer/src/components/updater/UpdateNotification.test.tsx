// Owner finding (g), installer #37: "check for updates failed". The releases
// feed has no published release yet (the closed beta's normal state), so a
// packaged check reaches the renderer as an updater event that must read as a
// CALM "no update available yet", never as a failure. A real failure keeps the
// failure wording but names its cause (offline / blocked / unexpected).
//
// The component subscribes to window.electron.onUpdaterEvent; the test captures
// that callback and pushes each phase to assert what the card shows.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'

import UpdateNotification, { __resetUpdateNotificationDismissalForTests } from './UpdateNotification'
import type { UpdaterEventDto } from '../../utils/launchPrototypeTypes'

/** Install a bridge whose onUpdaterEvent hands the test the push callback. */
function installUpdaterBridge(): (event: UpdaterEventDto) => void {
  let captured: ((event: UpdaterEventDto) => void) | null = null
  ;(window as unknown as { electron: unknown }).electron = {
    onUpdaterEvent: vi.fn((cb: (event: UpdaterEventDto) => void) => {
      captured = cb
      return () => {}
    }),
    downloadUpdate: vi.fn(),
    quitAndInstallUpdate: vi.fn(),
  }
  return (event: UpdaterEventDto) => {
    if (captured === null) throw new Error('onUpdaterEvent was never subscribed')
    act(() => captured?.(event))
  }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { electron?: unknown }).electron
})

describe('UpdateNotification — finding g', () => {
  it('a no-release phase reads as "no update available yet", not a failure', () => {
    const push = installUpdaterBridge()
    render(<UpdateNotification />)
    push({ phase: 'no-release' })
    // The calm line is shown; the failure line is not.
    expect(screen.getByText('No update available yet.')).toBeTruthy()
    expect(screen.queryByText('Update check failed.')).toBeNull()
  })

  it('an offline error names the cause', () => {
    const push = installUpdaterBridge()
    render(<UpdateNotification />)
    push({ phase: 'error', errorReason: 'offline' })
    expect(screen.getByText('Update check failed: you appear to be offline.')).toBeTruthy()
  })

  it('a blocked error names the proxy / firewall cause', () => {
    const push = installUpdaterBridge()
    render(<UpdateNotification />)
    push({ phase: 'error', errorReason: 'blocked' })
    expect(
      screen.getByText('Update check failed: the connection was blocked (proxy or firewall).'),
    ).toBeTruthy()
  })

  it('an error with no named reason falls back to the generic failure line', () => {
    const push = installUpdaterBridge()
    render(<UpdateNotification />)
    push({ phase: 'error' })
    expect(screen.getByText('Update check failed.')).toBeTruthy()
  })
})

// Owner finding 2026-10-08: an update that arrived BEFORE this component mounted
// (the launch check answers while the renderer is still on the loading screen,
// or App switches render branches and remounts the card) was never shown. The
// card pulls the latched event on mount, and it renders above every dialog,
// including the fatal backend-failed one, because there the update IS the cure.
describe('UpdateNotification — a latched update reaches a late mount', () => {
  const AVAILABLE: UpdaterEventDto = {
    phase: 'available',
    notice: { version: '0.1.5', releaseName: null, releaseNotes: null },
  }

  /** A bridge with a pull answer and no push ever arriving. */
  function installPullBridge(latched: UpdaterEventDto | null): void {
    ;(window as unknown as { electron: unknown }).electron = {
      onUpdaterEvent: vi.fn(() => () => {}),
      getLastUpdaterEvent: vi.fn().mockResolvedValue(latched),
      downloadUpdate: vi.fn(),
      quitAndInstallUpdate: vi.fn(),
    }
  }

  afterEach(() => {
    __resetUpdateNotificationDismissalForTests()
  })

  it('UN1 - an update latched before mount is shown on mount', async () => {
    installPullBridge(AVAILABLE)
    render(<UpdateNotification />)
    expect(await screen.findByText('Version 0.1.5 is ready to download.')).toBeTruthy()
  })

  it('UN2 - nothing latched: nothing shown', async () => {
    installPullBridge(null)
    render(<UpdateNotification />)
    await act(async () => {})
    expect(screen.queryByTestId('update-notification')).toBeNull()
  })

  it('UN3 - "Later" holds across a remount: the pulled copy of the same update is not re-shown', async () => {
    installPullBridge(AVAILABLE)
    const first = render(<UpdateNotification />)
    fireEvent.click(await screen.findByText('Later'))
    first.unmount()
    render(<UpdateNotification />)
    await act(async () => {})
    expect(screen.queryByTestId('update-notification')).toBeNull()
  })

  it('UN4 - the card renders in a portal on document.body, above any dialog', async () => {
    installPullBridge(AVAILABLE)
    render(<UpdateNotification />)
    const card = await screen.findByTestId('update-notification')
    expect(card.parentElement).toBe(document.body)
    // One above the dialogs' near-max z (Modal / BackendFailedModal).
    expect(card.className).toContain('z-[2147483647]')
  })
})
