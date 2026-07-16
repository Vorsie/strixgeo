/**
 * partitionFillV2/emitRuledBands.ts — RULED-EXEMPT same-formation band closures (THE HOIST
 * Target 1, round 3; design partition-engine-v2.md §8 rulings 8e / 8g(b) / 8d).
 *
 * THE HOIST's ``emitTerminationSweep`` SUPPRESSES a termination for every unit the owner ruled
 * a BAND (8e same-formation enclosure / 8g(b) base-tied same-formation pair / a corr-2 band
 * member or first-unit-top-band). But suppressing the termination is only half the job: the
 * enclosing flood does NOT emit a carrier for these units' OWN formation, so a NEIGHBOURING
 * full-width flood face of a DIFFERENT formation absorbs their column-vertical space (the
 * length-weight label picks the taller neighbour) → the unit reads ABSENT (the round-2 residual:
 * 15 ABSENT rows, all suppressed-but-unfilled band units).
 *
 * This pass emits each such unit's MISSING same-formation BAND contour so its face closes and
 * its column vertical labels it — the ASYMMETRIC analogue of ``collectGapBands`` /
 * ``emitBandContours`` (v1 matched-pair semantics used each side's OWN top/base). For a unit
 * whose FACING column carries the SAME formation over an overlapping elevation window, we emit
 * the band's TOP contour (unit's own top ↔ facing run's top) and BASE contour (unit's own base ↔
 * facing run's base) as ``bandc``-prefixed carriers. ``labelFaces`` counts ``bandc`` as neither
 * tie nor closing, so the closed face is stamped BAND from its column verticals — exactly the
 * ``emitBands`` matched-pair device, extended to the asymmetric same-formation-facing case.
 *
 * WHY IT DOES NOT OVERLAP. The contour is emitted only when the facing carries the SAME
 * formation across the unit's band window (``facingSameFormationRun``); the band it closes is
 * that same formation on BOTH columns, so no cross-litho double-cover. The contour is CLAMPED
 * above the shallow TD (the substrate owns the deep zone) exactly like ``emitBandContourCurve``.
 *
 * FLAG-ON ONLY — runs after ``emitEnclosingFlood`` in ``emitCurves`` when the hoist flag is on;
 * flag OFF keeps the v1 seam untouched. ``intersect.ts`` / ``seamAnchor.ts`` UNTOUCHED. Pure
 * module — no React, no Date.now / Math.random, no I/O.
 */

import { collectGapBands, emitBandContourCurve } from './emitBands'
import { effectiveCorrForSide, isBandMember } from './effectiveCorr'
import { type ResolvedTie } from './emitCurves'
import { type LensLabel } from './emitLenses'
import { sameFormationBaseTiedPair, sameFormationEnclosedByTiedBand } from './terminationRules'
import { type ColumnGeom, type SectionInput, type UnitGeom } from './sectionGeom'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/** A facing same-formation run overlapping the unit's band: its own top/base elevations. */
interface FacingRun {
  top: number
  base: number
}

/**
 * Emit the ruled-exempt same-formation band contours for every gap+side+unit that the sweep
 * suppressed (8e / 8g(b) / corr-2 band members whose facing carries the same formation).
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry elevations + x; edges are raw).
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning (drive ``effectiveCorrForSide`` + bands).
 * lensLabels : Map<string, LensLabel>
 *     Shared label map — the band contours carry no label (column verticals stamp the face); the
 *     map is kept for signature parity with the sweep / flood / substrate passes.
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 */
export function emitRuledBands(
  section: SectionInput,
  activeTies: readonly ResolvedTie[],
  lensLabels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  void lensLabels
  const { columns } = section
  if (columns.length < 2) return
  let seq = 0
  const nextId = (): string => `rband${seq++}`
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    const bands = collectGapBands(gi, left, right, activeTies)
    const shallowTD = Math.max(tdOf(left), tdOf(right))
    emitSideRuledBands(gi, 'left', left, right, bands, activeTies, shallowTD, nextId, out)
    emitSideRuledBands(gi, 'right', right, left, bands, activeTies, shallowTD, nextId, out)
  }
}

