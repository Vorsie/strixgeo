// Geology 3D viewer — Cesium-based single-viewport and split-viewport viewer
// for TIN formation surfaces.
//
// Build integration notes (completed G5 probe 2026-05-16):
//
//   - Cesium is bundled via Vite ESM import from ``cesium/Source/Cesium.js``.
//     vite-plugin-cesium is NOT used (Windows path.join bug + absolute URL
//     incompatibility with Electron's file:// protocol).
//   - Static assets (Workers, Assets, ThirdParty, Widgets) are copied by
//     ``scripts/copy-cesium.mjs``, chained in the ``build`` npm script.
//   - CESIUM_BASE_URL is injected by the renderer Vite ``define`` +
//     rollupOptions.output.intro so Cesium's buildModuleUrl.js finds workers
//     before any module code runs.
//   - No Cesium ion token — all basemaps come from basemapSources.ts (XYZ/
//     WMTS tile providers). EllipsoidTerrainProvider gives a flat globe.
//
// Split-viewport notes (G6):
//
//   Two CesiumWidget instances are rendered side by side in split mode.
//   Each widget has its own WebGL context, scene, and ScreenSpaceCameraController
//   — camera independence is free. ClippingPlaneCollection clips each scene to
//   the appropriate half of the split plane.
//
//   The split plane is defined by a user-drawn line segment in the 3D scene
//   (two-click flow). It is session-ephemeral: NOT persisted to the .gmproj
//   bundle, NOT tied to the cross-section model, NOT a formation-contact-edit
//   surface. See docs/geology-stage-architecture.md §4.7 for the rationale.
//
// Offline mode:
//
//   Basemap tiles require live network. When offline, the tile providers return
//   404 errors and the globe background is blank (black). The formation surfaces
//   are still rendered correctly. This is documented known degradation —
//   see docs/debt.md item for 3D viewer offline basemap.

import * as Cesium from 'cesium'
import 'cesium/Build/Cesium/Widgets/widgets.css'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import type {
  GeologicalFormationResponse,
  FormationSurfaceResponse,
  GroundSurfaceBuildResponse,
} from '../../../api/client'
import type { BasemapSource, BasemapId } from '../../../utils/basemapSources'
import { BASEMAP_SOURCES, readBasemapId, writeBasemapId } from '../../../utils/basemapSources'
import { projectedToWgs84, wgs84ToProjected } from '../../../hooks/useWgs84'

// Disable Cesium ion. All basemaps and terrain come from our own providers.
Cesium.Ion.defaultAccessToken = ''

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Operational mode of the viewer. */
export type SplitMode = 'single' | 'split'

