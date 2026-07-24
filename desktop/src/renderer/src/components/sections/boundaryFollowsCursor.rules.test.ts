/**
 * boundaryFollowsCursor.rules.test.ts — SESSION 101 target gate: "ANY two-band litho boundary
 * bends to follow the cursor" (owner-decided 2026-07-24, docs/design/freedraw-onlap-lens-edit-model.md
 * → "ANY BOUNDARY BENDS TO THE CURSOR").
 *
 * The rule, in the owner's words: "i just want the boundary i click to reshape to where i move my
 * cursor" — WHETHER OR NOT the boundary carries a correlation tie. Un-correlated boundaries are NO
 * LONGER read-only. A drag on a boundary BETWEEN TWO FULL-WIDTH BANDS moves the grabbed node to the
 * cursor and bends the ONE shared boundary through it: ONE clean bend, gap-free, the SAME body
 * reshaped (NOT a fragmented 4-region pinch).
 *
 * BEFORE S101 the engine's ``collectContactBends`` bent a shared contact ONLY when it carried an
 * ACTIVE correlation TIE (``for (const t of ties)``); an un-tied two-band contact override was
 * ENGINE-INERT (S100 diagnosis: applying ``contact:U|L@g`` on CS1's un-tied 934a78 base changed
 * ZERO regions). This gate REPRODUCES that inertness on a synthetic two-full-band section (RED on
 * the old engine) and asserts the fixed engine bends the un-tied boundary to the cursor (GREEN).
 *
 * The COMMON case only (owner spec, prompt item 4): a boundary between TWO FULL-WIDTH BANDS. A true
 * pinch tip (band → zero) or a surface-bounded boundary is deferred (STOP-AND-REPORT, not invented).
 */
import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type SectionRegion,
} from '../../utils/partitionFill'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { contactApexOverrideKey } from '../../utils/partitionFillV2/contactOverride'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'

// --------------------------------------------------------------------------
// Two columns, each ZAND (top) over KLEI (bottom): the ZAND/KLEI contact is a
// boundary between TWO FULL-WIDTH BANDS (both bodies present on both columns).
// No correlation edges → the contact carries NO tie → the S100 engine-inert case.
// --------------------------------------------------------------------------
const ZAND = 'body-zand' // upper band, present on both columns (full-width)
const KLEI = 'body-klei' // lower band, present on both columns (full-width)

function twoFullBandColumns(): PartitionColumn[] {
  // Both columns identical: ZAND 0..5 m, KLEI 5..12 m. Surface at 10 → contact at el 5.
  const mk = (invId: string): PartitionColumn => ({
    investigationId: invId,
    surfaceElevM: 10,
    units: [
      { topDepthM: 0, baseDepthM: 5, formationId: 'zand', bodyId: ZAND, layerId: `${invId}-zand` },
      { topDepthM: 5, baseDepthM: 12, formationId: 'klei', bodyId: KLEI, layerId: `${invId}-klei` },
    ],
  })
  return [mk('A'), mk('B')]
}

/** The ZAND/KLEI shared-contact region base contour's mid-gap apex elevation, or null. */
function midGapContactElev(regions: SectionRegion[], upperBodyId: string): number | null {
  const upper = regions.filter((r) => r.bodyId === upperBodyId && r.gapIndex === 0)
  if (upper.length === 0) return null
  // The bent base edge inserts an interior (mid-gap) vertex at the cursor elevation. Return the
  // elevation of the deepest interior (0.02 < fraction < 0.98) vertex across the upper regions.
  let best: number | null = null
  for (const r of upper) {
    for (const p of r.polygon) {
      if (p.fraction > 0.02 && p.fraction < 0.98) {
        if (best === null || p.elevation < best) best = p.elevation
      }
    }
  }
  return best
}

