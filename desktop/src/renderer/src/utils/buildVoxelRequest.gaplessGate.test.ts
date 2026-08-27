// desktop/src/renderer/src/utils/buildVoxelRequest.gaplessGate.test.ts
//
// Wiring test for `gapless_2d` on the voxel build payload: proves the four
// renderer-side clauses reach `VoxelBuildRequest.gapless_2d`, keyed and named
// correctly, for the three shapes a real build can be in — litho-only, a
// clean framed (geotech) build, and a framed build missing a section.
//
// The clause-level pass/fail LOGIC is already unit-tested in
// `gaplessGate/clauses2d.test.ts`, `sectionClosure.test.ts` and `index.test.ts`
// in isolation; this file only proves the WIRING — that buildVoxelRequest
// collects the right per-section inputs and threads them through.
import { describe, expect, it } from 'vitest'
import { buildVoxelRequest } from './buildVoxelRequest'
import type { FenceSectionInput } from './buildProjectFence'

const litho = (inv: string, layerId: string): FenceSectionInput['layers'][number] => ({
  investigationId: inv,
  layerId,
  formationId: 'ZAND',
  bodyId: 'z',
  topDepthM: 0,
  baseDepthM: 5,
  accepted: true,
})

const packing = (inv: string, layerId: string): FenceSectionInput['layers'][number] => ({
  investigationId: inv,
  layerId,
  formationId: 'NAD6',
  bodyId: null,
  topDepthM: 0,
  baseDepthM: 5,
  accepted: true,
})

function sectionAt(
  sectionId: string,
  y: number,
  layers: FenceSectionInput['layers'],
  edges: FenceSectionInput['edges'],
): FenceSectionInput {
  return {
    sectionId,
    section: { start_x: 0, start_y: y, end_x: 100, end_y: y },
    projectedColumns: [
      { investigationId: 'A', alongM: 0, surfaceElevM: 10 },
      { investigationId: 'B', alongM: 100, surfaceElevM: 10 },
    ],
    layers,
    edges,
  }
}

describe('buildVoxelRequest — gapless_2d wiring, litho-only build', () => {
  it('carries all four clauses, not-evaluated (no litho frame supplied)', () => {
    const geotechSection = sectionAt('s1', 0, [packing('A', 'a1g'), packing('B', 'b1g')], [
      { a: 'a1g', b: 'b1g' },
    ])
    const req = buildVoxelRequest([geotechSection], 2.0, 1.0)
    expect(req.gapless_2d).toBeDefined()
    expect(req.gapless_2d).toHaveLength(4)
    for (const clause of req.gapless_2d!) {
      expect(clause.status).toBe('not-evaluated')
      expect(clause.entries).toEqual([])
    }
  })
})

describe('buildVoxelRequest — gapless_2d wiring, a clean framed (geotech) build', () => {
  it('evaluates clauses 1-3 clean and clause 4 passes when the frame fully covers the payload', () => {
    const lithoSection = sectionAt('s1', 0, [litho('A', 'a1'), litho('B', 'b1')], [
      { a: 'a1', b: 'b1' },
    ])
    // The packing band spans the SAME depth range as its litho parent, so the
    // hierarchical fill should classify the whole gap with nothing left over.
    const geotechSection = sectionAt('s1', 0, [packing('A', 'a1g'), packing('B', 'b1g')], [
      { a: 'a1g', b: 'b1g' },
    ])
    const sectionNames = new Map([['s1', 'Cross-section 1']])
    const req = buildVoxelRequest(
      [geotechSection],
      2.0,
      1.0,
      undefined,
      [lithoSection],
      undefined,
      sectionNames,
    )
    expect(req.gapless_2d).toBeDefined()
    const byKey = new Map(req.gapless_2d!.map((c) => [c.key, c]))
    expect(byKey.get('area-conservation')?.status).toBe('pass')
    expect(byKey.get('edge-reach')?.status).toBe('pass')
    expect(byKey.get('cause-closure')?.status).toBe('pass')
    expect(byKey.get('section-closure')?.status).toBe('pass')
  })
})

describe('buildVoxelRequest — gapless_2d wiring, a framed build missing a section', () => {
  it('fails clause 4, naming the litho-frame section absent from the payload', () => {
    const lithoS1 = sectionAt('s1', 0, [litho('A', 'a1'), litho('B', 'b1')], [{ a: 'a1', b: 'b1' }])
    const lithoS2 = sectionAt('s2', 200, [litho('A', 'a2'), litho('B', 'b2')], [{ a: 'a2', b: 'b2' }])
    // Only s1 has geotech coverage — s2 never appears in the geotech `sections` list.
    const geotechS1 = sectionAt('s1', 0, [packing('A', 'a1g'), packing('B', 'b1g')], [
      { a: 'a1g', b: 'b1g' },
    ])
    const sectionNames = new Map([
      ['s1', 'Cross-section 1'],
      ['s2', 'Tie-section 2'],
    ])
    const req = buildVoxelRequest(
      [geotechS1],
      2.0,
      1.0,
      undefined,
      [lithoS1, lithoS2],
      undefined,
      sectionNames,
    )
    const closure = req.gapless_2d!.find((c) => c.key === 'section-closure')!
    expect(closure.status).toBe('fail')
    expect(closure.entries).toHaveLength(1)
    expect(closure.entries[0].section_id).toBe('s2')
    expect(closure.entries[0].section_name).toBe('Tie-section 2')
    expect(closure.entries[0].label).toContain('Tie-section 2')
  })
})
