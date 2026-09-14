/**
 * Behavioural tests for the 3-D fence bed-override clip (owner question tonight,
 * verbatim Dutch: "wordt het getekend bodempeil ook uit het hekwerk gesneden?"
 * = "is the drawn bed level cut out of the fence too?").
 *
 * The rule, in the owner's words: the drawn bed level is cut out of the fence
 * too — exactly like the section view. Inside a bed polygon the fence wall stops
 * at the bed level; a section outside every bed polygon is untouched; a panel
 * crossing the polygon edge is cut only inside it. With no bed overrides the
 * fence is byte-identical to before this feature existed.
 */

import { describe, expect, it } from 'vitest'

import { clipFencePanelsToBed } from './clipFencePanelsToBed'
import type { FencePanel } from './fencePanels'
import type { BedPolygon } from './bedPolygonMembership'

/**
 * A rectangular wall panel along the plan segment (x0,y0)→(x1,y1), running from
 * elevation `zBot` up to `zTop`. Two triangles, four corners.
 */
function wall(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  zBot: number,
  zTop: number,
  extra: Partial<FencePanel> = {},
): FencePanel {
  const vertices: [number, number, number][] = [
    [x0, y0, zBot], // 0 left-bottom
    [x1, y1, zBot], // 1 right-bottom
    [x1, y1, zTop], // 2 right-top
    [x0, y0, zTop], // 3 left-top
  ]
  return {
    formationId: 'f1',
    bodyId: 'b1',
    vertices,
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
    ...extra,
  }
}

/** The maximum elevation across a panel's vertices whose plan-X passes `keep`. */
function maxZWhere(panel: FencePanel, keep: (x: number) => boolean): number {
  let m = -Infinity
  for (const [x, , z] of panel.vertices) if (keep(x)) m = Math.max(m, z)
  return m
}

const BED = -4

describe('clipFencePanelsToBed — the drawn bed level is cut out of the fence too', () => {
  it('the drawn bed level is cut out of the fence too (a wall wholly inside a bed polygon stops at the bed)', () => {
    // A W-E wall along y=0, from x=0 to x=100, elevations -10..+5.
    const panels = [wall(0, 0, 100, 0, -10, 5)]
    // A canal bed at -4 covering the whole wall in plan.
    const canal: BedPolygon = {
      level_m: BED,
      vertices: [
        [-10, -10],
        [110, -10],
        [110, 10],
        [-10, 10],
      ],
    }

    const out = clipFencePanelsToBed(panels, [canal])

    // The wall changed — the part above the bed is gone.
    expect(out[0]).not.toBe(panels[0])
    // Nothing lithological remains above the bed level anywhere in the wall.
    for (const [, , z] of out[0].vertices) {
      expect(z).toBeLessThanOrEqual(BED + 1e-6)
    }
    // The part below the bed survives — a real wall, not an empty panel.
    expect(out[0].triangles.length).toBeGreaterThan(0)
    expect(out[0].vertices.some(([, , z]) => z < BED - 1)).toBe(true)
  })

  it('a section outside every bed polygon is untouched (identity, byte-identical)', () => {
    // The wall is 1000 m north of the canal — the plan line never enters it.
    const panels = [wall(0, 1000, 100, 1000, -10, 5)]
    const canal: BedPolygon = {
      level_m: BED,
      vertices: [
        [-10, -10],
        [110, -10],
        [110, 10],
        [-10, 10],
      ],
    }

    const out = clipFencePanelsToBed(panels, [canal])

    // The panel object is returned untouched — same reference, nothing cut.
    expect(out[0]).toBe(panels[0])
  })

  it('a panel crossing the polygon edge is cut only inside it', () => {
    // A W-E wall from x=0 to x=100; the canal covers only x >= 50 in plan.
    const panels = [wall(0, 0, 100, 0, -10, 5)]
    const canal: BedPolygon = {
      level_m: BED,
      vertices: [
        [50, -10],
        [200, -10],
        [200, 10],
        [50, 10],
      ],
    }

    const out = clipFencePanelsToBed(panels, [canal])
    const clipped = out[0]

    // Outside the canal (x < 50) the wall keeps its full height.
    expect(maxZWhere(clipped, (x) => x < 50 - 1e-6)).toBeCloseTo(5, 6)
    // Inside the canal (x > 50) nothing survives above the bed level.
    expect(maxZWhere(clipped, (x) => x > 50 + 1e-6)).toBeLessThanOrEqual(BED + 1e-6)
  })

  it('with no bed overrides the fence is byte-identical (same array, no-op)', () => {
    const panels = [wall(0, 0, 100, 0, -10, 5), wall(0, 0, 50, 50, -8, 2)]
    expect(clipFencePanelsToBed(panels, [])).toBe(panels)
  })
})
