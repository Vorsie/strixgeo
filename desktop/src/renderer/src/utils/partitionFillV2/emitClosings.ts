/**
 * partitionFillV2/emitClosings.ts — synthesized CLOSING curves (design §2, §4).
 *
 * A boundary that has no tie to continue on is closed with synthesized pinch/apex
 * geometry (design §2 curve type 4). This module walks each column's units per
 * adjacent gap and, for a unit with fewer than two tied contacts toward the facing
 * column, emits the open-side closing curve(s):
 *
 *  - 0 tied contacts -> LENS: a pinch apex at ``LENS_PINCH_FRACTION`` at the unit's
 *    own mid-elevation (own-elevation apex — geologically the lens terminates at
 *    its own level). Two closing curves (top->apex, apex->base).
 *  - exactly 1 tied contact -> ONLAP: the open side pinches to a tip at
 *    ``INTERIOR_PINCH_FRACTION`` ON the tied bracket tie-line (laps up when the top
 *    is tied, down when the base is tied), own-band-clamped. The tied side is
 *    carried by the tie curve (split at the tip); only the open-side closing curve
 *    is emitted.
 *
 * Per-body lensApex overrides and freedraw boundary nodes REPLACE the synthesized
 * apex/tip (design §4). Deep-to-deep substrate bridges below a shallow TD are
 * DEFERRED to increment 3 (marked below).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { INTERIOR_PINCH_FRACTION, LENS_PINCH_FRACTION } from '../partitionFill'
import { type ResolvedTie } from './emitCurves'
import { type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * Emit the synthesized closing curves for every under-tied unit in every gap.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section.
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning (they carry the tied contacts).
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 */
export function emitClosingCurves(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  out: InputCurve[],
  bridgeAnchored: ReadonlySet<string>,
): void {
  const { columns } = section

  // Per (gap, side, unitIndex, contactSide) tie lookup: the ResolvedTie whose
  // endpoint sits on that unit's top / base contact toward the facing column. Used
  // so an onlap tip lands ON the tied bracket line (interpolated between the tie's
  // two endpoints), not at the unit's own elevation.
  const tieAt = new Map<string, ResolvedTie>()
  const tieKey = (gap: number, side: 'left' | 'right', ui: number, c: 'top' | 'base'): string =>
    `${gap}|${side}|${ui}|${c}`
  // A tie on a unit's TOP contact ALSO ties the BASE of the unit immediately above
  // it (its base IS this unit's top — v1 ``classifyTermination`` case (a)): the
  // same tie line therefore addresses two units' contacts. Register both so a unit
  // sandwiched between two top-ties reads as fully banded (2 tied contacts).
  const register = (t: ResolvedTie, side: 'left' | 'right', ui: number, c: 'top' | 'base'): void => {
    tieAt.set(tieKey(t.gapIndex, side, ui, c), t)
    if (c === 'top' && ui > 0) tieAt.set(tieKey(t.gapIndex, side, ui - 1, 'base'), t)
  }
  for (const t of activeTies) {
    register(t, 'left', t.leftUnitIndex, t.leftSide)
    register(t, 'right', t.rightUnitIndex, t.rightSide)
  }

  let closeSeq = 0
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    const gapWidth = right.x - left.x
    // LEFT column units close into the gap to their RIGHT; RIGHT units to their LEFT.
    // The column INDEX (gi / gi+1) resolves each unit's bridge-anchored contacts.
    emitColumnClosings(gi, gi, 'left', left, gapWidth, tieAt, tieKey, bridgeAnchored, section, () => `close${closeSeq++}`, out)
    emitColumnClosings(gi, gi + 1, 'right', right, gapWidth, tieAt, tieKey, bridgeAnchored, section, () => `close${closeSeq++}`, out)
  }
}

/** Interpolate the elevation on a resolved tie line at along-section position x. */
function tieElevAtX(tie: ResolvedTie, x: number): number {
  const dx = tie.right.x - tie.left.x
  if (Math.abs(dx) < 1e-9) return (tie.left.y + tie.right.y) / 2
  const t = (x - tie.left.x) / dx
  return tie.left.y + t * (tie.right.y - tie.left.y)
}

/**
 * Emit closing curves for one column's units into one adjacent gap.
 *
 * ``side`` = which column of the gap this is (``left`` closes rightward, ``right``
 * closes leftward). A unit with 0 tied contacts closes as a LENS; with exactly 1,
 * as an ONLAP riding the tied bracket tie-line.
 */
