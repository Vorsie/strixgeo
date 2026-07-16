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
 *     flood the interval FULL-WIDTH with its enclosing (dominant) formation as a ``flood``
 *     band. The sweep's terminations + the ``bandc`` band contours + the substrate then
 *     carve the holes / detours out of it BY CONSTRUCTION (the ``emitSubTdLenses`` /
 *     ``emitLenses`` proof — a lens closing carves a hole in a continuous flood band).
 *
 * WHICH FORMATION FLOODS (the dominant / enclosing choice):
 *   - When BOTH columns present ONE shared formation across the interval (the true lateral
 *     enclosing — the CLAY around two SAND lenses, the KLEI around a SILT interbed), that
 *     ONE formation floods the whole width. The terminations of the OTHER formations are
 *     holes in it.
 *   - When the two columns present DIFFERENT enclosing formations (a sand-left / clay-right
 *     mismatch), the no-auto-facies rule applies: each side floods its own half to the 0.5
 *     midpoint seam (two ``flood`` half-bands meeting at a straight vertical seam — v1's
 *     ``mismatchedMatrix`` midpoint). No invented facies, no auto-match.
 *
 * The ``flood`` id + label makes ``labelFaces`` stamp the band from the flood formation (the
 * face carries no own-column vertical over the flooded span other than at the frame, so the
 * flood label wins) — the same trick ``emitBottomTieSubstrate`` / ``emitLonePinch`` use.
 *
 * FLAG-ON ONLY: this replaces the seam ``tileInterval`` fill when the hoist flag is on; flag
 * OFF keeps the v1 seam (the campaign safety line). ``intersect.ts`` / ``seamAnchor.ts``
 * UNTOUCHED. Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { INTERIOR_PINCH_FRACTION } from '../partitionFill'
import { collectGapBands, type GapBand } from './emitBands'
import { emitBandContourCurve } from './emitBands'
import { type ResolvedTie } from './emitCurves'
import { type LensLabel } from './emitLenses'
import { firstLithoTopElev, type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** A bracket interface across the gap (a straight line the interval is bounded by). */
interface FloodBracket {
  leftElev: number
  rightElev: number
}

/**
 * Emit the fill-only enclosing-flood curves for every gap. Band contours (``bandc``) still
 * emit so a matched-pair band face closes; the interval floods carry ``flood`` ids so their
 * faces read the enclosing formation as a BAND.
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
 *     Shared label map — each flood band's id carries its enclosing formation.
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 */
export function emitEnclosingFlood(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  bridgeAnchored: ReadonlySet<string>,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  void bridgeAnchored
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
    emitGapFlood(gi, left, right, activeTies, bands, nextFloodId, nextBandId, lensLabels, out)
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
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  const leftTD = left.units[left.units.length - 1].baseElev
  const rightTD = right.units[right.units.length - 1].baseElev
  const shallowTD = Math.max(leftTD, rightTD)

  // Band contours (band-authority line art): each matched-pair band's own top/base contour so
  // its face closes and the flood does not overrun it. Clamped above the shallow TD (the
  // substrate owns the deep zone — a duplicate contour there slivers the deep band).
  for (const b of bands) {
    emitBandContourCurve(left.x, right.x, b.leftTop, b.rightTop, shallowTD, nextBandId, out)
    emitBandContourCurve(left.x, right.x, b.leftBase, b.rightBase, shallowTD, nextBandId, out)
  }

  // Build the interval brackets: the top-band line, every tie line, every band contour, and the
  // shallow-TD floor. Between two consecutive brackets is one interval to flood.
  const brackets: FloodBracket[] = []
  brackets.push({ leftElev: firstLithoTopElev(left), rightElev: firstLithoTopElev(right) })
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    brackets.push({ leftElev: t.left.y, rightElev: t.right.y })
  }
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

  // Formations carrying a matched-pair band (excluded from the flood — their band contour +
  // tie own their face; flooding them would double-cover the band).
  const bandFids = new Set(bands.map((b) => b.formationId))

  for (let bi = 0; bi + 1 < uniq.length; bi++) {
    const top = uniq[bi]
    const base = uniq[bi + 1]
    if (mid(top) <= shallowTD + ELEV_EPS) continue // fully sub-TD — substrate owns it
    floodInterval(gapIndex, left, right, top, base, bands, bandFids, nextFloodId, lensLabels, out)
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
 * Flood ONE interval [top .. base] full-width with its enclosing (dominant) formation. When
 * both columns present ONE shared enclosing formation, it floods the whole width; when they
 * differ, each side floods its own half to the 0.5 midpoint seam (no-auto-facies).
 */
function floodInterval(
  gapIndex: number,
  left: ColumnGeom,
  right: ColumnGeom,
  top: FloodBracket,
  base: FloodBracket,
  bands: readonly GapBand[],
  bandFids: ReadonlySet<string>,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  void gapIndex
  void bands
  void lensLabels
  const leftEncl = enclosingFormationAt(left, (top.leftElev + base.leftElev) / 2)
  const rightEncl = enclosingFormationAt(right, (top.rightElev + base.rightElev) / 2)
  if (leftEncl === null && rightEncl === null) return

  // A band-formation enclosing means the interval is INSIDE a matched-pair band (the band owns
  // the face via its contour + tie) — do not treat it as a floodable enclosing.
  const usableLeft = leftEncl && !bandFids.has(leftEncl.formationId) ? leftEncl : null
  const usableRight = rightEncl && !bandFids.has(rightEncl.formationId) ? rightEncl : null

  // ONE shared enclosing formation → the whole interval is ONE face bounded by the two columns'
  // OWN verticals (both the enclosing formation) + the top/base brackets. NO flood curve is
  // needed: ``labelFaces`` stamps that face from its column verticals (both the enclosing litho),
  // and the sweep's terminations carve their own holes into it. Emitting a flood carrier here
  // would double-stamp the face — omit it (this is the ``emitSubTdLenses`` insight: the enclosing
  // band already spans full-width from the existing verticals; a lens is just a hole in it).
  if (usableLeft && usableRight && usableLeft.formationId === usableRight.formationId) {
    return
  }

  // MISMATCHED / one-sided enclosing → the no-auto-facies MIDPOINT SEAM separates the two sides.
  // Each half's face is bounded by its own column vertical (its enclosing litho) + the seam +
  // the brackets, so ``labelFaces`` stamps each half from its own column — no flood carrier
  // needed. Only the seam curve is emitted (the fill divider).
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
