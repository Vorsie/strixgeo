/**
 * flow_section_shots — VISUAL close-the-loop for the owner's engine rulings (walk22d, 2026-09-07).
 *
 * The owner ruled four section-fill behaviours (R2..R5) against HIS worked-example project. The unit
 * pins (``partitionFillV2/ownerRulings.test.ts``) check the geometry numerically; this spec captures
 * the actual RENDER of each named section on the litho axis so the change can be diffed by EYE against
 * the owner's screenshots (10:00..10:13): TS3 the sand pocket, TS4 the clay under the shallow TD, CS2
 * the sand/silt seam.
 *
 * It opens the bundled worked example through the app's own open-from-recents path (mirroring
 * ``walker.spec.ts`` → ``openWorkedExample``), goes to the Sections stage, and for each name in
 * ``SECTION_SHOTS`` (env, comma-separated; default the three ruling sections) selects the section row,
 * switches to the LITHO axis, waits for the fill, and saves the full section canvas to
 * ``tests/e2e/_results/section_shots/<name>.png``.
 *
 * Run offline via ``.\scripts\run-e2e.ps1 flow_section_shots`` (the worked example is bundled at
 * ``resources/sample/worked-example.strix``; the open triggers a /restore into the integration DB).
 */
import { test, expect, type Page } from '@playwright/test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { launchApp, closeApp } from './helpers/electron_launch'
import { goToStage } from './helpers/project_open'

const SECTION_SHOTS = (process.env.SECTION_SHOTS ?? 'Tie-section 3,Tie-section 4,Cross-section 2')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

const RESULTS_DIR = path.resolve(__dirname, '_results', 'section_shots')
// ``SECTION_SHOTS_FILE`` (env) points the capture at another .strix -- the owner's live worked
// example carries sections the bundled sample does not (Tie-section 3 / 4, 2026-09-07).
// ``SECTION_SHOTS_ZOOM`` (env): zoom the shot on one gap so a human can read it. Either two test
// names joined by ``|`` (``GEO-19/081-S5|GEO-61/2891-C``) or ``gap:<n>`` (the n-th gap, 0-based, in
// along-section order). The view is wheel-zoomed, cursor-anchored between the two columns.
const ZOOM_SPEC = process.env.SECTION_SHOTS_ZOOM ?? ''
// ``SECTION_SHOTS_VEX`` (env): vertical exaggeration for the shot (e.g. ``5``), applied through the
// header slider, which maps 0..100 onto log10(VEX_MIN..VEX_MAX) (SectionHeader.tsx).
const VEX = Number(process.env.SECTION_SHOTS_VEX ?? '')
// ``SECTION_SHOTS_SPACING`` (env): column spacing through the header slider; ``max`` spreads the
// columns as far as the app allows so a narrow gap becomes readable, else a slider value 0..100.
const SPACING = process.env.SECTION_SHOTS_SPACING ?? ''
// ``SECTION_SHOTS_PX_PER_M`` (env): keep zooming (cursor-anchored on the gap's ground level) until
// the header's vertical scale reads at least this many px per metre, so a thin shallow zone is readable.
const PX_PER_M = Number(process.env.SECTION_SHOTS_PX_PER_M ?? '')
// ``SECTION_SHOTS_LEVEL`` (env, mTAW): anchor the zoom at this level instead of the columns' ground,
// read off the level axis tick labels, so a deep zone (a sub-TD wedge) can be framed.
const LEVEL = Number(process.env.SECTION_SHOTS_LEVEL ?? '')
// ``SECTION_SHOTS_AXIS`` (env): which model axis to render — ``Litho`` (default) or ``Geotech``. The
// geotech axis is where the class-change seam ruling (2026-09-08) is seen, so the capture must be able
// to click the Geotech radio instead of the Litho one.
const AXIS = (process.env.SECTION_SHOTS_AXIS ?? 'Litho').trim() === 'Geotech' ? 'Geotech' : 'Litho'
const VEX_MIN = 0.5
const VEX_MAX = 50.0
const SAMPLE = process.env.SECTION_SHOTS_FILE
  ? path.resolve(process.env.SECTION_SHOTS_FILE)
  : path.resolve(__dirname, '..', '..', 'resources', 'sample', 'worked-example.strix')

