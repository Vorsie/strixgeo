/**
 * partitionFillV2/tileLone.ts — LONE-SIDE terminations-first tiler (session 5, §7 step-2; design
 * partition-engine-v2.md §8 ruling 8f, "terminate-by-default" for the lone class).
 *
 * A LONE interval has matrix units on only ONE side (the other side's units are all TIED / BANDED,
 * so ``untiedUnitsInInterval`` excludes them). The seam-based ``routeLoneStack`` reduces such a
 * stack to a single DOMINANT matrix that floods FULL-WIDTH plus pinching minorities — and when
 * that dominant matrix formation happens to MATCH a facing TIED band without being correlated to
 * it (Tie-10 g0 interval B: a lone {SILT, ZAND} enclosed by KLEI, facing a KLEI/ZAND[both-tied]/
 * KLEI right column), the flooded ZAND merges with the facing ZAND band at the arrangement level
 * into ONE full-width face — the ``1corr-not-onlap`` ZAND leak the conformance gate flags.
 *
 * Ruling 8f: the EXCLUDED tied facing units are BRACKET CONTEXT, not absence. Each lone unit
 * TERMINATES by its own effective corr against that context: 1 → onlap riding its tie (tip 0.5,
 * ``emitSharedContactOnlap`` with the DIFFERING bracket neighbour flooding — ``chooseOnlapEnclosing``,
 * never the same-formation facing band, which would re-merge), 0 → 0.45 own-elevation lens
 * (``emitLonePinch`` ``forceLens``, the mixed bracket floods both wedges). The lone side then
 * carries per-unit pinches; the facing tied band keeps its own full-width band, SEPARATED by the
 * differing flood.
 *
 * This OWNS the interval (the caller returns true, skipping ``routeLoneSidePinch`` AND the seam);
 * it returns ``false`` for shapes it cannot terminate hole-free (the caller keeps the old path).
 * ``intersect.ts`` / ``seamAnchor.ts`` UNTOUCHABLE. Pure module — no React, no I/O.
 */

import { emitLonePinch, type LonePinchBracket } from './emitLonePinch'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { type LensLabel } from './emitLenses'
import { emitSharedContactOnlap } from './emitSharedContactOnlap'
import { chooseOnlapEnclosing } from './emitTerminations'
import { facingMatrixLabel } from './facingMatrix'
import { type ColumnGeom } from './sectionGeom'
import { type CorrUnit, type TileGapContext } from './tileGap'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * The lone-side enclosing lithology just ABOVE / BELOW a unit ON ITS OWN COLUMN (the bracket
 * neighbours). A unit's termination floods the vacated wedge with whichever neighbour DIFFERS from
 * its own formation (``chooseOnlapEnclosing``) — never the facing same-formation band.
 */
function ownEnclosing(col: ColumnGeom, iTop: number, iBase: number): { above: LensLabel | null; below: LensLabel | null } {
  return { above: facingMatrixLabel(col, iTop + 0.02), below: facingMatrixLabel(col, iBase - 0.02) }
}

/**
 * Tile a LONE interval by terminating every lone-side unit against the facing tied-band context
 * (ruling 8f). Returns ``true`` when it owns the interval (hole-free by the per-unit termination +
 * differing flood), ``false`` to fall back to ``routeLoneSidePinch`` / the seam tiler.
 *
 * SCOPE (session 5, the Tie-10 g0 interval-B class — the ZAND-full-width ROOT): the lone side is a
 * stack whose units are each 1-corr (onlap) or 0-corr (lens), bracketed above AND below by REAL
 * tie anchors (``top.anchor && base.anchor``), and at least one unit's formation MATCHES a facing
 * band formation it is NOT tied to (the same-formation-flood leak this fixes). A unit with a valid
 * DIFFERING own-column enclosing on its flooding side terminates; if any unit lacks one (its notch
 * would re-merge), the whole interval bails (ruling 7 — no partial emit).
 */
