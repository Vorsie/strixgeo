// Coverage for the pure 3D-viewer geometry helpers (debt #41).
//
// Geology3DViewer itself can't be unit-tested (Cesium Viewer needs
// WebGL), but these helpers touch only Cesium math (Cartesian3 /
// Plane) which runs under vitest. This pins the barycentric TIN
// sampler, the basemap-footprint math, and the Sutherland–Hodgman
// half-space clip — the bug class the 585c714 ReferenceError was.

import * as Cesium from 'cesium'
import { describe, expect, it } from 'vitest'

import type { FormationSurfaceResponse } from '../../../api/client'
import {
  GEOPUNT_ORTHO_WMS,
  buildCutFaceBands,
  computeBasemapBounds,
  lidElevationAtInvestigations,
  computeSolidCapTriangles,
  sampleTinZ,
  clipTrisToHalfSpace,
  clipTexTrisToHalfSpace,
  trianglesToWireframeEdgeIndices,
  type CapPlane,
  type StationFormationZ,
  type TexVert,
} from './cesiumGeometry'

/** Every z (every 3rd value) out of a flat [x,y,z,...] soup. */
function zsOf(arr: number[] | undefined): number[] {
  if (!arr) return []
  const zs: number[] = []
  for (let i = 2; i < arr.length; i += 3) zs.push(arr[i])
  return zs
}

// A unit square in projected metres (two triangles), z encodes a
// simple plane z = x + y so barycentric interpolation is checkable.
function squareSurface(): FormationSurfaceResponse {
  return {
    vertices: [
      [0, 0, 0],
      [10, 0, 10],
      [10, 10, 20],
      [0, 10, 10],
    ],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  } as unknown as FormationSurfaceResponse
}

describe('computeBasemapBounds', () => {
  const lambert = (
    verts: [number, number, number][],
  ): { vertices: readonly (readonly [number, number, number])[] }[] => [
    { vertices: verts },
  ]

  it('returns null for a non-Lambert-72 project', () => {
    expect(
      computeBasemapBounds(lambert([[150000, 200000, 5]]), 4326),
    ).toBeNull()
  })

  it('returns null when there are no vertices', () => {
    expect(computeBasemapBounds([{ vertices: [] }], 31370)).toBeNull()
  })

  it('builds a padded WGS84 footprint + a 1.1.1 GetMap url', () => {
    // Two points ~1 km apart near Antwerp in Lambert-72.
    const b = computeBasemapBounds(
      lambert([
        [151000, 211000, 4],
        [152000, 212000, 9],
      ]),
      31370,
    )
    expect(b).not.toBeNull()
    if (b === null) return
    // Footprint is a real degree box around the data.
    expect(b.maxLng).toBeGreaterThan(b.minLng)
    expect(b.maxLat).toBeGreaterThan(b.minLat)
    expect(b.minLng).toBeGreaterThan(4) // Antwerp ≈ 4.4°E
    expect(b.minLng).toBeLessThan(5)
    expect(b.minLat).toBeGreaterThan(51)
    expect(b.minLat).toBeLessThan(52)
    // Elevation is model-top + 0.5 m.
    expect(b.elevation).toBeCloseTo(9.5, 6)
    // 8 % padding either side means the projected bbox in the url is
    // wider than the raw 1 000 m data span.
    expect(b.url.startsWith(`${GEOPUNT_ORTHO_WMS}?service=WMS`)).toBe(true)
    expect(b.url).toContain('version=1.1.1')
    expect(b.url).toContain('srs=EPSG:31370')
    const bbox = /&bbox=([\d.,-]+)/.exec(b.url)?.[1].split(',').map(Number)
    expect(bbox).toBeDefined()
    if (!bbox) return
    const [minE, , maxE] = bbox
    expect(maxE - minE).toBeGreaterThan(1000) // 1 km span + padding
    // Long side capped at 2048 px.
    const w = Number(/&width=(\d+)/.exec(b.url)?.[1])
    const h = Number(/&height=(\d+)/.exec(b.url)?.[1])
    expect(Math.max(w, h)).toBeLessThanOrEqual(2048)
    expect(Math.min(w, h)).toBeGreaterThanOrEqual(1)
  })
})

