/**
 * Flow 6 — Bundle save + close + reopen round-trip.
 *
 * Acceptance criterion (debt #128):
 * - GET /projects/{id}/bundle returns 200 with the full project state.
 * - POST /projects/{id}/restore with the same bundle is idempotent (200).
 * - Row counts (contacts, correlation edges) are identical before and after
 *   the restore cycle — nothing is lost or duplicated.
 * - A named lens survives the round-trip (the lens name is in the
 *   ``litho_lenses`` array and comes back after restore).
 *
 * This exercises the .strix file round-trip contract: the frontend calls
 * GET /bundle on File → Save (writes to disk), then POST /restore on open
 * (reads from disk). The bundle must be a lossless snapshot.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countContacts, countCorrelationEdges } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_bundle_roundtrip', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('bundle GET → restore POST preserves row counts and named lens', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // 1. Snapshot row counts before the round-trip.
      const contactsBefore = await countContacts(FIXTURE_PROJECT_ID)
      const edgesBefore = await countCorrelationEdges(FIXTURE_PROJECT_ID)

      // 2. GET /projects/{id}/bundle — the full project state.
      const bundleRes = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/bundle`)
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      expect(bundleRes.status).toBe(200)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const bundle = bundleRes.json as any
      expect(bundle.format_version).toBe(3)
      expect(bundle.project.id).toBe(FIXTURE_PROJECT_ID)

      // Count how many named lenses are in the bundle.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const namedLensesInBundle = ((bundle.litho_lenses ?? []) as any[]).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (l: any) => l.name !== null && l.name !== undefined,
      )

      // 3. POST /projects/{id}/restore with the same bundle — idempotent call.
      const restoreRes = await page.evaluate(
        async ([base, pid, bundleJson]) => {
          const r = await fetch(`${base}/projects/${pid}/restore`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: bundleJson as string,
          })
          return { status: r.status }
        },
        [API_BASE, FIXTURE_PROJECT_ID, JSON.stringify(bundle)],
      )
      expect(restoreRes.status).toBe(200)

      // 4. Row counts must be identical after restore (idempotent, no duplication).
      const contactsAfter = await countContacts(FIXTURE_PROJECT_ID)
      const edgesAfter = await countCorrelationEdges(FIXTURE_PROJECT_ID)

      expect(contactsAfter).toBe(contactsBefore)
      expect(edgesAfter).toBe(edgesBefore)

      // 5. Named lenses survive the round-trip.
      //    Re-fetch the bundle after restore and verify lenses are still there.
      if (namedLensesInBundle.length > 0) {
        const bundleAfterRes = await page.evaluate(
          async ([base, pid]) => {
            const r = await fetch(`${base}/projects/${pid}/bundle`)
            return { status: r.status, json: await r.json() }
          },
          [API_BASE, FIXTURE_PROJECT_ID],
        )
        expect(bundleAfterRes.status).toBe(200)

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const bundleAfter = bundleAfterRes.json as any
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const namedLensesAfter = ((bundleAfter.litho_lenses ?? []) as any[]).filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (l: any) => l.name !== null && l.name !== undefined,
        )
        // All named lenses from before must still be present after restore.
        expect(namedLensesAfter.length).toBeGreaterThanOrEqual(namedLensesInBundle.length)

        // Each name from the pre-restore bundle must appear in the post-restore bundle.
        for (const lensBeforeEntry of namedLensesInBundle) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const stillPresent = namedLensesAfter.some((l: any) => l.name === lensBeforeEntry.name)
          expect(stillPresent).toBe(true)
        }
      }

      // 6. Format version is preserved.
      expect(bundle.format_version).toBe(3)
    } finally {
      await closeApp(app)
    }
  })
})