function emitColumnClosings(
  gapIndex: number,
  colIndex: number,
  side: 'left' | 'right',
  col: ColumnGeom,
  gapWidth: number,
  tieAt: ReadonlyMap<string, ResolvedTie>,
  tieKey: (gap: number, side: 'left' | 'right', ui: number, c: 'top' | 'base') => string,
  bridgeAnchored: ReadonlySet<string>,
  section: SectionInput,
  nextId: () => string,
  out: InputCurve[],
): void {
  const dir = side === 'left' ? 1 : -1 // into the gap
  const colX = col.x

  for (let ui = 0; ui < col.units.length; ui++) {
    const u = col.units[ui]
    // A unit whose top OR base contact is carried by a deep-to-deep substrate
    // BRIDGE is bounded by that bridge curve — it must not ALSO pinch to a lens /
    // onlap apex into the gap (the CS1 gap-7 deep-anchor units would otherwise
    // paint lens wedges over the bridged bands). The bridge is the boundary.
    if (
      bridgeAnchored.has(`${colIndex}|${ui}|top`) ||
      bridgeAnchored.has(`${colIndex}|${ui}|base`)
    ) {
      continue
    }
    const topTie = tieAt.get(tieKey(gapIndex, side, ui, 'top'))
    const baseTie = tieAt.get(tieKey(gapIndex, side, ui, 'base'))
    const nTied = (topTie ? 1 : 0) + (baseTie ? 1 : 0)
    if (nTied === 2) continue // band — both sides carried by ties, no closing.

    const override = lookupOverride(section, u, gapIndex)

    if (nTied === 0) {
      emitLensClosing(u, colX, dir, gapWidth, side, override, nextId, out)
    } else {
      const isTopTied = topTie != null
      const tie = (isTopTied ? topTie : baseTie) as ResolvedTie
      emitOnlapClosing(u, colX, dir, gapWidth, side, isTopTied, tie, override, nextId, out)
    }
  }
}

/**
 * LENS closing: two curves top->apex and apex->base. Apex at
 * ``LENS_PINCH_FRACTION`` of the gap width at the unit's own mid-elevation, unless
 * an override / freedraw shape replaces it.
 */
function emitLensClosing(
  u: UnitGeom,
  colX: number,
  dir: number,
  gapWidth: number,
  side: 'left' | 'right',
  override: OverrideShape | undefined,
  nextId: () => string,
  out: InputCurve[],
): void {
  const topPt: Point = { x: colX, y: u.topElev }
  const basePt: Point = { x: colX, y: u.baseElev }

  if (override?.freedraw) {
    emitFreedrawClosing(topPt, basePt, colX, gapWidth, side, override.freedraw, nextId, out)
    return
  }
  const apexFrac = override?.fraction ?? (side === 'left' ? LENS_PINCH_FRACTION : 1 - LENS_PINCH_FRACTION)
  const apexElev = override?.elevation ?? (u.topElev + u.baseElev) / 2
  // fraction is gap-local 0..1 (0 = left column). Convert to alongM.
  const apexX = colX + dir * gapLocalToDist(apexFrac, side, gapWidth)
  const apex: Point = { x: apexX, y: apexElev }
  out.push({ id: nextId(), kind: 'closing', points: [topPt, apex] })
  out.push({ id: nextId(), kind: 'closing', points: [apex, basePt] })
}

/**
 * ONLAP closing (exactly one tied contact): the unit's OPEN side pinches up/down
 * to a tip that sits ON the TIED bracket tie-line at ``INTERIOR_PINCH_FRACTION``
 * (design §2 — "riding a bracket tie-line for part of its run"). The tie curve
 * carries the tied side from the unit's tied corner out to the tip; here we emit
 * only the open-side closing curve (open corner -> tip). The arrangement splits
 * the tie at the tip, so the face is [tied corner -> tip (on the tie) -> open
 * corner -> tied corner] — bounded by the column vertical + a tie segment + one
 * closing curve -> ONLAP.
 *
 * Own-band clamp (v1 owner rule 2, ``buildOnlapPolygon``): if the tie line has
 * risen above the unit's own top (or fallen below its base) before the tip, the
 * tip is pulled back to where the tie crosses that own bound, so the onlap never
 * leaves its own [base..top] band.
 */
