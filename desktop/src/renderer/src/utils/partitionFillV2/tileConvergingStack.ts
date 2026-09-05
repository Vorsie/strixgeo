/**
 * partitionFillV2/tileConvergingStack.ts - the MULTI-UNIT-CONVERGING coherent slab tiler
 * (TARGET 1, session 10 - design partition-engine-v2.md section 8 ruling 8h phases 1-2).
 *
 * Extracted from ``tileCoherentStack.ts`` (debt #201 - kept it under the 500-line budget). The
 * ruling-8h sweep's converging-facing branch (``emitConvergingSide``) handles a SINGLE present-side
 * unit hole-free via the proven per-unit primitives, but BAILED on a MULTI-UNIT present side (N
 * independent ``emitLonePinch`` wedges sharing ``conv`` overlap/gap - sessions 4/5 measured +457
 * holes / +666 overlaps). This module supplies the missing COHERENT construction: the session-6
 * slab-seam trick (``emitLoneStack.emitLoneStackBand``) generalised to a facing that CONVERGES to a
 * point.
 *
 * Ruling 8h phases 1-2: EVERY 0-corr unit-side ALWAYS gets its lens, UNCONDITIONALLY (owner's CS1
 * walkthrough: CS1 col14 u4 SILT lenses right; CS1 col18 u2 SILT + u3 VEEN each get their OWN
 * per-unit lens on the 0-corr side). The bail may remain for a genuine data void (no enclosing
 * matrix), NEVER for the terminations.
 *
 * Pure module - no React, no Date.now / Math.random, no I/O.
 */

import { emitLensClosing } from './emitIntervalLenses'
import { type LensLabel } from './emitLenses'
import { facingMatrixLabel } from './facingMatrix'
import { fitLensReach } from './lensReach'
import { type ColumnGeom } from './sectionGeom'
import { segmentDegenerate } from './snap'
import { type CorrUnit } from './tileCoherentStackTypes'
import { type InputCurve, type Point } from './types'
import { type ConvergingSide } from './tileCoherentStackTypes'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** Bracket-match tolerance (metres) - a contact within this of the interval boundary is adjacent. */
const BRACKET_EPS = 1e-3

/**
 * SESSION-11 REACH-HALVING GATE (owner ruling 8b conflict-resolution, design section 8, 2026-07-16 late).
 *
 * Session 10 gated this OFF after a FLAT construction measured +22 holes / +81 overlaps: it chased
 * the sloping brackets with flat horizontal seams + flat flood corners `(apexX, iTop)` that sit
 * ABOVE the descending top bracket, leaving slivers. The owner's ruled mechanism is the OPPOSITE - the
 * SEAMS never move, the LENS SHRINKS: "you can just shorten the lenses by half if there is conflict
 * with a tie." This module now emits each 0-corr minority as a HALVED lens (``fitLensReach``: start
 * at the 8b reach, halve until the lens polygon fits strictly inside the sloping wedge), and the
 * flood corners sit ON the sloping bracket at the apex x (never flat) so no sliver survives. A
 * minority that cannot fit even at the snap-grid floor degenerates cleanly (the ``segmentDegenerate``
 * guard - session-10 TARGET 2). Flipped ON when the halving loop passes the battery; if the real
 * data still regresses, gate OFF, record, stop-and-report (session-4/5/10 pattern).
 */
const MULTI_UNIT_CONVERGING_ENABLED = true

/** THROWAWAY diag (session 10) - converging-stack fire / bail counters. Orchestrator strips. */
export const CONV_STACK_DIAG: Record<string, number> = {}
function cbump(r: string): void {
  CONV_STACK_DIAG[r] = (CONV_STACK_DIAG[r] ?? 0) + 1
}
export function convStackDiagReset(): void {
  for (const k of Object.keys(CONV_STACK_DIAG)) delete CONV_STACK_DIAG[k]
}

/**
 * The PRESENT column's enclosing lithology immediately ABOVE (``dir='above'`` - the unit whose base
 * contact ~= ``elev``) or BELOW (``dir='below'`` - the unit whose top contact ~= ``elev``) an interval
 * boundary. The lateral enclosing at the convergence (v1's ``aboveLith`` / ``belowLith``). Returns
 * ``null`` when no adjacent unit exists (the boundary is the section surface / TD - no enclosing).
 */
