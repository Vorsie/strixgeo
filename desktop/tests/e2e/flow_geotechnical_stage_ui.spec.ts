/**
 * Flow — Geotechnical stage UI surface (updated now that the stage is live).
 *
 * The Geotechnical stage shipped with F1–F5 (NAD colour map, geotech data
 * layer, axis generalisation, "Subdivide all bodies" verb, and the NAD
 * inspector roster).  The old EmptyState placeholder is gone; the stage is now
 * the 3-D geotech room (``GeotechnicalCanvas`` → ``Geology3DViewer`` once
 * solids are built, a guided Build hint before that) plus
 * ``GeotechnicalInspector`` (the NAD unit roster).  The 2-D geotech band view
 * moved to the Sections stage axis picker (owner ruling 2026-08-26).
 *
 * Architecture note — toolbar
 * ---------------------------
 * The Geotech stage has a null toolbar (``GeotechnicalToolbar``).  The
 * "Subdivide all bodies" verb lives in ``SectionsToolbar`` (the Sections
 * stage) when ``sectionModelAxis === 'geotechnical'``.  This spec only
 * verifies the Geotech stage surface itself; the full subdivision flow
 * (Sections → select → geotech axis → click → toast → NAD rows) is covered
 * by the companion spec ``flow_geotech_subdivide_all_bodies``.
 *
 * Assertions
 * ----------
 * A. Stage is reachable from the spine and does not crash.
 * B. ``GeotechnicalInspector`` mounts with the "Geotech units" heading — and
 *    shows either the empty-state prompt or soil groups depending on whether
 *    a prior run has already subdivided.  The heading is the stable invariant;
 *    the empty/populated branch is run-order-dependent (the companion spec
 *    ``flow_geotech_subdivide_all_bodies`` creates units that survive into
 *    this spec when both run in the same suite pass).
 * C. The stage body renders without crashing (the workflow-stage navigation
 *    survives), whichever of the 3-D viewer / Build hint the DB state yields.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_geotechnical_stage_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('stage is reachable and shows the NAD inspector', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // A — Navigate to the Geotechnical stage (spine label: 'Geotech').
      // The canvas is 3-D only: with the fixture's litho model but no built
      // geotech solids it shows the guided Build hint, never a section view.
      await goToStage(page, 'Geotech')

      // B — Inspector mounts with the "Geotech units" heading.  The heading
      // is always present (GeotechnicalInspector renders it unconditionally);
      // whether the inspector shows the empty-state or unit rows depends on
      // whether a prior suite run has already subdivided (the companion spec
      // flow_geotech_subdivide_all_bodies leaves units in the DB).  Assert the
      // stable invariant (heading) only — the subdivide-then-assert flow is
      // the companion spec's job.
      await expect(page.getByText('Geotech units', { exact: true })).toBeVisible({ timeout: 15_000 })

      // The inspector renders one of two states (empty or populated) — either
      // is valid.  Confirm at least one is present so the inspector isn't just
      // a blank panel.
      const emptyState = page.getByText('No geotech units yet')
      // The roster is soil ▸ litho body ▸ packing body (owner ruling 2026-08-31);
      // a populated pane shows at least one soil group header.
      const soilGroup = page.locator('[data-testid^="geotech-soil-header-"]').first()
      await expect(emptyState.or(soilGroup)).toBeVisible({ timeout: 10_000 })

      // C — The stage body renders (not a white screen): the workflow-stage
      // navigation is still mounted.  Which canvas branch shows (3-D viewer vs
      // Build hint) depends on whether a prior spec built solids, so the nav is
      // the stable invariant here.
      await expect(
        page.getByRole('navigation', { name: 'Workflow stages' }),
      ).toBeVisible({ timeout: 5_000 })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
