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

import { triangulatePolygon2D } from '../../../utils/polygonTriangulate'

import type { FormationSurfaceResponse } from '../../../api/client'
import { projectedToWgs84 } from '../../../hooks/useWgs84'

/**
 * Expand triangle index triples into wireframe LINE-edge index pairs.
 *
 * For each triangle ``(i0, i1, i2)`` the three boundary edges are emitted
 * as the index pairs ``i0,i1``, ``i1,i2``, ``i2,i0`` — six indices total,
 * which an index buffer feeds to ``Cesium.PrimitiveType.LINES``.  The
 * positions/vertices are left untouched; only the index buffer differs
 * between the filled (TRIANGLES) and wireframe (LINES) render of the same
 * solid.  Pure (``number[]`` in, ``number[]`` out) so it is unit-testable
 * without Cesium.
 *
 * Parameters
 * ----------
 * triangles
 *     Vertex-index triples (the same buffer used for the TRIANGLES draw).
 *
 * Returns
 * -------
 * ``number[]``
 *     Flat array of edge index pairs, length ``triangles.length * 6``.
 *     Triangle ``(0, 1, 2)`` yields ``[0, 1, 1, 2, 2, 0]``.
 */
export function trianglesToWireframeEdgeIndices(
  triangles: readonly (readonly [number, number, number])[],
): number[] {
  const edges: number[] = []
  for (const [i0, i1, i2] of triangles) {
    edges.push(i0, i1, i1, i2, i2, i0)
  }
  return edges
}

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
 * lidElevation
 *     Where to place the lid, when the caller knows the ground at the
 *     investigations (``lidElevationAtInvestigations``). ``null`` keeps the
 *     old rule: the highest vertex of any surface.
 *
 * Returns
 * -------
 * BasemapBounds | null
 */
export function computeBasemapBounds(
  surfaces: { vertices: readonly (readonly [number, number, number])[] }[],
  projectEpsg: number,
  lidElevation: number | null = null,
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
    elevation: lidElevation ?? maxZ + 0.5,
    url,
  }
}

/** The minimum a TIN has to be for the sampler: projected vertices plus
 * triangle indices. Widened from `FormationSurfaceResponse` so the DEM
 * ground surface (`GroundSurfaceBuildResponse`) can be sampled by the same
 * code — the two carry different metadata but identical geometry. */
export interface TinLike {
  vertices: [number, number, number][]
  triangles: [number, number, number][]
}

/**
 * Sample a TIN's elevation at a projected (x, y) point by locating the
 * containing triangle (projected XY) and barycentric-interpolating z.
 * Returns ``null`` when the point is outside the surface (pinch-out /
 * absent).
 *
 * Parameters
 * ----------
 * surface
 *     Any TIN (projected vertices + triangle indices) — a formation
 *     surface or the DEM ground surface.
 * px, py
 *     Query point in the project's horizontal CRS.
 *
 * Returns
 * -------
 * number | null
 *     Interpolated z, or ``null`` if (px, py) is outside every triangle.
 */
/**
 * Where the basemap lid belongs: just above the ground AT THE INVESTIGATIONS.
 *
 * Owner 2026-09-13 (project fhdh): "how come the basemap is so high above the
 * mTAW surface?" The lid used to sit at the single highest vertex of any
 * surface, and one DEM hull-edge point at +30.8 m lifted it 14 m above collars
 * at +14.7 to +17.1 m. The geological block's top is where the data starts, so
 * the lid reads the ground TIN under each investigation and sits ``aboveM``
 * over the highest of them; DEM spikes away from the data no longer count.
 *
 * Parameters
 * ----------
 * ground
 *     The ground-surface TIN (projected x, y, z + triangles), or nothing yet.
 * investigationXY
 *     Projected ``[x, y]`` of every investigation the model reads.
 * aboveM
 *     Clearance (m) between the highest sampled ground and the lid.
 *
 * Returns
 * -------
 * number | null
 *     The lid elevation, or ``null`` when no investigation lands on the TIN
 *     (the caller then keeps the highest-vertex rule).
 */