/** Total signed area coverage check: no interior hole/overlap by summing region areas vs the gap box. */
function hasCoverageHoleOrOverlap(regions: SectionRegion[]): boolean {
  // A crude partition check: the union of region polygons (fraction×elevation) must tile the gap
  // extent with no double-coverage. We approximate by point-in-polygon sampling on a grid.
  const g0 = regions.filter((r) => r.gapIndex === 0)
  if (g0.length === 0) return true
  let elMin = Infinity
  let elMax = -Infinity
  for (const r of g0) for (const p of r.polygon) {
    if (p.elevation < elMin) elMin = p.elevation
    if (p.elevation > elMax) elMax = p.elevation
  }
  const inPoly = (poly: { fraction: number; elevation: number }[], f: number, e: number): boolean => {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const fi = poly[i].fraction
      const ei = poly[i].elevation
      const fj = poly[j].fraction
      const ej = poly[j].elevation
      const intersect = ei > e !== ej > e && f < ((fj - fi) * (e - ei)) / (ej - ei) + fi
      if (intersect) inside = !inside
    }
    return inside
  }
  const N = 25
  for (let fi = 1; fi < N; fi++) {
    for (let ei = 1; ei < N; ei++) {
      const f = fi / N
      const e = elMin + ((elMax - elMin) * ei) / N
      let cover = 0
      for (const r of g0) if (inPoly(r.polygon, f, e)) cover++
      if (cover > 1) return true // overlap (double coverage)
      // A hole (cover === 0) is allowed only outside the ZAND/KLEI stack; but this synthetic
      // section is fully covered ZAND..KLEI, so any interior 0 in [elMin,elMax] is a hole.
      if (cover === 0) return true
    }
  }
  return false
}

// PENDING (S101, ``describe.skip``): the target invariant for the un-tied two-full-band bend. It is
// RED against the current engine and stays SKIPPED until the un-tied-bend engine capability lands
// (STOPPED-AND-REPORTED at engine scope 2026-07-24 — REWRITE_STATE §101). The current engine bends a
// shared contact ONLY when ONE side carries a correlation tie (a tie on EITHER band labels the bend
// correctly, MEASURED); an UN-TIED contact override is engine-inert (S100) — and a lone bent ``bandc``
// contour is NOT enough because ``labelFaces`` is column-vertical-SEED driven and treats an un-tied
// contour as a fill closing, not a litho divider, so the bend mislabels (ZAND floods to the KLEI base).
// Un-skip this the moment the un-tied contact is taught to carry band authority (the concrete plan in
// §101). The assertion IS the acceptance: the boundary bends to the cursor, one region set, gap-free.
describe.skip('S101 PENDING — un-tied two-full-band boundary follows the cursor', () => {
  it('bends the un-tied contact to the cursor, one region set, gap-free', () => {
    setTwoSidedTerminations(true)
    try {
      const columns = twoFullBandColumns()
      const edges: CorrelationEdge[] = [] // NO ties — the un-tied case

      // Base (no override): the ZAND/KLEI contact is straight at el 5.
      const base = computeSectionFillV2(columns, edges)
      expect(base.length, 'base fill must produce regions').toBeGreaterThan(0)

      // Drag the boundary DOWN from el 5 to el 3, mid-gap (fraction 0.5) — the cursor is at el 3.
      const CURSOR_EL = 3
      const key = contactApexOverrideKey(ZAND, KLEI, 0)
      const ov = new Map<string, LensApexOverride>([
        [key, { fraction: 0.5, elevation: CURSOR_EL, upper: [], lower: [] } as unknown as LensApexOverride],
      ])
      const after = computeSectionFillV2(columns, edges, ov)

      // (1) The shared boundary BENDS to the cursor: the ZAND base carries an interior apex at ≈ el 3.
      const bentElev = midGapContactElev(after, ZAND)
      expect(bentElev, 'the un-tied boundary must bend — an interior apex must exist').not.toBeNull()
      expect(Math.abs(bentElev! - CURSOR_EL)).toBeLessThan(0.5) // tracks the cursor elevation

      // (2) ONE clean bend — the SAME body reshaped, never fragmented into a pinch.
      const upperAfter = after.filter((r) => r.bodyId === ZAND && r.gapIndex === 0)
      expect(upperAfter.length, 'the reshaped upper band must not fragment').toBeLessThanOrEqual(2)

      // (3) Gap-free by construction: no interior hole or overlap after the bend.
      expect(hasCoverageHoleOrOverlap(after), 'bent fill must stay a true partition').toBe(false)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})
