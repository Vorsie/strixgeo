/**
 * emitFloodWedge.test.ts — the corr-0 LENS flood wedge must meet the lens at its APEX,
 * never past it (ruling 8g/8q: "the matrix detours AROUND the wedge; fill between the
 * lines"). The flood that fills the vacated space past a 0-corr lens apex converges AT
 * the lens apex X — so its flanks coincide with the lens closing flanks and add no
 * overlapping sliver. When the flood conv sat at the gap MIDPOINT (0.50) while the lens
 * apex sat at 0.45 (ruling 8b-rev's flat reach), the two wedges diverged by 0.05·gap and
 * left a razor-thin double-covered sliver — the CS1-g3 / CS2-g17 "hole" cluster.
 */
import { describe, expect, it } from 'vitest'

import { emitFloodWedge } from './emitFloodWedge'
import { type LensLabel } from './emitLenses'
import { type ColumnGeom } from './sectionGeom'
import { type InputCurve } from './types'

/** A facing column carrying a single ZAND band spanning the lens elevation. */
function facingZand(x: number): ColumnGeom {
  return {
    investigationId: 'F',
    x,
    surfaceElevM: 10,
    units: [{ layerId: 'f0', formationId: 'ZAND', bodyId: null, topElev: 10, baseElev: -10 }],
    enclosedLenses: [],
  }
}

describe('emitFloodWedge — the corr-0 LENS flood converges AT the lens apex (ruling 8g/8q)', () => {
  it('a 0-corr lens flood wedge does NOT reach past the lens apex (no midpoint conv)', () => {
    // Lens on col x=0, facing at x=100, unit [0.61..0.23], mid=0.42. The lens apex is at
    // apexX = 45 (0.45·gap). The flood that fills the matrix past the apex must converge AT
    // x=45 — never at the gap midpoint x=50. If any emitted flood vertex sits BETWEEN the apex
    // (45) and the facing at the apex ELEVATION on the near side, the flood overlaps the lens
    // diamond and produces the sliver.
    const colX = 0
    const facingX = 100
    const apexX = 45
    const apexElev = 0.42
    const label: LensLabel = { formationId: 'ZAND', bodyId: null }
    const out: InputCurve[] = []
    const labels = new Map<string, LensLabel>()
    let seq = 0
    emitFloodWedge(
      colX, facingX, facingZand(facingX), 0.61, 0.23, apexX, apexElev, null,
      () => `flood${seq++}`, labels, out, undefined, label, [],
    )
    // No emitted flood vertex may sit strictly to the RIGHT of the apex while at (or near) the
    // apex elevation on a flank that starts at a column corner — that is the overlapping conv.
    // Concretely: every flood vertex at the apex elevation must be at x ≤ apexX (the conv is the
    // apex, not the midpoint). The old bug put conv at x=50 > 45.
    for (const cv of out) {
      for (const p of cv.points) {
        if (Math.abs(p.y - apexElev) < 1e-6) {
          expect(p.x).toBeLessThanOrEqual(apexX + 1e-6)
        }
      }
    }
  })
})
