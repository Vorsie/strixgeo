/**
 * partitionFillV2/tileConvergingStack.ts — the MULTI-UNIT-CONVERGING coherent slab tiler
 * (TARGET 1, session 10 — design partition-engine-v2.md §8 ruling 8h phases 1-2).
 *
 * Extracted from ``tileCoherentStack.ts`` (debt #201 — kept it under the 500-line budget). The
 * ruling-8h sweep's converging-facing branch (``emitConvergingSide``) handles a SINGLE present-side
 * unit hole-free via the proven per-unit primitives, but BAILED on a MULTI-UNIT present side (N
 * independent ``emitLonePinch`` wedges sharing ``conv`` overlap/gap — sessions 4/5 measured +457
 * holes / +666 overlaps). This module supplies the missing COHERENT construction: the session-6
 * slab-seam trick (``emitLoneStack.emitLoneStackBand``) generalised to a facing that CONVERGES to a
 * point.
 *
 * Ruling 8h phases 1-2: EVERY 0-corr unit-side ALWAYS gets its lens, UNCONDITIONALLY (owner's CS1
 * walkthrough: CS1 col14 u4 SILT lenses right; CS1 col18 u2 SILT + u3 VEEN each get their OWN
 * per-unit lens on the 0-corr side). The bail may remain for a genuine data void (no enclosing
 * matrix), NEVER for the terminations.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { LENS_PINCH_FRACTION } from '../partitionFill'
import { emitLensClosing } from './emitIntervalLenses'
import { type LensLabel } from './emitLenses'
import { facingMatrixLabel } from './facingMatrix'
import { lensReachFraction } from './lensReach'
import { type ColumnGeom } from './sectionGeom'
import { segmentDegenerate } from './snap'
import { type CorrUnit } from './tileGap'
import { type InputCurve, type Point } from './types'
import { type ConvergingSide } from './tileCoherentStackTypes'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** Bracket-match tolerance (metres) — a contact within this of the interval boundary is adjacent. */
const BRACKET_EPS = 1e-3

/**
 * SESSION-10 MEASURED-NEGATIVE GATE. The multi-unit-converging coherent slab construction below is
 * gated OFF by default: on the 14 real sections (flag-ON) it fired on 4 intervals and measured
 * **+22 above-TD holes / +81 different-litho overlaps** with NO net conformance gain (10 → 10; the
 * CS1 col14/col18 SILT/VEEN targets resolved but a gap18 VEEN band regression appeared). ROOT: the
 * 4 real fires are all SINGLE-minority-in-a-MATRIX-stack intervals with STEEPLY SLOPING brackets
 * (slope 7.1 m / −3.6 m) — a stack of [matrix unit(s) + one minority], NOT the pure multi-minority
 * interbed stack the synthetic gates exercise. A matrix unit sharing the stack breaks the single
 * flood-to-conv (the enclosing above/below no longer matches the matrix unit's own formation → its
 * slot floods the wrong litho → overlap), and the FLAT horizontal seams + flat flood corners do not
 * follow the sloping brackets → slivers. This is the SAME multi-unit-converging wall sessions 4/5/6
 * measured (+457 holes / +666 overlaps for N wedges). The correct construction must (a) restrict to
 * the MINORITY elevation span (leave matrix units to the seam) and (b) follow the sloping brackets —
 * a dedicated increment. Gated OFF; the synthetic gates + this record survive. TARGET 2 (the
 * degenerate-flank guard) is unaffected and SHIPPED.
 */
const MULTI_UNIT_CONVERGING_ENABLED = false

/** THROWAWAY diag (session 10) — converging-stack fire / bail counters. Orchestrator strips. */
export const CONV_STACK_DIAG: Record<string, number> = {}
function cbump(r: string): void {
  CONV_STACK_DIAG[r] = (CONV_STACK_DIAG[r] ?? 0) + 1
}
export function convStackDiagReset(): void {
  for (const k of Object.keys(CONV_STACK_DIAG)) delete CONV_STACK_DIAG[k]
}

