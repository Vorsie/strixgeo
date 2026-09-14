// Clip the 3-D fence wall panels by the drawn bed level — the canal cut-out for
// the fence (owner question tonight: "wordt het getekend bodempeil ook uit het
// hekwerk gesneden?" = "is the drawn bed level cut out of the fence too?").
//
// The 2-D section view already clips its partition fill along the ground+bed
// line (``sections/sectionBedClip.ts``). This does the SAME for the 3-D fence:
// where a wall panel's plan-view line crosses a bed polygon, the part of the
// wall ABOVE the bed level is removed, so the fence walls and the fence DXF stop
// at the dredged bed exactly like the section view. Outside every bed polygon
// nothing changes, and with no bed overrides the fence is byte-identical.
//
// WHY PER TRIANGLE. A fence panel is a triangle soup (``mergeFencePanels`` welds
// a whole connected body into one panel), so a panel is NOT a single planar
// polygon. But every INDIVIDUAL triangle came from ONE gap of the section
// partition, whose polygon points all sit on that gap's straight column-to-column
// plan segment — so a triangle IS plan-collinear (a vertical wall slice). That
// lets each triangle be parametrised by ``s`` = plan-distance along its own line
// and clipped in the ``(s, elevation)`` plane, where the bed cut is convex
// (a vertical strip inside the polygon, capped at the bed level). Clipping a
// convex triangle against convex half-planes (Sutherland–Hodgman) is robust and
// needs no polygon-union machinery.
//
// The panel builder has no DEM samples here (unlike the section clip, which
// reuses the section's ground+bed DEM line), so membership is tested directly:
// point-in-polygon on the panel's plan-view line, cap at the polygon's own bed
// level (owner brief). The membership test is the SHARED ``bedPolygonMembership``
// helper the section clip uses, so the fence cut and the section cut agree.

import { bedLevelAt, type BedPolygon } from './bedPolygonMembership'
import type { FencePanel } from './fencePanels'

/** Numerical tolerance for plan-line / half-plane geometry (project-CRS metres). */
const EPS = 1e-9

/**
 * Vertex-weld grid for the clipped output (1 micron).
 *
 * Coincident cut / column points are re-emitted from independent per-triangle
 * arithmetic, so they differ only by floating-point round-off (~1e-9 m). Keying
 * the dedup on a 1-micron grid fuses those to ONE index — which is what the DXF
 * fence exporter needs to hide the interior triangle edges (it counts
 * index-shared edges) — while genuinely distinct cut points (≥ 1 mm apart, the
 * section fill's snap grid) never collide. The half-micron geometric error a
 * snap introduces is negligible on a wall measured in metres, and only ever
 * touches a panel that IS being cut (an untouched panel is returned verbatim).
 */
const WELD_GRID_M = 1e-6

/** A world-space vertex ``[x_m, y_m, elevation_m]``. */
type V3 = [number, number, number]

/** A point in a triangle's own vertical plane: plan-distance + elevation. */
interface PlanePoint {
  /** Signed plan-distance along the triangle's plan line (metres). */
  s: number
  /** Elevation (metres) — unchanged by the plan parametrisation. */
  z: number
}

/**
 * Clip every fence panel by the project's bed overrides.
 *
 * Parameters
 * ----------
 * panels : readonly FencePanel[]
 *     The assembled fence walls (already merged one-per-body-per-section).
 * bedPolygons : readonly BedPolygon[]
 *     The bed-override polygons in the panels' horizontal CRS, newest-first.
 *
 * Returns
 * -------
 * FencePanel[]
 *     The clipped walls. When there are no bed overrides the input array is
 *     returned by reference (byte-identical no-op); a panel the bed never
 *     touches is returned by reference too (identity), so only the walls that
 *     actually cross a bed polygon are rebuilt.
 */
export function clipFencePanelsToBed(
  panels: readonly FencePanel[],
  bedPolygons: readonly BedPolygon[],
): FencePanel[] {
  // No bed overrides → nothing to cut anywhere. Return the SAME array so the
  // fence is byte-identical to before this feature (the load-bearing no-op).
  if (bedPolygons.length === 0) return panels as FencePanel[]
  return panels.map((panel) => clipPanel(panel, bedPolygons))
}

/**
 * Clip one panel; return the original object when the bed does not cut it.
 *
 * @param panel - One fence wall (a triangle soup).
 * @param polygons - Bed polygons in the panel's CRS.
 * @returns The same object (identity) when nothing was cut, else a new panel
 *   carrying the clipped, re-welded triangle soup.
 */
