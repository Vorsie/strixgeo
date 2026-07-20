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

import { INTERIOR_PINCH_FRACTION } from '../partitionFill'
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
 */
export function emitEnclosingFlood(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
  corr0Diamonds: readonly Corr0Diamond[] = [],
): void {
  void bridgeAnchored
  void lensLabels
  const { columns } = section
  if (columns.length < 2) return
  let seq = 0
  const nextFloodId = (): string => `flood${seq++}`
  let bseq = 0
  const nextBandId = (): string => `bandc${bseq++}`
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    const bands = collectGapBands(gi, left, right, activeTies)
    emitGapFlood(gi, left, right, activeTies, bands, nextFloodId, nextBandId, out, corr0Diamonds)
  }
}

/** Emit the enclosing-flood + band-contour curves for ONE gap. */
function emitGapFlood(
  gapIndex: number,
  left: ColumnGeom,
  right: ColumnGeom,
  activeTies: readonly ResolvedTie[],
  bands: readonly GapBand[],
  nextFloodId: () => string,
  nextBandId: () => string,
  out: InputCurve[],
  corr0Diamonds: readonly Corr0Diamond[],
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
      emitBandContourWithDetour(gapIndex, left.x, right.x, b.leftTop, b.rightTop, shallowTD, corr0Diamonds, nextBandId, out)
    }
    if (contourIsTie(b.leftBase, b.rightBase)) {
      emitBandContourWithDetour(gapIndex, left.x, right.x, b.leftBase, b.rightBase, shallowTD, corr0Diamonds, nextBandId, out)
    }
  }

  // Build the interval brackets: the top-band line, every tie line, every band contour, and the
  // shallow-TD floor. Between two consecutive brackets is one interval to close.
  const brackets: FloodBracket[] = []
  brackets.push({ leftElev: firstLithoTopElev(left), rightElev: firstLithoTopElev(right) })
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    brackets.push({ leftElev: t.left.y, rightElev: t.right.y })
  }
  // The interval brackets close the fill faces (a fill scaffold, NOT a band-authority line): every
  // band's top+base bracket stays so each interval still closes hole-free (the 8l contour deletion
  // removes only the AUTHORITY line ``bandc``, never the fill closure). A 1-tied band's untied base
  // is still a real column contact elevation the fill must close against.
  for (const b of bands) {
    brackets.push({ leftElev: b.leftTop, rightElev: b.rightTop })
    brackets.push({ leftElev: b.leftBase, rightElev: b.rightBase })
  }
  brackets.push({ leftElev: shallowTD, rightElev: shallowTD })

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

  for (let bi = 0; bi + 1 < uniq.length; bi++) {
    const top = uniq[bi]
    const base = uniq[bi + 1]
    if (mid(top) <= shallowTD + ELEV_EPS) continue // fully sub-TD — substrate owns it
    closeInterval(left, right, top, base, bandFids, nextFloodId, out)
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
  nextBandId: () => string,
  out: InputCurve[],
): void {
  const clipped = clipBandContourToTD(leftX, rightX, leftElev, rightElev, shallowTD)
  if (clipped === null) return
  const detoured = detourBandContourAroundLenses(clipped, gapIndex, corr0Diamonds)
  out.push({ id: nextBandId(), kind: 'closing', points: detoured })
}

/**
 * Close ONE interval [top .. base]. Emit the interval's TOP and BASE bracket carrier lines
 * (``flood`` ids — counted as neither tie nor closing by ``labelFaces``, like ``bandc``) so
 * the enclosing face(s) close in the arrangement; the column verticals stamp the litho. When
 * the two columns present DIFFERENT enclosing formations, ALSO emit a midpoint SEAM so each
 * side is a separate face labelled by its own column (the no-auto-facies rule). Same-formation
 * enclosing → one full-width face (no seam), the sweep's minority holes carve into it.
 */
function closeInterval(
  left: ColumnGeom,
  right: ColumnGeom,
  top: FloodBracket,
  base: FloodBracket,
  bandFids: ReadonlySet<string>,
  nextFloodId: () => string,
  out: InputCurve[],
): void {
  const leftEncl = enclosingFormationAt(left, (top.leftElev + base.leftElev) / 2)
  const rightEncl = enclosingFormationAt(right, (top.rightElev + base.rightElev) / 2)
  if (leftEncl === null || rightEncl === null) return
  // A band-formation enclosing means the interval is INSIDE a matched-pair band (its contour +
  // tie own the face) — no seam (the band is one full-width face by construction).
  if (bandFids.has(leftEncl.formationId) || bandFids.has(rightEncl.formationId)) return
  // Shared enclosing formation → one full-width face; the sweep's minority holes carve into it.
  if (leftEncl.formationId === rightEncl.formationId) return

  // MISMATCHED enclosing → the no-auto-facies MIDPOINT SEAM separates the two sides. Each half's
  // face is bounded by its own column vertical (its enclosing litho) + the seam + the brackets,
  // so ``labelFaces`` stamps each half from its own column.
  const seamX = left.x + INTERIOR_PINCH_FRACTION * (right.x - left.x)
  const seamTop = top.leftElev + INTERIOR_PINCH_FRACTION * (top.rightElev - top.leftElev)
  const seamBase = base.leftElev + INTERIOR_PINCH_FRACTION * (base.rightElev - base.leftElev)
  out.push({
    id: nextFloodId(),
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
function enclosingFormationAt(col: ColumnGeom, e: number): LensLabel | null {
  for (const u of col.units) {
    if (u.topElev >= e - ELEV_EPS && e >= u.baseElev - ELEV_EPS) {
      return { formationId: u.formationId, bodyId: (u as UnitGeom).bodyId }
    }
  }
  return null
}