/** Emit the ruled-exempt band contours for ONE side of ONE gap. */
function emitSideRuledBands(
  gapIndex: number,
  side: 'left' | 'right',
  col: ColumnGeom,
  facing: ColumnGeom,
  bands: ReturnType<typeof collectGapBands>,
  activeTies: readonly ResolvedTie[],
  shallowTD: number,
  nextId: () => string,
  out: InputCurve[],
): void {
  const left = side === 'left' ? col : facing
  const right = side === 'left' ? facing : col
  const corr = effectiveCorrForSide(gapIndex, side, col, facing, left, right, activeTies)
  for (let ui = 0; ui < col.units.length; ui++) {
    const u = col.units[ui] as UnitGeom
    const eff = corr[ui] ?? { topTied: false, baseTied: false, corr: 0 as const }
    // Only units the sweep suppressed as a BAND are candidates: a corr-2 band member / first
    // unit, OR a corr-1 unit that the ruled 8e / 8g(b) merge exempts. A corr-0 unit is a genuine
    // termination (never suppressed) — skip. A unit that is ITSELF a matched-pair band member (by
    // index) is already closed by ``emitBands`` contours — skip. (The formation appearing in some
    // OTHER band in the gap is NOT a reason to skip — that coarse fid test wrongly skipped the
    // Tie-7 KLEI first unit because KLEI also carries a band 11 m below.)
    if (isBandMember(bands, side, ui)) continue
    const isRuledBand =
      eff.corr === 2 ||
      (eff.corr === 1 &&
        (sameFormationEnclosedByTiedBand(bands, u.formationId) ||
          sameFormationBaseTiedPair(eff.baseTied, eff.topTied, u.formationId, u.baseElev, u.topElev, facing)))
    if (!isRuledBand) continue
    // The facing same-formation run overlapping this unit's band. When the facing carries a
    // DIFFERENT formation over the whole window there is no same-formation band to close here
    // (that is a mismatched onlap/midpoint-quad case, handled elsewhere) — skip.
    const run = facingSameFormationRun(facing, u.formationId, u.topElev, u.baseElev)
    if (run === null) continue
    // PEER GUARD: the facing run must be a genuine BAND PEER — most of its own extent must lie
    // within the unit's elevation band — not a large enclosing MATRIX the unit merely dips into.
    // A thin unit (−5.01..−5.64, 0.63 m) whose facing "same-formation run" is an 8 m matrix
    // (−5.25..+2.75) is NOT a band pair: drawing the asymmetric band from the unit's contact to
    // the matrix's far contact yields a near-vertical contour that slices the enclosing ZAND flood
    // (CS2 gap17 SILT×ZAND, 55 overlaps). Require the facing run to overlap the unit's band by at
    // least half the run's OWN thickness (a peer sits mostly in the window; a matrix barely does).
    const overlap = Math.min(u.topElev, run.top) - Math.max(u.baseElev, run.base)
    const runThickness = run.top - run.base
    if (overlap < 0.5 * runThickness - ELEV_EPS) continue
    // Emit the asymmetric band's TOP + BASE contours (each side its OWN contact), clamped above
    // the shallow TD. Both columns carry the formation over the window, so the closed full-width
    // face is that one formation — no cross-litho overlap. The DCEL merges a contour that
    // coincides with an existing tie / bandc.
    emitBandContourCurve(left.x, right.x,
      side === 'left' ? u.topElev : run.top, side === 'left' ? run.top : u.topElev,
      shallowTD, nextId, out)
    emitBandContourCurve(left.x, right.x,
      side === 'left' ? u.baseElev : run.base, side === 'left' ? run.base : u.baseElev,
      shallowTD, nextId, out)
  }
}

/** TD elevation of a column (its deepest unit's base). */
function tdOf(col: ColumnGeom): number {
  let td = Infinity
  for (const u of col.units) if (u.baseElev < td) td = u.baseElev
  return td
}

/**
 * The facing column's same-formation run overlapping the unit's [base..top] band — the run
 * whose OWN top/base the asymmetric band contour meets. Returns the union top/base of every
 * facing ``fid`` unit that elevation-overlaps the window (a facing formation split across two
 * units still yields one enclosing run). ``null`` when the facing carries no ``fid`` in the
 * window (a mismatched enclosing — not a same-formation band).
 */
function facingSameFormationRun(
  facing: ColumnGeom,
  fid: string,
  top: number,
  base: number,
): FacingRun | null {
  let runTop = -Infinity
  let runBase = Infinity
  let found = false
  for (const fu of facing.units) {
    if (fu.formationId !== fid) continue
    if (Math.min(fu.topElev, top) - Math.max(fu.baseElev, base) <= ELEV_EPS) continue // no overlap
    found = true
    if (fu.topElev > runTop) runTop = fu.topElev
    if (fu.baseElev < runBase) runBase = fu.baseElev
  }
  return found ? { top: runTop, base: runBase } : null
}
