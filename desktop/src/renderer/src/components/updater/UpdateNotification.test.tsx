// Owner finding (g), installer #37: "check for updates failed". The releases
// feed has no published release yet (the closed beta's normal state), so a
// packaged check reaches the renderer as an updater event that must read as a
// CALM "no update available yet", never as a failure. A real failure keeps the
// failure wording but names its cause (offline / blocked / unexpected).
//
// The component subscribes to window.electron.onUpdaterEvent; the test captures
// that callback and pushes each phase to assert what the card shows.

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'

import UpdateNotification from './UpdateNotification'
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
