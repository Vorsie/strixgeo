/**
 * partitionFillV2/emitEnclosingFlood.ts — the FILL-ONLY interval tiler for THE HOIST
 * (owner ruling 8f, design partition-engine-v2.md §8).
 *
 * THE HOIST hoists every termination (0 → lens, 1 → onlap) into ONE unconditional pass
 * (``emitTerminationSweep``). What remains for the interval tiler is PURE FILL — owner 8f
 * verbatim: "if the model is correlated correctly you can just fill in the void with the
 * DOMINANT LITHOLOGY between correlations." This module is that fill:
 *
 *   for each gap, for each interval [topBracket .. baseBracket] above the shallow TD:
 *     emit the interval's TOP + BASE bracket lines as CLOSING carriers so the interval's
 *     enclosing face(s) CLOSE in the arrangement, and — when the two columns present
 *     DIFFERENT enclosing formations — a midpoint SEAM so each side is labelled by its own
 *     column (the no-auto-facies rule). The face's formation comes from its COLUMN
 *     VERTICALS (``labelFaces`` length-weight) — a full-width flood inherently carries both
 *     columns' verticals, so the flood-label trick is NOT used here (it only applies to a
 *     face with NO column vertical, e.g. the lone-pinch wedge or the sub-TD substrate wedge).
 *     The sweep's terminations + the ``bandc`` band contours + the substrate then carve the
 *     lens holes / onlap detours out of these enclosing faces BY CONSTRUCTION.
 *
 * WHY THE MODE-B REBUILD (session 15). MODE B (session 14) emitted NO carrier for a shared
 * enclosing (``usableLeft===usableRight`` → ``return``), trusting the pre-existing column
 * verticals to close the face. But the sweep's termination curves CARVE those faces, so the
 * interval's top/base edges were left OPEN in the arrangement → the enclosing faces did not
 * TRACE (560 holes, band members absent). This rebuild ALWAYS emits the interval's top +
 * base bracket carriers (a ``flood``-prefixed closing that ``labelFaces`` counts as neither
 * a tie nor a closing, like ``bandc``) so every enclosing face closes; the column verticals
 * still stamp the litho.
 *
 * The two carrier lines are the SAME straight bracket interfaces the seam tiler used
 * (``emitIntervals``). The midpoint seam mirrors v1's ``mismatchedMatrix`` no-auto-facies
 * divider.
 *
 * FLAG-ON ONLY: this replaces the seam ``tileInterval`` fill when the hoist flag is on; flag
 * OFF keeps the v1 seam (the campaign safety line). ``intersect.ts`` / ``seamAnchor.ts``
 * UNTOUCHED. Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { INTERIOR_PINCH_FRACTION, type LensApexOverride } from '../sectionPartition'
import { terminationApexOverride } from './apexOverride'
import { bothSidesCloseAtTheMiddle, buildGapClosure, type GapClosure } from './bothSidesClosed'
import { applyContactBend, collectContactBends, type ContactBend } from './contactOverride'
import { isDeclaredMeeting } from './declaredMeetings'
import { type Corr0Diamond, detourBandContourAroundLenses } from './detourBandContour'
import { clipBandContourToTD, collectGapBands, type GapBand } from './emitBands'
import { type ResolvedTie } from './emitCurves'
import { type LensLabel } from './emitLenses'
import { firstLithoTopElev, type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** A bracket interface across the gap (a straight line the interval is bounded by). */
interface FloodBracket {
  leftElev: number
  rightElev: number
  /**
   * Provenance of the bracket line — decides seam VISIBILITY in ``closeInterval`` (owner dogfeed
   * 2026-07-20, "you drew on too many on the left of 10/170-s8"): only a top-band interval bounded
   * below by a real TIE is the ruled-8d band pair whose midpoint seam is LINE ART; every other
   * mismatched closure keeps the invisible ``flood`` scaffold id (the terminations own those
   * boundaries — e.g. CS1 gap7's sand onlap).
   */
  kind: 'topband' | 'tie' | 'band' | 'td'
}

