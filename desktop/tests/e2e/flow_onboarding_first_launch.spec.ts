/**
 * Flow — first-launch onboarding overlay (debt #93, prototype).
 *
 * The other ~130 specs run with STRIX_E2E=1, which SUPPRESSES the onboarding
 * auto-open so its z-max modal never covers the window (the senior-review
 * BLOCKER). This spec is the counterpart: it clears STRIX_E2E for THIS launch
 * only (the per-spec env is spread last in electron_launch.ts and wins over the
 * harness default), so the auto-open actually fires, and pins that:
 *
 *   1. on a fresh, non-e2e launch the overlay auto-opens, and
 *   2. dismissing it (the always-present Skip affordance) reveals the welcome
 *      screen underneath.
 *
 * Robust to the recovery-modal pattern (memory feedback_e2e_recovery_modal_
 * blocks_suite): a leftover crash-recovery prompt from an earlier spec is
 * dismissed without restoring before the overlay is interacted with.
 *
 * NOTE: needs the :8765 backend + integration DB like every e2e spec — run it
 * only through scripts/run-e2e.ps1, never standalone.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const SEEN_KEY = 'strix.onboarding.seen.v1'

test.describe('flow_onboarding_first_launch', () => {
  test('the first-launch overlay auto-opens and dismisses to the welcome screen', async () => {
    // Clear STRIX_E2E for this spec so the auto-open (suppressed suite-wide) fires.
    const { app, page } = await launchApp({
      E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID,
      STRIX_E2E: '',
    })

    try {
      // The harness userData dir persists across runs, so a prior run of this
      // spec left the "seen" flag set. Clear it and reload so the auto-open
      // effect fires on a guaranteed-fresh mount — deterministic every run.
      await page.evaluate(key => window.localStorage.removeItem(key), SEEN_KEY)
      await page.reload()
      await page.waitForLoadState('domcontentloaded')

      // The overlay auto-opens once the app finishes booting (it renders on the
      // welcome branch, above the loading screen).
      await expect(page.getByTestId('onboarding-overlay')).toBeVisible({ timeout: 20_000 })

      // A leftover recovery prompt from an earlier spec would sit over the same
      // z-max layer; dismiss it without restoring before interacting. Best-effort.
      const recovery = page.getByTestId('recovery-prompt-dialog')
      if (await recovery.isVisible().catch(() => false)) {
        await page.getByTestId('recovery-open-without-restoring').click().catch(() => {})
      }

      await expect(page.getByTestId('onboarding-welcome')).toBeVisible()

      // Dismiss via the always-present Skip affordance (ruling 24: skippable).
      await page.getByTestId('onboarding-skip').click()

      // The overlay is gone and the welcome screen is reachable underneath.
      await expect(page.getByTestId('onboarding-overlay')).toBeHidden()
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
    } finally {
      await closeApp(app)
    }
  })
})