describe('sampleTinZ', () => {
  const s = squareSurface()

  it('barycentric-interpolates z inside a triangle', () => {
    // Centre of the square → z plane is z = x + y → 5 + 5 = 10.
    expect(sampleTinZ(s, 5, 5)).toBeCloseTo(10, 6)
    // A vertex returns its own z.
    expect(sampleTinZ(s, 10, 10)).toBeCloseTo(20, 6)
  })

  it('returns null outside every triangle (pinch-out / absent)', () => {
    expect(sampleTinZ(s, 100, 100)).toBeNull()
    expect(sampleTinZ(s, -1, -1)).toBeNull()
  })

  it('skips degenerate (zero-area) triangles without throwing', () => {
    const degenerate = {
      vertices: [
        [0, 0, 0],
        [10, 0, 5],
        [20, 0, 9],
      ],
      triangles: [[0, 1, 2]],
    } as unknown as FormationSurfaceResponse
    expect(sampleTinZ(degenerate, 5, 0)).toBeNull()
  })
})

// A plane through the origin with +X normal: kept side is x >= 0.
function xPlane(): Cesium.Plane {
  return new Cesium.Plane(new Cesium.Cartesian3(1, 0, 0), 0)
}
const C3 = (x: number, y: number, z: number): Cesium.Cartesian3 =>
  new Cesium.Cartesian3(x, y, z)

describe('clipTrisToHalfSpace', () => {
  const plane = xPlane()

  it('passes a fully-kept triangle through untouched', () => {
    const tri = [[C3(1, 0, 0), C3(2, 1, 0), C3(3, -1, 0)]]
    const out = clipTrisToHalfSpace(tri, plane, true)
    expect(out).toHaveLength(1)
    expect(out[0]).toBe(tri[0])
  })

  it('drops a fully-clipped triangle', () => {
    const tri = [[C3(-1, 0, 0), C3(-2, 1, 0), C3(-3, -1, 0)]]
    expect(clipTrisToHalfSpace(tri, plane, true)).toHaveLength(0)
  })

  it('one vertex kept → a single clipped triangle on the cut', () => {
    const tri = [[C3(2, 0, 0), C3(-2, 2, 0), C3(-2, -2, 0)]]
    const out = clipTrisToHalfSpace(tri, plane, true)
    expect(out).toHaveLength(1)
    for (const v of out[0]) expect(v.x).toBeGreaterThanOrEqual(-1e-6)
  })

  it('two vertices kept → a fan of two triangles (quad)', () => {
    const tri = [[C3(2, 2, 0), C3(2, -2, 0), C3(-2, 0, 0)]]
    const out = clipTrisToHalfSpace(tri, plane, true)
    expect(out).toHaveLength(2)
    for (const t of out)
      for (const v of t) expect(v.x).toBeGreaterThanOrEqual(-1e-6)
  })

  it('keepPositive=false keeps the mirror half', () => {
    const tri = [[C3(-1, 0, 0), C3(-2, 1, 0), C3(-3, -1, 0)]]
    expect(clipTrisToHalfSpace(tri, plane, false)).toHaveLength(1)
  })
})

describe('clipTexTrisToHalfSpace', () => {
  const plane = xPlane()
  const tv = (
    x: number,
    y: number,
    s: number,
    t: number,
  ): TexVert => ({ p: C3(x, y, 0), st: [s, t] })

  it('lerps the texture coord by the same t as the position', () => {
    // Edge from x=-2 (st 0,0) to x=2 (st 1,1) crosses x=0 at t=0.5,
    // so the cut vertex must carry st (0.5, 0.5).
    const tri = [[tv(2, 1, 1, 1), tv(-2, 1, 0, 0), tv(2, -1, 1, 0)]]
    const out = clipTexTrisToHalfSpace(tri, plane, true)
    expect(out.length).toBeGreaterThanOrEqual(1)
    const cut = out
      .flat()
      .find(v => Math.abs(v.p.x) < 1e-6 && v.st[0] > 0 && v.st[0] < 1)
    expect(cut).toBeDefined()
    if (cut) {
      expect(cut.st[0]).toBeCloseTo(0.5, 6)
      expect(cut.st[1]).toBeCloseTo(0.5, 6)
    }
  })

  it('passes / drops whole triangles like the untextured clip', () => {
    expect(
      clipTexTrisToHalfSpace(
        [[tv(1, 0, 0, 0), tv(2, 1, 1, 0), tv(3, -1, 1, 1)]],
        plane,
        true,
      ),
    ).toHaveLength(1)
    expect(
      clipTexTrisToHalfSpace(
        [[tv(-1, 0, 0, 0), tv(-2, 1, 1, 0), tv(-3, -1, 1, 1)]],
        plane,
        true,
      ),
    ).toHaveLength(0)
  })
})

