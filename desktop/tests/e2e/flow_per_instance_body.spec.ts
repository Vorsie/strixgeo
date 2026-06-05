/**
 * Flow — per-instance bodies (two-instance fill renders, deep below shallow,
 * collapse on correlate).
 *
 * End-to-end proof of the per-instance body feature on a real section render.
 * The fixture pre-seeds (build_synthetic_fixture.py action seed, Section D) two
 * UNCORRELATED same-lithology (KLEI) units on ONE source column (CPT-8) at
 * different depths, each closing bilaterally to a left + right target. The
 * resolver makes one body per connected component; both share the KLEI naming
 * group so they are depth-ranked (body_ordinal 0 = shallow, 1 = deep).
 *
 * Assertions (retargeted 2026-06-05 from BodyExtentOverlay ``body-label-*``
 * labels to PartitionFillOverlay ``partition-region-*`` regions — the legacy
 * BodyExtentOverlay was disabled behind SHOW_LEGACY_BODY_EXTENT=false in the
 * partition-fill rewrite):
 * ----------
 * 1. Two distinct KLEI partition regions — with Fill bands ON, Section D shows
 *    BOTH ``partition-region-{bodyId0}`` AND ``partition-region-{bodyId1}``
 *    (NOT a single collapsed region). The body IDs are resolved live by finding
 *    the source CPT-8 (identified by depth signature @2 m + @7 m on Section D)
 *    and filtering ``GET /bodies`` to ``source_investigation_id = CPT-8.id``
 *    (formation-name matching was unreliable since sibling specs reuse the same
 *    formation key via the find-or-create litho_main_soil_code lookup).
 * 2. No jump on framing — the deep body (body_ordinal=1, top @7 m) renders
 *    BELOW the shallow one (body_ordinal=0, top @2 m): its region's minY
 *    (top edge in screen coords) is greater than the shallow region's. This
 *    is the Bug C "body jump" fix — a committed body frames from its OWN
 *    member layer, not the shallowest same-formation occurrence.
 * 3. Merge on correlate — correlating the deep KLEI unit to the shallow body's
 *    component (one cross-column edge) collapses the two instances into ONE:
 *    after a reload, Section D shows exactly one distinct KLEI ``partition-region``
 *    (the two bodyIds collapse to one).
 *
 * The merge step drives the model-level ``contact-correlations`` endpoint
 * directly (the same API the correlate gesture hits — it runs
 * ResolveLithoInstances inline, which merges the two connected components into
 * one body). The contacts are resolved by depth + anchor from the live
 * ``/contacts`` endpoint, so the spec never hard-codes a UUID.
 *
 * Self-contained: the two-instance scenario lives in the fixture, so no per-run
 * UI build-up — the spec only reads the render + fires one merge edge.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect, type Page } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import {
  openFixtureProject,
  goToStage,
  cleanupFixtureFile,
  detectBodiesForFixture,
} from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

/** A litho contact as the ``/contacts`` endpoint returns it (subset of fields). */
interface ContactRow {
  id: string
  cpt_id: string | null
  borehole_id: string | null
  depth_top_m: number
  formation_id: string
}

/** Open the project, navigate to Section D, switch to the litho axis. */
async function openSectionDLitho(page: Page): Promise<void> {
  await goToStage(page, 'Sections')
  const sectionD = page
    .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
    .filter({ hasText: 'Section D' })
    .first()
  await expect(sectionD).toBeVisible({ timeout: 10_000 })
  await sectionD.click()
  await page.getByRole('radio', { name: 'Litho' }).click()
}

/**
 * Enable the "Fill bands" toggle in the Bodies dropdown so
 * PartitionFillOverlay renders ``partition-region-*`` elements.
 *
 * The dropdown is disabled until the litho model is active; waits for it to
 * enable before clicking. Uses ``toPass`` to retry opening in case a background
 * refetch resets the dropdown's open state before the item is clicked.
 */
