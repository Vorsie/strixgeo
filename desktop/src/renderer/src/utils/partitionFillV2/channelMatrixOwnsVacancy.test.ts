/**
 * partitionFillV2/channelMatrixOwnsVacancy.test.ts — the vacated space in a
 * tie-bounded channel belongs to that channel's DOMINANT mass, never to a thin
 * band inflating along the tie line (owner rulings, 2026-08-18).
 *
 * Two of the owner's own scenes, hand-built minimal:
 *
 *   CASE A (his CS1 gap S7A|S7). *"the silt is tied with a top tie — follow the
 *   tie, same silt same class, no onlap ... its two bases connect or pinch at
 *   their own level, never riding up."* A 0.38 m denser silt with ZERO ties was
 *   painting the whole 1 m channel between the tie and the two silt bases,
 *   because both matrix silts pinched UP to the tie and left it the only column
 *   edge still touching the vacated face.
 *
 *   CASE B (his CS1 gap S7|S6). *"i would prolly just extrapolate the md dense
 *   sand to the tie and let it fill all."* A 0.41 m loose sand crust sitting at
 *   the far end of a clay-base tie was ballooning into a 2.8 m flood over the
 *   dense sand masses below it — "a very dense sand appearing out of nowhere".
 *
 * ONE rule behind both: a face that other units pinched OUT of is the channel's
 * enclosing flood, and its lithology is the channel's dominant mass — the band
 * that actually occupies that elevation window on its own column — not whichever
 * sliver of column edge survived the terminations.
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'

interface U {
  top: number
  base: number
  f: string
  layerId: string
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
      bodyId: `b-${u.layerId}`,
    })),
  }
}

/** Run the engine on the app's own (flag-ON) path. */
function fill(
  columns: PartitionColumn[],
  edges: CorrelationEdge[],
  alongM: number[],
): SectionRegion[] {
  const prev = setTwoSidedTerminations(true)
  try {
    return computeSectionFillV2(columns, edges, undefined, alongM)
  } finally {
    setTwoSidedTerminations(prev)
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

/** The elevation extremes a formation reaches in a gap (``null`` when it draws nothing there). */
function extentOf(
  regions: readonly SectionRegion[],
  gap: number,
  formationId: string,
): { lo: number; hi: number } | null {
  const els = regions
    .filter((r) => r.gapIndex === gap && r.formationId === formationId)
    .flatMap((r) => r.polygon.map((p) => p.elevation))
  if (els.length === 0) return null
  return { lo: Math.min(...els), hi: Math.max(...els) }
}

// ---------------------------------------------------------------------------
// CASE A — the untied denser silt must not own the channel its neighbours left.
// ---------------------------------------------------------------------------

const A_SILT_M_L = 'siltMatrix-L'
const A_SILT_M_R = 'siltMatrix-R'
const A_SILT_DENSE_R = 'siltDense-R'
const A_SILT_CRUST_R = 'siltCrust-R'
const A_CLAY_R = 'clay-R'

/**
 * The owner's S7A|S7 scene, minimal. LEFT is a short CPT that ends at +10.42 —
 * one silt band, nothing below it. RIGHT carries the same silt (a separate
 * formation row, which is how the geotech axis really stores two boreholes'
 * bands of one class), a 0.38 m denser silt under it with NO ties at all, and
 * clay below that. The ONE tie in the gap is the matrix silts' tops.
 */
function sceneA(): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const left = col('BH-L', 13.07, [{ top: 1.61, base: 2.65, f: A_SILT_M_L, layerId: 'L-siltM' }])
  const right = col('BH-R', 13.1, [
    { top: 1.21, base: 1.6, f: A_SILT_CRUST_R, layerId: 'R-crust' },
    { top: 1.6, base: 2.61, f: A_SILT_M_R, layerId: 'R-siltM' },
    { top: 2.61, base: 2.99, f: A_SILT_DENSE_R, layerId: 'R-dense' },
    { top: 2.99, base: 5.35, f: A_CLAY_R, layerId: 'R-clay' },
  ])
  return {
    columns: [left, right],
    edges: [{ a: 'L-siltM', b: 'R-siltM', aSide: 'top', bSide: 'top' }],
    alongM: [645.6, 646.7],
  }
}

/** The tie's elevation at a gap fraction: LEFT +11.46 ↔ RIGHT +11.50. */
const aTieAt = (f: number): number => 11.46 + f * (11.5 - 11.46)

describe('a tied silt channel is filled by its matrix, not by the denser silt below it', () => {
  it('the denser silt keeps its own level — it never rides up to the tie', () => {
    const { columns, edges, alongM } = sceneA()
    const regions = fill(columns, edges, alongM)

    // Its own band is +10.49 → +10.11 on the right borehole. Whatever it draws in
    // the gap stays at that level; it may pinch, it may not climb. (In THIS scene
    // the left borehole's TD at +10.42 is the gap's floor, so all but 7 cm of that
    // band is below the gap's floor and it draws nothing here at all — the
    // sibling test below pins that a denser band WITH room keeps its own wedge.)
    const dense = extentOf(regions, 0, A_SILT_DENSE_R)
    if (dense !== null) expect(dense.hi).toBeLessThanOrEqual(10.49 + 1e-6)

    // And the tie's own channel is not its either: the space between the tie and
    // the silt bases carries no denser silt anywhere.
    expect(formationAt(regions, 0, 0.5, 11.0)).not.toBe(A_SILT_DENSE_R)
  })

  it('a denser band that HAS room still keeps its own wedge — the rule moves fill, it never deletes a band', () => {
    // Same scene, except the left borehole carries on below its silt instead of
    // ending there. Now the denser silt has room in the gap, and it must still be
    // drawn: "SILT-16 stays a wedge from S7 at its own elevation, pinching by
    // half-gap". This is the over-reach guard on the rule, not a defect repro.
    const { columns, edges, alongM } = sceneA()
    const deepLeft = col('BH-L', 13.07, [
      { top: 1.61, base: 2.65, f: A_SILT_M_L, layerId: 'L-siltM' },
      { top: 2.65, base: 6.0, f: 'clay-L', layerId: 'L-clay' },
    ])
    const regions = fill([deepLeft, columns[1]], edges, alongM)

    const dense = extentOf(regions, 0, A_SILT_DENSE_R)
    expect(dense).not.toBeNull()
    expect(dense!.hi).toBeLessThanOrEqual(10.49 + 1e-6)
    expect(dense!.lo).toBeGreaterThanOrEqual(10.11 - 1e-6)
  })

  it('the channel under the tie is the matrix silt, on both sides of the midpoint', () => {
    const { columns, edges, alongM } = sceneA()
    const regions = fill(columns, edges, alongM)

    // Left of the midpoint the channel is the LEFT borehole's silt; right of it the
    // RIGHT borehole's silt. Both are "the silt that is tied", which is what the
    // owner means by the two bases connecting.
    expect(formationAt(regions, 0, 0.25, 10.9)).toBe(A_SILT_M_L)
    expect(formationAt(regions, 0, 0.75, 10.9)).toBe(A_SILT_M_R)

    // And nowhere between the tie above and the silt bases below (+10.42 / +10.49)
    // does the denser silt appear — it is a 0.38 m band, not a 1 m channel fill.
    const offenders: string[] = []
    for (let i = 1; i <= 19; i++) {
      const f = i / 20
      for (let j = 1; j <= 9; j++) {
        const elev = 10.5 + (j / 10) * (aTieAt(f) - 10.5)
        const got = formationAt(regions, 0, f, elev)
        if (got === A_SILT_DENSE_R) offenders.push(`f=${f.toFixed(2)} elev=${elev.toFixed(2)}`)
      }
    }
    expect(offenders).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// CASE B — the dense sand extrapolates to the tie; the loose crust does not.
// ---------------------------------------------------------------------------

const B_CLAY_L = 'clay-L'
const B_CLAY_R = 'clay-R'
const B_SAND_LOOSE_R = 'sandLoose-R'
const B_SAND_MD_R = 'sandMd-R'
const B_SAND_D_R = 'sandDense-R'

/**
 * The owner's S7|S6 scene, minimal. The tie is his auto litho restatement: the
 * LEFT borehole's clay BASE (+4.23, where its stack ends) tied to the RIGHT
 * borehole's sand TOP (+7.03) — a legitimate mixed-side, cross-soil boundary.
 * Under that line the left borehole has NO ground at all; the right one carries
 * a 0.41 m loose crust and then the medium-dense / dense sand masses.
 */
function sceneB(): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const left = col('BH-L', 13.1, [{ top: 2.1, base: 8.87, f: B_CLAY_L, layerId: 'L-clay' }])
  const right = col('BH-R', 13.03, [
    { top: 2.03, base: 6.0, f: B_CLAY_R, layerId: 'R-clay' },
    { top: 6.0, base: 6.41, f: B_SAND_LOOSE_R, layerId: 'R-loose' },
    { top: 6.41, base: 7.19, f: B_SAND_MD_R, layerId: 'R-md' },
    { top: 7.19, base: 11.03, f: B_SAND_D_R, layerId: 'R-d' },
  ])
  return {
    columns: [left, right],
    edges: [
      { a: 'L-clay', b: 'R-clay', aSide: 'top', bSide: 'top' },
      { a: 'L-clay', b: 'R-loose', aSide: 'base', bSide: 'top' },
    ],
    alongM: [646.7, 724.8],
  }
}

describe('every band closes its own loop and ONE matrix fills the rest, as in the litho model', () => {
  // OWNER OVERRIDE, 2026-08-18 round 3, verbatim: *"the loose sand stopped emitting
  // an onlap. also that is not what i asked, let the matrix flood that triangle, in
  // my eyes here, the matrix is a md sand, just emit the closed loops (lenses and
  // onlaps and let matrix fill, as in the litho model?"* — and his addendum:
  // *"ofcourse the dense sand has no ties on that side, so it emits a lens, a closed
  // loop."*
  //
  // This REPLACES the round-2 expectation on this scene, which asserted the DENSE
  // sand filled the channel because it was the thickest band in the window. He has
  // explicitly overridden that value: the matrix is the band sitting UNDER the tie
  // line once the crust that pinches out is skipped — the MEDIUM-DENSE sand — not
  // the biggest mass in the window.

  it('the loose crust emits its onlap — a closed wedge, not a band that vanished', () => {
    const { columns, edges, alongM } = sceneB()
    const regions = fill(columns, edges, alongM)

    // 2/1/0 is the law: the crust's top IS the tie, its base is untied → ONE
    // correlation → it onlaps. That wedge must exist as a drawn face.
    const loose = extentOf(regions, 0, B_SAND_LOOSE_R)
    expect(loose).not.toBeNull()
    // It laps its own tie, so it never rises above the tie's own right endpoint.
    expect(loose!.hi).toBeLessThanOrEqual(7.03 + 1e-6)
    // And it is CLOSED: a wedge that stops at its apex on the tie, never a face that
    // runs on down to the left borehole's floor at +4.23. This is what the loop
    // failing to close looked like — the crust's flank bounded no face at all, so its
    // paint spread over the whole channel instead.
    expect(loose!.lo).toBeGreaterThan(4.23 + 1e-6)
    // And it is a WEDGE, not the channel: near the right borehole, just under the
    // tie, the crust is what is drawn.
    expect(formationAt(regions, 0, 0.95, 6.7)).toBe(B_SAND_LOOSE_R)
  })

  it('the MEDIUM-DENSE sand is the matrix and floods the rest up to the tie', () => {
    const { columns, edges, alongM } = sceneB()
    const regions = fill(columns, edges, alongM)

    // "the matrix is a md sand". Walking down from the clay-base tie at the right
    // borehole: the crust pinches out (it has its own closed loop), so the first
    // band that stays is the medium-dense sand — that is the channel's matrix, and
    // it fills everything the closed loops do not claim, right up to the tie.
    expect(formationAt(regions, 0, 0.5, 5.0)).toBe(B_SAND_MD_R)
    expect(formationAt(regions, 0, 0.75, 5.5)).toBe(B_SAND_MD_R)
  })

  it('the dense sand has no ties on that side, so it stays inside its own closed loop', () => {
    const { columns, edges, alongM } = sceneB()
    const regions = fill(columns, edges, alongM)

    // Its own band is +5.84 → +2.00. It lenses; whatever its closed loop does not
    // claim belongs to the matrix, so it never reaches up toward the tie.
    const d = extentOf(regions, 0, B_SAND_D_R)
    expect(d).not.toBeNull()
    expect(d!.hi).toBeLessThanOrEqual(5.84 + 1e-6)
  })
})