export interface Geology3DViewerProps {
  /** Single-viewport or split-viewport mode. */
  splitMode: SplitMode
  /**
   * The vertical plane that splits the scene in split mode.
   *
   * ``null`` when ``splitMode === 'single'``.  The plane is defined in
   * ECEF space: normal perpendicular to the drawn line in the horizontal
   * plane, infinite vertical extent.
   */
  splitPlane: Cesium.Plane | null
  /** All formations for the active geological model (sorted by display_order). */
  formations: GeologicalFormationResponse[]
  /** Pre-fetched surface data keyed by formation id. */
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>
  /**
   * DEM ground-surface TIN built by ``POST .../ground-surface/build``.
   *
   * When provided and non-empty, rendered as an earth-tone semi-transparent
   * mesh below the formation surfaces — the terrain base for the 3D scene.
   * ``null`` / ``undefined`` when the build has not completed yet or the
   * model has no investigations.
   */
  groundSurface?: GroundSurfaceBuildResponse | null
  /**
   * Initial basemap to display.  Optional — when omitted the viewer reads
   * the same localStorage key as ``MapView`` so the two views stay in sync
   * with the user's last explicit pick.  When provided, the viewer uses it
   * as its starting state (useful for controlled testing).
   */
  activeBasemap?: BasemapSource
  /** Project's horizontal CRS EPSG code (31370 Lambert72 or 28992 RD New). */
  projectEpsg: number
  /**
   * Called when the user completes the split-line draw interaction.
   *
   * The viewer emits the computed ``Cesium.Plane`` in ECEF space; the caller
   * stores it and passes it back via ``splitPlane``.
   */
  onSplitPlaneDrawn: (plane: Cesium.Plane, line: SplitLine) => void
  /** The drawn split line in projected CRS, echoed back so the cut-face
   * caps can sample the formations along it. */
  splitLine?: SplitLine | null
  /**
   * Ref populated by the viewer so callers (e.g. GeologyToolbar Reset verb)
   * can trigger a camera fly-to without prop drilling.
   *
   * The ref holds a ``() => void`` callback when the viewer is mounted.
   */
  resetCameraRef: React.MutableRefObject<(() => void) | null>
  /** Collapse the split back to a single viewport (the "Single view"
   * button in the viewer). Owned by GeologyCanvas. */
  onExitSplit?: () => void
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Z-offset in metres per display_order unit, to avoid z-fighting between
 * co-planar or near-co-planar formation surfaces. Small enough that it is
 * invisible at typical project extents (a few km). */
const Z_OFFSET_PER_ORDER = 0.01

/** Alpha for fresh (non-stale) surfaces. */
const ALPHA_FRESH = 0.75

/** Alpha for stale surfaces (same convention as the 2D section canvas). */
const ALPHA_STALE = 0.35

/** Minimum draw-line segment length in metres (projected) to accept as a
 * valid split plane. Prevents degenerate normals from near-zero-length lines. */
const MIN_SPLIT_LINE_M = 10

/** Alpha for the DEM ground-surface TIN mesh — semi-transparent so formation
 * surfaces render visibly above the terrain. */
const ALPHA_GROUND_SURFACE = 0.45

/** Earth-tone colour for the DEM ground-surface TIN (warm grey). */
const GROUND_SURFACE_COLOR = new Cesium.Color(0.55, 0.52, 0.48, ALPHA_GROUND_SURFACE)

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Geopunt orthophoto WMS (verified live 2026-05-16: serves EPSG:31370
// + image/png GetMap, layer "Ortho"). One GetMap for the model bbox is
// the "GIS magic" the user asked for — far more robust than draping a
// WMTS over the whole Cesium ellipsoid (the GoogleMapsVL matrixset
// never tiles right under Cesium → the 400-storm + smeared "wall").
const GEOPUNT_ORTHO_WMS = 'https://geo.api.vlaanderen.be/omwrgbmrvl/wms'

/** A single georeferenced image draped flat as a "lid" on top of the
 * model: the WGS84 rectangle to place it in, the elevation (top of the
 * model) to place it at, and the one-shot WMS GetMap image URL. */
interface BasemapLid {
  rect: Cesium.Rectangle
  elevation: number
  url: string
}

/**
 * Compute the basemap "lid" — one Geopunt orthophoto GetMap image for
 * the model footprint, placed as a flat textured rectangle at the
 * model's top elevation (a cap on the geological block, not globe
 * imagery). Only Belgian Lambert-72 projects (Geopunt's only CRS for
 * this layer); returns ``null`` otherwise or when there are no
 * vertices yet.
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
 * BasemapLid | null
 */
function buildBasemapLid(
  surfaces: { vertices: readonly (readonly [number, number, number])[] }[],
  projectEpsg: number,
): BasemapLid | null {
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
  const rect = Cesium.Rectangle.fromDegrees(
    Math.min(lngSW, lngNE),
    Math.min(latSW, latNE),
    Math.max(lngSW, lngNE),
    Math.max(latSW, latNE),
  )
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
  return { rect, elevation: maxZ + 0.5, url }
}

/**
 * Fly the Cesium camera to encompass all formation surfaces.
 *
 * Parameters
 * ----------
 * camera
 *     Cesium Camera instance.
 * surfaces
 *     Surfaces to frame.
 * projectEpsg
 *     Horizontal CRS for coordinate transform.
 */
function flyToBounds(
  camera: Cesium.Camera,
  surfaces: FormationSurfaceResponse[],
  projectEpsg: number,
): void {
  // Build a bounding sphere from every surface vertex (ECEF) and let
  // Cesium fit it to the frustum. The previous manual approach put the
  // camera straight over the midpoint at a fixed 2×span height with a
  // -45° pitch, which left the data off-centre and the distance
  // heuristic wrong ("zoom is off"). flyToBoundingSphere with an
  // explicit range scaled to the actual extent frames it correctly.
  const points: Cesium.Cartesian3[] = []
  for (const surface of surfaces) {
    for (const [x, y, z] of surface.vertices) {
      const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
      points.push(Cesium.Cartesian3.fromDegrees(lng, lat, z))
    }
  }
  if (points.length === 0) return

  const sphere = Cesium.BoundingSphere.fromPoints(points)
  // 2.2× radius (min 600 m) keeps the whole model comfortably in view
  // without the camera ending up inside thin/flat geology.
  const range = Math.max(sphere.radius * 2.2, 600)

  camera.flyToBoundingSphere(sphere, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(
      0,
      // Oblique look-down for geological context; straight down is
      // disorienting for surface inspection.
      Cesium.Math.toRadians(-45),
      range,
    ),
  })
}

/** The two endpoints of the user-drawn split line, in the project's
 * horizontal CRS (projected metres). Used to sample the cut face. */
export interface SplitLine {
  x0: number
  y0: number
  x1: number
  y1: number
}

/**
 * Frame the camera onto the cut FACE (step 3 — "turn the half
 * outward to see the inside"). Instead of the oblique top-down
 * (flyToBounds), look at the split plane head-on from the kept side
 * with a slight downward tilt so the layered cross-section reads.
 */
function flyToCutFace(
  camera: Cesium.Camera,
  surfaces: FormationSurfaceResponse[],
  projectEpsg: number,
  planeNormal: Cesium.Cartesian3,
  keepPositive: boolean,
): void {
  const EPS = 1e-6
  const points: Cesium.Cartesian3[] = []
  for (const s of surfaces) {
    for (const [x, y, z] of s.vertices) {
      const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
      points.push(Cesium.Cartesian3.fromDegrees(lng, lat, z))
    }
  }
  if (points.length === 0) return

  // Frame the KEPT half, not the whole model. The split plane bisects
  // the model; the full-model bounding sphere is centred on the cut, so
  // a sliver half ended up tiny + far while the big half filled the
  // frame — the asymmetric panes the user saw. Filter to exactly the
  // points clipTrisToHalfSpace keeps (same signed-distance test) and
  // fit the camera to that sub-sphere instead.
  const inKeptHalf = (p: Cesium.Cartesian3): boolean => {
    const d = Cesium.Plane.getPointDistance(plane, p)
    return (keepPositive ? d : -d) >= -EPS
  }
  const keptPoints = points.filter(inKeptHalf)
  // Defensive: a split line drawn off the data still gets a usable view.
  const framePoints = keptPoints.length > 0 ? keptPoints : points
  const sphere = Cesium.BoundingSphere.fromPoints(framePoints)
  const C = sphere.center
  const range = Math.max(sphere.radius * 2.0, 600)

  // "Turn the half outward to see the inside": the camera must sit on
  // the side where the OTHER half was removed and look toward the kept
  // body, so the cut face is the first thing it hits. The kept (+normal)
  // half had its -normal side removed → view along +normal from the
  // -normal side. The inverted half is the mirror. (The previous sign
  // put the camera behind the kept body, showing its outer surface and
  // occluding the cut face entirely.)
  const n = Cesium.Cartesian3.normalize(planeNormal, new Cesium.Cartesian3())
  const viewDir = Cesium.Cartesian3.multiplyByScalar(
    n,
    keepPositive ? 1 : -1,
    new Cesium.Cartesian3(),
  )
  const worldUp = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(
    C,
    new Cesium.Cartesian3(),
  )
  // Tilt ~10° down so the section face is seen slightly from above.
  Cesium.Cartesian3.subtract(
    viewDir,
    Cesium.Cartesian3.multiplyByScalar(worldUp, 0.18, new Cesium.Cartesian3()),
    viewDir,
  )
  Cesium.Cartesian3.normalize(viewDir, viewDir)

  // Orthonormal camera frame.
  const right = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.cross(viewDir, worldUp, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  )
  const up = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.cross(right, viewDir, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  )
  const destination = Cesium.Cartesian3.subtract(
    C,
    Cesium.Cartesian3.multiplyByScalar(viewDir, range, new Cesium.Cartesian3()),
    new Cesium.Cartesian3(),
  )
  camera.flyTo({
    destination,
    orientation: { direction: viewDir, up },
    duration: 1.2,
  })
}

/** Sample a formation TIN's elevation at a projected (x, y) point by
 * locating the containing triangle (projected XY) and barycentric-
 * interpolating z. Returns ``null`` when the point is outside the
 * surface (pinch-out / absent). */
function sampleTinZ(
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
 * Build the coloured cut-face "caps" (step 2). Samples every formation
 * TIN at shared stations along the split line and fills a ribbon
 * between each formation top and the next-deeper present formation
 * (deepest down to the model base), so the slice reads as a solid
 * layered cake, not a hollow shell.
 *
 * Caps are coplanar with the cut and are rendered in BOTH viewports
 * (the cut face is shared); each half's other geometry is clipped
 * away on the far side so it reads as that half's exposed face.
 */
function buildCapPrimitives(
  formations: GeologicalFormationResponse[],
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>,
  projectEpsg: number,
  line: SplitLine,
  hiddenFormationIds?: ReadonlySet<string>,
): Cesium.Primitive[] {
  // Bounding box + base elevation across all surface vertices.
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  for (const s of surfacesByFormationId.values()) {
    for (const [x, y, z] of s.vertices) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
      if (z < minZ) minZ = z
    }
  }
  if (!isFinite(minX)) return []
  const zBase = minZ - 2

  // Extend the drawn segment to a long line, then clamp its parameter
  // to the model bbox so stations span the model, not just the click.
  const dx = line.x1 - line.x0
  const dy = line.y1 - line.y0
  const len = Math.hypot(dx, dy)
  if (len < 1e-6) return []
  const ux = dx / len
  const uy = dy / len
  // Param t (metres from p0). Intersect bbox to get [tMin, tMax].
  const ts: number[] = []
  for (const [c, u, lo, hi] of [
    [line.x0, ux, minX, maxX] as const,
    [line.y0, uy, minY, maxY] as const,
  ]) {
    if (Math.abs(u) < 1e-9) continue
    ts.push((lo - c) / u, (hi - c) / u)
  }
  if (ts.length === 0) return []
  let tMin = Math.min(...ts)
  let tMax = Math.max(...ts)
  if (tMax - tMin < 1) return []
  // Clamp to the diagonal so we never sample wildly outside.
  const diag = Math.hypot(maxX - minX, maxY - minY)
  tMin = Math.max(tMin, -diag)
  tMax = Math.min(tMax, len + diag)

  const N = 160
  // Ordered oldest→youngest; we walk top→down per station.
  const ordered = [...formations]
    .filter(f => !hiddenFormationIds?.has(f.id))
    .sort((a, b) => a.display_order - b.display_order)

  // Accumulate quads per formation id.
  const quadsByFid = new Map<string, number[]>()
  const colorByFid = new Map<string, Cesium.Color>()

  const stationXY: [number, number][] = []
  for (let k = 0; k <= N; k++) {
    const t = tMin + ((tMax - tMin) * k) / N
    stationXY.push([line.x0 + ux * t, line.y0 + uy * t])
  }

  // Per-station top→down list of (z, fid).
  const profiles: { z: number; fid: string }[][] = stationXY.map(([px, py]) => {
    const col: { z: number; fid: string }[] = []
    for (const f of ordered) {
      const surf = surfacesByFormationId.get(f.id)
      if (!surf || surf.triangles.length === 0) continue
      const z = sampleTinZ(surf, px, py)
      if (z === null) continue
      col.push({ z: z + f.display_order * Z_OFFSET_PER_ORDER, fid: f.id })
    }
    col.sort((a, b) => b.z - a.z) // top first
    return col
  })

  const pushQuad = (
    fid: string,
    p1: [number, number, number],
    p2: [number, number, number],
    p3: [number, number, number],
    p4: [number, number, number],
  ) => {
    let arr = quadsByFid.get(fid)
    if (!arr) {
      arr = []
      quadsByFid.set(fid, arr)
    }
    // Two triangles (1,2,3) (1,3,4); positions stored projected,
    // converted to ECEF when the primitive is built.
    arr.push(...p1, ...p2, ...p3, ...p1, ...p3, ...p4)
  }

  for (const f of ordered) {
    if (!colorByFid.has(f.id)) {
      const hex = f.color.startsWith('#') ? f.color : `#${f.color}`
      const c = Cesium.Color.fromCssColorString(hex) ?? Cesium.Color.GRAY
      colorByFid.set(f.id, c)
    }
  }

  for (let k = 0; k < N; k++) {
    const ca = profiles[k]
    const cb = profiles[k + 1]
    const [ax, ay] = stationXY[k]
    const [bx, by] = stationXY[k + 1]
    // Walk the shallower of the two columns; band i spans z_i down to
    // the next-deeper formation top (or zBase for the deepest).
    const depth = Math.max(ca.length, cb.length)
    for (let i = 0; i < depth; i++) {
      const a = ca[i]
      const b = cb[i]
      if (!a && !b) continue
      const fid = (a ?? b)!.fid
      const aTop = a ? a.z : (b as { z: number }).z
      const bTop = b ? b.z : (a as { z: number }).z
      const aBot = ca[i + 1]?.z ?? zBase
      const bBot = cb[i + 1]?.z ?? zBase
      pushQuad(
        fid,
        [ax, ay, aTop],
        [bx, by, bTop],
        [bx, by, bBot],
        [ax, ay, aBot],
      )
    }
  }

  const prims: Cesium.Primitive[] = []
  for (const [fid, flat] of quadsByFid) {
    if (flat.length === 0) continue
    const positions = new Float64Array((flat.length / 3) * 3)
    const indices = new Uint32Array(flat.length / 3)
    let pi = 0
    let ii = 0
    for (let v = 0; v < flat.length; v += 3) {
      const [lat, lng] = projectedToWgs84(flat[v], flat[v + 1], projectEpsg)
      const ecef = Cesium.Cartesian3.fromDegrees(lng, lat, flat[v + 2])
      positions[pi++] = ecef.x
      positions[pi++] = ecef.y
      positions[pi++] = ecef.z
      indices[ii] = ii
      ii++
    }
    const color = colorByFid.get(fid) ?? Cesium.Color.GRAY
    prims.push(
      new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({
          geometry: new Cesium.Geometry({
            attributes: {
              position: new Cesium.GeometryAttribute({
                componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                componentsPerAttribute: 3,
                values: positions,
              }),
            },
            indices,
            primitiveType: Cesium.PrimitiveType.TRIANGLES,
            boundingSphere: Cesium.BoundingSphere.fromVertices(
              Array.from(positions),
            ),
          }),
          attributes: {
            color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
          },
        }),
        appearance: new Cesium.PerInstanceColorAppearance({
          flat: true,
          translucent: false,
        }),
        asynchronous: false,
      }),
    )
  }
  return prims
}

