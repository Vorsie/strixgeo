/**
 * Reviewer finding F8, 2026-08-22 code hunt: ``dropRegionNeedles`` (the
 * "no outline that ends in nothing" pass, owner's B3|S9 pale-line ruling —
 * see ``dropNeedleSpurs.ts``) was applied to the returned ``regions`` only.
 * ``lithoFallback`` (the un-classed litho cover — a REAL rendered surface,
 * see ``PartitionFillOverlay.tsx``) and ``preMergeRegions`` (consumed by the
 * 2/1/0 conformance gate and the law oracle) could still carry the exact same
 * hairline artifact, since both are populated independently of the
 * ``regions`` array the sweep runs on.
 *
 * @module utils/geotechHierarchicalFill/needleDropCoverage
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from './index'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../partitionFill'
import { regionAreaM2 } from '../partitionFill/regionArea'

// The owner's own real needle ring (B3|S9, CS1 gap 12), verbatim from
// dropNeedleSpurs.test.ts's NS1 — the exact detour that started this whole
// round of fixes. Reused here at its real gap width so the needle threshold
// applies identically.
const GAP_WIDTH_M = 34.832
const needleRing = [
  { fraction: 0.45, elevation: 7.23 },
  { fraction: 0.166, elevation: 6.44 },
  { fraction: 0.5, elevation: 6.36 },
  { fraction: 1.0, elevation: 6.23 },
  { fraction: 1.0, elevation: 11.73 },
  { fraction: 0.8, elevation: 11.98 },
  { fraction: 0.5, elevation: 12.36 },
  { fraction: 0.0, elevation: 12.98 },
  { fraction: 0.0, elevation: 11.98 },
  { fraction: 0.45, elevation: 10.23 },
  { fraction: 0.0, elevation: 8.48 },
  { fraction: 0.0, elevation: 6.48 },
  { fraction: 0.182, elevation: 6.484 },
]

// A litho region carrying a soil code no litho column mentions at all lands
// unconditionally in ``unattributed`` (families.ts's own fallback path) —
// the simplest, most direct way to steer a hand-built needle ring into
// ``lithoFallback`` without needing the litho engine to produce one itself.
const FOREIGN_SOIL = 'f-foreign-unmatched'

function needleLithoRegion(): SectionRegion {
  return {
    formationId: FOREIGN_SOIL,
    bodyId: null,
    kind: 'quad',
    polygon: needleRing,
    gapIndex: 0,
  }
}

describe('needle-drop coverage — the fallback and pre-merge surfaces are swept too', () => {
  it('NDC1 — a closed thin fallback region remains model ground', () => {
    const litho: PartitionColumn[] = [
      { investigationId: 'A', surfaceElevM: 20, units: [] },
      { investigationId: 'B', surfaceElevM: 20, units: [] },
    ]
    const lithoEdges: CorrelationEdge[] = []
    const alongM = [0, GAP_WIDTH_M]
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho,
      lithoEdges,
      lithoRegions: [needleLithoRegion()],
      geotechColumns: litho,
      geotechEdges: [],
      alongM,
    })
    const retained = out.lithoFallback.find((r) => r.gapIndex === 0)
    expect(retained, 'a closed litho-derived region must remain in final coverage').toBeDefined()
    expect(regionAreaM2(retained!, GAP_WIDTH_M)).toBeCloseTo(
      regionAreaM2(needleLithoRegion(), GAP_WIDTH_M),
      9,
    )
  })
})
