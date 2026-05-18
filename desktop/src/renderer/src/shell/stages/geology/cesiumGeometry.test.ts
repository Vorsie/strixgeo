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
  sampleTinZ,
  clipTrisToHalfSpace,
  clipTexTrisToHalfSpace,
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
