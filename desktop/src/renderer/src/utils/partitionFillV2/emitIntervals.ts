/**
 * partitionFillV2/emitIntervals.ts — VACANCY-CLOSURE closing curves (design
 * partition-engine-v2.md §4 "Vacancy closure at terminations", increment 4).
 *
 * The v1 engine fills the space between two tie-anchored bands by TILING it: all
 * untied units in the interval are laid side-by-side as opposing pinches that meet
 * at a SEAM (``emit.ts`` ``emitInterval`` — "two-pieces-plus-filler"). The seam
 * fraction is the thickness-weighted meeting point, EXCEPT for a mismatched matrix
 * bracketed above AND below (one left + one right unit of DIFFERENT lithology),
 * which meets at the STRAIGHT MIDPOINT (0.5) — the owner-validated "no auto-facies"
 * rule (a facies/disturbed contact is the engineer's explicit call, never a
 * geometric inference). This tiling is what makes the interval GAP-FREE.
 *
 * v2 expresses the same semantics as CURVES the planar arrangement traces, not as
 * pre-built polygons: for each interval on each gap we emit
 *   - one vertical SEAM curve at the meet fraction (interval top -> interval base),
 *     splitting the interval into a left-claim cell and a right-claim cell;
 *   - horizontal SUB-SEAM curves from each column vertical to the seam at every
 *     internal boundary between stacked untied units on that side, so each untied
 *     unit gets its own cell.
 * The arrangement then traces each cell as a face bounded by the column vertical +
 * the bracketing interfaces (surface / tie lines already emitted) + the seam curves;
 * ``labelFaces`` reads the column-vertical contact for its formation. No overlays,
 * no carve — the interval is a true partition BY CONSTRUCTION.
 *
 * A lone side (only left or only right untied units) fills the WHOLE interval width
 * (meet fraction 1 or 0): the vacated space is claimed continuously by the present
 * side, matching v1's ``meetFraction = 1``/``0`` lone-side case.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { LENS_PINCH_FRACTION } from '../partitionFill'
import { type ResolvedTie } from './emitCurves'
import { emitLensClosing, extractEnclosedLenses, type IntervalUnit } from './emitIntervalLenses'
import { type ColumnGeom, type SectionInput } from './sectionGeom'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6
/** Fraction epsilon — a seam this close to a column vertical is a no-op. */
const FRAC_EPS = 1e-9

/**
 * A per-column contact that a tie or bridge anchors — the interval BRACKET. Each
 * carries the anchor elevation on the emitting column and the facing column (so the
 * bracketing interface is a straight line between them). ``depthOrder`` is the
 * emitting column's depth (surface - elev) used only to order brackets top->down.
 */
interface Bracket {
  /** Elevation on the LEFT column of the interface line this bracket defines. */
  leftElev: number
  /** Elevation on the RIGHT column of the interface line. */
  rightElev: number
}

/**
 * Emit vacancy-closure interval-tiling curves for every gap.
 *
 * Replaces the per-unit lens / onlap triangle closings (design §4 increment 4):
 * instead of each untied unit pinching to its own apex (which left the vacated space
 * between apexes empty — the 274 above-TD holes), the untied units of each interval
 * TILE it fully, meeting at a seam.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     Normalised section (columns carry elevations + x).
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning.
 * bridgeAnchored : ReadonlySet<string>
 *     ``ci|ui|top`` / ``ci|ui|base`` contacts carried by a deep-to-deep bridge.
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 */
export function emitIntervalCurves(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  out: InputCurve[],
): void {
  const { columns } = section
  let seq = 0
  const nextId = (): string => `close${seq++}`
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    emitGapIntervals(gi, columns[gi], columns[gi + 1], activeTies, bridgeAnchored, nextId, out)
  }
}

/**
 * Which of a unit's two contacts (top / base) are TIED toward the facing column in
 * this gap. A top-tie on unit ``k`` also ties the BASE of unit ``k-1`` (a contact
 * is the shared boundary between the two units — v1 ``classifyTermination`` case
 * (a)); a bridge-anchored contact counts as tied too.
 */
