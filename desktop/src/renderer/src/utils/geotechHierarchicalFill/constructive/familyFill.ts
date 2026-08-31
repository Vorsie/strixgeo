/**
 * ONE FAMILY — its runs, its lines, its gaps.
 *
 * The section-level assembly (``../index.ts``) works out WHAT each family is;
 * this module fills one. Its three jobs, in order:
 *
 *  1. split the family's banded tests into RUNS — maximal stretches with no
 *     un-divided test of its own soil between them (an un-divided test BLOCKS,
 *     a test that never had this soil is spanned; owner ruling 2026-08-15);
 *  2. resolve each run's lines: the packing ties that bound its contacts, the
 *     litho lines that bound its cover, and the crossings that suspend a pair;
 *  3. per gap, work out which two tests the ground runs between and hand it to
 *     ``fillGap``, which applies the law.
 *
 * @module utils/geotechHierarchicalFill/constructive/familyFill
 */

import { bandContinuations } from './bandContinuation'
import type { BandCarry } from './carriedTaper'
import { fillGap, type GapFillInput } from './fillGap'
import { totalityViolationOf, type TotalityViolation } from './fillTotality'
import {
  buildGapConstructs,
  resolveRunTies,
  type RunBand,
  type RunColumn,
  type RunTie,
} from './constructs'
import type { Mass } from './emitKernel'
import type { LithoFamily } from '../families'
import type { CorrelationEdge, SectionRegion } from '../../sectionPartition'
import { regionAreaM2FromAlongM } from '../../sectionPartition/regionArea'
import type { TieConflict } from '../../partitionFillV2'

/** Everything one family's fill needs from the section around it. */
export interface FamilyFillContext {
  /** Along-section metres, 1:1 with the frame's columns. */
  alongM: readonly number[]
  /** The litho model's APPROVED edges — the cover's own lines. */
  lithoEdges: readonly CorrelationEdge[]
  /** Packing ties that may bound a contact (cross-family ones already dropped). */
  boundingEdges: readonly CorrelationEdge[]
  /** Every packing band of the section, by layer id. */
  geotechBandOfLayer: ReadonlyMap<string, RunBand>
  /** Every litho unit of the section, by layer id, in the same shape. */
  lithoBandOfLayer: ReadonlyMap<string, RunBand>
  /** EVERY packing band per frame column index — the far-end read needs the
   *  neighbouring family's bands too (a tie lands on a shared contact). */
  stacks: ReadonlyMap<number, readonly RunBand[]>
  /** A band's mass: its parent litho unit's soil, and its packing class. */
  massOf: (band: RunBand) => Mass
  /** Every litho region per gap, in the render's z-order — ownership authority. */
  paintByGap: ReadonlyMap<number, SectionRegion[]>
  /**
   * Bands of another family that this family's cover ENCLOSES in a gap, where
   * that family has no cover of its own there. The litho fill merges a
   * same-soil sandwich into one host region, so a unit can lose its cover to
   * its neighbour; its bands are lent to whoever holds the ground, or the test
   * that measured them would read another unit's classes at its own edge (the
   * owner's arrow, 2026-08-20). Same soil only — nothing crosses a lithology.
   */
  adoptedBandsFor: (
    gap: number,
    ci: number,
    coverLo: number,
    coverHi: number,
    soil: string,
  ) => RunBand[]
}

/** What one family's PLANNING pass produced (see {@link planFamily}). */
export interface FamilyPlanResult {
  /** This family's gap plans, ready for the fill once every family's are in. */
  plans: Omit<GapFillInput, 'closureBars'>[]
  conflicts: TieConflict[]
  /** Gaps with no run of banded tests over them. */
  oneSidedGaps: number
  /** Cover this family could never plan for — an un-divided flank (owner ruling 2026-08-15). */
  fallback: SectionRegion[]
  /** That fallback cover, in m². */
  residualNoBandsM2: number
}

/** What the FILL pass produced (see {@link fillPlans}). */
export interface FillPlansResult {
  regions: SectionRegion[]
  /** The pre-merge loops, single owner + role each — the audit's surface. */
  preMerge: (SectionRegion & { role: 'construct' | 'fill' })[]
  /** Cover no class reached — the "correlate me" hatch. */
  fallback: SectionRegion[]
  /** Cover the dominant-mass step classified, in m². */
  remainderAreaM2: number
  /** Loops whose dominant mass needed the vertical line to decide. */
  splitRemainders: number
  /** Cover left unclassed because nothing answered it, in m². */
  residualOutsideBandRangeM2: number
  /**
   * Gaps with a banded run that STILL kept ground — see ``fillTotality.ts``.
   * Empty is the contract since the least-dense ruling of 2026-08-26.
   */
  totalityViolations: TotalityViolation[]
}

