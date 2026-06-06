/**
 * Flow — Litho gesture: REAL canvas drag of a shared boundary between two
 * ACCEPTED layers (the 409 fix, dogfeed 2026-06-06).
 *
 * Unlike ``flow_litho_drag_resize_boundary`` (which PATCHes the contact
 * endpoint directly via fetch and never touches the UI), this spec performs
 * the actual mouse-drag on the ``contact-drag-strip`` rect, so it exercises
 * the real FE commit path:
 *
 *   ContactsLayer drag → onUpdateContactDepth
 *     → handleLithoSnapAwareUpdateContactDepth (SectionsCanvas)
 *       → useContactCrud.handleUpdateContactDepth (litho branch)
 *         → api.geology.moveLayerBoundary  (atomic two-row resize)
 *
 * Before the fix that path issued a single-layer ``updateLayer`` PATCH which
 * overlapped the unmoved neighbour → 409 and the boundary did not move. This
 * spec asserts NO 409 / NO error log, and — directly via the layers API — that
 * BOTH layers' shared edge moved together while their outer edges stayed put.
 *
 * Drag synthesis note: ContactsLayer starts the drag in the strip's
 * onMouseDown (handleStripMouseDown → startDrag sets ``drag`` state), and a
 * React effect THEN attaches the document-level mousemove/mouseup listeners
 * that track + commit it. So the gesture must be: real mousedown on the strip,
 * wait for the effect, then move + up. A short tick is also given after each
 * move so React flushes the per-move setDrag before mouseup reads it.
 *
 * Prerequisites: FastAPI :8765, Postgres :5433 (``groundmodel_integration``),
 * fixture seeded (``E2E_FIXTURE_PROJECT_ID`` set by run-e2e.ps1).
 */

import { test, expect } from '@playwright/test'
import { launchApp, closeApp } from './helpers/electron_launch'
import { openFixtureProject, goToStage, cleanupFixtureFile } from './helpers/project_open'

const FIXTURE_PROJECT_ID = process.env.E2E_FIXTURE_PROJECT_ID ?? ''
const API_BASE = 'http://127.0.0.1:8765'

interface LayerRow {
  id: string
  cpt_id: string | null
  borehole_id: string | null
  depth_top_m: number
  depth_base_m: number
  status: string
}

interface AcceptedPair {
  upperId: string
  lowerId: string
  boundaryM: number
  upperTopM: number
  lowerBaseM: number
}

async function fetchLayers(
  page: import('@playwright/test').Page,
  modelId: string,
): Promise<LayerRow[]> {
  return page.evaluate(
    async ([base, pid, mid]) => {
      const r = await fetch(`${base}/projects/${pid}/geology/models/${mid}/layers`)
      return r.json()
    },
    [API_BASE, FIXTURE_PROJECT_ID, modelId],
  )
}

function acceptedPairs(layers: LayerRow[]): Map<string, AcceptedPair> {
  const out = new Map<string, AcceptedPair>()
  const accepted = layers.filter(l => l.status === 'accepted')
  for (const lower of accepted) {
    const upper = accepted.find(
      u =>
        u.id !== lower.id &&
        u.cpt_id === lower.cpt_id &&
        u.borehole_id === lower.borehole_id &&
        Math.abs(u.depth_base_m - lower.depth_top_m) < 1e-6,
    )
    if (upper) {
      out.set(lower.id, {
        upperId: upper.id,
        lowerId: lower.id,
        boundaryM: lower.depth_top_m,
        upperTopM: upper.depth_top_m,
        lowerBaseM: lower.depth_base_m,
      })
    }
  }
  return out
}