describe('buildCutFaceBands', () => {
  const A = (z: number): StationFormationZ => ({ z, fid: 'A' })
  const B = (z: number): StationFormationZ => ({ z, fid: 'B' })

  it('builds a clean band per formation when nothing pinches out', () => {
    const out = buildCutFaceBands(
      [
        [A(10), B(5)],
        [A(10), B(5)],
      ],
      [
        [0, 0],
        [10, 0],
      ],
      2,
    )
    expect(new Set(out.keys())).toEqual(new Set(['A', 'B']))
    // A is bounded below by B's top (5), above by its own top (10).
    expect(Math.min(...zsOf(out.get('A')))).toBeCloseTo(5)
    expect(Math.max(...zsOf(out.get('A')))).toBeCloseTo(10)
    // B is the deepest present → a uniform 2 m sliver (5 → 3), NOT a
    // plunge to any global floor.
    expect(Math.min(...zsOf(out.get('B')))).toBeCloseTo(3)
    expect(Math.max(...zsOf(out.get('B')))).toBeCloseTo(5)
  })

  it('does not droop a band to the floor where a deeper one pinches', () => {
    // B present at the first two stations, gone at the third. The old
    // index-aligned walk dropped A's bottom to a global zBase at the
    // station where B vanished — the cut-face droop. Here A must bottom
    // at its OWN sliver (10 − 2 = 8) where it becomes the deepest
    // present, never at B's level.
    const out = buildCutFaceBands(
      [
        [A(10), B(0)],
        [A(10), B(0)],
        [A(10)],
      ],
      [
        [0, 0],
        [10, 0],
        [20, 0],
      ],
      2,
    )
    expect(new Set(out.keys())).toEqual(new Set(['A', 'B']))
    const za = zsOf(out.get('A'))
    // A never plunges below B's top (0): no ramp to B's sliver (−2).
    expect(Math.min(...za)).toBeGreaterThanOrEqual(0 - 1e-9)
    // Where B is gone, A bottoms at its own 2 m sliver (8), not deeper.
    expect(za.some(z => Math.abs(z - 8) < 1e-9)).toBe(true)
    // B keeps its own sliver depth (−2) and wedges out — it never
    // reaches the far station as a full band.
    expect(Math.min(...zsOf(out.get('B')))).toBeCloseTo(-2)
  })
})

// ---------------------------------------------------------------------------
// computeSolidCapTriangles tests (TDD — RED before implementation)
// ---------------------------------------------------------------------------

/**
 * Signed area of a triangle in 3D — used to sanity-check cap geometry.
 * Returns the magnitude (always >= 0).
 */
function triArea3D(
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number],
): number {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const cx = uy * vz - uz * vy
  const cy = uz * vx - ux * vz
  const cz = ux * vy - uy * vx
  return 0.5 * Math.sqrt(cx * cx + cy * cy + cz * cz)
}

/**
 * Signed distance of a point to a CapPlane (positive = same side as normal).
 * Matches Cesium.Plane.getPointDistance semantics: normal·X + constant.
 */
function planeDist(
  p: [number, number, number],
  plane: CapPlane,
): number {
  return (
    p[0] * plane.normal[0] +
    p[1] * plane.normal[1] +
    p[2] * plane.normal[2] +
    plane.constant
  )
}

