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

import { LENS_PINCH_FRACTION } from '../sectionPartition'
import { collectGapBands, emitBandContourCurve, emitSideSubSeams, meetFraction, untiedUnitsInInterval, type GapBand } from './emitBands'
import { type ResolvedTie } from './emitCurves'
import { effectiveCorrForSide, tiedFlags, type EffectiveCorr } from './effectiveCorr'
import { emitLensClosing, extractEnclosedLenses, type IntervalUnit } from './emitIntervalLenses'
import { type LensLabel } from './emitLenses'
import { routeLoneSidePinch } from './emitLonePinch'
import { firstLithoTopElev, type ColumnGeom, type SectionInput } from './sectionGeom'
import { seamAnchorOnBracket } from './seamAnchor'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6
/** Fraction epsilon — a seam this close to a column vertical is a no-op. */
const FRAC_EPS = 1e-9

/** Layer ids whose TOP / BASE contact is tied across a gap (v1 ``kindFor`` input). */
export interface TiedContacts {
  top: Set<string>
  base: Set<string>
}

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
  /**
   * Whether this bracket is a real tie/bridge ANCHOR (vs the section surface or the
   * shallow-TD fill floor). Only an interval bounded by anchors on BOTH sides is
   * "bracketed" in v1's sense — the midpoint no-auto-facies seam fires only there
   * (``emit.ts`` ``mismatchedMatrix`` gate); a surface/floor-bounded pair keeps the
   * thickness weight.
   */
  anchor: boolean
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
 * lensLabels : Map<string, LensLabel>
 *     Shared label map — a lone-side pinch's flood-wedge curves register their
 *     bracket-matrix formation here (consumed by ``labelFaces``, finding A).
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 */
export function emitIntervalCurves(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  const { columns } = section
  let seq = 0
  const nextId = (): string => `close${seq++}`
  // Flood-wedge curves (emitLonePinch) get their OWN ``flood`` id prefix — ``labelFaces``
  // stamps a flood-bounded wedge from its bracket-matrix label as a BAND (finding A).
  let fseq = 0
  const nextFloodId = (): string => `flood${fseq++}`
  // Band-contour curves get their OWN ``bandc`` id prefix — ``labelFaces`` counts it
  // as NEITHER a tie nor a closing, so the band face (tie + column verticals + these
  // contours) still classifies as BAND and an adjacent fill abutting a contour is not
  // mis-promoted to onlap.
  let bseq = 0
  const nextBandId = (): string => `bandc${bseq++}`
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    // Matched-pair bands (v1 ``matchColumns`` semantics): a top-tie (or base-tie)
    // pair of same-formation facing units is a full-width band whose OWN base (top)
    // contour brackets the interval below (above) it. Band-first tiling (design §4
    // increment-7): the band's boundaries become BRACKET LINES so a facing untied
    // unit tiles only the residue OUTSIDE the band — its lone-side fill stops at the
    // band boundary instead of overrunning the band interior (cs1bandauthority).
    const bands = collectGapBands(gi, columns[gi], columns[gi + 1], activeTies)
    // Per-gap effective corr (2/1/0) for both columns — computed once per gap (shared
    // with the conformance gate's ``effectiveCorr`` arithmetic). Historical note: this
    // used to also feed the in-file cut-over branch, deleted in session 36.
    const leftCorr = effectiveCorrForSide(gi, 'left', columns[gi], columns[gi + 1], columns[gi], columns[gi + 1], activeTies)
    const rightCorr = effectiveCorrForSide(gi, 'right', columns[gi + 1], columns[gi], columns[gi], columns[gi + 1], activeTies)
    emitGapIntervals(gi, columns[gi], columns[gi + 1], activeTies, bridgeAnchored, bands, leftCorr, rightCorr, nextId, nextBandId, nextFloodId, lensLabels, out)
  }
}

/**
 * Which of a unit's two contacts (top / base) are TIED toward the facing column in
 * this gap. A top-tie on unit ``k`` also ties the BASE of unit ``k-1`` (a contact
 * is the shared boundary between the two units — v1 ``classifyTermination`` case
 * (a)); a bridge-anchored contact counts as tied too.
 *
 * The direct/derived-tie pass is the SHARED ``tiedFlags`` (``effectiveCorr.ts`` — the
 * single source of truth the conformance gate consumes too, ruling 8c). This function
 * layers the engine-only BRIDGE-anchor extension on top: a deep-to-deep bridge that
 * carries a unit's top/base contact ties it exactly as a correlation edge would (the
 * same setTop/setBase asymmetry, so a bridged top also derives the unit-above's base).
 */
