/**
 * Is a section's line something we can ask a DEM about?
 *
 * Pure predicate, no I/O — the caller decides whether to skip a fetch, warn, or
 * toast.
 *
 * WHY this exists (dogfeed 2026-08-02, root-caused 2026-08-03): the section
 * panel flooded ``/dem/sample`` with ``X(-2.000, 1002.000) Y(-2.000, 2.000)``
 * on every re-mount, each request a 30 s round-trip to the Flemish WCS that
 * 404'd. One read-only SELECT on the dev DB found the cause in DATA, not in a
 * unit mix-up: two hand-typed ``cross_section`` rows named ``good`` and
 * ``test`` carry ``(0,0) → (1,0)`` while declaring ``epsg = 31370``. Those are
 * section-space coordinates in a map-coordinate column.
 *
 * The old renderer guard (``dx*dx + dy*dy < 1``) could not catch them: a 1.0 m
 * section gives exactly 1, and ``1 < 1`` is false. Length was the wrong
 * question anyway — a 1 m section at real Lambert-72 coordinates is legal, and
 * a 100 km section at the origin is not. The right question is whether the
 * endpoints are inside the declared CRS's own area of use.
 *
 * Deliberately NOT restricted to Flanders: a Wallonia or Netherlands section is
 * a perfectly legal request, and refusing it here would be a worse bug than the
 * one being fixed. Backend counterpart: ``WcsDemProvider._refuse_impossible_extent``
 * (``DHMVII_VALID_EXTENT`` / ``AHN4_VALID_EXTENT``) — this guard just stops the
 * round-trip from being paid at all.
 */

/** Just enough of a section row to judge its geometry. */
export interface SectionLineLike {
  name: string
  start_x: number
  start_y: number
  end_x: number
  end_y: number
  epsg: number
}

/** Human-readable CRS name + area of use, keyed by EPSG code.
 *
 * The envelopes mirror the backend's DEM ``VALID_EXTENT`` constants (the CRS
 * area of use, not the coverage footprint), so a legitimate NoData bbox is
 * still allowed through to the server. Any EPSG absent from this table is NOT
 * judged — we refuse only what we can prove impossible.
 */
const CRS_DOMAINS: Readonly<
  Record<number, { label: string; minX: number; minY: number; maxX: number; maxY: number }>
> = {
  // Belgian Lambert 72 — mirrors DHMVII_VALID_EXTENT in dem_wcs_constants.py.
  31370: { label: 'Lambert 72 (EPSG:31370)', minX: 14_000, minY: 20_000, maxX: 300_000, maxY: 250_000 },
  // Amersfoort / RD New — mirrors AHN4_VALID_EXTENT.
  28992: { label: 'RD New (EPSG:28992)', minX: 0, minY: 270_000, maxX: 310_000, maxY: 640_000 },
}

/**
 * Return why this section's endpoints cannot be map coordinates, or ``null``.
 *
 * @param section - The section row (name + endpoints + declared EPSG).
 * @returns A sentence naming the section and what is wrong with it, suitable
 *   for a toast and for a WARN log line; ``null`` when the line is plausible or
 *   the CRS is one we hold no domain for.
 */
export function implausibleSectionCoordinates(section: SectionLineLike): string | null {
  const coords = [section.start_x, section.start_y, section.end_x, section.end_y]
  if (coords.some(v => !Number.isFinite(v))) {
    return `Section “${section.name}” has a non-finite endpoint. Its coordinates cannot be used.`
  }

  const domain = CRS_DOMAINS[section.epsg]
  if (!domain) return null

  const outside =
    Math.min(section.start_x, section.end_x) < domain.minX ||
    Math.max(section.start_x, section.end_x) > domain.maxX ||
    Math.min(section.start_y, section.end_y) < domain.minY ||
    Math.max(section.start_y, section.end_y) > domain.maxY

  if (!outside) return null

  return (
    `Section “${section.name}” claims ${domain.label} but its endpoints ` +
    `(${section.start_x}, ${section.start_y}) → (${section.end_x}, ${section.end_y}) ` +
    `lie outside that CRS. The ground-surface line is unavailable until the ` +
    `section's coordinates are corrected.`
  )
}
