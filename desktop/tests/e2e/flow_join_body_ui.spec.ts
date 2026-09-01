/**
 * Flow — the "Join with…" verb + its Disjoin (debt #278, owner ruling 2026-08-31).
 *
 * Drives the whole gesture on the GEOTECH axis (Join is geotech-only — the owner
 * would not use it on litho): right-click body A → "Join with…" (ARMS) → the hint
 * chip appears → left-click body B's region → success toast → the two bodies
 * become ONE after the debounced recompute → re-open the menu → "Disjoin …" is now
 * offered → click it → the union is lifted and the bodies may split again.
 *
 * WHY SAME-SOIL SAME-CLASS, the OPPOSITE of the Separate spec's cross-soil choice:
 * a Join can only make ONE mass, so the two targets must be the SAME packing class
 * (same NAD-coloured fill). A cross-soil / cross-class pick is refused 422 by the
 * write guard — exactly what this verb must NOT commit — so the spec picks two
 * regions of the SAME fill colour that resolve to DIFFERENT bodies (two disjoint
 * same-class geotech bodies). Those never auto-weld (they are geometrically
 * separate), so the engineer's "these ARE the same body" is a legal, distinct join.
 *
 * WHY the gesture is wrapped in ``toPass``: the project-open + post-join identity
 * recompute is debounced and can land mid-gesture. The retry re-resolves fresh
 * regions and re-drives each attempt, so whenever the recompute fires the next
 * attempt runs against stable ids. Join is idempotent server-side (a duplicate
 * pair answers 200), so a retry is safe.
 *
 * Dead ends this spec deliberately avoids (memory + flow_separate_body_ui):
 *   * ``body-context-menu`` is DUPLICATED by the chip menu — select via the
 *     ITEM testids (``body-ctx-*``) only, never the container.
 *   * waiting on ``cursor: context-menu`` no longer proves the body list landed
 *     (the stats jump gives that cursor too) — so RETRY the right-click until a
 *     body-menu ITEM (``body-ctx-join-body``) is visible.
 *   * the SVG-portalled menu fails Playwright's actionability check — DISPATCH
 *     the click/contextmenu events rather than ``.click()``.
 *
 * FIXTURE: this spec needs TWO disjoint geotech bodies of the SAME NAD class on one
 * section after ``subdivide-all-bodies`` — two same-fill regions with distinct
 * ``partition-region-<bodyId>`` testids. Section F is seeded exactly for this: two
 * disjoint KLEI bodies (shallow + deep, like the per-instance topology) on CPTs
 * 14/15/16, whose UNIFORM CLAY qc series classifies both to KLEI NAD class 22 —
 * same class, same fill colour, a legal Join. (Section D's KLEI bodies stay
 * series-less for flow_per_instance_body, so they never get a class and cannot be
 * the pair.) See ``build_synthetic_fixture.py`` → ``_SAME_CLASS_PAIR_CPT_INDICES``.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set).
 *
 * NOTE: this flow MUTATES the fixture by creating a geotechnical model + NAD
 * formation rows (via subdivide-all-bodies). ``build_synthetic_fixture.py``'s
 * ``_cleanup_litho_state`` removes non-fixture models on re-run, so re-seed
 * before running the full suite from scratch.
 */

import { test, expect, type Page, type Locator } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

/** Run the model-wide geotech subdivision so the geotech axis has NAD bodies. */
async function subdivideAllBodies(page: Page): Promise<void> {
  const modelsJson = await page.evaluate(
    async ([base, pid]) => {
      const r = await fetch(`${base}/projects/${pid}/geology/models`)
      return r.json()
    },
    [API_BASE, FIXTURE_PROJECT_ID] as const,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const litho = (modelsJson as any[]).find((m: any) => m.kind === 'lithostratigraphic')
  expect(litho, 'fixture must have a lithostratigraphic model').toBeTruthy()
  const lithoId: string = litho.id
  const result = await page.evaluate(
    async ([base, pid, mid]) => {
      const r = await fetch(
        `${base}/projects/${pid}/geology/models/${mid}/geotech/subdivide-all-bodies`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ litho_model_id: mid }),
        },
      )
      return { status: r.status, body: await r.json() }
    },
    [API_BASE, FIXTURE_PROJECT_ID, lithoId] as const,
  )
  expect(
    result.status,
    `subdivide-all-bodies returned HTTP ${result.status}: ${JSON.stringify(result.body)}`,
  ).toBe(200)
}

