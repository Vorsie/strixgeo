/**
 * partitionFillV2/floodLabelInsideTies.test.ts — the flood label stays INSIDE the
 * correlation lines (owner ruling, 2026-08-18).
 *
 * Owner, verbatim: *"the silt is tied with a top tie — follow the tie, same silt
 * same class, no onlap. The denser bottom silt is tied to the bottom silt on the
 * left. Same litho other class, it should cleanly onlap."*
 *
 * In his words the scene is: a silt CHANNEL whose top and bottom are both drawn
 * correlations, holding one extra thin denser silt on one borehole that nobody
 * tied. Same litho other class → it onlaps cleanly, pinching at ITS OWN level;
 * and the rest of the channel stays the MATRIX — the silt that owns the channel's
 * bounding tie lines and fills the channel on the other borehole. What the
 * channel may never take is the clay from ACROSS the top tie line: the clay lives
 * on the other side of a correlation the user drew, and no fill may cross it.
 *
 * This is ruling 8n ("stay inside the lines") applied to the flood wedge's LABEL,
 * not only to its geometry.
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'

// One formation row PER COLUMN, as the geotech axis really carries them: two
// boreholes' silt of the very same class are two different formation ids, so the
// engine terminates them against each other rather than merging them silently.
const CLAY_A_L = 'clay-above-L'
const CLAY_B_L = 'clay-below-L'
const CLAY_B_R = 'clay-below-R'
const SILT_MATRIX_L = 'silt-matrix-L'
const SILT_MATRIX_R = 'silt-matrix-R'
const SILT_DENSE_R = 'silt-dense-R'
const SILTS = [SILT_MATRIX_L, SILT_MATRIX_R, SILT_DENSE_R]

interface U {
  top: number
  base: number
  f: string
  layerId: string
  body?: string | null
}

function col(id: string, surface: number, units: U[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      layerId: u.layerId,
      bodyId: u.body ?? null,
    })),
  }
}

/** The single formation covering (fraction, elevation) in ``gap``; ``'MULTI'`` when more than one. */
function formationAt(
  regions: readonly SectionRegion[],
  gap: number,
  f: number,
  elev: number,
): string | 'MULTI' | null {
  const pin = (poly: SectionRegion['polygon']): boolean => {
    let ins = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i].fraction
      const yi = poly[i].elevation
      const xj = poly[j].fraction
      const yj = poly[j].elevation
      if (yi > elev !== yj > elev && f < ((xj - xi) * (elev - yi)) / (yj - yi) + xi) ins = !ins
    }
    return ins
  }
  const forms = new Set<string>()
  for (const r of regions) {
    if (r.gapIndex !== gap) continue
    if (pin(r.polygon)) forms.add(r.formationId)
  }
  if (forms.size === 0) return null
  if (forms.size > 1) return 'MULTI'
  return [...forms][0]
}

/**
 * The owner's scene, minimal: two boreholes, a silt channel bracketed by two drawn
 * correlations, one untied denser silt at the bottom of the channel on the RIGHT
 * borehole, and CLAY above the upper correlation on the LEFT borehole.
 *
 * Elevations (mTAW):
 *   LEFT  : CLAY_A_L 12.0→6.0 · SILT_MATRIX_L 6.0→5.0 · CLAY_B_L 5.0→3.0
 *   RIGHT : SILT_MATRIX_R 13.0→8.0 · SILT_DENSE_R 8.0→7.5 · CLAY_B_R 7.5→5.0
 *   tie 1 (channel top)  : LEFT 6.0 ↔ RIGHT 13.0   (mid-gap 9.5)
 *   tie 2 (channel base) : LEFT 5.0 ↔ RIGHT  7.5   (mid-gap 6.25)
 *
 * The ties are STEEP, which is the whole point: a horizontal read from the right
 * borehole's channel elevations lands on the LEFT borehole ABOVE tie 1, i.e. in
 * the clay on the far side of a correlation.
 */
