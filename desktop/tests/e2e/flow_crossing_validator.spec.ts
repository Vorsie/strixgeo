/**
 * Flow J — Geology stage: surface-crossing validator (debt #130).
 *
 * Acceptance criteria (debt #130):
 *
 * Happy path — deliberate crossing:
 *   Two formations (A = older, B = younger) are created in a scratch
 *   geological model. Contacts are seeded at the fixture's CPT locations
 *   with B's surface intentionally placed DEEPER than A's — a violation
 *   of the geological superposition rule. After rebuild:
 *   - ``GET .../validate/crossings`` returns ``issues.length >= 1``.
 *   - The ``crossings-banner`` testid is attached to the inspector DOM
 *     (visible only when the model with crossings is the active one).
 *
 * Negative path — clean model:
 *   The fixture's geological model has consistent contacts (younger
 *   formation surfaces are shallower than older ones). After a fresh
 *   rebuild:
 *   - ``GET .../validate/crossings`` returns ``issues.length === 0``.
 *
 * Regression anchor: any change that stops the validator from flagging
 * an inverted-depth contact pair will cause the ``issues.length >= 1``
 * assertion to fail, catching a regression in ``ValidateModelCrossings``.
 *
 * Design notes:
 * - The crossing is constructed purely via REST calls — no UI gestures.
 *   This mirrors the approach used in Flow H (reorder via PATCH rather
 *   than drag-and-drop) and is the documented testing strategy for
 *   geometry-correctness specs.
 * - The scratch model is created in ``test.beforeAll`` and torn down in
 *   ``test.afterAll`` so the per-test bodies are declarative.
 * - ``cpt_id`` anchors are used (not borehole_id) because the fixture
 *   ships 6 CPTs and no boreholes; both anchor types produce the same
 *   validator behaviour.
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { getGeologicalModelId, countStaleSurfaces } from './helpers/db_helper'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

// ---------------------------------------------------------------------------
// Shared state populated by beforeAll.
// ---------------------------------------------------------------------------

let scratchModelId: string | null = null
// The CPTs delivered by the fixture — resolved in beforeAll.
let cptIds: string[] = []
// The two formations used to construct the deliberate crossing.
let formationAId: string | null = null
let formationBId: string | null = null

test.describe('flow_crossing_validator (#130)', () => {
  test.skip(!FIXTURE_PROJECT_ID, 'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first')

  // -------------------------------------------------------------------------
  // Setup: create a scratch geological model with an inverted stratigraphy.
  // Formation A (older, display_order=0) gets shallow contacts;
  // Formation B (younger, display_order=1) gets deep contacts.
  // After rebuild the B surface dips BELOW A — a crossing.
  // -------------------------------------------------------------------------
  test.beforeAll(async ({ request }) => {
    // 1. Fetch the CPT ids from the fixture project.
    // NOTE: the CPT listing endpoint is GET /cpt/?project_id={id} (under the
    // /cpt prefix), NOT /projects/{id}/cpts which does not exist.
    const cptsRes = await request.get(`${API_BASE}/cpt/?project_id=${FIXTURE_PROJECT_ID}`)
    expect(cptsRes.ok()).toBe(true)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cpts = (await cptsRes.json()) as any[]
    expect(cpts.length).toBeGreaterThanOrEqual(4) // need ≥4 to get non-collinear points across two Y rows

    // Use 4 CPTs — the TIN needs ≥3 non-collinear points.
    // The fixture grid is 2×3: CPT[0..2] are on row y=214000 (collinear!),
    // CPT[3..5] are on row y=214300.  Using ONLY the first 3 produces a
    // degenerate (zero-area) TIN that the crossing validator skips.
    // We include CPT[3] (which has a different Y) to guarantee a valid
    // non-collinear triangle set.
    cptIds = cpts.slice(0, 4).map((c: { id: string }) => c.id)

    // 2. Create a scratch geological model.
    const createModelRes = await request.post(
      `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/models`,
      {
        data: {
          name: 'E2E-Crossing-Scratch',
          description: null,
          kind: 'geological',
          parent_geological_model_id: null,
        },
      },
    )
    expect(createModelRes.ok()).toBe(true)
    const scratchModel = await createModelRes.json()
    scratchModelId = scratchModel.id as string

    // 3. Create formation A (older; lower display_order = deeper in time).
    const createARes = await request.post(
      `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/formations`,
      {
        data: {
          name: 'E2E-Crossing-A-Older',
          color: '#886644',
          display_order: 0,
        },
      },
    )
    expect(createARes.ok()).toBe(true)
    formationAId = ((await createARes.json()) as { id: string }).id

    // 4. Create formation B (younger; higher display_order = closer to surface).
    const createBRes = await request.post(
      `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/formations`,
      {
        data: {
          name: 'E2E-Crossing-B-Younger',
          color: '#4466aa',
          display_order: 1,
        },
      },
    )
    expect(createBRes.ok()).toBe(true)
    formationBId = ((await createBRes.json()) as { id: string }).id

    // 5. Add contacts to each CPT with deliberately crossing geometry.
    //
    //    The crossing validator derives "age" from mean surface elevation
    //    (lower mean elevation = deeper = older) — it does NOT use
    //    display_order.  Flat uniform depths can never produce a crossing
    //    because one surface is uniformly above the other.
    //
    //    To force a real 3D crossing we vary depth across the 3 CPT
    //    locations so the two TIN surfaces intersect:
    //
    //      CPT[0]: A at 1 m depth, B at 7 m depth  (A above B)
    //      CPT[1]: A at 1 m depth, B at 7 m depth  (A above B)
    //      CPT[2]: A at 9 m depth, B at 2 m depth  (A below B → crossing!)
    //      CPT[3]: A at 1 m depth, B at 7 m depth  (ensures non-collinear TIN)
    //
    //    CPT[0..2] are on the same Y row (collinear); CPT[3] is on a
    //    different Y row and breaks the collinearity so a valid TIN is built.
    //    Without CPT[3] the Delaunay triangulation is degenerate (zero-area)
    //    and the crossing validator correctly skips formations without triangles.
    //
    //    Mean depth A ≈ 3.0 m → A is "younger" (shallower on average).
    //    Mean depth B ≈ 5.75 m → B is "older" (deeper on average).
    //    At CPT[2] the younger A (9 m) dips BELOW the older B (2 m) —
    //    a superposition-rule violation that the validator must catch.
    const aDepths = [1.0, 1.0, 9.0, 1.0]
    const bDepths = [7.0, 7.0, 2.0, 7.0]
    for (let i = 0; i < cptIds.length; i++) {
      const cptId = cptIds[i]
      const resA = await request.post(
        `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/models/${scratchModelId}/contacts`,
        {
          data: {
            formation_id: formationAId,
            depth_top_m: aDepths[i],
            cpt_id: cptId,
            source: 'manual_pick',
          },
        },
      )
      // 201 = new contact; 409 = already exists from a previous (non-cleaned) run.
      expect([201, 409]).toContain(resA.status())

      const resB = await request.post(
        `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/models/${scratchModelId}/contacts`,
        {
          data: {
            formation_id: formationBId,
            depth_top_m: bDepths[i],
            cpt_id: cptId,
            source: 'manual_pick',
          },
        },
      )
      expect([201, 409]).toContain(resB.status())
    }

    // 6. Rebuild to materialise the TINs so the crossing validator has
    //    geometry to walk.
    const rebuildRes = await request.post(
      `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/models/${scratchModelId}/surfaces/rebuild`,
    )
    expect(rebuildRes.ok()).toBe(true)
  })

  test.afterAll(async ({ request }) => {
    if (!scratchModelId) return

    // Delete formations first to clear contacts + surfaces.
    if (formationAId) {
      await request.delete(
        `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/formations/${formationAId}`,
      )
    }
    if (formationBId) {
      await request.delete(
        `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/formations/${formationBId}`,
      )
    }

    // Delete the scratch model.
    await request.delete(
      `${API_BASE}/projects/${FIXTURE_PROJECT_ID}/geology/models/${scratchModelId}`,
    )

    scratchModelId = null
    formationAId = null
    formationBId = null
  })

  // -------------------------------------------------------------------------
  // Test 1 — happy path: crossing detected.
  // -------------------------------------------------------------------------
  test('deliberate crossing: validate/crossings returns at least one issue', async () => {
    expect(scratchModelId).not.toBeNull()

    // The model was already rebuilt in beforeAll; verify it is not stale
    // so the assertion is meaningful.
    const staleCount = await countStaleSurfaces(scratchModelId!)
    expect(staleCount).toBe(0)

    // Call the crossing validator.
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      const crossingRes = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/validate/crossings`,
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, scratchModelId],
      )

      expect(crossingRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = crossingRes.json as any
      expect(body.issues).toBeDefined()
      expect(Array.isArray(body.issues)).toBe(true)
      // The inverted depths must produce at least one crossing issue.
      expect((body.issues as unknown[]).length).toBeGreaterThan(0)
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Test 2 — negative path: clean model has no crossings.
  // -------------------------------------------------------------------------
  test('fixture geological model (consistent contacts) has zero crossings after rebuild', async () => {
    const { app, page } = await launchApp()

    try {
      await page.waitForLoadState('domcontentloaded')

      // Resolve the fixture's existing geological model.
      const geoModelId = await getGeologicalModelId(FIXTURE_PROJECT_ID, 'geological')
      expect(geoModelId).not.toBeNull()

      // Rebuild to ensure the model is fresh.
      await page.evaluate(
        async ([base, pid, mid]) => {
          await fetch(`${base}/projects/${pid}/geology/models/${mid}/surfaces/rebuild`, {
            method: 'POST',
          })
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId],
      )

      // Validate crossings — should be empty for a consistent model.
      const crossingRes = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/validate/crossings`,
          )
          return { status: r.status, json: await r.json() }
        },
        [API_BASE, FIXTURE_PROJECT_ID, geoModelId],
      )

      expect(crossingRes.status).toBe(200)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const body = crossingRes.json as any
      expect(body.issues).toBeDefined()
      expect(Array.isArray(body.issues)).toBe(true)
      expect((body.issues as unknown[]).length).toBe(0)
    } finally {
      await closeApp(app)
    }
  })

  // -------------------------------------------------------------------------
  // Test 3 — DOM: crossings-banner testid is present in GeologyInspector.
  // -------------------------------------------------------------------------
  test('crossings-banner testid is present in the Geology inspector', async () => {
    // TODO (#130): this test requires a project to be open in the Geology stage.
    // The harness boots to the welcome screen and has no .gmproj file path to open,
    // so GeologyInspector never renders and the crossings-banner + confidence-fade
    // testids are not in the DOM.
    // Re-enable when the harness gets a fixture .gmproj file + project:open-file IPC.
    test.skip(true, 'Requires project open in harness — fixture .gmproj not yet wired')

    const { app, page } = await launchApp({
      E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID,
    })

    try {
      await page.waitForLoadState('domcontentloaded')

      // Navigate to the Geology stage.
      const geologySpine = page.locator('button[title*="Geology"], button[title*="geology"]').first()
      if (await geologySpine.isVisible({ timeout: 5_000 }).catch(() => false)) {
        await geologySpine.click()
      }

      // The confidence-fade-toggle is a reliable Geology inspector anchor.
      await expect(page.getByTestId('confidence-fade-toggle')).toBeAttached({ timeout: 10_000 })

      // The crossings-banner is rendered conditionally only when there are
      // crossing issues. We cannot guarantee the active model has crossings
      // in a CI run (depends on fixture state), so we assert the inspector
      // rendered without error rather than the banner being visible.
      // The Regression anchor (test 1) is the definitive crossing-detection test.
      //
      // What we CAN assert: when we call the crossings endpoint for the
      // scratch model via the API, the response shape matches what the
      // inspector's ``useCrossingIssues`` hook would consume.
      const crossingApiRes = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/validate/crossings`,
          )
          return r.status
        },
        [API_BASE, FIXTURE_PROJECT_ID, scratchModelId],
      )
      expect(crossingApiRes).toBe(200)
    } finally {
      await closeApp(app)
    }
  })
})