/**
 * PLAN one family's gaps — everything through the law's LINES, stopping short
 * of the fill. Split out from the fill itself (owner code-hunt finding F7,
 * 2026-08-22) so ``closureBarsFor`` can run ONCE, over every family's plans
 * together, before any family fills: a band adopted across a family boundary
 * carries its TRUE closure wherever it is consulted, not a re-derivation
 * scoped to whichever family happens to be asking.
 *
 * @param family The litho chain this plan belongs to.
 * @param own Its banded columns, by frame column index.
 * @param blockers Frame columns carrying its litho unit with no band of it.
 * @param runs Its runs of banded columns (see ``runsBetweenBlockers``).
 * @param context The section around it (see {@link FamilyFillContext}).
 * @returns This family's gap plans, the hatch it already knows about, and the
 *   crossing conflicts found while resolving its ties.
 */
export function planFamily(
  family: LithoFamily,
  own: ReadonlyMap<number, RunColumn>,
  blockers: ReadonlySet<number>,
  runs: readonly number[][],
  context: FamilyFillContext,
): FamilyPlanResult {
  const { alongM } = context
  const out: FamilyPlanResult = {
    plans: [],
    conflicts: [],
    oneSidedGaps: 0,
    fallback: [],
    residualNoBandsM2: 0,
  }

  // ADOPTION IS VISIBLE TO TIE RESOLUTION (owner 2026-08-21, the S8|S6 deep
  // VD): a tie landing on a contact only an adopted band carries must resolve
  // at the RUN level, or its line exists only in the gaps whose flanks happen
  // to carry the band — in the S10|B2 gap between two shallow tests the deep
  // VD's lines were not drawn at all and its ground flooded unwalled. Union
  // each column's adoptable bands across the family's gaps (a superset is
  // harmless: extra contacts only ADMIT ties) and resolve against that.
  const adoptedByCi = new Map<number, Map<string, RunBand>>()
  for (const [gap, cover] of family.regionsByGap) {
    let coverLo = Infinity
    let coverHi = -Infinity
    for (const region of cover) {
      for (const p of region.polygon) {
        if (p.elevation < coverLo) coverLo = p.elevation
        if (p.elevation > coverHi) coverHi = p.elevation
      }
    }
    const soil = cover[0]?.formationId ?? ''
    for (const ci of own.keys()) {
      for (const band of context.adoptedBandsFor(gap, ci, coverLo, coverHi, soil)) {
        let byLayer = adoptedByCi.get(ci)
        if (byLayer === undefined) adoptedByCi.set(ci, (byLayer = new Map()))
        byLayer.set(band.layerId, band)
      }
    }
  }
  const augmented = (ci: number): RunColumn => {
    const column = own.get(ci) as RunColumn
    const extra = adoptedByCi.get(ci)
    if (extra === undefined || extra.size === 0) return column
    return { ...column, bands: [...column.bands, ...extra.values()].sort((a, b) => b.top - a.top) }
  }

  const resolved = runs.map((indices) => {
    const columns = indices.map((ci) => own.get(ci) as RunColumn)
    // Resolution sees the adopted contacts; the FILL's flank columns stay
    // per-gap (only that gap's adoptions apply — a band whose own family
    // fills a gap must not also stand in it here).
    const { ties, crossings } = resolveRunTies(
      context.boundingEdges,
      indices.map(augmented),
      context.geotechBandOfLayer,
    )
    // The cover's own boundaries, as lines: an untied contact that IS the parent
    // unit's own contact follows the soil's tie (ruling A).
    const coverTies = resolveRunTies(context.lithoEdges, columns, context.lithoBandOfLayer).ties
    for (const crossing of crossings) {
      // Report on the FRAME gap holding the midpoint of the run gap the crossing
      // was found in, so the warning chip names a gap the engineer can look at.
      const mid = (columns[crossing.runGap].x + columns[crossing.runGap + 1].x) / 2
      let frameGap = 0
      for (let g = 0; g + 1 < alongM.length; g++) {
        if (mid >= alongM[g] && mid <= alongM[g + 1]) {
          frameGap = g
          break
        }
      }
      out.conflicts.push({ gapIndex: frameGap, tieIds: crossing.keys, edgeKeys: crossing.keys })
    }
    return { columns, ties, coverTies }
  })

  // A COLUMN THAT READ NOTHING IS NOT A BOUNDARY (owner 2026-08-21, ported
  // from the litho arm's ``partitionFillV2/emitContinuation.ts`` — see
  // ``bandContinuation.ts`` for the full law and why the geotech arm's
  // gap-by-gap architecture only needs ONE new idea: splice a band that must
  // cross a blind same-family column into every gap along the way, and let
  // ``buildGapConstructs``'s existing ``facingHasData`` sort each one into a
  // flat pass-through or the one real pinch on its own). Computed once per
  // run, gathered by gap, so the per-gap loop below can splice by lookup.
  const continuationsByGap = new Map<number, RunBand[]>()
  // ...and WHERE THE CARRIED SHAPE SLOPES (owner ruling 2026-08-25, *"one
  // smooth taper"* — see ``carriedTaper.ts``). Kept per gap and per layer
  // rather than on the band itself, because one band can carry in BOTH
  // directions with a different apex each way; the two gap sets are disjoint
  // (one lies entirely left of the band's own column, the other entirely
  // right), so a gap never has to choose between them.
  const carryByGap = new Map<number, Map<string, BandCarry>>()
  for (const candidate of resolved) {
    for (const splice of bandContinuations(candidate.columns, candidate.ties, context.stacks)) {
      for (const gap of splice.gaps) {
        let bands = continuationsByGap.get(gap)
        if (bands === undefined) continuationsByGap.set(gap, (bands = []))
        bands.push(splice.band)
      }
      for (const gap of splice.taperGaps) {
        let byLayer = carryByGap.get(gap)
        if (byLayer === undefined) carryByGap.set(gap, (byLayer = new Map()))
        if (!byLayer.has(splice.band.layerId)) byLayer.set(splice.band.layerId, splice.carry)
      }
    }
  }

  // PLAN every gap — the law's LINES, nothing filled yet. Closure bars (an
  // onlap's or a lens's pinch, "the remainder of each closed loop goes to the
  // OPEN mass") are computed by the CALLER, over every family's plans
  // together — see ``closureBarsFor``.
  const plans: Omit<GapFillInput, 'closureBars'>[] = []
  for (const gap of [...family.regionsByGap.keys()].sort((a, b) => a - b)) {
    const cover = family.regionsByGap.get(gap) as SectionRegion[]
    // One of this gap's tests carries the family and has not been divided: the
    // ground reads empty, whole (owner ruling 2026-08-15). A class here would be
    // an interpretation the engineer has not accepted, and pressing
    // "4 · Divide boreholes" is what accepts it.
    if (blockers.has(gap) || blockers.has(gap + 1) || own.size === 0) {
      out.fallback.push(...cover)
      for (const r of cover) out.residualNoBandsM2 += regionAreaM2FromAlongM(r, alongM)
      if (own.size === 0) out.oneSidedGaps += 1
      continue
    }
    // The run whose two banded tests this ground lies between, if any.
    let run: { left: RunColumn; right: RunColumn } | null = null
    let ties: readonly RunTie[] = []
    let coverTies: readonly RunTie[] = []
    for (const candidate of resolved) {
      for (let i = 0; i + 1 < candidate.columns.length; i++) {
        if (candidate.columns[i].ci <= gap && candidate.columns[i + 1].ci >= gap + 1) {
          run = { left: candidate.columns[i], right: candidate.columns[i + 1] }
          ties = candidate.ties
          coverTies = candidate.coverTies
        }
      }
    }
    if (run === null) out.oneSidedGaps += 1

    // The cover's own elevation window, and the bands another family lost to it.
    let coverLo = Infinity
    let coverHi = -Infinity
    for (const region of cover) {
      for (const p of region.polygon) {
        if (p.elevation < coverLo) coverLo = p.elevation
        if (p.elevation > coverHi) coverHi = p.elevation
      }
    }
    const soil = cover[0]?.formationId ?? ''
    const withAdopted = (column: RunColumn): RunColumn => {
      const adopted = context.adoptedBandsFor(gap, column.ci, coverLo, coverHi, soil)
      if (adopted.length === 0) return column
      return {
        ...column,
        bands: [...column.bands, ...adopted].sort((a, b) => b.top - a.top),
      }
    }
    // A continuation band carries its own TRUE .ci/.x — attaching it to
    // whichever flank is CLOSER to that true position makes
    // buildGapConstructs' xFar/facingCi read the OPPOSITE flank, which is
    // the resolved reading column for the terminal gap (correct: that flank
    // genuinely has data, so the ordinary pinch runs) — or, for a merely
    // intermediate gap, the choice is inert either way (extendsToFar claims
    // unconditionally regardless of which flank it is nested under).
    const continuationBands = run === null ? [] : (continuationsByGap.get(gap) ?? [])
    const withContinuation = (column: RunColumn, otherSide: RunColumn): RunColumn => {
      const carried = continuationBands.filter(
        (b) => Math.abs(b.x - column.x) < Math.abs(b.x - otherSide.x),
      )
      if (carried.length === 0) return column
      return { ...column, bands: [...column.bands, ...carried].sort((a, b) => b.top - a.top) }
    }
    // A carried band's SHAPE in this gap — stamped last, so it reaches the band
    // however it got here: standing on its own column as a flank (its own gap),
    // or spliced in from beyond it (any gap further along the carry).
    const carriedHere = carryByGap.get(gap)
    const withCarry = (column: RunColumn): RunColumn => {
      if (carriedHere === undefined) return column
      let changed = false
      const bands = column.bands.map((b) => {
        const carry = carriedHere.get(b.layerId)
        if (carry === undefined) return b
        changed = true
        return { ...b, carry }
      })
      return changed ? { ...column, bands } : column
    }
    const runWithAdopted =
      run === null
        ? null
        : {
            left: withCarry(withAdopted(withContinuation(run.left, run.right))),
            right: withCarry(withAdopted(withContinuation(run.right, run.left))),
          }
    out.plans.push({
      gapIndex: gap,
      xa: alongM[gap],
      xb: alongM[gap + 1],
      cover,
      gapPaint: context.paintByGap.get(gap) ?? cover,
      run: runWithAdopted,
      ties,
      coverTies,
      columns: [...own.values()].map(withAdopted),
      stacks: context.stacks,
      massOf: context.massOf,
    })
  }
  void family
  return out
}

