/**
 * Pure Cesium primitive builders + camera helpers for ``Geology3DViewer``.
 *
 * Extracted verbatim from Geology3DViewer.tsx (debt #201 round 2) — the
 * visual constants, TIN/fence/solid/cap primitive builders, the vertex-
 * colour appearance, ``rebuildSurfacePrimitives``, fly-to helpers, and the
 * split-plane math. No React.
 */
import * as Cesium from 'cesium'

import type {
  GeologicalFormationResponse,
  FormationSurfaceResponse,
  GroundSurfaceBuildResponse,
} from '../../../api/client'
import type { LithoBodySolidResponse } from '../../../api/clients/geology'
import { projectedToWgs84, wgs84ToProjected } from '../../../hooks/useWgs84'
import {
  computeTriangleConfidence,
  computeVertexConfidence,
  confidenceToAlphaMultiplier,
} from '../../../utils/tinConfidence'
import {
  CONFIDENCE_FALLOFF_M,
  distanceAlphaMultiplier,
  nearestDistance2D,
} from '../../../utils/distanceConfidence'
import {
  buildCutFaceBands,
  computeBasemapBounds,
  computeSolidCapTriangles,
  sampleTinZ,
  clipTrisToHalfSpace,
  clipTexTrisToHalfSpace,
  trianglesToWireframeEdgeIndices,
  type CapPlane,
  type TexVert,
} from './cesiumGeometry'
import type { FencePanel } from '../../../utils/fencePanels'
import { buildFootprintRingPrimitive } from './footprintRingPrimitive'

// Disable Cesium ion. All basemaps and terrain come from our own providers.
Cesium.Ion.defaultAccessToken = ''

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Z-offset in metres per display_order unit, to avoid z-fighting between
 * co-planar or near-co-planar formation surfaces and to keep their depth
 * ordering stable against the opaque cut-face caps / globe. 0.01 m was
 * below the depth-buffer resolution at typical camera distance (it never
 * actually separated anything); 0.2 m is still invisible at typical
 * project extents (a few km) but comfortably beats depth precision. */
export const Z_OFFSET_PER_ORDER = 0.2

/**
 * Basemap lid alpha the shared 3-D stages render at — the pre-B6 baked-in
 * 0.65, now named so the fence cutout can dial ITS copy without touching
 * the stages (owner ruling B6b, 2026-08-27; the cutout's value lives in
 * ``parameters/unitFenceSceneConstants.ts``).
 */
export const DEFAULT_BASEMAP_LID_ALPHA = 0.65

/** How far (m) the translucent formation/ground/lid surfaces are receded
 * from the true split plane before clipping, so their cut edge never lands
 * exactly coplanar with the OPAQUE cut-face caps (which sit on the true
 * plane and write depth). Without this inset the coincident fragments fail
 * the depth test stochastically → the shimmering fringe along every band's
 * cut edge. The caps fill the receded gap, so there is no visible step. */
export const SURFACE_CLIP_INSET_M = 0.5

/** Alpha for fresh (non-stale) surfaces. */
export const ALPHA_FRESH = 0.75

/** Alpha for stale surfaces (same convention as the 2D section canvas). */
export const ALPHA_STALE = 0.35

/** Minimum draw-line segment length in metres (projected) to accept as a
 * valid split plane. Prevents degenerate normals from near-zero-length lines. */
export const MIN_SPLIT_LINE_M = 10

/** Alpha for the DEM ground-surface TIN mesh — semi-transparent so formation
 * surfaces render visibly above the terrain. */
export const ALPHA_GROUND_SURFACE = 0.45

/** Earth-tone colour for the DEM ground-surface TIN (warm grey). */
export const GROUND_SURFACE_COLOR = new Cesium.Color(0.55, 0.52, 0.48, ALPHA_GROUND_SURFACE)

/** Alpha applied to flagged body marker disk solids — semi-transparent so they
 * read as "local occurrence, no confirmed lateral extent" rather than a filled
 * body. The backend emits disk-marker geometry for flagged bodies (is_flagged
 * true) when the solid builder could not produce a watertight mesh. */