function tiedContacts(
  gapIndex: number,
  side: 'left' | 'right',
  colIndex: number,
  nUnits: number,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
): { top: boolean; base: boolean }[] {
  const flags = Array.from({ length: nUnits }, () => ({ top: false, base: false }))
  // v1 ``classifyTermination`` asymmetry (matcher.ts): a unit's TOP contact counts
  // as tied only via its OWN top edge; its BASE contact counts via the unit-BELOW's
  // top edge OR its own base edge. So a TOP tie on unit k anchors k.top AND (the
  // shared contact) k-1.base; a BASE tie on unit k anchors ONLY k.base — it does
  // NOT make the unit below's top read as tied (that unit needs its own edge). This
  // is what keeps a unit sandwiched between two BAND edges (top-silt base + bot-silt
  // top) an ONLAP, not a spurious band.
  const setTop = (ui: number): void => {
    if (ui < 0 || ui >= nUnits) return
    flags[ui].top = true
    if (ui > 0) flags[ui - 1].base = true // the top contact IS the unit-above's base
  }
  const setBase = (ui: number): void => {
    if (ui < 0 || ui >= nUnits) return
    flags[ui].base = true
  }
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    const ui = side === 'left' ? t.leftUnitIndex : t.rightUnitIndex
    const s = side === 'left' ? t.leftSide : t.rightSide
    if (s === 'top') setTop(ui)
    else setBase(ui)
  }
  for (let ui = 0; ui < nUnits; ui++) {
    if (bridgeAnchored.has(`${colIndex}|${ui}|top`)) setTop(ui)
    if (bridgeAnchored.has(`${colIndex}|${ui}|base`)) setBase(ui)
  }
  return flags
}

/**
 * Emit the interval-tiling curves for ONE gap.
 *
 * The BRACKETS are the interval boundaries: the surface, every tie/bridge anchor
 * line across the gap, and the shallow TD (the fill floor — sub-TD stays empty,
 * owner §8 Q3). Between two consecutive brackets sits an interval; the untied left
 * and right units whose span falls in that interval tile it, meeting at a seam.
 */
function emitGapIntervals(
  gapIndex: number,
  left: ColumnGeom,
  right: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  nextId: () => string,
  out: InputCurve[],
): void {
  const leftFlags = tiedContacts(gapIndex, 'left', gapIndex, left.units.length, activeTies, bridgeAnchored)
  const rightFlags = tiedContacts(gapIndex, 'right', gapIndex + 1, right.units.length, activeTies, bridgeAnchored)

  // Build the bracket lines: surface (top), each tie/bridge anchor line, then the
  // shallow-TD floor. Each bracket is an interface (leftElev, rightElev) — a
  // straight line across the gap. Brackets are ordered top (shallow) -> bottom.
  const brackets: Bracket[] = []
  brackets.push({ leftElev: left.surfaceElevM, rightElev: right.surfaceElevM })
  const anchorLines = collectAnchorLines(gapIndex, left, right, activeTies, bridgeAnchored)
  for (const a of anchorLines) brackets.push(a)
  // Fill floor: the shallow TD (the higher of the two columns' base elevations).
  // Below this only bridges may fill; a vacancy floor deeper than this would tile
  // into the sub-TD void (owner Q3 — stays empty).
  const leftTD = left.units[left.units.length - 1].baseElev
  const rightTD = right.units[right.units.length - 1].baseElev
  const shallowTD = Math.max(leftTD, rightTD)
  brackets.push({ leftElev: shallowTD, rightElev: shallowTD })

  // Deduplicate + sort brackets by mid-elevation, shallow (high) -> deep (low).
  const mid = (b: Bracket): number => (b.leftElev + b.rightElev) / 2
  brackets.sort((a, b) => mid(b) - mid(a))
  const uniq: Bracket[] = []
  for (const b of brackets) {
    const prev = uniq[uniq.length - 1]
    if (prev && Math.abs(prev.leftElev - b.leftElev) < ELEV_EPS && Math.abs(prev.rightElev - b.rightElev) < ELEV_EPS)
      continue
    uniq.push(b)
  }

  // Walk each interval [topBracket, baseBracket] and tile the untied units inside.
  let floorReached = false
  for (let bi = 0; bi + 1 < uniq.length; bi++) {
    const top = uniq[bi]
    const base = uniq[bi + 1]
    // Skip a fully sub-TD interval (both sides below the shallow TD).
    if (mid(top) <= shallowTD + ELEV_EPS) continue
    const leftUnits = untiedUnitsInInterval(left, leftFlags, top.leftElev, base.leftElev, 'left')
    const rightUnits = untiedUnitsInInterval(right, rightFlags, top.rightElev, base.rightElev, 'right')
    if (leftUnits.length === 0 && rightUnits.length === 0) continue
    tileInterval(left, right, top, base, leftUnits, rightUnits, nextId, out)
    // A tiled interval whose BASE is the shallow-TD floor needs an explicit floor
    // curve to CLOSE it from below — the surface / tie-line brackets are already
    // arrangement curves, but the shallow-TD floor is not (sub-TD stays empty,
    // owner Q3, so the fill must cap there). One floor segment per gap suffices.
    if (Math.abs(mid(base) - shallowTD) < ELEV_EPS) floorReached = true
  }
  if (floorReached) {
    out.push({
      id: nextId(),
      kind: 'closing',
      points: [
        { x: left.x, y: shallowTD },
        { x: right.x, y: shallowTD },
      ],
    })
  }
}

