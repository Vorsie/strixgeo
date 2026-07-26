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

// ─── Mode B types ─────────────────────────────────────────────────────────────

/**
 * A 2D section line in map XY space, defined by two endpoints.
 *
 * The line extends infinitely in both directions for the purpose of the plane
 * test; the endpoints only fix the direction and the along-section origin.
 *
 * @property ax - X coordinate of the first endpoint (map CRS, metres).
 * @property ay - Y coordinate of the first endpoint.
 * @property bx - X coordinate of the second endpoint.
 * @property by - Y coordinate of the second endpoint.
 */
export interface SectionPlaneLine {
  ax: number
  ay: number
  bx: number
  by: number
}

/**
 * A closed polygon produced by slicing one body solid with the section plane.
 *
 * The ring is ordered (though winding is not guaranteed); the consumer should
 * close it by connecting the last point back to the first. Winding depends on
 * the triangle order in the input mesh, so the renderer must use
 * `fill-rule: nonzero` (or normalise winding) for correct fill on any concave
 * slice; for the watertight convex bodies we produce, a simple filled path is
 * sufficient.
 *
 * @property bodyId      - Body that this polygon belongs to.
 * @property formationId - Formation/lithology identifier.
 * @property color       - Hex colour for rendering.
 * @property points      - Ordered ring of (alongM, elev) pairs.  `alongM` is
 *                         the signed distance along the section line from the
 *                         first endpoint `a` (metres); `elev` is the map-CRS
 *                         vertical coordinate (metres, negative underground).
 * @property holes        - Optional inner rings (each an ordered ring of
 *                         (alongM, elev) pairs) that are NOT filled — an enclosed
 *                         higher-priority body shows through here.  Absent/empty
 *                         = a solid band with no holes.  The raw slicer
 *                         ({@link sliceSolidsAtPlane}) never sets holes; they are
 *                         introduced only by the resolution stage
 *                         (``resolveModelFillPolys``) when a lower-priority body
 *                         encloses a higher-priority one (clay lens in a sand
 *                         slab → sand emitted as a donut).
 */
export interface SectionPoly {
  bodyId: string
  formationId: string
  color: string
  points: { alongM: number; elev: number }[]
  holes?: { alongM: number; elev: number }[][]
}

// ─── Public API — Mode B ──────────────────────────────────────────────────────

/**
 * Slice each body solid with the vertical plane through the 2D section line,
 * producing one filled closed polygon per body that the plane intersects.
 *
 * Algorithm (Mode B — plane slice):
 * 1. Define the vertical plane as the locus of all 3D points whose XY
 *    projection lies on the infinite line through `a` with direction
 *    `d = (bx-ax, by-ay)`.  A vertex's signed perpendicular distance to this
 *    line is given by the 2D cross product:
 *      side(v) = d.x * (v.y - a.y) - d.y * (v.x - a.x)
 *    Positive = left of the line, negative = right.  The plane contains exactly
 *    the points where side = 0.
 * 2. For each triangle, check each of the 3 edges.  An edge crosses the plane
 *    iff its two endpoint `side` values have opposite (non-zero) signs.
 *    Interpolate the exact 3D crossing point:
 *      t = side(p0) / (side(p0) - side(p1));  cross = p0 + t*(p1 - p0)
 * 3. Project each crossing (x,y) onto the line direction to get `alongM`:
 *      alongM = dot(cross.xy - a, dHat)   where dHat = d / |d|
 *    Keep the z-coordinate as `elev`.  Each triangle cut by the plane yields
 *    exactly 2 crossing points → one cut segment.
 * 4. Chain the cut segments for the mesh into ordered closed rings.  A
 *    watertight manifold sliced by a plane produces a set of segments that
 *    form one or more closed loops; `chainLoops` extracts EVERY loop (a body
 *    that pinches out and reappears slices into >1 loop), following each by
 *    repeatedly matching the next segment's endpoint to the current tail
 *    (within SLICE_EPS).
 * 5. Output each ring as a `SectionPoly.points`.  The closing edge is
 *    implicit (consumer connects last → first).
 *
 * @param meshes  - Watertight body meshes to slice.
 * @param line    - The 2D section line defining the vertical cutting plane.
 * @returns       One SectionPoly per closed loop produced by the slice — a body
 *                may contribute MORE THAN ONE poly (all sharing its bodyId) when
 *                the plane cuts it into disjoint pieces.  Bodies the plane misses
 *                entirely are omitted.
 */