/**
 * Open the bundled worked example through the welcome screen's recents path (a copy to a temp file, so
 * the open triggers a /restore). Byte-for-byte the flow ``walker.spec.ts`` uses.
 */
async function openWorkedExample(page: Page, tmpPath: string): Promise<void> {
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
  await page.evaluate(
    async ([filePath, name]) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (window as any).electron.addRecentProject(filePath, name)
    },
    [tmpPath, 'StrixGeo worked example'] as const,
  )
  await page.reload()
  await page.waitForLoadState('domcontentloaded')
  await expect(page.getByTestId('welcome-screen')).toBeVisible({ timeout: 15_000 })
  const entry = page.getByTestId(`welcome-recent-entry-${tmpPath}`)
  await expect(entry).toBeVisible({ timeout: 10_000 })
  await entry.click()
  await expect(page.getByTestId('welcome-screen')).toBeHidden({ timeout: 90_000 })
  await expect(page.getByRole('navigation', { name: 'Workflow stages' })).toBeVisible({ timeout: 90_000 })
}

/** Screen boxes of the section's columns (the ``column-hit-<name>`` glyph hit areas), left to right. */
async function columnBoxes(page: Page): Promise<{ name: string; x: number; y: number; w: number; h: number }[]> {
  const hits = page.locator('[data-testid^="column-hit-"]')
  const n = await hits.count()
  const out: { name: string; x: number; y: number; w: number; h: number }[] = []
  for (let i = 0; i < n; i++) {
    const h = hits.nth(i)
    const box = await h.boundingBox().catch(() => null)
    const id = (await h.getAttribute('data-testid')) ?? ''
    if (box) out.push({ name: id.replace(/^column-hit-/, ''), x: box.x, y: box.y, w: box.width, h: box.height })
  }
  return out.sort((a, b) => a.x - b.x)
}

/** The vertical scale the header states (``V: 8.27 px/m``), or 0 when it is not on screen. */
async function verticalPxPerM(page: Page): Promise<number> {
  const text = await page.getByTestId('section-scale-v').textContent().catch(() => null)
  const m = text?.match(/V:\s*([0-9.]+)/)
  return m ? Number(m[1]) : 0
}

/** Screen y of a level (mTAW), interpolated from two numeric tick labels of the level axis. */
async function yOfLevel(
  page: Page,
  svgBox: { x: number; y: number; width: number; height: number },
  level: number,
): Promise<number | null> {
  const texts = page.locator('svg text')
  const n = await texts.count()
  const ticks: { v: number; y: number }[] = []
  for (let i = 0; i < n; i++) {
    const t = texts.nth(i)
    const raw = ((await t.textContent().catch(() => '')) ?? '').trim()
    if (!/^-?\d+(\.\d+)?$/.test(raw)) continue
    const box = await t.boundingBox().catch(() => null)
    // Only the level axis strip at the far left: the CPT headers print bare numbers too (2, 10).
    if (!box || box.x + box.width > svgBox.x + 90) continue
    // The along-axis origin label sits in the same strip at the very bottom: not a level tick.
    if (box.y > svgBox.y + svgBox.height - 60) continue
    ticks.push({ v: Number(raw), y: box.y + box.height / 2 })
  }
  if (ticks.length < 2) return null
  ticks.sort((a, b) => a.v - b.v)
  const lo = ticks[0]
  const hi = ticks[ticks.length - 1]
  if (hi.v === lo.v) return null
  return lo.y + ((level - lo.v) * (hi.y - lo.y)) / (hi.v - lo.v)
}