export function lidElevationAtInvestigations(
  ground: TinLike | null | undefined,
  investigationXY: readonly (readonly [number, number])[],
  aboveM: number,
): number | null {
  if (!ground || investigationXY.length === 0) return null
  let highest = -Infinity
  for (const [x, y] of investigationXY) {
    const z = sampleTinZ(ground, x, y)
    if (z !== null && z > highest) highest = z
  }
  return Number.isFinite(highest) ? highest + aboveM : null
}

export function sampleTinZ(surface: TinLike, px: number, py: number): number | null {
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

/** One present formation at one cut-face station: its (z-offset-applied)
 * surface elevation and the formation id. */
export interface StationFormationZ {
  z: number
  fid: string
}

/** Visible thickness (m) given to the deepest-present formation's band at
 * a station — it has no formation beneath to bound it. A small UNIFORM
 * sliver that hugs that formation's own (flat) top, NOT a ramp to a
 * global floor: the latter was the cut-face "droop" bug — a band whose
 * bottom plunged to ``minZ - 2`` wherever a deeper formation pinched out
 * between stations, while the formation TINs themselves were flat. */
export const CUT_FACE_BASE_SLIVER_M = 2.0

/**
 * Build the cut-face band triangles, per formation id, robust to
 * formations pinching out between stations.
 *
 * The previous in-line implementation walked ``columnA[i]`` vs
 * ``columnB[i]`` — index-aligned across two INDEPENDENTLY z-sorted,
 * VARIABLE-LENGTH per-station columns. When a deeper formation was
 * absent at one station (different concave-hull extents) the indices
 * referred to different formations and the band bottom fell back to a
 * global ``zBase``, producing a steep ramp on the cut face even though
 * every formation TIN was flat ("only the split surface is droopy").
 *
 * Here each band's bottom is the next-deeper PRESENT formation's top at
 * its OWN station (so every edge follows a real, flat TIN sample); the
 * deepest-present formation gets ``baseSliverM`` of uniform thickness;
 * a formation present at only one of two adjacent stations wedges to a
 * point (an honest pinch-out) instead of dragging a neighbour to the
 * floor. No global ``zBase`` exists any more.
 *
 * Parameters
 * ----------
 * profiles
 *     Per station, the present formations TOP-FIRST (z descending) —
 *     exactly what the caller already builds via {@link sampleTinZ}.
 * stationXY
 *     Per station, its projected ``[x, y]``.
 * baseSliverM
 *     Thickness for the deepest-present band (default
 *     {@link CUT_FACE_BASE_SLIVER_M}).
 *
 * Returns
 * -------
 * Map<string, number[]>
 *     fid → flat projected triangle soup ``[x,y,z, x,y,z, ...]`` (3
 *     vertices per triangle), in the same layout the caller turns into
 *     Cesium primitives.
 */
export function buildCutFaceBands(
  profiles: readonly (readonly StationFormationZ[])[],
  stationXY: readonly (readonly [number, number])[],
  baseSliverM: number = CUT_FACE_BASE_SLIVER_M,
): Map<string, number[]> {
  // Per-station band [top, bot] keyed by fid, computed from THAT
  // station's own ordering: bot = next-present-below top, or a uniform
  // sliver when this is the deepest present here.
  const bandsByStation: Map<string, { top: number; bot: number }>[] =
    profiles.map(col => {
      const m = new Map<string, { top: number; bot: number }>()
      for (let j = 0; j < col.length; j++) {
        const top = col[j].z
        const bot = j + 1 < col.length ? col[j + 1].z : top - baseSliverM
        m.set(col[j].fid, { top, bot })
      }
      return m
    })

  const out = new Map<string, number[]>()
  const push = (fid: string, verts: number[]) => {
    let arr = out.get(fid)
    if (!arr) {
      arr = []
      out.set(fid, arr)
    }
    for (const v of verts) arr.push(v)
  }

  for (let k = 0; k + 1 < bandsByStation.length; k++) {
    const A = bandsByStation[k]
    const B = bandsByStation[k + 1]
    const [ax, ay] = stationXY[k]
    const [bx, by] = stationXY[k + 1]
    const fids = new Set<string>([...A.keys(), ...B.keys()])
    for (const fid of fids) {
      const a = A.get(fid)
      const b = B.get(fid)
      if (a && b) {
        // Full band → two triangles of the quad
        // (a.top)(b.top)(b.bot) + (a.top)(b.bot)(a.bot).
        push(fid, [
          ax, ay, a.top, bx, by, b.top, bx, by, b.bot,
          ax, ay, a.top, bx, by, b.bot, ax, ay, a.bot,
        ])
      } else if (a && !b) {
        // Pinches out toward station k+1 → wedge to a point.
        push(fid, [
          ax, ay, a.top,
          ax, ay, a.bot,
          bx, by, (a.top + a.bot) / 2,
        ])
      } else if (!a && b) {
        // Pinches in from station k → wedge from a point.
        push(fid, [
          ax, ay, (b.top + b.bot) / 2,
          bx, by, b.top,
          bx, by, b.bot,
        ])
      }
    }
  }
  return out
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

// ---------------------------------------------------------------------------
// computeSolidCapTriangles — plane∩mesh cut-face cap geometry
// ---------------------------------------------------------------------------

/**
 * A plane in the form ``normal·X + constant = 0``.
 *
 * Matches Cesium's ``Cesium.Plane(normal, distance)`` semantics:
 * ``Cesium.Plane.getPointDistance(plane, p) == normal·p + distance``.
 * Use ``constant = plane.distance`` when converting from a Cesium plane.
 *
 * The normal does NOT need to be unit-length — the signed-distance computation
 * is normalised internally so the epsilon comparisons are in metres.
 */
export interface CapPlane {
  /** Plane normal (does not need to be unit-length). */
  normal: [number, number, number]
  /** Plane constant (= Cesium.Plane.distance). */
  constant: number
}

/**
 * Result of {@link computeSolidCapTriangles}: flat projected triangle soup,
 * with positions deduplicated into a vertex array + an index array.
 */
export interface CapTriangles {
  /**
   * Flat ``[x0, y0, z0, x1, y1, z1, ...]`` projected position array.
   * All positions lie on the cap plane (signed-distance ≈ 0).
   */
  positions: number[]
  /**
   * Triangle indices into ``positions / 3``. Three consecutive entries form
   * one triangle: ``(indices[i], indices[i+1], indices[i+2])``.
   */
  indices: number[]
}

/**
 * Compute the cap triangles produced by intersecting a plane with a closed
 * watertight triangle mesh.
 *
 * Algorithm
 * ---------
 * 1. For each triangle, compute the signed plane distance for all three
 *    vertices.  Triangles fully on one side contribute nothing.  Triangles
 *    that cross the plane contribute exactly one edge segment (the two
 *    edge–plane intersection points).  A vertex exactly on the plane
 *    (|dist| < EPS) is treated as in-plane to avoid duplicate/dropped points.
 * 2. Collect all crossing segments.  For a closed watertight mesh they form
 *    one or more closed loops (the cross-section boundary polygon).  Segments
 *    are stitched into loops by matching endpoints within EPS_STITCH.
 * 3. Each loop is projected into the plane's local 2D basis (two orthonormal
 *    vectors spanning the plane).  ``triangulatePolygon2D`` (concave-safe
 *    ear-clip, already in the codebase) triangulates each loop independently.
 * 4. The resulting 2D triangles are lifted back to 3D positions on the plane
 *    and returned as a flat position array + index array.
 *
 * Multi-loop support
 * ------------------
 * Each loop is triangulated independently — a U-shaped or annular cross-section
 * produces multiple loops; all are included in the output.  The triangulation
 * of a loop does not handle holes (i.e., a loop inside another loop is treated
 * as a separate region, not subtracted).  For typical geological solids
 * (convex or simply-connected non-convex cross-sections) this is correct; for
 * a torus-shaped body it would over-fill.  Real subsurface bodies are always
 * simply-connected, so this limitation is not a practical constraint.
 *
 * Parameters
 * ----------
 * vertices
 *     ``[x, y, z]`` triples in the project's projected CRS (same units as the
 *     plane's constant).
 * triangles
 *     Vertex-index triples (any winding — the solid is assumed closed).
 * plane
 *     The cut plane.  The normal does not need to be unit-length.
 *
 * Returns
 * -------
 * CapTriangles
 *     Flat position array (``positions``) and index array (``indices``).
 *     Empty when the plane misses the mesh entirely.
 */
export function computeSolidCapTriangles(
  vertices: readonly (readonly [number, number, number])[],
  triangles: readonly (readonly [number, number, number])[],
  plane: CapPlane,
): CapTriangles {
  // Normalise the plane normal so signed-distance comparisons are in metres.
  const [nx, ny, nz] = plane.normal
  const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz)
  if (nLen < 1e-12) return { positions: [], indices: [] }
  const inx = nx / nLen
  const iny = ny / nLen
  const inz = nz / nLen
  const ic = plane.constant / nLen

  /** Signed distance of a vertex to the normalised plane. */
  const dist = (i: number): number =>
    inx * vertices[i][0] + iny * vertices[i][1] + inz * vertices[i][2] + ic

  // Epsilon for "on the plane" — 1e-6 m (sub-mm, well below measurement noise).
  const EPS = 1e-6

  // --- Step 1 & 2: collect crossing segments ----------------------------
  // Each element is [Ax,Ay,Az, Bx,By,Bz] — the two endpoints of one segment.
  const segments: [number, number, number, number, number, number][] = []

  for (const [i0, i1, i2] of triangles) {
    const d0 = dist(i0)
    const d1 = dist(i1)
    const d2 = dist(i2)

    // Map each vertex to -1 (below), 0 (on plane), +1 (above).
    const s0 = d0 < -EPS ? -1 : d0 > EPS ? 1 : 0
    const s1 = d1 < -EPS ? -1 : d1 > EPS ? 1 : 0
    const s2 = d2 < -EPS ? -1 : d2 > EPS ? 1 : 0

    // Determine whether the triangle can contribute a segment:
    // - Triangles with all three vertices strictly on one side contribute nothing.
    // - Triangles with all three vertices coplanar (s===0) are face-coplanar
    //   and their edges would duplicate every segment; skip them (the adjacent
    //   non-coplanar triangles contribute the boundary segments already).
    // - The remaining cases all cross the plane: at least one vertex is strictly
    //   positive and at least one is strictly negative, OR exactly two vertices
    //   are on-plane with the third strictly off — both produce one segment.
    const minS = Math.min(s0, s1, s2)
    const maxS = Math.max(s0, s1, s2)
    if (minS === maxS) continue // all same sign (or all zero)
    if (minS === 0 && maxS === 0) continue // all coplanar (unreachable after above but explicit)
    // Triangles with minS >= 0 (no strictly-below vertex) OR maxS <= 0
    // (no strictly-above vertex) have no genuine crossing unless one side is 0.
    // The only edge case: two vertices on-plane + one strictly above/below → one
    // segment (the edge between the two on-plane vertices). The "genuine crossing"
    // check handles this correctly via edgeIntersect returning the vertex for s===0.
    // We only need to skip the fully-same-side case handled above.

    // Collect up to 2 crossing points from the three edges.
    const crossPts: [number, number, number][] = []

    const edgeIntersect = (
      ia: number,
      ib: number,
      sa: number,
      sb: number,
      da: number,
      db: number,
    ): [number, number, number] | null => {
      // Both on-plane: the edge lies in the plane. Skip — it will be emitted by
      // the triangle on the other side of this edge (if that triangle is also on
      // the plane, it's a coplanar face and is filtered above). Emitting it here
      // would double-count and break loop stitching.
      if (sa === 0 && sb === 0) return null
      if (sa === 0) {
        // Vertex ia is exactly on the plane.
        return [vertices[ia][0], vertices[ia][1], vertices[ia][2]]
      }
      if (sb === 0) {
        // Vertex ib is exactly on the plane.
        return [vertices[ib][0], vertices[ib][1], vertices[ib][2]]
      }
      if (sa === sb) {
        // Same side — no crossing on this edge.
        return null
      }
      // Different signs — genuine crossing.
      const t = da / (da - db)
      return [
        vertices[ia][0] + t * (vertices[ib][0] - vertices[ia][0]),
        vertices[ia][1] + t * (vertices[ib][1] - vertices[ia][1]),
        vertices[ia][2] + t * (vertices[ib][2] - vertices[ia][2]),
      ]
    }

    const p01 = edgeIntersect(i0, i1, s0, s1, d0, d1)
    const p12 = edgeIntersect(i1, i2, s1, s2, d1, d2)
    const p20 = edgeIntersect(i2, i0, s2, s0, d2, d0)

    if (p01) crossPts.push(p01)
    if (p12) crossPts.push(p12)
    if (p20) crossPts.push(p20)

    // Deduplicate coincident points (two edges sharing an on-plane vertex
    // each produce the same point).
    const unique: [number, number, number][] = []
    for (const p of crossPts) {
      const dup = unique.some(
        q =>
          Math.abs(p[0] - q[0]) < EPS &&
          Math.abs(p[1] - q[1]) < EPS &&
          Math.abs(p[2] - q[2]) < EPS,
      )
      if (!dup) unique.push(p)
    }

    if (unique.length === 2) {
      segments.push([
        unique[0][0], unique[0][1], unique[0][2],
        unique[1][0], unique[1][1], unique[1][2],
      ])
    }
    // unique.length < 2 means the triangle only grazed the plane at a single
    // point (a vertex touching the plane) — no area, skip.
  }

  if (segments.length === 0) return { positions: [], indices: [] }

  // --- Step 3: stitch segments into closed loops -------------------------
  // Use a small stitching epsilon (1e-4 m) to handle floating-point drift
  // in the edge-intersection arithmetic.
  const EPS_STITCH = 1e-4

  /** Stitch all segments into ordered closed polylines. */
  function stitchLoops(
    segs: [number, number, number, number, number, number][],
  ): [number, number, number][][] {
    // Work on a mutable copy — segments are consumed as they're stitched.
    const remaining = segs.slice()
    const loops: [number, number, number][][] = []

    while (remaining.length > 0) {
      const loop: [number, number, number][] = []
      // Seed the loop with the first remaining segment.
      const seed = remaining.splice(0, 1)[0]
      loop.push([seed[0], seed[1], seed[2]])
      loop.push([seed[3], seed[4], seed[5]])

      let extended = true
      while (extended) {
        extended = false
        const tail = loop[loop.length - 1]
        for (let i = 0; i < remaining.length; i += 1) {
          const seg = remaining[i]
          const matchA =
            Math.abs(seg[0] - tail[0]) < EPS_STITCH &&
            Math.abs(seg[1] - tail[1]) < EPS_STITCH &&
            Math.abs(seg[2] - tail[2]) < EPS_STITCH
          const matchB =
            Math.abs(seg[3] - tail[0]) < EPS_STITCH &&
            Math.abs(seg[4] - tail[1]) < EPS_STITCH &&
            Math.abs(seg[5] - tail[2]) < EPS_STITCH
          if (matchA) {
            loop.push([seg[3], seg[4], seg[5]])
            remaining.splice(i, 1)
            extended = true
            break
          } else if (matchB) {
            loop.push([seg[0], seg[1], seg[2]])
            remaining.splice(i, 1)
            extended = true
            break
          }
        }
      }

      // A closed loop has its last point ≈ its first point; drop the
      // duplicate closing point so triangulation gets an open ring.
      if (loop.length > 1) {
        const head = loop[0]
        const tail2 = loop[loop.length - 1]
        if (
          Math.abs(head[0] - tail2[0]) < EPS_STITCH &&
          Math.abs(head[1] - tail2[1]) < EPS_STITCH &&
          Math.abs(head[2] - tail2[2]) < EPS_STITCH
        ) {
          loop.pop()
        }
      }

      if (loop.length >= 3) loops.push(loop)
    }
    return loops
  }

  const loops = stitchLoops(segments)
  if (loops.length === 0) return { positions: [], indices: [] }

  // --- Step 4: build a 2D orthonormal basis for the plane ---------------
  // u = first tangent vector (arbitrary, perpendicular to the normal).
  // v = second tangent vector (perpendicular to both normal and u).
  let ux: number
  let uy: number
  let uz: number
  if (Math.abs(inx) <= Math.abs(iny) && Math.abs(inx) <= Math.abs(inz)) {
    // Normal is least aligned with X — use X as the reference.
    ux = 0; uy = -inz; uz = iny
  } else if (Math.abs(iny) <= Math.abs(inz)) {
    // Least aligned with Y — use Y as the reference.
    ux = inz; uy = 0; uz = -inx
  } else {
    // Least aligned with Z — use Z as the reference.
    ux = -iny; uy = inx; uz = 0
  }
  const uLen = Math.sqrt(ux * ux + uy * uy + uz * uz)
  ux /= uLen; uy /= uLen; uz /= uLen
  // v = normal × u (right-hand rule).
  const vx = iny * uz - inz * uy
  const vy = inz * ux - inx * uz
  const vz = inx * uy - iny * ux

  /** Project a 3D point on the plane to its 2D (u, v) coordinates. */
  const to2D = (p: [number, number, number]): { x: number; y: number } => ({
    x: p[0] * ux + p[1] * uy + p[2] * uz,
    y: p[0] * vx + p[1] * vy + p[2] * vz,
  })

  /** Lift a 2D (u, v) coordinate back to 3D by projecting onto the plane. */
  const to3D = (u2: number, v2: number): [number, number, number] => {
    // The 3D point that lies on the plane at (u, v):
    //   P = u * uAxis + v * vAxis + origin_on_plane
    // The origin on the plane closest to world origin is: -ic * (inx, iny, inz).
    const ox = -ic * inx
    const oy = -ic * iny
    const oz = -ic * inz
    return [
      ox + u2 * ux + v2 * vx,
      oy + u2 * uy + v2 * vy,
      oz + u2 * uz + v2 * vz,
    ]
  }

  // --- Step 5: triangulate each loop + accumulate output ----------------
  const outPositions: number[] = []
  const outIndices: number[] = []

  for (const loop of loops) {
    const ring2D = loop.map(to2D)
    const tris2D = triangulatePolygon2D(ring2D)
    if (tris2D.length === 0) continue

    // Collect the unique 2D vertices referenced by this loop's triangles
    // so we emit each 3D position only once.
    const baseIndex = outPositions.length / 3

    for (const pt2D of ring2D) {
      const p3 = to3D(pt2D.x, pt2D.y)
      outPositions.push(p3[0], p3[1], p3[2])
    }

    for (const [ia, ib, ic2] of tris2D) {
      outIndices.push(baseIndex + ia, baseIndex + ib, baseIndex + ic2)
    }
  }

  return { positions: outPositions, indices: outIndices }
}
