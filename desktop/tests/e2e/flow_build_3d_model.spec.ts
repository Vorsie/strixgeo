/**
 * Flow I — Geology stage: Build 3D model (on-click build pivot).
 *
 * Acceptance criteria (debt #130):
 *
 * Happy path:
 *   POST /geology/models/{mid}/surfaces/rebuild rebuilds TINs for all
 *   formations with contacts.  After rebuild:
 *   - ``formation_surface.is_stale = false`` for all surfaces.
 *   - ``formation_surface`` rows exist with non-empty vertex arrays (has_tin).
 *   - The API response carries ``formations_rebuilt > 0``.
 *
 * Rejection path (no contacts):
 *   The ``Build 3D model`` toolbar button is DISABLED when contacts.length=0
 *   (gated at the UI layer in GeologyToolbar).  At the API layer, rebuild on
 *   a model with no contacts returns a valid response with
 *   ``formations_considered=0`` (it's a no-op, not an error — the UI
 *   prevents the accidental click).
 *
 * Regression anchor: reverting the ``is_stale=False`` write in
 * ``RebuildModelSurfaces`` would cause ``getFormationSurfaces`` to
 * still return ``is_stale=true`` after a rebuild call, failing the
 * assertion at step 5 of this test. That is the documented regression
 * demo for this flow.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { getFormationSurfaces, getGeologicalModelId, countStaleSurfaces } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_build_3d_model (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('rebuild clears is_stale and produces non-empty TINs', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // 1. Resolve the geological model for this fixture project.
      const geoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'geological')
      expect(geoModelId).not.toBeNull()

      // 2. Force-stale at least one surface by touching a contact via
      //    PATCH /geology/models/{mid}/contacts/{cid}.
      //    The fixture has contacts for 3 formations × 6 CPTs.
      //    We PATCH one contact's depth by ε and back to force the stale flag
      //    without actually moving the surface.
      const contactsRes = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contacts`,
          )
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contacts = contactsRes as any[]
      expect(contacts.length).toBeGreaterThan(0)

      // Mutate the first contact slightly (depth + 0.001) to flag is_stale.
      const firstContact = contacts[0]
      const origDepth: number = firstContact.depth_top_m
      await page.evaluate(
        async ([base, pid, mid, cid, newDepth]) => {
          await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contacts/${cid}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ depth_top_m: newDepth }),
            },
          )
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId, firstContact.id, origDepth + 0.001],
      )

      // 3. Verify at least one surface is now stale.
      const staleCountBefore = await countStaleSurfaces(geoModelId!)
      expect(staleCountBefore).toBeGreaterThan(0)

      // 4. Trigger rebuild.
      const rebuildRes = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/surfaces/rebuild`,
            { method: 'POST' },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId],
      )
      expect(rebuildRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const outcome = rebuildRes.json as any
      expect(outcome.formations_rebuilt).toBeGreaterThan(0)

      // 5. is_stale must be false for all surfaces.
      const staleCountAfter = await countStaleSurfaces(geoModelId!)
      expect(staleCountAfter).toBe(0)

      // 6. formation_surface rows have non-empty TINs (has_tin=true).
      const surfaces = await getFormationSurfaces(geoModelId!)
      expect(surfaces.length).toBeGreaterThan(0)
      const allHaveTin = surfaces.every(s => s.has_tin)
      expect(allHaveTin).toBe(true)

      // 7. Restore the contact depth so later flows aren't affected.
      await page.evaluate(
        async ([base, pid, mid, cid, origD]) => {
          await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contacts/${cid}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ depth_top_m: origD }),
            },
          )
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId, firstContact.id, origDepth],
      )
      // Rebuild again so later flows see a fresh model.
      await page.evaluate(
        async ([base, pid, mid]) => {
          await fetch(`${base}/projects/${pid}/geology/models/${mid}/surfaces/rebuild`, {
            method: 'POST',
          })
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId],
      )
    } finally {
      await closeApp(app)
    }
  })

  test('rebuild on a model with zero contacts returns formations_considered=0 (no-op)', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // Create a scratch geological model with no contacts.
      const createModelRes = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: 'E2E-Scratch-NoContacts',
              description: null,
              kind: 'geological',
              parent_geological_model_id: null,
            }),
          })
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      expect(createModelRes.status).toBe(201)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const scratchModel = createModelRes.json as any
      const scratchModelId: string = scratchModel.id

      // Rebuild: model has zero contacts → formations_considered=0.
      const rebuildRes = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/surfaces/rebuild`,
            { method: 'POST' },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, scratchModelId],
      )
      expect(rebuildRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((rebuildRes.json as any).formations_considered).toBe(0)

      // Clean up scratch model.
      await page.evaluate(
        async ([base, pid, mid]) => {
          await fetch(`${base}/projects/${pid}/geology/models/${mid}`, {
            method: 'DELETE',
          })
        },
        [API_BASE, FIXTURE_PROJECT_ID, scratchModelId],
      )
    } finally {
      await closeApp(app)
    }
  })

  test('geology-build-model-button testid is present in the Geology toolbar', async () => {
    const { app, page } = await launchApp({
      E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID,
    })

    try {
      await page.waitForLoadState('domcontentloaded')

      const geologySpine = page.locator('button[title*="Geology"], button[title*="geology"]').first()
      if (await geologySpine.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await geologySpine.click()
      }

      await expect(page.getByTestId('geology-build-model-button')).toBeAttached({
        timeout: 10_000,
      })
    } finally {
      await closeApp(app)
    }
  })
})
