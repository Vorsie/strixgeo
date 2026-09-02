// Renderer pin for the licensing dialog's dev-only surfaces (senior review).
//
//  * SHOULD-FIX 1 — the "Preview a state" row is dev-only. It must render in a
//    dev build and be ABSENT in a packaged one (mirrors previewControlAllowed in
//    the main process, which also withholds the backing IPC when packaged).
//  * Owner ruling A — as a non-dismissable start screen the close X is hidden, so
//    a packaged build's blocked verdict cannot be clicked past.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'

import LicensingDialog from './LicensingDialog'
import type { ActivationActionResultDto, ActivationStatusDto } from '../../utils/launchPrototypeTypes'

const UNACTIVATED: ActivationStatusDto = {
  verdict: {
    state: 'unactivated',
    blocked: true,
    tier: null,
    isTrial: false,
    daysRemaining: null,
    graceDaysRemaining: null,
    expiresAtMs: null,
    graceEndsAtMs: null,
    reason: 'no licence',
  },
  deviceLabel: 'test-host',
  keyMasked: null,
  isTrial: false,
}

const ACTIVE: ActivationStatusDto = {
  verdict: {
    state: 'active',
    blocked: false,
    tier: 'pro',
    isTrial: false,
    daysRemaining: 200,
    graceDaysRemaining: null,
    expiresAtMs: Date.parse('2027-03-01T00:00:00.000Z'),
    graceEndsAtMs: null,
    reason: 'active',
  },
  deviceLabel: 'test-host',
  keyMasked: '••••DEMO',
  isTrial: false,
}

function installElectron(launchFlags: { e2e: boolean; packaged: boolean }): void {
  ;(window as unknown as { electron: unknown }).electron = {
    launchFlags,
    getActivationStatus: vi.fn().mockResolvedValue(UNACTIVATED),
    activateLicence: vi.fn(),
    startTrial: vi.fn(),
    deactivateLicence: vi.fn(),
    previewActivationState: vi.fn().mockResolvedValue(UNACTIVATED),
  }
}

afterEach(() => {
  cleanup()
  delete (window as unknown as { electron?: unknown }).electron
})

describe('LicensingDialog dev-only surfaces', () => {
  it('shows the "Preview a state" row in a dev build', async () => {
    installElectron({ e2e: false, packaged: false })
    render(<LicensingDialog open onClose={() => {}} />)
    // findBy flushes the getActivationStatus effect so no act() warning trails.
    await screen.findByTestId('licensing-key-input')
    expect(screen.queryByTestId('licensing-preview-row')).not.toBeNull()
  })

  it('hides the "Preview a state" row in a packaged build', async () => {
    installElectron({ e2e: false, packaged: true })
    render(<LicensingDialog open onClose={() => {}} />)
    await screen.findByTestId('licensing-key-input')
    expect(screen.queryByTestId('licensing-preview-row')).toBeNull()
  })

  it('hides the close X when used as a non-dismissable start screen', async () => {
    installElectron({ e2e: false, packaged: true })
    render(<LicensingDialog open dismissable={false} onClose={() => {}} />)
    await screen.findByTestId('licensing-key-input')
    // The X carries aria-label common.close; a non-dismissable start screen omits it.
    expect(screen.queryByLabelText('Close')).toBeNull()
  })
})

// Deactivate / transfer is irreversible (it frees the seat on the server), so it
// MUST route through a confirmation dialog: Cancel default-focused, an
// action-named button, and no bridge call until the user confirms
// (docs/ux.md "Reversible vs irreversible", CLAUDE.md hard rule).
describe('LicensingDialog deactivate confirmation', () => {
  /** Install an activated status + an inspectable deactivate bridge. */
  function installActivated(): ReturnType<typeof vi.fn> {
    const deactivateLicence = vi.fn().mockResolvedValue({
      ok: true,
      status: UNACTIVATED,
    } satisfies ActivationActionResultDto)
    ;(window as unknown as { electron: unknown }).electron = {
      launchFlags: { e2e: false, packaged: false },
      getActivationStatus: vi.fn().mockResolvedValue(ACTIVE),
      activateLicence: vi.fn(),
      startTrial: vi.fn(),
      deactivateLicence,
      previewActivationState: vi.fn().mockResolvedValue(ACTIVE),
    }
    return deactivateLicence
  }

  it('does not call the bridge on the first click — it opens a confirm with Cancel focused and a "Deactivate" action', async () => {
    const deactivateLicence = installActivated()
    render(<LicensingDialog open onClose={() => {}} />)
    // Wait until the activated status is read so the Deactivate button renders.
    const trigger = await screen.findByTestId('licensing-deactivate')

    fireEvent.click(trigger)

    // The confirm dialog is up; nothing was released yet.
    expect(screen.getByTestId('licensing-deactivate-dialog')).toBeTruthy()
    expect(deactivateLicence).not.toHaveBeenCalled()
    // Cancel is default-focused so an accidental Enter cannot deactivate.
    expect(screen.getByTestId('licensing-deactivate-cancel')).toHaveFocus()
    // The action button names the action, not "OK".
    expect(screen.getByTestId('licensing-deactivate-confirm').textContent).toBe('Deactivate')
  })

  it('calls the bridge only after the user confirms', async () => {
    const deactivateLicence = installActivated()
    render(<LicensingDialog open onClose={() => {}} />)
    fireEvent.click(await screen.findByTestId('licensing-deactivate'))
    fireEvent.click(screen.getByTestId('licensing-deactivate-confirm'))
    await waitFor(() => expect(deactivateLicence).toHaveBeenCalledTimes(1))
  })

  it('closes the confirm without releasing when Cancel is pressed', async () => {
    const deactivateLicence = installActivated()
    render(<LicensingDialog open onClose={() => {}} />)
    fireEvent.click(await screen.findByTestId('licensing-deactivate'))
    fireEvent.click(screen.getByTestId('licensing-deactivate-cancel'))
    await waitFor(() => expect(screen.queryByTestId('licensing-deactivate-dialog')).toBeNull())
    expect(deactivateLicence).not.toHaveBeenCalled()
  })
})