export function tileGapLone(
  ctx: TileGapContext,
  loneSide: 'left' | 'right',
  loneUnits: readonly CorrUnit[],
  loneLenses: readonly IntervalUnit[],
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  const { left, right, top, base, bandFormations } = ctx
  // Only the fully-bracketed (tie above AND below) lone stack is in scope: the excluded facing
  // units are tied bands whose lines bracket the interval. A surface/floor-bounded lone stack
  // stays on ``routeLoneSidePinch`` (its finding-A pinch geometry already handles the void).
  if (!top.anchor || !base.anchor) return false
  const loneCol = loneSide === 'left' ? left : right
  const facing = loneSide === 'left' ? right : left
  const loneX = loneCol.x
  const facingX = facing.x
  // At least one lone unit must MATCH a facing band formation (the same-formation-flood leak this
  // path fixes). Otherwise ``routeLoneSidePinch`` / the seam already renders it correctly — leave
  // it (this keeps the scope tight; a broad take-over risks the 24-case holes the design warns of).
  const facingBandMatch = loneUnits.some((u) => bandFormations.has(u.iu.unit.formationId))
  if (!facingBandMatch) return false

  // Each unit terminates by its own corr with the DIFFERING own-column neighbour flooding. Buffer
  // all-or-nothing: a unit that cannot terminate hole-free bails the whole interval (ruling 7).
  const buf: InputCurve[] = []
  const labelPatch = new Map<string, LensLabel>()
  for (const cu of loneUnits) {
    // Each unit terminates within its OWN [uTop..uBase] sub-bracket (horizontal, converging on the
    // facing at the same elevations — the unit is absent on the facing side). The tied contact
    // rides the real interval anchor (top for a top-tied onlap, base for a base-tied one).
    const uTop = cu.iu.topElev
    const uBase = cu.iu.baseElev
    const own = cu.iu.unit.formationId
    const enc = ownEnclosing(loneCol, uTop, uBase)
    const aboveDiff = enc.above !== null && enc.above.formationId !== own
    const belowDiff = enc.below !== null && enc.below.formationId !== own
    if (cu.corr.corr === 1) {
      // ONLAP riding its tie. Base-tied laps the band below → the ABOVE neighbour floods; top-tied
      // → the BELOW. ``chooseOnlapEnclosing`` picks the differing neighbour (never the same-
      // formation facing band, which would re-merge).
      const baseTied = cu.corr.baseTied && !cu.corr.topTied
      const flood = baseTied ? enc.above : enc.below
      if (flood === null || flood.formationId === own) return false
      const enclosing = chooseOnlapEnclosing(own, baseTied, enc.above ?? flood, enc.below ?? flood)
      if (enclosing.formationId === own) return false
      const subTop: LonePinchBracket = { leftElev: uTop, rightElev: uTop, anchor: !baseTied ? top.anchor : false }
      const subBase: LonePinchBracket = { leftElev: uBase, rightElev: uBase, anchor: baseTied ? base.anchor : false }
      emitSharedContactOnlap(
        { unit: cu.iu.unit, topElev: uTop, baseElev: uBase },
        loneSide, loneX, facingX, subTop, subBase, baseTied, enclosing,
        nextId, nextFloodId, labelPatch, buf,
      )
    } else if (cu.corr.corr === 0) {
      // 0-corr LENS with a mixed / differing enclosing flooding both wedges.
      if (!aboveDiff && !belowDiff) return false
      const subTop: LonePinchBracket = { leftElev: uTop, rightElev: uTop, anchor: false }
      const subBase: LonePinchBracket = { leftElev: uBase, rightElev: uBase, anchor: false }
      emitLonePinch(
        [{ unit: cu.iu.unit, topElev: uTop, baseElev: uBase }],
        loneSide, loneX, facingX, subTop, subBase,
        enc.above, enc.below, nextId, nextFloodId, labelPatch, buf,
        undefined, undefined, true,
      )
    } else {
      return false // corr 2 should be excluded upstream; refuse defensively.
    }
  }
  // The facing tied band keeps its own full-width band — synthesize the facing column vertical as a
  // flood-labelled closing so the enclosing that floods the lone void closes against it. The
  // enclosing is the lone stack's OWN bracket matrix (the KLEI enclosing in Tie-10 g0).
  for (const u of loneLenses) emitLensClosing(u, loneX, facingX, 0.45, nextId, buf)
  for (const [k, v] of labelPatch) lensLabels.set(k, v)
  out.push(...buf)
  return true
}