/**
 * Build a Cesium Primitive from a flat list of ``[x, y, z]`` vertices and
 * ``[i0, i1, i2]`` triangle index triples.
 *
 * Returns ``null`` when ``triangles`` is empty (degenerate or no-data TIN).
 *
 * Parameters
 * ----------
 * vertices
 *     ``[x_m, y_m, elevation_m]`` triples in the project's horizontal CRS.
 * triangles
 *     Vertex-index triples (counter-clockwise winding).
 * color
 *     Cesium.Color (including alpha) for the primitive.
 * projectEpsg
 *     Horizontal CRS EPSG code for the coordinate transform.
 *
 * Returns
 * -------
 * ``Cesium.Primitive`` or ``null``.
 */
/** Half-space clip used by the split view (G6 step 1). Given ECEF
 * triangles and a Cesium.Plane, returns the triangle soup on the kept
 * side (Sutherland–Hodgman per triangle; crossing edges produce 1–2
 * output triangles). ``keepPositive`` keeps the side the plane normal
 * points to — the secondary viewport passes ``false`` for the other
 * half. This is the actual "slice the cake" cut (Cesium has no
 * ClippingPlaneCollection for raw Primitives). */
function clipTrisToHalfSpace(
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

/** Same half-space clip as above but carries texture coords — used to
 * slice the basemap lid quad along the split plane so the aerial is
 * cut into the two halves like the geology (st lerped by the same t
 * as the position so the image stays georeferenced). */
type TexVert = { p: Cesium.Cartesian3; st: [number, number] }
function clipTexTrisToHalfSpace(
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

function buildTinPrimitive(
  vertices: [number, number, number][],
  triangles: [number, number, number][],
  color: Cesium.Color,
  projectEpsg: number,
  clip?: { plane: Cesium.Plane; keepPositive: boolean },
): Cesium.Primitive | null {
  if (triangles.length === 0) return null

  const ecef = vertices.map(([x, y, z]) => {
    const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
    return Cesium.Cartesian3.fromDegrees(lng, lat, z)
  })

  let positionValues: Float64Array
  let indices: Uint32Array

  if (!clip) {
    // No split — keep the compact indexed geometry (unchanged path).
    positionValues = new Float64Array(ecef.length * 3)
    let i = 0
    for (const v of ecef) {
      positionValues[i++] = v.x
      positionValues[i++] = v.y
      positionValues[i++] = v.z
    }
    indices = new Uint32Array(triangles.length * 3)
    let j = 0
    for (const [i0, i1, i2] of triangles) {
      indices[j++] = i0
      indices[j++] = i1
      indices[j++] = i2
    }
  } else {
    // Split active — clip to the half-space and emit a triangle soup
    // (clipped triangles don't share vertices).
    const tris: Cesium.Cartesian3[][] = triangles.map(([a, b, c]) => [
      ecef[a],
      ecef[b],
      ecef[c],
    ])
    const clipped = clipTrisToHalfSpace(tris, clip.plane, clip.keepPositive)
    if (clipped.length === 0) return null
    positionValues = new Float64Array(clipped.length * 9)
    indices = new Uint32Array(clipped.length * 3)
    let pi = 0
    let ii = 0
    for (const t of clipped) {
      for (const v of t) {
        positionValues[pi++] = v.x
        positionValues[pi++] = v.y
        positionValues[pi++] = v.z
        indices[ii] = ii
        ii++
      }
    }
  }

  const geometry = new Cesium.Geometry({
    attributes: {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positionValues,
      }),
    },
    indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionValues)),
  })

  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
      },
    }),
    // flat: true — geological/terrain bands are translucent fills; per-vertex
    // lighting normals are neither wanted nor meaningful for subsurface surfaces.
    // flat: false requires a normal attribute (and Cesium's compressVertices path
    // then demands compressedAttributes that were never computed), which causes
    // the "Appearance/Geometry mismatch … 'compressedAttributes'" crash for every
    // TIN primitive. flat: true uses FLAT_VERTEX_FORMAT (position-only), which
    // matches the geometry we supply.
    appearance: new Cesium.PerInstanceColorAppearance({
      translucent: true,
      flat: true,
    }),
    asynchronous: false,
  })
}

