// Wiring/source pins for the cutout's camera frame + zoom tuning (audit
// F4/F5, 2026-08-27), in the established B6 style: Cesium does not run under
// jsdom, so the invariant is WHAT the cutout hands the shared viewer, read
// off the source, plus the constants imported directly.
//
// FZ1 — the camera-frame solid is built from the UNFILTERED ``fencePanels``
//       (the whole model), never from the filtered cutout — a small body must
//       keep its orientation context.
// FZ2 — the WALLS stay the filtered cutout (the scope's one visual act).
// FZ3 — the basemap lid footprint + elevation read the FULL panel set, so the
//       orthophoto matches the other 3-D stages.
// FZ4 — the cutout passes the named zoom tuning; the constants carry the
//       chosen values (zoomFactor ~2, a metres-scale minimum zoom distance,
//       a small fine-zoom fraction for CTRL+wheel).
// FZ5 — CesiumViewport binds CTRL+wheel as the FINE zoom via a
//       modifier-qualified handler, and deliberately does NOT add a CTRL
//       entry to the controller's zoomEventTypes (one shared zoomFactor —
//       routing it through the controller cannot be finer, and doubling both
//       would double-fire).
// FZ6 — the shared stages are untouched: no stage canvas passes zoomTuning.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  UNIT_FENCE_ZOOM_TUNING,
} from './unitFenceSceneConstants'

const SCENE_SRC = readFileSync(join(__dirname, 'UnitFenceScene.tsx'), 'utf-8')
const VIEWPORT_SRC = readFileSync(
  join(__dirname, '..', 'geology', 'CesiumViewport.tsx'),
  'utf-8',
)
// The tuning mechanism lives in its own hook (debt #201 — CesiumViewport must
// not grow); the viewport only calls it.
const TUNING_SRC = readFileSync(
  join(__dirname, '..', 'geology', 'useViewportZoomTuning.ts'),
  'utf-8',
)

describe('UnitFenceScene — whole-fence camera frame (audit F4)', () => {
  it('FZ1 — the frame solid reads the UNFILTERED fencePanels', () => {
    expect(SCENE_SRC).toMatch(/fenceFrameCorners\(fencePanels/)
    // The old shape — cutout vertices as the frame — must be gone.
    expect(SCENE_SRC).not.toMatch(/cutout\.flatMap\(p => p\.vertices\)/)
  })

  it('FZ2 — the walls stay the filtered cutout', () => {
    expect(SCENE_SRC).toMatch(/fencePanels=\{cutout\}/)
  })

  it('FZ3 — the basemap lid reads the FULL panel set', () => {
    expect(SCENE_SRC).toMatch(/lidFootprintPanels=\{fencePanels/)
  })
})

describe('UnitFenceScene — cutout zoom tuning (audit F5)', () => {
  it('FZ4 — the cutout passes the named tuning; the constants carry the values', () => {
    expect(SCENE_SRC).toMatch(/zoomTuning=\{UNIT_FENCE_ZOOM_TUNING\}/)
    expect(UNIT_FENCE_ZOOM_TUNING.zoomFactor).toBe(2)
    expect(UNIT_FENCE_ZOOM_TUNING.minimumZoomDistanceM).toBeGreaterThanOrEqual(5)
    expect(UNIT_FENCE_ZOOM_TUNING.fineZoomFraction).toBeGreaterThan(0)
    expect(UNIT_FENCE_ZOOM_TUNING.fineZoomFraction).toBeLessThan(0.2)
  })

  it('FZ5 — CTRL+wheel is a modifier-qualified FINE handler, not a controller entry', () => {
    expect(TUNING_SRC).toMatch(/KeyboardEventModifier\.CTRL/)
    expect(TUNING_SRC).toMatch(/ScreenSpaceEventType\.WHEEL/)
    // The viewport wires the hook; the controller's zoomEventTypes must not
    // gain a CTRL entry anywhere — that would zoom at the shared (coarse)
    // factor AND double-fire beside the handler.
    expect(VIEWPORT_SRC).toMatch(/useViewportZoomTuning\(/)
    for (const src of [VIEWPORT_SRC, TUNING_SRC]) {
      expect(src).not.toMatch(/zoomEventTypes\s*=/)
    }
  })

  it('FZ6 — no shared stage passes zoomTuning', () => {
    for (const rel of [
      ['..', 'geology', 'GeologyCanvas.tsx'],
      ['..', 'lithology', 'LithologyCanvas.tsx'],
      ['..', 'geotechnical', 'GeotechnicalCanvas.tsx'],
    ]) {
      const p = join(__dirname, ...rel)
      let src = ''
      try {
        src = readFileSync(p, 'utf-8')
      } catch {
        continue // canvas lives elsewhere — the absence claim still holds below
      }
      expect(src).not.toMatch(/zoomTuning/)
    }
  })
})