/**
 * THE BARS, run-wide across EVERY family together (owner code-hunt finding
 * F7, 2026-08-22): for every gap whose constructs CLOSE — a lens or an
 * onlap, "the remainder of each closed loop goes to the OPEN mass" applies to
 * both, unconditionally (owner 2026-08-21 night: "the dense sand onlaps so
 * the MD should fill" — S8's D, closed toward S10, answered the sub-TD
 * window two gaps over as if open, because closure was only known to the gap
 * that drew it; owner code-hunt finding B1b, 2026-08-22 extended this to
 * lenses). Computed over the UNION of every family's plans, not one family's
 * own: a band adopted across a family boundary is consulted as a remainder
 * candidate wherever it is lent, and its true closure has to be visible
 * there too — a band re-derived only inside the borrowing family's own gap
 * context could miss a pinch it already made in the family it actually
 * belongs to, or compute a different one from a different run pairing.
 *
 * The bar sits at the construct's own apex: for an onlap that IS the run's
 * own middle (apexX == (band.x + farX) / 2, computed once here and again
 * inside ``buildGapConstructs`` — the two must never drift apart); for a
 * lens it is wherever ``lensReach`` actually pinched, which is normally much
 * closer to the band's own column. A band never answers remainder on the far
 * side of any of its own bars, in any gap, in any family.
 *
 * @param plans EVERY family's plans, flattened together.
 * @param stacks EVERY packing band per column — the far-end read.
 * @param massOf The mass (litho + packing) of a band.
 */
