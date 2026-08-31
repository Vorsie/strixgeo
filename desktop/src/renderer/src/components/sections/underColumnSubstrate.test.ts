// Behaviour tests for the component-side under-column substrate (S60 Stage A).
//
// Owner rule (S60, verbatim): "below a column's TD, the space belongs to the
// PARTITION — the gap regions' fill must run continuously under the glyph".
// The v1 helper's stackAtEdge guard rejected any edge slice whose TOP sits
// above the column's TD; the v2 engine emits a column's own bottom unit as ONE
// region running continuously through the TD (no split at the TD line), so the
// guard threw the sand away and the deeper clay was extended up to the TD —
// the B2 phantom "clay directly under the sand" block (CS1, dogfeed 2026-07-19).
//
//   UCS-B2  a v2-shaped region straddling the shallow TD keeps its below-TD
//           portion: the substrate under the column starts with the SAND the
//           partition carries there, clay only below the sand's base.
//   UCS-EPS a straddling slice whose below-TD remainder is sub-EPS is dropped.
//
// Parity guard — the four frozen v1 cases (partitionFill.test.ts) must behave
// IDENTICALLY through the corrected helper (their slice tops sit AT the TD, so
// the deleted rejection never fired on them):
//   UCS-P1  slopes the band contacts across a shallow column.
//   UCS-P2  leaves the deepest column unfilled.
//   UCS-P3  closes a lens-spot gap by extending the OVERLYING band downward.
//   UCS-P4  fills a run of 2+ consecutive shallow tests.

import { describe, expect, it } from 'vitest'

import type { PartitionColumn, SectionRegion } from '../../utils/sectionPartition'
import { computeUnderColumnSubstrateForRender } from './underColumnSubstrate'

/** Column with a gap-free unit stack (depths from a surface at ``surface``). */
function col(
  id: string,
  surface: number,
  units: { top: number; base: number; f: string; b: string | null }[],
): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u, i) => ({
      layerId: `${id}#${i}`,
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      bodyId: u.b,
    })),
  }
}

/** SectionRegion quad sloping top0→top1 / base0→base1 across the gap. */
function reg(
  gapIndex: number,
  formationId: string,
  top0: number,
  base0: number,
  top1: number,
  base1: number,
  kind: 'quad' | 'pinch' | 'lens' = 'quad',
): SectionRegion {
  return {
    formationId,
    bodyId: null,
    kind,
    gapIndex,
    polygon: [
      { fraction: 0, elevation: top0 },
      { fraction: 1, elevation: top1 },
      { fraction: 1, elevation: base1 },
      { fraction: 0, elevation: base0 },
    ],
  }
}

/** A column whose deepest base sits at ``tdElev`` (surface 10). */
function shallowCol(id: string, tdElev: number): PartitionColumn {
  return col(id, 10, [{ top: 0, base: 10 - tdElev, f: 'X', b: null }])
}

describe('computeUnderColumnSubstrateForRender — S60 owner rule (partition continues under the glyph)', () => {
  it('UCS-B2: a region running continuously through the shallow TD keeps its below-TD portion (sand under B2, clay only below)', () => {
    // deepL — B2-like shallow (TD −4.45) — deepR. The v2 engine emits the SAND
    // as ONE region spanning from well above the TD down to −7.5 (no split at
    // the TD line); KLEI bands below. The substrate under the shallow column
    // must carry the partition: SAND from the TD down to the sand base, then
    // KLEI — NOT clay from the TD straight down.
    const columns = [
      shallowCol('L', -12),
      col('B2', 13.05, [{ top: 8.8, base: 17.5, f: 'ZAND', b: null }]),
      shallowCol('R', -12),
    ]
    const regions: SectionRegion[] = [
      // Sand straddles the TD (−4.45): top 4.25 (above), base −7.5 (below).
      reg(0, 'ZAND', 4.25, -7.5, 4.25, -7.5),
      reg(0, 'KLEI', -7.5, -10.2, -7.5, -10.2),
      reg(1, 'ZAND', 4.25, -7.5, 4.25, -7.5),
      reg(1, 'KLEI', -7.5, -10.2, -7.5, -10.2),
    ]
    const fills = computeUnderColumnSubstrateForRender(columns, regions)
    const b2 = fills.find((f) => f.columnIndex === 1)
    expect(b2).toBeDefined()
    expect(b2!.quads.length).toBe(2)
    const [sand, clay] = b2!.quads
    // The partition's sand shows directly under the glyph, from the TD down.
    expect(sand.formationId).toBe('ZAND')
    expect(sand.topLeftElev).toBeCloseTo(-4.45, 2)
    expect(sand.baseLeftElev).toBeCloseTo(-7.5, 2)
    // Clay only below the sand's base — never directly under the sand base/TD.
    expect(clay.formationId).toBe('KLEI')
    expect(clay.topLeftElev).toBeCloseTo(-7.5, 2)
    expect(clay.baseLeftElev).toBeCloseTo(-10.2, 2)
  })

  it('UCS-EPS: a straddling slice with a sub-EPS below-TD remainder is dropped', () => {
    // The region dips only 5 mm below the TD → nothing meaningful to paint.
    const columns = [shallowCol('S', 6), shallowCol('R', -2)]
    const regions: SectionRegion[] = [
      reg(0, 'SILT', 8, 5.995, 8, 5.995), // 5 mm below TD 6
      reg(0, 'SAND', 5.995, -2, 5.995, -2),
    ]
    const fills = computeUnderColumnSubstrateForRender(columns, regions)
    const c0 = fills.find((f) => f.columnIndex === 0)
    expect(c0).toBeDefined()
    // Only the SAND paints below the TD; the silt's 5 mm remainder is dropped
    // (the top void-closure extends the overlying formation instead).
    expect(c0!.quads.some((q) => q.formationId === 'SILT' && q.topLeftElev - q.baseLeftElev > 0.05)).toBe(false)
    expect(c0!.quads.some((q) => q.formationId === 'SAND')).toBe(true)
  })
})