/**
 * Collect every tie / bridge anchor's interface line across this gap. A tie anchors
 * a line from its left endpoint to its right endpoint; a bridge that passes through
 * this gap anchors the segment of its polyline over [left.x, right.x].
 */
function collectAnchorLines(
  gapIndex: number,
  left: ColumnGeom,
  right: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
): Bracket[] {
  const lines: Bracket[] = []
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    lines.push({ leftElev: t.left.y, rightElev: t.right.y })
  }
  // Bridge-anchored contacts become horizontal-ish bracket lines from the left
  // column contact elevation to the right column contact elevation. We reconstruct
  // the line from the two columns' anchored contacts at matching depth ranks — but
  // the bridge polyline already crosses the gap, so approximate the bracket as the
  // straight line between the anchored contacts nearest in elevation.
  const bridgeElevs = (col: ColumnGeom, colIndex: number): number[] => {
    const es: number[] = []
    for (let ui = 0; ui < col.units.length; ui++) {
      if (bridgeAnchored.has(`${colIndex}|${ui}|top`)) es.push(col.units[ui].topElev)
      if (bridgeAnchored.has(`${colIndex}|${ui}|base`)) es.push(col.units[ui].baseElev)
    }
    return es
  }
  const lE = bridgeElevs(left, gapIndex)
  const rE = bridgeElevs(right, gapIndex + 1)
  // Pair them in sorted order (deepest bridge lines matter for the interval floor).
  const ls = [...lE].sort((a, b) => b - a)
  const rs = [...rE].sort((a, b) => b - a)
  const n = Math.min(ls.length, rs.length)
  for (let i = 0; i < n; i++) lines.push({ leftElev: ls[i], rightElev: rs[i] })
  return lines
}

/**
 * The untied units of one column whose span overlaps the interval [topElev,
 * baseElev] on that column, top->down. A unit is "in the interval" if its own span
 * intersects it; it is UNTIED when neither of its contacts is tied (a fully banded
 * unit is carried by the arrangement's tie curves, not tiled here). Its span is
 * CLAMPED to the interval so the sub-seams line up with the bracket interfaces.
 */