export const FLAGGED_SOLID_ALPHA = 0.45

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Geopunt orthophoto WMS (verified live 2026-05-16: serves EPSG:31370
// + image/png GetMap, layer "Ortho"). One GetMap for the model bbox is
// the "GIS magic" the user asked for — far more robust than draping a
/** A single georeferenced image draped flat as a "lid" on top of the
 * model: the WGS84 rectangle to place it in, the elevation (top of the
 * model) to place it at, and the one-shot WMS GetMap image URL. */
export interface BasemapLid {
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
export function buildBasemapLid(
  surfaces: { vertices: readonly (readonly [number, number, number])[] }[],
  projectEpsg: number,
): BasemapLid | null {
  // Pure footprint/url math lives in cesiumGeometry (debt #41); this
  // wrapper only wraps the degree bounds in a Cesium.Rectangle.
  const b = computeBasemapBounds(surfaces, projectEpsg)
  if (b === null) return null
  return {
    rect: Cesium.Rectangle.fromDegrees(b.minLng, b.minLat, b.maxLng, b.maxLat),
    elevation: b.elevation,
    url: b.url,
  }
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
export function flyToBounds(
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
export function flyToCutFace(
  camera: Cesium.Camera,
  surfaces: FormationSurfaceResponse[],
  projectEpsg: number,
  plane: Cesium.Plane,
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
  const n = Cesium.Cartesian3.normalize(plane.normal, new Cesium.Cartesian3())
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
export function buildCapPrimitives(
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
  for (const s of surfacesByFormationId.values()) {
    for (const [x, y] of s.vertices) {
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }
  if (!isFinite(minX)) return []

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

  for (const f of ordered) {
    if (!colorByFid.has(f.id)) {
      const hex = f.color.startsWith('#') ? f.color : `#${f.color}`
      const c = Cesium.Color.fromCssColorString(hex) ?? Cesium.Color.GRAY
      colorByFid.set(f.id, c)
    }
  }

  // Per-fid flat projected triangle soup. Robust to formations pinching
  // out between stations (the old index-aligned walk dragged a band to
  // a global zBase wherever a deeper formation was absent — the cut-face
  // "droop" while the TINs themselves were flat).
  const quadsByFid = buildCutFaceBands(profiles, stationXY)

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
            // Cesium's GeometryAttributes type marks normal / st /
            // bitangent / tangent / color as required, but Cesium
            // tolerates a position-only geometry at runtime (the
            // appearance below provides shading). Cast so tsc accepts
            // the partial shape — same pattern at the cut-face +
            // basemap call sites.
            attributes: {
              position: new Cesium.GeometryAttribute({
                componentDatatype: Cesium.ComponentDatatype.DOUBLE,
                componentsPerAttribute: 3,
                values: positions,
              }),
            } as unknown as Cesium.GeometryAttributes,
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
 * Normalise a hex colour string (with or without a leading ``#``) into a
 * ``Cesium.Color``, falling back to grey when malformed.
 *
 * Parameters
 * ----------
 * hex
 *     Hex colour string, e.g. ``"#aabbcc"`` or ``"aabbcc"``.
 *
 * Returns
 * -------
 * ``Cesium.Color`` — grey when the string does not parse.
 */
export function hexToCesiumColor(hex: string): Cesium.Color {
  const css = hex.startsWith('#') ? hex : `#${hex}`
  return Cesium.Color.fromCssColorString(css) ?? Cesium.Color.GRAY
}

/**
 * Project a mesh to ECEF and produce the position + triangle-index buffers
 * shared by every mesh primitive builder in this file.
 *
 * Two paths, identical across the tin / fence / solid builders:
 *
 * - No ``clip`` — compact indexed geometry (the shared-vertex fast path).
 * - ``clip`` set — the mesh is clipped to the half-space and emitted as a
 *   triangle soup (clipped triangles don't share vertices).
 *
 * Parameters
 * ----------
 * vertices
 *     ``[x_m, y_m, elevation_m]`` triples in the project's horizontal CRS.
 * triangles
 *     Vertex-index triples.
 * projectEpsg
 *     Horizontal CRS EPSG code for the coordinate transform.
 * clip
 *     Optional half-space plane + side; when set, only the kept half is built.
 *
 * Returns
 * -------
 * ``{ positionValues, triangleIndices }`` or ``null`` when ``triangles`` is
 * empty or the clip removes the whole mesh.
 */
export function buildMeshBuffers(
  vertices: [number, number, number][],
  triangles: [number, number, number][],
  projectEpsg: number,
  clip?: { plane: Cesium.Plane; keepPositive: boolean },
): { positionValues: Float64Array; triangleIndices: number[] } | null {
  if (triangles.length === 0) return null

  const ecef = vertices.map(([x, y, z]) => {
    const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
    return Cesium.Cartesian3.fromDegrees(lng, lat, z)
  })

  let positionValues: Float64Array
  let triangleIndices: number[]

  if (!clip) {
    // No split — keep the compact indexed geometry (unchanged path).
    positionValues = new Float64Array(ecef.length * 3)
    let i = 0
    for (const v of ecef) {
      positionValues[i++] = v.x
      positionValues[i++] = v.y
      positionValues[i++] = v.z
    }
    triangleIndices = new Array(triangles.length * 3)
    let j = 0
    for (const [i0, i1, i2] of triangles) {
      triangleIndices[j++] = i0
      triangleIndices[j++] = i1
      triangleIndices[j++] = i2
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
    triangleIndices = new Array(clipped.length * 3)
    let pi = 0
    let ii = 0
    for (const t of clipped) {
      for (const v of t) {
        positionValues[pi++] = v.x
        positionValues[pi++] = v.y
        positionValues[pi++] = v.z
        triangleIndices[ii] = ii
        ii++
      }
    }
  }

  return { positionValues, triangleIndices }
}

/**
 * Assemble a position-only ``Cesium.Geometry`` from prepared buffers.
 *
 * Parameters
 * ----------
 * positionValues
 *     Flat ECEF xyz buffer.
 * indices
 *     Draw index buffer (triangle triples, or edge pairs for LINES).
 * primitiveType
 *     ``TRIANGLES`` (default) or ``LINES`` for wireframe renders.
 *
 * Returns
 * -------
 * ``Cesium.Geometry``.
 */
export function makeMeshGeometry(
  positionValues: Float64Array,
  indices: Uint32Array,
  primitiveType: Cesium.PrimitiveType = Cesium.PrimitiveType.TRIANGLES,
): Cesium.Geometry {
  return new Cesium.Geometry({
    // See buildCutFaceBands for the partial-shape cast rationale.
    attributes: {
      position: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.DOUBLE,
        componentsPerAttribute: 3,
        values: positionValues,
      }),
    } as unknown as Cesium.GeometryAttributes,
    indices,
    primitiveType,
    boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionValues)),
  })
}

/**
 * Wrap a geometry in a single-instance ``Cesium.Primitive`` with a
 * per-instance colour and the given ``PerInstanceColorAppearance`` flags.
 *
 * Parameters
 * ----------
 * geometry
 *     The mesh geometry.
 * color
 *     ``Cesium.Color`` (including alpha) for the instance.
 * appearance
 *     ``translucent`` / ``flat`` / optional ``closed`` flags — the only
 *     attributes that differ between the tin, fence and solid builders.
 *
 * Returns
 * -------
 * ``Cesium.Primitive``.
 */
export function makeColorPrimitive(
  geometry: Cesium.Geometry,
  color: Cesium.Color,
  appearance: { translucent: boolean; flat: boolean; closed?: boolean },
): Cesium.Primitive {
  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry,
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
      },
    }),
    appearance: new Cesium.PerInstanceColorAppearance(appearance),
    asynchronous: false,
  })
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
export function buildTinPrimitive(
  vertices: [number, number, number][],
  triangles: [number, number, number][],
  color: Cesium.Color,
  projectEpsg: number,
  clip?: { plane: Cesium.Plane; keepPositive: boolean },
): Cesium.Primitive | null {
  const buffers = buildMeshBuffers(vertices, triangles, projectEpsg, clip)
  if (!buffers) return null

  const geometry = makeMeshGeometry(
    buffers.positionValues,
    new Uint32Array(buffers.triangleIndices),
  )

  // flat: true — geological/terrain bands are translucent fills; per-vertex
  // lighting normals are neither wanted nor meaningful for subsurface surfaces.
  // flat: false requires a normal attribute (and Cesium's compressVertices path
  // then demands compressedAttributes that were never computed), which causes
  // the "Appearance/Geometry mismatch … 'compressedAttributes'" crash for every
  // TIN primitive. flat: true uses FLAT_VERTEX_FORMAT (position-only), which
  // matches the geometry we supply.
  return makeColorPrimitive(geometry, color, { translucent: true, flat: true })
}

// ---------------------------------------------------------------------------
// Fence-panel primitive builder
// ---------------------------------------------------------------------------

/**
 * Build a double-sided Cesium ``Primitive`` for a vertical fence-diagram wall.
 *
 * This mirrors ``buildTinPrimitive`` but disables back-face culling so the
 * wall is visible from both sides (the camera may orbit behind a panel). Like
 * ``buildTinPrimitive`` it honours the split ``clip``: when a half-space plane is
 * supplied the panel is clipped to that half (emitting a triangle soup) so a
 * split view shows each pane only the walls on its side — without the clip the
 * fence walls floated whole over both panes (dogfeed 2026-06-10).
 *
 * Parameters
 * ----------
 * vertices
 *     ``[x_m, y_m, elevation_m]`` triples in the project's horizontal CRS.
 * triangles
 *     Vertex-index triples.
 * color
 *     ``Cesium.Color`` (including alpha) for the primitive.
 * projectEpsg
 *     Horizontal CRS EPSG code for the coordinate transform.
 * clip
 *     Optional half-space plane + side; when set, only the kept half is built.
 *
 * Returns
 * -------
 * ``Cesium.Primitive`` or ``null`` when ``triangles`` is empty or the clip
 * removes the whole panel.
 */
export function buildFencePrimitive(
  vertices: [number, number, number][],
  triangles: [number, number, number][],
  color: Cesium.Color,
  projectEpsg: number,
  clip?: { plane: Cesium.Plane; keepPositive: boolean },
): Cesium.Primitive | null {
  const buffers = buildMeshBuffers(vertices, triangles, projectEpsg, clip)
  if (!buffers) return null

  const geometry = makeMeshGeometry(
    buffers.positionValues,
    new Uint32Array(buffers.triangleIndices),
  )

  // flat: true — same reason as buildTinPrimitive (no normals computed;
  // FLAT_VERTEX_FORMAT, position-only).  closed: false disables back-face
  // culling so the panel is visible from both sides — when closed=true the
  // render state sets cull.enabled:true; closed=false omits the cull key
  // entirely, leaving WebGL's default (no culling) in effect. Users orbiting
  // the 3D scene will view fence walls from behind, so double-sided is required.
  return makeColorPrimitive(geometry, color, {
    translucent: true,
    flat: true,
    closed: false,
  })
}

// ---------------------------------------------------------------------------
// Solid body primitive builder
// ---------------------------------------------------------------------------

/**
 * Build a Cesium ``Primitive`` for a watertight closed lithostratigraphic body
 * solid.
 *
 * Mirrors ``buildFencePrimitive`` in coordinate transform + clip threading, but
 * uses ``PerInstanceColorAppearance({ translucent: false, flat: true, closed:
 * true })`` for normal (non-flagged) solids — the three attributes that
 * distinguish a closed opaque volume from the translucent open surface sheets
 * used for formation TINs:
 *
 *   - ``translucent: false`` writes to the depth buffer and sorts in front of
 *     every translucent surface, matching how a filled geological body should
 *     read (solid rock, not ghosted).
 *   - ``flat: true`` uses FLAT_VERTEX_FORMAT (position-only) — the same reason
 *     as all other primitives in this file (we do not supply normals, and
 *     Cesium's compressVertices pipeline would crash looking for
 *     ``compressedAttributes`` if ``flat`` were false).
 *   - ``closed: true`` sets ``cull.enabled: true`` on the render state, enabling
 *     back-face culling.  A closed solid has correct outward-facing winding
 *     everywhere, so back-face culling is both correct and cheaper than
 *     ``closed: false`` (double-sided).  Formation TIN sheets and fence walls
 *     use ``closed: false`` because they are open surfaces that the camera may
 *     view from behind; a watertight body solid never shows its interior.
 *
 * Flagged solids (``isFlagged=true``) are rendered translucent (``translucent:
 * true``, alpha ``FLAGGED_SOLID_ALPHA``) because the backend emitted them as
 * best-effort disk-marker geometry rather than a true watertight body — they
 * represent a local occurrence with no confirmed lateral extent and must be
 * visually distinguished from confirmed solids.  Translucent primitives are
 * submitted as separate ``Primitive`` instances so their appearance flags differ
 * from the opaque batch; Cesium handles depth-sort ordering between them.
 *
 * Parameters
 * ----------
 * vertices
 *     ``[x_m, y_m, elevation_m]`` triples in the project's horizontal CRS.
 * triangles
 *     Vertex-index triples (outward right-hand-rule winding).
 * color
 *     ``Cesium.Color`` for the primitive.  Alpha is ignored for non-flagged
 *     solids (rendered fully opaque); for flagged solids the alpha is replaced
 *     by ``FLAGGED_SOLID_ALPHA`` to produce the ghostly marker appearance.
 * projectEpsg
 *     Horizontal CRS EPSG code for the coordinate transform.
 * clip
 *     Optional half-space plane + side; when set, only the kept half is built
 *     (same split-view threading as ``buildTinPrimitive`` and
 *     ``buildFencePrimitive``).
 * isFlagged
 *     When true, applies translucent appearance + ``FLAGGED_SOLID_ALPHA`` so
 *     the marker disk reads as "local, unconfirmed extent" rather than a solid
 *     body.  Defaults to false (opaque).
 * wireframe
 *     When true, the SAME positions are emitted as a LINES primitive whose
 *     index buffer holds the three boundary edges of each triangle
 *     (``i0,i1 i1,i2 i2,i0``) instead of filled faces — the in-app equivalent
 *     of the dev viewer's "wireframe" checkbox.  A line primitive has no faces,
 *     so back-face culling (``closed``) is irrelevant and is dropped for this
 *     case.  Defaults to false (the filled TRIANGLES render is byte-identical
 *     to the pre-wireframe behaviour).
 *
 * Returns
 * -------
 * ``Cesium.Primitive`` or ``null`` when ``triangles`` is empty or the clip
 * removes the whole solid.
 */
export function buildSolidPrimitive(
  vertices: [number, number, number][],
  triangles: [number, number, number][],
  color: Cesium.Color,
  projectEpsg: number,
  clip?: { plane: Cesium.Plane; keepPositive: boolean },
  isFlagged: boolean = false,
  wireframe: boolean = false,
): Cesium.Primitive | null {
  // Shared position + triangle-index buffers. For wireframe we keep the
  // SAME positions but re-expand the triangle triples into edge pairs
  // below, so the filled and wireframe renders of a body share identical
  // geometry.
  const buffers = buildMeshBuffers(vertices, triangles, projectEpsg, clip)
  if (!buffers) return null
  const { positionValues, triangleIndices } = buffers

  let indices: Uint32Array

  if (wireframe) {
    // Re-key the triangle index buffer (triples) into LINE edge pairs so the
    // body renders as a wireframe. Works for both the shared-vertex no-clip
    // buffer and the per-triangle 3-vertex soup of the clipped path — each
    // consecutive index triple (whether shared or soup) becomes its three
    // boundary edges.
    const triples: [number, number, number][] = []
    for (let t = 0; t < triangleIndices.length; t += 3) {
      triples.push([triangleIndices[t], triangleIndices[t + 1], triangleIndices[t + 2]])
    }
    indices = new Uint32Array(trianglesToWireframeEdgeIndices(triples))
  } else {
    indices = new Uint32Array(triangleIndices)
  }

  // LINES for wireframe (edge index buffer), TRIANGLES for the filled body.
  const geometry = makeMeshGeometry(
    positionValues,
    indices,
    wireframe ? Cesium.PrimitiveType.LINES : Cesium.PrimitiveType.TRIANGLES,
  )

  // Flagged solids are marker disks ("local occurrence, no lateral extent"):
  // render semi-transparent so they are visually distinct from confirmed bodies.
  // Non-flagged solids stay fully opaque (translucent:false) so they write
  // depth and occlude translucent formation surfaces correctly.
  const renderColor = isFlagged ? color.withAlpha(FLAGGED_SOLID_ALPHA) : color

  // flat: true — no normals supplied; FLAT_VERTEX_FORMAT (position-only)
  //   avoids the compressedAttributes crash that flat:false triggers.
  // closed: true — enables back-face culling (cull.enabled: true on the
  //   render state); correct for a watertight outward-wound solid. A LINES
  //   primitive has no faces, so culling is irrelevant — drop it for the
  //   wireframe case (PerInstanceColorAppearance renders LINES fine).
  // translucent: depends on isFlagged — opaque for real bodies (writes depth,
  //   occludes formation surfaces), translucent for flagged marker disks
  //   (ghostly appearance, reads as "local occurrence, no lateral extent").
  return makeColorPrimitive(geometry, renderColor, {
    translucent: isFlagged,
    flat: true,
    closed: wireframe ? false : true,
  })
}

// ---------------------------------------------------------------------------
// Solid cut-face cap builder
// ---------------------------------------------------------------------------

/**
 * Build a Cesium ``Primitive`` for the cut-face cap of a clipped litho body
 * solid — the filled cross-section polygon exposed at the split plane.
 *
 * Unlike the geology formation cap path (``buildCapPrimitives``), which
 * samples formation TINs along the split line at discrete stations, this
 * function intersects the ACTUAL solid mesh with the split plane using
 * ``computeSolidCapTriangles``.  The result is the exact cross-section
 * boundary of the body, correctly non-convex when the body is non-convex.
 *
 * The cap is rendered:
 *   - **Opaque** (``translucent: false``) — caps must read as filled solid
 *     material, not a ghost overlay.
 *   - **Flat** (``flat: true``) — no normals supplied; FLAT_VERTEX_FORMAT.
 *   - **Open** (``closed: false``) — a cap is a single-sided planar polygon,
 *     not a closed volume, so back-face culling is disabled.  The split plane
 *     is viewed head-on in the cut-face camera position, so both sides of the
 *     cap plane can be the "front".
 *
 * Parameters
 * ----------
 * vertices
 *     ``[x_m, y_m, elevation_m]`` triples in the project's projected CRS.
 * triangles
 *     Vertex-index triples of the solid mesh (outward winding).
 * color
 *     Cap colour — must match the body colour so the cap reads as a
 *     continuous cross-section of the same material.
 * projectEpsg
 *     Horizontal CRS EPSG code for the coordinate transform.
 * plane
 *     The projected cut plane (same ``{ normal, constant }`` shape as
 *     ``CapPlane``).  The normal does not need to be unit-length.
 *
 * Returns
 * -------
 * ``Cesium.Primitive`` or ``null`` when the plane misses the solid or the
 * cap triangulation produces no non-degenerate triangles.
 */
export function buildSolidCapPrimitive(
  vertices: [number, number, number][],
  triangles: [number, number, number][],
  color: Cesium.Color,
  projectEpsg: number,
  plane: CapPlane,
): Cesium.Primitive | null {
  const cap = computeSolidCapTriangles(vertices, triangles, plane)
  if (cap.positions.length === 0 || cap.indices.length === 0) return null

  // Convert the projected flat position array to ECEF, mirroring the
  // pattern used in buildCapPrimitives (the geology formation cap path).
  const nVerts = cap.positions.length / 3
  const positionValues = new Float64Array(nVerts * 3)
  let pi = 0
  for (let v = 0; v < cap.positions.length; v += 3) {
    const [lat, lng] = projectedToWgs84(cap.positions[v], cap.positions[v + 1], projectEpsg)
    const ecef = Cesium.Cartesian3.fromDegrees(lng, lat, cap.positions[v + 2])
    positionValues[pi++] = ecef.x
    positionValues[pi++] = ecef.y
    positionValues[pi++] = ecef.z
  }

  const indices = new Uint32Array(cap.indices)

  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.Geometry({
        // See buildCutFaceBands for the partial-shape cast rationale.
        attributes: {
          position: new Cesium.GeometryAttribute({
            componentDatatype: Cesium.ComponentDatatype.DOUBLE,
            componentsPerAttribute: 3,
            values: positionValues,
          }),
        } as unknown as Cesium.GeometryAttributes,
        indices,
        primitiveType: Cesium.PrimitiveType.TRIANGLES,
        boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionValues)),
      }),
      attributes: {
        color: Cesium.ColorGeometryInstanceAttribute.fromColor(color),
      },
    }),
    // flat: true — no normals; FLAT_VERTEX_FORMAT (position-only).
    // translucent: false — cap is opaque solid material; writes depth.
    // closed: false — a cap polygon is one-sided; back-face culling disabled
    //   so it is visible from both sides (the camera can be on either side of
    //   the split plane).
    appearance: new Cesium.PerInstanceColorAppearance({
      flat: true,
      translucent: false,
      closed: false,
    }),
    asynchronous: false,
  })
}

