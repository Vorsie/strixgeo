/**
 * Flow 4 — Correlate two same-litho bands; rejection path: different litho.
 *
 * Acceptance criterion (debt #128 / #129c):
 * - After bulk accept, two same-litho units can be correlated:
 *   POST .../correlations returns 200 and a DB edge row appears.
 * - Correlating two units with different lithology returns 422 with
 *   code ``lithology_mismatch`` (the anti-corruption guard from debt #129c).
 *
 * The correlation endpoints operate at the model level and are independent
 * of the renderer state, so this flow calls the API directly like flow 3.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { countCorrelationEdges } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

test.describe('flow_correlate', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  test('same-litho correlation creates a DB edge; different-litho returns 422', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // 1. Resolve litho model.
      const modelsJson = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lithoModel = (modelsJson as any[]).find((m: any) => m.kind === 'lithostratigraphic')
      expect(lithoModel).toBeTruthy()
      const lithoModelId: string = lithoModel.id

      // 2. List all litho formations in this model — we need two with the
      //    same lithology (same litho_main_soil_code) for the happy path and
      //    two with different lithologies for the rejection path.
      const formationsJson = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/formations`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lithoFormations = (formationsJson as any[]).filter(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (f: any) => f.parent_formation_id !== null && f.litho_main_soil_code !== null,
      )

      // Skip the test if the fixture hasn't been through the bulk-accept flow
      // (formations are only created by accept; this flow assumes flow 3 ran first
      // via the fixture or the CI setup script).
      if (lithoFormations.length < 2) {
        test.skip()
        return
      }

      // Group by (litho_main_soil_code, parent_formation_id) to find correlatable pairs.
      // The correlate endpoint requires BOTH same lithology AND same geological parent —
      // a KLEI under Quaternary and a KLEI under Tertiary Clay are NOT correlatable.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byCodeAndParent = new Map<string, any[]>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const byCodeOnly = new Map<string, any[]>()
      for (const f of lithoFormations) {
        const code: string = f.litho_main_soil_code
        const parent: string = f.parent_formation_id ?? ''
        const key = `${code}::${parent}`
        if (!byCodeAndParent.has(key)) byCodeAndParent.set(key, [])
        byCodeAndParent.get(key)!.push(f)
        // Also track by code-only for the diff-pair search.
        if (!byCodeOnly.has(code)) byCodeOnly.set(code, [])
        byCodeOnly.get(code)!.push(f)
      }

      // Find a same-code + same-parent pair (the only pair the correlate endpoint accepts).
      let samePair: [string, string] | null = null
      for (const [, group] of byCodeAndParent) {
        if (group.length >= 2) {
          samePair = [group[0].id, group[1].id]
          break
        }
      }

      // Find a different-code pair (for the rejection-path test).
      // Must use formations with DIFFERENT litho_main_soil_code so the 422 is the
      // lithology_mismatch guard, not the parent_mismatch guard.
      const codes = [...byCodeOnly.keys()]
      let diffPair: [string, string] | null = null
      if (codes.length >= 2) {
        diffPair = [byCodeOnly.get(codes[0])![0].id, byCodeOnly.get(codes[1])![0].id]
      }

      const edgesBefore = await countCorrelationEdges(FIXTURE_PROJECT_ID)

      // 3. Happy path: correlate two same-lithology units.
      if (samePair) {
        const correlateRes = await page.evaluate(
          async ([base, pid, mid, aId, bId]) => {
            const r = await fetch(
              `${base}/projects/${pid}/geology/models/${mid}/correlations`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  formation_a_id: aId,
                  formation_b_id: bId,
                }),
              },
            )
            return { status: r.status, json: await r.json() }
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, samePair[0], samePair[1]],
        )
        // 201 on new edge, 200 if already exists (idempotent) — both are success.
        expect(correlateRes.status).toBeGreaterThanOrEqual(200)
        expect(correlateRes.status).toBeLessThan(300)

        const edgesAfter = await countCorrelationEdges(FIXTURE_PROJECT_ID)
        expect(edgesAfter).toBeGreaterThan(edgesBefore)
      } else {
        // If the fixture only produced one lithology type (possible with a
        // uniform qc profile), skip the same-pair sub-test.
        test.info().annotations.push({
          type: 'note',
          description: 'No same-lithology pair found — fixture may need bulk-accept first',
        })
      }

      // 4. Rejection path: correlating different-lithology units returns 422.
      if (diffPair) {
        const rejectRes = await page.evaluate(
          async ([base, pid, mid, aId, bId]) => {
            const r = await fetch(
              `${base}/projects/${pid}/geology/models/${mid}/correlations`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  formation_a_id: aId,
                  formation_b_id: bId,
                }),
              },
            )
            return { status: r.status, json: r.status < 200 || r.status >= 300 ? await r.json() : null }
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, diffPair[0], diffPair[1]],
        )
        // The correlate endpoint must reject mismatched lithologies.
        expect(rejectRes.status).toBe(422)
        // The detail is a plain string containing the mismatch description
        // (e.g. "Formations have different litho_main_soil_code: 'KLEI' vs 'SILT'").
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const detail = (rejectRes.json as any)?.detail ?? ''
        const detailStr = typeof detail === 'string' ? detail : (detail?.code ?? detail?.message ?? JSON.stringify(detail))
        expect(detailStr).toMatch(/different.*litho|lithology_mismatch/i)
      }
    } finally {
      await closeApp(app)
    }
  })
})
