/**
 * partitionFillV2/computeSectionFillV2.fallback.test.ts — region PROVENANCE
 * (slice 4 of "persist geometric body identity").
 *
 * The engine paints two kinds of region the drilled data never touched: the sub-TD
 * SUBSTRATE wedge (``emitBottomTieSubstrate`` — no column vertical reaches below a
 * shallow TD) and the FLOOD-closure wedge past a termination apex (``emitLonePinch`` /
 * ``emitFloodWedge``). Both emit ``klass: 'band'`` → ``kind: 'quad'``, indistinguishable
 * from a tie-born band in the output. These gates pin the new ``fallback: true`` marker:
 * fallback-painted regions carry it, tie-born band / onlap / lens regions never do, and
 * the marker does not flip with ``twoSidedTerminationsEnabled()`` (the substrate case is
 * reachable on BOTH label paths; the flood-label wedge only occurs flag-OFF — flag-ON's
 * enclosing flood carries column verticals, so it is drilled-labelled, not fallback).
 */

import { afterEach, describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const CLAY = 'clay'
const SAND = 'sand'

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

/** Ray-cast point-in-polygon in fraction×elevation space. */
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

/** The region covering (f, e) in a gap, or undefined. */
function regionAt(regions: SectionRegion[], gap: number, f: number, e: number): SectionRegion | undefined {
  return regions.find((r) => r.gapIndex === gap && inPoly(f, e, r.polygon))
}

/**
 * The substrate fixture: a SAND band tied top-top + base-base whose tied base SLOPES
 * (left TD elev −2, right TD elev 2). The wedge between the sloping tied base and the
 * flat bottom-tie floor (elev −2) is sub-TD on the right — no column vertical reaches
 * it, so it is painted from the substrate label authority (``emitBottomTieSubstrate``).
 */
function substrateFixture(): { columns: PartitionColumn[]; edges: CorrelationEdge[] } {
  seq = 0
  const lClay = layer()
  const lSand = layer()
  const rClay = layer()
  const rSand = layer()
  const columns = [
    col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: lClay },
      { top: 3, base: 12, f: SAND, layerId: lSand }, // deep TD at elev −2
    ]),
    col('R', 10, [
      { top: 0, base: 3, f: CLAY, layerId: rClay },
      { top: 3, base: 8, f: SAND, layerId: rSand }, // shallower TD at elev 2
    ]),
  ]
  const edges: CorrelationEdge[] = [
    { a: lSand, b: rSand, aSide: 'top', bSide: 'top' },
    { a: lSand, b: rSand, aSide: 'base', bSide: 'base' },
  ]
  return { columns, edges }
}

describe('computeSectionFillV2 — fallback provenance: substrate/flood fill is marked, tie-born fill is not', () => {
  afterEach(() => {
    setTwoSidedTerminations(false)
  })

  it('the sub-TD substrate wedge carries fallback: true; the tied band above it does not (flag OFF)', () => {
    const { columns, edges } = substrateFixture()
    const regions = computeSectionFillV2(columns, edges, undefined, [0, 40])
    // The wedge interior: at f=0.9 the tied base sits at elev 1.6, the floor at −2.
    const wedge = regionAt(regions, 0, 0.9, -1)
    expect(wedge).toBeDefined()
    expect(wedge!.formationId).toBe(SAND)
    expect(wedge!.fallback).toBe(true)
    // The tie-born band interior (between the top tie at 7 and the sloping base).
    const band = regionAt(regions, 0, 0.5, 5)
    expect(band).toBeDefined()
    expect(band!.formationId).toBe(SAND)
    expect(band!.fallback).toBeUndefined()
  })

  it('the substrate marker does not flip with the engine flag (flag ON / seeded label path)', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      const { columns, edges } = substrateFixture()
      const regions = computeSectionFillV2(columns, edges, undefined, [0, 40])
      const wedge = regionAt(regions, 0, 0.9, -1)
      expect(wedge).toBeDefined()
      expect(wedge!.formationId).toBe(SAND)
      expect(wedge!.fallback).toBe(true)
      const band = regionAt(regions, 0, 0.5, 5)
      expect(band).toBeDefined()
      expect(band!.formationId).toBe(SAND)
      expect(band!.fallback).toBeUndefined()
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('a flood-closure wedge carries fallback: true; the lensing unit and the tied band do not', () => {
    // The lone-side pinch shape (finding A): left CLAY over SAND, right all SAND, sand
    // tops tied. The CLAY lenses; the vacated width past its apex is claimed by the
    // facing SAND through the FLOOD label authority (``emitLonePinch``) — no column
    // vertical bounds that wedge, so it must carry the fallback marker.
    seq = 0
    const lClay = layer()
    const lSand = layer()
    const rSand = layer()
    const columns = [
      col('L', 10, [
        { top: 0, base: 2, f: CLAY, layerId: lClay },
        { top: 2, base: 8, f: SAND, layerId: lSand },
      ]),
      col('R', 10, [{ top: 0, base: 8, f: SAND, layerId: rSand }]),
    ]
    const edges: CorrelationEdge[] = [{ a: lSand, b: rSand, aSide: 'top', bSide: 'top' }]
    const regions = computeSectionFillV2(columns, edges, undefined, [0, 40])
    // The flood wedge: above the sloping sand-top tie (el 8 → 10, i.e. 9.4 at f=0.7),
    // past the clay apex (< 0.6) and below the surface (10).
    const flood = regionAt(regions, 0, 0.7, 9.7)
    expect(flood).toBeDefined()
    expect(flood!.formationId).toBe(SAND)
    expect(flood!.fallback).toBe(true)
    // The tie-born SAND band below the tie is drilled fill — never marked.
    const band = regionAt(regions, 0, 0.5, 5)
    expect(band).toBeDefined()
    expect(band!.formationId).toBe(SAND)
    expect(band!.fallback).toBeUndefined()
    // The lensing CLAY (a termination of drilled data) is never marked either.
    const clay = regions.filter((r) => r.formationId === CLAY)
    expect(clay.length).toBeGreaterThanOrEqual(1)
    for (const r of clay) expect(r.fallback).toBeUndefined()
  })
})