// ---------------------------------------------------------------------------
// Per-vertex gradient appearance (debt #28 follow-up, 2026-05-21).
//
// PerInstanceColorAppearance gives a single colour to the whole primitive.
// To render the confidence signal as a *true* gradient (vs the prior
// binary high/low partition), each vertex carries its own RGBA in a
// vertex attribute and the fragment shader uses the GPU-interpolated
// value.  Cesium's `Appearance` accepts custom GLSL — the shaders here
// follow Cesium's relative-to-eye conventions
// (``position3DHigh``/``position3DLow`` + ``czm_computePosition`` +
// ``czm_modelViewProjectionRelativeToEye``).  ``ALPHA_BLEND`` with
// depthMask off is the standard translucent setup the existing
// PerInstanceColorAppearance(translucent:true, flat:true) uses too.
//
// GLSL VERSION (load-bearing): written in GLSL ES 3.00 style — ``in`` /
// ``out`` not ``attribute`` / ``varying``, and ``out_FragColor`` not
// ``gl_FragColor``.  Cesium runs on WebGL2 and auto-DOWNGRADES modern
// shaders to GLSL 1.00 for a WebGL1 fallback, but does NOT auto-upgrade
// legacy shaders — passing ``varying`` to a WebGL2 context throws
// "Illegal use of reserved word".  ``out_FragColor`` is declared
// automatically by Cesium's ShaderProgram when it sees the identifier.
// This mirrors Cesium's own PerInstanceFlatColorAppearance shaders.
// ---------------------------------------------------------------------------