/** Unit cube: 8 vertices, 12 triangles (2 per face), watertight. */
function unitCubeGeometry(): {
  vertices: [number, number, number][]
  triangles: [number, number, number][]
} {
  // Corners at (0,0,0)...(1,1,1) in XYZ.
  const v: [number, number, number][] = [
    [0, 0, 0], // 0 front-bottom-left
    [1, 0, 0], // 1 front-bottom-right
    [1, 1, 0], // 2 back-bottom-right
    [0, 1, 0], // 3 back-bottom-left
    [0, 0, 1], // 4 front-top-left
    [1, 0, 1], // 5 front-top-right
    [1, 1, 1], // 6 back-top-right
    [0, 1, 1], // 7 back-top-left
  ]
  const t: [number, number, number][] = [
    // bottom (z=0), outward normal -Z
    [0, 2, 1], [0, 3, 2],
    // top (z=1), outward normal +Z
    [4, 5, 6], [4, 6, 7],
    // front (y=0), outward normal -Y
    [0, 1, 5], [0, 5, 4],
    // back (y=1), outward normal +Y
    [2, 3, 7], [2, 7, 6],
    // left (x=0), outward normal -X
    [0, 4, 7], [0, 7, 3],
    // right (x=1), outward normal +X
    [1, 2, 6], [1, 6, 5],
  ]
  return { vertices: v, triangles: t }
}

