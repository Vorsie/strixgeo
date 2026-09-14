/**
 * Bed-override polygon membership — the shared plan-view test (owner ruling
 * 2026-09-07 — the canal cut-out).
 *
 * A bed override is a polygon drawn on the map with one constant dredged bed
 * elevation. Inside the ring the ground takes that level instead of the DEM.
 * Two render-layer consumers ask the SAME question — "is this map point inside a
 * bed polygon, and if so at what level?": the 2-D section fill clip
 * (`sections/sectionBedClip.ts`) and the 3-D fence-wall clip
 * (`clipFencePanelsToBed.ts`). Both port the backend's own membership test
 * (`bed_level_at` + `_point_in_ring` in `domain/services/bed_override.py`), so
 * the frontend cut and the backend bed line agree.
 *
 * These are pure helpers with no I/O, no logging and no state, so they live in a
 * module-level file (CLAUDE.md "Helper hygiene") shared by both consumers rather
 * than being copied into each.
 *
 * @module utils/bedPolygonMembership
 */

/** A bed-override polygon in one horizontal CRS. */
export interface BedPolygon {
  /** The constant dredged bed elevation inside the ring (m TAW / NAP). */
  level_m: number;
  /** The polygon ring as `[x, y]` pairs; open ring (closing edge implicit). */
  vertices: ReadonlyArray<readonly [number, number]>;
}

/**
 * Even-odd ray-cast point-in-polygon test (port of `bed_override._point_in_ring`).
 *
 * Treats `vertices` as a closed ring (the last→first edge is implicit). Fewer
 * than three vertices never contains a point. A point exactly on an edge is a
 * boundary case the ray-cast does not decide either way — matching the backend.
 *
 * @param vertices - The polygon ring as `[x, y]` pairs (open ring).
 * @param x - Query point X in the ring's CRS.
 * @param y - Query point Y in the ring's CRS.
 * @returns `true` when the point is strictly inside the ring.
 */
export function pointInRing(
  vertices: ReadonlyArray<readonly [number, number]>,
  x: number,
  y: number,
): boolean {
  const n = vertices.length;
  if (n < 3) return false;
  let inside = false;
  let j = n - 1;
  for (let i = 0; i < n; i++) {
    const [xi, yi] = vertices[i];
    const [xj, yj] = vertices[j];
    // The edge (j -> i) straddles the horizontal ray at y when exactly one
    // endpoint is above y; compare its x-intersection against the query x.
    if (yi > y !== yj > y) {
      const xCross = ((xj - xi) * (y - yi)) / (yj - yi) + xi;
      if (x < xCross) inside = !inside;
    }
    j = i;
  }
  return inside;
}

/**
 * The bed level overriding the ground at `(x, y)`, or `null` outside every
 * polygon (port of `bed_override.bed_level_at`). The first containing polygon
 * wins, so a newest-first list makes the newest-drawn polygon win an overlap.
 *
 * @param polygons - The bed polygons, newest-first.
 * @param x - Query point X in the polygons' CRS.
 * @param y - Query point Y in the polygons' CRS.
 * @returns The dredged bed level inside the first containing polygon, else `null`.
 */
export function bedLevelAt(
  polygons: readonly BedPolygon[],
  x: number,
  y: number,
): number | null {
  for (const poly of polygons) {
    if (pointInRing(poly.vertices, x, y)) return poly.level_m;
  }
  return null;
}

/** The minimal shape a bed-override row carries for the CRS filter. */
export interface BedOverrideLike {
  /** EPSG of the polygon coordinates — the CRS the ring is stored in. */
  epsg: number;
  level_m: number;
  vertices: ReadonlyArray<readonly [number, number]>;
}

/**
 * The bed polygons that share a CRS, ready for a clip in that CRS.
 *
 * A clip tests each geometry point's map position against the polygon rings,
 * which is meaningless across CRSs — so only overrides drawn in the SAME
 * horizontal CRS as the geometry being clipped are kept. Returns `[]` when the
 * CRS is unknown or there are no overrides, so the caller's clip is a no-op.
 *
 * @param overrides - The project's bed overrides (any CRS), or `undefined`.
 * @param epsg - The CRS of the geometry to be clipped, or `null` when unknown.
 * @returns The matching overrides as {@link BedPolygon}s (level + ring only).
 */
export function bedPolygonsForCrs(
  overrides: readonly BedOverrideLike[] | undefined,
  epsg: number | null | undefined,
): BedPolygon[] {
  if (overrides === undefined || epsg == null) return [];
  return overrides
    .filter((o) => o.epsg === epsg)
    .map((o) => ({ level_m: o.level_m, vertices: o.vertices }));
}
