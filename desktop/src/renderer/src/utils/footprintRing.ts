// Model footprint ring — the closed boundary that says "the model ends here".
//
// The 3-D viewer paints only where the build put material, so a project whose
// alpha hull trims ~5 % of the drawn extent shows that trim as a RAGGED HOLE:
// indistinguishable from a gap the interpretation genuinely left open. The ring
// is the structural affordance that makes the trim legible — an edge, not a
// hole (owner ballot 2026-08-26, MVP 3-D & visuals).
//
// TRUTHFULNESS is the whole point, so the polygon is NOT derived here. It comes
// from the backend, which replays the persisted build payload through the SAME
// ``build_domain_from_sections`` / ``alpha_hull_polygon`` the build itself used
// (``GET /projects/{id}/geology/models/{id}/footprint``). A hull re-derived in
// TypeScript would be a second source of truth and could draw a boundary the
// geometry does not actually have — worse than no ring at all. This module only
// turns that polygon into scene coordinates.
//
// Coordinates are PROJECTED project-CRS metres (EPSG 31370 / 28992), the same
// space as ``FormationSurfaceResponse.vertices`` and ``FencePanel.vertices``;
// the WGS84 conversion happens at render time in geology3DPrimitives.

/**
 * Vertical clearance between the ring and the top of the model, in metres.
 *
 * The ring is drawn as a line primitive; sitting it exactly ON the ground
 * surface or the topmost solid makes it z-fight and stipple as the camera
 * moves. One metre reads as "on the ground" at every camera distance the
 * viewer uses while being far outside the depth-buffer noise.
 */
export const FOOTPRINT_RING_LIFT_M = 1.0

/**
 * Turn a footprint polygon into a closed ring of 3-D scene coordinates.
 *
 * The polygon is passed through VERBATIM — same vertices, same winding, no
 * simplification or resampling — because it is the boundary the build clipped
 * to. The only edit is closure: the returned ring repeats its first vertex at
 * the end so a polyline draws a loop rather than an open chain.
 *
 * Parameters
 * ----------
 * polygon
 *     Hull vertices as ``[x_m, y_m]`` in the project CRS. The backend returns
 *     the ring WITHOUT a repeated last vertex; one that repeats it anyway is
 *     accepted and not doubled.
 * elevationM
 *     The single elevation every ring vertex sits at, in metres (positive up).
 *     See ``resolveFootprintRingElevation``.
 *
 * Returns
 * -------
 * Array of ``[x_m, y_m, elevation_m]``
 *     The closed ring, or an empty array when the polygon does not enclose an
 *     area (fewer than 3 distinct vertices). An empty result means "draw
 *     nothing": a 2-point ring would render as a stray line segment that reads
 *     as an artefact rather than a boundary.
 */
export function footprintRingPositions(
  polygon: readonly (readonly number[])[],
  elevationM: number,
): [number, number, number][] {
  const open = stripClosingVertex(polygon)
  if (open.length < 3) return []

  const ring: [number, number, number][] = open.map(([x, y]) => [x, y, elevationM])
  ring.push([...ring[0]])
  return ring
}

/**
 * Choose the elevation the footprint ring is drawn at.
 *
 * "At/near ground level" resolves to the TOP of whatever the scene actually
 * renders, lifted by ``FOOTPRINT_RING_LIFT_M``. The ring is deliberately FLAT
 * rather than draped over the terrain: a flat closed loop reads unambiguously
 * as an extent boundary, and draping would need per-vertex DEM sampling at hull
 * positions that sit outside the data cluster — exactly where a nearest-vertex
 * sample is least trustworthy. (Revisit when the DEM ground-surface module
 * lands a real sampler; a draped ring is strictly prettier if it can be
 * sampled honestly.)
 *
 * Parameters
 * ----------
 * groundVertices
 *     DEM ground-surface TIN vertices as ``[x, y, z]``. Preferred when present:
 *     it is the real terrain, so a ring above it is a ring above the ground.
 * solidVertices
 *     Body-solid vertices as ``[x, y, z]``. The fallback for the litho /
 *     geotech panes, many of whose projects have no DEM.
 *
 * Both are ``Iterable`` so a caller can stream a generator over many solids
 * instead of flattening tens of thousands of vertices into a scratch array on
 * every render.
 *
 * Returns
 * -------
 * number or null
 *     The ring elevation in metres, or ``null`` when nothing is rendered.
 *     ``null`` rather than ``0``: a model sitting at −30 m mTAW would get a
 *     ring floating in empty space well above it, which reads as a second,
 *     wrong model edge.
 */
export function resolveFootprintRingElevation(
  groundVertices: Iterable<readonly number[]>,
  solidVertices: Iterable<readonly number[]>,
): number | null {
  const groundTop = maxFiniteElevation(groundVertices)
  if (groundTop !== null) return groundTop + FOOTPRINT_RING_LIFT_M

  const solidTop = maxFiniteElevation(solidVertices)
  if (solidTop !== null) return solidTop + FOOTPRINT_RING_LIFT_M

  return null
}

/** Drop a trailing vertex that merely repeats the first one. */
function stripClosingVertex(
  polygon: readonly (readonly number[])[],
): readonly (readonly number[])[] {
  if (polygon.length < 2) return polygon
  const first = polygon[0]
  const last = polygon[polygon.length - 1]
  return first[0] === last[0] && first[1] === last[1] ? polygon.slice(0, -1) : polygon
}

/** Highest finite z across the vertices, or null when there is none. */
function maxFiniteElevation(vertices: Iterable<readonly number[]>): number | null {
  let top: number | null = null
  for (const v of vertices) {
    const z = v[2]
    // A degenerate mesh can carry a NaN vertex; Math.max would propagate it and
    // silently take the ring out of the scene.
    if (!Number.isFinite(z)) continue
    if (top === null || z > top) top = z
  }
  return top
}
