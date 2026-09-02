/**
 * Flow — Parameters per-unit statistics + the FIRST Cesium pixel golden.
 *
 * WHY (owner ruling 2026-08-27: "if it can be automated, automate it"):
 * the unit suite runs under jsdom, which has no WebGL — the fence cutout and
 * every Cesium surface had NEVER rendered in any automated test; the owner's
 * eyes were the only gate.  This spec drives the real Electron renderer
 * (SwiftShader renders WebGL headless) end-to-end:
 *
 *   1. Re-seed the fixture (visual_golden.reseedFixture) so the scene is the
 *      deterministic seeded baseline regardless of which specs ran before —
 *      a pixel golden cannot tolerate the fixture mutations earlier specs
 *      legitimately leave behind.
 *   2. Resolve the target NAD unit AND its litho home over the API (ids are
 *      uuid7-minted per seed — never hard-coded; the litho chain rides the
 *      Slice-A ``parent_litho_layer_id`` FK).
 *   3. Parameters stage → Per-unit tab → the BODY TREE renders (owner ruling
 *      2026-08-27: litho unit ▸ litho body ▸ NAD class ▸ geotech body — the
 *      pane lists litho units at the top level, geotech units are jump-only).
 *   4. Walk the tree: expand the litho unit, expand the litho body, the class
 *      row appears. The leaf-absorb contract: a class row over ≥2 geotech
 *      bodies carries an expander (expanding reveals one row per body); a
 *      single-body class row IS the leaf and carries no expander. The fixture
 *      decides which branch is real — both are asserted honestly.
 *   5. Class row click → the statistics canvas: population line
 *      (``unit-stats-population``) + at least one distribution panel.
 *   6. The fence cutout mounts its Cesium scene (walls exist because the
 *      fixture seeds approved geotech edges), the camera flight settles, and
 *      ONE screenshot is compared against a stored golden
 *      (``toMatchSnapshot`` on a single ``locator.screenshot()`` — NOT
 *      ``toHaveScreenshot``, whose stabilise-first loop waits for two
 *      identical consecutive frames and times out against a continuously
 *      rendering Cesium canvas; tolerance rationale in
 *      ``helpers/visual_golden.WEBGL_MAX_DIFF_PIXEL_RATIO``).
 *
 * External network is BLOCKED for the whole session (the basemap lid
 * textures itself from the Geopunt WMS when online — see
 * ``blockExternalNetwork``), so the golden renders the offline scene in
 * every environment.
 *
 * First run: Playwright writes the missing golden and FAILS the test — that
 * failure is the red run; inspect the written image, then re-run green.
 * Re-blessing after an intentional visual change: see docs/e2e-fixtures.md.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set), ``uv`` on PATH (re-seed).
 */

import { test, expect } from '@playwright/test'
import { launchApp, pinWindowSize } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'
import {
  CESIUM_SETTLE_MS,
  WEBGL_MAX_DIFF_PIXEL_RATIO,
  blockExternalNetwork,
  reseedFixture,
  resolveFenceTargetUnit,
} from './helpers/visual_golden'
import { closeAppOrKill } from './helpers/golden_teardown'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''

