/**
 * partitionFillV2.bandAuthority.test.ts — band-first tiling behavioural gate
 * (design partition-engine-v2.md §4 increment-7 "band-first tiling"; the
 * cs1bandauthority defect).
 *
 * Written in the OWNER's vocabulary, not engine-variable terms:
 *
 *   "A correlated band runs tie-to-tie at full width; an uncorrelated unit facing
 *    it onlaps ONTO the band boundary, never THROUGH it."
 *
 * Before increment-7 a matched-pair band that was tied on only its TOP contact
 * (its base being each unit's own, untied contact) left its base OPEN in the
 * arrangement, so the facing untied unit's lone-side fill overran the band's
 * interior (CS1 gaps 11/13). The two cases below pin the fix:
 *
 *   (1) a top-tied band faces an untied unit that pinches BELOW it — the untied
 *       fill must not appear inside the band's own [base..top] rows.
 *   (2) the shared-matrix case: a matrix bands full-width and an odd (different-
 *       lithology) unit facing it onlaps against the band boundary, not through it.
 *
 * These would go RED on the pre-increment-7 engine (the untied unit filled the whole
 * interval width, up into the band's rows).
 */

import { describe, expect, it } from 'vitest'
import { computeSectionFillV2 } from './partitionFillV2'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const CLAY = 'clay'
const SAND = 'sand'
const SILT = 'silt'

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
      bodyId: null,
    })),
  }
}

/** The formation covering (fraction f, elevation e) in a gap, or null. Non-lens only. */
function coverAt(regions: SectionRegion[], gap: number, f: number, e: number): string | null {
  for (const r of regions) {
    if (r.gapIndex !== gap || r.kind === 'lens') continue
    if (inPoly(f, e, r.polygon)) return r.formationId
  }
  return null
}

/** Ray-cast point-in-polygon in fraction×elevation. */
function inPoly(f: number, e: number, poly: { fraction: number; elevation: number }[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const fi = poly[i].fraction
    const ei = poly[i].elevation
    const fj = poly[j].fraction
    const ej = poly[j].elevation
    if (ei > e !== ej > e && f < ((fj - fi) * (e - ei)) / (ej - ei) + fi) inside = !inside
  }
  return inside
}

describe('band-first tiling — a band is authoritative; a facing untied unit onlaps ONTO it, never through', () => {
  it('a top-tied band runs tie-to-tie at full width; the untied unit below it never fills its interior', () => {
    // The band: SILT tied top-to-top across the gap. On the left the SILT is thin
    // (its base is its own contact, NOT tied); on the right the SILT is thicker so a
    // DIFFERENT unit (SAND) sits between the SILT base and the next tie. Pre-fix the
    // right SAND filled lone-side across the WHOLE gap, up into the SILT band rows.
    const lClay = layer()
    const lSilt = layer()
    const lKlei2 = layer()
    const rClay = layer()
    const rSilt = layer()
    const rSand = layer()
    const rKlei2 = layer()
    // Left: CLAY, SILT (thin), CLAY.  Right: CLAY, SILT (thick), SAND, CLAY.
    const left = col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: lClay },
      { top: 3, base: 4, f: SILT, layerId: lSilt },
      { top: 4, base: 8, f: CLAY, layerId: lKlei2 },
    ])
    const right = col('R', 10, [
      { top: 0, base: 3, f: CLAY, layerId: rClay },
      { top: 3, base: 5, f: SILT, layerId: rSilt },
      { top: 5, base: 6, f: SAND, layerId: rSand },
      { top: 6, base: 8, f: CLAY, layerId: rKlei2 },
    ])
    // SILT top tie (the band) + the CLAY-below top tie (so the SILT base reads
    // banded on the LEFT via the derived rule, exactly like the CS1 shape).
    const edges: CorrelationEdge[] = [
      { a: lSilt, b: rSilt, aSide: 'top', bSide: 'top' },
      { a: lKlei2, b: rKlei2, aSide: 'top', bSide: 'top' },
    ]
    const regions = computeSectionFillV2([left, right], edges)
    // Sample INSIDE the SILT band's own rows on the left column side (elev 6.5, between
    // the SILT top elev 7 and base elev 6). The band must be SILT there — the facing
    // SAND must NOT have overrun into it.
    for (const f of [0.1, 0.3, 0.5]) {
      expect(coverAt(regions, 0, f, 6.5)).toBe(SILT)
    }
    // The discriminating sample: just above the SILT band's LEFT base (elev 6.15, band
    // base 6) very near the left column. Pre-band-first the facing SAND filled
    // lone-side across the whole gap up to elev ~6.33 here, overrunning the SILT band's
    // interior — this reads SAND. Band-first confines the SAND below the band base, so
    // this row is SILT (the band's own lithology). This assertion goes RED on the
    // pre-fix engine.
    expect(coverAt(regions, 0, 0.05, 6.15)).toBe(SILT)
    // And the SAND onlaps only BELOW the band, near the right column (elev 4.5).
    expect(coverAt(regions, 0, 0.95, 4.5)).toBe(SAND)
  })

  it('shared-matrix: the top CLAY matrix bands full-width; the odd SILT below it onlaps ONTO the band base', () => {
    // The CS1-shape shared-matrix case: a top CLAY band (full-width, tie-to-tie) sits
    // over a bottom SAND band. On the RIGHT a SILT unit is wedged between the CLAY
    // band's base and the SAND band's top (the left CLAY reaches deeper, so no SILT
    // there). The SILT must onlap into the gap ONTO the CLAY band's base — it must NOT
    // paint over the full-width top CLAY band's own rows above it.
    const lClayTop = layer()
    const lSand = layer()
    const rClayTop = layer()
    const rSilt = layer()
    const rSand = layer()
    // Left: CLAY(0-5), SAND(5-8).  Right: CLAY(0-3), SILT(3-5), SAND(5-8).
    const left = col('L', 10, [
      { top: 0, base: 5, f: CLAY, layerId: lClayTop },
      { top: 5, base: 8, f: SAND, layerId: lSand },
    ])
    const right = col('R', 10, [
      { top: 0, base: 3, f: CLAY, layerId: rClayTop },
      { top: 3, base: 5, f: SILT, layerId: rSilt },
      { top: 5, base: 8, f: SAND, layerId: rSand },
    ])
    // Top-CLAY band (tops tied) + bottom-SAND band (tops tied) — the SILT between them
    // is uncorrelated, so it onlaps against the bands.
    const edges: CorrelationEdge[] = [
      { a: lClayTop, b: rClayTop, aSide: 'top', bSide: 'top' },
      { a: lSand, b: rSand, aSide: 'top', bSide: 'top' },
    ]
    const regions = computeSectionFillV2([left, right], edges)
    // The top-CLAY band's own rows must read CLAY ALL THE WAY ACROSS — the SILT must
    // not overrun up into it anywhere. The band base slopes from left elev 5 to right
    // elev 7 (each column's own CLAY base), so elev 8 is inside the band at EVERY
    // fraction. The banded matrix owns its rows; the odd unit terminates below it.
    for (const f of [0.1, 0.4, 0.7, 0.9]) {
      expect(coverAt(regions, 0, f, 8)).toBe(CLAY)
    }
    // The SILT still exists as its own onlap region (below the CLAY band, above SAND).
    const silt = regions.filter((r) => r.gapIndex === 0 && r.formationId === SILT)
    expect(silt.length).toBeGreaterThanOrEqual(1)
  })
})