function tiedContacts(
  gapIndex: number,
  side: 'left' | 'right',
  colIndex: number,
  nUnits: number,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
): { top: boolean; base: boolean }[] {
  const flags = tiedFlags(gapIndex, side, nUnits, activeTies)
  const setTop = (ui: number): void => {
    if (ui < 0 || ui >= nUnits) return
    flags[ui].top = true
    if (ui > 0) flags[ui - 1].base = true // the top contact IS the unit-above's base
  }
  const setBase = (ui: number): void => {
    if (ui < 0 || ui >= nUnits) return
    flags[ui].base = true
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
  bands: readonly GapBand[],
  leftCorr: readonly EffectiveCorr[],
  rightCorr: readonly EffectiveCorr[],
  nextId: () => string,
  nextBandId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  const leftFlags = tiedContacts(gapIndex, 'left', gapIndex, left.units.length, activeTies, bridgeAnchored)
  const rightFlags = tiedContacts(gapIndex, 'right', gapIndex + 1, right.units.length, activeTies, bridgeAnchored)
  // Per-layerId tied-contact sets (v1 ``kindFor``): a lone boundary minority whose
  // bracketing contact is TIED terminates as an ONLAP (laps the bracket, apex 0.5),
  // UNTIED as a LENS (own-elevation, 0.45). The single-unit lone-pinch path reads these
  // to decide (increment 17 residual (ii)); without them every single-unit lone pinch
  // lenses, which mis-shapes a base-tied boundary unit v1 renders as an onlap.
  const tiedOf = (col: ColumnGeom, flags: { top: boolean; base: boolean }[]): TiedContacts => {
    const t: TiedContacts = { top: new Set<string>(), base: new Set<string>() }
    for (let i = 0; i < col.units.length; i++) {
      if (flags[i]?.top) t.top.add(col.units[i].layerId)
      if (flags[i]?.base) t.base.add(col.units[i].layerId)
    }
    return t
  }
  const leftTied = tiedOf(left, leftFlags)
  const rightTied = tiedOf(right, rightFlags)
  // Per-column banded unit indices (a matched-pair member). A banded unit is carried
  // by its band contour curves — never tiled. The band's own top/base contour + the
  // interval brackets confine any facing fill to the residue outside the band.
  const leftBanded = new Set<number>()
  const rightBanded = new Set<number>()
  // Formations carrying a matched-pair band in THIS gap (ruling 8e "one body" test): a
  // same-formation full-width render enclosed by its own tied band is one body, so its
  // single-single merge must NOT be terminated (kept as the geometric band). A same-formation
  // pair with NO band of that formation is the retired auto-match — the terminations-first path
  // splits it into opposing onlaps.
  const bandFormations = new Set<string>()
  for (const b of bands) {
    leftBanded.add(b.leftUnitIndex)
    rightBanded.add(b.rightUnitIndex)
    bandFormations.add(b.formationId)
  }

  // Build the bracket lines: surface (top), each tie/bridge anchor line, then the
  // shallow-TD floor. Each bracket is an interface (leftElev, rightElev) — a
  // straight line across the gap. Brackets are ordered top (shallow) -> bottom.
  const brackets: Bracket[] = []
  // TOP bracket = the band-authority top-band line (ruling 5-revised): each column's FIRST
  // LITHO BOUNDARY (``firstLithoTopElev``), NOT the ground surface. The interval tiling starts
  // at this line, so the strip between it and the ground stays EMPTY — no invented lithology
  // above the first data point.
  brackets.push({ leftElev: firstLithoTopElev(left), rightElev: firstLithoTopElev(right), anchor: false })
  const anchorLines = collectAnchorLines(gapIndex, left, right, activeTies, bridgeAnchored)
  for (const a of anchorLines) brackets.push(a)
  // Band-first brackets (design §4 increment-7): each matched-pair band's OWN top
  // and base contour is a bracket line. Without this, a top-tie band whose base is
  // its unit's own (untied) contact leaves the interval between the tie ABOVE and
  // the tie BELOW open across the whole width, so a facing untied unit's lone-side
  // fill overruns the band interior (cs1bandauthority). Adding the band contours as
  // brackets confines that fill to the residue OUTSIDE the band. The contour is a
  // real correlation boundary → ``anchor: true`` (v1's ``bracketed`` gate: a
  // matched-pair band above/below is a real bracket for the midpoint no-auto-facies
  // seam).
  for (const b of bands) {
    brackets.push({ leftElev: b.leftTop, rightElev: b.rightTop, anchor: true })
    brackets.push({ leftElev: b.leftBase, rightElev: b.rightBase, anchor: true })
  }
  // Fill floor: the shallow TD (the higher of the two columns' base elevations).
  // Below this only bridges may fill; a vacancy floor deeper than this would tile
  // into the sub-TD void (owner Q3 — stays empty).
  const leftTD = left.units[left.units.length - 1].baseElev
  const rightTD = right.units[right.units.length - 1].baseElev
  const shallowTD = Math.max(leftTD, rightTD)
  brackets.push({ leftElev: shallowTD, rightElev: shallowTD, anchor: false })

  // Emit each band's OWN top / base contour as an arrangement curve so the band face
  // closes against the fill above / below it (the interval brackets only DEFINE the
  // tiling; the arrangement needs a real curve at the band boundary or the fill's
  // top/base edge is unbounded). A contour AT or BELOW the shallow TD is skipped —
  // that zone is owned by the deep-to-deep substrate, and a duplicate contour there
  // splits the deep band into overlapping slivers (the sandbody GAP-14/15/16 regress).
  for (const b of bands) {
    emitBandContourCurve(left.x, right.x, b.leftTop, b.rightTop, shallowTD, nextBandId, out)
    emitBandContourCurve(left.x, right.x, b.leftBase, b.rightBase, shallowTD, nextBandId, out)
  }

  // Deduplicate + sort brackets by mid-elevation, shallow (high) -> deep (low).
  const mid = (b: Bracket): number => (b.leftElev + b.rightElev) / 2
  brackets.sort((a, b) => mid(b) - mid(a))
  const uniq: Bracket[] = []
  for (const b of brackets) {
    const prev = uniq[uniq.length - 1]
    if (
      prev &&
      Math.abs(prev.leftElev - b.leftElev) < ELEV_EPS &&
      Math.abs(prev.rightElev - b.rightElev) < ELEV_EPS
    ) {
      // Coincident brackets merge; keep ANCHOR status if either is an anchor (an
      // anchor line landing exactly on the surface/floor still brackets the interval).
      if (b.anchor) prev.anchor = true
      continue
    }
    uniq.push(b)
  }

  // Walk each interval [topBracket, baseBracket] and tile the untied units inside.
  // A matched band whose BASE bottoms at the shallow TD (the section floor for this gap
  // — no deeper column, no sub-TD void) needs the floor curve to CLOSE it, else its face
  // is unbounded below and never traces (the isolated same-TD band case). The tiled-
  // interval-reaches-floor path below covers the untied-fill case; this covers the pure
  // band-to-floor case.
  let floorReached = false
  for (const b of bands) {
    if (Math.abs(b.leftBase - shallowTD) < ELEV_EPS && Math.abs(b.rightBase - shallowTD) < ELEV_EPS) {
      floorReached = true
      break
    }
  }
  for (let bi = 0; bi + 1 < uniq.length; bi++) {
    const top = uniq[bi]
    const base = uniq[bi + 1]
    // Skip a fully sub-TD interval (both sides below the shallow TD).
    if (mid(top) <= shallowTD + ELEV_EPS) continue
    const leftUnits = untiedUnitsInInterval(left, leftFlags, leftBanded, top.leftElev, base.leftElev)
    const rightUnits = untiedUnitsInInterval(right, rightFlags, rightBanded, top.rightElev, base.rightElev)
    if (leftUnits.length === 0 && rightUnits.length === 0) continue
    // Bracketed = both interval boundaries are real tie/bridge anchors (v1's gate for
    // the midpoint no-auto-facies seam). A surface- or floor-bounded interval is NOT.
    const bracketed = top.anchor && base.anchor
    tileInterval(gapIndex, left, right, top, base, leftUnits, rightUnits, bracketed, leftTied, rightTied, leftCorr, rightCorr, bandFormations, nextId, nextFloodId, lensLabels, out)
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
    lines.push({ leftElev: t.left.y, rightElev: t.right.y, anchor: true })
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
  for (let i = 0; i < n; i++) lines.push({ leftElev: ls[i], rightElev: rs[i], anchor: true })
  return lines
}

/**
 * Tile one interval: emit the seam + sub-seam curves so the untied left and right
 * units each get their own gap-filling cell.
 *
 * The meet fraction follows v1 ``emitInterval``:
 *   - lone side (only left OR only right) → the present side fills the whole width
 *     (meet 1 for left-only, 0 for right-only);
 *   - one left + one right of DIFFERENT lithology, the interval bracketed above AND
 *     below → MIDPOINT 0.5 (no-auto-facies); a surface/floor-bracketed pair keeps
 *     the thickness weight (v1 ``emitInterval`` ``bracketed`` gate);
 *   - otherwise → thickness-weighted (sumLeft / (sumLeft + sumRight)).
 *
 * ``bracketed`` — whether this interval is bounded by a real tie/bridge anchor on
 * BOTH sides (not the surface or the shallow-TD floor). The caller passes it so the
 * midpoint no-auto-facies rule only fires between two bands (v1's gate).
 */
function tileInterval(
  gapIndex: number,
  left: ColumnGeom,
  right: ColumnGeom,
  top: Bracket,
  base: Bracket,
  leftUnits: IntervalUnit[],
  rightUnits: IntervalUnit[],
  bracketed: boolean,
  leftTied: TiedContacts,
  rightTied: TiedContacts,
  leftCorr: readonly EffectiveCorr[],
  rightCorr: readonly EffectiveCorr[],
  bandFormations: ReadonlySet<string>,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
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
  // A lone side (the other side has NO interval units) gets the facing column's FULL
  // formation set as the enclosed-lens reach context (v1 ``otherFormations``): the
  // interval-local facing is empty, but the facing COLUMN carries the enclosing matrix
  // lower down, so an interbedded lone stack (CS1 gap0 clay+sand+sand+silt) reduces to
  // one flooding matrix + pinched lenses instead of tiling as full-width sub-seams. A
  // two-sided interval passes no facing set (keeps the conservative single-matrix guard).
  const leftFacing = rightUnits.length === 0 ? new Set(right.units.map((u) => u.formationId)) : undefined
  const rightFacing = leftUnits.length === 0 ? new Set(left.units.map((u) => u.formationId)) : undefined
  const leftLenses: IntervalUnit[] = []
  const rightLenses: IntervalUnit[] = []
  const leftMatrix = extractEnclosedLenses(leftUnits, leftLenses, leftFacing)
  const rightMatrix = extractEnclosedLenses(rightUnits, rightLenses, rightFacing)
  if (leftMatrix.length === 0 && rightMatrix.length === 0) return

  // NOTE: this file is the FLAG-OFF seam engine only. The flag-ON path never reaches it
  // (emitCurves routes flag-ON through emitTerminationSweep + emitEnclosingFlood); the old
  // in-file ``tileGapTwoSided`` cut-over branch was unreachable in both states and was
  // deleted (audit item 7, session 36).

  // LONE-SIDE pinch (finding A): one side has matrix units, the other is empty. v1
  // makes such a lone untied unit PINCH short of the far column (apex at 0.45 lens /
  // 0.5 onlap) and the FACING matrix claim the vacated width — NOT run full-width
  // (the old meet 1/0). ``routeLoneSidePinch`` emits that geometry when the facing
  // column REACHES the unit (a genuine pinch) and returns ``true``; a data-void unit
  // (facing too shallow) returns ``false`` and falls through to the ordinary
  // full-width tiling below (v1's sideways continuation — NOT the defect).
  if (
    routeLoneSidePinch(
      { left, right, top, base, leftMatrix, rightMatrix, leftLenses, rightLenses, leftTied, rightTied },
      nextId,
      nextFloodId,
      lensLabels,
      out,
    )
  ) {
    return
  }

  // Geometric same-formation band (v1 ``emitInterval`` connectivity inference, emit.ts
  // lines 61-74): a single left unit + single right unit of the SAME formation are one
  // matrix body bridging the gap even without an explicit tie. Emit NO seam — the band
  // face spans both columns (``labelFaces`` promotes a 2-column-spanning face to BAND),
  // instead of the seam splitting it into two half-width LENS faces (the "clay between
  // two sands" SAND matrix mis-read as lens). Enclosed lenses still pinch inside it.
  if (
    leftMatrix.length === 1 &&
    rightMatrix.length === 1 &&
    leftMatrix[0].unit.formationId === rightMatrix[0].unit.formationId
  ) {
    for (const u of leftLenses) emitLensClosing(u, leftX, rightX, LENS_PINCH_FRACTION, nextId, out)
    for (const u of rightLenses) emitLensClosing(u, rightX, leftX, LENS_PINCH_FRACTION, nextId, out)
    return
  }

  // The seam must sit strictly OUTSIDE each lens-bearing side's apex — a small margin
  // PAST 0.45 — so the enclosed lens stays a hole fully inside its own matrix cell and
  // never touches the seam. This is the v1 ``carveOverlays`` job, done here by WIDENING
  // the cell instead of subtracting the overlap. An apex sitting exactly ON the seam
  // creates a degenerate 3-face junction that leaves a triangle uncovered (the TS6
  // VEEN-above hole), so the margin is mandatory, not cosmetic.
  let meet = meetFraction(leftMatrix, rightMatrix, bracketed)
  const LENS_MARGIN = 0.03
  if (leftLenses.length > 0) meet = Math.max(meet, LENS_PINCH_FRACTION + LENS_MARGIN)
  if (rightLenses.length > 0) meet = Math.min(meet, 1 - LENS_PINCH_FRACTION - LENS_MARGIN)
  const seamX = leftX + meet * (rightX - leftX)
  // Emit each extracted lens at its 0.45 own-elevation apex (now guaranteed inside
  // its widened matrix cell).
  for (const u of leftLenses) emitLensClosing(u, leftX, rightX, LENS_PINCH_FRACTION, nextId, out)
  for (const u of rightLenses) emitLensClosing(u, rightX, leftX, LENS_PINCH_FRACTION, nextId, out)

  // The seam endpoints must ATTACH to the interval's top / base bracket CURVES so the seam
  // PARTITIONS the interval. A plain metres-space interpolation of the bracket line dangles on
  // a SLOPING bracket (grid-snap collinearity failure — the TS6 VEEN full-width band).
  // ``seamAnchorOnBracket`` returns a point EXACTLY collinear with the snapped bracket, at the
  // lattice x nearest ``seamX``: the arrangement then attaches the seam as a grid-exact
  // T-junction. Top and base anchor independently (each on its own bracket), so the seam is a
  // hair slanted rather than dead-vertical — it still cuts the interval, and holes/overlaps
  // stay 0 (the shared bracket vertices keep everything connected).
  const topAnchor = seamAnchorOnBracket(leftX, top.leftElev, rightX, top.rightElev, seamX)
  const baseAnchor = seamAnchorOnBracket(leftX, base.leftElev, rightX, base.rightElev, seamX)
  const seamTopElev = topAnchor.y
  const seamBaseElev = baseAnchor.y
  // The seam is emitted as a POLYLINE top-anchor -> base-anchor. The two anchors may differ in
  // x by at most one lattice step (each is the collinear lattice point nearest ``seamX`` on its
  // own bracket), so the seam is a hair slanted; the sub-seams meet it at the elevation-matched
  // x along that polyline (linear between the two anchor x's), keeping the T-junctions exact.
  const seamXAt = (elev: number): number => {
    const dyTot = seamBaseElev - seamTopElev
    const t = Math.abs(dyTot) < ELEV_EPS ? 0 : (elev - seamTopElev) / dyTot
    return topAnchor.x + t * (baseAnchor.x - topAnchor.x)
  }

  // When a side is lone (meet 0 or 1) the seam coincides with that column vertical and is a
  // zero-width no-op (skipped); otherwise emit the seam between the two grid-exact anchors.
  if (meet > FRAC_EPS && meet < 1 - FRAC_EPS) {
    out.push({
      id: nextId(),
      kind: 'closing',
      points: [topAnchor, baseAnchor],
    })
  }

  // Sub-seam curves: within each side's [column, seam] cell, cut a horizontal-ish
  // divider at every internal boundary between stacked units so each untied unit
  // gets its own face. Each sub-seam meets the (slanted) seam at the x matching its own
  // elevation, so its far endpoint lands ON the seam polyline (an exact T-junction).
  emitSideSubSeams(leftMatrix, leftX, seamXAt, top.leftElev, base.leftElev, seamTopElev, seamBaseElev, nextId, out)
  emitSideSubSeams(rightMatrix, rightX, seamXAt, top.rightElev, base.rightElev, seamTopElev, seamBaseElev, nextId, out)
}