export function sliceSolidsAtPlane(
  meshes: SolidMesh[],
  line: SectionPlaneLine,
): SectionPoly[] {
  const { ax, ay, bx, by } = line
  const dx = bx - ax
  const dy = by - ay
  const len = Math.sqrt(dx * dx + dy * dy)

  // Guard against a zero-length line (degenerate section).
  if (len < SLICE_EPS) return []

  const dHatX = dx / len
  const dHatY = dy / len

  const result: SectionPoly[] = []

  for (const mesh of meshes) {
    const segments = collectCutSegments(mesh, ax, ay, dx, dy, dHatX, dHatY)

    if (segments.length === 0) continue

    // A body can be sliced into MORE THAN ONE closed loop (it pinches out and
    // reappears — interfingering / a lens, common with voxel bodies). Emit one
    // SectionPoly per loop; chaining only the first would silently drop the rest.
    for (const ring of chainLoops(segments)) {
      if (ring.length < 3) continue
      result.push({
        bodyId: mesh.bodyId,
        formationId: mesh.formationId,
        color: mesh.color,
        points: ring,
      })
    }
  }

  return result
}

/**
 * Perpendicular offset (metres) applied to the section line before slicing, so a
 * plane exactly aligned to voxel/mesh faces never lands ON a mesh vertex/edge.
 *
 * WHY this exists (exact-plane P0): ``collectCutSegments`` only registers an edge
 * crossing when its two endpoints have STRICTLY opposite plane-side signs.  At a
 * 2 m voxel grid, a real section line frequently coincides with a body's front
 * wall or a face — every vertex there has side == 0, so no strict sign change
 * fires and the WHOLE body vanishes (measured: an exactly-aligned plane returned
 * 0 polygons; a 1 cm parallel offset returned 312).  Nudging the line
 * perpendicular by a fixed sub-mm epsilon converts every on-plane vertex into an
 * unambiguous positive/negative endpoint, so a face-aligned plane produces the
 * same normalised visible section as a tiny parallel offset — no duplicate
 * polygons, no double-counted shared boundaries.
 *
 * 0.2 mm is well below any real geometry resolution (voxels are metres) yet far
 * above SLICE_EPS (1e-6 m), so the nudge is always decisive.
 */
const PLANE_PERPENDICULAR_EPS = 2e-4

/**
 * Slice body solids with a section plane that is robust to face-aligned lines.
 *
 * Identical to {@link sliceSolidsAtPlane} except the cutting line is first
 * nudged perpendicular by {@link PLANE_PERPENDICULAR_EPS}.  This is the variant
 * the renderer MUST use for the model-fill overlay: at a metre-scale voxel grid
 * a real section line routinely coincides with mesh faces, and the strict
 * opposite-sign edge test in {@link sliceSolidsAtPlane} silently drops
 * plane-coincident vertices/edges — making whole bodies disappear.  A fixed
 * sub-mm perpendicular epsilon guarantees no vertex lands exactly on the plane,
 * so a face-aligned plane yields the same result as a tiny parallel offset.
 *
 * The raw {@link sliceSolidsAtPlane} is kept as-is for diagnostics (the
 * throwaway overlap diag test slices raw solids directly), so this wrapper does
 * not change the raw function's behaviour.
 *
 * @param meshes - Watertight body meshes to slice.
 * @param line   - The 2D section line defining the vertical cutting plane.
 * @returns      One SectionPoly per closed loop (see {@link sliceSolidsAtPlane}).
 */
