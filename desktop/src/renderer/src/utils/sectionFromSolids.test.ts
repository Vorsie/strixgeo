import { describe, expect, it } from 'vitest'
import { sampleSolidColumns, sliceSolidsAtPlane, type SolidMesh } from './sectionFromSolids'

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

// One body whose mesh is TWO disjoint boxes (same bodyId): box A at x[0,10] and
// box B at x[20,30], both y[0,10], top 0 / base -4. A plane crossing both must
// produce two separate rings.
function twoBoxBody(bodyId: string, formationId: string): SolidMesh {
  const mk = (ox: number): [number, number, number][] => [
    [ox, 0, 0], [ox + 10, 0, 0], [ox + 10, 10, 0], [ox, 10, 0],
    [ox, 0, -4], [ox + 10, 0, -4], [ox + 10, 10, -4], [ox, 10, -4],
  ]
  const tri = (b: number): [number, number, number][] => [
    [b + 0, b + 1, b + 2], [b + 0, b + 2, b + 3],
    [b + 4, b + 6, b + 5], [b + 4, b + 7, b + 6],
    [b + 0, b + 4, b + 5], [b + 0, b + 5, b + 1], [b + 1, b + 5, b + 6], [b + 1, b + 6, b + 2],
    [b + 2, b + 6, b + 7], [b + 2, b + 7, b + 3], [b + 3, b + 7, b + 4], [b + 3, b + 4, b + 0],
  ]
  return {
    bodyId,
    formationId,
    color: '#fbbf24',
    vertices: [...mk(0), ...mk(20)],
    triangles: [...tri(0), ...tri(8)],
  }
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

describe('sliceSolidsAtPlane (mode B)', () => {
  it('slices a box body along a line crossing it → a filled ring', () => {
    // section line y=5, from x=-5..15 → crosses the [0,10] box
    const line = { ax: -5, ay: 5, bx: 15, by: 5 }
    const polys = sliceSolidsAtPlane([box('b1','SAND',0,10,0,10,0,-4)], line)
    expect(polys).toHaveLength(1)
    // polygon spans alongM ~5..15 (box x 0..10 mapped onto the line origin -5), elev -4..0
    const elevs = polys[0].points.map(p => p.elev)
    expect(Math.min(...elevs)).toBeCloseTo(-4, 6)
    expect(Math.max(...elevs)).toBeCloseTo(0, 6)
    // alongM is the primary horizontal output: x=0 → along 5, x=10 → along 15
    // (projection origin is the line's first endpoint at x=-5). Asserting it
    // guards against a wrong projection origin / transposed axis.
    const alongs = polys[0].points.map((p) => p.alongM)
    expect(Math.min(...alongs)).toBeCloseTo(5, 6)
    expect(Math.max(...alongs)).toBeCloseTo(15, 6)
  })
  it('slices along a diagonal line (exercises both dx and dy terms)', () => {
    // Diagonal section line that cleanly cuts the box interior near the (0,10)
    // corner — offset so it avoids passing exactly through any box vertex
    // (a corner-to-corner diagonal is a degenerate tangent, not a real cut).
    const line = { ax: -2, ay: 0, bx: 8, by: 10 }
    const polys = sliceSolidsAtPlane([box('b1', 'SAND', 0, 10, 0, 10, 0, -4)], line)
    expect(polys).toHaveLength(1)
    const elevs = polys[0].points.map((p) => p.elev)
    expect(Math.min(...elevs)).toBeCloseTo(-4, 6)
    expect(Math.max(...elevs)).toBeCloseTo(0, 6)
  })
  it('returns [] for a zero-length section line', () => {
    expect(
      sliceSolidsAtPlane([box('b1', 'SAND')], { ax: 5, ay: 5, bx: 5, by: 5 }),
    ).toEqual([])
  })
  it('returns nothing for a body the line misses', () => {
    const line = { ax: -5, ay: 50, bx: 15, by: 50 }
    expect(sliceSolidsAtPlane([box('b1','SAND',0,10,0,10)], line)).toHaveLength(0)
  })

  it('emits ALL closed loops when one body slices into two disjoint pieces', () => {
    // One body (bodyId 'b1') made of two disjoint boxes — the 3-D shape of a
    // body that pinches out and reappears (interfingering / lens). A section
    // line crossing BOTH boxes must yield TWO filled rings, not one: chaining
    // only the first loop would silently drop the second piece's fill (the
    // mode-B gap the voxel builder exposes).
    const line = { ax: -5, ay: 5, bx: 45, by: 5 }
    const polys = sliceSolidsAtPlane([twoBoxBody('b1', 'SAND')], line)
    expect(polys).toHaveLength(2)
    // Both rings belong to the same body and carry its colour.
    expect(polys.every((p) => p.bodyId === 'b1')).toBe(true)
    // The two rings sit at different along-section positions (the two boxes).
    const centres = polys
      .map((p) => p.points.reduce((s, q) => s + q.alongM, 0) / p.points.length)
      .sort((a, b) => a - b)
    expect(centres[1] - centres[0]).toBeGreaterThan(15)
  })
})
