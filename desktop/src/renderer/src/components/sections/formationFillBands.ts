/**
 * The Stratigraphy-stage (geological axis) formation fill bands — pure geometry.
 *
 * Extracted from ``ContactsLayer``'s ``formationFillBands`` memo so the band
 * construction is unit-testable on real section geometry without mounting the
 * component. Each formation's band runs from its own top polyline down to the
 * first OLDER formation defined at that X (``buildFillBand``), or to the
 * data-extent floor.
 */

import type { FormationSurfaceResponse } from '../../api/client'
import { buildFillBand } from './utils'

/** One formation's projected (screen-space) top polyline. */
export interface FormationTopLine {
  /** Formation id (one line per formation). */
  formationId: string
  /** Formation colour — the band fill. */
  color: string
  /** Picked tops in screen space; one vertex per column carrying the formation. */
  vertices: readonly { screenX: number; screenY: number }[]
}

/** One rendered fill band. */
export interface FormationFillBand {
  formationId: string
  color: string
  /** Closed SVG path (``M … Z``). */
  d: string
  isStale: boolean
}

/** Inputs of {@link buildFormationFillBands}. */
export interface FormationFillBandsInput {
  /** Every formation top polyline on the section, projected. */
  lines: readonly FormationTopLine[]
  /** Built surfaces by formation id — no surface row = no fill. */
  surfacesByFormationId?: ReadonlyMap<string, FormationSurfaceResponse>
  /** Screen-Y floor under the oldest formation (deepest investigation bottom). */
  floor: number
  /** Lateral "breathe" pad past a formation's outermost pick, in px. */
  fillBufferPx: number
  /** Optional plot bounds: when wired, an outer pick extends to them. */
  plotLeft?: number
  plotRight?: number
}

/**
 * Build the Stratigraphy-stage fill bands, youngest first.
 *
 * Parameters
 * ----------
 * input
 *     The projected formation tops plus the floor / pad / plot bounds.
 *
 * Returns
 * -------
 * FormationFillBand[]
 *     One band per formation that has a built (or stale) surface.
 */
export function buildFormationFillBands(input: FormationFillBandsInput): FormationFillBand[] {
  const { lines, surfacesByFormationId, floor, fillBufferPx, plotLeft, plotRight } = input
  if (lines.length === 0) return []
  const projected = lines
    .map(line => {
      const points = line.vertices
        .map(v => ({ x: v.screenX, y: v.screenY }))
        .sort((a, b) => a.x - b.x)
      // The picks themselves, before any pad is added.
      const picks = points.map(p => ({ ...p }))
      if (points.length >= 2) {
        // Halfspace extrapolation — extend the band laterally to the
        // section's plot bounds when those are available; else pad by
        // ±fillBufferPx past the outermost pick.
        const left = points[0]
        const right = points[points.length - 1]
        const leftTargetX =
          plotLeft !== undefined && plotLeft < left.x
            ? plotLeft
            : fillBufferPx > 0
              ? left.x - fillBufferPx
              : left.x
        const rightTargetX =
          plotRight !== undefined && plotRight > right.x
            ? plotRight
            : fillBufferPx > 0
              ? right.x + fillBufferPx
              : right.x
        if (leftTargetX < left.x) points.unshift({ x: leftTargetX, y: left.y })
        if (rightTargetX > right.x) points.push({ x: rightTargetX, y: right.y })
      }
      // 3-state fill contract (§10 on-click build): fresh surface → solid,
      // stale → faded, no surface row → NO fill.
      const surface = surfacesByFormationId?.get(line.formationId)
      return {
        formationId: line.formationId,
        color: line.color,
        points,
        picks,
        hasSurface: surface !== undefined,
        isStale: surface?.is_stale === true,
        hasTriangles: (surface?.triangles.length ?? 0) > 0,
      }
    })
    .filter(p => p.points.length >= 2)
  // Youngest first by mean screen-Y (smaller Y = higher = younger).
  const annotated = projected
    .map(p => ({
      line: p,
      meanY: p.points.reduce((acc, pt) => acc + pt.y, 0) / p.points.length,
    }))
    .sort((a, b) => a.meanY - b.meanY)
  pinchAtAbsentNeighbours(annotated.map(a => a.line))
  const out: FormationFillBand[] = []
  for (let i = 0; i < annotated.length; i++) {
    const younger = annotated[i].line
    if (!younger.hasSurface) continue
    if (!younger.isStale && !younger.hasTriangles) continue
    // Every older formation, immediate-next-older first: the pinch-out
    // fallback chain of ``buildFillBand``.
    const olders = annotated.slice(i + 1).map(a => a.line.points)
    const d = buildFillBand(younger.points, olders, floor)
    if (d === '') continue
    out.push({
      formationId: younger.formationId,
      color: younger.color,
      d,
      isStale: younger.isStale,
    })
  }
  return out
}