function clipPanel(panel: FencePanel, polygons: readonly BedPolygon[]): FencePanel {
  const outVerts: V3[] = []
  const outTris: [number, number, number][] = []
  const indexByCell = new Map<string, number>()

  // Weld a vertex to a shared index (1-micron grid) so the DXF interior-edge
  // hiding still sees index-shared seams after the re-triangulation.
  const pushVert = (v: V3): number => {
    const key =
      `${Math.round(v[0] / WELD_GRID_M)}|` +
      `${Math.round(v[1] / WELD_GRID_M)}|` +
      `${Math.round(v[2] / WELD_GRID_M)}`
    const hit = indexByCell.get(key)
    if (hit !== undefined) return hit
    const i = outVerts.length
    outVerts.push(v)
    indexByCell.set(key, i)
    return i
  }
  const pushTri = (t: readonly [V3, V3, V3]): void => {
    const a = pushVert(t[0])
    const b = pushVert(t[1])
    const c = pushVert(t[2])
    // Drop a triangle whose corners welded onto fewer than 3 distinct indices —
    // it has collapsed to zero area and would only ship a degenerate downstream.
    if (a !== b && b !== c && a !== c) outTris.push([a, b, c])
  }

  let changed = false
  for (const [ia, ib, ic] of panel.triangles) {
    const tri: [V3, V3, V3] = [panel.vertices[ia], panel.vertices[ib], panel.vertices[ic]]
    const clipped = clipTriangleToBed(tri, polygons)
    if (clipped === null) {
      // The bed did not cut this triangle — re-emit it verbatim.
      pushTri(tri)
      continue
    }
    changed = true
    for (const t of clipped) pushTri(t)
  }

  // No triangle was cut → the whole panel is untouched. Return the ORIGINAL
  // object so a project with a bed that misses this wall stays byte-identical.
  if (!changed) return panel
  return { ...panel, vertices: outVerts, triangles: outTris }
}

/**
 * Clip one triangle by the bed; return the output triangles, or ``null`` when
 * the bed removes nothing from it (so the caller keeps the original triangle).
 *
 * @param tri - The triangle's three world vertices (plan-collinear — a wall).
 * @param polygons - Bed polygons in the triangle's CRS.
 * @returns The re-triangulated survivors as world triangles, or ``null`` when
 *   nothing above the bed was removed (unchanged).
 */
function clipTriangleToBed(
  tri: readonly [V3, V3, V3],
  polygons: readonly BedPolygon[],
): [V3, V3, V3][] | null {
  // The triangle's plan line: anchor at vertex 0, direction toward the
  // plan-farthest vertex (the three plan points are collinear — a vertical wall).
  const p0x = tri[0][0]
  const p0y = tri[0][1]
  let fx = 0
  let fy = 0
  let far = 0
  for (const v of tri) {
    const ex = v[0] - p0x
    const ey = v[1] - p0y
    const d = Math.hypot(ex, ey)
    if (d > far) {
      far = d
      fx = ex
      fy = ey
    }
  }
  // A plan-degenerate triangle (all three plan points coincide) is a vertical
  // sliver with no plan width — there is no along-line to cut, leave it be.
  if (far < EPS) return null
  const dirx = fx / far
  const diry = fy / far
  const worldAt = (s: number, z: number): V3 => [p0x + s * dirx, p0y + s * diry, z]

  const poly: PlanePoint[] = tri.map((v) => ({
    s: (v[0] - p0x) * dirx + (v[1] - p0y) * diry,
    z: v[2],
  }))
  let sMin = Infinity
  let sMax = -Infinity
  for (const p of poly) {
    if (p.s < sMin) sMin = p.s
    if (p.s > sMax) sMax = p.s
  }

  // Split the triangle's plan span at every polygon-edge crossing, so the cap is
  // a single constant within each sub-interval (cut only inside the polygon).
  const bounds = [sMin, ...breakpoints(p0x, p0y, dirx, diry, polygons, sMin, sMax), sMax]

  const outTris: [V3, V3, V3][] = []
  let keptArea = 0
  for (let i = 0; i + 1 < bounds.length; i++) {
    const a = bounds[i]
    const b = bounds[i + 1]
    if (b - a < EPS) continue
    const smid = (a + b) / 2
    const cap = bedLevelAt(polygons, p0x + smid * dirx, p0y + smid * diry)

    // Clip to the vertical strip [a, b] (always) and, inside a polygon, to
    // z <= cap (the bed cut). Each clip is a convex half-plane, so a convex
    // input stays convex.
    let region = clipHalfPlane(poly, (p) => p.s >= a - EPS, (p, q) => atS(p, q, a))
    region = clipHalfPlane(region, (p) => p.s <= b + EPS, (p, q) => atS(p, q, b))
    if (cap !== null) {
      region = clipHalfPlane(region, (p) => p.z <= cap + EPS, (p, q) => atZ(p, q, cap))
    }
    if (region.length < 3) continue
    keptArea += Math.abs(shoelace(region))
    // Fan-triangulate the convex survivor.
    for (let k = 1; k + 1 < region.length; k++) {
      outTris.push([
        worldAt(region[0].s, region[0].z),
        worldAt(region[k].s, region[k].z),
        worldAt(region[k + 1].s, region[k + 1].z),
      ])
    }
  }

  const origArea = Math.abs(shoelace(poly))
  // Nothing above the bed was removed (kept area == original) → the triangle is
  // unchanged; keep the original geometry rather than a re-triangulated copy.
  if (origArea - keptArea <= origArea * 1e-9 + EPS) return null
  return outTris
}