function ownColumnBracket(col: ColumnGeom, elev: number, dir: 'above' | 'below'): LensLabel | null {
  for (const u of col.units) {
    const contact = dir === 'above' ? u.baseElev : u.topElev
    if (Math.abs(contact - elev) <= ELEV_EPS + BRACKET_EPS) {
      return { formationId: u.formationId, bodyId: u.bodyId }
    }
  }
  return null
}

/**
 * Whether the FACING column carries formation ``fid`` overlapping the elevation span [``base``..
 * ``top``] - a would-be minority the facing actually HAS is a matched MATRIX (should band), not a
 * genuine interbed the facing lacks. Used to keep the converging-stack tiler OFF a main matrix unit.
 */
function facingCarriesFormation(facing: ColumnGeom, fid: string, top: number, base: number): boolean {
  for (const u of facing.units) {
    if (u.formationId !== fid) continue
    if (Math.min(u.topElev, top) - Math.max(u.baseElev, base) > ELEV_EPS) return true
  }
  return false
}

/**
 * Emit a MULTI-UNIT present side against a CONVERGING facing as ONE coherent hole-free face set
 * (TARGET 1, session 10 - the SESSION-6 SLAB CONSTRUCTION generalised to a converging facing).
 *
 * The construction - proven hole-free by ``emitLoneStack.emitLoneStackBand`` (the slab-seam trick)
 * - generalised to a facing that CONVERGES to a point ``conv`` (no facing matrix run to band to;
 * the enclosing floods the residue past the apex line to ``conv`` instead):
 *
 *   1. Each unit gets its OWN 8b-capped lens NOTCH biting its column edge (``emitLensClosing``,
 *      already reach-capped + degenerate-guarded). All units share ONE apex fraction (the stack-min
 *      8b cap) so the notch apexes align on ONE vertical apex line.
 *   2. HORIZONTAL BOUNDARY SEAMS at every internal contact (own column to apex line) separate
 *      adjacent units' slabs - NOT independent wedges (the session-5 +666-overlap lesson). Each
 *      seam carries the enclosing matrix label so a slab's residual pentagon (the matrix around the
 *      notch, bounded by seams + notch edges + the apex line, with NO own-column vertical) reads
 *      matrix (the finding-A ``labelFaces`` trick).
 *   3. The ENCLOSING matrix floods the residue [apex line .. conv]: the ABOVE matrix over the top
 *      half, the BELOW over the base half (split at the interval mid). When above === below (an
 *      enclosed same-formation lens-in-continuous-matrix - CS1 col18 u4 KLEI "merges into the
 *      encompassing clay") the split collapses to one continuous flood.
 *
 * All-or-nothing (ruling 7): the caller buffers into ``buf``/``labelPatch`` and commits only on
 * ``true``. Returns ``false`` (keeps the seam) ONLY when the enclosing matrix cannot be determined
 * (a genuine data void) - never suppressing the per-unit lenses for a shape it can close.
 *
 * Parameters
 * ----------
 * s : ConvergingSide
 *     The present (real-thickness) side and its facing (converging) column geometry.
 * sorted : readonly CorrUnit[]
 *     The present side's units, toptodown (already sorted; contiguous by construction, >= 2).
 * nextId, nextFloodId : () => string
 * labelPatch : Map<string, LensLabel>
 * buf : InputCurve[]
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the coherent construction owned the interval; ``false`` (a data void) to bail.
 */
