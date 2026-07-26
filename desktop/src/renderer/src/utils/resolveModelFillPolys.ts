/**
 * resolveModelFillPolys — renderer-side slice-resolution stage for the litho
 * "model fill" overlay (ModelFillOverlay Mode B).
 *
 * ``sliceSolidsAtPlane`` emits one ``SectionPoly`` per body per closed loop with
 * NO cross-body clipping — the 3D bodies it slices are supposed to be mutually
 * exclusive but, on real voxel-built solids, they are not: different-formation
 * slices OVERLAP (measured: 25/76/33/24 double-covered samples on four real
 * section lines; a 1 cm probe found 227 double-covered samples, max coverage 3).
 * When the overlay ``.map``s those polys to ``<path>`` in array order, later
 * paint over earlier: a thin KLEI (clay) block gets buried under a broad ZAND
 * (sand) slab, and two translucent fills stack to a darker patch.
 *
 * This module resolves the raw polys into DETERMINISTIC, NON-OVERLAPPING visible
 * polygons — for any interior point, coverage <= 1 — using robust polygon
 * boolean ops (jsts, JTS-derived) rather than a hand-rolled subtraction.
 *
 * Ownership policy (documented, geometry-derived, order-INDEPENDENT):
 *   thinner body on top.  Priority = SMALLER vertical extent (maxElev - minElev
 *   of the poly).  The thinner body is visible; the thicker host is clipped
 *   behind it.  Tiebreak deterministically: smaller polygon area, then bodyId
 *   lexical.  This keeps a thin clay/silt minority visible over a broad
 *   sand/silt host (the "clay behind sand" symptom the bug describes) and does
 *   NOT depend on array / DB / mesh order, so the render is stable frame to
 *   frame.
 *
 * Algorithm: process polys highest-priority (thinnest) first, accumulating a
 * jsts "claimed" geometry.  For each poly the visible remainder is
 * ``difference(poly, claimed)``; a non-empty remainder is emitted (a difference
 * can split into a MultiPolygon → several output SectionPolys, all keeping the
 * source poly's bodyId / formationId / color), then ``claimed`` grows by
 * ``union(claimed, poly)``.  Faces are disjoint by construction; uncovered area
 * is never filled and disconnected bodies are never bridged.
 *
 * HOLES ARE PRESERVED.  When a thin higher-priority body is FULLY ENCLOSED inside
 * a lower-priority one (a KLEI clay lens inside a ZAND sand slab — the common real
 * case), ``difference`` returns a POLYGON WITH A HOLE (a donut).  The emitted
 * SectionPoly carries that interior ring in ``holes`` so the overlay can punch it
 * out (``fill-rule: evenodd``) and the enclosed body shows through.  Dropping the
 * hole would re-emit the lower-priority body as a SOLID that re-covers the
 * enclosed body → the overlap returns.
 */

// side-effect import: patches overlay ops (.difference/.union/.getArea/…) onto
// Geometry.prototype. jsts 2.x ships these as monkey-patches applied by the full
// package entry; importing the deep ESM class files alone does NOT bring them.
import 'jsts/org/locationtech/jts/monkey.js'
// jsts resolves types via its ``typesVersions`` map even on the deep ESM path,
// but the geometry API is still used through the minimal local shape below.
import GeometryFactory from 'jsts/org/locationtech/jts/geom/GeometryFactory.js'
import Coordinate from 'jsts/org/locationtech/jts/geom/Coordinate.js'
import PrecisionModel from 'jsts/org/locationtech/jts/geom/PrecisionModel.js'

import type { SectionPoly } from './sectionFromSolids'

// ── Tolerance ──────────────────────────────────────────────────────────────────

/**
 * Single tolerance constant (metres) for the whole resolution stage.
 *
 * Used for: the jsts snapping precision model (coordinates are rounded to this
 * grid before every boolean op, killing float-noise slivers), the
 * ``buffer(0)`` cleaning radius that drops degenerate slivers from the boolean
 * output, and the minimum-area guard that discards resolution crumbs.  One
 * value, used consistently, so there is no epsilon cascade.
 *
 * 1e-4 m (0.1 mm) is far below any real geometry resolution (voxels are metres,
 * elevations are decimetre-scale) yet above IEEE double noise.
 */
export const RESOLVE_TOLERANCE_M = 1e-4

/** Areas below this (m² in alongM×elev space) are resolution crumbs — dropped. */
const MIN_VISIBLE_AREA = RESOLVE_TOLERANCE_M * RESOLVE_TOLERANCE_M

// A fixed-precision model snaps coordinates to the tolerance grid before boolean
// ops — the JTS-recommended way to make overlay robust against near-duplicate
// vertices from the mesh slicer.
const PRECISION = new PrecisionModel(1 / RESOLVE_TOLERANCE_M)
const GF = new GeometryFactory(PRECISION)

