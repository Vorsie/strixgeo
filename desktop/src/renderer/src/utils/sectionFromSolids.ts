/**
 * sectionFromSolids — Mode A ray-sampling of 3D body solids to 2D column segments.
 *
 * Given a set of watertight triangle meshes (one per litho body) and a list of
 * test locations on a cross-section, this module casts a vertical ray at each
 * test's (x, y) position and intersects it with every mesh to produce depth
 * intervals (top/base elevation pairs) for that body at that column.
 *
 * Used downstream by a section overlay to render body fill bands that are
 * geometrically consistent with the 3D solid model.
 */

// ─── Exported types ───────────────────────────────────────────────────────────

/**
 * A closed, watertight triangle mesh representing one litho body in 3D space.
 *
 * @property bodyId       - Unique identifier for the body (matches BodyOrm.id).
 * @property formationId  - Formation/lithology identifier (used for colouring).
 * @property color        - Hex colour for rendering, e.g. '#fbbf24'.
 * @property vertices     - Array of [x, y, z] vertex positions (metres / map CRS).
 * @property triangles    - Array of [i, j, k] vertex-index triples (CCW winding
 *                          is conventional but not required for this algorithm).
 */
export interface SolidMesh {
  bodyId: string
  formationId: string
  color: string
  vertices: [number, number, number][]
  triangles: [number, number, number][]
}

/**
 * A test location projected onto a cross-section.
 *
 * @property id     - Investigation identifier.
 * @property x      - Map x coordinate (same CRS as SolidMesh vertices).
 * @property y      - Map y coordinate.
 * @property alongM - Along-section distance in metres (used as the column key
 *                    in the rendered section).
 */
export interface SectionTest {
  id: string
  x: number
  y: number
  alongM: number
}

/**
 * One depth interval where a specific body is present at a test column.
 *
 * @property bodyId      - Body that occupies this interval.
 * @property formationId - Formation/lithology identifier.
 * @property color       - Hex colour for rendering.
 * @property topElev     - Elevation of the top of the interval (less negative =
 *                         shallower; metres in the same vertical CRS as the mesh).
 * @property baseElev    - Elevation of the base of the interval (more negative).
 */
export interface ColumnSegment {
  bodyId: string
  formationId: string
  color: string
  topElev: number
  baseElev: number
}

/**
 * All body segments present at one test column.
 *
 * @property testId  - The test investigation identifier.
 * @property alongM  - Along-section position (metres).
 * @property segments - Depth intervals, ordered shallowest-first (topElev DESC).
 */