function untiedUnitsInInterval(
  col: ColumnGeom,
  flags: { top: boolean; base: boolean }[],
  topElev: number,
  baseElev: number,
  side: 'left' | 'right',
): IntervalUnit[] {
  void side
  const out: IntervalUnit[] = []
  for (let ui = 0; ui < col.units.length; ui++) {
    const u = col.units[ui]
    // Fully banded (both contacts tied) → carried by the tie curves, not tiled.
    if (flags[ui].top && flags[ui].base) continue
    // Overlap of the unit's span with the interval.
    const spanTop = Math.min(u.topElev, topElev)
    const spanBase = Math.max(u.baseElev, baseElev)
    if (spanTop - spanBase <= ELEV_EPS) continue // no overlap
    out.push({ unit: u, topElev: spanTop, baseElev: spanBase })
  }
  return out
}

/**
 * Tile one interval: emit the seam + sub-seam curves so the untied left and right
 * units each get their own gap-filling cell.
 *
 * The meet fraction follows v1 ``emitInterval``:
 *   - lone side (only left OR only right) → the present side fills the whole width
 *     (meet 1 for left-only, 0 for right-only);
 *   - one left + one right of DIFFERENT lithology → MIDPOINT 0.5 (no-auto-facies);
 *   - otherwise → thickness-weighted (sumLeft / (sumLeft + sumRight)).
 */
function tileInterval(
  left: ColumnGeom,
  right: ColumnGeom,
  top: Bracket,
  base: Bracket,
  leftUnits: IntervalUnit[],
  rightUnits: IntervalUnit[],
  nextId: () => string,
  out: InputCurve[],
): void {
  const leftX = left.x
  const rightX = right.x

  // Enclosed-minority extraction (v1 step-0 semantics): a unit whose OWN-side
  // neighbours above AND below share ONE formation different from its own is a LENS
  // — it terminates at its own stratigraphic level, pinching to a 0.45 apex, while
  // the enclosing matrix connects continuously (design §4 "enclosed minorities flow
  // through the ordinary 0-tied lens closing path"). Extract them BEFORE tiling so
  // the remaining matrix reduces to one unit per side and connects as a band; the
  // lens CLOSING curves are emitted after ``meet`` is known so their apex can be
  // clamped INSIDE the matrix cell (a 0.45 apex must not spill past the seam).
  const leftLenses: IntervalUnit[] = []
  const rightLenses: IntervalUnit[] = []
  const leftMatrix = extractEnclosedLenses(leftUnits, leftLenses)
  const rightMatrix = extractEnclosedLenses(rightUnits, rightLenses)
  if (leftMatrix.length === 0 && rightMatrix.length === 0) return

  // The seam must sit strictly OUTSIDE each lens-bearing side's apex — a small margin
  // PAST 0.45 — so the enclosed lens stays a hole fully inside its own matrix cell and
  // never touches the seam. This is the v1 ``carveOverlays`` job, done here by WIDENING
  // the cell instead of subtracting the overlap. An apex sitting exactly ON the seam
  // creates a degenerate 3-face junction that leaves a triangle uncovered (the TS6
  // VEEN-above hole), so the margin is mandatory, not cosmetic.
  let meet = meetFraction(leftMatrix, rightMatrix)
  const LENS_MARGIN = 0.03
  if (leftLenses.length > 0) meet = Math.max(meet, LENS_PINCH_FRACTION + LENS_MARGIN)
  if (rightLenses.length > 0) meet = Math.min(meet, 1 - LENS_PINCH_FRACTION - LENS_MARGIN)
  const seamX = leftX + meet * (rightX - leftX)
  // Emit each extracted lens at its 0.45 own-elevation apex (now guaranteed inside
  // its widened matrix cell).
  for (const u of leftLenses) emitLensClosing(u, leftX, rightX, LENS_PINCH_FRACTION, nextId, out)
  for (const u of rightLenses) emitLensClosing(u, rightX, leftX, LENS_PINCH_FRACTION, nextId, out)

  // The seam interface elevations at the meet fraction (linear across the interval
  // top and base brackets).
  const seamTopElev = top.leftElev + meet * (top.rightElev - top.leftElev)
  const seamBaseElev = base.leftElev + meet * (base.rightElev - base.leftElev)

  // The vertical SEAM curve at seamX from the top interface to the base interface.
  // When the two lithologies mismatch this is the straight midpoint seam; when a
  // side is lone (meet 0 or 1) the seam coincides with that column vertical and is
  // a zero-width no-op (skipped).
  if (meet > FRAC_EPS && meet < 1 - FRAC_EPS) {
    out.push({
      id: nextId(),
      kind: 'closing',
      points: [
        { x: seamX, y: seamTopElev },
        { x: seamX, y: seamBaseElev },
      ],
    })
  }

  // Sub-seam curves: within each side's [column, seam] cell, cut a horizontal-ish
  // divider at every internal boundary between stacked units so each untied unit
  // gets its own face. The interval top/base brackets already bound the outermost
  // units; only the internal boundaries need a curve.
  emitSideSubSeams(leftMatrix, leftX, seamX, top.leftElev, base.leftElev, seamTopElev, seamBaseElev, nextId, out)
  emitSideSubSeams(rightMatrix, rightX, seamX, top.rightElev, base.rightElev, seamTopElev, seamBaseElev, nextId, out)
}