/** Ground level (screen y) at a column: the top of its highest accepted litho band, else null. */
async function groundYAt(page: Page, colX: number): Promise<number | null> {
  const bands = page.locator('[data-testid^="per-column-litho-band-"]:not([data-testid^="per-column-litho-band-hit-"])')
  const n = await bands.count()
  let best: number | null = null
  for (let i = 0; i < n; i++) {
    const box = await bands.nth(i).boundingBox().catch(() => null)
    if (!box) continue
    const cx = box.x + box.width / 2
    if (Math.abs(cx - colX) > 14) continue
    if (best === null || box.y < best) best = box.y
  }
  return best
}

/**
 * Wheel-zoom the open section until the two columns of the requested gap span
 * about half the canvas width. The column hit rects span the whole plot height,
 * so the vertical anchor comes from the ground level of the two columns (the top
 * of their highest litho band), kept just below the top of the frame so the
 * shallow zone stays in view; the wheel zoom is cursor-anchored, so that world
 * point stays put while the view grows around it.
 */
async function zoomOnGap(page: Page, svg: ReturnType<Page['locator']>, spec: string): Promise<void> {
  const svgBox = await svg.boundingBox().catch(() => null)
  if (!svgBox) return
  type Box = { x: number; y: number; w: number; h: number }
  const pick = async (): Promise<[Box, Box] | null> => {
    const cols = await columnBoxes(page)
    if (spec.startsWith('gap:')) {
      const g = Number(spec.slice(4))
      return cols[g] && cols[g + 1] ? [cols[g], cols[g + 1]] : null
    }
    const [a, b] = spec.split('|')
    const ca = cols.find(c => c.name === a)
    const cb = cols.find(c => c.name === b)
    return ca && cb ? (ca.x <= cb.x ? [ca, cb] : [cb, ca]) : null
  }
  // A dense section (CS1 = 24 columns) needs more, bigger wheel steps to spread one gap to ~half the
  // canvas than a sparse one (CS2 = 5 columns); 18 x -240 was not enough and left CS1 un-zoomed.
  for (let i = 0; i < 28; i++) {
    const pair = await pick()
    if (!pair) {
      console.log(`[section-shots] zoom target "${spec}" not found among the columns`)
      return
    }
    const [l, r] = pair
    const span = r.x + r.w - l.x
    const wideEnough = span >= svgBox.width * 0.45
    const tallEnough = !(Number.isFinite(PX_PER_M) && PX_PER_M > 0) || (await verticalPxPerM(page)) >= PX_PER_M
    if (wideEnough && tallEnough) return
    const lx = l.x + l.w / 2
    const rx = r.x + r.w / 2
    const gl = await groundYAt(page, lx)
    const gr = await groundYAt(page, rx)
    // Anchor on the SHALLOWER (higher-elevation) of the two collars — the smaller screen y — so a
    // SHORT facing borehole (its collar far below the tall test, e.g. CS2 GEO-61/2891-C) does not
    // drag the anchor down and push the tall test's upper units off the top of the frame. Both
    // columns' shallow zones then stay in view, which is exactly the zone the owner's upper-silt and
    // thin-geotech-unit rulings are about.
    const ground = gl !== null && gr !== null ? Math.min(gl, gr) : (gl ?? gr)
    if (ground === null) {
      console.log('[section-shots] no litho band found at the target columns; zoom skipped')
      return
    }
    // Anchor a little below the ground so the surface sits near the top of the frame, or at the
    // requested level when one is given.
    let cy = Math.min(svgBox.y + svgBox.height * 0.9, ground + svgBox.height * 0.12)
    if (Number.isFinite(LEVEL)) {
      const y = await yOfLevel(page, svgBox, LEVEL)
      if (y !== null) cy = Math.max(svgBox.y + 4, Math.min(svgBox.y + svgBox.height - 4, y))
    }
    // Clamp the wheel point INSIDE the svg box: the gap's columns can sit at/just past the svg's own
    // edge (a wide section whose reset overflows), and a wheel outside the canvas is a no-op (``span``
    // never changes). Keeping the anchor at the near edge still grows the view around the gap.
    const cx = Math.max(svgBox.x + 10, Math.min(svgBox.x + svgBox.width - 10, (lx + rx) / 2))
    await page.mouse.move(cx, cy)
    await page.mouse.wheel(0, -320)
    await page.waitForTimeout(200)
  }
}