export interface SolidColumn {
  testId: string
  alongM: number
  segments: ColumnSegment[]
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sample each body solid at each test position, producing column segments.
 *
 * Algorithm (Mode A — vertical ray cast):
 * 1. For every (test, mesh) pair, cast a vertical ray at (test.x, test.y).
 * 2. For each triangle in the mesh, project its 3 vertices onto the XY plane
 *    and test whether the query point lies inside (or on) the 2D triangle.
 * 3. If inside, barycentric-interpolate the z coordinate from the triangle's
 *    vertices → this is one ray-crossing elevation.
 * 4. Deduplicate crossings that are within DEDUP_EPS of each other.  This is
 *    REQUIRED because a closed manifold mesh shares edges between adjacent
 *    triangles: a point on a shared edge registers once in each neighbour,
 *    producing a duplicate z that would corrupt the even-pairing step.
 * 5. Sort crossings ascending, then pair them: (z[0],z[1]), (z[2],z[3]), …
 *    Each pair becomes one ColumnSegment (topElev = max, baseElev = min).
 * 6. Collect all segments for the column, order shallowest (topElev DESC) first.
 *
 * @param meshes  - Watertight body meshes to sample.
 * @param tests   - Test locations on the cross-section.
 * @returns       One SolidColumn per test, in the same order as `tests`.
 */
export function sampleSolidColumns(
  meshes: SolidMesh[],
  tests: SectionTest[],
): SolidColumn[] {
  return tests.map((test) => {
    const segments: ColumnSegment[] = []

    for (const mesh of meshes) {
      const crossings = collectCrossings(mesh, test.x, test.y)

      if (crossings.length === 0) {
        // Ray missed this body's footprint entirely — body absent here.
        continue
      }

      // Pair crossings into [base, top] intervals.
      // A watertight mesh always yields an even count after dedup. If the count
      // is odd (a non-manifold / open mesh, e.g. a flagged solid), the trailing
      // crossing is silently dropped — the caller must guarantee watertight
      // meshes (filter on is_flagged=false before sampling).
      for (let i = 0; i + 1 < crossings.length; i += 2) {
        const z0 = crossings[i]
        const z1 = crossings[i + 1]
        segments.push({
          bodyId: mesh.bodyId,
          formationId: mesh.formationId,
          color: mesh.color,
          topElev: Math.max(z0, z1),
          baseElev: Math.min(z0, z1),
        })
      }
    }

    // Shallowest segment first (topElev descending).
    segments.sort((a, b) => b.topElev - a.topElev)

    return { testId: test.id, alongM: test.alongM, segments }
  })
}

// ─── Private helpers ──────────────────────────────────────────────────────────

/** Epsilon for deduplicated z-crossing values (metres). */
const DEDUP_EPS = 1e-6

/** Epsilon for the zero-area guard in 2D point-in-triangle (squared metres — `area2` is 2× the signed 2D area). */
const AREA_EPS = 1e-10

/**
 * Collect all z-crossings of the vertical ray at (px, py) with the mesh.
 *
 * After collecting raw z-values from every triangle whose 2D projection
 * contains the point, we sort and deduplicate within DEDUP_EPS.  This is the
 * key robustness step: shared edges between adjacent triangles can each fire
 * when the query point sits exactly on them, duplicating the same z.  A
 * closed mesh must have an even crossing count after dedup for the pairing to
 * be correct.
 *
 * Vertical wall triangles have zero 2D area and are skipped by the zero-area
 * guard inside `pointInTriangle2D`, so they never pollute the crossing list.
 */
function collectCrossings(mesh: SolidMesh, px: number, py: number): number[] {
  const raw: number[] = []
  const { vertices, triangles } = mesh

  for (const [i, j, k] of triangles) {
    const [ax, ay, az] = vertices[i]
    const [bx, by, bz] = vertices[j]
    const [cx, cy, cz] = vertices[k]

    if (!pointInTriangle2D(px, py, ax, ay, bx, by, cx, cy)) {
      continue
    }

    raw.push(interpZ(px, py, ax, ay, az, bx, by, bz, cx, cy, cz))
  }

  if (raw.length === 0) return []

  // Sort ascending and dedup nearby values.
  raw.sort((a, b) => a - b)
  return dedupSorted(raw, DEDUP_EPS)
}

/**
 * 2D point-in-triangle test using the sign-of-cross-product method.
 *
 * Returns true when (px, py) is inside or on the boundary of the triangle
 * (ax,ay)-(bx,by)-(cx,cy).  Edge-inclusive behaviour is achieved by checking
 * that all three cross products have the same sign OR are zero.
 *
 * Zero-area guard: if the triangle's 2D area is below AREA_EPS (e.g. a
 * vertical wall whose XY projection collapses to a line), we return false.
 * Without this guard, the cross-product denominators approach zero and any
 * point would appear "inside" a degenerate sliver.
 *
 * @param px,py     - Query point.
 * @param ax,ay     - Triangle vertex A.
 * @param bx,by     - Triangle vertex B.
 * @param cx,cy     - Triangle vertex C.
 */
function pointInTriangle2D(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  cx: number,
  cy: number,
): boolean {
  // Signed area of the full triangle (2× for speed).
  const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)

  // Zero-area guard — vertical walls project to a degenerate 2D triangle.
  if (Math.abs(area2) < AREA_EPS) return false

  // Cross products for the three edge half-planes.
  const d1 = (px - bx) * (ay - by) - (ax - bx) * (py - by)
  const d2 = (px - cx) * (by - cy) - (bx - cx) * (py - cy)
  const d3 = (px - ax) * (cy - ay) - (cx - ax) * (py - ay)

  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0

  // Point is inside (or on an edge) iff all three cross products share a sign.
  return !(hasNeg && hasPos)
}

/**
 * Barycentric interpolation of z at (px, py) from the triangle's vertices.
 *
 * Computes barycentric coordinates (u, v, w) of the projection of (px, py)
 * onto the 2D triangle, then applies the same weights to the z coordinates.
 * The caller guarantees the triangle is non-degenerate in 2D (the zero-area
 * guard in pointInTriangle2D has already filtered it out).
 *
 * @param px,py         - Query point (already confirmed inside the 2D triangle).
 * @param ax,ay,az      - Vertex A.
 * @param bx,by,bz      - Vertex B.
 * @param cx,cy,cz      - Vertex C.
 */
function interpZ(
  px: number,
  py: number,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  cx: number,
  cy: number,
  cz: number,
): number {
  const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax)
  const u = ((bx - px) * (cy - py) - (by - py) * (cx - px)) / area2
  const v = ((cx - px) * (ay - py) - (cy - py) * (ax - px)) / area2
  const w = 1 - u - v
  return u * az + v * bz + w * cz
}

/**
 * Remove duplicate values from a sorted array within a given epsilon.
 *
 * Adjacent values within `eps` of each other are collapsed to their first
 * representative.  The array must already be sorted ascending.
 *
 * This is the dedup step that makes even-count pairing reliable on manifold
 * meshes where a shared edge fires twice for the same z elevation.
 *
 * @param sorted - z-values sorted ascending.
 * @param eps    - Values within this distance are considered identical.
 */
function dedupSorted(sorted: number[], eps: number): number[] {
  const result: number[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - sorted[i - 1] > eps) {
      result.push(sorted[i])
    }
  }
  return result
}
