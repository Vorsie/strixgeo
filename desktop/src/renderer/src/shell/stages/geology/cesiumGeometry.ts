// Pure geometry helpers for the 3D geology viewer (debt #41).
//
// Geology3DViewer.tsx is ~1,740 lines and cannot be unit-tested
// (Cesium's Viewer/Scene/Primitive layer needs WebGL). But its
// coordinate math is pure: the basemap-footprint bbox, barycentric
// TIN sampling, and the Sutherland–Hodgman half-space clip touch
// only Cesium's *math* classes (Cartesian3 / Plane / lerp) which run
// fine under vitest without a canvas. These were extracted VERBATIM
// from Geology3DViewer (behaviour byte-identical) so they can carry
// real test coverage — the class of bug the 585c714 flyToCutFace
// ReferenceError was.

import * as Cesium from 'cesium'

import type { FormationSurfaceResponse } from '../../../api/client'
import { projectedToWgs84 } from '../../../hooks/useWgs84'

// WMTS over the whole Cesium ellipsoid (the GoogleMapsVL matrixset
// never tiles right under Cesium → the 400-storm + smeared "wall").
export const GEOPUNT_ORTHO_WMS = 'https://geo.api.vlaanderen.be/omwrgbmrvl/wms'

/** The pure result of {@link computeBasemapBounds}: the WGS84 degree
 * rectangle to drape the orthophoto in, the elevation (model top) to
 * place it at, and the one-shot WMS GetMap image URL. Cesium-free so
 * it is unit-testable; the caller wraps it in a ``Cesium.Rectangle``. */
export interface BasemapBounds {
  minLng: number
  minLat: number
  maxLng: number
  maxLat: number
  elevation: number
  url: string
}

/**
 * Compute the basemap "lid" footprint — one Geopunt orthophoto GetMap
 * image for the model footprint, placed as a flat textured rectangle
 * at the model's top elevation. Only Belgian Lambert-72 projects
 * (Geopunt's only CRS for this layer); returns ``null`` otherwise or
 * when there are no vertices yet.
 *
 * Parameters
 * ----------
 * surfaces
 *     Anything with projected ``[x, y, z]`` vertices in ``projectEpsg``
 *     (formation TINs + the ground surface).
 * projectEpsg
 *     Project horizontal CRS. Must be 31370 for the Geopunt ortho.
 *
 * Returns
 * -------
 * BasemapBounds | null
 */
export function computeBasemapBounds(
  surfaces: { vertices: readonly (readonly [number, number, number])[] }[],
  projectEpsg: number,
): BasemapBounds | null {
  if (projectEpsg !== 31370) return null
  let minE = Infinity
  let maxE = -Infinity
  let minN = Infinity
  let maxN = -Infinity
  let maxZ = -Infinity
  let n = 0
  for (const s of surfaces) {
    for (const [x, y, z] of s.vertices) {
      if (x < minE) minE = x
      if (x > maxE) maxE = x
      if (y < minN) minN = y
      if (y > maxN) maxN = y
      if (z > maxZ) maxZ = z
      n++
    }
  }
  if (n === 0) return null
  const padE = (maxE - minE) * 0.08 || 1
  const padN = (maxN - minN) * 0.08 || 1
  minE -= padE
  maxE += padE
  minN -= padN
  maxN += padN
  const [latSW, lngSW] = projectedToWgs84(minE, minN, projectEpsg)
  const [latNE, lngNE] = projectedToWgs84(maxE, maxN, projectEpsg)
  // Image px ~ bbox aspect, capped at 2048 on the long side.
  const dE = maxE - minE
  const dN = maxN - minN
  const longSide = Math.max(dE, dN, 1)
  const scale = 2048 / longSide
  const imgW = Math.max(1, Math.round(dE * scale))
  const imgH = Math.max(1, Math.round(dN * scale))
  // WMS 1.1.1 — avoids the 1.3.0 EPSG:31370 axis-order trap (1.1.1 is
  // always minx,miny,maxx,maxy = easting,northing).
  const url =
    `${GEOPUNT_ORTHO_WMS}?service=WMS&request=GetMap&version=1.1.1` +
    `&layers=Ortho&styles=&srs=EPSG:31370&format=image/png` +
    `&width=${imgW}&height=${imgH}` +
    `&bbox=${minE},${minN},${maxE},${maxN}`
  return {
    minLng: Math.min(lngSW, lngNE),
    minLat: Math.min(latSW, latNE),
    maxLng: Math.max(lngSW, lngNE),
    maxLat: Math.max(latSW, latNE),
    elevation: maxZ + 0.5,
    url,
  }
}

/**
 * Sample a formation TIN's elevation at a projected (x, y) point by
 * locating the containing triangle (projected XY) and barycentric-
 * interpolating z. Returns ``null`` when the point is outside the
 * surface (pinch-out / absent).
 *
 * Parameters
 * ----------
 * surface
 *     The formation TIN (projected vertices + triangle indices).
 * px, py
 *     Query point in the project's horizontal CRS.
 *
 * Returns
 * -------
 * number | null
 *     Interpolated z, or ``null`` if (px, py) is outside every triangle.
 */