/**
 * Does ``tie`` land on unit ``ui`` of ``side``'s column?
 *
 * A contact is shared: a tie on unit k's TOP is also the base of unit k-1, so it lands on both.
 * Mirrors the ``tiedFlags`` asymmetry the corr arithmetic uses, so "declared to meet" here means
 * the same thing it means everywhere else.
 */
function tieLandsOn(tie: ResolvedTie, side: 'left' | 'right', ui: number): boolean {
  const at = side === 'left' ? tie.leftUnitIndex : tie.rightUnitIndex
  const contact = side === 'left' ? tie.leftSide : tie.rightSide
  if (at === ui) return true
  return contact === 'top' && at === ui + 1
}

/**
 * Emit the fill-only enclosing-flood curves for every gap. Band contours (``bandc``) still
 * emit so a matched-pair band face closes; each interval's top + base bracket carriers +
 * (for a mismatched enclosing) the midpoint seam close the enclosing fill faces so their
 * column verticals stamp the litho.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry elevations + x).
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning (for the brackets + band contours).
 * bridgeAnchored : ReadonlySet<string>
 *     Bridge-anchored contacts (the deep-to-deep substrate owns their zone; the flood stops
 *     at the shallow TD, so bridges are below it — no interaction needed here beyond the TD cap).
 * lensLabels : Map<string, LensLabel>
 *     Shared label map (unused by the flood carriers — they carry no label; the column
 *     verticals stamp the face — but kept for signature parity with the sweep/substrate).
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 * corr0Diamonds : readonly Corr0Diamond[]
 *     The corr-0 lens diamonds a band contour detours around (ruling 8s stage B).
 * bridgeGapAnchored : ReadonlySet<string>, optional
 *     The DIRECTIONAL bridge-anchor set (``gapIndex|side|ui|contact``). Read only by the
 *     both-closed seam rule, so its 2/1/0 arithmetic is the sweep's own — a bridge-anchored
 *     contact must read TIED here too, or a band the bridge carries would look closed and
 *     take a seam through it. Absent (legacy callers) → the plain tie arithmetic.
 */
export function emitEnclosingFlood(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
  corr0Diamonds: readonly Corr0Diamond[] = [],
  bridgeGapAnchored?: ReadonlySet<string>,
): void {
  void bridgeAnchored
  void lensLabels
  const { columns } = section
  if (columns.length < 2) return
  let seq = 0
  const nextFloodId = (): string => `flood${seq++}`
  let bseq = 0
  const nextBandId = (): string => `bandc${bseq++}`
  // RULING 8d (owner, 2026-07-20): the mismatched-first-unit midpoint seam is RULED LINE ART,
  // not fill scaffold — it is the visible horizontal split between two facing formations' top
  // units (the no-auto-facies divider). Its own ``bandseam`` prefix routes it to a phase-0 line-art
  // role (like ``bandc``) so the paint tool draws it; a ``flood`` prefix would classify it phase-3
  // scaffold and the paint tool would exclude it → paint leaks across the sand/clay boundary.
  let sseq = 0
  const nextBandSeamId = (): string => `bandseam${sseq++}`
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    const bands = collectGapBands(gi, left, right, activeTies)
    // Matched-contact free-draw bends (Item A): a control point on the boundary two full-width bands
    // SHARE bends that ONE shared ``bandc`` contour so both bands follow (design §8 line 88). Empty
    // when no override targets a shared contact → the no-override contour is byte-identical.
    const contactBends = collectContactBends(gi, left, right, activeTies, section.lensApexOverrides)
    emitGapFlood(gi, left, right, activeTies, bands, contactBends, section.lensApexOverrides, nextFloodId, nextBandId, nextBandSeamId, out, corr0Diamonds, bridgeGapAnchored)
  }
}