export const _vertexColorAppearanceVS = [
  'in vec3 position3DHigh;',
  'in vec3 position3DLow;',
  'in vec4 color;',
  'in float batchId;',
  'out vec4 v_color;',
  'void main() {',
  '  vec4 p = czm_computePosition();',
  '  v_color = color;',
  '  gl_Position = czm_modelViewProjectionRelativeToEye * p;',
  '}',
].join('\n')

export const _vertexColorAppearanceFS = [
  'in vec4 v_color;',
  'void main() {',
  '  out_FragColor = v_color;',
  '}',
].join('\n')

export function makeVertexColorAppearance(): Cesium.Appearance {
  return new Cesium.Appearance({
    vertexShaderSource: _vertexColorAppearanceVS,
    fragmentShaderSource: _vertexColorAppearanceFS,
    translucent: true,
    closed: false,
    renderState: {
      blending: Cesium.BlendingState.ALPHA_BLEND,
      depthTest: { enabled: true },
      depthMask: false,
      cull: { enabled: false, face: Cesium.CullFace.BACK },
    } as unknown as object,
  })
}

/**
 * Build a TIN primitive with per-vertex RGBA — true gradient rendering.
 *
 * Same vertex/index layout as ``buildTinPrimitive`` but adds a ``color``
 * vertex attribute (Uint8Array, normalized RGBA per vertex).  Uses the
 * custom vertex-color appearance so the GPU interpolates colour across
 * each triangle.  Both the non-clipped path and the split-mode clipped
 * path are supported:
 *
 *  - Non-clipped: ``perVertexColors`` aligns 1-to-1 with ``vertices``.
 *  - Clipped (split mode): the soup has new vertices on triangle edges.
 *    The caller supplies ``perTriangleColors`` (one RGBA per source
 *    triangle) and we paint each clipped triangle solid with its source
 *    triangle's colour.  Within-triangle interpolation is lost in split
 *    mode but the across-triangle continuity is preserved — acceptable
 *    given the split view is for inspection, not gradient study.
 */