export function emitConvergingStack(
  s: ConvergingSide,
  sorted: readonly CorrUnit[],
  nextId: () => string,
  nextFloodId: () => string,
  labelPatch: Map<string, LensLabel>,
  buf: InputCurve[],
): boolean {
  cbump('entered')
  // Kill-switch escape hatch. The tiler is ENABLED (MULTI_UNIT_CONVERGING_ENABLED = true, see its
  // doc above); this bail fires ONLY if the flag is flipped back OFF (a regression, stop-and-report).
  // With the flag OFF the interval falls back to the caller's seam, byte-identical to the session-9
  // baseline (holes 0/0, overlaps 0, conformance 10).
  if (!MULTI_UNIT_CONVERGING_ENABLED) {
    cbump('bail-gated-off')
    return false
  }
  const { ownX, facingX } = s
  // The interval span on the present column (its brackets), and the facing convergence point.
  const iTop = sorted[0].iu.topElev
  const iBase = sorted[sorted.length - 1].iu.baseElev
  const conv: Point = { x: facingX, y: (s.facingTop + s.facingBase) / 2 }

  // The ENCLOSING lithology ABOVE iTop and BELOW iBase, read from the PRESENT COLUMN's own bracket
  // adjacency (the unit whose base ~= iTop, and the unit whose top ~= iBase) - v1's ``belowLith ??
  // aboveLith``, the SAME source ``routeLoneStack`` uses. This is the lateral enclosing at the
  // convergence, NOT a facing sample (a converging facing has ~0 interval thickness; sampling it at
  // iTop/iBase returns the facing's OWN top/base litho, which mis-labels the present matrix as a
  // minority - the bidirSweep/coherentStack ZAND-lensxZAND overlap). If either bracket is missing
  // (surface / TD - no enclosing), bail (keep the seam): an unenclosed stack is not this case.
  const aboveMatrix = ownColumnBracket(s.col, iTop, 'above')
  const belowMatrix = ownColumnBracket(s.col, iBase, 'below')
  if (aboveMatrix === null || belowMatrix === null) {
    cbump('bail-no-bracket')
    return false
  }

  const mid = (iTop + iBase) / 2
  const sameEnclosing = aboveMatrix.formationId === belowMatrix.formationId

  // MINORITIES vs MATRIX (the ``routeLoneStack`` reduction, ruling 8h): a present-side unit whose
  // formation DIFFERS from BOTH the above and below enclosing lithologies is a genuine minority
  // that LENSES; a unit whose formation MATCHES an enclosing lithology is part of the MATRIX and is
  // absorbed into the flood (no notch - its own column vertical reads matrix, the flood covers its
  // slot; the owner's "CS1 col18 u4 KLEI merges into the encompassing clay"). Bail (keep the seam)
  // when: NO minority remains (an all-matrix stack - the coherentStack merged-ZAND case), OR an
  // enclosing formation ALSO appears among the minorities (ambiguous - a formation that is both
  // matrix and minority cannot be cleanly notched; the seam handles it).
  const enclosingFids = new Set([aboveMatrix.formationId, belowMatrix.formationId])
  const minorities = sorted.filter((cu) => !enclosingFids.has(cu.iu.unit.formationId))
  if (minorities.length === 0) {
    cbump('bail-all-matrix')
    return false
  }
  // The facing must NOT carry a would-be minority's formation across its own elevation (a CONVERGING
  // facing has ~0 interval thickness, so it carries only the enclosing above/below - never a genuine
  // interbed minority). If the facing DOES carry a "minority" formation overlapping its elevation, it
  // is a matched MATRIX that should band, not lens (the coherentStack/bidirSweep ZAND matrix
  // bracketed by KLEI bands but continuous ZAND on the facing) - bail so the seam bands it. This is
  // the discriminator between the mission's genuine interbed (facing lacks it) and a main matrix
  // unit (facing carries it).
  for (const cu of minorities) {
    // A would-be minority the FACING actually carries is a matched MATRIX (should band), not an
    // interbed - bail so the seam bands it (the coherentStack/bidirSweep ZAND-matrix case).
    if (facingCarriesFormation(s.facing, cu.iu.unit.formationId, cu.iu.topElev, cu.iu.baseElev)) {
      cbump('bail-facing-carries-minority')
      return false
    }
    // A minority the facing encloses in ONE same formation that ALSO matches the OWN-column
    // enclosing (facing above == below == own bracket matrix) is a TRUE same-formation ANNULUS
    // (SILT-in-SILT on both columns - the CS1 g20/g21 splitAnnulus-bypass wall, session 8): the
    // minority is a hole in a formation continuous on BOTH sides, which the converging flood
    // cannot separate hole-free. Bail so it stays on its existing path.
    //
    // But when the facing's same-formation enclosure DIFFERS from the own-column enclosing
    // (session 12, TARGET A - CS1 col18 SILT/VEEN: own enclosing KLEI, facing carries ZAND across
    // the minority elevations), the minority is a genuine hole in the OWN-column KLEI, NOT in the
    // facing ZAND: the KLEI flood hugs the own column and the facing ZAND fills its own side past
    // the tie - no same-formation annulus to break. Only the own==facing case is the wall.
    const fAbove = facingMatrixLabel(s.facing, cu.iu.topElev + ELEV_EPS)
    const fBelow = facingMatrixLabel(s.facing, cu.iu.baseElev - ELEV_EPS)
    if (
      fAbove !== null &&
      fBelow !== null &&
      fAbove.formationId === fBelow.formationId &&
      enclosingFids.has(fAbove.formationId)
    ) {
      cbump('bail-facing-same-formation-enclosure')
      return false
    }
  }
  // A MATRIX unit (formation in enclosing) INTERLEAVED between two minorities cannot be cleanly
  // handled by the flood (it would need its own column-bounded band inside the notch region) - the
  // construction is hole-free only when the matrix units sit at the stack TOP/BASE (contiguous with
  // the enclosing brackets). Bail (keep the seam) on an interleaved matrix. The minorities must form
  // ONE contiguous run in the stack.
  const firstMin = sorted.indexOf(minorities[0])
  const lastMin = sorted.indexOf(minorities[minorities.length - 1])
  if (lastMin - firstMin + 1 !== minorities.length) {
    cbump('bail-interleaved-matrix')
    return false
  }
  cbump('fired')

  // The SLOPING bracket elevation at a fraction of the gap (fraction 0 = own column, fraction 1 =
  // facing convergence). The interval top bracket runs iTop to conv.y; the base bracket iBase to
  // conv.y. These are the wedge edges the halved lens must fit INSIDE (owner ruling 8b
  // conflict-resolution) and the seams/flood corners must ride (never flat - the session-10 sliver).
  const topAt = (f: number): number => iTop + f * (conv.y - iTop)
  const baseAt = (f: number): number => iBase + f * (conv.y - iBase)
  const xAt = (f: number): number => ownX + f * (facingX - ownX)

  const pushClose = (points: Point[]): void => {
    if (segmentDegenerate(points[0], points[points.length - 1])) return
    buf.push({ id: `close${nextId()}`, kind: 'closing', points })
  }
  const pushFlood = (label: LensLabel, points: Point[]): void => {
    if (segmentDegenerate(points[0], points[points.length - 1])) return
    const id = nextFloodId()
    labelPatch.set(id, label)
    buf.push({ id, kind: 'closing', points })
  }

  // (1) Per-MINORITY HALVED lens at its OWN mid-elevation. ``fitLensReach`` starts at the 8b reach
  //     and HALVES it until the lens polygon fits strictly inside the SLOPING wedge (the owner's
  //     ruled mechanism - the seams never move, the LENS shrinks). Each minority gets its OWN reach
  //     (no shared apex line), so a thin minority near a steeply pinching bracket hugs its column
  //     while a fat one keeps more reach. A minority that cannot fit even at the snap-grid floor
  //     returns reach 0, so ``emitLensClosing``'s degenerate guard drops it (clean no-op, the
  //     enclosing flood covers the slot - session-10 TARGET 2). Record each fired minority's own
  //     apex fraction so the boundary seams stop AT that minority's apex (not a shared line).
  const fired: { top: number; base: number; f: number }[] = []
  for (const cu of minorities) {
    const uTop = cu.iu.topElev
    const uBase = cu.iu.baseElev
    const mid2 = (uTop + uBase) / 2
    const f = fitLensReach(uTop - uBase, facingX - ownX, mid2, iTop, iBase, conv.y, conv.y)
    if (f <= 0) continue // no reach fits - the lens degenerates (enclosing flood covers the slot).
    emitLensClosing(cu.iu, ownX, facingX, f, nextId, buf)
    fired.push({ top: uTop, base: uBase, f })
  }
  // If NO minority could fit a lens (every one degenerated), the whole interval is pure enclosing
  // flood - leave it to the caller's seam (nothing carved). Bail so no half-flood is committed.
  if (fired.length === 0) {
    cbump('bail-all-degenerate')
    return false
  }

  // The apex fraction that reaches DEEPEST into the gap (the widest lens). The enclosing matrix
  // floods from that apex line out to ``conv``; the boundary seams between minorities close each
  // minority's own-litho slab. Using the max keeps every minority notch fully inside the flood
  // region [ownX .. apexMaxX] so no notch pokes past the flood boundary.
  const apexMaxFrac = fired.reduce((m, p) => Math.max(m, p.f), 0)
  const apexMaxX = xAt(apexMaxFrac)

  // (2) Horizontal boundary seams at every MINORITY top/base (own column to the apex line at
  //     ``apexMaxX``), labelled with the enclosing matrix (above the interval mid to aboveMatrix,
  //     else belowMatrix) so each minority notch is ISOLATED and the residual matrix pentagons read
  //     matrix (the ``emitLoneStackBand`` slab-seam trick). These seams sit at the MINORITY's OWN
  //     contact elevations - strictly inside the wedge (the minority is enclosed), never on the
  //     stack bracket - so they never sliver (the session-10 sliver was the STACK-bracket flood
  //     corner, fixed in step 3/4 by riding the sloping bracket). In the MIXED-bracket case add a
  //     seam at the interval mid so no residual straddles the above/below flood split.
  const seamElevs = new Set<number>()
  for (const p of fired) {
    seamElevs.add(p.top)
    seamElevs.add(p.base)
  }
  if (!sameEnclosing) seamElevs.add(mid)
  for (const e of [...seamElevs].sort((a, b) => b - a)) {
    if (e > iTop - ELEV_EPS || e < iBase + ELEV_EPS) continue
    pushFlood(e >= mid ? aboveMatrix : belowMatrix, [{ x: ownX, y: e }, { x: apexMaxX, y: e }])
  }

  // (3) The apex-line vertical separates the slab region [ownX..apexMaxX] from the flood-to-conv
  //     region [apexMaxX..conv]. Its TOP/BASE endpoints ride the SLOPING brackets at ``apexMaxX``
  //     (``topAt``/``baseAt``), NOT the flat iTop/iBase - this is the session-10 sliver fix: a flat
  //     ``(apexMaxX, iTop)`` sits ABOVE the descending top bracket, leaving an uncovered sliver
  //     between it and the bracket.
  const apexTop: Point = { x: apexMaxX, y: topAt(apexMaxFrac) }
  const apexBase: Point = { x: apexMaxX, y: baseAt(apexMaxFrac) }
  pushClose([apexTop, apexBase])

  // (4) The enclosing matrix floods the residue past the apex line to ``conv``. The two hypotenuse
  //     curves (apex-line top/base corner to conv) close the flood triangle together with the apex
  //     vertical (step 3); the sloping bracket lines (already arrangement curves) bound its
  //     top/base from ``apexMaxX`` to ``conv``.
  //     - SAME enclosing: ONE continuous matrix flood.
  //     - MIXED: split at the interval mid - the ABOVE matrix over the top wedge, the BELOW over the
  //       base wedge; the shared convtoapexMid edge is the no-auto-facies midpoint seam (step-2 added
  //       a mid slab-seam so no own-litho slab straddles the split). ``apexMid`` rides the wedge mid.
  pushFlood(aboveMatrix, [apexTop, conv])
  if (sameEnclosing) {
    pushFlood(aboveMatrix, [conv, apexBase])
  } else {
    const apexMid: Point = { x: apexMaxX, y: (apexTop.y + apexBase.y) / 2 }
    pushFlood(aboveMatrix, [conv, apexMid])
    pushFlood(belowMatrix, [apexBase, conv])
    pushFlood(belowMatrix, [conv, apexMid])
  }
  return true
}
