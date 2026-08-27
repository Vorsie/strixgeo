// desktop/src/renderer/src/utils/fencePanels.test.ts
import { describe, expect, it } from 'vitest'
import { buildFencePanels, type FenceColumn, type FenceRegion } from './fencePanels'

// A horizontal section: start (0,0) → end (100,0), so along == world x, world y == 0.
const section = { start_x: 0, start_y: 0, end_x: 100, end_y: 0 }

describe('buildFencePanels', () => {
  it('projects a quad region into a vertical wall panel in world space', () => {
    const columns: FenceColumn[] = [
      { investigationId: 'L', alongM: 0 },
      { investigationId: 'R', alongM: 100 },
    ]
    const regions: FenceRegion[] = [
      {
        formationId: 'ZAND',
        bodyId: 'b1',
        layerIds: ['ll-1', 'll-2'],
        gapIndex: 0,
        polygon: [
          { fraction: 0, elevation: 5 },
          { fraction: 1, elevation: 5 },
          { fraction: 1, elevation: 0 },
          { fraction: 0, elevation: 0 },
        ],
      },
    ]
    const panels = buildFencePanels(section, columns, regions)
    expect(panels).toHaveLength(1)
    expect(panels[0].formationId).toBe('ZAND')
    expect(panels[0].bodyId).toBe('b1')
    // Source-layer ids ride the panel (amended F3, 2026-08-27): the cutout's
    // body scope resolves panels through THEM, never the bodyId label above.
    expect(panels[0].layerIds).toEqual(['ll-1', 'll-2'])
    const xs = panels[0].vertices.map((v) => v[0]).sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(0, 6)
    expect(xs[xs.length - 1]).toBeCloseTo(100, 6)
    expect(panels[0].vertices.every((v) => Math.abs(v[1]) < 1e-6)).toBe(true) // y == 0
    const zs = panels[0].vertices.map((v) => v[2])
    expect(Math.min(...zs)).toBeCloseTo(0, 6)
    expect(Math.max(...zs)).toBeCloseTo(5, 6)
    expect(panels[0].triangles).toHaveLength(2) // quad → 2 triangles
  })

  it('places the gap-midpoint (fraction 0.5) halfway between the two columns', () => {
    const columns: FenceColumn[] = [
      { investigationId: 'L', alongM: 20 },
      { investigationId: 'R', alongM: 60 },
    ]
    const regions: FenceRegion[] = [
      {
        formationId: 'KLEI',
        bodyId: null,
        gapIndex: 0,
        polygon: [
          { fraction: 0, elevation: 1 },
          { fraction: 0.5, elevation: 1 }, // midpoint apex
          { fraction: 0, elevation: -1 },
        ],
      },
    ]
    const panels = buildFencePanels(section, columns, regions)
    const apex = panels[0].vertices.find((v) => Math.abs(v[2] - 1) < 1e-6 && v[0] > 20.001)!
    expect(apex[0]).toBeCloseTo(40, 6) // along 20 + 0.5*(60−20) = 40
  })

  it('skips a region whose gapIndex has no bounding column pair', () => {
    const columns: FenceColumn[] = [{ investigationId: 'L', alongM: 0 }]
    const regions: FenceRegion[] = [
      { formationId: 'ZAND', bodyId: null, gapIndex: 0, polygon: [
        { fraction: 0, elevation: 1 }, { fraction: 1, elevation: 1 }, { fraction: 0, elevation: 0 },
      ] },
    ]
    expect(buildFencePanels(section, columns, regions)).toEqual([]) // no column at index 1
  })
})