function buildScene(): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const left = col('BH-L', 12, [
    { top: 0, base: 6, f: CLAY_A_L, layerId: 'L-clayA', body: 'bL-clayA' },
    { top: 6, base: 7, f: SILT_MATRIX_L, layerId: 'L-silt', body: 'bL-silt' },
    { top: 7, base: 9, f: CLAY_B_L, layerId: 'L-clayB', body: 'bL-clayB' },
  ])
  const right = col('BH-R', 13, [
    { top: 0, base: 5, f: SILT_MATRIX_R, layerId: 'R-silt', body: 'bR-silt' },
    { top: 5, base: 5.5, f: SILT_DENSE_R, layerId: 'R-siltDense', body: 'bR-siltDense' },
    { top: 5.5, base: 8, f: CLAY_B_R, layerId: 'R-clayB', body: 'bR-clayB' },
  ])
  const edges: CorrelationEdge[] = [
    { a: 'L-silt', b: 'R-silt', aSide: 'top', bSide: 'top' },
    { a: 'L-clayB', b: 'R-clayB', aSide: 'top', bSide: 'top' },
  ]
  return { columns: [left, right], edges, alongM: [0, 40] }
}

/** Elevation of a channel-bounding tie at a gap fraction (both ties are straight chords). */
const tieTopAt = (f: number): number => 6 + f * (13 - 6)
const tieBaseAt = (f: number): number => 5 + f * (7.5 - 5)

describe('the flood label stays inside the drawn correlation lines', () => {
  it('the channel remainder stays the MATRIX silt — never the clay from across the top tie', () => {
    const { columns, edges, alongM } = buildScene()
    const prev = setTwoSidedTerminations(true)
    let regions: SectionRegion[]
    try {
      regions = computeSectionFillV2(columns, edges, undefined, alongM)
    } finally {
      setTwoSidedTerminations(prev)
    }

    // The face the owner X'd: the remainder of the channel in the right half-gap,
    // between the denser silt's onlap below and the matrix silt's onlap above. It is
    // the MATRIX silt — the silt that owns both bounding tie lines.
    //
    // ROUND 3 (2026-08-18) narrowed WHICH matrix row answers, and this assertion moved
    // with it: the round-1 fix mapped the flood label across the gap, so the LEFT
    // borehole's silt row painted this face; the channel-matrix rule now reads the ONE
    // column the face actually reaches — the RIGHT one — so the RIGHT borehole's silt
    // row paints it. Same lithology, same class, same picture; strictly better
    // provenance, and it is round 1's own lesson ("the answer always comes from ONE
    // drilled column") applied to itself. What this test exists to forbid — the clay
    // from ACROSS the top tie — is unchanged and still pinned by the sweep below.
    expect([SILT_MATRIX_L, SILT_MATRIX_R]).toContain(formationAt(regions, 0, 0.6, 8.0))

    // And nowhere in the channel does a clay appear. Sweep the whole channel:
    // between the two tie lines, at every fraction, the fill is silt — a
    // correlation the user drew is never crossed by the fill on the other side.
    // Integer steps, strictly INSIDE both tie lines — a sample landing exactly ON a
    // correlation is ambiguous by construction (both sides own the line).
    const foreign: string[] = []
    for (let i = 1; i <= 19; i++) {
      const f = i / 20
      const lo = tieBaseAt(f)
      const hi = tieTopAt(f)
      for (let j = 1; j <= 9; j++) {
        const elev = lo + (j / 10) * (hi - lo)
        const got = formationAt(regions, 0, f, elev)
        if (got !== null && !SILTS.includes(got)) {
          foreign.push(`f=${f.toFixed(2)} elev=${elev.toFixed(2)} -> ${got}`)
        }
      }
    }
    expect(foreign).toEqual([])
  })

  it('the untied denser silt onlaps cleanly — it pinches at its own level, it does not ride the top tie', () => {
    const { columns, edges, alongM } = buildScene()
    const prev = setTwoSidedTerminations(true)
    let regions: SectionRegion[]
    try {
      regions = computeSectionFillV2(columns, edges, undefined, alongM)
    } finally {
      setTwoSidedTerminations(prev)
    }

    // It is drawn (a clean onlap, not a vanished band): its own wedge near the right
    // borehole reads the denser class.
    expect(formationAt(regions, 0, 0.9, 7.45)).toBe(SILT_DENSE_R)

    // Its own level is 8.0 → 7.5 at the borehole. It tapers toward the channel base
    // tie and NEVER rises above its own top contact — no balloon up to the silt-top
    // tie line at mid-gap (9.5).
    const dense = regions.filter((r) => r.gapIndex === 0 && r.formationId === SILT_DENSE_R)
    expect(dense.length).toBeGreaterThan(0)
    const highest = Math.max(...dense.flatMap((r) => r.polygon.map((p) => p.elevation)))
    expect(highest).toBeLessThanOrEqual(8.0 + 1e-6)
  })
})
