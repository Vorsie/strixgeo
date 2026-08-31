/**
 * partitionFillV2.enclosedLensDetour.test.ts — session-9 synthetic gates for ruling 8h
 * phases 1-2 (design partition-engine-v2.md §8, 8g/8h): every 0-corr enclosed minority ALWAYS
 * gets its lens, the enclosing band DETOURS around it, hole-free.
 *
 * TARGET A (this session): an interbed enclosed by its own-column continuous matrix must render
 * as a lens on BOTH sides EVEN when the facing column carries a DIFFERENT lithology at the
 * interbed's elevation. The pre-session-9 ``facingCarriesMatrix`` gate dropped exactly that case
 * (CS1 col3 SILT-in-ZAND facing KLEI), leaving the interbed ABSENT — its slot painted the
 * enclosing band's colour. The fix (``emitLenses.shouldEmitLens`` → unconditional, 8b-capped)
 * makes the 8b-capped lens hug its own column and the enclosing band flow around it.
 *
 * These are behavioural gates in the RULE's vocabulary (owner ruling 8h phases 1-2), NOT
 * impl-shaped: they assert "the interbed renders as a lens, the host band fills around it, zero
 * holes/overlaps" — the owner's acceptance for TARGET A.
 *
 * Pure geometry (a 3-column synthetic section) — no env gate, part of the committed suite.
 */

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type PartitionPoint, type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { renderedShape } from './partitionFillV2.conformance.classify'

/** Coverage intervals of a polygon at vertical line fraction=f. */
function coveredAt(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if ((a.fraction <= f && b.fraction > f) || (b.fraction <= f && a.fraction > f)) {
      const t = (f - a.fraction) / (b.fraction - a.fraction)
      ys.push(a.elevation + t * (b.elevation - a.elevation))
    }
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}

function group(regions: SectionRegion[], gap: number): SectionRegion[] {
  return regions.filter((r) => r.gapIndex === gap)
}

/** Assert no interior vertical-coverage hole and no different-litho overlap in a gap. */
function assertPartition(regs: SectionRegion[]): void {
  for (let f = 0.05; f < 0.96; f += 0.05) {
    // holes: union coverage should have no interior gap in the covered envelope.
    const all: [number, number][] = []
    for (const r of regs) all.push(...coveredAt(r.polygon, f))
    all.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const [a, b] of all) {
      if (b - a < 1e-9) continue
      if (merged.length && a <= merged[merged.length - 1][1] + 0.0005) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b)
      else merged.push([a, b])
    }
    for (let k = 0; k + 1 < merged.length; k++) {
      const hole = merged[k + 1][0] - merged[k][1]
      expect(hole, `interior hole ${(hole * 1000).toFixed(1)}mm at f=${f.toFixed(2)}`).toBeLessThan(0.001)
    }
    // overlaps between different formations.
    for (let a = 0; a < regs.length; a++) {
      for (let b = a + 1; b < regs.length; b++) {
        if (regs[a].formationId === regs[b].formationId) continue
        const ia = coveredAt(regs[a].polygon, f)
        const ib = coveredAt(regs[b].polygon, f)
        for (const [a1, a2] of ia) for (const [b1, b2] of ib) {
          expect(Math.min(a2, b2) - Math.max(a1, b1), `overlap ${regs[a].formationId}×${regs[b].formationId} at f=${f.toFixed(2)}`).toBeLessThan(0.001)
        }
      }
    }
  }
}

