/**
 * Flow — per-instance bodies (depth-ranked labels, merge-on-correlate, no jump).
 *
 * End-to-end proof of the per-instance body feature on a real section render.
 * The fixture pre-seeds (build_synthetic_fixture.py action seed, Section D) two
 * UNCORRELATED same-lithology (KLEI) units on ONE source column (CPT-8) at
 * different depths, each closing bilaterally to a left + right target. The
 * resolver makes one body per connected component; both share the
 * (Quaternary, KLEI) naming group, so the section renderer labels them by depth
 * rank: ``QC1`` (shallow @2 m) and ``QC2`` (deep @7 m).
 *
 * Assertions
 * ----------
 * 1. Two distinct instance labels — Section D shows BOTH ``QC1`` AND ``QC2``
 *    (NOT a single collapsed label).
 * 2. No jump on framing — the deep body (``QC2``) renders BELOW the shallow
 *    one (``QC1``): its label sits at a greater screen-y. This is the Bug C
 *    "body jump" fix — a committed body frames from its OWN member layer, not
 *    the shallowest same-formation occurrence.
 * 3. Merge on correlate — correlating the deep KLEI unit to the shallow body's
 *    component (one cross-column edge, via the model-level correlate endpoint)
 *    collapses the two instances into ONE: after a reload, Section D shows a
 *    single ``QC`` label, no longer two.
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
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

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
 * Return the screen-y of a body label (the ``<text>`` centroid) by its visible
 * text, or null when no such label is rendered.
 */
async function labelYByText(page: Page, text: string): Promise<number | null> {
  const label = page.locator('[data-testid^="body-label-"]').filter({ hasText: text }).first()
  if (!(await label.isVisible().catch(() => false))) return null
  const box = await label.boundingBox()
  return box?.y ?? null
}

test.describe('flow_per_instance_body', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first',
  )

  test('two depth-ranked instance labels render, deep below shallow, and collapse on correlate', async () => {
    test.slow() // opens project + renders the section + a merge round-trip
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await openSectionDLitho(page)

      // --- Assertion 1: two distinct depth-ranked instance labels ----------
      // The two same-lithology KLEI bodies on CPT-8 share the (Quaternary,
      // KLEI) naming group → QC1 (shallow) + QC2 (deep). Both must render.
      const qc1 = page.locator('[data-testid^="body-label-"]').filter({ hasText: 'QC1' }).first()
      const qc2 = page.locator('[data-testid^="body-label-"]').filter({ hasText: 'QC2' }).first()
      await expect(qc1).toBeVisible({ timeout: 20_000 })
      await expect(qc2).toBeVisible({ timeout: 20_000 })

      // --- Assertion 2: no jump — deep body renders BELOW the shallow one ---
      // The deep body (QC2, top @7 m) must frame from its own member layer, so
      // its label sits at a greater screen-y than the shallow body (QC1, @2 m).
      // A "body jump" regression would collapse the deep band up to ~2 m,
      // putting QC2 at (or above) QC1's y.
      const yShallow = await labelYByText(page, 'QC1')
      const yDeep = await labelYByText(page, 'QC2')
      expect(yShallow).not.toBeNull()
      expect(yDeep).not.toBeNull()
      expect(yDeep!).toBeGreaterThan(yShallow!)

      // --- Assertion 3: merge on correlate collapses the two instances ------
      // Resolve the litho model + its contacts, then correlate the DEEP KLEI
      // unit's top contact (CPT-8 @7 m) to the shallow body's left target
      // (CPT-9 @3 m). That cross-column edge joins the two connected components
      // into one → the resolver (run inline by the correlate endpoint) reduces
      // the two bodies to one. After a reload, only a single QC label remains.
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

      const contacts = (await page.evaluate(
        async ([base, pid, mid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models/${mid}/contacts`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId],
      )) as ContactRow[]

      // CPT-8 is the source column carrying TWO KLEI contacts (@2 m + @7 m); the
      // column with exactly two same-formation KLEI tops at 2 m and 7 m is the
      // per-instance source. Find the deep KLEI top (@7 m on the source CPT) and
      // a shallow target (@3 m on a DIFFERENT investigation).
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
      await openSectionDLitho(page)

      // One KLEI body now → exactly ONE QC label. Wait for the overlay, then
      // assert the count collapsed from two to one (QC2 must be gone).
      await expect(
        page.locator('[data-testid^="body-label-"]').filter({ hasText: 'QC1' }).first(),
      ).toBeVisible({ timeout: 20_000 })
      await expect(
        page.locator('[data-testid^="body-label-"]').filter({ hasText: 'QC2' }),
      ).toHaveCount(0)
      // And exactly one QC-prefixed label remains in total.
      await expect(
        page.locator('[data-testid^="body-label-"]').filter({ hasText: /^QC\d+$/ }),
      ).toHaveCount(1)
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