/** Emit the enclosing-flood + band-contour curves for ONE gap. */
function emitGapFlood(
  gapIndex: number,
  left: ColumnGeom,
  right: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  bands: readonly GapBand[],
  contactBends: readonly ContactBend[],
  overrides: ReadonlyMap<string, LensApexOverride> | undefined,
  nextFloodId: () => string,
  nextBandId: () => string,
  nextBandSeamId: () => string,
  out: InputCurve[],
  corr0Diamonds: readonly Corr0Diamond[],
  bridgeGapAnchored: ReadonlySet<string> | undefined,
): void {
  const leftTD = left.units[left.units.length - 1].baseElev
  const rightTD = right.units[right.units.length - 1].baseElev
  const shallowTD = Math.max(leftTD, rightTD)

  // RULING 8l (CORR IS THE LITERAL COUNT — the matched-pair band PROMOTION is deleted): a
  // ``collectGapBands`` band built from a SINGLE same-side tie is NOT authoritative on the contact
  // that tie does NOT cover. Its band-authority ``bandc`` CONTOUR is emitted PER CONTACT only when
  // an active gap tie actually runs between that contour's two endpoints — the literal-line rule
  // (design §8 8l / 8q: a band-authority line must be a real correlation, never a promotion). The
  // CS1 gap3 ``bandc37`` base contour connects B4-u2-ZAND's UNTIED interbed base (0.608) to
  // S13-u3-ZAND's base — no tie runs between those endpoints → it is the exact "band promotion" 8l
  // deletes. A genuinely 2-tied band (CS1 gap16 SILT: top-top tie + a base-tie whose contour rides
  // a real tie) keeps BOTH contours. Dropping a promotion contour lets the sweep's corr-1 onlap
  // terminations + the raw ZAND column verticals close + seed the emergent band (8q paint bucket).
  const contourIsTie = (leftElev: number, rightElev: number): boolean =>
    activeTies.some(
      (t) =>
        t.gapIndex === gapIndex &&
        Math.abs(t.left.y - leftElev) < ELEV_EPS &&
        Math.abs(t.right.y - rightElev) < ELEV_EPS,
    )

  // Band contours (band-authority line art): each band's own top/base contour so its face closes
  // and the flood does not overrun it — but ONLY the contour(s) a real gap tie rides (ruling 8l).
  // Clamped above the shallow TD (the substrate owns the deep zone — a duplicate contour there
  // slivers the deep band). RULING 8s STAGE B: each contour DETOURS around any corr-0 lens diamond
  // in this gap it would cross — the band wraps the lens as a hole (``emitBandContourWithDetour``).
  for (const b of bands) {
    if (contourIsTie(b.leftTop, b.rightTop)) {
      emitBandContourWithDetour(gapIndex, left.x, right.x, b.leftTop, b.rightTop, shallowTD, corr0Diamonds, contactBends, nextBandId, out)
    }
    if (contourIsTie(b.leftBase, b.rightBase)) {
      emitBandContourWithDetour(gapIndex, left.x, right.x, b.leftBase, b.rightBase, shallowTD, corr0Diamonds, contactBends, nextBandId, out)
    }
  }

  // §112 HETEROGENEOUS clay-base contour: when the owner grabs an upper band's OWN base contour that
  // is NOT a tie (an onlap intervenes so the contact is only partly tied — ruling 8l keeps it out of
  // the tie-only ``bandc`` loop above), emit that contour as a NEW line so the arrangement traces the
  // bent clay base. The bend is keyed to the contour's own (leftElev, rightElev), so
  // ``emitBandContourWithDetour`` → ``applyContactBend`` bends it through the cursor apex. The
  // matrix-top tie is UNTOUCHED (its own tie contour is emitted straight elsewhere / holds), so the
  // clay base moves alone and the intervening onlap fills the wedge between them. Only emitted where a
  // heterogeneous bend actually targets this gap (no override → byte-identical: the set is empty).
  for (const b of contactBends) {
    if (!b.heterogeneous) continue
    emitBandContourWithDetour(gapIndex, left.x, right.x, b.leftElev, b.rightElev, shallowTD, corr0Diamonds, contactBends, nextBandId, out)
  }

  // Build the interval brackets: the top-band line, every tie line, every band contour, and the
  // shallow-TD floor. Between two consecutive brackets is one interval to close.
  const brackets: FloodBracket[] = []
  brackets.push({ leftElev: firstLithoTopElev(left), rightElev: firstLithoTopElev(right), kind: 'topband' })
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    brackets.push({ leftElev: t.left.y, rightElev: t.right.y, kind: 'tie' })
  }
  // The interval brackets close the fill faces (a fill scaffold, NOT a band-authority line): every
  // band's top+base bracket stays so each interval still closes hole-free (the 8l contour deletion
  // removes only the AUTHORITY line ``bandc``, never the fill closure). A 1-tied band's untied base
  // is still a real column contact elevation the fill must close against.
  for (const b of bands) {
    brackets.push({ leftElev: b.leftTop, rightElev: b.rightTop, kind: 'band' })
    brackets.push({ leftElev: b.leftBase, rightElev: b.rightBase, kind: 'band' })
  }
  brackets.push({ leftElev: shallowTD, rightElev: shallowTD, kind: 'td' })

  const mid = (b: FloodBracket): number => (b.leftElev + b.rightElev) / 2
  brackets.sort((a, b) => mid(b) - mid(a))
  const uniq: FloodBracket[] = []
  for (const b of brackets) {
    const prev = uniq[uniq.length - 1]
    if (prev && Math.abs(prev.leftElev - b.leftElev) < ELEV_EPS && Math.abs(prev.rightElev - b.rightElev) < ELEV_EPS) {
      continue
    }
    uniq.push(b)
  }

  // Formations carrying a matched-pair band (their band contour + tie own their face; a flood
  // seam inside a band would slice it). Kept over ALL bands (not just ``promoted``): a same-
  // formation emergent band still floods full-width (its two sides are the SAME litho, so
  // ``closeInterval`` never seams it regardless), and suppressing the seam over the 1-tied band's
  // formation matches the pre-8l fill topology — the contour deletion changes only the AUTHORITY
  // anchor, not the flood's full-width closure.
  const bandFids = new Set(bands.map((b) => b.formationId))

  // The gap's 2/1/0 arithmetic, once — read by the both-closed seam rule below
  // (``bothSidesClosed``: who terminates before the middle and who runs through).
  const closure = buildGapClosure(gapIndex, left, right, activeTies, bridgeGapAnchored)

  for (let bi = 0; bi + 1 < uniq.length; bi++) {
    const top = uniq[bi]
    const base = uniq[bi + 1]
    if (mid(top) <= shallowTD + ELEV_EPS) continue // fully sub-TD — substrate owns it
    closeInterval(left, right, top, base, bandFids, activeTies, closure, nextBandSeamId, nextFloodId, out, gapIndex, overrides)
  }

  // Close the flood from below at the shallow TD floor (sub-TD stays empty — substrate owns it).
  out.push({
    id: nextFloodId(),
    kind: 'closing',
    points: [
      { x: left.x, y: shallowTD },
      { x: right.x, y: shallowTD },
    ],
  })
}