describe('computeSolidCapTriangles', () => {
  it('unit cube cut at z=0.5 → cap area ≈ 1 (the unit square cross-section), all vertices on plane', () => {
    // Horizontal plane z = 0.5: normal = (0,0,1), constant = -0.5
    // (normal·X + constant = z - 0.5 = 0 at z=0.5)
    const plane: CapPlane = { normal: [0, 0, 1], constant: -0.5 }
    const { vertices, triangles } = unitCubeGeometry()
    const result = computeSolidCapTriangles(vertices, triangles, plane)

    // Must produce some cap geometry.
    expect(result.positions.length).toBeGreaterThan(0)
    // Positions come in triples (x,y,z) for each vertex.
    expect(result.positions.length % 3).toBe(0)
    // Indices come in triples (one per triangle).
    expect(result.indices.length % 3).toBe(0)
    expect(result.indices.length).toBeGreaterThan(0)

    // All cap vertices must lie on the plane (signed dist ≈ 0).
    const EPS = 1e-6
    for (let i = 0; i < result.positions.length; i += 3) {
      const pt: [number, number, number] = [
        result.positions[i],
        result.positions[i + 1],
        result.positions[i + 2],
      ]
      expect(Math.abs(planeDist(pt, plane))).toBeLessThan(EPS)
    }

    // Total cap area should be ≈ 1.0 (unit square).
    let totalArea = 0
    for (let i = 0; i < result.indices.length; i += 3) {
      const a: [number, number, number] = [
        result.positions[result.indices[i] * 3],
        result.positions[result.indices[i] * 3 + 1],
        result.positions[result.indices[i] * 3 + 2],
      ]
      const b: [number, number, number] = [
        result.positions[result.indices[i + 1] * 3],
        result.positions[result.indices[i + 1] * 3 + 1],
        result.positions[result.indices[i + 1] * 3 + 2],
      ]
      const c: [number, number, number] = [
        result.positions[result.indices[i + 2] * 3],
        result.positions[result.indices[i + 2] * 3 + 1],
        result.positions[result.indices[i + 2] * 3 + 2],
      ]
      totalArea += triArea3D(a, b, c)
    }
    // The cross-section of a unit cube by a horizontal plane is a unit square
    // with area 1.0. Allow 1% tolerance for floating-point.
    expect(totalArea).toBeGreaterThan(0.99)
    expect(totalArea).toBeLessThan(1.01)
  })

  it('plane that misses the cube entirely → empty result', () => {
    // Plane at z=2 is entirely above the unit cube (z range [0,1]).
    const plane: CapPlane = { normal: [0, 0, 1], constant: -2 }
    const { vertices, triangles } = unitCubeGeometry()
    const result = computeSolidCapTriangles(vertices, triangles, plane)
    expect(result.positions.length).toBe(0)
    expect(result.indices.length).toBe(0)
  })

  it('plane through a vertex/edge of the cube → valid (possibly small) cap, no crash, all points on plane', () => {
    // Plane exactly through z=0 (the bottom face shared by vertices 0,1,2,3).
    // Every bottom-face vertex has signed distance 0 — degenerate edges exist.
    const plane: CapPlane = { normal: [0, 0, 1], constant: 0 }
    const { vertices, triangles } = unitCubeGeometry()
    // Should not throw.
    const result = computeSolidCapTriangles(vertices, triangles, plane)
    // May produce an empty cap (all bottom triangles are coplanar, no crossings
    // that produce a loop) OR a degenerate-free small polygon — both are valid.
    // What must NOT happen: positions off the plane or a throw.
    const EPS = 1e-4
    for (let i = 0; i < result.positions.length; i += 3) {
      const pt: [number, number, number] = [
        result.positions[i],
        result.positions[i + 1],
        result.positions[i + 2],
      ]
      expect(Math.abs(planeDist(pt, plane))).toBeLessThan(EPS)
    }
    // Indices must be consistent with positions.
    const nVerts = result.positions.length / 3
    for (const idx of result.indices) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(nVerts)
    }
  })

  it('all cap triangles are non-degenerate (area > 0)', () => {
    // Use a diagonal cut through the cube to stress-test triangle quality.
    // Plane: x + z = 1.0 → normal (1/√2, 0, 1/√2), constant = -1/√2.
    const s = 1 / Math.sqrt(2)
    const plane: CapPlane = { normal: [s, 0, s], constant: -s }
    const { vertices, triangles } = unitCubeGeometry()
    const result = computeSolidCapTriangles(vertices, triangles, plane)
    expect(result.indices.length).toBeGreaterThan(0)
    const MIN_TRI_AREA = 1e-10
    for (let i = 0; i < result.indices.length; i += 3) {
      const a: [number, number, number] = [
        result.positions[result.indices[i] * 3],
        result.positions[result.indices[i] * 3 + 1],
        result.positions[result.indices[i] * 3 + 2],
      ]
      const b: [number, number, number] = [
        result.positions[result.indices[i + 1] * 3],
        result.positions[result.indices[i + 1] * 3 + 1],
        result.positions[result.indices[i + 1] * 3 + 2],
      ]
      const c: [number, number, number] = [
        result.positions[result.indices[i + 2] * 3],
        result.positions[result.indices[i + 2] * 3 + 1],
        result.positions[result.indices[i + 2] * 3 + 2],
      ]
      expect(triArea3D(a, b, c)).toBeGreaterThan(MIN_TRI_AREA)
    }
  })

  it('thin slab cut → a band-shaped cap with area ≈ width × thickness', () => {
    // Slab: x in [0,10], y in [0,1], z in [0,0.1] (thin horizontal slab).
    // Cut by plane z=0.05 (mid-height). Expected cap area = 10 × 1 = 10.
    const vertices: [number, number, number][] = [
      [0, 0, 0],   // 0
      [10, 0, 0],  // 1
      [10, 1, 0],  // 2
      [0, 1, 0],   // 3
      [0, 0, 0.1], // 4
      [10, 0, 0.1],// 5
      [10, 1, 0.1],// 6
      [0, 1, 0.1], // 7
    ]
    const triangles: [number, number, number][] = [
      [0, 2, 1], [0, 3, 2], // bottom
      [4, 5, 6], [4, 6, 7], // top
      [0, 1, 5], [0, 5, 4], // front
      [2, 3, 7], [2, 7, 6], // back
      [0, 4, 7], [0, 7, 3], // left
      [1, 2, 6], [1, 6, 5], // right
    ]
    const plane: CapPlane = { normal: [0, 0, 1], constant: -0.05 }
    const result = computeSolidCapTriangles(vertices, triangles, plane)
    expect(result.positions.length).toBeGreaterThan(0)
    let totalArea = 0
    for (let i = 0; i < result.indices.length; i += 3) {
      const a: [number, number, number] = [
        result.positions[result.indices[i] * 3],
        result.positions[result.indices[i] * 3 + 1],
        result.positions[result.indices[i] * 3 + 2],
      ]
      const b: [number, number, number] = [
        result.positions[result.indices[i + 1] * 3],
        result.positions[result.indices[i + 1] * 3 + 1],
        result.positions[result.indices[i + 1] * 3 + 2],
      ]
      const c: [number, number, number] = [
        result.positions[result.indices[i + 2] * 3],
        result.positions[result.indices[i + 2] * 3 + 1],
        result.positions[result.indices[i + 2] * 3 + 2],
      ]
      totalArea += triArea3D(a, b, c)
    }
    // Expected area = 10 × 1 = 10. Allow 2% tolerance.
    expect(totalArea).toBeGreaterThan(9.8)
    expect(totalArea).toBeLessThan(10.2)
  })
})

