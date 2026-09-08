/**
 * Flow — Litho gesture: "Split here" on an accepted layer is undoable.
 *
 * Owner ruling (installer #26, 2026-09-08): *"hier splitsen ... should be
 * revertible with ctrl z or the button"*.
 *
 * The renderer wires Ctrl+Z / the Undo button to an ``UndoCommand`` whose
 * ``revert`` deletes the bottom half the split created, letting the FC->LL
 * mirror re-merge the two halves into the original layer inside ONE
 * transaction (``splitLayerUndo.ts`` builds that command; its unit test pins
 * the command shape). This e2e proves the load-bearing BACKEND round-trip the
 * command depends on end-to-end against the real API + DB:
 *
 *   1. Take an accepted litho layer L = [top, base] on a CPT.
 *   2. Split it at its midpoint → the column now has TWO accepted layers.
 *   3. Undo = DELETE the new bottom row → the column is ONE layer again,
 *      spanning the original [top, base] (the merge the mirror performs).
 *
 * Follows the existing litho-flow recipe (API-driven via ``page.evaluate`` +
 * DB helpers) rather than driving the section canvas by pixel, which the other
 * litho specs avoid for robustness.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

interface Layer {
  id: string
  depth_top_m: number
  depth_base_m: number
  status: string
  cpt_id: string | null
}

test.describe('flow_litho_split_undo (installer #26)', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first',
  )

  test('split an accepted layer, then undo (delete bottom) merges it back to one layer', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // Resolve the litho model.
      const modelsJson = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lithoModel = (modelsJson as any[]).find(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (m: any) => m.kind === 'lithostratigraphic',
      )
      expect(lithoModel).toBeTruthy()
      const lithoModelId: string = lithoModel.id

      // Use the LAST CPT to reduce collision with the low-index CPTs the other
      // accept flows write to.
      const cptsJson = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/cpt/?project_id=${pid}`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cpts: any[] = cptsJson as any[]
      expect(cpts.length).toBeGreaterThanOrEqual(1)
      const cptId: string = cpts[cpts.length - 1].id

      const listAccepted = async (): Promise<Layer[]> =>
        page.evaluate(
          async ([base, pid, mid, cid]) => {
            const r = await fetch(
              `${base}/projects/${pid}/geology/models/${mid}/layers?cpt_id=${cid}&status=accepted`,
            )
            return r.json()
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, cptId],
        )

      // Ensure there is at least one accepted layer to split — accept a KLEI at
      // a shallow depth if the CPT has none yet (idempotent-friendly).
      let accepted = await listAccepted()
      if (accepted.length === 0) {
        await page.evaluate(
          async ([base, pid, mid, cid]) => {
            await fetch(
              `${base}/projects/${pid}/geology/models/${mid}/layers/accept-litho-suggestions`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  cpt_id: cid,
                  suggestions: [
                    {
                      depth_top_m: 1.0,
                      depth_base_m: 3.0,
                      suggested_lithology: 'KLEI',
                      suggested_admixtures: [],
                      suggested_nad_class: null,
                      mean_qc_mpa: null,
                      dr_pct: null,
                      confidence: 'high',
                      source: 'manual_pick',
                      parent_formation_id: null,
                      spans_boundary: false,
                    },
                  ],
                  defer_inference: false,
                }),
              },
            )
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, cptId],
        )
        accepted = await listAccepted()
      }
      expect(accepted.length).toBeGreaterThanOrEqual(1)

      // Pick a layer thick enough that a midpoint split leaves both halves above
      // the 0.001 m minimum. Sorted ascending by depth already.
      const target = accepted.find(
        (l) => l.depth_base_m - l.depth_top_m > 0.01,
      )
      expect(target).toBeDefined()
      const layer = target as Layer
      const originalTop = layer.depth_top_m
      const originalBase = layer.depth_base_m
      const splitDepth =
        Math.round(((originalTop + originalBase) / 2) * 1000) / 1000
      const countBefore = accepted.length

      // Split at the midpoint — the column should gain one accepted layer.
      const splitRes = await page.evaluate(
        async ([base, pid, mid, lid, depth]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/layers/${lid}/split`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ depth_m: depth }),
            },
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, layer.id, splitDepth],
      )
      expect(splitRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const splitBody = splitRes.json as any
      const bottomId: string = splitBody.bottom.id
      expect(bottomId).toBeTruthy()

      const afterSplit = await listAccepted()
      expect(afterSplit.length).toBe(countBefore + 1)
      // A boundary now sits at the split depth.
      expect(
        afterSplit.some((l) => Math.abs(l.depth_top_m - splitDepth) < 0.005),
      ).toBe(true)

      // Undo = delete the bottom half (what the UndoCommand's revert runs). The
      // FC->LL mirror re-derives the top layer's base back to the original
      // boundary in the same transaction.
      const delStatus = await page.evaluate(
        async ([base, pid, mid, bid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/layers/${bid}`,
            { method: 'DELETE' },
          )
          return r.status
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, bottomId],
      )
      expect(delStatus).toBeGreaterThanOrEqual(200)
      expect(delStatus).toBeLessThan(300)

      // One layer again, spanning the original extent — the halves re-merged.
      const afterUndo = await listAccepted()
      expect(afterUndo.length).toBe(countBefore)
      const restored = afterUndo.find(
        (l) => Math.abs(l.depth_top_m - originalTop) < 0.005,
      )
      expect(restored).toBeDefined()
      expect((restored as Layer).depth_base_m).toBeCloseTo(originalBase, 2)
      // The split boundary is gone.
      expect(
        afterUndo.some((l) => Math.abs(l.depth_top_m - splitDepth) < 0.005),
      ).toBe(false)
    } finally {
      await closeApp(app)
    }
  })
})
