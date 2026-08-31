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

  it('merges per SECTION — two sections resolving to one body stay two panels', () => {
    // The merge collapses per-gap panels WITHIN a section; it never fuses walls
    // across sections. Two separate cross-sections, each a single through-going
    // body, both resolving to the SAME body id, must still yield one panel each.
    const oneBodySection = (y: number, aId: string, bId: string): FenceSectionInput => ({
      section: { start_x: 0, start_y: y, end_x: 100, end_y: y },
      projectedColumns: [
        { investigationId: `${aId}i`, alongM: 0, surfaceElevM: 10 },
        { investigationId: `${bId}i`, alongM: 100, surfaceElevM: 10 },
      ],
      layers: [
        { investigationId: `${aId}i`, layerId: aId, formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 5, accepted: true },
        { investigationId: `${bId}i`, layerId: bId, formationId: 'ZAND', bodyId: 'z', topDepthM: 0, baseDepthM: 5, accepted: true },
      ],
      edges: [{ a: aId, b: bId }],
    })
    const sections = [oneBodySection(0, 'a1', 'b1'), oneBodySection(300, 'c1', 'd1')]
    // Every layer resolves to ONE shared body — a global merge would collapse to
    // a single panel; the per-section scope keeps them separate.
    const resolveBody = (): string | null => 'shared'
    const panels = buildProjectFence(sections, undefined, undefined, resolveBody)
    expect(panels.filter(p => p.formationId === 'ZAND')).toHaveLength(2)
  })

  // Tie-snap (dogfeed 2026-06-10): a tie's two ends should render at the
  // cross-section column positions of the same tests, NOT at the tie line's own
  // projection. Two dense cross-sections (3 cols each, at y=0 and y=200) place
  // test A2 at world (50,0) and B2 at (50,200). A sparse tie (2 cols) drawn on a
  // DIFFERENT line (x=0) connects A2↔B2; its rung must snap to x≈50, not x=0.
  it('snaps a tie rung to the cross-section column positions of its tests', () => {
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
    const panels = buildProjectFence(sections)
    // The tie's panels are the ones that span y from ~0 to ~200 (the rung
    // crosses between the two cross-sections); cross-section panels stay at a
    // single y.
    const tiePanels = panels.filter((p) => {
      const ys = p.vertices.map((v) => v[1])
      return Math.min(...ys) < 50 && Math.max(...ys) > 150
    })
    expect(tiePanels.length).toBeGreaterThan(0)
    // Every tie vertex snaps to x≈50 (the cross-section column position), not the
    // tie line's own x=0.
    for (const p of tiePanels) {
      for (const v of p.vertices) {
        expect(v[0]).toBeCloseTo(50, 4)
      }
    }
  })
})
