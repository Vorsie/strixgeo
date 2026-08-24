/**
 * partitionFillV2/bothSidesClosed.ts — BOTH PACKAGES CLOSED AT THE MIDDLE.
 *
 * Owner, 2026-08-24, asked what owns the ground left between two closed loops when the
 * two facing packages both close at the middle — left half to the left column's masses,
 * right half to the right's? — *"yes in this case i'd rather have a vertical line"*.
 *
 * It is the same line ``emitEnclosingFlood.closeInterval`` already draws where two masses
 * were DECLARED to meet, standing on a second justification. A mass that closed its loop
 * states nothing past its own pinch (*"the MD sand onlaps, that means it is a closed loop
 * in that gap and cannot fill the gap"*, owner 2026-08-21), so when NOBODY on either side
 * runs through, no single class may flood the leftover: the ground splits at the seam and
 * each half continues the masses of its own test.
 *
 * A PACKAGE IS WHAT THE TWO BRACKETS BRACKET. Every mass a side puts in the window must
 * BEGIN AND END inside it; a mass that runs on past a bracket is not part of a package
 * that closed here — its own contacts, and therefore its own closure, are somewhere else.
 * This is what tells the owner's CS2 gap-0 scene (two ties bracketing four masses on the
 * left and seven on the right, every one of them starting and ending between those ties)
 * from his ruled CS1 gap-7 scene, where the deep clay runs from +11.37 down to +5.96
 * through a window that ends at the short test's TD (+9.29): *"the loose sand should onlap
 * ... the clay should fill the gaps"*. The clay is the ground the window is cut out of, not
 * a package inside it, and no line stands between it and the sand that onlaps into it.
 *
 * WHAT THIS MUST NOT DO — the SF-silt fill-through (owner, ruled 2026-08-21). When one
 * side is OPEN — a band with two tied contacts, which emits nothing — and the facing mass
 * closed its loop, the open mass FILLS THROUGH and there is no line. So the predicate asks
 * about EVERY mass of both columns inside the window, and a single open mass on either
 * side is enough to answer no.
 *
 * CLOSED IS THE ENGINE'S OWN WORD FOR IT, not a re-derivation: a unit closes exactly when
 * ``drawTermination`` would draw its termination — corr 0 lenses always (ruling 8i(e)),
 * corr 1 onlaps unless ruling 8m's follow-the-tie finds the same litho on the matched
 * facing contact (that pair merges through), corr 2 is the band that emits nothing.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { matchedFacingSameLitho, tieRefFarElev, tiedContactSide } from './drawTermination'
import { effectiveCorrForSide, type EffectiveCorr } from './effectiveCorr'
import { type ResolvedTie } from './emitCurves'
import { type ColumnGeom, type UnitGeom } from './sectionGeom'

/** Small epsilon in metres — a contact that merely touches the window is not inside it. */
const ELEV_EPS = 1e-6

/** One side of a gap: its column, what it faces, and its per-unit 2/1/0 arithmetic. */
interface SideClosure {
  col: ColumnGeom
  facing: ColumnGeom
  side: 'left' | 'right'
  corr: readonly EffectiveCorr[]
}

/** Both sides' closure arithmetic for one gap, computed once per gap. */
export interface GapClosure {
  left: SideClosure
  right: SideClosure
}

/**
 * The 2/1/0 arithmetic of both sides of one gap — the SHARED ``effectiveCorrForSide``
 * source the termination sweep classifies with, so this predicate and the emission
 * cannot disagree about who closed.
 *
 * Parameters
 * ----------
 * gapIndex : number
 *     The gap (its left column's index).
 * left, right : ColumnGeom
 *     The gap's two columns.
 * activeTies : readonly ResolvedTie[]
 *     The ties that survived crossing-conflict pruning.
 * bridgeGapAnchored : ReadonlySet<string>, optional
 *     The directional jump-tie anchor set (ruling 8i(e)) — a drawn correlation is a
 *     correlation, so a bridge-anchored contact reads TIED here exactly as it does in
 *     the sweep, and the band a bridge carries is never mistaken for a closed one.
 *
 * Returns
 * -------
 * GapClosure
 *     Per-side columns + per-unit effective correlations.
 */