// ── Minimal jsts geometry typing ───────────────────────────────────────────────

/**
 * The slice of the jsts Geometry API this module touches.  jsts ships no types
 * on the deep ESM import path, so we describe only what we use.
 */
interface JstsRing {
  getCoordinates(): { x: number; y: number }[]
}

interface JstsGeometry {
  getArea(): number
  isEmpty(): boolean
  isValid(): boolean
  difference(other: JstsGeometry): JstsGeometry
  union(other: JstsGeometry): JstsGeometry
  buffer(distance: number): JstsGeometry
  getNumGeometries(): number
  getGeometryN(n: number): JstsGeometry
  getGeometryType(): string
  getExteriorRing?(): JstsRing
  getNumInteriorRing?(): number
  getInteriorRingN?(n: number): JstsRing
  getCoordinates(): { x: number; y: number }[]
}

// ── Priority ────────────────────────────────────────────────────────────────────

/**
 * A raw SectionPoly plus its geometry-derived ownership priority.
 *
 * @property poly     - The source polygon (carries bodyId / formationId / color).
 * @property thickness - Vertical extent (maxElev - minElev); SMALLER = thinner =
 *                       higher priority (drawn on top).
 * @property area     - Polygon area in (alongM, elev) space; the first tiebreak.
 */
interface RankedPoly {
  poly: SectionPoly
  thickness: number
  area: number
}

/** Vertical extent (thickness) of a poly in elevation metres. */
function verticalExtent(poly: SectionPoly): number {
  let min = Infinity
  let max = -Infinity
  for (const p of poly.points) {
    if (p.elev < min) min = p.elev
    if (p.elev > max) max = p.elev
  }
  return max - min
}

/** Shoelace area (absolute) of a ring of (alongM, elev) points. */
function ringAreaPoints(pts: { alongM: number; elev: number }[]): number {
  let acc = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    acc += pts[j].alongM * pts[i].elev - pts[i].alongM * pts[j].elev
  }
  return Math.abs(acc) / 2
}

/** Shoelace area (absolute) of a poly's outer ring in (alongM, elev) space. */
function ringArea(poly: SectionPoly): number {
  return ringAreaPoints(poly.points)
}

/**
 * Total ordering: thinner first (higher priority), then smaller area, then
 * bodyId lexical.  Deterministic and independent of input array order.
 */
function comparePriority(a: RankedPoly, b: RankedPoly): number {
  if (a.thickness !== b.thickness) return a.thickness - b.thickness
  if (a.area !== b.area) return a.area - b.area
  return a.poly.bodyId < b.poly.bodyId ? -1 : a.poly.bodyId > b.poly.bodyId ? 1 : 0
}

// ── jsts <-> SectionPoly conversion ─────────────────────────────────────────────

/**
 * Build a cleaned jsts Polygon from a SectionPoly ring (x = alongM, y = elev).
 *
 * The ring is explicitly closed (first coordinate repeated).  ``buffer(0)`` on
 * the result fixes minor self-touching / winding issues from the mesh slicer and
 * returns a valid geometry the overlay ops can trust.  Returns ``null`` for a
 * degenerate ring (< 3 distinct points or ~zero area after cleaning).
 */
function toJsts(poly: SectionPoly): JstsGeometry | null {
  if (poly.points.length < 3) return null
  const coords = poly.points.map((p) => new Coordinate(p.alongM, p.elev))
  // Close the ring for jsts (LinearRing requires first == last).
  coords.push(new Coordinate(poly.points[0].alongM, poly.points[0].elev))
  let ring
  try {
    ring = GF.createLinearRing(coords)
  } catch {
    // A ring that collapses under the precision model (all points snap together)
    // throws — treat as degenerate.
    return null
  }
  const g = GF.createPolygon(ring, []) as JstsGeometry
  // buffer(0) cleans self-touching rings and normalises winding.
  const cleaned = g.buffer(0)
  if (cleaned.isEmpty() || cleaned.getArea() < MIN_VISIBLE_AREA) return null
  return cleaned
}

/**
 * Convert a jsts ring's coordinates to a SectionPoly ring (alongM, elev),
 * dropping the duplicated closing coordinate jsts appends.  Returns ``null`` for
 * a degenerate ring (< 3 distinct vertices).
 */
function ringToPoints(ring: JstsRing): { alongM: number; elev: number }[] | null {
  const coords = ring.getCoordinates()
  const points: { alongM: number; elev: number }[] = []
  // Drop the duplicated closing coordinate jsts appends.
  for (let k = 0; k < coords.length - 1; k++) {
    points.push({ alongM: coords[k].x, elev: coords[k].y })
  }
  return points.length < 3 ? null : points
}

