/**
 * partitionFillV2/tileCoherent.ts — the SESSION-6 SINGLE-COHERENT-FLOOD /
 * seam-with-notches primitive (REWRITE_STATE §9; design partition-engine-v2.md §8f, KEY
 * session-6 lead).
 *
 * A LONE stack of mixed terminations (each lone unit onlaps/lenses by its own corr) tiles
 * HOLE-FREE with the enclosing matrix descending as ONE continuous flood face bounded by
 * every unit's pinch — NOT N independent ``emitLonePinch`` wedges (session 5: +666 overlaps),
 * NOT a matrix-band-with-notches that needs the matrix INSIDE the interval
 * (``routeLoneStack``/``extractLoneStackLenses`` — leaves a hole when the units fill the
 * whole interval and the enclosing is only the bracket above/below).
 *
 * MECHANISM (generalises ``emitLoneStack.emitLoneStackBand``): the interval [iTop..iBase] on
 * the lone column holds units u0..un (top→down) that together SPAN the interval. The FACING
 * column carries ONE enclosing matrix M across the interval span (the differing flood — never
 * a lone unit's own formation, so the flood can never re-merge with it). We build:
 *
 *   1. per-unit NOTCH — two ``close`` curves from (loneX, u.top) / (loneX, u.base) to the
 *      unit's apex (apexX_k, apexElev_k), labelled with u's own formation, so u reads a
 *      lens (0-corr, own mid-elevation, 8b-capped) or an onlap (1-corr, apex on its tied
 *      bracket at 0.5). The unit's own column vertical closes its face.
 *   2. per-boundary horizontal SLAB SEAM (loneX → the apex LINE = the min apex x), labelled
 *      M, so a slab whose residual-M pentagon carries no lone column vertical is stamped M
 *      (the ``labelFaces`` flood trick) and every notch closes into its OWN simple face.
 *   3. one M FLOOD past the apex line — the facing column vertical (facingX, iTop)→(facingX,
 *      iBase) emitted as an M-labelled flood ``closing``, so [apexLine..facingX] reads M as
 *      ONE band face bounded by the seams + the facing vertical.
 *
 * The result is a partition: loneX→apexLine tiled by the notch slabs (each unit + its M
 * residual), apexLine→facingX = one M flood band. Because M is a DIFFERENT formation from
 * each lone unit AND M physically fills the whole apexLine→facingX strip, a same-formation
 * lone unit (e.g. lone ZAND facing a ZAND band) is SEPARATED from the facing band by the M
 * strip — the conformance gate's raster union-find then reads it a proper onlap/lens, not a
 * full-width band (the §7 ZAND-full-width ROOT).
 *
 * SCOPE / BAIL (ruling 7 — all-or-nothing, no partial emit): fires only when the facing
 * column carries ONE continuous enclosing matrix M across the whole interval span AND M is a
 * DIFFERENT formation from EVERY lone unit (so no re-merge). Otherwise returns ``false`` and
 * the caller keeps ``routeLoneSidePinch`` / the seam. ``intersect.ts`` / ``seamAnchor.ts``
 * UNTOUCHABLE. Pure module — no React, no I/O.
 */

import { INTERIOR_PINCH_FRACTION, LENS_PINCH_FRACTION } from '../partitionFill'
import { emitLensClosing, type IntervalUnit } from './emitIntervalLenses'
import { type LonePinchBracket } from './emitLonePinch'
import { type LensLabel } from './emitLenses'
import { facingCoversSpan, facingMatrixLabel } from './facingMatrix'
import { type ColumnGeom } from './sectionGeom'
import { type CorrUnit } from './tileGap'
import { type InputCurve, type Point } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** The shared meet-seam fraction for a lone stack meeting the enclosing matrix. The lone units
 *  onlap/lens toward the facing, meeting M at this seam (``INTERIOR_PINCH_FRACTION`` 0.5 = the tip
 *  fraction ruling 8a/8b use for an onlap; the units reach only their own edge + the seam ⇒ they
 *  read ``onlap``, and M reaching the facing edge is a SEPARATE component). */
const SEAM_FRACTION = INTERIOR_PINCH_FRACTION

/** THROWAWAY diag — bail reasons for the coherent primitive (session 6). Orchestrator strips. */
export const COHERENT_DIAG: Record<string, number> = {}
function cbump(r: string): void {
  COHERENT_DIAG[r] = (COHERENT_DIAG[r] ?? 0) + 1
}
export function coherentDiagReset(): void {
  for (const k of Object.keys(COHERENT_DIAG)) delete COHERENT_DIAG[k]
}

