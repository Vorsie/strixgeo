// Renderer pin for the licensing dialog's dev-only surfaces (senior review).
//
//  * SHOULD-FIX 1 — the "Preview a state" row is dev-only. It must render in a
//    dev build and be ABSENT in a packaged one (mirrors previewControlAllowed in
//    the main process, which also withholds the backing IPC when packaged).
//  * Owner ruling A — as a non-dismissable start screen the close X is hidden, so
//    a packaged build's blocked verdict cannot be clicked past.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, cleanup } from '@testing-library/react'

import LicensingDialog from './LicensingDialog'
import type { ActivationStatusDto } from '../../utils/launchPrototypeTypes'

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