function emitOnlapClosing(
  u: UnitGeom,
  colX: number,
  dir: number,
  gapWidth: number,
  side: 'left' | 'right',
  isTopTied: boolean,
  tie: ResolvedTie,
  override: OverrideShape | undefined,
  nextId: () => string,
  out: InputCurve[],
): void {
  const topPt: Point = { x: colX, y: u.topElev }
  const basePt: Point = { x: colX, y: u.baseElev }

  if (override?.freedraw) {
    emitFreedrawClosing(topPt, basePt, colX, gapWidth, side, override.freedraw, nextId, out)
    return
  }
  const tipFrac = override?.fraction ?? (side === 'left' ? INTERIOR_PINCH_FRACTION : 1 - INTERIOR_PINCH_FRACTION)
  let tipX = colX + dir * gapLocalToDist(tipFrac, side, gapWidth)
  let tipElev = override?.elevation ?? tieElevAtX(tie, tipX)

  // Own-band clamp: the tie may climb past the unit's own bound before the tip.
  // Solve where the tie line crosses that bound along colX -> tipX and stop there.
  if (tipElev > u.topElev + ELEV_EPS || tipElev < u.baseElev - ELEV_EPS) {
    const bound = tipElev > u.topElev ? u.topElev : u.baseElev
    const e0 = tieElevAtX(tie, colX) // tie elevation at the unit's own column
    const denom = tipElev - e0
    const t = Math.abs(denom) < ELEV_EPS ? 0 : Math.max(0, Math.min(1, (bound - e0) / denom))
    tipX = colX + t * (tipX - colX)
    tipElev = bound
  }

  const tip: Point = { x: tipX, y: tipElev }
  const openCorner: Point = isTopTied ? basePt : topPt
  // Open corner -> tip. The tied corner -> tip run is the tie curve (split at tip).
  out.push({ id: nextId(), kind: 'closing', points: [openCorner, tip] })
}

/**
 * Freedraw closing: user-authored nodes REPLACE the synthesized apex/tip. The
 * upper edge runs from the top corner out along ``upper`` (fraction-ascending on
 * the LEFT, descending on the RIGHT); the lower edge returns along ``lower`` to
 * the base corner. Mirrors v1 ``buildFreedrawLensOutline`` vertex order.
 */
function emitFreedrawClosing(
  topPt: Point,
  basePt: Point,
  colX: number,
  gapWidth: number,
  side: 'left' | 'right',
  fd: { upper: { fraction: number; elevation: number }[]; lower: { fraction: number; elevation: number }[] },
  nextId: () => string,
  out: InputCurve[],
): void {
  const dir = side === 'left' ? 1 : -1
  const toPt = (n: { fraction: number; elevation: number }): Point => ({
    x: colX + dir * gapLocalToDist(n.fraction, side, gapWidth),
    y: n.elevation,
  })
  const upper = [...fd.upper].sort((a, b) => a.fraction - b.fraction).map(toPt)
  const lower = [...fd.lower].sort((a, b) => b.fraction - a.fraction).map(toPt)
  const ring: Point[] = [topPt, ...upper, ...lower, basePt]
  // Emit as one polyline; the arrangement splits/closes it against the column.
  out.push({ id: nextId(), kind: 'closing', points: ring })
}

/**
 * Convert a gap-local fraction (0 = left column, 1 = right column) to a DISTANCE
 * in metres from the emitting column into the gap.
 */
function gapLocalToDist(fraction: number, side: 'left' | 'right', gapWidth: number): number {
  return side === 'left' ? fraction * gapWidth : (1 - fraction) * gapWidth
}

// ---------------------------------------------------------------------------
// Overrides
// ---------------------------------------------------------------------------

/** A resolved apex/freedraw override for one unit in one gap. */
interface OverrideShape {
  fraction?: number
  elevation?: number
  freedraw?: {
    upper: { fraction: number; elevation: number }[]
    lower: { fraction: number; elevation: number }[]
  }
}

/**
 * Look up a per-body lens-apex override for a unit in a gap. Keyed by
 * ``lensApexOverrideKey(bodyId, gapIndex)`` (v1 semantics). A freedraw shape
 * (``upper``/``lower`` present) takes precedence over the single apex.
 */
function lookupOverride(
  section: SectionInput,
  u: UnitGeom,
  gapIndex: number,
): OverrideShape | undefined {
  if (!section.lensApexOverrides || u.bodyId == null) return undefined
  const ov = section.lensApexOverrides.get(`${u.bodyId}@${gapIndex}`)
  if (!ov) return undefined
  if (ov.upper?.length || ov.lower?.length) {
    return { freedraw: { upper: ov.upper ?? [], lower: ov.lower ?? [] } }
  }
  return { fraction: ov.fraction, elevation: ov.elevation }
}