/** Two screen X's closer than this are the same column. */
const SAME_COLUMN_EPS_PX = 0.5

/** A projected top line as the band builder holds it (youngest-first order). */
interface PaddedTopLine {
  /** Top vertices, ascending X, outer pads included. */
  points: { x: number; y: number }[]
  /** The picks alone (no pads), ascending X. */
  picks: readonly { x: number; y: number }[]
}

/**
 * A formation that is ABSENT on the next interpreted test thins to zero AT that
 * test, under the overlying unit's base (owner ruling (b), 2026-10-14: "the
 * wedge is Merelbeke").
 *
 * For each end of each top line, the next interpreted column beyond the
 * outermost pick (any column carrying a pick of any formation) is looked up.
 * When that column carries a pick of an OLDER formation, the unit's level was
 * reached there and the unit is not in it: the end pad is replaced by a vertex
 * AT that column on the top of the first older formation picked there. The
 * band's top then runs down to that older top and its base follows the same
 * older top, so the band closes to zero thickness at the test — the wedge
 * between the overlying base and the older top is filled by this unit. The
 * overlying unit's base is this unit's top, so it ends on its own base at both
 * tests. The rule is symmetric, so a unit that APPEARS on the next test grows
 * from zero at the previous one.
 *
 * When the next column carries no older pick (it stopped above the unit, or
 * only younger units are picked), nothing proves the absence: the flat pad
 * stays. When there is no column beyond, the pad stays too (outer edge).
 *
 * Mutates ``lines[i].points`` in place.
 *
 * Parameters
 * ----------
 * lines
 *     The padded top lines, youngest first (the band builder's age order;
 *     an older formation is any line after ``i``).
 */
function pinchAtAbsentNeighbours(lines: readonly PaddedTopLine[]): void {
  const columnXs = Array.from(new Set(lines.flatMap(l => l.picks.map(p => p.x)))).sort(
    (a, b) => a - b,
  )
  const olderTopAt = (i: number, x: number): number | null => {
    for (let j = i + 1; j < lines.length; j++) {
      const pick = lines[j].picks.find(p => Math.abs(p.x - x) <= SAME_COLUMN_EPS_PX)
      if (pick !== undefined) return pick.y
    }
    return null
  }
  // Collect every pinch first, then apply them.
  const edits: { line: PaddedTopLine; side: 'left' | 'right'; x: number; y: number }[] = []
  lines.forEach((line, i) => {
    if (line.picks.length === 0) return
    const leftX = line.picks[0].x
    const rightX = line.picks[line.picks.length - 1].x
    const nextRight = columnXs.find(x => x > rightX + SAME_COLUMN_EPS_PX)
    if (nextRight !== undefined) {
      const y = olderTopAt(i, nextRight)
      if (y !== null) edits.push({ line, side: 'right', x: nextRight, y })
    }
    const nextLeft = [...columnXs].reverse().find(x => x < leftX - SAME_COLUMN_EPS_PX)
    if (nextLeft !== undefined) {
      const y = olderTopAt(i, nextLeft)
      if (y !== null) edits.push({ line, side: 'left', x: nextLeft, y })
    }
  })
  for (const e of edits) {
    const pts = e.line.points
    if (e.side === 'right') {
      const rightX = e.line.picks[e.line.picks.length - 1].x
      while (pts.length > 0 && pts[pts.length - 1].x > rightX) pts.pop()
      pts.push({ x: e.x, y: e.y })
    } else {
      const leftX = e.line.picks[0].x
      while (pts.length > 0 && pts[0].x < leftX) pts.shift()
      pts.unshift({ x: e.x, y: e.y })
    }
  }
}