test.describe('section shots — owner ruling render capture', () => {
  test.skip(process.platform !== 'win32', 'the worked-example open path is exercised on Windows CI')
  test.setTimeout(5 * 60_000)

  test('capture each named section on the litho axis', async () => {
    expect(fs.existsSync(SAMPLE), `worked example missing at ${SAMPLE} — build resources/sample first`).toBe(true)
    fs.mkdirSync(RESULTS_DIR, { recursive: true })
    const tmpPath = path.join(os.tmpdir(), `strix-shots-${process.pid}-${Date.now()}.strix`)
    fs.copyFileSync(SAMPLE, tmpPath)

    const { app, page } = await launchApp({})
    try {
      await openWorkedExample(page, tmpPath)
      await goToStage(page, 'Sections')

      for (const name of SECTION_SHOTS) {
        // The section list row's text is the section name (``section-row-<id>``; the delete affordance
        // carries a separate testid we exclude).
        const row = page
          .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
          .filter({ hasText: name })
          .first()
        await expect(row, `section "${name}" is in the list`).toBeVisible({ timeout: 20_000 })
        await row.click()
        // The axis the owner's ruling is about — Litho by default, Geotech for the class-change seam.
        await page.getByTestId(AXIS === 'Geotech' ? 'axis-geotech' : 'axis-litho').click()
        // The open section's SVG carries no testid of its own; find it through the marquee
        // background it always renders, and fall back to the whole window.
        const panelSvg = page.locator('svg', { has: page.getByTestId('section-marquee-bg') }).first()
        await panelSvg.waitFor({ state: 'visible', timeout: 20_000 }).catch(() => {})
        // Reset the view so the whole section length is in the shot.
        await page.getByTestId('section-view-reset').click({ timeout: 5_000 }).catch(() => {})
        // "Fill bands" is an in-memory toggle, default OFF (bandFillStore): press the bare L
        // hotkey once when no fill region is on screen, so every shot shows the litho fill.
        await page.waitForTimeout(1_500)
        if ((await page.locator('[data-testid^="partition-fill-group-"]').count()) === 0) {
          await page.keyboard.press('l')
        }
        // Let the on-click litho fill settle (the partition + overlay render).
        await page.waitForTimeout(3_000)
        if (SPACING) {
          const slider = page.getByTestId('section-control-spacing')
          const value = SPACING === 'max' ? ((await slider.getAttribute('max')) ?? '100') : SPACING
          await slider.fill(value)
          await page.waitForTimeout(400)
        }
        if (Number.isFinite(VEX) && VEX > 0) {
          const slider = Math.round(
            (100 * (Math.log10(VEX) - Math.log10(VEX_MIN))) / (Math.log10(VEX_MAX) - Math.log10(VEX_MIN)),
          )
          await page.getByTestId('section-control-vexag').fill(String(Math.max(0, Math.min(100, slider))))
          await page.waitForTimeout(400)
        }
        if (ZOOM_SPEC) await zoomOnGap(page, panelSvg, ZOOM_SPEC)
        const safe = name.replace(/[^A-Za-z0-9._-]+/g, '_')
        const shotPath = path.join(RESULTS_DIR, `${safe}.png`)
        if (await panelSvg.isVisible().catch(() => false)) await panelSvg.screenshot({ path: shotPath })
        else await page.screenshot({ path: shotPath })
      }
    } finally {
      await closeApp(app)
      try {
        fs.unlinkSync(tmpPath)
      } catch {
        // best-effort temp cleanup
      }
    }
  })
})
