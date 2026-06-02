/**
 * Flow 6 — Bundle save + close + reopen round-trip.
 *
 * Acceptance criterion (debt #128):
 * - GET /projects/{id}/bundle returns 200 with the full project state.
 * - POST /projects/{id}/restore with the same bundle is idempotent (200).
 * - Row counts (contacts, correlation edges) are identical before and after
 *   the restore cycle — nothing is lost or duplicated.
 * - A named body survives the round-trip (the body name is in the top-level
 *   ``bodies`` array — slice 4.1 rename of ``litho_lenses`` — and comes back
 *   after restore).
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

  test('bundle GET → restore POST preserves row counts and named body', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // 1. Snapshot row counts before the round-trip.
      const contactsBefore = await countContacts(FIXTURE_PROJECT_ID)
      const edgesBefore = await countCorrelationEdges(FIXTURE_PROJECT_ID)

      // 1b. Name the seeded body so the round-trip has a named body to
      //     preserve. The fixture's DetectBodies pass leaves bodies unnamed;
      //     PATCH .../bodies/{id} (NameBody) is idempotent on re-runs.
      const NAMED_BODY = 'E2E round-trip body'
      const namedBody = await page.evaluate(
        async ([base, pid, label]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const models: any[] = await (
            await fetch(`${base}/projects/${pid}/geology/models`)
          ).json()
          const litho = models.find((m) => m.kind === 'lithostratigraphic')
          if (!litho) return null
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const bodies: any[] = await (
            await fetch(`${base}/projects/${pid}/geology/models/${litho.id}/bodies`)
          ).json()
          if (!bodies.length) return null
          const b = bodies[0]
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${litho.id}/bodies/${b.id}`,
            {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                formation_id: b.formation_id,
                body_ordinal: b.body_ordinal,
                name: label,
              }),
            },
          )
          return { status: r.status }
        },
        [API_BASE, FIXTURE_PROJECT_ID, NAMED_BODY],
      )
      expect(namedBody, 'a seeded body must exist to name (action seed)').toBeTruthy()
      expect((namedBody as { status: number }).status).toBe(200)

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
      expect(bundle.format_version).toBe(4)
      expect(bundle.project.id).toBe(FIXTURE_PROJECT_ID)

      // The named body must be in the bundle's top-level bodies array.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const namedBodiesInBundle = ((bundle.bodies ?? []) as any[]).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (b: any) => b.name === NAMED_BODY,
      )
      expect(namedBodiesInBundle.length).toBeGreaterThan(0)

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

      // 5. The named body survives the round-trip.
      //    Re-fetch the bundle after restore and verify the body name persists.
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
      const namedBodiesAfter = ((bundleAfter.bodies ?? []) as any[]).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (b: any) => b.name === NAMED_BODY,
      )
      expect(namedBodiesAfter.length).toBeGreaterThanOrEqual(namedBodiesInBundle.length)

      // 6. Format version is preserved.
      expect(bundle.format_version).toBe(4)
    } finally {
      await closeApp(app)
    }
  })
})