/**
 * Add TIN surface primitives to a Cesium scene for the ground surface and all
 * formations.
 *
 * Existing primitives in the scene are cleared before adding new ones so
 * the caller can call this function on every dependency change without
 * accumulating duplicates.
 *
 * The ground-surface TIN (when present) is added first so it renders below
 * formation surfaces — Cesium's painter's algorithm renders primitives in
 * insertion order.
 *
 * Parameters
 * ----------
 * scene
 *     Target Cesium scene.
 * formations
 *     All geological formations (sorted ascending by display_order).
 * surfacesByFormationId
 *     Pre-fetched surface data keyed by formation id.
 * projectEpsg
 *     Horizontal CRS EPSG code.
 * groundSurface
 *     Optional DEM ground-surface TIN.  When provided and non-empty, rendered
 *     as an earth-tone semi-transparent mesh below the formation surfaces.
 */
function rebuildSurfacePrimitives(
  scene: Cesium.Scene,
  formations: GeologicalFormationResponse[],
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>,
  projectEpsg: number,
  groundSurface?: GroundSurfaceBuildResponse | null,
  hiddenFormationIds?: ReadonlySet<string>,
  lid?: BasemapLid | null,
  clippingPlane?: Cesium.Plane | null,
  invertClip?: boolean,
  splitLine?: SplitLine | null,
): void {
  scene.primitives.removeAll()

  // Split view: clip every TIN to one half-space. Primary viewport
  // keeps the normal side, secondary (invertClip) keeps the other —
  // so the two panes are genuinely the two halves of the cake.
  const clip = clippingPlane
    ? { plane: clippingPlane, keepPositive: !invertClip }
    : undefined

  // Step 2 — coloured cut-face caps. Shared geometry rendered in both
  // halves (each half's far side is clipped away, so it reads as that
  // half's exposed cross-section).
  if (clip && splitLine) {
    for (const cap of buildCapPrimitives(
      formations,
      surfacesByFormationId,
      projectEpsg,
      splitLine,
      hiddenFormationIds,
    )) {
      scene.primitives.add(cap)
    }
  }

  // Basemap "lid" — the georeferenced orthophoto draped flat at the
  // model top, built as a textured quad so it can be HALF-SPACE
  // CLIPPED like the geology (so the aerial is sliced into the two
  // halves, not a full rectangle over both). Slightly translucent
  // (alpha 0.65) so the cut/geology reads through it.
  if (lid) {
    const r = lid.rect
    const corner = (lng: number, lat: number): Cesium.Cartesian3 =>
      Cesium.Cartesian3.fromRadians(lng, lat, lid.elevation)
    // st matches RectangleGeometry's convention: s = west→east,
    // t = south→north (so the GetMap image stays upright + aligned).
    let tris: TexVert[][] = [
      [
        { p: corner(r.west, r.south), st: [0, 0] },
        { p: corner(r.east, r.south), st: [1, 0] },
        { p: corner(r.east, r.north), st: [1, 1] },
      ],
      [
        { p: corner(r.west, r.south), st: [0, 0] },
        { p: corner(r.east, r.north), st: [1, 1] },
        { p: corner(r.west, r.north), st: [0, 1] },
      ],
    ]
    if (clip) {
      tris = clipTexTrisToHalfSpace(tris, clip.plane, clip.keepPositive)
    }
    if (tris.length > 0) {
      const positions = new Float64Array(tris.length * 9)
      const sts = new Float32Array(tris.length * 6)
      const indices = new Uint32Array(tris.length * 3)
      let pi = 0
      let si = 0
      let ii = 0
      for (const t of tris) {
        for (const v of t) {
          positions[pi++] = v.p.x
          positions[pi++] = v.p.y
          positions[pi++] = v.p.z
          sts[si++] = v.st[0]
          sts[si++] = v.st[1]
          indices[ii] = ii
          ii++
        }
      }
      scene.primitives.add(
        new Cesium.Primitive({
          geometryInstances: new Cesium.GeometryInstance({
            geometry: new Cesium.Geometry({
              attributes: {
                position: new Cesium.GeometryAttribute({
                  componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                  componentsPerAttribute: 3,
                  values: positions,
                }),
                st: new Cesium.GeometryAttribute({
                  componentDatatype: Cesium.ComponentDatatype.FLOAT,
                  componentsPerAttribute: 2,
                  values: sts,
                }),
              },
              indices,
              primitiveType: Cesium.PrimitiveType.TRIANGLES,
              boundingSphere: Cesium.BoundingSphere.fromVertices(
                Array.from(positions),
              ),
            }),
          }),
          appearance: new Cesium.EllipsoidSurfaceAppearance({
            aboveGround: true,
            translucent: true,
            material: Cesium.Material.fromType('Image', {
              image: lid.url,
              // alpha < 1 → see-through aerial (requested).
              color: new Cesium.Color(1, 1, 1, 0.65),
            }),
          }),
          asynchronous: false,
        }),
      )
    }
  }

  // Ground-surface TIN — rendered first (painter's algorithm: drawn below
  // formation surfaces). Uses a warm-grey earth tone at 45 % alpha so
  // formation bands remain legible above it.
  if (groundSurface && groundSurface.triangles.length > 0) {
    const terrainPrimitive = buildTinPrimitive(
      groundSurface.vertices,
      groundSurface.triangles,
      GROUND_SURFACE_COLOR,
      projectEpsg,
      clip,
    )
    if (terrainPrimitive) {
      scene.primitives.add(terrainPrimitive)
    }
  }

  for (const formation of formations) {
    // Per-formation visibility toggle (the 3D legend). A hidden
    // formation's TIN is simply not added, so the next-deeper
    // formation shows through where it would have been.
    if (hiddenFormationIds?.has(formation.id)) continue
    const surface = surfacesByFormationId.get(formation.id)
    if (!surface || surface.triangles.length === 0) continue

    const isStale = surface.is_stale === true
    const alpha = isStale ? ALPHA_STALE : ALPHA_FRESH
    const zOffset = formation.display_order * Z_OFFSET_PER_ORDER

    // Parse the formation's hex colour. Fall back to grey when malformed.
    const hexColor = formation.color.startsWith('#')
      ? formation.color
      : `#${formation.color}`
    const csColor = Cesium.Color.fromCssColorString(hexColor) ?? Cesium.Color.GRAY
    csColor.alpha = alpha

    // Apply the per-formation z-offset to vertex elevations before building
    // the primitive so co-planar surfaces don't z-fight.
    const offsetVertices: [number, number, number][] = surface.vertices.map(
      ([x, y, z]) => [x, y, z + zOffset],
    )

    const primitive = buildTinPrimitive(
      offsetVertices,
      surface.triangles,
      csColor,
      projectEpsg,
      clip,
    )
    if (primitive) {
      scene.primitives.add(primitive)
    }
  }
}