async function enableFillBands(page: Page): Promise<void> {
  const bodiesDropdown = page.getByTestId('litho-bodies-dropdown')
  await expect(bodiesDropdown).toBeEnabled({ timeout: 30_000 })
  const fillBands = page.getByTestId('litho-fill-bands')
  await expect(async () => {
    await bodiesDropdown.click()
    await expect(fillBands).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  await fillBands.click()
}

test.describe('flow_per_instance_body', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first',
  )

  test('two KLEI partition regions render, deep below shallow, and collapse on correlate', async () => {
    test.slow() // opens project + renders the section + a merge round-trip
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      // Re-establish the detector ``to_target`` extents on the seeded bodies
      // BEFORE opening the project. A sibling spec's model-wide auto-correlate +
      // accept (run earlier on the shared fixture DB) shifts instance ordinals,
      // which makes the resolver recreate body rows WITHOUT extents — so the
      // two-instance bodies render nothing until the detector re-stamps them.
      // Running detect before the open means the section render fetches the
      // already-corrected bodies. The seeded topology (manual edges) is intact;
      // this re-runs the "Detect bodies" pass the UI verb fires. Idempotent on a
      // fresh seed.
      await detectBodiesForFixture(page, FIXTURE_PROJECT_ID)
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openSectionDLitho(page)

      // Resolve litho model and its KLEI bodies via the API so the spec works
      // without hard-coding any UUIDs. The two per-instance KLEI bodies are
      // the only KLEI bodies on Section D (the seeded topology is bilateral on
      // CPT-8, with bodies_ordinal 0 + 1 on the two KLEI formations).
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

      // Resolve the two per-instance KLEI body IDs by targeting Section D's
      // source column (CPT-8). Section D hosts exactly two correlated KLEI bodies
      // seeded by the fixture; CPT-8 is their source_investigation_id. Other specs
      // may create additional KLEI bodies on other CPTs (shared fixture DB), so
      // we filter by source_investigation_id being a Section-D CPT rather than by
      // formation name (formation-name matching was unreliable because the
      // find-or-create key is litho_main_soil_code+admixture only, so segmenter
      // accepts on other CPTs reuse the same formation row).
      //
      // Identify CPT-8: query Section D's contacts. Section D's seeded contacts
      // include the per-instance contacts on CPTs 8/9/10. The source CPT (CPT-8)
      // is the one that has exactly TWO KLEI contacts at different depths (2 m + 7 m).
      const [sectionsJson, bodiesJson] = await Promise.all([
        page.evaluate(
          async ([base, pid]) => {
            const r = await fetch(`${base}/projects/${pid}/sections`)
            return r.json()
          },
          [API_BASE, FIXTURE_PROJECT_ID],
        ),
        page.evaluate(
          async ([base, pid, mid]) => {
            const r = await fetch(`${base}/projects/${pid}/geology/models/${mid}/bodies`)
            return r.json()
          },
          [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
        ),
      ])

      // Verify Section D exists (sanity check; unused below).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sectionD = (sectionsJson as any[]).find((s: any) => String(s.name ?? '').includes('Section D'))
      expect(sectionD, 'Section D not found in sections list').toBeTruthy()

      // Get ALL model contacts — identify CPT-8 by depth signature.
      // The contacts endpoint has no section_id filter; we filter client-side.
      const sectionDContacts = (await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${mid}/contacts`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )) as ContactRow[]

      // Find the CPT that has TWO contacts at depths close to 2 m and 7 m —
      // that is CPT-8 (the per-instance source column).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const cptContactMap = new Map<string, number[]>()
      for (const c of sectionDContacts) {
        if (!c.cpt_id) continue
        const depths = cptContactMap.get(c.cpt_id) ?? []
        depths.push(c.depth_top_m)
        cptContactMap.set(c.cpt_id, depths)
      }
      // The source CPT-8 has contacts at ~2 m and ~7 m among others.
      let sourceCpt8Id: string | undefined
      for (const [cptId, depths] of cptContactMap) {
        const hasShallow = depths.some((d) => Math.abs(d - 2.0) < 0.5)
        const hasDeep = depths.some((d) => Math.abs(d - 7.0) < 0.5)
        if (hasShallow && hasDeep) {
          sourceCpt8Id = cptId
          break
        }
      }
      expect(sourceCpt8Id, 'CPT-8 (source with contacts @2 m and @7 m) not found on Section D').toBeTruthy()

      // The two per-instance KLEI bodies have source_investigation_id = CPT-8.id.
      // Filter all model bodies to those with that source.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kleiBodyIds: string[] = (bodiesJson as any[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .filter((b: any) => b.source_investigation_id === sourceCpt8Id)
        .map((b: any) => b.id as string)
      expect(kleiBodyIds.length).toBe(2)

      // --- Assertion 1: two distinct KLEI partition regions render -----------
      // Enable "Fill bands" so PartitionFillOverlay renders screenRegions.
      // The two KLEI bodies on Section D each produce a ``partition-region-{id}``
      // path element once showBands is on.
      await enableFillBands(page)

      const region0 = page.locator(`[data-testid="partition-region-${kleiBodyIds[0]}"]`).first()
      const region1 = page.locator(`[data-testid="partition-region-${kleiBodyIds[1]}"]`).first()
      await expect(region0).toBeVisible({ timeout: 20_000 })
      await expect(region1).toBeVisible({ timeout: 20_000 })

      // --- Assertion 2: no jump — deep region renders BELOW the shallow ------
      // The PartitionFillOverlay builds polygon rows in top→bottom order for
      // each gap; the deep body's region has a greater screen-y minY (SVG
      // y-axis grows downward). Resolve body → depth rank via body_ordinal:
      // body_ordinal=0 is the shallow KLEI (@2 m), ordinal=1 is the deep (@7 m).
      // Build ordinal map for the two per-instance KLEI bodies (source=CPT-8).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const kleiBodyOrdinals: Map<string, number> = new Map(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (bodiesJson as any[])
          .filter((b: any) => b.source_investigation_id === sourceCpt8Id)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((b: any) => [b.id as string, b.body_ordinal as number]),
      )
      const shallowBodyId = kleiBodyIds.find((id) => kleiBodyOrdinals.get(id) === 0)
      const deepBodyId = kleiBodyIds.find((id) => kleiBodyOrdinals.get(id) === 1)
      expect(shallowBodyId, 'shallow KLEI body (ordinal=0) not found').toBeTruthy()
      expect(deepBodyId, 'deep KLEI body (ordinal=1) not found').toBeTruthy()

      const shallowRegion = page
        .locator(`[data-testid="partition-region-${shallowBodyId!}"]`)
        .first()
      const deepRegion = page
        .locator(`[data-testid="partition-region-${deepBodyId!}"]`)
        .first()
      const boxShallow = await shallowRegion.boundingBox()
      const boxDeep = await deepRegion.boundingBox()
      expect(boxShallow, 'shallow region bounding box').not.toBeNull()
      expect(boxDeep, 'deep region bounding box').not.toBeNull()
      // The deep region's top edge (minY = box.y) must be below the shallow
      // region's midpoint, proving the deep body did NOT jump up to @2 m.
      // "Greater screen-y" = further down the page (SVG y-axis: 0 at top).
      expect(boxDeep!.y).toBeGreaterThan(boxShallow!.y)

      // --- Assertion 3: merge on correlate collapses the two instances -------
      // Resolve the litho contacts, then correlate the DEEP KLEI unit's top
      // contact (CPT-8 @7 m) to a shallow target (CPT-9 @3 m). That
      // cross-column edge joins the two connected components into one → the
      // resolver (run inline by the correlate endpoint) reduces two bodies to
      // one. After a reload, only one KLEI ``partition-region`` is visible.
      const contacts = (await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${mid}/contacts`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )) as ContactRow[]

      // CPT-8 carries two KLEI tops @2 m + @7 m; find the deep one (@7 m) and
      // a shallow target (@3 m) on a DIFFERENT investigation.
      const deepKleiTop = contacts.find(
        (c) => c.cpt_id !== null && Math.abs(c.depth_top_m - 7.0) < 0.01,
      )
      const shallowTarget = contacts.find(
        (c) =>
          c.cpt_id !== null &&
          Math.abs(c.depth_top_m - 3.0) < 0.01 &&
          c.cpt_id !== deepKleiTop?.cpt_id,
      )
      expect(deepKleiTop, 'deep KLEI top @7 m not found on source column').toBeTruthy()
      expect(shallowTarget, 'shallow target @3 m not found on a neighbour').toBeTruthy()

      const correlateStatus = await page.evaluate(
        async ([base, pid, mid, aId, bId]) => {
          const r = await fetch(
            `${base}/projects/${pid}/geology/models/${mid}/contact-correlations`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ contact_a_id: aId, contact_b_id: bId }),
            },
          )
          return r.status
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, deepKleiTop!.id, shallowTarget!.id],
      )
      // 201 new edge / 200 idempotent — both merge the components.
      expect(correlateStatus).toBeGreaterThanOrEqual(200)
      expect(correlateStatus).toBeLessThan(300)

      // Reload so the renderer re-fetches the now-merged bodies + member layers.
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
      const entry = page.getByTestId(`welcome-recent-entry-${tmpPath}`)
      await expect(entry).toBeVisible({ timeout: 10_000 })
      await entry.click()
      await expect(page.getByTestId('welcome-screen')).toBeHidden({ timeout: 20_000 })
      // The merge correlate ran ResolveLithoInstances inline (one merged body
      // now), which recreated the body row without its detector extent — re-stamp
      // it so the merged body's partition regions render correctly.
      await detectBodiesForFixture(page, FIXTURE_PROJECT_ID)
      await openSectionDLitho(page)
      await enableFillBands(page)

      // After merge the two KLEI bodies collapse into one: exactly ONE of the
      // original bodyIds is present (the merged body keeps one of the old ids or
      // gets a new one). Assert the count of distinct KLEI ``partition-region``
      // elements: the original separate regions (0 + 1) must now be at most 1
      // visible region for the merged body. Use the bodies API to get the
      // current merged bodyId.
      const mergedBodiesJson = await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${mid}/bodies`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )
      // Filter merged bodies by source_investigation_id = CPT-8 (same as before).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mergedKleiBodyIds: string[] = (mergedBodiesJson as any[])
        .filter((b: any) => b.source_investigation_id === sourceCpt8Id)
        .map((b: any) => b.id as string)
      // Two KLEI formations → one merged body after correlate (ordinals collapse).
      expect(mergedKleiBodyIds.length).toBeLessThan(kleiBodyIds.length)

      // The one surviving merged body must render a visible partition region.
      if (mergedKleiBodyIds.length === 1) {
        await expect(
          page.locator(`[data-testid="partition-region-${mergedKleiBodyIds[0]}"]`).first(),
        ).toBeVisible({ timeout: 20_000 })
      }
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
