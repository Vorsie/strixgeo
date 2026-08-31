/**
 * onlapRidesBentContact.rules.test.ts — SESSION 109 gate: "the onlap deforms WITH the dragged
 * boundary" (owner 2026-07-24, docs/design/freedraw-onlap-lens-edit-model.md → ONLAP → "Onlap
 * rides along — SEGMENT-CONFINED").
 *
 * The owner's rule, verbatim: "i'm grabbing the boundary of the clay and the sand is disappearing.
 * It needs to reshape together with the dragged boundary." The sand onlap's TOP contact IS the
 * clay's BASE where the sand pinches in — the SAME line — so bending the clay's base must bend the
 * sand's top with it: the sand thickens/thins following the drag and NEVER vanishes.
 *
 * TOPOLOGY (a faithful synthetic of CS1 gap-4):
 *   - A (clay, full-width upper)  el 10..5 on both columns.
 *   - C (matrix, full-width lower) el 5..-2 (LEFT) / el 3..-2 (RIGHT — B intervenes).
 *   - B (sand ONLAP) pinches in on the RIGHT column between A and C (el 5..3), its TOP contact = A's
 *     BASE (el 5). B's top ties to A's base (an onlap tie A-base(left) ↔ B-top(right)).
 *
 * THE MECHANISM (S109 blockers 1+2): the ``contact:A|C@gap`` free-draw override BENDS the shared A/C
 * contact (the boundary the owner grabs). Because B's onlap top-tie SHARES that el-5 contact (the
 * SAME line), ``collectContactBends`` bends B's tie curve too; ``emitCurves`` records the bent
 * polyline on the ``ResolvedTie`` (blocker 1); ``emitOnlap`` re-derives B's apex elevation as
 * ``elevAtXAlong(bentPoints, apexX)`` along the bent line (blocker 2). So B RIDES the bend.
 *
 * BEFORE (blocker 2 absent — the straight chord ``tiedElev + f*(facingTiedElev − tiedElev)``): B's
 * apex stays on its OWN base contact (el 5), the sand does NOT follow the dragged boundary (RED).
 * AFTER: B's apex rides the bent contact to the cursor elevation, the sand thickens/thins WITH it
 * (GREEN). B SURVIVES throughout (one region — never absorbed, never a no-op).
 */
import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type SectionRegion,
} from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { contactApexOverrideKey } from '../../utils/partitionFillV2/contactOverride'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'

const A = 'body-a-clay' // full-width upper (the clay whose base is dragged)
const B = 'body-b-sand-onlap' // the sand onlap — pinches in on the RIGHT column between A and C
const C = 'body-c-matrix' // full-width lower

function section(): { columns: PartitionColumn[]; edges: CorrelationEdge[] } {
  const columns: PartitionColumn[] = [
    {
      investigationId: 'L',
      surfaceElevM: 10,
      units: [
        { topDepthM: 0, baseDepthM: 5, formationId: 'clay', bodyId: A, layerId: 'L-a' },
        { topDepthM: 5, baseDepthM: 12, formationId: 'matrix', bodyId: C, layerId: 'L-c' },
      ],
    },
    {
      investigationId: 'R',
      surfaceElevM: 10,
      units: [
        { topDepthM: 0, baseDepthM: 5, formationId: 'clay', bodyId: A, layerId: 'R-a' }, // A base el 5
        { topDepthM: 5, baseDepthM: 7, formationId: 'sand', bodyId: B, layerId: 'R-b' }, // B el 5..3
        { topDepthM: 7, baseDepthM: 12, formationId: 'matrix', bodyId: C, layerId: 'R-c' }, // C top el 3
      ],
    },
  ]
  // The onlap tie: B's top (right, el 5) laps onto A's base (left, el 5) — the SAME line as A's base.
  const edges: CorrelationEdge[] = [{ a: 'L-a', b: 'R-b', aSide: 'base', bSide: 'top' }]
  return { columns, edges }
}

