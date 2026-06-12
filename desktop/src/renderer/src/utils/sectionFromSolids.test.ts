import { describe, expect, it } from 'vitest'
import { sampleSolidColumns, type SolidMesh } from './sectionFromSolids'

// A single SAND box body spanning x,y in [0,10], top z=0, base z=-4.
function box(bodyId: string, formationId: string, x0=0, x1=10, y0=0, y1=10, top=0, base=-4): SolidMesh {
  const v: [number, number, number][] = [
    [x0,y0,top],[x1,y0,top],[x1,y1,top],[x0,y1,top],
    [x0,y0,base],[x1,y0,base],[x1,y1,base],[x0,y1,base],
  ]
  const t: [number, number, number][] = [
    [0,1,2],[0,2,3],            // top
    [4,6,5],[4,7,6],            // base
    [0,4,5],[0,5,1],[1,5,6],[1,6,2],[2,6,7],[2,7,3],[3,7,4],[3,4,0], // walls
  ]
  return { bodyId, formationId, color: '#fbbf24', vertices: v, triangles: t }
}

describe('sampleSolidColumns (mode A)', () => {
  it('samples a body top/base at a test inside its footprint', () => {
    const cols = sampleSolidColumns([box('b1','SAND')], [{ id: 't1', x: 5, y: 5, alongM: 100 }])
    expect(cols).toHaveLength(1)
    expect(cols[0].alongM).toBe(100)
    expect(cols[0].segments).toHaveLength(1)
    expect(cols[0].segments[0].topElev).toBeCloseTo(0, 6)
    expect(cols[0].segments[0].baseElev).toBeCloseTo(-4, 6)
    expect(cols[0].segments[0].bodyId).toBe('b1')
  })
  it('omits bodies whose footprint does not cover the test (body absent there)', () => {
    const cols = sampleSolidColumns([box('b1','SAND',0,4,0,10)], [{ id: 't1', x: 8, y: 5, alongM: 0 }])
    expect(cols[0].segments).toHaveLength(0)
  })
  it('stacks two bodies at one test, deepest last', () => {
    const sand = box('s','SAND',0,10,0,10,0,-4)
    const clay = box('c','CLAY',0,10,0,10,-4,-16)
    const cols = sampleSolidColumns([sand, clay], [{ id: 't1', x: 5, y: 5, alongM: 0 }])
    const elevs = cols[0].segments.map(s => s.baseElev)
    expect(elevs).toEqual([-4, -16])
    // Directly assert the topElev-descending sort key (shallowest first).
    expect(cols[0].segments.map(s => s.topElev)).toEqual([0, -4])
  })
})