/**
 * Plan-distances ``s`` at which the triangle's plan line crosses a polygon edge,
 * strictly inside ``(sMin, sMax)``, sorted and de-duplicated.
 */
function breakpoints(
  p0x: number,
  p0y: number,
  dirx: number,
  diry: number,
  polygons: readonly BedPolygon[],
  sMin: number,
  sMax: number,
): number[] {
  const out: number[] = []
  for (const poly of polygons) {
    const vs = poly.vertices
    const n = vs.length
    if (n < 3) continue
    for (let i = 0; i < n; i++) {
      const [ax, ay] = vs[i]
      const [bx, by] = vs[(i + 1) % n]
      const ex = bx - ax
      const ey = by - ay
      // Solve p0 + s*dir = A + t*(B-A). det = e.x*d.y - d.x*e.y.
      const det = ex * diry - dirx * ey
      if (Math.abs(det) < EPS) continue // parallel — no single crossing
      const rx = ax - p0x
      const ry = ay - p0y
      const s = (-rx * ey + ex * ry) / det
      const t = (dirx * ry - diry * rx) / det
      if (t < -EPS || t > 1 + EPS) continue // crossing is off the edge segment
      if (s > sMin + EPS && s < sMax - EPS) out.push(s)
    }
  }
  out.sort((x, y) => x - y)
  const uniq: number[] = []
  for (const s of out) {
    if (uniq.length === 0 || s - uniq[uniq.length - 1] > 1e-6) uniq.push(s)
  }
  return uniq
}

/**
 * Sutherland–Hodgman clip of a convex polygon against one half-plane.
 *
 * @param poly - The polygon points in order.
 * @param inside - True when a point is on the kept side of the boundary.
 * @param intersect - The boundary crossing point of edge ``a→b``.
 * @returns The clipped polygon (may be empty).
 */
function clipHalfPlane(
  poly: readonly PlanePoint[],
  inside: (p: PlanePoint) => boolean,
  intersect: (a: PlanePoint, b: PlanePoint) => PlanePoint,
): PlanePoint[] {
  const n = poly.length
  if (n === 0) return []
  const out: PlanePoint[] = []
  for (let i = 0; i < n; i++) {
    const cur = poly[i]
    const prev = poly[(i + n - 1) % n]
    const curIn = inside(cur)
    const prevIn = inside(prev)
    if (curIn) {
      if (!prevIn) out.push(intersect(prev, cur))
      out.push(cur)
    } else if (prevIn) {
      out.push(intersect(prev, cur))
    }
  }
  return out
}

/** Crossing point of edge ``a→b`` at plan-distance ``sB``. */
function atS(a: PlanePoint, b: PlanePoint, sB: number): PlanePoint {
  const ds = b.s - a.s
  const u = Math.abs(ds) < EPS ? 0 : (sB - a.s) / ds
  return { s: sB, z: a.z + u * (b.z - a.z) }
}

/** Crossing point of edge ``a→b`` at elevation ``zB``. */
function atZ(a: PlanePoint, b: PlanePoint, zB: number): PlanePoint {
  const dz = b.z - a.z
  const u = Math.abs(dz) < EPS ? 0 : (zB - a.z) / dz
  return { s: a.s + u * (b.s - a.s), z: zB }
}

/** Signed area of a polygon in the ``(s, z)`` plane (shoelace). */
function shoelace(poly: readonly PlanePoint[]): number {
  let area = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % n]
    area += p.s * q.z - q.s * p.z
  }
  return area / 2
}