/** The onlap B's interior (mid-gap) APEX elevation in gap 0 — the tip that rides the tie. */
function onlapApexElev(regions: SectionRegion[]): number | null {
  const rs = regions.filter((r) => r.bodyId === B && r.gapIndex === 0)
  let best: number | null = null
  for (const r of rs)
    for (const p of r.polygon)
      // The onlap TIP is its interior vertex (fraction strictly inside the gap). Take the shallowest
      // interior vertex (the top tip that laps the clay base).
      if (p.fraction > 0.02 && p.fraction < 0.98) {
        if (best === null || p.elevation > best) best = p.elevation
      }
  return best
}

/** True when B renders as at least one region in gap 0 (it SURVIVES — never absorbed). */
function onlapSurvives(regions: SectionRegion[]): boolean {
  return regions.some((r) => r.bodyId === B && r.gapIndex === 0)
}

describe('S109 — the sand onlap rides the bent clay-base contact (reshapes together with the drag)', () => {
  it('B survives, its top rides the bent contact, and it thickens/thins WITH the drag', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges } = section()

      // BASE: the onlap B laps A's base at el 5 — its tip sits on the shared contact.
      const base = computeSectionFillV2(columns, edges)
      expect(onlapSurvives(base), 'the sand onlap B renders in the base fill').toBe(true)
      const baseApex = onlapApexElev(base)
      expect(baseApex, 'the base onlap must have an interior tip').not.toBeNull()
      // The base tip rides A's base contact (el ~5).
      expect(Math.abs(baseApex! - 5), 'the base onlap tip laps the clay base at el 5').toBeLessThan(0.6)

      // DRAG the clay's base DOWN to el 2 (a contact:A|C bend — the boundary the owner grabs). The
      // sand's top contact IS that line, so it must ride the bend down.
      const CURSOR_EL = 2.0
      const ov = new Map<string, LensApexOverride>([
        [contactApexOverrideKey(A, C, 0), { fraction: 0.5, elevation: CURSOR_EL } as LensApexOverride],
      ])
      const after = computeSectionFillV2(columns, edges, ov)

      // (1) B SURVIVES — never absorbed into the A/C band (the §106 defect the owner walled off).
      expect(onlapSurvives(after), 'the onlap B must SURVIVE the drag (never absorbed)').toBe(true)

      // (2) B RIDES the bent contact: its tip moves DOWN toward the cursor elevation (el 2), not
      // stuck on the straight chord at el 5. This is the blocker-2 effect — RED before it (tip ≈ 5).
      const afterApex = onlapApexElev(after)
      expect(afterApex, 'the dragged onlap must still have an interior tip').not.toBeNull()
      expect(
        afterApex! < baseApex! - 1.5,
        `the onlap tip must ride the bent contact DOWN (was ${baseApex}, now ${afterApex})`,
      ).toBe(true)
      // The tip tracks the cursor elevation (the bend at fraction 0.5 sits ≈ el 2).
      expect(Math.abs(afterApex! - CURSOR_EL), 'the onlap tip rides the bent contact toward the cursor').toBeLessThan(1.0)

      // (3) B THICKENS with the drag: its base stayed (el 3) while its top rode down (el 5 → ~2), so
      // the sand grew. Measure the onlap's elevation span in gap 0.
      const bAfter = after.filter((r) => r.bodyId === B && r.gapIndex === 0)
      const spanAfter =
        Math.max(...bAfter.flatMap((r) => r.polygon.map((p) => p.elevation))) -
        Math.min(...bAfter.flatMap((r) => r.polygon.map((p) => p.elevation)))
      const bBase = base.filter((r) => r.bodyId === B && r.gapIndex === 0)
      const spanBase =
        Math.max(...bBase.flatMap((r) => r.polygon.map((p) => p.elevation))) -
        Math.min(...bBase.flatMap((r) => r.polygon.map((p) => p.elevation)))
      expect(spanAfter > spanBase, `the onlap must thicken with the drag (was ${spanBase}, now ${spanAfter})`).toBe(true)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})
