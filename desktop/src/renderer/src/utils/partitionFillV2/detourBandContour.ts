/**
 * partitionFillV2/detourBandContour.ts — RULING 8s STAGE B: a matched-pair BAND-BASE contour
 * DETOURS around a corr-0 lens diamond it would cross (owner, session 54; design
 * partition-engine-v2.md §8, ruling 8s "0.45 stands, the MATRIX detours").
 *
 * THE CLASS. A top-tied matched-pair band's OWN BASE contour (``bandc`` in ``emitEnclosingFlood``)
 * slopes from the near column's band base down to the facing column's band base. When a corr-0 lens
 * sits directly BELOW the band's near base corner (the SILT/KLEI interbed whose top = the ZAND
 * band's base), that descending contour dives past the lens's 0.45 diamond → the lens diamond and
 * the ZAND band double-cover a sliver (CS1 gap3 B4-u5-SILT; CS2 gap13 KLEI interbed × ZAND).
 *
 * S50 CRUSHED the lens to fit strictly below the contour (``gapBandContourBrackets`` fed the lens
 * reach). Ruling 8s DELETES that crush — "0.45 stands, the matrix detours": the LENS keeps its
 * full 0.45 reach and the BAND CONTOUR reroutes AROUND the lens diamond apex, so the band wraps the
 * lens as a hole and overlap is impossible BY CONSTRUCTION.
 *
 * THE DETOUR. This is the S51 ``detourFlankAroundEnclosedLenses`` mechanism (the ruling-8g onlap-
 * flank detour) GENERALISED from onlap flanks to ``bandc`` curves. The straight band contour is
 * rerouted ``crossIn → apex → crossOut`` around a corr-0 lens diamond it CUTS THROUGH — RIDING the
 * diamond's emitted flanks around the apex. A "cut-through" is exactly TWO boundary MEETINGS
 * bracketing the apex, where each meeting is either an interior crossing of an outer flank OR a
 * SHARED CORNER: the band-BASE contour of a top-tied ZAND band EMANATES from the lens's own top
 * corner (the SILT/KLEI interbed's top = the ZAND band's base), so it shares that vertex with the
 * diamond's top flank (no interior crossing there) and exits through the base flank. Both the shared
 * corner and the flank crossing sit ON the diamond boundary, so the inserted ride is COLLINEAR with
 * the emitted lens closings — the arrangement unions the coincident segments and the lens closes as
 * a proper hole in the band face while the band wraps it.
 *
 * The diamonds are the EXACT ones the sweep + enclosed-lens emitter emitted (collected as they were
 * drawn, ``Corr0Diamond``), so the detour rides collinear with the real lens line art — never a
 * re-derived approximation that could miss the emitted apex.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { segIntersect } from './detourEnclosedLens'
import { runGapTies, terminationRun } from './emitContinuation'
import { type ResolvedTie } from './emitCurves'
import { emitGapAllowed, enclosedLensDiamond } from './emitLenses'
import { type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { segmentDegenerate } from './snap'
import { type Point } from './types'

/**
 * ONE corr-0 lens diamond, recorded by the emitter that drew it (the sweep's ``emitLens`` or the
 * enclosed-lens ``emitOne``) so the band-contour detour rides the EXACT emitted flanks. The two
 * outer flanks are (topPt→apex) and (apex→basePt); ``apex`` is the diamond tip in the gap.
 */
export interface Corr0Diamond {
  /** The gap the diamond was emitted into. */
  gapIndex: number
  /** The lens's own top contact corner (on its column). */
  topPt: Point
  /** The apex (the pinch tip in the gap). */
  apex: Point
  /** The lens's own base contact corner (on its column). */
  basePt: Point
}

/**
 * Reroute a straight band-base (or band-top) contour AROUND every corr-0 lens diamond in its gap
 * that it cuts through (ruling 8s). Returns the contour unchanged when it crosses none.
 *
 * A contour "cuts through" a diamond when it crosses BOTH outer flanks (top corner→apex and
 * apex→base corner). The straight span between the two crossings is replaced by
 * ``crossIn → apex → crossOut`` — collinear with the emitted lens flanks, so the arrangement unions
 * them and the lens closes as a hole while the band wraps it.
 *
 * Parameters
 * ----------
 * contour : readonly Point[]
 *     The straight band contour (2 points, left→right by x — the ``emitBandContourCurve`` output).
 * gapIndex : number
 *     The gap the contour lives in (only diamonds in this gap are candidates).
 * diamonds : readonly Corr0Diamond[]
 *     The corr-0 lens diamonds emitted this run (all gaps; filtered here to ``gapIndex``).
 *
 * Returns
 * -------
 * Point[]
 *     The contour, rerouted around every crossed corr-0 lens diamond (ride order along the
 *     contour). Deterministic: rides are inserted in ascending entry-crossing parameter order.
 */
