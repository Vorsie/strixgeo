// Pins for the cutout's synthetic camera-frame solid (audit F4, 2026-08-27).
//
// The cutout used to frame the camera on the FILTERED panels: a small body
// showed a chip of orthophoto with no orientation context, and a deep unit
// floated the photo at its own top. The frame solid is now built from the
// UNFILTERED fence panels' bounding box — 8 corners, O(1) — so the camera
// sphere contains every wall and the scene keeps the whole-model context
// whatever the scope shows.
//
// UF1 — the corners are the 8 vertices of the axis-aligned bounding box of
//       EVERY panel vertex (min/max per axis — the sphere contains them all).
// UF2 — the output is always exactly 8 vertices, whatever the panel count
//       (the O(1) shape the camera fitKey relies on).
// UF3 — no panels (or no vertices) yields null — nothing to frame.

import { describe, expect, it } from 'vitest'

import type { FencePanel } from '../../../utils/fencePanels'
import { fenceFrameCorners } from './unitFenceFrame'

function panelWith(vertices: [number, number, number][]): FencePanel {
  return { formationId: 'u1', bodyId: null, vertices, triangles: [] }
}

describe('fenceFrameCorners — the whole-fence camera frame', () => {
  it('UF1 — the 8 corners bound every panel vertex', () => {
    const corners = fenceFrameCorners([
      panelWith([
        [0, 10, -5],
        [100, 20, 3],
      ]),
      panelWith([
        [-40, 200, -30],
        [60, 15, 8],
      ]),
    ])!
    const xs = corners.map(c => c[0])
    const ys = corners.map(c => c[1])
    const zs = corners.map(c => c[2])
    expect(Math.min(...xs)).toBe(-40)
    expect(Math.max(...xs)).toBe(100)
    expect(Math.min(...ys)).toBe(10)
    expect(Math.max(...ys)).toBe(200)
    expect(Math.min(...zs)).toBe(-30)
    expect(Math.max(...zs)).toBe(8)
    // Every combination of min/max appears exactly once.
    const keys = new Set(corners.map(c => c.join(',')))
    expect(keys.size).toBe(8)
  })

  it('UF2 — always exactly 8 vertices, whatever the panel count', () => {
    const many = Array.from({ length: 50 }, (_, i) =>
      panelWith([
        [i, i * 2, -i],
        [i + 1, i * 2 + 1, -i + 1],
      ]),
    )
    expect(fenceFrameCorners(many)).toHaveLength(8)
    expect(fenceFrameCorners([panelWith([[1, 2, 3]])])).toHaveLength(8)
  })

  it('UF3 — nothing to frame yields null', () => {
    expect(fenceFrameCorners([])).toBeNull()
    expect(fenceFrameCorners([panelWith([])])).toBeNull()
  })
})