test.describe('flow_unit_statistics', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('unit roster → statistics canvas → fence cutout golden', async () => {
    // Re-seed (the in-spec fixture rebuild alone streams for minutes) +
    // shell open + Cesium mount + camera flight — 300 s proved too tight
    // (the first bless run timed out with the reseed inside the budget).
    test.setTimeout(600_000)

    // 1. Deterministic baseline, whatever ran before this spec.
    reseedFixture(FIXTURE_PROJECT_ID)

    // 2. Which NAD unit the golden pins (ids are re-minted per seed).
    const target = await resolveFenceTargetUnit(FIXTURE_PROJECT_ID)

    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      // Pixel goldens need a pinned window — Electron restores persisted
      // bounds otherwise and the element sizes drift run to run.
      await pinWindowSize(app)
      // Before any stage that mounts Cesium, so the WMS lid fetch can never
      // reach the network.
      await blockExternalNetwork(page)

      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)
      await goToStage(page, 'Parameters')
      await page.getByTestId('parameters-tab-per-unit').click()
      await expect(page.getByTestId('parameters-panel-per-unit')).toBeVisible()

      // 3. The body tree renders — litho units at the top level (the pane
      //    never lists geotech units since the body-tree redesign).
      const list = page.getByTestId('parameters-unit-list')
      await expect(list).toBeVisible()
      const options = list.getByRole('option')
      // Auto-wait for the first row: the list is visible before the litho
      // formations land, so a bare count() read too early sees zero rows.
      await expect(options.first(), 'the tree must render at least one row').toBeVisible({
        timeout: 15_000,
      })
      expect(await options.count(), 'the tree must render at least one row').toBeGreaterThan(0)

      // 4. Walk the resolved chain to the depth the LEAF-ABSORB rule leaves
      //    standing. Row testids carry scopeKey()'s format — the tree's own
      //    addressing scheme, stable across seeds because every component is
      //    re-resolved over the API each run.
      //
      //    The depth is DERIVED (resolveFenceTargetUnit.deepestKind) from the
      //    sibling counts, never read off the DOM: "a level with exactly one
      //    child renders no expander and no child row" collapses a fully
      //    single-child chain all the way up to the litho unit — which is
      //    exactly what the seeded fixture yields, and how a fixed four-level
      //    walk failed against a CORRECT tree.
      const unitKey = `litho-unit:${target.lithoUnitId}`
      const lithoBodyKey = `litho-body:${target.lithoUnitId}:${target.lithoBodyId}`
      const classKey = `geotech-class:${target.lithoUnitId}:${target.lithoBodyId}:${target.nadClass}`
      const chain = [unitKey, lithoBodyKey, classKey]
      const deepest = { 'litho-unit': 0, 'litho-body': 1, 'geotech-class': 2 }[target.deepestKind]

      for (let level = 0; level < chain.length; level += 1) {
        const row = page.getByTestId(`parameters-node-${chain[level]}`)
        if (level > deepest) {
          // Absorbed into its parent — the row must NOT exist.
          await expect(
            row,
            `level ${level} must be absorbed (single-leaf-child rule)`,
          ).toHaveCount(0)
          break
        }
        await expect(row, `level ${level} of the resolved chain must render`).toBeVisible()
        if (level < deepest) {
          const expander = page.getByTestId(`parameters-node-expander-${chain[level]}`)
          await expect(expander).toBeVisible()
          // A single-class litho body is DEFAULT-OPEN (owner ruling 2026-09-02);
          // clicking its expander would collapse it. Open only what is closed.
          const nextRow = page.getByTestId(`parameters-node-${chain[level + 1]}`)
          if (!(await nextRow.isVisible())) await expander.click()
        }
      }

      // The deepest standing row: a leaf unless it is a class row over ≥2
      // geotech bodies, in which case it expands into one row per body.
      const deepestKey = chain[deepest]
      const deepestRow = page.getByTestId(`parameters-node-${deepestKey}`)
      const deepestExpander = page.getByTestId(`parameters-node-expander-${deepestKey}`)
      if (target.deepestKind === 'geotech-class' && target.classBodyCount > 1) {
        await expect(deepestExpander).toBeVisible()
        await deepestExpander.click()
        // Only this chain is expanded, so every visible geotech-body row
        // belongs to this class.
        const bodyRows = list.locator('[data-testid^="parameters-node-geotech-body:"]')
        await expect(bodyRows.first()).toBeVisible()
        expect(await bodyRows.count(), 'one row per geotech body').toBe(target.classBodyCount)
      } else {
        await expect(deepestExpander, 'the deepest standing row is a leaf').toHaveCount(0)
      }

      // 5. The deepest standing scope drives the statistics canvas (also the
      //    deterministic scope the golden pins — a geotech-body scope would
      //    tie the golden to whichever body sorted first).
      await deepestRow.click()
      await expect(page.getByTestId('parameters-unit-canvas')).toBeVisible()
      await expect(page.getByTestId('unit-stats-population')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('unit-stats-empty')).toHaveCount(0)
      expect(
        await page.locator('[data-testid^="unit-stats-row-"]').count(),
        'at least one distribution panel must render',
      ).toBeGreaterThan(0)

      // 6. The fence cutout — the Cesium branch, never the empty hint (the
      //    fixture guarantees approved edges → walls for this unit).
      const cutout = page.getByTestId('unit-fence-cutout')
      await cutout.scrollIntoViewIfNeeded()
      await expect(cutout).toBeVisible()
      await expect(page.getByTestId('unit-fence-empty')).toHaveCount(0)
      // Cesium needs real frames: the canvas appears once the viewer boots
      // (lazy chunk + fence assembly + WebGL context — generous window).
      await expect(cutout.locator('canvas')).toBeVisible({ timeout: 60_000 })
      await expect(page.getByTestId('unit-fence-reset-camera')).toBeVisible()

      // Camera flight (1.5 s) + SwiftShader settle before pinning pixels.
      await page.waitForTimeout(CESIUM_SETTLE_MS)

      // Pin the SCENE, not the card around it. Screenshotting the whole
      // ``unit-fence-cutout`` element included its heading and blurb, and the
      // first full-suite run failed on a diff that was pure edge noise — every
      // glyph outline and the button border highlighted, interiors identical,
      // i.e. the element rendered a sub-pixel off. Text anti-aliasing is not
      // what this golden is for; the canvas is.
      //
      // Single-shot compare: Cesium renders continuously, so toHaveScreenshot's
      // stabilise-first loop (two identical consecutive frames) never converges
      // and times the test out. One settled frame within the WebGL tolerance is
      // the contract.
      const scene = cutout.locator('canvas')
      expect(await scene.screenshot()).toMatchSnapshot('unit-fence-cutout.png', {
        maxDiffPixelRatio: WEBGL_MAX_DIFF_PIXEL_RATIO,
      })
    } finally {
      // Bounded: an unbounded teardown burns the whole test budget and reports
      // as a timeout at the last body line (see golden_teardown).
      await closeAppOrKill(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
