// Cross-section projection — pure math.
//
// For each investigation (CPT / borehole), compute where it lands
// when projected onto the section line:
//
//   * ``along`` — distance from the section's start endpoint along
//     the line, in metres. This becomes the column's x-coordinate
//     on the section canvas.
//   * ``offset`` — signed perpendicular distance from the line.
//     Positive = to the "left" of the line direction (i.e. the
//     point's local Y in the line's coordinate frame). The sign
//     matters for offset indicators (S5) — engineers want to see
//     which side of the line an investigation lives on. The
//     unsigned ``|offset|`` is what the buffer filter compares
//     against.
//
// Filter rules:
//   * ``|offset| <= projection_buffer_m`` — outside the buffer the
//     investigation isn't projected at all.
//   * ``0 <= along <= sectionLength`` — investigations whose
//     projection falls beyond either endpoint of the section are
//     skipped. DOV-style "extend the line" behaviour can land later
//     as a section-level preference.
//   * ``excluded_borehole_ids`` / ``excluded_cpt_ids`` on the
//     section row — user-chosen explicit hides take precedence.
//
// Coordinate system: section endpoints and investigation points are
// both in the section's horizontal EPSG (Lambert72 for Belgium, RD
// New for NL). Distances are Euclidean in that CRS, which is fine
// because both supported CRSes are conformal projections with
// negligible distortion at the typical site scale (<10km).

export interface SectionEndpoints {
  start_x: number
  start_y: number
  end_x: number
  end_y: number
}

export interface ProjectionResult {
  /** Distance along the line from start to projection foot, in metres. */
  along: number
  /** Signed perpendicular distance from the line, in metres.
   * Positive = the point lies to the left of the line direction. */
  offset: number
}

/**
 * Project a point onto a section line. Returns ``null`` when the
 * section has zero length (the API rejects zero-length sections at
 * create / update time, but defensive callers shouldn't crash on a
 * stale row).
 */
export function projectPointOntoLine(
  section: SectionEndpoints,
  pointX: number,
  pointY: number,
): ProjectionResult | null {
  const dx = section.end_x - section.start_x
  const dy = section.end_y - section.start_y
  const lengthSq = dx * dx + dy * dy
  if (lengthSq < 1e-12) return null
  const length = Math.sqrt(lengthSq)
  const ux = dx / length
  const uy = dy / length
  const vx = pointX - section.start_x
  const vy = pointY - section.start_y
  // Along-distance = projection of v onto u (dot product since u is
  // a unit vector). Signed offset = 2D cross product (vx*uy - vy*ux)
  // — same sign convention as a left-hand coordinate frame relative
  // to the line direction.
  const along = vx * ux + vy * uy
  const offset = vx * uy - vy * ux
  return { along, offset }
}

/** Euclidean length of the section line in metres. */
export function sectionLength(section: SectionEndpoints): number {
  const dx = section.end_x - section.start_x
  const dy = section.end_y - section.start_y
  return Math.sqrt(dx * dx + dy * dy)
}

// ---------------------------------------------------------------------------
// Investigation filter — keep what falls within the buffer + the line span
// ---------------------------------------------------------------------------

export interface InvestigationPoint {
  id: string
  location_x: number
  location_y: number
}

export interface ProjectedInvestigation<T> {
  item: T
  along: number
  offset: number
}

/**
 * Filter investigations to those that project onto the section's
 * span and within the lateral buffer. Returns each accepted point's
 * projected coordinates so callers don't have to redo the math at
 * render time.
 *
 * Order of the returned array matches the input order. Callers that
 * want a specific render order (e.g. left-to-right) sort by
 * ``along`` post-filter.
 */
export function investigationsOnSection<T extends InvestigationPoint>(
  section: SectionEndpoints & { projection_buffer_m: number },
  items: readonly T[],
  excludedIds: ReadonlySet<string> = new Set(),
): ProjectedInvestigation<T>[] {
  const length = sectionLength(section)
  if (length < 1e-9) return []
  const out: ProjectedInvestigation<T>[] = []
  for (const item of items) {
    if (excludedIds.has(item.id)) continue
    const p = projectPointOntoLine(section, item.location_x, item.location_y)
    if (p === null) continue
    if (p.along < 0 || p.along > length) continue
    if (Math.abs(p.offset) > section.projection_buffer_m) continue
    out.push({ item, along: p.along, offset: p.offset })
  }
  return out
}
