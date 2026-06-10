// desktop/src/renderer/src/utils/buildProjectFence.test.ts
import { describe, expect, it } from 'vitest'
import { buildProjectFence, type FenceSectionInput } from './buildProjectFence'

// One horizontal section, two columns, one through-going ZAND body correlated
// across them (shared bodyId ⇒ a band) → expect ≥1 ZAND panel spanning the gap.
const input: FenceSectionInput[] = [
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

describe('buildProjectFence', () => {
  it('produces fence panels spanning the gap for a correlated through-going body', () => {
    const panels = buildProjectFence(input)
    expect(panels.length).toBeGreaterThan(0)
    const zand = panels.filter((p) => p.formationId === 'ZAND')
    expect(zand.length).toBeGreaterThan(0)
    const xs = zand.flatMap((p) => p.vertices.map((v) => v[0]))
    expect(Math.min(...xs)).toBeCloseTo(0, 4)
    expect(Math.max(...xs)).toBeCloseTo(100, 4)
  })

  it('returns [] for a project with no sections', () => {
    expect(buildProjectFence([])).toEqual([])
  })
})