test.describe('flow_litho_boundary_move_drag', () => {
  test.skip(
    !FIXTURE_PROJECT_ID,
    'E2E_FIXTURE_PROJECT_ID not set — run tests/e2e/fixtures/build_synthetic_fixture.py first',
  )

  test('dragging a shared accepted boundary resizes both layers, no 409', async () => {
    const { app, page } = await launchApp({ E2E_FIXTURE_PROJECT_ID: FIXTURE_PROJECT_ID })
    let tmpPath = ''
    const http409: string[] = []
    const errorLogs: string[] = []
    const layerWrites: string[] = [] // which layer-write endpoint the drag hit
    page.on('request', req => {
      const u = req.url()
      if (/\/layers\/boundary-move/.test(u)) layerWrites.push('PATCH boundary-move')
      else if (req.method() === 'PATCH' && /\/layers\/[0-9a-fA-F-]+$/.test(u)) {
        layerWrites.push('PATCH layer (single)')
      }
    })
    page.on('response', res => {
      if (res.status() === 409 && /\/layers/.test(res.url())) http409.push(res.url())
    })
    page.on('console', msg => {
      if (/updateContact failed|moveLayerBoundary failed/.test(msg.text())) errorLogs.push(msg.text())
    })

    try {
      tmpPath = await openFixtureProject(app, page, FIXTURE_PROJECT_ID)

      const models = await page.evaluate(
        async ([base, pid]) => {
          const r = await fetch(`${base}/projects/${pid}/geology/models`)
          return r.json()
        },
        [API_BASE, FIXTURE_PROJECT_ID],
      )
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const lithoModel = (models as any[]).find(m => m.kind === 'lithostratigraphic')
      expect(lithoModel).toBeTruthy()
      const lithoModelId: string = lithoModel.id

      const pairs = acceptedPairs(await fetchLayers(page, lithoModelId))
      expect(pairs.size).toBeGreaterThan(0)

      await goToStage(page, 'Sections')
      const sectionB = page
        .locator('[data-testid^="section-row-"]:not([data-testid*="delete"])')
        .filter({ hasText: 'Section B' })
        .first()
      await expect(sectionB).toBeVisible({ timeout: 10_000 })
      await sectionB.click()
      await page.getByRole('radio', { name: 'Litho' }).click()

      await page
        .locator('[data-testid="contact-drag-strip"]')
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 })
      const renderedIds: string[] = await page
        .locator('[data-testid="contact-drag-strip"]')
        .evaluateAll(els => els.map(e => e.getAttribute('data-contact-id') ?? ''))
      const targetId = renderedIds.find(id => pairs.has(id))
      expect(targetId, 'no rendered strip matched an accepted shared boundary').toBeTruthy()
      const pair = pairs.get(targetId as string) as AcceptedPair

      const strip = page.locator(
        `[data-testid="contact-drag-strip"][data-contact-id="${targetId}"]`,
      )
      const box = await strip.boundingBox()
      expect(box).toBeTruthy()
      const cx = Math.round(box!.x + box!.width / 2)
      const cy = Math.round(box!.y + box!.height / 2)

      // Derive px-per-metre from the y-axis grid ticks (SectionGrid renders them
      // as end-anchored <text> near the left edge with the level value as text).
      // Robust regardless of zoom or which contact strips happen to render — so
      // we can drag to a CONTROLLED depth comfortably inside the pair. (An
      // overshoot to an edge clamps to a near-zero-thickness layer the backend
      // rejects with a 500 — the bug this spec's careful targeting avoids.)
      const ticks: { v: number; y: number }[] = await page.evaluate(() => {
        const out: { v: number; y: number }[] = []
        for (const t of Array.from(document.querySelectorAll('svg text'))) {
          if (t.getAttribute('text-anchor') !== 'end') continue
          const txt = (t.textContent ?? '').trim()
          // Pure-number end-anchored texts are the y-axis level ticks
          // (x-axis ticks are middle-anchored; readouts carry units).
          if (!/^-?\d+(\.\d+)?$/.test(txt)) continue
          const r = t.getBoundingClientRect()
          out.push({ v: parseFloat(txt), y: r.y + r.height / 2 })
        }
        return out
      })
      expect(ticks.length, 'need >=2 y-axis ticks to derive px/m').toBeGreaterThanOrEqual(2)
      // Median px/m across adjacent ticks — robust to any stray numeric text.
      ticks.sort((a, b) => a.y - b.y)
      const slopes: number[] = []
      for (let i = 1; i < ticks.length; i += 1) {
        const dv = ticks[i].v - ticks[i - 1].v
        if (Math.abs(dv) > 1e-9) slopes.push(Math.abs((ticks[i].y - ticks[i - 1].y) / dv))
      }
      slopes.sort((a, b) => a - b)
      const pxPerMetre = slopes[Math.floor(slopes.length / 2)]
      expect(pxPerMetre).toBeGreaterThan(0)
      // Move the boundary halfway into the lower layer — clearly inside the
      // pair, healthy thickness on both sides. Deeper = larger depth = +screen Y.
      const targetDepth = pair.boundaryM + (pair.lowerBaseM - pair.boundaryM) / 2
      const targetY = Math.round(cy + (targetDepth - pair.boundaryM) * pxPerMetre)

      // Real mousedown on the strip, then wait for the drag effect to attach
      // its document listeners, then move + up. Tiny ticks after each move so
      // React flushes the per-move setDrag before mouseup reads it.
      await page.mouse.move(cx, cy)
      await page.mouse.down()
      await page.waitForTimeout(200)
      const cursorAfterDown = await strip.evaluate(el => getComputedStyle(el).cursor)
      // The real mousedown above ARMS the drag (cursor → grabbing). Two more
      // things matter:
      //  1. moves must carry buttons:1 — handleMove cancels on e.buttons===0
      //     (line ~1769), and page.mouse.move can emit buttons:0.
      //  2. the mouseup must be a SEPARATE tick from the moves. handleUp closes
      //     over the ``drag`` state from when its listener was attached; the
      //     per-move setDrag updates only take effect after React re-renders +
      //     re-attaches the listener. Dispatching moves + up in one synchronous
      //     evaluate makes handleUp read the STALE (unmoved) drag →
      //     depthUnchanged → no commit. So: dispatch the moves, yield for React
      //     to flush, THEN dispatch the mouseup.
      await page.evaluate(
        ({ x, y0, y1, steps }) => {
          for (let i = 1; i <= steps; i += 1) {
            const y = Math.round(y0 + ((y1 - y0) * i) / steps)
            document.dispatchEvent(
              new MouseEvent('mousemove', { clientX: x, clientY: y, buttons: 1, bubbles: true }),
            )
          }
        },
        { x: cx, y0: cy, y1: targetY, steps: 12 },
      )
      await page.waitForTimeout(150) // let React flush the moved drag state
      await page.evaluate(
        ({ x, y1 }) => {
          document.dispatchEvent(
            new MouseEvent('mouseup', {
              clientX: x,
              clientY: y1,
              button: 0,
              buttons: 0,
              bubbles: true,
            }),
          )
        },
        { x: cx, y1: targetY },
      )
      await page.mouse.up() // release Playwright's button state (app already committed)

      await expect
        .poll(
          async () => {
            const rows = await fetchLayers(page, lithoModelId)
            const lo = rows.find(l => l.id === pair.lowerId)
            return lo ? Math.abs(lo.depth_top_m - pair.boundaryM) : 0
          },
          {
            timeout: 6_000,
            message:
              `boundary did not move. cursorAfterDown=[${cursorAfterDown}]` +
              ` · layerWrites=[${layerWrites.join(', ') || 'none'}]` +
              ` · 409s=[${http409.join(', ') || 'none'}]`,
          },
        )
        .toBeGreaterThan(0.02)

      const after = await fetchLayers(page, lithoModelId)
      const newUpper = after.find(l => l.id === pair.upperId)
      const newLower = after.find(l => l.id === pair.lowerId)
      expect(newUpper).toBeTruthy()
      expect(newLower).toBeTruthy()
      expect(newUpper!.depth_base_m).toBeCloseTo(newLower!.depth_top_m, 3)
      expect(newUpper!.depth_top_m).toBeCloseTo(pair.upperTopM, 3)
      expect(newLower!.depth_base_m).toBeCloseTo(pair.lowerBaseM, 3)
      expect(newLower!.depth_top_m).toBeGreaterThan(pair.upperTopM)
      expect(newLower!.depth_top_m).toBeLessThan(pair.lowerBaseM)

      expect(
        layerWrites.some(w => w.includes('boundary-move')),
        `expected a boundary-move call; saw [${layerWrites.join(', ') || 'none'}]`,
      ).toBe(true)
      expect(http409, `unexpected 409(s): ${http409.join(', ')}`).toHaveLength(0)
      expect(errorLogs, `unexpected error log(s): ${errorLogs.join(' | ')}`).toHaveLength(0)

      // Restore the boundary so the shared fixture stays clean.
      await page.evaluate(
        async ([base, pid, mid, up, lo, d]) => {
          await fetch(`${base}/projects/${pid}/geology/models/${mid}/layers/boundary-move`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ upper_layer_id: up, lower_layer_id: lo, new_depth_m: d }),
          })
        },
        [API_BASE, FIXTURE_PROJECT_ID, lithoModelId, pair.upperId, pair.lowerId, pair.boundaryM],
      )
    } finally {
      await closeApp(app)
      cleanupFixtureFile(tmpPath)
    }
  })
})