/** Open Section F (two disjoint same-class KLEI bodies), switch to the GEOTECH axis. */
async function openGeotechSection(page: Page): Promise<void> {
  await goToStage(page, 'Sections')
  const sectionRow = page
    .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
    .filter({ hasText: 'Section F' })
    .first()
  await expect(sectionRow).toBeVisible({ timeout: 10_000 })
  await sectionRow.click()
  const axisGeotech = page.getByTestId('axis-geotech')
  await expect(axisGeotech).toBeEnabled({ timeout: 10_000 })
  await axisGeotech.click()
  await enableGeotechFill(page)
}

/**
 * Turn the geotech "Show fill" toggle ON so ``PartitionFillOverlay`` renders the
 * NAD partition as ``partition-region-*`` — the geotech-axis peer of the litho
 * ``enableFillBands``. ``geotechFillStore`` defaults OFF (owner 2026-08-15: the
 * fill is an explicit press, never auto-on) and resets on reload, so without this
 * the geotech axis paints no body regions and the pair-finder has nothing to find.
 * The toggle lives in the Display dropdown (``geotech-display-menu`` ->
 * ``geotech-toggle-fill``); its label reads "Show fill" when OFF, "Hide fill" ON.
 */
async function enableGeotechFill(page: Page): Promise<void> {
  const displayMenu = page.getByTestId('geotech-display-menu')
  await expect(displayMenu).toBeEnabled({ timeout: 30_000 })
  const toggleFill = page.getByTestId('geotech-toggle-fill')
  await expect(async () => {
    await displayMenu.click()
    await expect(toggleFill).toBeVisible({ timeout: 2_000 })
  }).toPass({ timeout: 30_000 })
  const currentLabel = await toggleFill.textContent().catch(() => '')
  if (currentLabel?.includes('Show fill')) {
    await toggleFill.click()
  } else {
    // Already ON — close by re-clicking the trigger, never Escape (SectionPanel's
    // document Escape handler would deselect the section).
    await displayMenu.click()
  }
}

/** The body-region hit paths, as ``{ testid, fill }`` — filters strokes + fallback paint. */
async function bodyRegions(page: Page): Promise<{ testid: string; fill: string }[]> {
  return page.locator('[data-testid^="partition-region-"]').evaluateAll(els =>
    els
      .map(el => ({
        testid: el.getAttribute('data-testid') ?? '',
        fill: el.getAttribute('fill') ?? '',
      }))
      .filter(
        r =>
          r.testid.startsWith('partition-region-') &&
          !r.testid.includes('-stroke-') &&
          !r.testid.endsWith('-nobody'),
      ),
  )
}

/**
 * Two body regions of the SAME fill colour (same NAD class) but DIFFERENT body id
 * — two disjoint same-class bodies, the legal Join target. Retried until such a
 * pair is on screen (the roster settling). Returns them as locators keyed by their
 * live testid.
 */
async function twoSameClassRegions(page: Page): Promise<{ a: Locator; b: Locator }> {
  let idA = ''
  let idB = ''
  await expect(async () => {
    const regions = await bodyRegions(page)
    // Group distinct body testids by fill colour; a colour with ≥2 distinct
    // bodies is a same-class disjoint pair.
    const byColour = new Map<string, string[]>()
    for (const r of regions) {
      const ids = byColour.get(r.fill) ?? []
      if (!ids.includes(r.testid)) ids.push(r.testid)
      byColour.set(r.fill, ids)
    }
    const pair = [...byColour.values()].find(ids => ids.length >= 2)
    expect(pair, 'need two same-class (same-colour) regions of DIFFERENT bodies').toBeTruthy()
    idA = pair![0]
    idB = pair![1]
  }).toPass({ timeout: 30_000 })
  return {
    a: page.locator(`[data-testid="${idA}"]`).first(),
    b: page.locator(`[data-testid="${idB}"]`).first(),
  }
}