/**
 * Emit ONE matched-pair band contour (top or base), clipped above the shallow TD, DETOURED around
 * any corr-0 lens diamond in ``gapIndex`` it would cross (ruling 8s STAGE B).
 *
 * The band-base contour of a top-tied ZAND band descends from the near base corner across the gap;
 * a corr-0 interbed lens sitting directly below that corner (SILT/KLEI) pokes its 0.45 diamond into
 * the descending line. Rather than CRUSH the lens (the S50 ``gapBandContourBrackets`` reach cap, now
 * reverted), the contour reroutes ``crossIn → apex → crossOut`` around the diamond apex — collinear
 * with the emitted lens flanks, so the arrangement unions them and the lens closes as a hole in the
 * band face while the band wraps it (overlap impossible by construction). The contour keeps its
 * ``bandc`` id (``labelFaces`` counts it as neither a tie nor a closing — unchanged semantics).
 */
function emitBandContourWithDetour(
  gapIndex: number,
  leftX: number,
  rightX: number,
  leftElev: number,
  rightElev: number,
  shallowTD: number,
  corr0Diamonds: readonly Corr0Diamond[],
  contactBends: readonly ContactBend[],
  nextBandId: () => string,
  out: InputCurve[],
): void {
  const clipped = clipBandContourToTD(leftX, rightX, leftElev, rightElev, shallowTD)
  if (clipped === null) return
  // Item A — a matched-contact free-draw bend takes precedence over the lens detour on the same
  // contour (the two never target the same shared contact in practice: a bend is the user's explicit
  // reshape of a band-band boundary; a detour wraps a corr-0 lens diamond). No bend → the contour is
  // handed to the detour byte-identical (empty ``contactBends`` on the no-override path).
  const bent = applyContactBend(clipped, leftElev, rightElev, contactBends)
  const isBent = bent.length !== clipped.length
  const points = isBent ? bent : detourBandContourAroundLenses(clipped, gapIndex, corr0Diamonds)
  out.push({ id: nextBandId(), kind: 'closing', points })
}