export function sampleTinZ(
  surface: FormationSurfaceResponse,
  px: number,
  py: number,
): number | null {
  for (const [i0, i1, i2] of surface.triangles) {
    const [ax, ay, az] = surface.vertices[i0]
    const [bx, by, bz] = surface.vertices[i1]
    const [cx, cy, cz] = surface.vertices[i2]
    const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy)
    if (Math.abs(d) < 1e-9) continue
    const l1 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / d
    const l2 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / d
    const l3 = 1 - l1 - l2
    const EPS = -1e-6
    if (l1 >= EPS && l2 >= EPS && l3 >= EPS) {
      return l1 * az + l2 * bz + l3 * cz
    }
  }
  return null
}

/**
 * Half-space clip used by the split view (G6 step 1). Given ECEF
 * triangles and a Cesium.Plane, returns the triangle soup on the kept
 * side (Sutherland–Hodgman per triangle; crossing edges produce 1–2
 * output triangles). ``keepPositive`` keeps the side the plane normal
 * points to — the secondary viewport passes ``false`` for the other
 * half. This is the actual "slice the cake" cut (Cesium has no
 * ClippingPlaneCollection for raw Primitives).
 *
 * Parameters
 * ----------
 * triangles
 *     ECEF triangle soup (each entry is a 3-vertex array).
 * plane
 *     The split plane.
 * keepPositive
 *     Keep the side the plane normal points to when ``true``.
 *
 * Returns
 * -------
 * Cesium.Cartesian3[][]
 *     The kept (and re-triangulated) triangle soup.
 */
export function clipTrisToHalfSpace(
  triangles: Cesium.Cartesian3[][],
  plane: Cesium.Plane,
  keepPositive: boolean,
): Cesium.Cartesian3[][] {
  const EPS = 1e-6
  const out: Cesium.Cartesian3[][] = []
  for (const tri of triangles) {
    // Signed distance, flipped so "kept" is always >= -EPS.
    const ds = tri.map(p => {
      const d = Cesium.Plane.getPointDistance(plane, p)
      return keepPositive ? d : -d
    })
    const kept = ds.filter(d => d >= -EPS).length
    if (kept === 3) {
      out.push(tri)
      continue
    }
    if (kept === 0) continue
    // Clip the triangle polygon against the plane edge by edge.
    const poly: Cesium.Cartesian3[] = []
    for (let e = 0; e < 3; e++) {
      const a = tri[e]
      const b = tri[(e + 1) % 3]
      const da = ds[e]
      const db = ds[(e + 1) % 3]
      const aIn = da >= -EPS
      const bIn = db >= -EPS
      if (aIn) poly.push(a)
      if (aIn !== bIn) {
        const t = da / (da - db)
        poly.push(Cesium.Cartesian3.lerp(a, b, t, new Cesium.Cartesian3()))
      }
    }
    // Fan-triangulate the 3- or 4-vertex clipped polygon.
    for (let k = 1; k + 1 < poly.length; k++) {
      out.push([poly[0], poly[k], poly[k + 1]])
    }
  }
  return out
}

/** A clip vertex carrying its texture coordinate (used to slice the
 * basemap lid quad along the split plane). */
export type TexVert = { p: Cesium.Cartesian3; st: [number, number] }

/**
 * Same half-space clip as {@link clipTrisToHalfSpace} but carries
 * texture coords — used to slice the basemap lid quad along the split
 * plane so the aerial is cut into the two halves like the geology (st
 * lerped by the same ``t`` as the position so the image stays
 * georeferenced).
 *
 * Parameters
 * ----------
 * triangles
 *     Triangle soup of textured vertices.
 * plane
 *     The split plane.
 * keepPositive
 *     Keep the side the plane normal points to when ``true``.
 *
 * Returns
 * -------
 * TexVert[][]
 *     The kept (and re-triangulated) textured triangle soup.
 */
export function clipTexTrisToHalfSpace(
  triangles: TexVert[][],
  plane: Cesium.Plane,
  keepPositive: boolean,
): TexVert[][] {
  const EPS = 1e-6
  const out: TexVert[][] = []
  for (const tri of triangles) {
    const ds = tri.map(v => {
      const d = Cesium.Plane.getPointDistance(plane, v.p)
      return keepPositive ? d : -d
    })
    const kept = ds.filter(d => d >= -EPS).length
    if (kept === 3) {
      out.push(tri)
      continue
    }
    if (kept === 0) continue
    const poly: TexVert[] = []
    for (let e = 0; e < 3; e++) {
      const a = tri[e]
      const b = tri[(e + 1) % 3]
      const da = ds[e]
      const db = ds[(e + 1) % 3]
      const aIn = da >= -EPS
      const bIn = db >= -EPS
      if (aIn) poly.push(a)
      if (aIn !== bIn) {
        const t = da / (da - db)
        poly.push({
          p: Cesium.Cartesian3.lerp(a.p, b.p, t, new Cesium.Cartesian3()),
          st: [
            a.st[0] + (b.st[0] - a.st[0]) * t,
            a.st[1] + (b.st[1] - a.st[1]) * t,
          ],
        })
      }
    }
    for (let k = 1; k + 1 < poly.length; k++) {
      out.push([poly[0], poly[k], poly[k + 1]])
    }
  }
  return out
}
