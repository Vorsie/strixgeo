// Behavioural net for the geotech fill = litho partition, subdivided by NAD.
//
// Owner directive (2026-06-24, repeated): "keep the structure from the litho
// and only subdivide inside a body" / "EXACT same shape, only subdivide inside
// that polygon". The geotech section fill is the LITHO partition (computed from
// litho layers + litho edges) with each region subdivided into NAD packing
// sub-bands by the geotech sub-layer depths on the two bounding columns.
//
// The load-bearing rule the user stressed: subdividing must add CLEAN HORIZONTAL
// sub-bands that span the whole body (a consistent split), NEVER spurious new
// wedges manufactured from per-column noise. So when the two columns of a gap
// disagree on the sub-band sequence, the region is kept WHOLE (one band, the
// dominant NAD) — no extra wedge is created.
//
// Pinned claims (R0 — all-or-nothing body_id mode, no geotechEdges):
//   GS1  consistent 2-way split → 2 sub-quads tiling the parent band, split at
//        the paired (leftSplitElev, rightSplitElev); coloured by NAD formation.
//   GS2  one-class body (1 sub-layer both sides) → 1 region, parent polygon kept,
//        recoloured to the NAD formation.
//   GS3  count/sequence MISMATCH across the gap → fallback ONE band (no new
//        wedge), tagged with the dominant NAD (largest elevation overlap).
//   GS4  a pinch/lens region is NOT subdivided — tagged by its dominant NAD only.
//   GS5  the sub-bands TILE the parent: their elevation spans are contiguous and
//        cover exactly the parent band (no gap, no overlap) on each column.
//   GS6  a body with NO geotech sub-layers → region returned unchanged (keeps its
//        litho formationId; the caller's colour map falls back).
//
// Pinned claims (R1 — carve via computeSectionFill, the gap-free partition):
//   GR1  matching loose/dense stacks band into a gap-free 2-class partition.
//   GR2  a class present on one column only pinches into the surrounding matrix
//        and the region STILL tiles (the dogfeed "gaps appeared" regression guard).
//   GR3  matching stacks band + tile even with NO geotech edges (geometry banding).
//   GR4  a one-column-only NAD stack can't form a 2-col partition → R0 recolour
//        fallback (whole region kept, no gap).
//   GR5  litho-region framing (gapIndex, bodyId) is preserved on every output.
//   GR6  a packing band chains THROUGH a borehole — boreholes (no qc) adopt the
//        nearest CPT's class sequence; you can't correlate packing to a borehole.

import { describe, expect, it } from 'vitest'

import { subdivideRegionsByGeotech, type GeotechSubLayer } from './geotechSubdivide'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './partitionFill'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function col(id: string, surfaceElevM: number): PartitionColumn {
  return { investigationId: id, surfaceElevM, units: [] }
}

/** A quad litho band on gap 0 spanning depth [topDepth, baseDepth] (both columns
 *  flat at surfaceElev 10 for simplicity). */
function quadBand(
  formationId: string,
  bodyId: string,
  topElev: number,
  baseElev: number,
): SectionRegion {
  return {
    formationId,
    bodyId,
    kind: 'quad',
    gapIndex: 0,
    polygon: [
      { fraction: 0, elevation: topElev },
      { fraction: 1, elevation: topElev },
      { fraction: 1, elevation: baseElev },
      { fraction: 0, elevation: baseElev },
    ],
  }
}

const COLS = [col('L', 10), col('R', 10)]

// ``srcLitho`` defaults to 'sand' — the soil of the test regions (quadBand
// 'sand') — so a sub matches the region unless a test overrides it to a
// different litho formation (GS9 exercises the soil filter). ``bodyId`` is the
// resolver geotech ``litho_layer.body_id``: two paired sub-bands connect across
// the gap only when they share a non-null ``bodyId`` (GS1/GS5/GS7 split; GS8 keeps
// whole on differing bodies). Defaults to null so a test that does not care about
// connection (single-class / mismatch / pinch) keeps the fallback path.
function sub(
  top: number,
  base: number,
  formationId: string,
  bodyId: string | null = null,
  srcLitho = 'sand',
): GeotechSubLayer {
  return {
    topDepthM: top,
    baseDepthM: base,
    formationId,
    bodyId,
    sourceLithoFormationId: srcLitho,
  }
}