/**
 * Emit the internal sub-seam dividers for one side's stacked units. Each divider is
 * a line from the column edge (at the boundary elevation between two consecutive
 * units) to the seam (at the interpolated elevation). The outermost boundaries (the
 * interval top / base) are already the bracket interfaces, so we only cut BETWEEN
 * consecutive units.
 */
function emitSideSubSeams(
  units: IntervalUnit[],
  colX: number,
  seamX: number,
  colTopElev: number,
  colBaseElev: number,
  seamTopElev: number,
  seamBaseElev: number,
  nextId: () => string,
  out: InputCurve[],
): void {
  if (units.length <= 1) return
  if (Math.abs(seamX - colX) < 1e-9) return // lone-opposite side: no cell on this side
  const colSpan = colTopElev - colBaseElev
  if (colSpan <= ELEV_EPS) return
  // Consecutive internal boundaries are the base elevations of all but the last unit.
  for (let i = 0; i + 1 < units.length; i++) {
    const boundaryElev = units[i].baseElev
    // Fraction of the column span this boundary sits at (0 = top, 1 = base).
    const t = (colTopElev - boundaryElev) / colSpan
    const seamElev = seamTopElev + t * (seamBaseElev - seamTopElev)
    out.push({
      id: nextId(),
      kind: 'closing',
      points: [
        { x: colX, y: boundaryElev },
        { x: seamX, y: seamElev },
      ],
    })
  }
}

/**
 * v1 ``emitInterval`` meeting-fraction rule (``emit.ts``):
 *   lone left  -> 1 (fills to the right column)
 *   lone right -> 0
 *   1 left + 1 right, DIFFERENT lithology -> 0.5 (mismatched matrix, midpoint seam)
 *   otherwise -> thickness-weighted sumLeft / (sumLeft + sumRight).
 */
function meetFraction(leftUnits: IntervalUnit[], rightUnits: IntervalUnit[]): number {
  if (leftUnits.length > 0 && rightUnits.length === 0) return 1
  if (rightUnits.length > 0 && leftUnits.length === 0) return 0
  if (
    leftUnits.length === 1 &&
    rightUnits.length === 1 &&
    leftUnits[0].unit.formationId !== rightUnits[0].unit.formationId
  ) {
    return 0.5
  }
  const sumLeft = leftUnits.reduce((s, u) => s + Math.max(0, u.topElev - u.baseElev), 0)
  const sumRight = rightUnits.reduce((s, u) => s + Math.max(0, u.topElev - u.baseElev), 0)
  return sumLeft + sumRight > ELEV_EPS ? sumLeft / (sumLeft + sumRight) : 0.5
}
