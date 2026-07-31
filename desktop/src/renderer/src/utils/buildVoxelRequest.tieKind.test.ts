// desktop/src/renderer/src/utils/buildVoxelRequest.tieKind.test.ts
import { describe, expect, it } from 'vitest'
import { buildVoxelRequest } from './buildVoxelRequest'
import type { FenceSectionInput } from './buildProjectFence'
import { assembleSectionPartitionInput } from './sectionFenceData'
import { computeSectionFillActive } from './partitionEngineSelect'

// Two columns. ZAND is correlated across both, so it bands. Below it the columns
// disagree — SILT on the left, KLEI on the right — so each is present on one column
// only and the engine has to terminate it somewhere. That gives the engine more than
// one classification to produce, which is the point: the payload must carry whichever
// classification the engine reached, not a single value that happens to match.
const mixedSection: FenceSectionInput[] = [
  {
    section: { start_x: 0, start_y: 0, end_x: 100, end_y: 0 },
    projectedColumns: [
      { investigationId: 'A', alongM: 0, surfaceElevM: 10 },
      { investigationId: 'B', alongM: 100, surfaceElevM: 10 },
    ],
    layers: [
      { investigationId: 'A', layerId: 'a1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 5, accepted: true },
      { investigationId: 'A', layerId: 'a2', formationId: 'SILT', bodyId: 's', topDepthM: 5, baseDepthM: 9, accepted: true },
      { investigationId: 'B', layerId: 'b1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 5, accepted: true },
      { investigationId: 'B', layerId: 'b2', formationId: 'KLEI', bodyId: 'k', topDepthM: 5, baseDepthM: 9, accepted: true },
    ],
    edges: [{ a: 'a1', b: 'b1' }],
  },
]

/** What the 2-D engine itself produces for the fixture, region for region. */
function engineRegions() {
  const { columns } = assembleSectionPartitionInput(
    mixedSection[0].projectedColumns,
    mixedSection[0].layers,
  )
  return computeSectionFillActive(columns, mixedSection[0].edges)
}

describe('buildVoxelRequest carries the 2-D classification', () => {
  // Guards the test itself: if the fixture only ever produced one kind, comparing
  // kinds would pass on a payload that hard-coded that kind.
  it('the fixture makes the engine produce more than one classification', () => {
    const kinds = new Set(engineRegions().map((r) => r.kind))
    expect(kinds.size).toBeGreaterThan(1)
  })

  it('sends each region with the classification the engine gave it', () => {
    const req = buildVoxelRequest(mixedSection, 2.0, 1.0)
    const expected = engineRegions()
    const sent = req.sections[0].regions

    expect(sent).toHaveLength(expected.length)
    expect(sent.map((r) => r.kind)).toEqual(expected.map((r) => r.kind))
  })

  it('sends the overlay tier, so an onlap is not confused with an enclosed lens', () => {
    const req = buildVoxelRequest(mixedSection, 2.0, 1.0)
    const expected = engineRegions()

    expect(req.sections[0].regions.map((r) => r.overlay_tier ?? null)).toEqual(
      expected.map((r) => r.overlayTier ?? null),
    )
  })

  it('sends the tied band base, which a user correlation makes absolute', () => {
    const req = buildVoxelRequest(mixedSection, 2.0, 1.0)
    const expected = engineRegions()

    expect(req.sections[0].regions.map((r) => r.tied_band_base ?? null)).toEqual(
      expected.map((r) => r.tiedBandBase ?? null),
    )
  })

  it('sends the tie-clipped flag, so a region split at a tie is not re-merged', () => {
    const req = buildVoxelRequest(mixedSection, 2.0, 1.0)
    const expected = engineRegions()

    expect(req.sections[0].regions.map((r) => r.tie_clipped ?? false)).toEqual(
      expected.map((r) => r.tieClipped ?? false),
    )
  })
})