// ---------------------------------------------------------------------------
// Basemap picker panel
// ---------------------------------------------------------------------------

interface BasemapPanelProps {
  activeBasemapId: BasemapId
  onSelect: (id: BasemapId) => void
}

/**
 * Small basemap picker overlay rendered in the top-right corner of a
 * Cesium widget container.
 *
 * Mirrors the visual style of MapView's basemap selector so switching
 * between the 2D and 3D views does not change the UI chrome.
 *
 * Parameters
 * ----------
 * activeBasemapId
 *     Currently active basemap id.
 * onSelect
 *     Called when the user picks a different basemap.
 *
 * Returns
 * -------
 * JSX.Element
 *     The basemap picker panel.
 */
function BasemapPanel({ activeBasemapId, onSelect }: BasemapPanelProps): JSX.Element {
  const [open, setOpen] = useState(false)

  return (
    <div className="absolute top-2 right-2 z-10">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={[
          'flex items-center gap-1 px-2 py-1 rounded text-xs font-medium',
          'bg-white/80 backdrop-blur-sm text-gray-700 shadow-sm',
          'hover:bg-white transition-colors',
        ].join(' ')}
        title="Switch basemap"
      >
        {BASEMAP_SOURCES.find(b => b.id === activeBasemapId)?.label ?? 'Basemap'}
      </button>
      {open && (
        <div className="absolute top-full right-0 mt-1 bg-white rounded shadow-lg min-w-40 py-1 z-20">
          {BASEMAP_SOURCES.map(b => (
            <button
              key={b.id}
              type="button"
              onClick={() => {
                onSelect(b.id)
                setOpen(false)
              }}
              className={[
                'w-full text-left px-3 py-1.5 text-xs',
                b.id === activeBasemapId
                  ? 'font-semibold text-blue-600 bg-blue-50'
                  : 'text-gray-700 hover:bg-gray-50',
              ].join(' ')}
            >
              {b.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Single-viewport Cesium widget
// ---------------------------------------------------------------------------

interface CesiumViewportProps {
  /** Unique key — React uses this to remount the DOM div on key change. */
  viewportKey: string
  formations: GeologicalFormationResponse[]
  surfacesByFormationId: ReadonlyMap<string, FormationSurfaceResponse>
  activeBasemap: BasemapSource
  projectEpsg: number
  /** When provided, a ClippingPlaneCollection is applied to clip this viewport. */
  clippingPlane?: Cesium.Plane | null
  /** Invert the clipping half (right viewport clips the left half). */
  invertClip?: boolean
  /** Projected split line (for the cut-face caps). */
  splitLine?: SplitLine | null
  /** Ref populated with a fly-to-bounds callback. */
  cameraResetRef?: React.MutableRefObject<(() => void) | null>
  /**
   * Optional callback for recording click positions during the split-line
   * draw interaction.  Called with the projected [x, y] position of the click
   * in the Cesium scene.
   */
  onSceneClick?: (cartesian: Cesium.Cartesian3) => void
  /** DEM ground-surface TIN — rendered below formation surfaces as terrain base. */
  groundSurface?: GroundSurfaceBuildResponse | null
  /** Formation ids toggled off in the 3D legend — their TIN is not drawn. */
  hiddenFormationIds?: ReadonlySet<string>
  /** When false, no basemap imagery is added (the 3D "Basemap" toggle). */
  basemapEnabled?: boolean
}

/**
 * One Cesium WebGL viewport mounting and managing a single ``CesiumWidget``
 * instance.
 *
 * Lifecycle rules:
 *
 * - The widget is created once on mount (the container div ref becomes
 *   non-null) and destroyed on unmount via ``widget.destroy()``.
 * - Surface primitives are rebuilt whenever ``formations``,
 *   ``surfacesByFormationId``, or ``projectEpsg`` change.
 * - The basemap imagery layer is replaced whenever ``activeBasemap`` changes.
 *
 * Parameters
 * ----------
 * viewportKey
 *     Stable string identifier — not a React key. Used for the DOM element
 *     id so multiple viewports coexist without collision.
 * formations
 *     Formations for the active geological model.
 * surfacesByFormationId
 *     Surface data keyed by formation id.
 * activeBasemap
 *     Currently selected basemap source.
 * projectEpsg
 *     Horizontal CRS EPSG code.
 * clippingPlane
 *     Optional plane for split-viewport clipping.
 * invertClip
 *     When true, clips the opposite half of ``clippingPlane``.
 * cameraResetRef
 *     Ref populated with the fly-to callback.
 * onSceneClick
 *     Click handler used during the split-line draw interaction.
 *
 * Returns
 * -------
 * JSX.Element
 *     The Cesium viewport container.
 */
function CesiumViewport({
  viewportKey,
  formations,
  surfacesByFormationId,
  projectEpsg,
  clippingPlane = null,
  invertClip = false,
  splitLine = null,
  cameraResetRef,
  onSceneClick,
  groundSurface,
  hiddenFormationIds,
  basemapEnabled = true,
}: CesiumViewportProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const widgetRef = useRef<Cesium.CesiumWidget | null>(null)
  // Track the active click handler so we can remove it on cleanup.
  const clickHandlerRef = useRef<Cesium.ScreenSpaceEventHandler | null>(null)
  // Last surface-set signature the camera was framed to — gates
  // flyToBounds so re-clipping / toggles don't re-frame the view.
  const lastFitKeyRef = useRef<string | null>(null)
  // Last split plane the cut-face camera framed — re-frame once per
  // newly-drawn plane, not on every basemap/visibility toggle.
  const lastSplitPlaneRef = useRef<Cesium.Plane | null>(null)

  // ---------------------------------------------------------------------------
  // Mount / unmount the CesiumWidget
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // StrictMode fires this effect twice (mount → cleanup → re-mount). The
    // cleanup destroys the widget and nulls widgetRef/cameraResetRef; the
    // subsequent effects guard via `if (!widget) return`, so no explicit
    // double-init guard is needed — the null checks are sufficient.
    const widget = new Cesium.CesiumWidget(container, {
      // Flat globe — no Cesium ion terrain. The project elevations are used
      // directly as ellipsoidal heights (the ~45 m geoid offset is shared by
      // all surfaces so relative geometry is correct — see §4.2 of the spec).
      terrainProvider: new Cesium.EllipsoidTerrainProvider(),
      // Suppress the default Cesium skybox (stars) — not relevant for
      // geotech project views. A plain sky colour is less distracting.
      skyBox: false,
      // Suppress the Cesium ion logo and the default imagery — we add our own.
      baseLayer: false,
    })

    // Remove the Cesium credit container (hidden behind our own attribution UI).
    // The provider credit is still honoured in BasemapPanel.
    const creditContainer = container.querySelector('.cesium-widget-credits') as HTMLElement | null
    if (creditContainer) creditContainer.style.display = 'none'

    widgetRef.current = widget
    // A freshly created widget has the default whole-Earth camera —
    // it must be re-framed. Clearing the fit guard here is what makes
    // the StrictMode-recreated (and secondary) viewport actually fly
    // to the model instead of staying on the bare globe.
    lastFitKeyRef.current = null
    lastSplitPlaneRef.current = null

    return () => {
      widget.destroy()
      widgetRef.current = null
      // Null the camera reset ref so callers get null rather than a stale
      // callback pointing at the destroyed widget's scene.camera.
      if (cameraResetRef) cameraResetRef.current = null
    }
    // reason: cameraResetRef is a stable module-level object literal — its
    // identity never changes, so it is safe to omit from the dep array.
    // Including it would cause spurious widget remounts on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------------------
  // Rebuild surface primitives when data changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const widget = widgetRef.current
    if (!widget) return

    // Basemap lid: one Geopunt ortho GetMap over the model footprint,
    // placed flat at the model top. Off when the user toggled the
    // basemap off, or no model yet, or non-Belgian CRS.
    const lidSurfaces: { vertices: readonly (readonly [number, number, number])[] }[] =
      [...surfacesByFormationId.values()]
    if (groundSurface && groundSurface.vertices.length > 0) {
      lidSurfaces.push({ vertices: groundSurface.vertices })
    }
    const lid = basemapEnabled ? buildBasemapLid(lidSurfaces, projectEpsg) : null

    rebuildSurfacePrimitives(
      widget.scene,
      formations,
      surfacesByFormationId,
      projectEpsg,
      groundSurface,
      hiddenFormationIds,
      lid,
      clippingPlane,
      invertClip,
      splitLine,
    )

    const allSurfaces = Array.from(surfacesByFormationId.values())
    const hasSurfaces = allSurfaces.some(s => s.vertices.length > 0)

    // Camera. Split active → look at the cut FACE head-on (step 3);
    // single → oblique bounds fit. Reset verb mirrors the active mode.
    if (cameraResetRef) {
      cameraResetRef.current = clippingPlane
        ? () =>
            flyToCutFace(
              widget.scene.camera,
              allSurfaces,
              projectEpsg,
              clippingPlane.normal,
              !invertClip,
            )
        : () => flyToBounds(widget.scene.camera, allSurfaces, projectEpsg)
    }

    if (clippingPlane) {
      // Re-frame to the cut once per newly-drawn plane (object
      // identity changes per draw) — not on basemap/visibility toggles.
      if (hasSurfaces && lastSplitPlaneRef.current !== clippingPlane) {
        lastSplitPlaneRef.current = clippingPlane
        flyToCutFace(
          widget.scene.camera,
          allSurfaces,
          projectEpsg,
          clippingPlane.normal,
          !invertClip,
        )
      }
    } else {
      lastSplitPlaneRef.current = null
      // Single view: fly only when the surface SET changes.
      const fitKey = `${projectEpsg}|${allSurfaces
        .map(s => s.vertices.length)
        .join(',')}|${groundSurface?.vertices.length ?? 0}`
      if (hasSurfaces && lastFitKeyRef.current !== fitKey) {
        lastFitKeyRef.current = fitKey
        flyToBounds(widget.scene.camera, allSurfaces, projectEpsg)
      }
    }
    // reason: clippingPlane/invertClip/splitLine drive the per-half
    // clip + cut-face caps + camera; the refs gate re-framing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    formations,
    surfacesByFormationId,
    projectEpsg,
    groundSurface,
    hiddenFormationIds,
    basemapEnabled,
    clippingPlane,
    invertClip,
    splitLine,
  ])

  // (Basemap is no longer a Cesium ImageryLayer — it's a single
  // georeferenced "lid" primitive built inside rebuildSurfacePrimitives;
  // see buildBasemapLid. The old whole-ellipsoid tiled-imagery effect
  // was removed: the Geopunt GoogleMapsVL matrixset never tiled right
  // under Cesium → 400-storm + edge-on smear instead of a cutout.)

  // ---------------------------------------------------------------------------
  // Wire click handler for split-line draw interaction
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const widget = widgetRef.current
    if (!widget || !onSceneClick) return

    // Remove any previous handler.
    if (clickHandlerRef.current) {
      clickHandlerRef.current.destroy()
      clickHandlerRef.current = null
    }

    const handler = new Cesium.ScreenSpaceEventHandler(widget.scene.canvas)
    handler.setInputAction((event: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
      // pickPosition needs a depth buffer / something pickable under the
      // cursor. On the flat ellipsoid (no Cesium terrain) it returns
      // undefined for clicks off the TIN — which is why the split never
      // registered. Fall back to the ellipsoid intersection so any
      // click on the scene yields a world point.
      const cartesian =
        widget.scene.pickPosition(event.position) ??
        widget.camera.pickEllipsoid(
          event.position,
          widget.scene.globe.ellipsoid,
        )
      if (cartesian) {
        onSceneClick(cartesian)
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK)

    clickHandlerRef.current = handler

    return () => {
      handler.destroy()
      clickHandlerRef.current = null
    }
  }, [onSceneClick])

  return (
    <div
      ref={containerRef}
      id={`cesium-viewport-${viewportKey}`}
      className="relative w-full h-full"
      style={{ background: '#000' }}
    />
  )
}

// ---------------------------------------------------------------------------
// Split-line draw interaction state machine
// ---------------------------------------------------------------------------

type DrawState =
  | { phase: 'idle' }
  | { phase: 'first-click'; first: Cesium.Cartesian3 }

/**
 * Compute a vertical ECEF plane from two surface points.
 *
 * The plane normal is perpendicular to the horizontal component of the
 * line segment (i.e. the plane is vertical — infinite depth extent).
 *
 * Returns ``null`` when the two points are too close (< ``MIN_SPLIT_LINE_M``
 * in projected metres) to define a stable normal.
 *
 * Parameters
 * ----------
 * a
 *     First ECEF Cartesian3 point (from Cesium scene pick).
 * b
 *     Second ECEF Cartesian3 point.
 * Returns
 * -------
 * ``Cesium.Plane`` or ``null``.
 */
function computeSplitPlane(
  a: Cesium.Cartesian3,
  b: Cesium.Cartesian3,
): Cesium.Plane | null {
  // Convert both points to geographic to check horizontal distance.
  const cartographic = (c: Cesium.Cartesian3) =>
    Cesium.Ellipsoid.WGS84.cartesianToCartographic(c)

  const cgA = cartographic(a)
  const cgB = cartographic(b)

  // Rough horizontal distance in projected CRS metres.
  const dLng = (cgB.longitude - cgA.longitude) * Cesium.Math.DEGREES_PER_RADIAN
  const dLat = (cgB.latitude - cgA.latitude) * Cesium.Math.DEGREES_PER_RADIAN
  // Approx metres per degree at mid-latitude.
  const midLat = ((cgA.latitude + cgB.latitude) / 2) * Cesium.Math.DEGREES_PER_RADIAN
  const mPerLat = 111_320
  const mPerLng = 111_320 * Math.cos((midLat * Math.PI) / 180)
  const distM = Math.sqrt((dLat * mPerLat) ** 2 + (dLng * mPerLng) ** 2)

  // Reject overly short segments — they produce degenerate normals.
  if (distM < MIN_SPLIT_LINE_M) return null

  // Build a vertical plane. The plane normal is the cross product of
  // the horizontal line direction and the "up" vector at the midpoint.
  const AB = Cesium.Cartesian3.subtract(b, a, new Cesium.Cartesian3())
  const midpoint = Cesium.Cartesian3.midpoint(a, b, new Cesium.Cartesian3())
  const up = Cesium.Ellipsoid.WGS84.geodeticSurfaceNormal(midpoint, new Cesium.Cartesian3())

  const normal = Cesium.Cartesian3.cross(AB, up, new Cesium.Cartesian3())
  Cesium.Cartesian3.normalize(normal, normal)

  // Plane equation: normal · X = distance (where distance is normal · a)
  const distance = -Cesium.Cartesian3.dot(normal, a)

  return new Cesium.Plane(normal, distance)
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Cesium-based 3D geological model viewer.
 *
 * Renders TIN formation surfaces in a single viewport (default) or two
 * side-by-side viewports (split mode, G6).  A basemap tile layer is draped
 * on the globe for geographic context.
 *
 * This component is intentionally imperative — Cesium's API is DOM-based
 * and lifecycle-driven.  React state drives the configuration (which
 * formations/surfaces/basemap are active); the Cesium widget is created in
 * ``useEffect`` and mutated in response to state changes.
 *
 * No props are tunnelled from the ``StageDescriptor`` chain — this component
 * is called directly by ``GeologyCanvas`` with explicit props.
 *
 * Parameters
 * ----------
 * splitMode
 *     ``'single'`` or ``'split'``.
 * splitPlane
 *     ECEF plane for split mode; ``null`` in single mode.
 * formations
 *     All geological formations, sorted ascending by ``display_order``.
 * surfacesByFormationId
 *     Pre-fetched surface data keyed by formation id.
 * activeBasemap
 *     Currently active basemap source.
 * projectEpsg
 *     Horizontal CRS EPSG code (31370 or 28992).
 * onSplitPlaneDrawn
 *     Callback emitted when the user completes the split-line draw.
 * resetCameraRef
 *     Ref populated with a fly-to-bounds callback for the GeologyToolbar
 *     Reset verb.
 *
 * Returns
 * -------
 * JSX.Element
 *     The viewer container element.
 */
export default function Geology3DViewer({
  splitMode,
  splitPlane,
  formations,
  surfacesByFormationId,
  activeBasemap: initialBasemap,
  projectEpsg,
  onSplitPlaneDrawn,
  splitLine = null,
  resetCameraRef,
  groundSurface,
  onExitSplit,
}: Geology3DViewerProps): JSX.Element {
  // ---------------------------------------------------------------------------
  // Basemap state — read from localStorage on mount (same key as MapView so
  // the two views share the user's last explicit pick).
  //
  // When ``initialBasemap`` is provided (e.g. in tests), it seeds the state;
  // otherwise the localStorage key is consulted on the lazy initialiser so
  // the viewer starts in sync with MapView's last pick.
  // ---------------------------------------------------------------------------

  const [basemapId, setBasemapId] = useState<BasemapId>(() => {
    if (initialBasemap) return initialBasemap.id
    return readBasemapId(
      typeof document !== 'undefined' &&
        document.documentElement.classList.contains('dark'),
    )
  })
  const resolvedBasemap: BasemapSource = useMemo(
    () => BASEMAP_SOURCES.find(b => b.id === basemapId) ?? BASEMAP_SOURCES[0],
    [basemapId],
  )

  function handleBasemapSelect(id: BasemapId): void {
    writeBasemapId(id)
    setBasemapId(id)
  }

  // ---------------------------------------------------------------------------
  // Split-line draw state (G6 — session-ephemeral, not persisted)
  // ---------------------------------------------------------------------------

  const [drawState, setDrawState] = useState<DrawState>({ phase: 'idle' })

  // ---------------------------------------------------------------------------
  // Per-formation 3D visibility (the legend). Session-ephemeral, not
  // persisted — view chrome like the basemap pick. Hiding a formation
  // drops its TIN so the next-deeper formation shows through.
  // ---------------------------------------------------------------------------
  const [hiddenFormationIds, setHiddenFormationIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  )
  const toggleFormation = useCallback((id: string) => {
    setHiddenFormationIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])
  // Basemap on/off (the user toggle). Default on.
  const [basemapEnabled, setBasemapEnabled] = useState(true)

  // Split-line free-draw is EXPLICIT: armed by the "Split model" button,
  // not always-on. Without this every click in single view tried to
  // start a split (and silently failed on the flat ellipsoid).
  const [splitArmed, setSplitArmed] = useState(false)

  const handleViewportClick = useCallback(
    (cartesian: Cesium.Cartesian3) => {
      if (splitMode !== 'single' || splitPlane !== null) return

      if (drawState.phase === 'idle') {
        setDrawState({ phase: 'first-click', first: cartesian })
        return
      }

      if (drawState.phase === 'first-click') {
        const plane = computeSplitPlane(drawState.first, cartesian)
        setDrawState({ phase: 'idle' })
        if (plane) {
          // Project both ECEF endpoints back to the project CRS so the
          // cut-face caps can sample formation TINs along the line.
          const toProjected = (c: Cesium.Cartesian3): [number, number] => {
            const cg = Cesium.Cartographic.fromCartesian(c)
            return wgs84ToProjected(
              Cesium.Math.toDegrees(cg.latitude),
              Cesium.Math.toDegrees(cg.longitude),
              projectEpsg,
            )
          }
          const [x0, y0] = toProjected(drawState.first)
          const [x1, y1] = toProjected(cartesian)
          onSplitPlaneDrawn(plane, { x0, y0, x1, y1 })
          setSplitArmed(false)
        }
        // Segment too short → stay armed, idle: the user re-clicks.
      }
    },
    [splitMode, splitPlane, drawState, onSplitPlaneDrawn, projectEpsg],
  )

  // Draw mode is active only while explicitly armed (and we're in single
  // view with no plane yet). Clicks are captured only then.
  const isDrawMode =
    splitMode === 'single' && splitPlane === null && splitArmed
  const primaryClickHandler = isDrawMode ? handleViewportClick : undefined

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="relative w-full h-full flex">
      {/* Primary (left / only) viewport */}
      <div className={splitMode === 'split' ? 'w-1/2 h-full relative' : 'w-full h-full relative'}>
        <CesiumViewport
          viewportKey="primary"
          formations={formations}
          surfacesByFormationId={surfacesByFormationId}
          activeBasemap={resolvedBasemap}
          projectEpsg={projectEpsg}
          clippingPlane={splitPlane}
          invertClip={false}
          splitLine={splitLine}
          cameraResetRef={resetCameraRef}
          onSceneClick={primaryClickHandler}
          groundSurface={groundSurface}
          hiddenFormationIds={hiddenFormationIds}
          basemapEnabled={basemapEnabled}
        />

        {/* Basemap picker — only on the primary viewport */}
        <BasemapPanel activeBasemapId={basemapId} onSelect={handleBasemapSelect} />

        {/* Layer legend — basemap on/off + per-formation 3D visibility.
            Click a row to hide/show that layer in the model. */}
        {
          <div className="absolute top-2 left-2 z-10 bg-surface-overlay/95 border border-border-default rounded shadow-lg max-w-[15rem] py-1 text-xs">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-text-muted">
              Layers
            </div>
            <ul>
              <li>
                <button
                  type="button"
                  onClick={() => setBasemapEnabled(v => !v)}
                  className={`w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-surface-page transition-colors ${!basemapEnabled ? 'opacity-50' : ''}`}
                  title={basemapEnabled ? 'Hide basemap' : 'Show basemap'}
                >
                  <span
                    className="inline-block w-3 h-3 rounded-sm shrink-0 border border-border-default bg-text-secondary"
                  />
                  <span
                    className={`truncate ${!basemapEnabled ? 'line-through text-text-muted' : 'text-text-primary'}`}
                  >
                    Basemap
                  </span>
                </button>
              </li>
              {formations.map(f => {
                const hidden = hiddenFormationIds.has(f.id)
                const hex = f.color.startsWith('#') ? f.color : `#${f.color}`
                return (
                  <li key={f.id}>
                    <button
                      type="button"
                      onClick={() => toggleFormation(f.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1 text-left hover:bg-surface-page transition-colors ${hidden ? 'opacity-50' : ''}`}
                      title={hidden ? 'Show in 3D' : 'Hide in 3D'}
                    >
                      <span
                        className="inline-block w-3 h-3 rounded-sm shrink-0 border border-border-default"
                        style={hidden ? { borderColor: hex } : { backgroundColor: hex }}
                      />
                      <span
                        className={`truncate ${hidden ? 'line-through text-text-muted' : 'text-text-primary'}`}
                      >
                        {f.name}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        }

        {/* Split control — explicit free-draw arm + collapse. */}
        <div className="absolute bottom-9 left-1/2 -translate-x-1/2 z-10">
          {splitMode === 'split' ? (
            <button
              type="button"
              onClick={() => onExitSplit?.()}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-surface-overlay/95 border border-border-default text-text-primary hover:bg-surface-page transition-colors shadow-lg"
              title="Collapse the split back to a single view"
            >
              Single view
            </button>
          ) : splitArmed ? (
            <button
              type="button"
              onClick={() => {
                setSplitArmed(false)
                setDrawState({ phase: 'idle' })
              }}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-surface-overlay/95 border border-border-default text-text-secondary hover:bg-surface-page transition-colors shadow-lg"
              title="Cancel the split-line draw"
            >
              Cancel split
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                setSplitArmed(true)
                setDrawState({ phase: 'idle' })
              }}
              className="px-3 py-1.5 rounded text-xs font-semibold bg-accent text-text-on-accent hover:bg-accent-muted transition-colors shadow-lg"
              title="Draw a line across the model to split it into two independently-panned views"
            >
              ✂ Split model
            </button>
          )}
        </div>

        {/* Split-line draw mode hint */}
        {isDrawMode && (
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 bg-black/60 text-white text-xs px-2 py-1 rounded pointer-events-none">
            {drawState.phase === 'idle'
              ? 'Click two points to draw a split line'
              : 'Click the second point to complete the split line'}
          </div>
        )}
      </div>

      {/* Secondary (right) viewport — split mode only */}
      {splitMode === 'split' && (
        <>
          <div className="w-px h-full bg-gray-300 dark:bg-gray-600 flex-shrink-0" aria-hidden="true" />
          <div className="w-1/2 h-full relative">
            <CesiumViewport
              viewportKey="secondary"
              formations={formations}
              surfacesByFormationId={surfacesByFormationId}
              activeBasemap={resolvedBasemap}
              projectEpsg={projectEpsg}
              clippingPlane={splitPlane}
              invertClip={true}
              splitLine={splitLine}
              groundSurface={groundSurface}
              hiddenFormationIds={hiddenFormationIds}
          basemapEnabled={basemapEnabled}
            />
          </div>
        </>
      )}
    </div>
  )
}
