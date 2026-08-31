/**
 * extendsToFar's CURTAIN — a live risk found by code-hunting, PORTED
 * 2026-08-22 (see ``constructive/bandContinuation.ts`` for the fix).
 *
 * Owner, 2026-08-21, on the litho arm's sub-TD continuation shape: *"you made
 * them crossing but now it is inconsistent with the litho and some don't
 * terminate in a pinch"* / *"how do we get open terminations for lenses"*.
 * That was fixed on the LITHO side (blind columns are passed through, the
 * unit pinches against the first column that DOES read its ground) — and the
 * SAME law now runs on the geotech constructive arm too
 * (``bandContinuation.ts`` + ``terminationRun.ts``; see
 * ``bandContinuationScene.test.ts`` for the multi-column proof).
 *
 * EF1 BELOW STAYS AS-IS AND IS NOT A REGRESSION. Its scene is only TWO
 * columns (A, M) — M genuinely IS the run's own edge, nothing exists beyond
 * it. Per the law, a run edge with nothing further to read is exactly the
 * ONE case where the flat curtain IS the correct, final answer (mirroring
 * the litho arm's ``reads: false`` case) — the fix changes nothing here. EF1
 * exists to prove the code path is reachable; ``bandContinuationScene.test.ts``
 * is the file that proves the actual multi-column fix (a THIRD column beyond
 * M that DOES read A's ground) — that shape found ZERO live instances on a
 * real-data sweep at the time this was written, but the litho arm's own
 * regression test for this exact law is built on real CS1 columns
 * (S7A/S7/FAR) the geotech axis shares, so it is very plausibly live once
 * dogfed.
 *
 * @module utils/geotechHierarchicalFill/extendsToFarCurtain
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from './index'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'
import { computeSectionFillActive } from '../partitionEngineSelect'

interface UnitSpec {
  layerId: string
  formationId: string
  top: number
  base: number
}
function column(id: string, surface: number, units: readonly UnitSpec[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      topDepthM: u.top,
      baseDepthM: u.base,
      bodyId: null,
    })),
  }
}
const tie = (a: string, b: string): CorrelationEdge => ({ a, b, aSide: 'top', bSide: 'top' })

function inRegion(f: number, e: number, region: SectionRegion): boolean {
  const ring = region.polygon
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a.elevation > e !== b.elevation > e &&
      f < a.fraction + ((e - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    ) {
      inside = !inside
    }
  }
  return inside
}

const SAND = 'f-sand'
const LOOSE = 'g-sand-loose'
const DENSE = 'g-sand-dense'

describe("extendsToFar's curtain — a genuinely 0-tie band whose facing column reads a DIFFERENT depth window", () => {
  it('EF1: A logs loose sand shallow, M logs dense sand deep — disjoint windows, zero ties either side', () => {
    // A carries ONLY loose sand, elevation [5,10] (depth 0-5). M carries ONLY
    // dense sand, elevation [0,5] (depth 5-10) — exactly adjoining, zero
    // overlap. Neither band is tied to anything (no geotech edges at all),
    // and — critically — each column carries exactly ONE band, so there is no
    // OTHER band on the same column to inherit a tie via a shared contact
    // (the loose-then-dense-stacked-together shape shares a boundary and
    // therefore a tie the moment both exist on one column; this scene avoids
    // that entirely so the 0-tie condition is real, not a same-column
    // artifact). Litho frame: one SAND unit, 0-10, correlated — one family,
    // no blocked columns, so M is a genuine, non-blocked run member.
    const litho = {
      columns: [
        column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 10 }]),
        column('M', 10, [{ layerId: 'LM', formationId: SAND, top: 0, base: 10 }]),
      ],
      edges: [tie('LA', 'LM')],
    }
    const geotech: PartitionColumn[] = [
      column('A', 10, [{ layerId: 'GA-loose', formationId: LOOSE, top: 0, base: 5 }]),
      column('M', 10, [{ layerId: 'GM-dense', formationId: DENSE, top: 5, base: 10 }]),
    ]
    const alongM = [0, 100]
    const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, alongM)
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions,
      geotechColumns: geotech,
      geotechEdges: [],
      alongM,
    })

    // THE CORRECT, FINAL SHAPE — not a "before" pin. A's loose sand is a
    // genuine 0-tie band; M is the run's OWN EDGE (no third column exists),
    // and M reads NOTHING at its elevation window [5,10] either (M only has
    // dense sand at [0,5]) — nothing in this direction ever reads it, so per
    // the law (``terminationRun.ts``'s header) the flat curtain to M IS the
    // right, permanent answer, mirroring the litho arm's ``reads: false``
    // case exactly. A plain lens would close within a hair of A's own
    // column (LENS_PINCH_FRACTION, far under 0.1); the curtain instead runs
    // flat all the way to M's own column line, on purpose.
    const looseRegions = out.regions.filter((r) => (r.layerIds ?? []).includes('GA-loose'))
    expect(looseRegions.length, 'the loose sand painted nothing').toBeGreaterThan(0)
    let farthestFraction = 0
    for (const r of looseRegions) {
      for (const p of r.polygon) farthestFraction = Math.max(farthestFraction, p.fraction)
    }
    expect(
      farthestFraction,
      "the curtain runs to M's own column line rather than pinching near A's — correct, M is the run's own edge",
    ).toBeGreaterThan(0.95)

    // Ground right beside M's own column, at the loose sand's elevation —
    // depth M never logged at all — correctly reads LOOSE (M's own edge).
    const besideM = out.regions.find((r) => inRegion(0.97, 7.5, r))
    expect(
      besideM?.formationId,
      "loose sand correctly paints right up to M's column, at a depth M's own log never reached",
    ).toBe(LOOSE)
  })
})