export function buildTinPrimitiveWithVertexColor(
  vertices: [number, number, number][],
  triangles: [number, number, number][],
  perVertexColors: Uint8Array,
  projectEpsg: number,
  clip?: { plane: Cesium.Plane; keepPositive: boolean },
  perTriangleColorsForClip?: Uint8Array,
): Cesium.Primitive | null {
  if (triangles.length === 0) return null
  if (perVertexColors.length !== vertices.length * 4) {
    throw new Error(
      `buildTinPrimitiveWithVertexColor: perVertexColors length ${perVertexColors.length} != vertices*4 ${vertices.length * 4}`,
    )
  }

  const ecef = vertices.map(([x, y, z]) => {
    const [lat, lng] = projectedToWgs84(x, y, projectEpsg)
    return Cesium.Cartesian3.fromDegrees(lng, lat, z)
  })

  let positionValues: Float64Array
  let indices: Uint32Array
  let colorValues: Uint8Array

  if (!clip) {
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
    colorValues = perVertexColors
  } else {
    // Clip path: emit a triangle soup. Each output triangle gets its
    // source triangle's solid colour (per-clipped-triangle solid).
    const tris: Cesium.Cartesian3[][] = triangles.map(([a, b, c]) => [
      ecef[a],
      ecef[b],
      ecef[c],
    ])
    // clipTrisToHalfSpace returns the kept triangles in source-order;
    // each input triangle can produce 0, 1, or 2 output triangles.
    // We re-walk the algorithm here to track which source triangle each
    // output came from so the per-triangle colour assignment is right.
    const clippedWithSrc: { tri: Cesium.Cartesian3[]; srcIdx: number }[] = []
    for (let srcIdx = 0; srcIdx < tris.length; srcIdx += 1) {
      const out = clipTrisToHalfSpace([tris[srcIdx]], clip.plane, clip.keepPositive)
      for (const t of out) {
        clippedWithSrc.push({ tri: t, srcIdx })
      }
    }
    if (clippedWithSrc.length === 0) return null
    positionValues = new Float64Array(clippedWithSrc.length * 9)
    indices = new Uint32Array(clippedWithSrc.length * 3)
    colorValues = new Uint8Array(clippedWithSrc.length * 12)
    let pi = 0
    let ii = 0
    let ci = 0
    const triColors = perTriangleColorsForClip
    for (const { tri, srcIdx } of clippedWithSrc) {
      const r = triColors ? triColors[srcIdx * 4 + 0] : 255
      const g = triColors ? triColors[srcIdx * 4 + 1] : 255
      const b = triColors ? triColors[srcIdx * 4 + 2] : 255
      const a = triColors ? triColors[srcIdx * 4 + 3] : 255
      for (const v of tri) {
        positionValues[pi++] = v.x
        positionValues[pi++] = v.y
        positionValues[pi++] = v.z
        indices[ii] = ii
        ii++
        colorValues[ci++] = r
        colorValues[ci++] = g
        colorValues[ci++] = b
        colorValues[ci++] = a
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
      color: new Cesium.GeometryAttribute({
        componentDatatype: Cesium.ComponentDatatype.UNSIGNED_BYTE,
        componentsPerAttribute: 4,
        normalize: true,
        values: colorValues,
      }),
    } as unknown as Cesium.GeometryAttributes,
    indices,
    primitiveType: Cesium.PrimitiveType.TRIANGLES,
    boundingSphere: Cesium.BoundingSphere.fromVertices(Array.from(positionValues)),
  })

  return new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({ geometry }),
    appearance: makeVertexColorAppearance(),
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
 * hiddenBodyIds
 *     Body ids toggled off in the legend's per-body level.  Only the body-solid
 *     loops honour it — fence walls and TIN sheets have no body identity.
 * footprintRing
 *     Closed ring of ``[x_m, y_m, elevation_m]`` marking the model's footprint
 *     boundary — the alpha hull the build clipped to, fetched from the backend
 *     (never re-derived here).  Drawn last and never clipped, so the ring reads
 *     as "the model ends here" rather than as another modelled surface.
 */
export function rebuildSurfacePrimitives(
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
  showConfidenceFade: boolean = true,
  fencePanels?: FencePanel[],
  groundSurfaceVisible: boolean = true,
  surfacesVisible: boolean = true,
  bodySolids?: LithoBodySolidResponse[],
  bodySolidsWireframe: boolean = false,
  investigationXY?: readonly (readonly [number, number])[],
  hiddenBodyIds?: ReadonlySet<string>,
  footprintRing?: readonly (readonly number[])[],
  basemapLidAlpha: number = DEFAULT_BASEMAP_LID_ALPHA,
): void {
  scene.primitives.removeAll()

  // Split view: clip every TIN to one half-space. Primary viewport
  // keeps the normal side, secondary (invertClip) keeps the other —
  // so the two panes are genuinely the two halves of the cake.
  //
  // The translucent surfaces are clipped against a plane receded by
  // SURFACE_CLIP_INSET_M from the true split plane (caps still use the
  // true plane — see below), so the surface cut edge never lands exactly
  // coplanar with the opaque caps. Cesium.Plane.getPointDistance =
  // normal·X + distance; the kept side is (keepPositive ? d : -d) >= 0.
  // Shrinking the kept half by `inset` → distance shifted by
  // (keepPositive ? -inset : +inset).
  const keepPositive = !invertClip
  const clip = clippingPlane
    ? {
        plane: new Cesium.Plane(
          clippingPlane.normal,
          clippingPlane.distance +
            (keepPositive ? -SURFACE_CLIP_INSET_M : SURFACE_CLIP_INSET_M),
        ),
        keepPositive,
      }
    : undefined

  // Resolve every formation's base colour ONCE per rebuild (grey fallback
  // when malformed) — the fence / surface / solid / cap loops below all
  // share this map instead of re-running formations.find + hex parsing
  // per panel / per solid. Entries are never mutated (loops clone or
  // withAlpha before adjusting).
  const formationColorById = new Map<string, Cesium.Color>(
    formations.map((f) => [f.id, hexToCesiumColor(f.color)]),
  )

  // Per-body colour: the body's display_color override wins, else the
  // formation's colour, else grey (unknown formation id).
  const resolveSolidColor = (solid: LithoBodySolidResponse): Cesium.Color =>
    solid.display_color
      ? hexToCesiumColor(solid.display_color)
      : (formationColorById.get(solid.formation_id) ?? Cesium.Color.GRAY)

  // Step 2 — coloured cut-face caps. Shared geometry rendered in both
  // halves (each half's far side is clipped away, so it reads as that
  // half's exposed cross-section). Cut-face caps are a SOLID-mode concept —
  // suppressed in Fence mode (``fencePanels`` defined) where the user wants
  // only the section walls, not the block's cut face (dogfeed 2026-06-10).
  if (clip && splitLine && fencePanels === undefined) {
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
              // See buildCutFaceBands for the partial-shape cast rationale.
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
              } as unknown as Cesium.GeometryAttributes,
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
              // alpha < 1 → see-through aerial (requested). The stages pass
              // nothing and keep DEFAULT_BASEMAP_LID_ALPHA; the fence cutout
              // dials its own (owner ruling B6b, 2026-08-27).
              color: new Cesium.Color(1, 1, 1, basemapLidAlpha),
            }),
          }),
          asynchronous: false,
        }),
      )
    }
  }

  // Ground-surface TIN — rendered first (painter's algorithm: drawn below
  // formation surfaces). Uses a warm-grey earth tone at 45 % alpha so
  // formation bands remain legible above it. Gated by the "Ground surface"
  // legend toggle (the flat DEM plane read as a "basemap backdrop" the user
  // couldn't switch off — dogfeed 2026-06-10).
  if (groundSurfaceVisible && groundSurface && groundSurface.triangles.length > 0) {
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

  // Fence-diagram wall panels. Rendered above the ground surface and below
  // the formation TINs (painter's algorithm: added in this order).
  // Each panel is a vertical coloured wall, double-sided so the user can
  // orbit freely. The formation TINs stay on top so the section cut reads
  // clearly through the translucent fence.
  if (fencePanels && fencePanels.length > 0) {
    for (const panel of fencePanels) {
      // Mirror the formation-TIN loop's visibility toggle — a hidden
      // formation's fence walls are skipped so the legend toggle works
      // in both Solid and Fence modes.
      if (hiddenFormationIds?.has(panel.formationId)) continue
      const baseColor = formationColorById.get(panel.formationId) ?? Cesium.Color.GRAY
      // Fence walls render at ALPHA_FRESH so they match formation-surface
      // opacity and don't appear heavier than the surrounding geology.
      const fenceColor = baseColor.withAlpha(ALPHA_FRESH)
      // Pass the split clip so a split view shows each pane only its half's
      // walls (without it the walls render whole over both panes).
      const prim = buildFencePrimitive(
        panel.vertices,
        panel.triangles,
        fenceColor,
        projectEpsg,
        clip,
      )
      if (prim) scene.primitives.add(prim)
    }
  }

  // The formation-surface TIN sheets ("solids"). Gated by the "Surfaces"
  // legend toggle so the user can drop them in Fence mode and keep only the
  // section walls (dogfeed 2026-06-10) — the fence walls above are unaffected.
  for (const formation of surfacesVisible ? formations : []) {
    // Per-formation visibility toggle (the 3D legend). A hidden
    // formation's TIN is simply not added, so the next-deeper
    // formation shows through where it would have been.
    if (hiddenFormationIds?.has(formation.id)) continue
    const surface = surfacesByFormationId.get(formation.id)
    if (!surface || surface.triangles.length === 0) continue

    const isStale = surface.is_stale === true
    const alpha = isStale ? ALPHA_STALE : ALPHA_FRESH
    const zOffset = formation.display_order * Z_OFFSET_PER_ORDER

    // The formation's pre-resolved hex colour (grey fallback when malformed).
    const baseColor = formationColorById.get(formation.id) ?? Cesium.Color.GRAY

    // Apply the per-formation z-offset to vertex elevations before building
    // the primitive so co-planar surfaces don't z-fight.
    const offsetVertices: [number, number, number][] = surface.vertices.map(
      ([x, y, z]) => [x, y, z + zOffset],
    )

    // Debt #28 follow-up (2026-05-21): true per-vertex gradient.
    // Replaces the prior two-bin (high/low) partition with a single
    // primitive carrying per-vertex RGBA — the GPU interpolates the
    // alpha across each triangle, producing a smooth fade that
    // mirrors the continuous distance-to-data signal underneath.
    //
    // When the toggle is OFF, ``showConfidenceFade=false`` → we keep
    // the old single-colour PerInstanceColor primitive path with the
    // surface's base alpha (uniform colour — fade visually disabled).
    if (showConfidenceFade) {
      const triConf = computeTriangleConfidence(surface.vertices, surface.triangles)
      const vertConf = computeVertexConfidence(surface.vertices, surface.triangles, triConf)
      const r = Math.round(baseColor.red * 255)
      const g = Math.round(baseColor.green * 255)
      const b = Math.round(baseColor.blue * 255)
      // Per-vertex RGBA (alpha = baseAlpha × confidenceMultiplier(vertConf[i])).
      const perVertexColors = new Uint8Array(surface.vertices.length * 4)
      for (let i = 0; i < surface.vertices.length; i += 1) {
        const mult = confidenceToAlphaMultiplier(vertConf[i])
        const a = Math.round(alpha * mult * 255)
        perVertexColors[i * 4 + 0] = r
        perVertexColors[i * 4 + 1] = g
        perVertexColors[i * 4 + 2] = b
        perVertexColors[i * 4 + 3] = a
      }
      // For the split (clip) path the soup loses vertex sharing —
      // pass per-source-triangle solid colour so each clipped triangle
      // renders with a consistent alpha derived from its source.
      // Within-triangle gradient is lost in split mode (acceptable;
      // the across-triangle continuity still reads as a gradient).
      let perTriangleColorsForClip: Uint8Array | undefined
      if (clip) {
        perTriangleColorsForClip = new Uint8Array(surface.triangles.length * 4)
        for (let t = 0; t < surface.triangles.length; t += 1) {
          const [va, vb, vc] = surface.triangles[t]
          const triAvgConf = (vertConf[va] + vertConf[vb] + vertConf[vc]) / 3
          const mult = confidenceToAlphaMultiplier(triAvgConf)
          const a = Math.round(alpha * mult * 255)
          perTriangleColorsForClip[t * 4 + 0] = r
          perTriangleColorsForClip[t * 4 + 1] = g
          perTriangleColorsForClip[t * 4 + 2] = b
          perTriangleColorsForClip[t * 4 + 3] = a
        }
      }
      const primitive = buildTinPrimitiveWithVertexColor(
        offsetVertices,
        surface.triangles,
        perVertexColors,
        projectEpsg,
        clip,
        perTriangleColorsForClip,
      )
      if (primitive) scene.primitives.add(primitive)
    } else {
      // Toggle off: uniform alpha, current PerInstanceColor primitive.
      const uniformColor = baseColor.clone()
      uniformColor.alpha = alpha
      const primitive = buildTinPrimitive(
        offsetVertices,
        surface.triangles,
        uniformColor,
        projectEpsg,
        clip,
      )
      if (primitive) scene.primitives.add(primitive)
    }
  }

  // Per-body closed opaque solids (lithostratigraphic Solid mode). Rendered
  // above the translucent formation-surface sheets so they occlude correctly
  // in Cesium's painter order — a solid body reads as filled rock, not a
  // ghosted overlay.  Hidden lithologies (legend toggle) skip their solids
  // so the toggle works uniformly across both surface sheets and body solids.
  //
  // Fence mode (fencePanels defined) suppresses the solids so the fence
  // curtains stand alone — otherwise the closed bodies render UNDER the fence
  // panels and there is no way to isolate the diagram. bodySolids is still
  // passed (the camera framing uses its extent), only the render is skipped.
  // Mirrors the split-clip block below, which already carries this guard.
  if (fencePanels === undefined && bodySolids && bodySolids.length > 0) {
    for (const solid of bodySolids) {
      // Skip hidden lithologies, individually hidden bodies, and empty
      // (flagged) slabs.
      if (hiddenFormationIds?.has(solid.formation_id)) continue
      if (hiddenBodyIds?.has(solid.body_id)) continue
      if (solid.triangles.length === 0) continue

      // Resolve colour: per-body override wins, fall back to the formation
      // colour resolved once above.
      const solidColor = resolveSolidColor(solid)

      // Confidence fade: when on (and we have investigation positions), fade
      // each body by horizontal distance to the nearest borehole/CPT — opaque
      // on top of data, ghosted where the model is interpolated. Per-vertex RGBA
      // via the same builder the surface fade uses (a solid is just verts+tris).
      // Skipped for wireframe (no faces) + flagged marker disks (already faded).
      const faded =
        showConfidenceFade &&
        investigationXY !== undefined &&
        investigationXY.length > 0 &&
        !bodySolidsWireframe &&
        solid.is_flagged !== true
      if (faded) {
        const r = Math.round(solidColor.red * 255)
        const g = Math.round(solidColor.green * 255)
        const b = Math.round(solidColor.blue * 255)
        const perVertexColors = new Uint8Array(solid.vertices.length * 4)
        for (let i = 0; i < solid.vertices.length; i += 1) {
          const [vx, vy] = solid.vertices[i]
          const mult = distanceAlphaMultiplier(
            nearestDistance2D(vx, vy, investigationXY),
            CONFIDENCE_FALLOFF_M,
          )
          perVertexColors[i * 4 + 0] = r
          perVertexColors[i * 4 + 1] = g
          perVertexColors[i * 4 + 2] = b
          perVertexColors[i * 4 + 3] = Math.round(mult * 255)
        }
        // Split path: per-triangle colour (the clipped soup loses vertex sharing).
        let perTriangleColorsForClip: Uint8Array | undefined
        if (clip) {
          perTriangleColorsForClip = new Uint8Array(solid.triangles.length * 4)
          for (let t = 0; t < solid.triangles.length; t += 1) {
            const [va, vb, vc] = solid.triangles[t]
            const avgMult =
              (distanceAlphaMultiplier(
                nearestDistance2D(solid.vertices[va][0], solid.vertices[va][1], investigationXY),
                CONFIDENCE_FALLOFF_M,
              ) +
                distanceAlphaMultiplier(
                  nearestDistance2D(solid.vertices[vb][0], solid.vertices[vb][1], investigationXY),
                  CONFIDENCE_FALLOFF_M,
                ) +
                distanceAlphaMultiplier(
                  nearestDistance2D(solid.vertices[vc][0], solid.vertices[vc][1], investigationXY),
                  CONFIDENCE_FALLOFF_M,
                )) /
              3
            perTriangleColorsForClip[t * 4 + 0] = r
            perTriangleColorsForClip[t * 4 + 1] = g
            perTriangleColorsForClip[t * 4 + 2] = b
            perTriangleColorsForClip[t * 4 + 3] = Math.round(avgMult * 255)
          }
        }
        const prim = buildTinPrimitiveWithVertexColor(
          solid.vertices,
          solid.triangles,
          perVertexColors,
          projectEpsg,
          clip,
          perTriangleColorsForClip,
        )
        if (prim) scene.primitives.add(prim)
      } else {
        const prim = buildSolidPrimitive(
          solid.vertices,
          solid.triangles,
          solidColor,
          projectEpsg,
          clip,
          solid.is_flagged === true,
          bodySolidsWireframe,
        )
        if (prim) scene.primitives.add(prim)
      }
    }
  }

  // Cut-face caps for body solids (Solid mode, split active, NOT fence mode).
  // Each clipped solid shows a hollow cut face without caps — these fill it
  // with the body's colour so the exposed cross-section reads as layered rock.
  //
  // The cap plane is derived from the drawn split line in projected CRS (NOT
  // the ECEF Cesium.Plane): normal = perpendicular to the line direction in
  // the horizontal plane (z-component zero), constant from the standard
  // plane equation.  This is exact because the solid vertices are stored in
  // projected coordinates and the split plane is vertical.
  //
  // Caps are rendered in BOTH viewports (they sit ON the split plane, so each
  // half's geometry is the same), mirroring how buildCapPrimitives works for
  // the geology formation caps.  Flagged solids (marker disks) are skipped —
  // they have no confirmed lateral extent and their marker geometry produces
  // misleading caps.
  if (clippingPlane && splitLine && fencePanels === undefined && bodySolids && bodySolids.length > 0) {
    // Projected-space plane: perpendicular to the split line, infinite vertical
    // extent (z-component of the normal = 0).
    const dx = splitLine.x1 - splitLine.x0
    const dy = splitLine.y1 - splitLine.y0
    const lineLen = Math.sqrt(dx * dx + dy * dy)
    if (lineLen > 1e-6) {
      // Normal = (dy, -dx, 0) / lineLen — perpendicular to the line in XY.
      const capPlane: CapPlane = {
        normal: [dy / lineLen, -dx / lineLen, 0],
        // Plane passes through (x0, y0, *): constant = -(nx * x0 + ny * y0)
        constant: -(dy / lineLen) * splitLine.x0 - (-dx / lineLen) * splitLine.y0,
      }

      for (const solid of bodySolids) {
        if (hiddenFormationIds?.has(solid.formation_id)) continue
        if (hiddenBodyIds?.has(solid.body_id)) continue
        if (solid.is_flagged === true) continue // flagged marker disks → no meaningful cap
        if (solid.triangles.length === 0) continue

        // Same colour resolution as the solid loop above.
        const capColor = resolveSolidColor(solid)

        const cap = buildSolidCapPrimitive(
          solid.vertices,
          solid.triangles,
          capColor,
          projectEpsg,
          capPlane,
        )
        if (cap) scene.primitives.add(cap)
      }
    }
  }

  // Model-footprint ring — LAST, so it draws over the lid and the surfaces.
  //
  // Deliberately NOT clipped in split view: the ring states the extent of the
  // whole model, which does not change because the user cut the scene in half.
  // Clipping it would put a ring end on the cut face, where it would read as a
  // second model boundary.
  if (footprintRing) {
    // The builder owns the too-few-points case — one guard, not two.
    const ringPrimitive = buildFootprintRingPrimitive(footprintRing, projectEpsg)
    if (ringPrimitive) scene.primitives.add(ringPrimitive)
  }
}

// Split-line draw interaction state machine
// ---------------------------------------------------------------------------

export type DrawState =
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
export function computeSplitPlane(
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