/**
 * Convert a jsts geometry (Polygon or MultiPolygon) back to one-or-more
 * SectionPolys carrying the source poly's identity.
 *
 * Interior rings (HOLES) are PRESERVED, not dropped: when a lower-priority body
 * fully ENCLOSES a higher-priority one (a KLEI clay lens inside a ZAND sand
 * slab), ``difference(loPoly, claimed)`` returns a POLYGON WITH A HOLE (a donut).
 * Dropping the hole would re-emit the lower-priority body as a SOLID that
 * re-covers the enclosed body → the overlap returns.  Each output SectionPoly
 * therefore carries its exterior ring as ``points`` and every interior ring as a
 * ``holes`` entry (rendered with ``fill-rule: evenodd`` so the enclosed body
 * shows through).  Sub-areas / sub-rings below MIN_VISIBLE_AREA are skipped as
 * resolution crumbs.
 */
function fromJsts(g: JstsGeometry, source: SectionPoly): SectionPoly[] {
  const out: SectionPoly[] = []
  const n = g.getNumGeometries()
  for (let i = 0; i < n; i++) {
    const part = g.getGeometryN(i)
    if (part.isEmpty() || part.getArea() < MIN_VISIBLE_AREA) continue
    // Exterior ring → the filled band outline.
    const ext = part.getExteriorRing ? part.getExteriorRing() : part
    const points = ringToPoints(ext)
    if (points === null) continue

    // Interior rings → transparent holes so an enclosed higher-priority body
    // shows through.  A geometry with no interior-ring accessor (e.g. a raw
    // LineString from a degenerate op) simply contributes no holes.
    const holes: { alongM: number; elev: number }[][] = []
    const numHoles =
      part.getNumInteriorRing && part.getInteriorRingN ? part.getNumInteriorRing() : 0
    for (let h = 0; h < numHoles; h++) {
      const innerRing = part.getInteriorRingN!(h)
      const holePts = ringToPoints(innerRing)
      if (holePts === null) continue
      // Drop sub-tolerance holes (resolution crumbs) via the ring's shoelace
      // area, so a float-noise sliver never punches a spurious transparent gap.
      if (ringAreaPoints(holePts) < MIN_VISIBLE_AREA) continue
      holes.push(holePts)
    }

    out.push({
      bodyId: source.bodyId,
      formationId: source.formationId,
      color: source.color,
      points,
      ...(holes.length > 0 ? { holes } : {}),
    })
  }
  return out
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Resolve raw plane-slice polygons into deterministic, non-overlapping visible
 * polygons for the model-fill overlay.
 *
 * Guarantees on the output:
 * - For any interior point, coverage <= 1 (no different-body overlap, no same-
 *   body double paint) — kills the "clay behind sand" occlusion and the
 *   translucent-opacity-stacking artifact.
 * - Ownership is geometry-derived (thinner body on top) and independent of the
 *   input array order — the render is stable frame to frame.
 * - Uncovered area is never filled; disconnected bodies are never bridged.  A
 *   body whose visible remainder splits into several pieces yields several
 *   output polys (all sharing its identity).
 *
 * @param polys - Raw ``SectionPoly[]`` from ``sliceSolidsAtPlaneRobust``.
 * @returns     Disjoint visible ``SectionPoly[]``; the highest-priority body's
 *              geometry is intact, lower-priority bodies clipped to what remains.
 */
export function resolveModelFillPolys(polys: readonly SectionPoly[]): SectionPoly[] {
  if (polys.length === 0) return []

  // Rank by geometry-derived priority (order-independent).
  const ranked: RankedPoly[] = polys.map((poly) => ({
    poly,
    thickness: verticalExtent(poly),
    area: ringArea(poly),
  }))
  ranked.sort(comparePriority)

  const result: SectionPoly[] = []
  // ``claimed`` is the union of everything already emitted (higher priority).
  let claimed: JstsGeometry | null = null

  for (const { poly } of ranked) {
    const g = toJsts(poly)
    if (g === null) continue

    // Visible part = this poly minus everything claimed by thinner bodies above.
    let visible: JstsGeometry
    if (claimed === null) {
      visible = g
    } else {
      visible = g.difference(claimed)
      if (visible.isEmpty() || visible.getArea() < MIN_VISIBLE_AREA) {
        // Fully occluded — still grow the claimed region so a later, thicker
        // body that overlaps THIS one is clipped consistently.
        claimed = claimed.union(g)
        continue
      }
    }

    result.push(...fromJsts(visible, poly))

    // Grow the claimed region by the FULL poly (not just its visible part) so a
    // subsequent lower-priority body is clipped against everything above it.
    claimed = claimed === null ? g : claimed.union(g)
  }

  return result
}
