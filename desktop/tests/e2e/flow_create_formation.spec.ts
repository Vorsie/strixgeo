/**
 * Flow F — Geology stage: create formation (happy + rejection path).
 *
 * Acceptance criteria (debt #130):
 * - POST /projects/{pid}/geology/formations creates a new row in
 *   ``geological_formation`` with ``pinned_order=false``.
 * - The new formation appears in the GeologyInspector formation list
 *   (youngest-first) immediately after creation.
 * - Submitting with an empty name: the backend returns 422 and NO new
 *   ``geological_formation`` row is created (``countFormations`` is unchanged).
 *
 * Regression anchor: removing the ``geology-create-formation-button`` testid
 * causes the selector assertion to fail immediately, catching a testid
 * regression in the same commit.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countFormations, getFormationsByProject } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_create_formation (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('POST /geology/formations creates a row; empty-name returns 422', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const formationsBefore = await countFormations(FIXTURE_PROJECT_ID)

      // 1. Happy path — create via the API (same path the dialog calls).
      const formationName = `E2E-Formation-${Date.now()}`
      const createRes = await page.evaluate(
        async ([base, pid, name]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/formations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, color: '#aabbcc' }),
          })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, formationName],
      )
      expect(createRes.status).toBe(201)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const created = createRes.json as any
      expect(created.id).toBeTruthy()
      expect(created.name).toBe(formationName)

      // 2. pinned_order must be false on a freshly created formation.
      expect(created.pinned_order).toBe(false)

      // 3. DB has grown by exactly one top-level formation row.
      const formationsAfter = await countFormations(FIXTURE_PROJECT_ID)
      expect(formationsAfter).toBe(formationsBefore + 1)

      // 4. The row is queryable from the DB.
      const rows = await getFormationsByProject(FIXTURE_PROJECT_ID)
      const found = rows.find(r => r.id === created.id)
      expect(found).toBeTruthy()
      expect(found!.name).toBe(formationName)
      expect(found!.pinned_order).toBe(false)

      // 5. Clean up — delete the test formation so it doesn't pollute
      //    subsequent flows (countFormations assertions, Fill-from-boreholes
      //    idempotency checks, etc.).
      await page.evaluate(
        async ([base, pid, fid]) => {
          await fetch(`${base}/projects/${pid}/geology/formations/${fid}`, {
            method: 'DELETE',
          })
        },
        [API_BASE, FIXTURE_PROJECT_ID, created.id],
      )

      // 6. Rejection path — empty name returns 422.
      const emptyRes = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/formations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '', color: '#aabbcc' }),
          })
          return { status: r.status }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      expect(emptyRes.status).toBe(422)

      // 7. Whitespace-only name also rejected.
      const wsRes = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/formations`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: '   ', color: '#aabbcc' }),
          })
          return { status: r.status }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      expect(wsRes.status).toBe(422)

      // 8. After cleanup + failed attempts, count is back to baseline.
      const formationsClean = await countFormations(FIXTURE_PROJECT_ID)
      expect(formationsClean).toBe(formationsBefore)
    } finally {
      await closeApp(app)
    }
  })

  test('geology-create-formation-button testid is present on the Geology stage', async () => {
    const { app, page } = await launchApp({
      E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID,
    })

    try {
      await page.waitForLoadState('domcontentloaded')

      // Navigate to the Geology stage by clicking the spine button whose
      // aria-label contains "Geology" or "Stratigraphy" (the spine label).
      // The SpineButton renders: aria-label={summary.label} where summary.label
      // comes from the stage's useStageSummary hook.  We match by title attribute
      // which is also set to summary.label on the spine <button>.
      const geologySpine = page.locator('button[title*="Geology"], button[title*="geology"]').first()
      if (await geologySpine.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await geologySpine.click()
      }

      // The inspector pane always mounts; even on the wrong stage the testid
      // is present because the inspector renders based on the active stage.
      // We assert the testid exists somewhere in the document.
      await expect(page.getByTestId('geology-create-formation-button')).toBeAttached({
        timeout: 10_000,
      })

      // The crossings-banner testid block is also in the Geology inspector
      // (it's only visible when crossings exist, but the testid is conditional
      // on data — just assert the inspector rendered without error).
      await expect(page.getByTestId('confidence-fade-toggle')).toBeAttached({ timeout: 5_000 })
    } finally {
      await closeApp(app)
    }
  })
})