/**
 * Close ONE interval [top .. base]. When the two columns present DIFFERENT enclosing formations,
 * emit the no-auto-facies MIDPOINT SEAM so each side is a separate face labelled by its own column.
 * The interval's TOP/BASE bracket closure is owned elsewhere (``bandc`` contours + the shallow-TD
 * floor); this function's sole output is the mismatched seam. Same-formation enclosing → one
 * full-width face (no seam), the sweep's minority holes carve into it.
 *
 * RULING 8d (owner, 2026-07-20): the seam is RULED LINE ART **only for the true top-band pair** —
 * the interval bounded above by the top-band line and below by a REAL TIE (e.g. CS1 gap8
 * ZAND ↔ KLEI at x≈464, base = the 9.85 silt-top tie). There it carries a ``bandseam`` id
 * (a phase-0 line-art role, mirrored on ``bandc``) so the paint tool draws it. Every OTHER
 * mismatched closure (interval ending at the TD floor or a band bracket — e.g. CS1 gap7, where
 * the sand's corr-1 onlap flank is the real boundary) keeps the invisible ``flood`` scaffold id:
 * owner dogfeed 2026-07-20, "you drew on too many on the left of 10/170-s8". Geometry is
 * IDENTICAL in both cases — only the id prefix (and thus the role/visibility) differs.
 */
