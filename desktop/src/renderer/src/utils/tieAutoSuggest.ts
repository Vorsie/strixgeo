/**
 * Auto-propose clean "tie-sections" across a set of (assumed roughly
 * parallel) cross-sections. Pure math — no React, no I/O.
 *
 * Two stages:
 *   1. A monotonic strike-ordered sweep proposes candidate rungs (~1 test
 *      per wall, members within a strike tolerance).
 *   2. A conflict-free greedy selection (``selectNonConflictingTies``)
 *      keeps a subset that is GUARANTEED to have no two ties crossing in
 *      the map plane AND no two ties sharing a test (overlapping
 *      corridors). The strike sweep alone does NOT guarantee this on real,
 *      not-perfectly-parallel walls with scattered tests — the greedy
 *      pass does, by construction. See spec §5.1.1.
 */
import { projectPointOntoLine, sectionLength, type SectionEndpoints } from './sectionProjection'

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

/** A 2D point in the projected CRS. */
interface Pt {
  x: number
  y: number
}

/**
 * Do the open segments a1→a2 and b1→b2 properly cross? Uses the standard
 * CCW-orientation test; collinear/touching-at-an-endpoint cases return
 * false (a tie sharing an endpoint with another is not a "crossing").
 */
function segmentsCross(a1: Pt, a2: Pt, b1: Pt, b2: Pt): boolean {
  const ccw = (a: Pt, b: Pt, c: Pt): number =>
    (c.y - a.y) * (b.x - a.x) - (b.y - a.y) * (c.x - a.x)
  const d1 = ccw(b1, b2, a1)
  const d2 = ccw(b1, b2, a2)
  const d3 = ccw(a1, a2, b1)
  const d4 = ccw(a1, a2, b2)
  return d1 > 0 !== d2 > 0 && d3 > 0 !== d4 > 0
}

/**
 * Is point (px,py) inside the rectangular corridor of half-width
 * ``bufferM`` around the segment a→b? (A small ±5 % overhang past the
 * endpoints mirrors the section's own projection behaviour.)
 */
function corridorContains(a: Pt, b: Pt, bufferM: number, px: number, py: number): boolean {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  if (lenSq < 1e-12) return Math.hypot(px - a.x, py - a.y) <= bufferM
  const t = ((px - a.x) * dx + (py - a.y) * dy) / lenSq
  if (t < -0.05 || t > 1.05) return false
  return perpDistanceToLine(a.x, a.y, b.x, b.y, px, py) <= bufferM
}

/** A candidate tie plus the data the conflict-free selector needs. */
export interface TieCandidate {
  tie: SuggestedTie
  /** Ids of every investigation inside this tie's corridor. */
  corridorIds: Set<string>
  /** Tie length in metres (tie-breaker after buffer). */
  lengthM: number
}

/**
 * Greedily keep a conflict-free subset of candidate ties.
 *
 * Candidates are taken thinnest-buffer-first (then shortest). A candidate
 * is accepted only if it neither CROSSES an already-accepted tie in the
 * map plane nor SHARES a test with one (its corridor contains an
 * investigation already consumed by an accepted tie). The result is
 * therefore guaranteed to have zero crossings and zero shared tests.
 *
 * @param candidates - The proposed ties + their corridor test-id sets.
 * @returns The accepted ties, thinnest-first.
 */
export function selectNonConflictingTies(
  candidates: readonly TieCandidate[],
): SuggestedTie[] {
  const ordered = [...candidates].sort(
    (a, b) => a.tie.bufferM - b.tie.bufferM || a.lengthM - b.lengthM,
  )
  const accepted: TieCandidate[] = []
  const consumed = new Set<string>()
  for (const cand of ordered) {
    let sharesTest = false
    for (const id of cand.corridorIds) {
      if (consumed.has(id)) {
        sharesTest = true
        break
      }
    }
    if (sharesTest) continue
    const crosses = accepted.some(acc =>
      segmentsCross(cand.tie.start, cand.tie.end, acc.tie.start, acc.tie.end),
    )
    if (crosses) continue
    accepted.push(cand)
    for (const id of cand.corridorIds) consumed.add(id)
  }
  return accepted.map(c => c.tie)
}

/** Internal record: a test placed onto one wall during the sweep. */
interface Placed { inv: TieInvestigation; wall: number; s: number }

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
      const secLen = sectionLength(sec)
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
  const candidates: TieCandidate[] = []
  // reason: the frontier is rebuilt from pointers each iteration; the
  // termination check (all walls exhausted) must live inside the loop,
  // not as a pre-condition, so a constant `while (true)` is correct here.
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
        // Floor: a corridor narrower than 5 m would miss real-world
        // measurement scatter even for a dead-collinear tie.
        5,
        ...members.map(m => perpDistanceToLine(first.x, first.y, last.x, last.y, m.x, m.y)),
      ) + 2 // +2 m breathing room beyond the widest-offset member.
    const tie: SuggestedTie = {
      members,
      start: { x: first.x, y: first.y },
      end: { x: last.x, y: last.y },
      strikeSpread: Math.max(...ss) - Math.min(...ss),
      bufferM: buffer,
    }
    // Every investigation this tie's corridor would capture once created as
    // a real section — the set the conflict-free pass uses to forbid two
    // ties from sharing a test.
    const corridorIds = new Set<string>()
    for (const item of all) {
      if (corridorContains(tie.start, tie.end, buffer, item.location_x, item.location_y)) {
        corridorIds.add(item.id)
      }
    }
    // A tie must pass through at least two DISTINCT tests — you cannot
    // correlate with only one (owner ruling 2026-09-06). The rung already
    // holds >= 2 members, but they collapse to a single investigation id when
    // the same site sits on two walls (a CPT + borehole at one location); drop
    // that degenerate one-test line here rather than propose it.
    if (corridorIds.size < 2) continue
    candidates.push({
      tie,
      corridorIds,
      lengthM: Math.hypot(last.x - first.x, last.y - first.y),
    })
  }

  // Keep only a non-crossing, test-disjoint subset (see selectNonConflictingTies).
  return selectNonConflictingTies(candidates)
}