// R1 variant: same as ``sub()`` but also carries a ``layerId`` (the geotech
// ``litho_layer.id``) for the per-sub-band band/onlap/lens classification.
function subR1(
  top: number,
  base: number,
  formationId: string,
  layerId: string,
  srcLitho = 'sand',
): GeotechSubLayer {
  return {
    topDepthM: top,
    baseDepthM: base,
    formationId,
    bodyId: null,
    sourceLithoFormationId: srcLitho,
    layerId,
  }
}

// Build a geotech packing edge (top-keyed, no aSide/bSide = top by default).
function edge(a: string, b: string): CorrelationEdge {
  return { a, b }
}

// ---------------------------------------------------------------------------
// GS1 — consistent 2-way split
// ---------------------------------------------------------------------------

describe('subdivideRegionsByGeotech', () => {
  it('GS1 — a consistent loose/dense split becomes two sub-quads tiling the band', () => {
    // Litho sand band 0–6 m (elev 10→4). Both columns split loose 0–3 / dense 3–6,
    // and the paired sub-bands share a resolver body (loose↔B-loose, dense↔B-dense),
    // so they connect into cross-column sub-quads.
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [sub(0, 3, 'loose', 'B-loose'), sub(3, 6, 'dense', 'B-dense')]],
      ['R', [sub(0, 3, 'loose', 'B-loose'), sub(3, 6, 'dense', 'B-dense')]],
    ])

    const out = subdivideRegionsByGeotech([region], COLS, subs)

    expect(out.length).toBe(2)
    // NAD formations in depth order (top band first).
    expect(out.map((r) => r.formationId)).toEqual(['loose', 'dense'])
    // Upper sub-band: top elev 10 (band top), base elev 7 (= surf 10 − split 3).
    const upper = out[0]
    expect(Math.max(...upper.polygon.map((p) => p.elevation))).toBeCloseTo(10)
    expect(Math.min(...upper.polygon.map((p) => p.elevation))).toBeCloseTo(7)
    // Lower sub-band: top elev 7, base elev 4 (band base).
    const lower = out[1]
    expect(Math.max(...lower.polygon.map((p) => p.elevation))).toBeCloseTo(7)
    expect(Math.min(...lower.polygon.map((p) => p.elevation))).toBeCloseTo(4)
    // Parent identity preserved.
    expect(upper.bodyId).toBe('b1')
    expect(upper.gapIndex).toBe(0)
  })

  it('GS2 — a one-class body with a resolver body_id keeps the parent shape, recoloured to its NAD', () => {
    // Both columns carry a SINGLE dense sub-band sharing a non-null resolver bodyId
    // (B-dense), so the packing connects across the gap → the 1-element
    // ``sequencesMatch === true`` split path emits one full-band sub-quad. A single
    // sub-quad spanning the whole band equals the parent polygon.
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [sub(0, 6, 'dense', 'B-dense')]],
      ['R', [sub(0, 6, 'dense', 'B-dense')]],
    ])

    const out = subdivideRegionsByGeotech([region], COLS, subs)

    expect(out.length).toBe(1)
    expect(out[0].formationId).toBe('dense')
    // Single sub-quad spanning the band == parent polygon (same shape).
    expect(out[0].polygon).toEqual(region.polygon)
  })

  it('GS2b — a single band with no resolver body falls back to dominant NAD', () => {
    // The OLD GS2 case: both columns carry a single dense sub-band but with a NULL
    // bodyId, so the packing does NOT connect across the gap. The region is kept
    // whole via the ``dominantNad`` fallback (not the ``sequencesMatch`` split path)
    // — still one region, parent polygon, recoloured to the dominant NAD.
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [sub(0, 6, 'dense')]],
      ['R', [sub(0, 6, 'dense')]],
    ])

    const out = subdivideRegionsByGeotech([region], COLS, subs)

    expect(out.length).toBe(1)
    expect(out[0].formationId).toBe('dense')
    // Parent polygon unchanged (same shape).
    expect(out[0].polygon).toEqual(region.polygon)
  })

  it('GS3 — a column mismatch falls back to ONE band (no new wedge), dominant NAD', () => {
    // Left splits loose/dense; right is all dense → sequences differ. The owner
    // rule: do NOT invent a wedge; keep the band whole, coloured by the dominant
    // NAD (dense covers 3 m left + 6 m right = 9 m vs loose 3 m).
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [sub(0, 3, 'loose'), sub(3, 6, 'dense')]],
      ['R', [sub(0, 6, 'dense')]],
    ])

    const out = subdivideRegionsByGeotech([region], COLS, subs)

    expect(out.length).toBe(1)
    expect(out[0].formationId).toBe('dense')
    expect(out[0].polygon).toEqual(region.polygon)
  })

  it('GS4 — a pinch region is tagged by dominant NAD, never subdivided', () => {
    // Left pinch triangle: top+base at fraction 0, tip at mid-gap.
    const pinch: SectionRegion = {
      formationId: 'sand',
      bodyId: 'b2',
      kind: 'pinch',
      gapIndex: 0,
      polygon: [
        { fraction: 0, elevation: 10 },
        { fraction: 0.5, elevation: 7 },
        { fraction: 0, elevation: 4 },
      ],
    }
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [sub(0, 3, 'loose'), sub(3, 6, 'dense')]],
      ['R', []],
    ])

    const out = subdivideRegionsByGeotech([pinch], COLS, subs)

    // Not subdivided — one region, original polygon, dominant NAD (loose+dense
    // tie 3 m each on the only column → first-in-depth wins deterministically).
    expect(out.length).toBe(1)
    expect(out[0].kind).toBe('pinch')
    expect(out[0].polygon).toEqual(pinch.polygon)
    expect(['loose', 'dense']).toContain(out[0].formationId)
  })

  it('GS5 — sub-bands tile the parent band: contiguous, gap-free, overlap-free', () => {
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [sub(0, 2, 'a', 'B-a'), sub(2, 4, 'b', 'B-b'), sub(4, 6, 'c', 'B-c')]],
      ['R', [sub(0, 2, 'a', 'B-a'), sub(2, 4, 'b', 'B-b'), sub(4, 6, 'c', 'B-c')]],
    ])

    const out = subdivideRegionsByGeotech([region], COLS, subs)

    expect(out.length).toBe(3)
    // On the left column (fraction 0), each sub-band's base equals the next's top.
    const leftSpans = out.map((r) => {
      const ys = r.polygon.filter((p) => p.fraction === 0).map((p) => p.elevation)
      return { top: Math.max(...ys), base: Math.min(...ys) }
    })
    expect(leftSpans[0].top).toBeCloseTo(10) // parent top
    expect(leftSpans[leftSpans.length - 1].base).toBeCloseTo(4) // parent base
    for (let i = 0; i + 1 < leftSpans.length; i += 1) {
      expect(leftSpans[i].base).toBeCloseTo(leftSpans[i + 1].top) // contiguous
    }
  })

  it('GS6 — a body with no geotech sub-layers is returned unchanged', () => {
    const region = quadBand('sand', 'b1', 10, 4)
    const out = subdivideRegionsByGeotech([region], COLS, new Map())
    expect(out.length).toBe(1)
    expect(out[0].formationId).toBe('sand') // litho id kept (no NAD data)
    expect(out[0].polygon).toEqual(region.polygon)
  })

  it('GS7 — paired sub-bands sharing a geotech body_id connect into cross-column sub-quads', () => {
    // Same geometry as GS1 but stated as the body_id rule directly: each NAD class
    // shares a non-null bodyId across the two columns (top↔B-top, base↔B-base) → the
    // band splits into TWO cross-column sub-quads tiling the parent.
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [sub(0, 3, 'loose', 'B-top'), sub(3, 6, 'dense', 'B-base')]],
      ['R', [sub(0, 3, 'loose', 'B-top'), sub(3, 6, 'dense', 'B-base')]],
    ])

    const out = subdivideRegionsByGeotech([region], COLS, subs)

    expect(out.length).toBe(2)
    expect(out.map((r) => r.formationId)).toEqual(['loose', 'dense'])
    // Upper sub-band: top elev 10 (band top), base elev 7 (= surf 10 − split 3).
    const upper = out[0]
    expect(Math.max(...upper.polygon.map((p) => p.elevation))).toBeCloseTo(10)
    expect(Math.min(...upper.polygon.map((p) => p.elevation))).toBeCloseTo(7)
    // Lower sub-band: top elev 7, base elev 4 (band base).
    const lower = out[1]
    expect(Math.max(...lower.polygon.map((p) => p.elevation))).toBeCloseTo(7)
    expect(Math.min(...lower.polygon.map((p) => p.elevation))).toBeCloseTo(4)
  })

  it('GS8 — sub-bands with DIFFERENT body_ids stay separate: kept whole, dominant NAD', () => {
    // Same geometry + NAD classes as GS7, but the top bands belong to DIFFERENT
    // resolver bodies (B-top-L vs B-top-R) — the packing does NOT connect across the
    // gap, so no sub-quad is manufactured: ONE region, parent polygon, dominant NAD.
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [sub(0, 3, 'loose', 'B-top-L'), sub(3, 6, 'dense', 'B-base')]],
      ['R', [sub(0, 3, 'loose', 'B-top-R'), sub(3, 6, 'dense', 'B-base')]],
    ])

    const out = subdivideRegionsByGeotech([region], COLS, subs)

    expect(out.length).toBe(1)
    // tie 6 m each (3 m × 2 columns for both); first-seen wins, but the assertion is
    // intentionally loose — the WHOLE-BAND outcome is the load-bearing claim, not the
    // tie-winner.
    expect(out[0].polygon).toEqual(region.polygon)
    expect(['loose', 'dense']).toContain(out[0].formationId)
  })

  it('GS9 — a region is subdivided only by SAME-soil sub-layers (wrong-soil filter)', () => {
    // A SAND band (0–6 m). The column carries a sand NAD sub-layer over the whole
    // band PLUS a clay NAD sub-layer at an overlapping depth (the wrong-soil trap:
    // depth-overlap alone would let the clay recolour the sand band). Only the
    // sand sub-layer (sourceLithoFormationId === 'sand') may be used.
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [sub(0, 6, 'sand-dense', null, 'sand'), sub(2, 5, 'clay-stiff', null, 'clay')]],
      ['R', [sub(0, 6, 'sand-dense', null, 'sand'), sub(2, 5, 'clay-stiff', null, 'clay')]],
    ])

    const out = subdivideRegionsByGeotech([region], COLS, subs)

    // One sub-band, the SAND NAD class — never the clay one.
    expect(out.length).toBe(1)
    expect(out[0].formationId).toBe('sand-dense')
    expect(out.some((r) => r.formationId === 'clay-stiff')).toBe(false)
  })

  // -------------------------------------------------------------------------
  // R1 — carve each region into packing bands/onlaps/lenses via computeSectionFill
  // -------------------------------------------------------------------------
  //
  // R1 reuses the litho partition engine PER litho region, so the geotech fill is
  // a true PARTITION (no holes — the dogfeed "gaps appeared" regression) exactly
  // like litho: matching packing stacks band, a class present on one column only
  // pinches into the surrounding-class matrix (the owner's "litho body is the
  // matrix, carve the packing into it"). The load-bearing regression guard is the
  // no-gap / tiling assertion, NOT any specific triangle shape.

  /** Main (tiling) regions only — quad + pinch. Lens overlays deliberately
   *  overlap their matrix and are excluded from the tiling invariant. */
  function mains(out: readonly SectionRegion[]): SectionRegion[] {
    return out.filter((r) => r.kind !== 'lens')
  }

  /** Assert the MAIN regions tile [parentBase, parentTop] at a given column edge
   *  (fraction 0 = left, 1 = right) with no gap and no overlap — the no-gap guard. */
  function expectColumnTiled(
    out: readonly SectionRegion[],
    fraction: number,
    parentTop: number,
    parentBase: number,
  ): void {
    const spans = mains(out)
      .map((r) => {
        const ys = r.polygon
          .filter((p) => Math.abs(p.fraction - fraction) < 1e-9)
          .map((p) => p.elevation)
        return ys.length >= 2 ? { top: Math.max(...ys), base: Math.min(...ys) } : null
      })
      .filter((s): s is { top: number; base: number } => s !== null)
      .sort((a, b) => b.top - a.top) // shallow → deep
    expect(spans.length).toBeGreaterThanOrEqual(1)
    expect(spans[0].top).toBeCloseTo(parentTop) // shallowest reaches parent top
    expect(spans[spans.length - 1].base).toBeCloseTo(parentBase) // deepest reaches parent base
    for (let i = 0; i + 1 < spans.length; i += 1) {
      expect(spans[i].base).toBeCloseTo(spans[i + 1].top) // contiguous — no gap, no overlap
    }
  }

  it('GR1 — matching loose/dense stacks band into a gap-free 2-class partition', () => {
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [subR1(0, 3, 'loose', 'lt'), subR1(3, 6, 'dense', 'lb')]],
      ['R', [subR1(0, 3, 'loose', 'rt'), subR1(3, 6, 'dense', 'rb')]],
    ])
    const edges: CorrelationEdge[] = [edge('lt', 'rt'), edge('lb', 'rb')]

    const out = subdivideRegionsByGeotech([region], COLS, subs, edges)

    // Both NAD classes present; the region tiles with no gap on each column edge.
    expect(out.some((r) => r.formationId === 'loose')).toBe(true)
    expect(out.some((r) => r.formationId === 'dense')).toBe(true)
    expectColumnTiled(out, 0, 10, 4)
    expectColumnTiled(out, 1, 10, 4)
  })

  it('GR2 — a pinching class still tiles the region (the no-gap regression guard)', () => {
    // dense/loose/dense on the left, dense-only on the right → the loose pinches out
    // toward the right. The carve must keep the region a PARTITION (no holes): the
    // surrounding dense fills where the loose pinches. This is exactly the dogfeed
    // "gaps appeared" case — assert full coverage on BOTH columns.
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      [
        'L',
        [subR1(0, 2, 'dense', 'l1'), subR1(2, 4, 'loose', 'l2'), subR1(4, 6, 'dense', 'l3')],
      ],
      ['R', [subR1(0, 6, 'dense', 'r1')]],
    ])
    // dense bands top + bottom across; loose has no partner → pinches.
    const edges: CorrelationEdge[] = [edge('l1', 'r1'), edge('l3', 'r1')]

    const out = subdivideRegionsByGeotech([region], COLS, subs, edges)

    expectColumnTiled(out, 0, 10, 4) // left column: all three classes, no gap
    expectColumnTiled(out, 1, 10, 4) // right column: dense fills the pinch, no gap
    // The loose class is present (carved as a pinch into the dense matrix).
    expect(out.some((r) => r.formationId === 'loose')).toBe(true)
  })

  it('GR3 — even with NO geotech edges, matching stacks band and tile (no gaps)', () => {
    // R1 is enabled by passing an edges array (here empty). Matching stacks band by
    // geometry; the region must still be a gap-free partition.
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [subR1(0, 3, 'loose', 'lt'), subR1(3, 6, 'dense', 'lb')]],
      ['R', [subR1(0, 3, 'loose', 'rt'), subR1(3, 6, 'dense', 'rb')]],
    ])

    const out = subdivideRegionsByGeotech([region], COLS, subs, [])

    expectColumnTiled(out, 0, 10, 4)
    expectColumnTiled(out, 1, 10, 4)
    expect(out.some((r) => r.formationId === 'loose')).toBe(true)
    expect(out.some((r) => r.formationId === 'dense')).toBe(true)
  })

  it('GR4 — a one-column-only NAD stack falls back to R0 recolour (no carve, no gap)', () => {
    // Right column has no sub-bands for this soil → cannot form a 2-column
    // partition; fall through to the dominant-NAD whole-region recolour (gap-free).
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [subR1(0, 3, 'loose', 'lt'), subR1(3, 6, 'dense', 'lb')]],
      ['R', []],
    ])

    const out = subdivideRegionsByGeotech([region], COLS, subs, [edge('lt', 'rt')])

    expect(out.length).toBe(1)
    expect(out[0].polygon).toEqual(region.polygon) // whole region kept (no gap)
    expect(['loose', 'dense']).toContain(out[0].formationId)
  })

  it('GR5 — R1 output inherits the parent litho region framing (gapIndex, bodyId)', () => {
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [subR1(0, 3, 'loose', 'lt'), subR1(3, 6, 'dense', 'lb')]],
      ['R', [subR1(0, 3, 'loose', 'rt'), subR1(3, 6, 'dense', 'rb')]],
    ])
    const edges: CorrelationEdge[] = [edge('lt', 'rt'), edge('lb', 'rb')]

    const out = subdivideRegionsByGeotech([region], COLS, subs, edges)

    for (const r of out) {
      expect(r.gapIndex).toBe(0) // inherited from parent
      expect(r.bodyId).toBe('b1') // inherited from parent
    }
    expect(out.some((r) => r.kind === 'quad')).toBe(true)
  })

  it('GR6 — a packing band chains THROUGH a borehole (boreholes adopt nearest-CPT packing)', () => {
    // S6 (CPT) — B (borehole) — S13 (CPT). Both CPTs split the clay light/dark; the
    // borehole carries only a single extrapolated clay class. Boreholes have no qc,
    // so they CANNOT be correlated — the band must chain through them automatically:
    // the borehole adopts the nearest CPT's class sequence (projected onto its own
    // band depth), so both gaps band light + dark by geometry (owner 2026-06-26).
    const cols: PartitionColumn[] = [
      { investigationId: 'S6', surfaceElevM: 10, units: [] },
      { investigationId: 'B', surfaceElevM: 10, units: [] },
      { investigationId: 'S13', surfaceElevM: 10, units: [] },
    ]
    // Two clay quad regions: gap 0 (S6↔B) and gap 1 (B↔S13).
    const region0: SectionRegion = { ...quadBand('clay', 'b1', 10, 4), gapIndex: 0 }
    const region1: SectionRegion = { ...quadBand('clay', 'b1', 10, 4), gapIndex: 1 }
    const subs = new Map<string, GeotechSubLayer[]>([
      ['S6', [subR1(0, 3, 'light', 's6t', 'clay'), subR1(3, 6, 'dark', 's6b', 'clay')]],
      ['B', [subR1(0, 6, 'clay-single', 'bx', 'clay')]], // single extrapolated class
      ['S13', [subR1(0, 3, 'light', 's13t', 'clay'), subR1(3, 6, 'dark', 's13b', 'clay')]],
    ])
    const cptIds = new Set(['S6', 'S13'])

    const out = subdivideRegionsByGeotech([region0, region1], cols, subs, [], cptIds)

    // Both light and dark classes appear (the band chained through the borehole),
    // and the borehole's lone extrapolated 'clay-single' class is NOT used.
    expect(out.some((r) => r.formationId === 'light')).toBe(true)
    expect(out.some((r) => r.formationId === 'dark')).toBe(true)
    expect(out.some((r) => r.formationId === 'clay-single')).toBe(false)
    // Each gap still tiles its region (no gap introduced by the projection).
    expectColumnTiled(
      out.filter((r) => r.gapIndex === 0),
      0,
      10,
      4,
    )
    expectColumnTiled(
      out.filter((r) => r.gapIndex === 1),
      1,
      10,
      4,
    )
  })
})