/**
 * Right-click ``region`` and wait until the BODY menu's "Join with…" item is
 * visible — the only signal that the body list has landed (the stats menu offers
 * no such item, and ``bodiesLoaded`` withholds the body menu across a recompute).
 */
async function openBodyMenuOn(page: Page, region: Locator): Promise<void> {
  await expect(region).toBeVisible({ timeout: 30_000 })
  await expect(async () => {
    await region.dispatchEvent('contextmenu', {
      button: 2,
      clientX: 360,
      clientY: 360,
      bubbles: true,
    })
    await expect(page.getByTestId('body-ctx-join-body')).toBeVisible({ timeout: 1_000 })
  }).toPass({ timeout: 30_000 })
}

test.describe('flow_join_body_ui', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run build_synthetic_fixture.py first',
  )

  test('Join two same-class bodies, then Disjoin them', async () => {
    test.slow()
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      // Build the geotech model, then re-open so the shell picks it up (React
      // state for the geotech model only refreshes on project open).
      await subdivideAllBodies(page)
      await page.reload()
      await page.waitForLoadState('domcontentloaded')
      await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      await openGeotechSection(page)

      // ARM + COMMIT, retried so a debounced recompute landing mid-gesture is
      // absorbed: each attempt re-resolves a fresh same-class pair (ids can shift
      // on a merge), arms body A, and clicks body B. Same class means the pick is
      // a legal join; the retry only covers the timing. Join is idempotent, so a
      // duplicate commit is a harmless 200.
      await expect(async () => {
        const { a: bodyA, b: bodyB } = await twoSameClassRegions(page)
        await openBodyMenuOn(page, bodyA)
        await page.getByTestId('body-ctx-join-body').dispatchEvent('click')
        await expect(page.getByTestId('join-arm-hint')).toBeVisible({ timeout: 3_000 })
        await bodyB.dispatchEvent('click', { bubbles: true })
        await expect(page.getByText('Bodies joined', { exact: false })).toBeVisible({
          timeout: 3_000,
        })
      }).toPass({ timeout: 90_000 })

      // The arm clears on commit.
      await expect(page.getByTestId('join-arm-hint')).toBeHidden({ timeout: 10_000 })

      // The union is durable: a body's menu now offers to Disjoin. Retried because
      // the post-commit recompute re-shuffles the region ids (and merged the two
      // bodies into one — the ONE-body outcome).
      await expect(async () => {
        const regions = await bodyRegions(page)
        expect(regions.length, 'the section must still render body regions').toBeGreaterThan(0)
        await openBodyMenuOn(page, page.locator(`[data-testid="${regions[0].testid}"]`).first())
        await expect(page.locator('[data-testid^="body-ctx-disjoin-body-"]').first()).toBeVisible({
          timeout: 1_500,
        })
      }).toPass({ timeout: 60_000 })

      // DISJOIN: lift the union, then confirm the Disjoin option is gone (the two
      // bodies may split apart again).
      await page.locator('[data-testid^="body-ctx-disjoin-body-"]').first().dispatchEvent('click')
      await expect(page.getByText('Join lifted', { exact: false })).toBeVisible({
        timeout: 5_000,
      })
      await expect(async () => {
        const regions = await bodyRegions(page)
        expect(regions.length).toBeGreaterThan(0)
        await openBodyMenuOn(page, page.locator(`[data-testid="${regions[0].testid}"]`).first())
        await expect(page.locator('[data-testid^="body-ctx-disjoin-body-"]')).toHaveCount(0, {
          timeout: 1_500,
        })
      }).toPass({ timeout: 60_000 })
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