/**
 * The enclosing matrix M the FACING column carries CONTINUOUSLY across the lone interval span,
 * IF it is one formation different from every lone unit. Returns the ``LensLabel`` or ``null``.
 *
 * We sample the facing at the interval's own top / mid / base elevations; M must be the SAME
 * formation at all three AND cover the span with no gap (``facingCoversSpan``), AND differ from
 * every lone unit's formation (so the flood can never re-merge into a lone unit — the wall).
 */
function facingEnclosingMatrix(
  facing: ColumnGeom,
  iTop: number,
  iBase: number,
  loneFids: ReadonlySet<string>,
): LensLabel | null {
  const mid = (iTop + iBase) / 2
  const top = facingMatrixLabel(facing, iTop - ELEV_EPS)
  const midL = facingMatrixLabel(facing, mid)
  const bot = facingMatrixLabel(facing, iBase + ELEV_EPS)
  if (top === null || midL === null || bot === null) return null
  if (top.formationId !== midL.formationId || midL.formationId !== bot.formationId) return null
  if (loneFids.has(midL.formationId)) return null // a lone unit shares the matrix — would re-merge.
  if (!facingCoversSpan(facing, midL.formationId, iTop, iBase)) return null
  return midL
}

/**
 * Tile a LONE stack that SPANS its interval against a facing enclosing matrix (the session-6
 * coherent-flood primitive). Returns ``true`` when it owns the interval (hole-free by the
 * notch + slab-seam + single-flood construction), ``false`` to fall back.
 *
 * Parameters
 * ----------
 * loneUnits : readonly CorrUnit[]
 *     The lone side's interval matrix units (top→down), each with its per-gap corr (2/1/0).
 * loneLenses : readonly IntervalUnit[]
 *     Enclosed lenses already extracted on the lone side (kept as 0.45 notches).
 * facing : ColumnGeom
 *     The facing column (must carry ONE enclosing matrix across the span).
 * loneSide : 'left' | 'right'
 * loneX, facingX : number
 * top, base : LonePinchBracket
 *     The interval brackets (lone-side elevations define the notch spans).
 * nextId, nextFloodId : () => string
 * lensLabels : Map<string, LensLabel>
 * out : InputCurve[]
 */