export function closureBarsFor(
  plans: readonly Omit<GapFillInput, 'closureBars'>[],
  stacks: FamilyFillContext['stacks'],
  massOf: FamilyFillContext['massOf'],
): Map<string, number[]> {
  const closureBars = new Map<string, number[]>()
  for (const plan of plans) {
    if (plan.run === null) continue
    const constructs = buildGapConstructs(
      plan.run.left,
      plan.run.right,
      plan.ties,
      plan.coverTies,
      stacks,
      massOf,
    )
    for (const construct of constructs) {
      if (construct.emit === 'nothing' || construct.apexX === undefined) continue
      let bars = closureBars.get(construct.band.layerId)
      if (bars === undefined) closureBars.set(construct.band.layerId, (bars = []))
      bars.push(construct.apexX)
    }
  }
  return closureBars
}

/**
 * FILL every plan — every gap seeing the SAME, run-wide closures (see
 * {@link closureBarsFor}). Family-agnostic: a plan carries everything its own
 * fill needs, so this runs flat over plans from every family together.
 *
 * @param plans EVERY family's plans, flattened together.
 * @param closureBars The run-wide bars from {@link closureBarsFor}.
 * @param alongM Along-section metres, 1:1 with the frame's columns.
 */
export function fillPlans(
  plans: readonly Omit<GapFillInput, 'closureBars'>[],
  closureBars: ReadonlyMap<string, readonly number[]>,
  alongM: readonly number[],
): FillPlansResult {
  const out: FillPlansResult = {
    regions: [],
    preMerge: [],
    fallback: [],
    remainderAreaM2: 0,
    splitRemainders: 0,
    residualOutsideBandRangeM2: 0,
    totalityViolations: [],
  }
  for (const plan of plans) {
    const filled = fillGap({ ...plan, closureBars })
    out.regions.push(...filled.covered)
    out.preMerge.push(...filled.preMerge)
    out.fallback.push(...filled.residual)
    out.remainderAreaM2 += filled.remainderAreaM2
    out.splitRemainders += filled.splitRemainders
    for (const r of filled.residual) out.residualOutsideBandRangeM2 += regionAreaM2FromAlongM(r, alongM)
    const violation = totalityViolationOf(plan, filled)
    if (violation !== null) out.totalityViolations.push(violation)
  }
  return out
}