describe('ruling 8h — an enclosed interbed always lenses, the host band detours (TARGET A)', () => {
  // Three columns. The MIDDLE column carries a SILT interbed sandwiched between two ZAND units;
  // the OUTER columns carry the enclosing ZAND at the interbed's elevation ONLY on the deep run
  // (their top is KLEI/SILT), so the FACING lithology at the interbed's own elevation DIFFERS
  // (KLEI). Pre-fix: the interbed dropped (facingCarriesMatrix false) → ABSENT. Post-fix: it
  // lenses both sides, the ZAND host detours around it.
  const mk = (surf: number, units: [string, number, number][]): PartitionColumn['units'] =>
    units.map(([f, top, base], i) => ({
      layerId: `L${surf}-${i}`,
      topDepthM: surf - top,
      baseDepthM: surf - base,
      formationId: f,
      bodyId: `B-${f}`,
    }))

  const columns: PartitionColumn[] = [
    // Outer columns carry KLEI down to el 3 (so at the interbed's el 4-5 the FACING is KLEI,
    // NOT the ZAND host) — reproducing CS1 col3's SILT-in-ZAND facing a different lithology.
    { investigationId: 'W0', surfaceElevM: 10, units: mk(10, [['KLEI', 10, 3], ['ZAND', 3, 0], ['KLEI', 0, -5]]) },
    // Middle: ZAND host [7..1] with a SILT interbed [5..4] inside it → SILT enclosed by ZAND.
    { investigationId: 'W1', surfaceElevM: 10, units: mk(10, [['KLEI', 10, 7], ['ZAND', 7, 5], ['SILT', 5, 4], ['ZAND', 4, 1], ['KLEI', 1, -5]]) },
    { investigationId: 'W2', surfaceElevM: 10, units: mk(10, [['KLEI', 10, 3], ['ZAND', 3, 0], ['KLEI', 0, -5]]) },
  ]
  // No correlation edges — the interbed is a pure 0-corr enclosed minority.
  const edges: CorrelationEdge[] = []
  const alongM = [0, 100, 200]

  const regions = computeSectionFillV2(columns, edges, undefined, alongM)

  // The interbed hugs its OWN column (the middle W1 = right column of gap0, left of gap1), so a
  // small lens touches that own edge. The ``renderedShape`` classifier scores a column-hugging
  // lens as ``onlap`` (reaches exactly one edge) — the OWNER acceptance is "the interbed is
  // present and terminates (a small lens/onlap around it), never ABSENT and never a full-width
  // BAND". We assert that AND that the emitted region carries ``kind:'lens'`` (the hugging halo).
  const interbedRegion = (gap: number): SectionRegion | undefined =>
    group(regions, gap).find((r) => r.formationId === 'SILT' && r.polygon.some((p) => p.elevation > 4 - 0.01 && p.elevation < 5 + 0.01))

  it('the SILT interbed is PRESENT and terminates in gap0 (never absent, never a full-width band)', () => {
    const rs = renderedShape(group(regions, 0), 'SILT', 4, 5, 'right')
    expect(rs.shape === 'lens' || rs.shape === 'onlap').toBe(true)
    expect(interbedRegion(0)?.kind).toBe('lens')
  })

  it('the SILT interbed is PRESENT and terminates in gap1', () => {
    const rs = renderedShape(group(regions, 1), 'SILT', 4, 5, 'left')
    expect(rs.shape === 'lens' || rs.shape === 'onlap').toBe(true)
    expect(interbedRegion(1)?.kind).toBe('lens')
  })

  it('gap0 stays a hole-free, overlap-free partition (the host band flows around the lens)', () => {
    assertPartition(group(regions, 0))
  })

  it('gap1 stays a hole-free, overlap-free partition', () => {
    assertPartition(group(regions, 1))
  })
})

describe('ruling 8g(b) — a unit banded on one side pinches to a lens on its untied side (TARGET B)', () => {
  // Middle column SILT unit tied on its LEFT (a matched-pair band with the left column's SILT)
  // and untied on its RIGHT → the SILT bands into gap0 and pinches to a lens in gap1.
  const mk = (surf: number, units: [string, number, number, string][]): PartitionColumn['units'] =>
    units.map(([f, top, base, lid]) => ({
      layerId: lid, topDepthM: surf - top, baseDepthM: surf - base, formationId: f, bodyId: `B-${f}`,
    }))
  const columns: PartitionColumn[] = [
    { investigationId: 'X0', surfaceElevM: 10, units: mk(10, [['ZAND', 10, 3, 'x0-0'], ['SILT', 3, 2, 'x0-1'], ['ZAND', 2, -5, 'x0-2']]) },
    { investigationId: 'X1', surfaceElevM: 10, units: mk(10, [['ZAND', 10, 3, 'x1-0'], ['SILT', 3, 2, 'x1-1'], ['ZAND', 2, -5, 'x1-2']]) },
    { investigationId: 'X2', surfaceElevM: 10, units: mk(10, [['ZAND', 10, -5, 'x2-0']]) },
  ]
  // Tie the SILT between W0 and W1 on both contacts → a matched-pair SILT band in gap0.
  const edges: CorrelationEdge[] = [
    { a: 'x0-1', b: 'x1-1', aSide: 'top', bSide: 'top' },
    { a: 'x0-1', b: 'x1-1', aSide: 'base', bSide: 'base' },
  ]
  const alongM = [0, 100, 200]
  const regions = computeSectionFillV2(columns, edges, undefined, alongM)

  it('SILT bands across gap0 (matched pair)', () => {
    const rs = renderedShape(group(regions, 0), 'SILT', 2, 3, 'left')
    expect(rs.shape).toBe('band')
  })

  it('SILT terminates (lens/onlap, never band/absent) in gap1 where it is untied', () => {
    const rs = renderedShape(group(regions, 1), 'SILT', 2, 3, 'left')
    expect(rs.shape === 'lens' || rs.shape === 'onlap').toBe(true)
  })

  it('gap1 stays a hole-free, overlap-free partition', () => {
    assertPartition(group(regions, 1))
  })
})
