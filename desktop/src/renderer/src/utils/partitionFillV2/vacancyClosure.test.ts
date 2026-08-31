/**
 * partitionFillV2/vacancyClosure.test.ts — increment 4a vacancy-closure rules,
 * written in the USER's vocabulary (design partition-engine-v2.md §4 "Vacancy
 * closure at terminations", section-fill.md "two-pieces-plus-filler" + the
 * owner-validated "no auto-facies" straight midpoint seam).
 *
 * The rule (owner): when a unit pinches / lenses out, the space vacated past its
 * apex is NOT left empty — the adjacent units' faces extend to CLAIM it, and two
 * mismatched matrices meeting in a data void meet at a STRAIGHT MIDPOINT SEAM (a
 * facies/disturbed contact is the engineer's explicit call, never a geometric
 * inference). The no-holes invariant (§1) makes fill mandatory.
 */

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './computeSectionFillV2'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'

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

/** Elevation coverage [lo, hi] intervals of ALL regions at a fraction. */
function coverageAt(regions: SectionRegion[], gap: number, f: number): [number, number][] {
  const ys: number[] = []
  for (const r of regions) {
    if (r.gapIndex !== gap) continue
    const p = r.polygon
    for (let i = 0; i < p.length; i++) {
      const a = p[i]
      const b = p[(i + 1) % p.length]
      if ((a.fraction <= f && b.fraction > f) || (b.fraction <= f && a.fraction > f)) {
        const t = (f - a.fraction) / (b.fraction - a.fraction)
        ys.push(a.elevation + t * (b.elevation - a.elevation))
      }
    }
  }
  ys.sort((x, y) => x - y)
  const iv: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) iv.push([ys[i], ys[i + 1]])
  return iv
}

/** Merge intervals with a small tolerance; returns interior-hole count. */
function interiorHoles(iv: [number, number][]): number {
  const s = iv.filter(([a, b]) => b - a > 1e-6).sort((p, q) => p[0] - q[0])
  const merged: [number, number][] = []
  for (const [a, b] of s) {
    if (merged.length && a <= merged[merged.length - 1][1] + 0.005) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], b)
    } else merged.push([a, b])
  }
  return merged.length - 1
}

/** The single formation covering (f, elev), or null if 0 or >1. */
function formationAt(regions: SectionRegion[], gap: number, f: number, elev: number): string | 'MULTI' | null {
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

describe('partitionFillV2 vacancy closure at terminations', () => {
  it('a clay matrix that pinches out is CLAIMED continuously by the sand above/below it (no hole past the apex)', () => {
    // Left column: sand / clay / sand. Right column: sand only (the clay pinched out).
    // The clay is uncorrelated -> it terminates; the space it vacated toward the
    // right must be CLAIMED (by the sand), leaving NO vertical hole anywhere.
    const lSandTop = layer()
    const lClay = layer()
    const lSandBot = layer()
    const rSand = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: SAND, layerId: lSandTop, body: 'bS' },
      { top: 3, base: 5, f: CLAY, layerId: lClay, body: 'bC' },
      { top: 5, base: 8, f: SAND, layerId: lSandBot, body: 'bS' },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: SAND, layerId: rSand, body: 'bS' }])
    const regions = computeSectionFillV2([left, right], [])
    // Full vertical coverage past the apex: sample the deep interior (fraction 0.8),
    // where only the sand remains — there must be no interior hole.
    for (const f of [0.5, 0.7, 0.9]) {
      const iv = coverageAt(regions, 0, f)
      expect(interiorHoles(iv)).toBe(0)
    }
  })

  it('two mismatched matrices meeting in a data void meet at a STRAIGHT MIDPOINT SEAM (no auto-facies)', () => {
    // The interval between a tied SILT band above and a tied SILT band below holds
    // exactly ONE left unit (CLAY) and ONE right unit (SAND) of DIFFERENT lithology,
    // neither correlated across. They cannot connect -> they meet halfway at a
    // straight midpoint seam (~0.5): left of 0.5 is CLAY, right of 0.5 is SAND.
    const lTopSilt = layer()
    const lClay = layer()
    const lBotSilt = layer()
    const rTopSilt = layer()
    const rSand = layer()
    const rBotSilt = layer()
    const left = col('L', 10, [
      { top: 0, base: 2, f: SILT, layerId: lTopSilt },
      { top: 2, base: 6, f: CLAY, layerId: lClay },
      { top: 6, base: 8, f: SILT, layerId: lBotSilt },
    ])
    const right = col('R', 10, [
      { top: 0, base: 2, f: SILT, layerId: rTopSilt },
      { top: 2, base: 6, f: SAND, layerId: rSand },
      { top: 6, base: 8, f: SILT, layerId: rBotSilt },
    ])
    // Tie the bracketing silts (top-and-base on both) so the CLAY/SAND interval is
    // fully bracketed by bands above AND below.
    const edges: CorrelationEdge[] = [
      { a: lTopSilt, b: rTopSilt, aSide: 'top', bSide: 'top' },
      { a: lTopSilt, b: rTopSilt, aSide: 'base', bSide: 'base' },
      { a: lBotSilt, b: rBotSilt, aSide: 'top', bSide: 'top' },
      { a: lBotSilt, b: rBotSilt, aSide: 'base', bSide: 'base' },
    ]
    const regions = computeSectionFillV2([left, right], edges)
    // In the mismatched interval (elev ~4, between the bracketing bands): left of
    // 0.5 is CLAY, right of 0.5 is SAND, and no hole in between.
    expect(formationAt(regions, 0, 0.25, 4)).toBe(CLAY)
    expect(formationAt(regions, 0, 0.75, 4)).toBe(SAND)
    // The whole column at that elevation is covered (no hole).
    expect(formationAt(regions, 0, 0.5, 4)).not.toBeNull()
  })

  it('full vertical coverage is asserted at every fraction past the apex (partition invariant)', () => {
    // Left: clay / sand / clay. Right: clay / clay (the sand pinched out). The sand
    // lenses; above and below the clay must CLAIM the full column past the apex.
    const lClayTop = layer()
    const lSand = layer()
    const lClayBot = layer()
    const rClay = layer()
    const left = col('L', 10, [
      { top: 0, base: 3, f: CLAY, layerId: lClayTop, body: 'bC' },
      { top: 3, base: 4, f: SAND, layerId: lSand, body: 'bLens' },
      { top: 4, base: 8, f: CLAY, layerId: lClayBot, body: 'bC' },
    ])
    const right = col('R', 10, [{ top: 0, base: 8, f: CLAY, layerId: rClay, body: 'bC' }])
    const regions = computeSectionFillV2([left, right], [])
    for (const f of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      const iv = coverageAt(regions, 0, f)
      expect(interiorHoles(iv)).toBe(0)
    }
  })
})