export function sliceSolidsAtPlaneRobust(
  meshes: SolidMesh[],
  line: SectionPlaneLine,
): SectionPoly[] {
  const { ax, ay, bx, by } = line
  const dx = bx - ax
  const dy = by - ay
  const len = Math.sqrt(dx * dx + dy * dy)

  // Degenerate line — defer to the raw slicer's own zero-length guard.
  if (len < SLICE_EPS) return sliceSolidsAtPlane(meshes, line)

  // Unit perpendicular to the line direction: (-dy, dx) / |d|.
  const nx = -dy / len
  const ny = dx / len

  // Shift BOTH endpoints by the same perpendicular epsilon → the line is
  // translated (not rotated), so alongM projection origin/scale are preserved;
  // only the perpendicular offset (which classification depends on) changes.
  const nudged: SectionPlaneLine = {
    ax: ax + nx * PLANE_PERPENDICULAR_EPS,
    ay: ay + ny * PLANE_PERPENDICULAR_EPS,
    bx: bx + nx * PLANE_PERPENDICULAR_EPS,
    by: by + ny * PLANE_PERPENDICULAR_EPS,
  }

  return sliceSolidsAtPlane(meshes, nudged)
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

// ─── Mode B private helpers ───────────────────────────────────────────────────

/**
 * Epsilon for plane-side sign tests and endpoint-matching in mode B (metres).
 *
 * Kept separate from DEDUP_EPS because the two tolerances serve different
 * geometry: DEDUP_EPS is a z-only value for ray crossings; SLICE_EPS is used
 * in XY for side-distance classification and in the (alongM, elev) 2D space
 * for segment-endpoint matching.
 */
const SLICE_EPS = 1e-6

/** A single cut segment produced by a triangle intersecting the section plane. */
interface CutSegment {
  p0: { alongM: number; elev: number }
  p1: { alongM: number; elev: number }
}

/**
 * Compute the signed perpendicular distance of a 3D vertex from the section
 * line in XY.
 *
 * The sign convention follows the 2D cross product of the line direction d with
 * the vector from the line origin a to the vertex:
 *   side = dx*(vy - ay) - dy*(vx - ax)
 * Positive = left of the line, negative = right, zero = on the line.
 *
 * Using the cross product (not the dot product) ensures we measure perpendicular
 * distance, not along-line distance, so vertices anywhere along the section are
 * classified correctly.
 *
 * @param vx,vy - Vertex XY coordinates.
 * @param ax,ay - Line origin (endpoint A of the section line).
 * @param dx,dy - Line direction vector (bx-ax, by-ay); need NOT be unit length.
 */
function planeSide(
  vx: number,
  vy: number,
  ax: number,
  ay: number,
  dx: number,
  dy: number,
): number {
  return dx * (vy - ay) - dy * (vx - ax)
}

/**
 * Collect all cut segments produced by intersecting `mesh` with the vertical
 * plane through the section line.
 *
 * For each triangle, we compute each vertex's signed side value.  An edge
 * crosses the plane iff its two vertices have strictly opposite signs (one
 * positive, one negative).  Vertices exactly on the plane (|side| < SLICE_EPS)
 * are treated as zero to avoid double-counting on shared edges: we only register
 * a crossing when one endpoint is unambiguously positive and the other is
 * unambiguously negative.
 *
 * A triangle crossing the plane yields exactly 2 edge crossings → one segment.
 *
 * @param mesh       - Watertight body mesh.
 * @param ax,ay      - Line origin (endpoint A).
 * @param dx,dy      - Line direction vector (un-normalised).
 * @param dHatX,dHatY - Unit line direction (for along-section projection).
 */
function collectCutSegments(
  mesh: SolidMesh,
  ax: number,
  ay: number,
  dx: number,
  dy: number,
  dHatX: number,
  dHatY: number,
): CutSegment[] {
  const segments: CutSegment[] = []
  const { vertices, triangles } = mesh

  for (const [i, j, k] of triangles) {
    const [vax, vay, vaz] = vertices[i]
    const [vbx, vby, vbz] = vertices[j]
    const [vcx, vcy, vcz] = vertices[k]

    const sa = planeSide(vax, vay, ax, ay, dx, dy)
    const sb = planeSide(vbx, vby, ax, ay, dx, dy)
    const sc = planeSide(vcx, vcy, ax, ay, dx, dy)

    // Snap near-zero side values to exactly 0 so edge-classification is clean.
    const sA = Math.abs(sa) < SLICE_EPS ? 0 : sa
    const sB = Math.abs(sb) < SLICE_EPS ? 0 : sb
    const sC = Math.abs(sc) < SLICE_EPS ? 0 : sc

    // Collect the two crossing points for this triangle (if any).
    const crossings: { alongM: number; elev: number }[] = []

    // Helper: interpolate a crossing on edge (p0 → p1) if signs differ strictly.
    const tryEdge = (
      x0: number,
      y0: number,
      z0: number,
      x1: number,
      y1: number,
      z1: number,
      s0: number,
      s1: number,
    ) => {
      // Strict sign change: one positive, one negative (zero counts as neither).
      if (!((s0 > 0 && s1 < 0) || (s0 < 0 && s1 > 0))) return
      // Linear interpolation parameter t ∈ (0, 1) for the crossing point.
      const t = s0 / (s0 - s1)
      const cx = x0 + t * (x1 - x0)
      const cy = y0 + t * (y1 - y0)
      const cz = z0 + t * (z1 - z0)
      // Project the XY crossing position onto the section line to get alongM.
      const alongM = dHatX * (cx - ax) + dHatY * (cy - ay)
      crossings.push({ alongM, elev: cz })
    }

    tryEdge(vax, vay, vaz, vbx, vby, vbz, sA, sB) // edge A→B
    tryEdge(vbx, vby, vbz, vcx, vcy, vcz, sB, sC) // edge B→C
    tryEdge(vcx, vcy, vcz, vax, vay, vaz, sC, sA) // edge C→A

    if (crossings.length === 2) {
      segments.push({ p0: crossings[0], p1: crossings[1] })
    }
    // Triangles yielding 0 or 1 crossings are degenerate / tangent — skip.
  }

  return segments
}

/**
 * Chain an unordered set of cut segments into ALL their ordered closed rings.
 *
 * A watertight manifold sliced by a plane produces a set of line segments whose
 * endpoints form one or more closed loops (more than one when the body pinches
 * out and reappears — interfingering / a lens).  We extract one loop at a time:
 * start from the next remaining segment and repeatedly append the segment whose
 * endpoint matches the current tail (within SLICE_EPS in both alongM and elev),
 * closing the ring; then begin a fresh ring from whatever segments remain, until
 * the pool is empty.  Each ring's closing edge is implicit (consumer connects
 * last → first).
 *
 * Robustness notes:
 * - Each segment can be traversed in either direction (p0→p1 or p1→p0); we
 *   try both when looking for a match.
 * - Each ring's inner iteration is capped at the remaining pool size to prevent
 *   an infinite loop on non-manifold input.
 * - Once a segment is consumed it is removed from the pool so it can never be
 *   visited twice — which also guarantees the outer loop terminates.
 *
 * @param segments - Unordered cut segments from `collectCutSegments`.
 * @returns        One ordered ring of (alongM, elev) vertices per closed loop
 *                 (no duplicate close); empty array when there are no segments.
 */
function chainLoops(
  segments: CutSegment[],
): { alongM: number; elev: number }[][] {
  if (segments.length === 0) return []

  // Work on a mutable copy so we can splice-out consumed segments. We extract
  // ONE closed loop at a time and keep going until the pool is empty, so a body
  // sliced into several disjoint loops yields every loop (not just the first).
  const pool = [...segments]
  const loops: { alongM: number; elev: number }[][] = []

  while (pool.length > 0) {
    // Start a fresh ring from the next remaining segment's p0 → p1.
    const first = pool.splice(0, 1)[0]
    const ring: { alongM: number; elev: number }[] = [first.p0, first.p1]
    let tail = first.p1

    // Build this ring by greedily appending the segment whose nearer endpoint
    // matches the current tail. Bounded by the remaining pool size.
    const maxIter = pool.length
    for (let iter = 0; iter < maxIter && pool.length > 0; iter++) {
      let found = false
      for (let s = 0; s < pool.length; s++) {
        const seg = pool[s]
        // Try matching tail → seg.p0 (forward traversal).
        if (
          Math.abs(tail.alongM - seg.p0.alongM) < SLICE_EPS &&
          Math.abs(tail.elev - seg.p0.elev) < SLICE_EPS
        ) {
          ring.push(seg.p1)
          tail = seg.p1
          pool.splice(s, 1)
          found = true
          break
        }
        // Try matching tail → seg.p1 (reverse traversal).
        if (
          Math.abs(tail.alongM - seg.p1.alongM) < SLICE_EPS &&
          Math.abs(tail.elev - seg.p1.elev) < SLICE_EPS
        ) {
          ring.push(seg.p0)
          tail = seg.p0
          pool.splice(s, 1)
          found = true
          break
        }
      }
      // Stop this ring if it is already closed (tail matches the first vertex)
      // or if no matching segment was found (open / non-manifold remainder).
      if (!found) break
      if (
        Math.abs(tail.alongM - ring[0].alongM) < SLICE_EPS &&
        Math.abs(tail.elev - ring[0].elev) < SLICE_EPS
      ) {
        // Remove the duplicate closing vertex — the ring is already complete.
        ring.pop()
        break
      }
    }

    loops.push(ring)
  }

  return loops
}