export function tileCoherentLoneStack(
  loneUnits: readonly CorrUnit[],
  loneLenses: readonly IntervalUnit[],
  facing: ColumnGeom,
  loneSide: 'left' | 'right',
  loneX: number,
  facingX: number,
  top: LonePinchBracket,
  base: LonePinchBracket,
  nextId: () => string,
  nextFloodId: () => string,
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): boolean {
  cbump('entered')
  if (loneUnits.length < 2) {
    cbump('bail-lt2')
    return false
  }
  const iTop = loneSide === 'left' ? top.leftElev : top.rightElev
  const iBase = loneSide === 'left' ? base.leftElev : base.rightElev
  if (iTop - iBase < ELEV_EPS) return false

  // The FACING bracket must have REAL thickness — a CONVERGING facing (facingTop ≈ facingBase, a
  // zero-thickness point where the two brackets meet on the facing column) is the §8-Q3 data void:
  // the M flood band degenerates to a point and the seam collapses (the CS2 gap11 hole). Such an
  // interval stays on the caller's routing (routeLoneSidePinch / seam), NOT the coherent primitive.
  const facingTopElev = loneSide === 'left' ? top.rightElev : top.leftElev
  const facingBaseElev = loneSide === 'left' ? base.rightElev : base.leftElev
  if (Math.abs(facingTopElev - facingBaseElev) < 0.02) {
    cbump('bail-facingconverges')
    return false
  }

  // The lone units must SPAN the interval contiguously (top of the first ≈ iTop, base of the
  // last ≈ iBase, no internal gap) — else a strip would be uncovered (ruling 7 bail).
  const sorted = [...loneUnits].sort((a, b) => b.iu.topElev - a.iu.topElev)
  if (Math.abs(sorted[0].iu.topElev - iTop) > 0.02) {
    cbump('bail-topspan')
    return false
  }
  if (Math.abs(sorted[sorted.length - 1].iu.baseElev - iBase) > 0.02) {
    cbump('bail-basespan')
    return false
  }
  for (let k = 0; k + 1 < sorted.length; k++) {
    if (Math.abs(sorted[k].iu.baseElev - sorted[k + 1].iu.topElev) > 0.02) {
      cbump('bail-gap')
      return false
    }
  }

  const loneFids = new Set(sorted.map((u) => u.iu.unit.formationId))
  const matrix = facingEnclosingMatrix(facing, iTop, iBase, loneFids)
  if (matrix === null) {
    cbump('bail-nomatrix')
    return false
  }

  // Every lone unit must be a TERMINATING unit (0-corr lens or 1-corr onlap) — a 2-corr band
  // member should not reach here (excluded upstream). Refuse defensively.
  for (const u of sorted) if (u.corr.corr === 2) {
    cbump('bail-corr2')
    return false
  }
  cbump('fired')

  // MEET-AT-SEAM construction (the session-6 primitive, single-coherent-flood form that is
  // hole-free WITHOUT a matrix inside the stack). The lone units meet the enclosing matrix M at
  // ONE shared vertical SEAM at ``seamFrac``; each unit fills its own [uTop..uBase] slab from the
  // lone column to the seam (a right-trapezoid following the sloping brackets), M fills the seam →
  // facing column band. A single seam + per-unit horizontal boundary seams = a rectangle partition,
  // hole-free by construction (no dipping mid-apex sliver — the session-6 second/third-attempt hole
  // was exactly the mid-elevation notch dipping away from its own contact). Conformance: each unit
  // reaches only the lone edge + the seam ⇒ ``onlap`` (0<seamFrac<1), never full-width; M reaching
  // the facing edge is a SEPARATE component ⇒ a same-formation lone unit no longer unions with a
  // facing band across the M seam strip.
  const seamFrac = SEAM_FRACTION
  // Seam elevation at a given interval elevation ``e`` (follows the bracket lerp so the seam
  // endpoints land ON the top/base bracket lines — no dangle on a sloping bracket).
  const seamElevAt = (e: number): number => {
    const t = (iTop - e) / (iTop - iBase)
    const loneE = e
    const facingE = facingTopElev + t * (facingBaseElev - facingTopElev)
    return loneE + seamFrac * (facingE - loneE)
  }
  const seamX = loneX + seamFrac * (facingX - loneX)

  const buf: InputCurve[] = []
  const labelPatch = new Map<string, LensLabel>()
  const pushLabelled = (id: string, label: LensLabel, points: Point[]): void => {
    labelPatch.set(id, label)
    buf.push({ id, kind: 'closing', points })
  }

  // (1) M FLOOD past the seam: the facing column vertical (facingX, facingTop)→(facingX, facingBase)
  // as an M-labelled flood closing; with the seam (step 3) it bounds ONE M band face seam→facing.
  const floodId = nextFloodId()
  labelPatch.set(floodId, matrix)
  buf.push({ id: floodId, kind: 'closing', points: [{ x: facingX, y: facingTopElev }, { x: facingX, y: facingBaseElev }] })

  // (2) per-unit horizontal boundary SEAMS (loneX → seamX), each labelled the unit BELOW it so the
  // two adjacent lone-unit slabs are separated (a boundary between SILT above and ZAND below reads
  // the right lithology on each side). The interval top/base are already bracket curves. These are
  // ``close`` curves (not flood) — they carry a real lithology contact, and each unit slab's own
  // column vertical labels it, so the ``close`` boundary only classifies the slab as a terminating
  // (onlap) face, never promotes it to a band.
  for (let k = 0; k + 1 < sorted.length; k++) {
    const e = sorted[k].iu.baseElev // = sorted[k+1].iu.topElev (contiguity checked above)
    if (e > iTop - ELEV_EPS || e < iBase + ELEV_EPS) continue
    buf.push({ id: `close${nextId()}`, kind: 'closing', points: [{ x: loneX, y: e }, { x: seamX, y: seamElevAt(e) }] })
  }

  // (3) the SEAM itself — a single closing curve top→base along the seam line (seamX at seamFrac,
  // endpoints ON the brackets). It separates every lone-unit slab from the M flood band.
  buf.push({
    id: `close${nextId()}`,
    kind: 'closing',
    points: [{ x: seamX, y: seamElevAt(iTop) }, { x: seamX, y: seamElevAt(iBase) }],
  })

  // Enclosed lenses keep their own 0.45 apex (their matrix band is the flood).
  for (const u of loneLenses) emitLensClosing(u, loneX, facingX, LENS_PINCH_FRACTION, nextId, buf)

  for (const [k, v] of labelPatch) lensLabels.set(k, v)
  out.push(...buf)
  return true
}