function closeInterval(
  left: ColumnGeom,
  right: ColumnGeom,
  top: FloodBracket,
  base: FloodBracket,
  bandFids: ReadonlySet<string>,
  activeTies: readonly ResolvedTie[],
  closure: GapClosure,
  nextBandSeamId: () => string,
  nextFloodId: () => string,
  out: InputCurve[],
  gapIndex = -1,
  overrides?: ReadonlyMap<string, LensApexOverride>,
): void {
  const leftEncl = enclosingFormationAt(left, (top.leftElev + base.leftElev) / 2)
  const rightEncl = enclosingFormationAt(right, (top.rightElev + base.rightElev) / 2)
  if (leftEncl === null || rightEncl === null) return
  // A band-formation enclosing means the interval is INSIDE a matched-pair band (its contour +
  // tie own the face) — no seam (the band is one full-width face by construction).
  if (bandFids.has(leftEncl.formationId) || bandFids.has(rightEncl.formationId)) return
  // Shared enclosing formation → one full-width face; the sweep's minority holes carve into it.
  if (leftEncl.formationId === rightEncl.formationId) return
  // A MID-GAP FENCE STANDS WHERE THE TWO MASSES WERE DECLARED TO MEET — nowhere else.
  //
  // Owner, on the case that KEEPS it (2026-08-19): "On S10 there is a MD sand above the bottom MF
  // clay. This one has a bottom tie and a top tie so it should get a vertical termination in the
  // middle left is MD right is D." A CORRELATION between the two enclosing masses is exactly that
  // declaration: neither terminates, they meet, and the vertical is the only honest boundary. The
  // ruled top-band pair (8d, 2026-07-20) is the same statement made by the top band itself — the
  // no-auto-facies divider between two facing first units — and keeps its ``bandseam`` line art.
  //
  // Without such a declaration the seam is an INVENTED boundary, and 2/1/0 has already drawn the
  // real one. Owner, same day: "the loose sand should onlap (wrong in litho too) ... the clay
  // should fill the gaps." On CS1 gap 7 an untied sand on a short test had closed as an onlap, and
  // the seam then walled the deep clay off at 0.5 and handed the far half back to the sand the
  // construct had just closed. Where nobody declared a meeting, the constructs decide and the
  // remaining mass floods around them.
  const declared =
    (top.kind === 'topband' && base.kind === 'tie') ||
    activeTies.some(
      (t) =>
        t.gapIndex === gapIndex &&
        tieLandsOn(t, 'left', leftEncl.unitIndex) &&
        tieLandsOn(t, 'right', rightEncl.unitIndex),
    ) ||
    // A PARENT MODEL may declare the meeting too (owner ruling A, "litho approval carries
    // down"). Inside a per-family geotech run the only correlations in ``activeTies`` are the
    // packing ties; the family is itself a litho chain, so masses whose parent litho units are
    // tied meet even when their own restatement is absent. It is a boundary, never a band —
    // see ``declaredMeetings``.
    isDeclaredMeeting(
      gapIndex,
      left.units[leftEncl.unitIndex]?.layerId,
      right.units[rightEncl.unitIndex]?.layerId,
    )
  // THE SECOND JUSTIFICATION FOR THE SAME LINE — BOTH PACKAGES CLOSED AT THE MIDDLE
  // (owner, 2026-08-24: *"yes in this case i'd rather have a vertical line"*). Where every
  // mass of BOTH columns terminates inside this window, nobody declared a meeting but
  // nobody runs through either, and the ground between the two closed packages belongs to
  // neither class alone — without the line one of them floods the whole gap over the
  // other's closed loops (CS2 gap 0: B1's loose sand painted across S34's own sand/silt
  // package, which never read a loose sand at all). A single OPEN mass on either side
  // answers no, which is what keeps the ruled SF-silt fill-through (2026-08-21) intact.
  // See ``bothSidesClosed``.
  const bothClosed = bothSidesCloseAtTheMiddle(
    closure,
    top.leftElev,
    base.leftElev,
    top.rightElev,
    base.rightElev,
  )
  if (!declared && !bothClosed) return

  // MISMATCHED enclosing → the no-auto-facies MIDPOINT SEAM separates the two sides. Each half's
  // face is bounded by its own column vertical (its enclosing litho) + the seam + the brackets,
  // so ``labelFaces`` stamps each half from its own column.
  // ITEM B (free-draw onlap reshape): this mismatched-interval seam IS the onlap tip's reach cap (a
  // band-flooded 1-corr onlap the sweep routes to this closure, not ``emitOnlap`` — the S65 Q1 no-op
  // class). A per-body override on either enclosing body MOVES the seam fraction so that body's onlap
  // extends to the drawn reach. The LEFT body pinching → the seam rides toward the RIGHT (its own
  // override fraction); the RIGHT body pinching → the seam is at ``1 − fraction`` (the mirror, since
  // fraction is measured 0 = pinching column). No override → the fixed 0.5 midpoint (byte-identical).
  const leftOv = terminationApexOverride(overrides, leftEncl.bodyId, gapIndex)
  const rightOv = terminationApexOverride(overrides, rightEncl.bodyId, gapIndex)
  const f = leftOv ? leftOv.fraction : rightOv ? 1 - rightOv.fraction : INTERIOR_PINCH_FRACTION
  const seamX = left.x + f * (right.x - left.x)
  const seamTop = top.leftElev + f * (top.rightElev - top.leftElev)
  const seamBase = base.leftElev + f * (base.rightElev - base.leftElev)
  // Visibility: the ruled-8d band-pair seam (top-band above, real tie below) is line art;
  // any other mismatched closure stays an invisible fill scaffold.
  const isRuledBandPairSeam = top.kind === 'topband' && base.kind === 'tie'
  out.push({
    id: isRuledBandPairSeam ? nextBandSeamId() : nextFloodId(),
    kind: 'closing',
    points: [
      { x: seamX, y: seamTop },
      { x: seamX, y: seamBase },
    ],
  })
}

/**
 * The enclosing formation of a column at elevation ``e`` — the unit whose span contains ``e``
 * (the lateral matrix that floods the interval). Returns ``null`` when no unit spans ``e``
 * (below TD / above surface).
 */
function enclosingFormationAt(
  col: ColumnGeom,
  e: number,
): (LensLabel & { unitIndex: number }) | null {
  for (let ui = 0; ui < col.units.length; ui++) {
    const u = col.units[ui]
    if (u.topElev >= e - ELEV_EPS && e >= u.baseElev - ELEV_EPS) {
      return { formationId: u.formationId, bodyId: (u as UnitGeom).bodyId, unitIndex: ui }
    }
  }
  return null
}
