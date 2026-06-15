// desktop/src/renderer/src/utils/buildVoxelRequest.test.ts
import { describe, expect, it } from 'vitest'
import { buildVoxelRequest } from './buildVoxelRequest'
import type { FenceSectionInput } from './buildProjectFence'
import { assembleSectionPartitionInput } from './sectionFenceData'
import { computeSectionFill } from './partitionFill'

// One horizontal section, two columns, one through-going ZAND body correlated
// across them (shared bodyId ⇒ a band).
const oneSection: FenceSectionInput[] = [
  {
    section: { start_x: 0, start_y: 0, end_x: 100, end_y: 0 },
    projectedColumns: [
      { investigationId: 'A', alongM: 0, surfaceElevM: 10 },
      { investigationId: 'B', alongM: 100, surfaceElevM: 10 },
    ],
    layers: [
      { investigationId: 'A', layerId: 'a1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 5, accepted: true },
      { investigationId: 'B', layerId: 'b1', formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 5, accepted: true },
    ],
    edges: [{ a: 'a1', b: 'b1' }],
  },
]

describe('buildVoxelRequest', () => {
  // The payload must NOT alter the partition: its regions are exactly what
  // computeSectionFill produces on the same assembled columns + edges.
  it('reproduces computeSectionFill regions verbatim (formations, gaps, polygons)', () => {
    const req = buildVoxelRequest(oneSection, 2.0)
    expect(req.sections).toHaveLength(1)

    const { columns } = assembleSectionPartitionInput(oneSection[0].projectedColumns, oneSection[0].layers)
    const expected = computeSectionFill(columns, oneSection[0].edges)

    const regions = req.sections[0].regions
    expect(regions).toHaveLength(expected.length)
    expect(regions.map((r) => r.formation_id)).toEqual(expected.map((r) => r.formationId))
    expect(regions.map((r) => r.gap_index)).toEqual(expected.map((r) => r.gapIndex))
    expect(regions.map((r) => r.body_id)).toEqual(expected.map((r) => r.bodyId))

    // Each polygon entry is a [fraction, elevation] pair equal to the region's
    // (fraction, elevation) points, in order.
    regions.forEach((region, i) => {
      const expectedPolygon = expected[i].polygon.map((p) => [p.fraction, p.elevation])
      expect(region.polygon).toEqual(expectedPolygon)
    })
  })

  // The grid spacing is passed straight through, untouched.
  it('passes grid_spacing_m through unchanged', () => {
    expect(buildVoxelRequest(oneSection, 1.5).grid_spacing_m).toBe(1.5)
    expect(buildVoxelRequest(oneSection, 2.0).grid_spacing_m).toBe(2.0)
  })

  // A project with no sections yields an empty payload (still carrying spacing).
  it('returns { sections: [], grid_spacing_m } for no sections', () => {
    expect(buildVoxelRequest([], 2.0)).toEqual({ sections: [], grid_spacing_m: 2.0 })
  })

  // The section endpoints round-trip into the payload's start/end world coords.
  it('carries the section endpoints into the payload', () => {
    const req = buildVoxelRequest(oneSection, 2.0)
    const s = req.sections[0]
    expect([s.start_x, s.start_y, s.end_x, s.end_y]).toEqual([0, 0, 100, 0])
  })

  // Tie-snap (mirrors buildProjectFence's multi-section property): a sparse tie's
  // two ends must inherit the DENSE cross-section column positions of the same
  // tests, NOT the tie line's own projection. Two dense cross-sections (3 cols
  // each, at y=0 and y=200) place test A2 at world (50,0) and B2 at (50,200). A
  // sparse tie (2 cols) drawn on the x=0 line connects A2↔B2; its columns must
  // report world_x≈50, not the tie line's own x=0.
  it('snaps a tie column world position to the cross-section column of its test', () => {
    const zandLayer = (inv: string, layerId: string): FenceSectionInput['layers'][number] => ({
      investigationId: inv,
      layerId,
      formationId: 'ZAND',
      bodyId: 'z',
      topDepthM: 0,
      baseDepthM: 5,
      accepted: true,
    })
    const sections: FenceSectionInput[] = [
      {
        // Cross-section A — dense (3 columns), horizontal at y=0. A2 → world (50,0).
        section: { start_x: 0, start_y: 0, end_x: 100, end_y: 0 },
        projectedColumns: [
          { investigationId: 'A1', alongM: 10, surfaceElevM: 10 },
          { investigationId: 'A2', alongM: 50, surfaceElevM: 10 },
          { investigationId: 'A3', alongM: 90, surfaceElevM: 10 },
        ],
        layers: [zandLayer('A1', 'a1L'), zandLayer('A2', 'a2L'), zandLayer('A3', 'a3L')],
        edges: [],
      },
      {
        // Cross-section B — dense (3 columns), horizontal at y=200. B2 → world (50,200).
        section: { start_x: 0, start_y: 200, end_x: 100, end_y: 200 },
        projectedColumns: [
          { investigationId: 'B1', alongM: 10, surfaceElevM: 10 },
          { investigationId: 'B2', alongM: 50, surfaceElevM: 10 },
          { investigationId: 'B3', alongM: 90, surfaceElevM: 10 },
        ],
        layers: [zandLayer('B1', 'b1L'), zandLayer('B2', 'b2L'), zandLayer('B3', 'b3L')],
        edges: [],
      },
      {
        // Tie — sparse (2 columns), drawn on the x=0 line so its OWN projection
        // would put A2/B2 at x=0. Connects A2↔B2.
        section: { start_x: 0, start_y: 0, end_x: 0, end_y: 200 },
        projectedColumns: [
          { investigationId: 'A2', alongM: 0, surfaceElevM: 10 },
          { investigationId: 'B2', alongM: 200, surfaceElevM: 10 },
        ],
        layers: [zandLayer('A2', 'a2L'), zandLayer('B2', 'b2L')],
        edges: [{ a: 'a2L', b: 'b2L' }],
      },
    ]
    const req = buildVoxelRequest(sections, 2.0)
    // The tie section is the one drawn on the x=0 line.
    const tie = req.sections.find((s) => s.start_x === 0 && s.end_x === 0 && s.end_y === 200)
    expect(tie).toBeDefined()
    // Both tie columns snap to x≈50 (the cross-section column position), not the
    // tie line's own x=0.
    for (const col of tie!.columns) {
      expect(col.world_x).toBeCloseTo(50, 4)
    }
    // A2 keeps y≈0 (cross-section A), B2 keeps y≈200 (cross-section B).
    const a2 = tie!.columns.find((c) => c.investigation_id === 'A2')
    const b2 = tie!.columns.find((c) => c.investigation_id === 'B2')
    expect(a2!.world_y).toBeCloseTo(0, 4)
    expect(b2!.world_y).toBeCloseTo(200, 4)
  })
})
