/**
 * Section bed-override clip — the canal cut-out (owner ruling 2026-09-07).
 *
 * The owner's site was dredged for a canal. A bed override says the ground under
 * it is at the dredged bed level, not the water surface the DEM carries and the
 * litho fill tops out at (the fill tops at each column's collar, never the DEM).
 * Answering "does the canal fill also cut out in the litho model?": inside a bed
 * polygon nothing lithological is drawn above the bed level; outside every
 * polygon nothing changes.
 *
 * This is a pure render-layer helper. It builds an SVG clip-path `d` for the
 * partition fill overlay so that, WHERE the section crosses a bed polygon, the
 * fill is clipped to the section's ground+bed line — the same DEM line the
 * section already fetches with the bed applied through `/dem/sample?project_id`.
 * It mirrors the backend's own membership test (`bed_level_at` +
 * `_point_in_ring` in `domain/services/bed_override.py`) and the exact point
 * reconstruction the DEM endpoint uses, so the frontend clip and the backend
 * bed line agree.
 *
 * When the section crosses no bed polygon the helper returns `null` — no clip is
 * applied and the render is byte-identical to before this feature existed.
 *
 * @module sections/sectionBedClip
 */

/** One DEM sample: its distance along the section and its (bed-applied) elevation. */
export interface BedClipDemSample {
  along_m: number;
  /** Elevation in the section's vertical datum; `null` at a DEM NoData sample. */
  elevation_m: number | null;
}

/** A bed-override polygon in the section's horizontal CRS. */
export interface BedClipPolygon {
  /** The constant dredged bed elevation inside the ring (m TAW / NAP). */
  level_m: number;
  /** The polygon ring as `[x, y]` pairs; open ring (closing edge implicit). */
  vertices: ReadonlyArray<readonly [number, number]>;
}

/** Everything the clip builder needs, all in the section view's own units. */
export interface BedClipParams {
  /** The DEM line samples (with the bed already applied), any along order. */
  samples: readonly BedClipDemSample[];
  /** The section line endpoints in the horizontal CRS (to place each sample). */
  sectionStartX: number;
  sectionStartY: number;
  sectionEndX: number;
  sectionEndY: number;
  /** The project's bed overrides, newest-first (first containing polygon wins). */
  polygons: readonly BedClipPolygon[];
  /** along_m → screen X — MUST be the warp-aware map the fill itself uses. */
  alongToScreenX: (alongM: number) => number;
  /** elevation → screen Y — the same map the fill and DEM line use. */
  levelToScreen: (elevationM: number) => number;
  /** The plot rectangle in screen pixels. */
  plotLeft: number;
  plotRight: number;
  plotTop: number;
  plotBottom: number;
}

const EPS = 1e-9;

/**
 * Even-odd ray-cast point-in-polygon test (port of `bed_override._point_in_ring`).
 *
 * Treats `vertices` as a closed ring (the last→first edge is implicit). Fewer
 * than three vertices never contains a point.
 */
function pointInRing(
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
 */
function bedLevelAt(
  polygons: readonly BedClipPolygon[],
  x: number,
  y: number,
): number | null {
  for (const poly of polygons) {
    if (pointInRing(poly.vertices, x, y)) return poly.level_m;
  }
  return null;
}

/**
 * Build the partition-fill clip-path `d`, or `null` when nothing is capped.
 *
 * The returned path is the region to KEEP: its top edge follows the plot top
 * everywhere the section is outside every bed polygon, and dips down to the bed
 * line (the DEM sample elevations, which carry the bed level inside the polygon)
 * over the along-ranges the section crosses a bed polygon; the bottom is the
 * plot bottom. Applying it to the fill overlay cuts away the fill above the bed
 * inside the canal and leaves everything else untouched.
 *
 * The along-ranges are found by reconstructing each DEM sample's map position
 * from its along-distance — exactly as the DEM endpoint does — and testing
 * polygon membership, so a flat run of natural ground at a bed level is NOT
 * mistaken for a canal (the polygon geometry decides, not the elevation).
 *
 * @param params - The samples, section endpoints, polygons, transforms and plot
 *   rectangle (see {@link BedClipParams}).
 * @returns The clip-path `d` string, or `null` when the section crosses no bed
 *   polygon (no clip → byte-identical render).
 */
export function buildBedClipPath(params: BedClipParams): string | null {
  const {
    samples,
    sectionStartX,
    sectionStartY,
    sectionEndX,
    sectionEndY,
    polygons,
    alongToScreenX,
    levelToScreen,
    plotLeft,
    plotRight,
    plotTop,
    plotBottom,
  } = params;

  if (polygons.length === 0 || samples.length < 2) return null;
  const dx = sectionEndX - sectionStartX;
  const dy = sectionEndY - sectionStartY;
  const lineLen = Math.hypot(dx, dy);
  if (lineLen < EPS) return null;

  const sorted = [...samples].sort((a, b) => a.along_m - b.along_m);
  const clampY = (y: number): number =>
    Math.max(plotTop, Math.min(plotBottom, y));

  // The clip-top Y for each sample when it sits inside a bed polygon, else null.
  // Inside a polygon the DEM sample already carries the bed level; a NoData
  // sample there falls back to the polygon's own level so the cap is still drawn.
  const cappedY: Array<number | null> = sorted.map((s) => {
    const frac = s.along_m / lineLen;
    const mx = sectionStartX + frac * dx;
    const my = sectionStartY + frac * dy;
    const level = bedLevelAt(polygons, mx, my);
    if (level === null) return null;
    const elev = s.elevation_m ?? level;
    return clampY(levelToScreen(elev));
  });

  // Walk maximal runs of consecutive capped samples. Each run dips the top edge
  // down to the bed line with a vertical step at its first and last sample, so
  // an uncapped stretch is never cut (the step lands on the capped sample's X,
  // leaving everything outside the run at the plot top).
  const pts: Array<[number, number]> = [[plotLeft, plotTop]];
  let anyCap = false;
  let i = 0;
  while (i < sorted.length) {
    if (cappedY[i] === null) {
      i++;
      continue;
    }
    anyCap = true;
    const a = i;
    let b = i;
    while (b + 1 < sorted.length && cappedY[b + 1] !== null) b++;
    const xa = alongToScreenX(sorted[a].along_m);
    const xb = alongToScreenX(sorted[b].along_m);
    pts.push([xa, plotTop]); // reach the run start along the plot top
    for (let k = a; k <= b; k++) {
      pts.push([alongToScreenX(sorted[k].along_m), cappedY[k] as number]);
    }
    pts.push([xb, plotTop]); // step back up at the run end
    i = b + 1;
  }
  if (!anyCap) return null;

  pts.push([plotRight, plotTop]);
  pts.push([plotRight, plotBottom]);
  pts.push([plotLeft, plotBottom]);

  return (
    pts
      .map(
        (p, idx) =>
          `${idx === 0 ? "M" : "L"} ${p[0].toFixed(2)},${p[1].toFixed(2)}`,
      )
      .join(" ") + " Z"
  );
}
