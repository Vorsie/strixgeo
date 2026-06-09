// desktop/src/renderer/src/utils/tieAutoSuggest.ts
//
// Auto-propose non-crossing "tie-sections" across a set of (assumed
// roughly parallel) cross-sections. The match is a monotonic
// strike-ordered sweep: pointers into each wall's strike-sorted test
// list only ever advance, so the resulting rungs are strike-ordered
// and the proposed ties can never cross one another (a crossing would
// imply a geologically impossible lateral swap). See spec §5.1.1.
import { projectPointOntoLine, type SectionEndpoints } from './sectionProjection'

/** An investigation (CPT or borehole) with its map-projected location. */
export interface TieInvestigation {
  id: string
  location_x: number
  location_y: number
}

/** An existing cross-section the ties will cross, with its corridor. */
export interface ParallelSection extends SectionEndpoints {
  id: string
  projection_buffer_m: number
  excluded_cpt_ids?: readonly string[]
  excluded_borehole_ids?: readonly string[]
}

/** One member test of a proposed tie (one per wall it connects). */
export interface TieMember {
  sectionId: string
  investigationId: string
  x: number
  y: number
}

/** A single proposed tie-section. */
export interface SuggestedTie {
  /** Member tests, ordered by strike (one per wall). */
  members: TieMember[]
  /** Projected endpoints of the straight tie line (through the extreme members). */
  start: { x: number; y: number }
  end: { x: number; y: number }
  /** Max along-strike spread among members (m) — collinearity quality. */
  strikeSpread: number
  /** Thinnest buffer that still catches every member (m). */
  bufferM: number
}

/** Perpendicular distance from point (px,py) to the line through a→b. */
function perpDistanceToLine(
  ax: number, ay: number, bx: number, by: number, px: number, py: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len = Math.hypot(dx, dy)
  if (len < 1e-9) return Math.hypot(px - ax, py - ay)
  return Math.abs((px - ax) * dy - (py - ay) * dx) / len
}

/**
 * Propose a non-crossing ladder of tie-sections.
 *
 * @param sections - Existing (parallel) cross-sections. The first one's
 *   direction defines the strike axis; pass them in a stable order.
 * @param cpts - All CPT investigations as projectable points.
 * @param boreholes - All borehole investigations as projectable points.
 * @param strikeToleranceM - Max along-strike spread allowed within one tie.
 * @returns Proposed ties in sweep (strike) order; empty if <2 sections.
 */
export function suggestTieSections(
  sections: readonly ParallelSection[],
  cpts: readonly TieInvestigation[],
  boreholes: readonly TieInvestigation[],
  strikeToleranceM: number,
): SuggestedTie[] {
  if (sections.length < 2) return []

  const base = sections[0]
  const ax = base.end_x - base.start_x
  const ay = base.end_y - base.start_y
  const axisLen = Math.hypot(ax, ay)
  if (axisLen < 1e-9) return []
  const ux = ax / axisLen
  const uy = ay / axisLen
  const strikeOf = (x: number, y: number): number =>
    (x - base.start_x) * ux + (y - base.start_y) * uy

  interface Placed { inv: TieInvestigation; wall: number; s: number }
  const placed: Placed[] = []
  const all = [...cpts, ...boreholes]
  for (const item of all) {
    let bestWall = -1
    let bestOffset = Infinity
    sections.forEach((sec, wallIdx) => {
      const excluded =
        (sec.excluded_cpt_ids?.includes(item.id) ?? false) ||
        (sec.excluded_borehole_ids?.includes(item.id) ?? false)
      if (excluded) return
      const proj = projectPointOntoLine(sec, item.location_x, item.location_y)
      if (!proj) return
      const secLen = Math.hypot(sec.end_x - sec.start_x, sec.end_y - sec.start_y)
      if (proj.along < 0 || proj.along > secLen) return
      const absOffset = Math.abs(proj.offset)
      if (absOffset <= sec.projection_buffer_m && absOffset < bestOffset) {
        bestOffset = absOffset
        bestWall = wallIdx
      }
    })
    if (bestWall >= 0) {
      placed.push({ inv: item, wall: bestWall, s: strikeOf(item.location_x, item.location_y) })
    }
  }

  const walls: Placed[][] = sections.map(() => [])
  for (const p of placed) walls[p.wall].push(p)
  for (const w of walls) w.sort((a, b) => a.s - b.s)

  const ptr = sections.map(() => 0)
  const ties: SuggestedTie[] = []
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const frontier = walls
      .map((w, i) => (ptr[i] < w.length ? { wall: i, p: w[ptr[i]] } : null))
      .filter((f): f is { wall: number; p: Placed } => f !== null)
    if (frontier.length === 0) break
    const sMin = Math.min(...frontier.map(f => f.p.s))
    const rung = frontier.filter(f => f.p.s - sMin <= strikeToleranceM)
    for (const f of rung) ptr[f.wall] += 1

    if (rung.length < 2) continue

    const members: TieMember[] = rung
      .map(f => ({
        sectionId: sections[f.wall].id,
        investigationId: f.p.inv.id,
        x: f.p.inv.location_x,
        y: f.p.inv.location_y,
      }))
      .sort((a, b) => strikeOf(a.x, a.y) - strikeOf(b.x, b.y))

    const first = members[0]
    const last = members[members.length - 1]
    const ss = rung.map(f => f.p.s)
    const buffer =
      Math.max(
        5,
        ...members.map(m => perpDistanceToLine(first.x, first.y, last.x, last.y, m.x, m.y)),
      ) + 2
    ties.push({
      members,
      start: { x: first.x, y: first.y },
      end: { x: last.x, y: last.y },
      strikeSpread: Math.max(...ss) - Math.min(...ss),
      bufferM: buffer,
    })
  }
  return ties
}