describe('trianglesToWireframeEdgeIndices', () => {
  it('expands one triangle (0,1,2) into its three edge pairs', () => {
    // i0,i1 i1,i2 i2,i0 — the wireframe of a single triangle.
    expect(trianglesToWireframeEdgeIndices([[0, 1, 2]])).toEqual([0, 1, 1, 2, 2, 0])
  })

  it('emits 6 indices per triangle, preserving the source vertex indices', () => {
    const triangles: [number, number, number][] = [
      [0, 1, 2],
      [2, 3, 4],
    ]
    const edges = trianglesToWireframeEdgeIndices(triangles)
    expect(edges).toHaveLength(triangles.length * 6)
    expect(edges).toEqual([0, 1, 1, 2, 2, 0, 2, 3, 3, 4, 4, 2])
  })

  it('returns an empty buffer for no triangles', () => {
    expect(trianglesToWireframeEdgeIndices([])).toEqual([])
  })

  it('handles the per-triangle soup buffer (sequential indices) the clipped path produces', () => {
    // The clipped path emits a 3-vertex block per triangle: indices
    // 0,1,2 then 3,4,5. Each block must become its own three edges so the
    // wireframe of a triangle soup is correct.
    const soup: [number, number, number][] = [
      [0, 1, 2],
      [3, 4, 5],
    ]
    expect(trianglesToWireframeEdgeIndices(soup)).toEqual([
      0, 1, 1, 2, 2, 0, 3, 4, 4, 5, 5, 3,
    ])
  })
})

// Owner 2026-09-13 (project fhdh): "how come the basemap is so high above the
// mTAW surface?" The lid sat at the single highest vertex of any surface: one
// DEM hull-edge point at +30.8 m lifted it 14 m above collars at +14.7..+17.1.
describe('lidElevationAtInvestigations', () => {
  // A ground TIN over a 20 x 20 m square at +16 m, with one spike at +30 m on
  // the hull corner (the fhdh case).
  const ground = {
    vertices: [
      [0, 0, 16],
      [20, 0, 16],
      [20, 20, 16],
      [0, 20, 16],
      [40, 40, 30], // the DEM spike on the hull edge, away from the data
    ] as [number, number, number][],
    triangles: [
      [0, 1, 2],
      [0, 2, 3],
      [1, 4, 2],
    ] as [number, number, number][],
  }

  it('the lid sits just above the ground at the investigations, not at a DEM spike on the edge', () => {
    // Two investigations in the flat part of the site.
    const z = lidElevationAtInvestigations(ground, [[5, 5], [8, 3]], 0.5)
    expect(z).not.toBeNull()
    expect(z as number).toBeGreaterThan(16)
    expect(z as number).toBeLessThan(18)
  })

  it('with no investigations or no ground there is no answer, so the caller keeps the old rule', () => {
    expect(lidElevationAtInvestigations(ground, [], 0.5)).toBeNull()
    expect(lidElevationAtInvestigations(null, [[5, 5]], 0.5)).toBeNull()
  })

  it('an investigation outside every triangle is ignored, the others still answer', () => {
    const z = lidElevationAtInvestigations(ground, [[500, 500], [5, 5]], 0.5)
    expect(z as number).toBeCloseTo(16.5, 6)
  })

  it('computeBasemapBounds places the lid at the given elevation instead of the highest vertex', () => {
    const b = computeBasemapBounds([ground], 31370, 16.5)
    expect(b?.elevation).toBeCloseTo(16.5, 6)
    // The old rule: the highest vertex plus its half-metre clearance.
    const fallback = computeBasemapBounds([ground], 31370, null)
    expect(fallback?.elevation).toBeCloseTo(30.5, 6)
  })
})
