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
// Pinned claims:
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

import { describe, expect, it } from 'vitest'

import { subdivideRegionsByGeotech, type GeotechSubLayer } from './geotechSubdivide'
import type { PartitionColumn, SectionRegion } from './partitionFill'

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
})