export function buildGapClosure(
  gapIndex: number,
  left: ColumnGeom,
  right: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  bridgeGapAnchored?: ReadonlySet<string>,
): GapClosure {
  return {
    left: {
      col: left,
      facing: right,
      side: 'left',
      corr: effectiveCorrForSide(gapIndex, 'left', left, right, left, right, activeTies, bridgeGapAnchored),
    },
    right: {
      col: right,
      facing: left,
      side: 'right',
      corr: effectiveCorrForSide(gapIndex, 'right', right, left, left, right, activeTies, bridgeGapAnchored),
    },
  }
}

/**
 * Does this one mass close its loop in this gap — i.e. would the sweep draw its
 * termination? See the module doc for why this mirrors ``drawTermination``'s own
 * contract rather than re-deciding it.
 */
function unitCloses(unit: UnitGeom, eff: EffectiveCorr, side: SideClosure): boolean {
  if (eff.corr === 2) return false // a band with two tied contacts emits nothing — it runs through
  if (eff.corr === 0) return true // ruling 8i(e): everything must lens
  // corr 1 — FOLLOW THE TIE (ruling 8m). A top-band / bridge anchor has no resolved edge to
  // follow, and those always onlap.
  const contact = tiedContactSide(eff.topTied, eff.baseTied)
  const ref = contact === 'top' ? eff.topTie : eff.baseTie
  if (ref === null || ref.kind !== 'resolved') return true
  const facingElev = tieRefFarElev(ref.tie, side.side)
  return !matchedFacingSameLitho(unit.formationId, contact, facingElev, side.facing)
}

/**
 * Does this column put a CLOSED PACKAGE in the window — every mass of it beginning and
 * ending between the two brackets, and every one of them terminating before the middle?
 *
 * ``false`` when the column has no mass in the window at all (a side that read nothing
 * here has made no statement to meet) and ``false`` when any mass runs on past a bracket
 * (see the module doc: that mass is the ground the window is cut out of).
 */
function sideCloses(side: SideClosure, topElev: number, baseElev: number): boolean {
  let saw = false
  for (let ui = 0; ui < side.col.units.length; ui++) {
    const unit = side.col.units[ui]
    const overlap = Math.min(unit.topElev, topElev) - Math.max(unit.baseElev, baseElev)
    if (overlap <= ELEV_EPS) continue
    if (unit.topElev > topElev + ELEV_EPS || unit.baseElev < baseElev - ELEV_EPS) return false
    saw = true
    const eff = side.corr[ui]
    if (eff === undefined || !unitCloses(unit, eff, side)) return false
  }
  return saw
}

/**
 * Do BOTH facing packages close at the middle over this window — the owner's
 * *"in this case i'd rather have a vertical line"*?
 *
 * Parameters
 * ----------
 * closure : GapClosure
 *     The gap's per-side arithmetic (``buildGapClosure``).
 * leftTop, leftBase : number
 *     The window's bracket elevations ON THE LEFT COLUMN (the brackets slope, so each
 *     column reads its own end of them).
 * rightTop, rightBase : number
 *     The same two brackets at the right column.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when every mass of both columns inside the window terminates — nobody
 *     runs through, so the leftover between the two closed packages is split by the
 *     vertical line rather than flooded by one class.
 */
export function bothSidesCloseAtTheMiddle(
  closure: GapClosure,
  leftTop: number,
  leftBase: number,
  rightTop: number,
  rightBase: number,
): boolean {
  return (
    sideCloses(closure.left, leftTop, leftBase) && sideCloses(closure.right, rightTop, rightBase)
  )
}