describe('computeUnderColumnSubstrateForRender — parity with the frozen v1 cases', () => {
  it('UCS-P1: slopes the band contacts across a shallow column (straight deep→deep, not flat)', () => {
    const columns = [shallowCol('L', -2), shallowCol('S', 8), shallowCol('R', -2)]
    const regions: SectionRegion[] = [
      reg(0, 'CLAY', 8, 5, 8, 5),
      reg(0, 'SAND', 5, 0, 5, 0),
      reg(1, 'CLAY', 8, 3, 8, 3),
      reg(1, 'SAND', 3, -2, 3, -2),
    ]
    const fills = computeUnderColumnSubstrateForRender(columns, regions)
    const mid = fills.find((f) => f.columnIndex === 1)
    expect(mid).toBeDefined()
    expect(mid!.quads).toHaveLength(2)
    const [clay, sand] = mid!.quads
    expect(clay.formationId).toBe('CLAY')
    expect(sand.formationId).toBe('SAND')
    expect(clay.topLeftElev).toBeCloseTo(8, 1)
    expect(clay.topRightElev).toBeCloseTo(8, 1)
    expect(clay.baseLeftElev).toBeCloseTo(5, 1)
    expect(clay.baseRightElev).toBeCloseTo(3, 1)
    expect(sand.topLeftElev).toBeCloseTo(5, 1)
    expect(sand.topRightElev).toBeCloseTo(3, 1)
    expect(sand.baseLeftElev).toBeCloseTo(0, 1)
    expect(sand.baseRightElev).toBeCloseTo(-2, 1)
  })

  it('UCS-P2: leaves the deepest column unfilled (nothing below its TD)', () => {
    const columns = [shallowCol('S', 6), shallowCol('R', -2)]
    const regions: SectionRegion[] = [reg(0, 'SAND', 5, -2, 5, -2)]
    const fills = computeUnderColumnSubstrateForRender(columns, regions)
    expect(fills.find((f) => f.columnIndex === 1)).toBeUndefined()
  })

  it('UCS-P3: closes a lens-spot gap by extending the OVERLYING band downward', () => {
    const columns = [shallowCol('S', 9.5), shallowCol('R', -2)]
    const regions: SectionRegion[] = [
      reg(0, 'CLAY', 8, 4, 8, 4),
      reg(0, 'SILT', 4, 2, 4, 2, 'lens'),
      reg(0, 'SAND', 2, -2, 2, -2),
    ]
    const fills = computeUnderColumnSubstrateForRender(columns, regions)
    const c0 = fills.find((f) => f.columnIndex === 0)
    expect(c0).toBeDefined()
    expect(c0!.quads).toHaveLength(2)
    const [upper, lower] = c0!.quads
    expect(upper.formationId).toBe('CLAY')
    expect(lower.formationId).toBe('SAND')
    expect(upper.baseLeftElev).toBeCloseTo(lower.topLeftElev, 1)
    expect(lower.topLeftElev).toBeCloseTo(2, 1)
    expect(upper.baseLeftElev).toBeCloseTo(2, 1)
  })

  it('UCS-P4: fills a run of 2+ consecutive shallow tests', () => {
    const columns = [
      shallowCol('L', -2),
      shallowCol('A', 6),
      shallowCol('B', 6),
      shallowCol('R', -2),
    ]
    const regions: SectionRegion[] = [
      reg(0, 'SAND', 5, 0, 4, -1),
      reg(1, 'SAND', 4, -1, 2, -1.5),
      reg(2, 'SAND', 2, -1.5, 3, -2),
    ]
    const fills = computeUnderColumnSubstrateForRender(columns, regions)
    expect(fills.find((f) => f.columnIndex === 1)?.quads.length).toBeGreaterThan(0)
    expect(fills.find((f) => f.columnIndex === 2)?.quads.length).toBeGreaterThan(0)
  })
})
