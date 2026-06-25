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
// Pinned claims (R1 — per-sub-band band/onlap/lens from geotechEdges):
//   GR1  both bounding contacts tied → sub-band is a BAND quad.
//   GR2  only the TOP contact tied → ONLAP triangle on the left column, tip on the
//        top bracket (the band pinches from the top).
//   GR3  only the BASE contact tied → ONLAP triangle on the left column, tip on
//        the base bracket (the band pinches from the base).
//   GR4  neither contact tied → LENS triangle on the left column, tip at mid-elev.
//   GR5  litho-region framing (gapIndex, bodyId, kind) is preserved on every
//        output region (R1 sub-bands inherit the parent's identity fields).

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
  // R1 — per-sub-band band/onlap/lens from geotech packing edges
  // -------------------------------------------------------------------------
  //
  // Setup for all R1 tests:
  //   region   = sand quad band 0–6 m (elev 10→4), COLS flat at surf=10.
  //   Left col = sub-bands L-top (0–3 m, layerId 'lt') + L-bot (3–6 m, layerId 'lb').
  //   Right col = sub-bands R-top (0–3 m, layerId 'rt') + R-bot (3–6 m, layerId 'rb').
  //   Fractions: leftFrac=0, rightFrac=1 (two-column gap, COLS = [L, R]).
  //
  // The correlation count per sub-band is determined by how many of its bounding
  // contacts have a geotech packing edge to ANY layer on the neighbour column:
  //   Top contact keyed by OWN layerId ('lt'), base contact keyed by NEXT layerId ('lb').
  //   Edge('lt','rt') ties the top contact of L-top to the right column (band-top tied).
  //   Edge('lb','rb') ties the base contact of L-top (= top of L-bot) to the right.
  //   2 edges (lt↔rt + lb↔rb) → L-top BANDS toward right (count=2).
  //   1 edge (lt↔rt only) → L-top ONLAPS (count=1, top tied).
  //   0 edges → L-top LENSES (count=0).

  it('GR1 — both bounding contacts tied → sub-band is a BAND quad spanning both columns', () => {
    // Tie both top and base contacts of the top sand sub-band:
    //   lt↔rt (top of L-top ↔ top of R-top) and lb↔rb (base of L-top = base of R-top).
    // L-top and R-top → BAND. L-bot and R-bot → also BAND (edge lb↔rb ties L-bot's top).
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [subR1(0, 3, 'loose', 'lt'), subR1(3, 6, 'dense', 'lb')]],
      ['R', [subR1(0, 3, 'loose', 'rt'), subR1(3, 6, 'dense', 'rb')]],
    ])
    const edges: CorrelationEdge[] = [edge('lt', 'rt'), edge('lb', 'rb')]

    const out = subdivideRegionsByGeotech([region], COLS, subs, edges)

    // Two cross-column band quads (upper 'loose', lower 'dense').
    const quads = out.filter((r) => r.kind === 'quad')
    expect(quads.length).toBeGreaterThanOrEqual(1)
    // Every quad must have 4 vertices — the full left+right column span.
    for (const q of quads) {
      expect(q.polygon.length).toBe(4)
      // Vertices at both fraction 0 (left) and fraction 1 (right).
      expect(q.polygon.some((p) => p.fraction === 0)).toBe(true)
      expect(q.polygon.some((p) => p.fraction === 1)).toBe(true)
    }
    // The 'loose' quad must exist and span the top of the band.
    const looseQuad = quads.find((r) => r.formationId === 'loose')
    expect(looseQuad).toBeDefined()
    expect(Math.max(...looseQuad!.polygon.map((p) => p.elevation))).toBeCloseTo(10) // parent top
    expect(Math.min(...looseQuad!.polygon.map((p) => p.elevation))).toBeCloseTo(7) // split at 3 m depth
  })

  it('GR2 — only the TOP contact tied → ONLAP overlay, tip on the top bracket', () => {
    // L-top top contact: edge('lt','rt') → top tied.
    // L-top base contact: layerId 'lb', NO edge('lb',*) → base NOT tied.
    // Count = 1, topCorr = true → onlap with tip at the top bracket elevation (topL).
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [subR1(0, 3, 'loose', 'lt'), subR1(3, 6, 'dense', 'lb')]],
      ['R', [subR1(0, 3, 'loose', 'rt'), subR1(3, 6, 'dense', 'rb')]],
    ])
    const edges: CorrelationEdge[] = [edge('lt', 'rt')] // top only

    const out = subdivideRegionsByGeotech([region], COLS, subs, edges)

    // At least one onlap overlay must appear.
    const onlaps = out.filter((r) => r.overlayTier === 'onlap')
    expect(onlaps.length).toBeGreaterThanOrEqual(1)
    const looseOnlap = onlaps.find((r) => r.formationId === 'loose')
    expect(looseOnlap).toBeDefined()
    // Triangle: 3 vertices.
    expect(looseOnlap!.polygon.length).toBe(3)
    // Anchored to left column (fraction 0).
    expect(looseOnlap!.polygon.filter((p) => p.fraction === 0).length).toBe(2)
    // Tip fraction is strictly inside the gap (between 0 and 1).
    const tipFracs = looseOnlap!.polygon.filter((p) => p.fraction > 0 && p.fraction < 1)
    expect(tipFracs.length).toBe(1)
    // Top bracket tied → tip elevation equals the sub-band's top elevation (10).
    expect(tipFracs[0].elevation).toBeCloseTo(10)
  })

  it('GR3 — only the BASE contact tied → ONLAP overlay, tip on the base bracket', () => {
    // L-top base contact: edge('lb','rb') → base tied.
    // L-top top contact: layerId 'lt', NO edge('lt',*) → top NOT tied.
    // Count = 1, topCorr = false → onlap with tip at the base bracket elevation (baseL).
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [subR1(0, 3, 'loose', 'lt'), subR1(3, 6, 'dense', 'lb')]],
      ['R', [subR1(0, 3, 'loose', 'rt'), subR1(3, 6, 'dense', 'rb')]],
    ])
    const edges: CorrelationEdge[] = [edge('lb', 'rb')] // base only

    const out = subdivideRegionsByGeotech([region], COLS, subs, edges)

    const onlaps = out.filter((r) => r.overlayTier === 'onlap')
    expect(onlaps.length).toBeGreaterThanOrEqual(1)
    const looseOnlap = onlaps.find((r) => r.formationId === 'loose')
    expect(looseOnlap).toBeDefined()
    expect(looseOnlap!.polygon.length).toBe(3)
    // Base bracket tied → tip elevation equals the sub-band's base elevation (7 = surf 10 − 3 m).
    const tipFracs = looseOnlap!.polygon.filter((p) => p.fraction > 0 && p.fraction < 1)
    expect(tipFracs.length).toBe(1)
    expect(tipFracs[0].elevation).toBeCloseTo(7)
  })

  it('GR4 — neither contact tied → LENS overlay triangle on own column', () => {
    // No edges → count = 0 for every sub-band → lens overlays on both columns.
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [subR1(0, 3, 'loose', 'lt'), subR1(3, 6, 'dense', 'lb')]],
      ['R', [subR1(0, 3, 'loose', 'rt'), subR1(3, 6, 'dense', 'rb')]],
    ])
    const edges: CorrelationEdge[] = [] // nothing tied

    const out = subdivideRegionsByGeotech([region], COLS, subs, edges)

    const lenses = out.filter((r) => r.overlayTier === 'lens')
    expect(lenses.length).toBeGreaterThanOrEqual(1)
    // Every lens must be a triangle (3 vertices).
    for (const l of lenses) {
      expect(l.polygon.length).toBe(3)
    }
    // Left-column lenses anchor at fraction 0.
    const leftLenses = lenses.filter((l) => l.polygon.some((p) => p.fraction === 0))
    expect(leftLenses.length).toBeGreaterThanOrEqual(1)
    // Right-column lenses anchor at fraction 1.
    const rightLenses = lenses.filter((l) => l.polygon.some((p) => p.fraction === 1))
    expect(rightLenses.length).toBeGreaterThanOrEqual(1)
  })

  it('GR5 — R1 output preserves litho-region framing: gapIndex, bodyId, kind', () => {
    // Regression: every output region (band, onlap, lens) must inherit the parent
    // region's gapIndex and bodyId. The parent kind ('quad') is preserved on quads;
    // overlays carry kind:'lens' (the overlay marker) but still get the parent's
    // bodyId and gapIndex so geometry-check tooling can group them correctly.
    const region = quadBand('sand', 'b1', 10, 4)
    const subs = new Map<string, GeotechSubLayer[]>([
      ['L', [subR1(0, 3, 'loose', 'lt'), subR1(3, 6, 'dense', 'lb')]],
      ['R', [subR1(0, 3, 'loose', 'rt'), subR1(3, 6, 'dense', 'rb')]],
    ])
    // Mix: top tied (band for top pair), nothing for lower (lens).
    const edges: CorrelationEdge[] = [edge('lt', 'rt'), edge('lb', 'rb')]

    const out = subdivideRegionsByGeotech([region], COLS, subs, edges)

    for (const r of out) {
      expect(r.gapIndex).toBe(0) // inherited from parent
      expect(r.bodyId).toBe('b1') // inherited from parent
    }
    // At least one quad sub-band is present.
    expect(out.some((r) => r.kind === 'quad')).toBe(true)
  })
})