export function detourBandContourAroundLenses(
  contour: readonly Point[],
  gapIndex: number,
  diamonds: readonly Corr0Diamond[],
): Point[] {
  if (contour.length < 2) return [...contour]
  const A = contour[0]
  const B = contour[contour.length - 1]
  // Ride insertions (crossIn, apex, crossOut) per crossed diamond, ordered along the contour by the
  // entry-crossing parameter t (so the rebuilt polyline stays monotone along A→B).
  const inserts: { tIn: number; ride: Point[] }[] = []
  for (const d of diamonds) {
    if (d.gapIndex !== gapIndex) continue
    // The two contour↔diamond MEETINGS, each a parameter t along the contour A→B where the contour
    // touches a diamond outer flank. A MEETING is either (a) an interior crossing of the top flank
    // (topPt→apex) or the base flank (apex→basePt), OR (b) a SHARED VERTEX where the contour starts
    // / ends exactly on the diamond's top or base CORNER — the band-base case: the ZAND band base
    // contour EMANATES from the lens's own top corner (SILT/KLEI top = ZAND band base), so it shares
    // that vertex with the diamond's top flank (no interior crossing there) and exits through the
    // base flank. Both cases are a boundary meeting bracketing the apex.
    const meets = diamondBoundaryMeetings(A, B, d)
    // A cut-through has EXACTLY two boundary meetings (enter one side, exit the other) bracketing the
    // apex. One meeting = the contour only grazes a corner (no wrap needed); zero = clear.
    if (meets.length !== 2) continue
    const [first, second] = meets[0].t <= meets[1].t ? [meets[0], meets[1]] : [meets[1], meets[0]]
    // Ride from the earlier meeting, around the apex, to the later meeting — collinear with the
    // emitted lens flanks between the meeting points, so the arrangement unions them and the lens
    // closes as a hole while the band wraps it.
    inserts.push({ tIn: first.t, ride: [first.pt, d.apex, second.pt] })
  }
  if (inserts.length === 0) return [...contour]
  inserts.sort((a, b) => a.tIn - b.tIn)
  const out: Point[] = [A]
  for (const ins of inserts) out.push(...ins.ride)
  out.push(B)
  // Drop consecutive duplicate vertices: a shared-corner ride starts AT the contour endpoint
  // (crossIn === A / B), which would otherwise repeat that point. A zero-length segment is a snap
  // no-op the arrangement collapses anyway, but a clean polyline avoids a degenerate half-edge.
  return dedupeConsecutive(out)
}

/** Drop consecutive vertices that snap to the same 1 mm grid cell (keeps the polyline non-degenerate). */
function dedupeConsecutive(pts: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of pts) {
    const last = out[out.length - 1]
    if (last && Math.abs(last.x - p.x) <= CORNER_SNAP_M && Math.abs(last.y - p.y) <= CORNER_SNAP_M) continue
    out.push(p)
  }
  return out
}

/** 1 mm — the arrangement snap grid; a contour endpoint within this of a diamond corner shares it. */
const CORNER_SNAP_M = 0.001

/**
 * The contour↔diamond boundary MEETINGS: each an interior crossing of an outer flank OR a shared
 * corner vertex (the contour endpoint sits ON the diamond's top / base corner). Deduplicated so a
 * shared corner is not double-counted as both a corner meeting and a near-zero-parameter flank
 * crossing. Returns 0, 1, or 2 meetings ordered as found; the caller wraps only on exactly 2 (a
 * cut-through that brackets the apex).
 */
function diamondBoundaryMeetings(
  A: Point,
  B: Point,
  d: Corr0Diamond,
): { pt: Point; t: number }[] {
  const meets: { pt: Point; t: number }[] = []
  const near = (p: Point, q: Point): boolean =>
    Math.abs(p.x - q.x) <= CORNER_SNAP_M && Math.abs(p.y - q.y) <= CORNER_SNAP_M
  const add = (pt: Point, t: number): void => {
    // Skip a meeting that coincides with the apex (a contour grazing only the tip) or duplicates an
    // existing meeting (a shared corner also reported as a t≈0/1 flank crossing).
    if (near(pt, d.apex)) return
    if (meets.some((m) => Math.abs(m.t - t) < 1e-6)) return
    meets.push({ pt, t })
  }
  // Shared corner: the contour endpoint sits on the diamond's top or base corner (t=0 at A, t=1 at
  // B). The band-base contour emanates from the lens top corner → a t=0 meeting there.
  if (near(A, d.topPt) || near(A, d.basePt)) add({ x: A.x, y: A.y }, 0)
  if (near(B, d.topPt) || near(B, d.basePt)) add({ x: B.x, y: B.y }, 1)
  // Interior flank crossings (topPt→apex and apex→basePt).
  const cUp = segIntersect(A, B, d.topPt, d.apex)
  if (cUp !== null) add(cUp.pt, cUp.t)
  const cLo = segIntersect(A, B, d.apex, d.basePt)
  if (cLo !== null) add(cLo.pt, cLo.t)
  return meets
}