/**
 * The PRESENT column's enclosing lithology immediately ABOVE (``dir='above'`` — the unit whose base
 * contact ≈ ``elev``) or BELOW (``dir='below'`` — the unit whose top contact ≈ ``elev``) an interval
 * boundary. The lateral enclosing at the convergence (v1's ``aboveLith`` / ``belowLith``). Returns
 * ``null`` when no adjacent unit exists (the boundary is the section surface / TD — no enclosing).
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
 * ``top``] — a would-be minority the facing actually HAS is a matched MATRIX (should band), not a
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
 * (TARGET 1, session 10 — the SESSION-6 SLAB CONSTRUCTION generalised to a converging facing).
 *
 * The construction — proven hole-free by ``emitLoneStack.emitLoneStackBand`` (the slab-seam trick)
 * — generalised to a facing that CONVERGES to a point ``conv`` (no facing matrix run to band to;
 * the enclosing floods the residue past the apex line to ``conv`` instead):
 *
 *   1. Each unit gets its OWN 8b-capped lens NOTCH biting its column edge (``emitLensClosing``,
 *      already reach-capped + degenerate-guarded). All units share ONE apex fraction (the stack-min
 *      8b cap) so the notch apexes align on ONE vertical apex line.
 *   2. HORIZONTAL BOUNDARY SEAMS at every internal contact (own column → apex line) separate
 *      adjacent units' slabs — NOT independent wedges (the session-5 +666-overlap lesson). Each
 *      seam carries the enclosing matrix label so a slab's residual pentagon (the matrix around the
 *      notch, bounded by seams + notch edges + the apex line, with NO own-column vertical) reads
 *      matrix (the finding-A ``labelFaces`` trick).
 *   3. The ENCLOSING matrix floods the residue [apex line .. conv]: the ABOVE matrix over the top
 *      half, the BELOW over the base half (split at the interval mid). When above === below (an
 *      enclosed same-formation lens-in-continuous-matrix — CS1 col18 u4 KLEI "merges into the
 *      encompassing clay") the split collapses to one continuous flood.
 *
 * All-or-nothing (ruling 7): the caller buffers into ``buf``/``labelPatch`` and commits only on
 * ``true``. Returns ``false`` (keeps the seam) ONLY when the enclosing matrix cannot be determined
 * (a genuine data void) — never suppressing the per-unit lenses for a shape it can close.
 *
 * Parameters
 * ----------
 * s : ConvergingSide
 *     The present (real-thickness) side and its facing (converging) column geometry.
 * sorted : readonly CorrUnit[]
 *     The present side's units, top→down (already sorted; contiguous by construction, ≥ 2).
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
  // Gated OFF (measured negative — see MULTI_UNIT_CONVERGING_ENABLED). Bail to the caller's seam so
  // flag-ON stays byte-identical to the session-9 baseline (holes 0/0, overlaps 0, conformance 10).
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
  // adjacency (the unit whose base ≈ iTop, and the unit whose top ≈ iBase) — v1's ``belowLith ??
  // aboveLith``, the SAME source ``routeLoneStack`` uses. This is the lateral enclosing at the
  // convergence, NOT a facing sample (a converging facing has ~0 interval thickness; sampling it at
  // iTop/iBase returns the facing's OWN top/base litho, which mis-labels the present matrix as a
  // minority — the bidirSweep/coherentStack ZAND-lens×ZAND overlap). If either bracket is missing
  // (surface / TD — no enclosing), bail (keep the seam): an unenclosed stack is not this case.
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
  // absorbed into the flood (no notch — its own column vertical reads matrix, the flood covers its
  // slot; the owner's "CS1 col18 u4 KLEI merges into the encompassing clay"). Bail (keep the seam)
  // when: NO minority remains (an all-matrix stack — the coherentStack merged-ZAND case), OR an
  // enclosing formation ALSO appears among the minorities (ambiguous — a formation that is both
  // matrix and minority cannot be cleanly notched; the seam handles it).
  const enclosingFids = new Set([aboveMatrix.formationId, belowMatrix.formationId])
  const minorities = sorted.filter((cu) => !enclosingFids.has(cu.iu.unit.formationId))
  if (minorities.length === 0) {
    cbump('bail-all-matrix')
    return false
  }
  // The facing must NOT carry a would-be minority's formation across its own elevation (a CONVERGING
  // facing has ~0 interval thickness, so it carries only the enclosing above/below — never a genuine
  // interbed minority). If the facing DOES carry a "minority" formation overlapping its elevation, it
  // is a matched MATRIX that should band, not lens (the coherentStack/bidirSweep ZAND matrix
  // bracketed by KLEI bands but continuous ZAND on the facing) — bail so the seam bands it. This is
  // the discriminator between the mission's genuine interbed (facing lacks it) and a main matrix
  // unit (facing carries it).
  for (const cu of minorities) {
    // A would-be minority the FACING actually carries is a matched MATRIX (should band), not an
    // interbed — bail so the seam bands it (the coherentStack/bidirSweep ZAND-matrix case).
    if (facingCarriesFormation(s.facing, cu.iu.unit.formationId, cu.iu.topElev, cu.iu.baseElev)) {
      cbump('bail-facing-carries-minority')
      return false
    }
    // A minority the facing encloses in ONE same formation (facing above == below at the minority) is
    // a SAME-FORMATION enclosure — the column-level enclosed-lens extraction's job (or the seam's),
    // NOT the converging sweep's (the CS1 g20/g21 splitAnnulus-bypass wall, session 8). Bail so it
    // stays on its existing path; the converging sweep owns only genuine MIXED-bracket minorities.
    const fAbove = facingMatrixLabel(s.facing, cu.iu.topElev + ELEV_EPS)
    const fBelow = facingMatrixLabel(s.facing, cu.iu.baseElev - ELEV_EPS)
    if (fAbove !== null && fBelow !== null && fAbove.formationId === fBelow.formationId) {
      cbump('bail-facing-same-formation-enclosure')
      return false
    }
  }
  // A MATRIX unit (formation ∈ enclosing) INTERLEAVED between two minorities cannot be cleanly
  // handled by the flood (it would need its own column-bounded band inside the notch region) — the
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

  // ONE shared apex fraction (the stack-min 8b cap over the MINORITIES) so every notch apex lands
  // on ONE vertical apex line — the slab seams then align with every notch apex (the
  // ``emitLoneStackBand`` alignment that keeps each notch a simple face). The 8b cap keeps the apex
  // hugging the present column, so the notches never cross into the facing's lithology.
  const apexFrac = minorities.reduce(
    (m, cu) => Math.min(m, lensReachFraction(cu.iu.topElev - cu.iu.baseElev, facingX - ownX)),
    LENS_PINCH_FRACTION,
  )
  const apexX = ownX + apexFrac * (facingX - ownX)

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

  // (1) Per-MINORITY 8b-capped lens notches (own-litho triangles biting the present column edge).
  //     The shared apex fraction keeps every apex on the apex line. ``emitLensClosing`` is already
  //     degenerate-guarded (TARGET 2), so a sub-snap-thin unit drops cleanly. A matrix-matching unit
  //     gets NO notch — it is part of the flood.
  for (const cu of minorities) emitLensClosing(cu.iu, ownX, facingX, apexFrac, nextId, buf)

  // (2) Horizontal boundary seams at every MINORITY top/base (own column → apex line), labelled with
  //     the enclosing matrix (above the interval mid → aboveMatrix, else belowMatrix) so each
  //     minority notch is ISOLATED in the flood and the residual matrix pentagons read matrix (the
  //     ``emitLoneStackBand`` slab-seam trick). In the MIXED-bracket case add a seam at the interval
  //     mid too so no residual straddles the above/below flood split (the no-auto-facies midpoint).
  const seamElevs = new Set<number>()
  for (const cu of minorities) {
    seamElevs.add(cu.iu.topElev)
    seamElevs.add(cu.iu.baseElev)
  }
  if (!sameEnclosing) seamElevs.add(mid)
  for (const e of [...seamElevs].sort((a, b) => b - a)) {
    if (e > iTop - ELEV_EPS || e < iBase + ELEV_EPS) continue
    pushFlood(e >= mid ? aboveMatrix : belowMatrix, [{ x: ownX, y: e }, { x: apexX, y: e }])
  }

  // (3) The apex-line vertical separates the slab region [ownX..apexX] from the flood-to-conv
  //     region [apexX..conv]. Plain close (both sides are covered — slab residuals + flood read
  //     matrix; the notches read own litho).
  pushClose([{ x: apexX, y: iTop }, { x: apexX, y: iBase }])

  // (4) The enclosing matrix floods the residue past the apex line to ``conv``. The two hypotenuse
  //     curves (apex-line top / base corner → conv) + the apex-line vertical (step 3) close the
  //     flood triangle; the bracket lines (already arrangement curves) bound its top/base.
  //     - SAME enclosing (above === below): ONE continuous matrix flood — just the two hypotenuses.
  //     - MIXED (above ≠ below): split at the interval mid — the ABOVE matrix over the top wedge
  //       ((apexX,iTop)→conv→(apexX,mid)), the BELOW over the base wedge ((apexX,iBase)→conv→
  //       (apexX,mid)); the shared conv→apexMid edge is the no-auto-facies midpoint seam (step-2
  //       already emitted a mid slab-seam so no own-litho slab straddles the split).
  pushFlood(aboveMatrix, [{ x: apexX, y: iTop }, conv])
  if (sameEnclosing) {
    pushFlood(aboveMatrix, [conv, { x: apexX, y: iBase }])
  } else {
    const apexMid: Point = { x: apexX, y: mid }
    pushFlood(aboveMatrix, [conv, apexMid])
    pushFlood(belowMatrix, [{ x: apexX, y: iBase }, conv])
    pushFlood(belowMatrix, [conv, apexMid])
  }
  return true
}