/**
 * Collect the ENCLOSED-lens diamonds (``emitEnclosedLensCurves``' output) as ``Corr0Diamond``s so
 * the band-contour detour can wrap them too (ruling 8s STAGE B). ``emitEnclosedLensCurves`` runs
 * AFTER ``emitEnclosingFlood`` in the pipeline, so the flood cannot read the emitted diamonds
 * directly; this re-derives them from the SAME ``enclosedLensDiamond`` call ``emitOne`` makes
 * (identical apex — same section + gap ties), appending to the shared ``diamonds`` collection
 * BEFORE the flood consumes it. Mirrors ``emitEnclosedLensCurves``' per-column loop exactly:
 *
 *   - a column's enclosed lens is emitted into the gap to its RIGHT (side 'left', gap ci) and the
 *     gap to its LEFT (side 'right', gap ci-1);
 *   - the ``shouldEmitLens`` gate is unconditional (ruling 8h), so every enclosed lens is emitted;
 *   - a freedraw-override lens (a user-drawn polyline, not a simple diamond) is SKIPPED here — its
 *     shape is not a crossIn→apex→crossOut diamond, and it is a rare user artefact; a band contour
 *     across it would be handled by the arrangement, not this simple-diamond detour;
 *   - a sub-snap-degenerate diamond (``emitOne``'s ``segmentDegenerate`` no-op) is skipped — no
 *     lens was emitted, so there is nothing to detour around.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry ``enclosedLenses`` + the apex overrides).
 * ties : readonly ResolvedTie[]
 *     The resolved gap ties (``enclosedLensReach``'s sole 8s reach shortener — same as ``emitOne``).
 * diamonds : Corr0Diamond[]
 *     The shared collection the sweep already appended its interior diamonds to (mutated in place).
 */
export function collectEnclosedLensDiamonds(
  section: SectionInput,
  ties: readonly ResolvedTie[],
  diamonds: Corr0Diamond[],
): void {
  const { columns } = section
  const record = (
    lens: UnitGeom,
    col: ColumnGeom,
    colIndex: number,
    gapIndex: number,
    side: 'left' | 'right',
  ): void => {
    // A freedraw-override lens is not a simple diamond — skip (parity with ``emitOne``'s freedraw
    // branch, which emits a polyline, not two flanks). ``lensApexOverrides`` keys ``bodyId@gap``.
    const ov =
      lens.bodyId != null ? section.lensApexOverrides?.get(`${lens.bodyId}@${gapIndex}`) : undefined
    if (ov && (ov.upper?.length || ov.lower?.length)) return
    // A lens is measured against the first column that READ its levels, crossing any blind
    // column on the way (owner 2026-08-21, ``terminationRun``). Mirror ``emitOne``'s target,
    // width and run ties so the detour rides the EXACT diamond the emitter drew; a lens run flat to
    // the section edge (``run.toEdge``) is a full-thickness rectangle, not a diamond — skip it.
    const run = terminationRun(columns, colIndex, side === 'left' ? 1 : -1, lens.topElev, lens.baseElev)
    if (run.toEdge) return
    const { topPt, apex, basePt } = enclosedLensDiamond(
      lens,
      col,
      run.column,
      gapIndex,
      side,
      Math.abs(run.column.x - col.x),
      section,
      runGapTies(ties, run),
    )
    // ``emitOne`` drops a sub-snap-degenerate diamond (no lens emitted) — mirror that so we never
    // detour around a diamond the emitter did not draw.
    if (segmentDegenerate(topPt, apex) || segmentDegenerate(apex, basePt)) return
    diamonds.push({ gapIndex, topPt, apex, basePt })
  }
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]
    if (col.enclosedLenses.length === 0) continue
    // Mirror ``emitEnclosedLensCurves``' per-gap restriction (ruling 8v): a per-gap-scoped lens
    // (the S22 sand) is drawn only into its UN-TIED gap(s), so only detour a band there.
    if (ci + 1 < columns.length) {
      for (const el of col.enclosedLenses) if (emitGapAllowed(el, ci)) record(el.lens, col, ci, ci, 'left')
    }
    if (ci - 1 >= 0) {
      for (const el of col.enclosedLenses) if (emitGapAllowed(el, ci - 1)) record(el.lens, col, ci, ci - 1, 'right')
    }
  }
}
