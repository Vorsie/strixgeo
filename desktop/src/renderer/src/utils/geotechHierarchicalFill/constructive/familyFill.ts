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

import { fillGap } from './fillGap'
import { resolveRunTies, type RunBand, type RunColumn, type RunTie } from './constructs'
import type { Mass } from './emitKernel'
import type { LithoFamily } from '../families'
import type { CorrelationEdge, SectionRegion } from '../../partitionFill'
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

/** What one family produced. */
export interface FamilyFillResult {
  regions: SectionRegion[]
  /** The pre-merge loops, single owner + role each — the audit's surface. */
  preMerge: (SectionRegion & { role: 'construct' | 'fill' })[]
  /** Cover no class reached — the "correlate me" hatch. */
  fallback: SectionRegion[]
  conflicts: TieConflict[]
  /** Gaps with no run of banded tests over them. */
  oneSidedGaps: number
  /** Cover the dominant-mass step classified, in m². */
  remainderAreaM2: number
  /** Loops whose dominant mass needed the vertical line to decide. */
  splitRemainders: number
  /** Unclassed cover, in m², by why (see the diagnostics type). */
  residualAreaM2: { noBands: number; outsideBandRange: number }
}

/** Ring area in square metres: fraction-space area scaled by the gap width. */
function areaM2(region: SectionRegion, alongM: readonly number[]): number {
  const width = alongM[region.gapIndex + 1] - alongM[region.gapIndex]
  if (!Number.isFinite(width)) return 0
  let twice = 0
  const ring = region.polygon
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    twice += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return (Math.abs(twice) / 2) * Math.abs(width)
}

/**
 * Fill one family's cover, gap by gap.
 *
 * @param family The litho chain this fill belongs to.
 * @param own Its banded columns, by frame column index.
 * @param blockers Frame columns carrying its litho unit with no band of it.
 * @param runs Its runs of banded columns (see ``runsBetweenBlockers``).
 * @param context The section around it (see {@link FamilyFillContext}).
 * @returns The classed regions, the hatch, the crossings and the counters.
 */
export function fillFamily(
  family: LithoFamily,
  own: ReadonlyMap<number, RunColumn>,
  blockers: ReadonlySet<number>,
  runs: readonly number[][],
  context: FamilyFillContext,
): FamilyFillResult {
  const { alongM } = context
  const out: FamilyFillResult = {
    regions: [],
    preMerge: [],
    fallback: [],
    conflicts: [],
    oneSidedGaps: 0,
    remainderAreaM2: 0,
    splitRemainders: 0,
    residualAreaM2: { noBands: 0, outsideBandRange: 0 },
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

  for (const gap of [...family.regionsByGap.keys()].sort((a, b) => a - b)) {
    const cover = family.regionsByGap.get(gap) as SectionRegion[]
    // One of this gap's tests carries the family and has not been divided: the
    // ground reads empty, whole (owner ruling 2026-08-15). A class here would be
    // an interpretation the engineer has not accepted, and pressing
    // "4 · Divide boreholes" is what accepts it.
    if (blockers.has(gap) || blockers.has(gap + 1) || own.size === 0) {
      out.fallback.push(...cover)
      for (const r of cover) out.residualAreaM2.noBands += areaM2(r, alongM)
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
    const runWithAdopted =
      run === null ? null : { left: withAdopted(run.left), right: withAdopted(run.right) }
    const filled = fillGap({
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
    out.regions.push(...filled.covered)
    out.preMerge.push(...filled.preMerge)
    out.fallback.push(...filled.residual)
    out.remainderAreaM2 += filled.remainderAreaM2
    out.splitRemainders += filled.splitRemainders
    for (const r of filled.residual) out.residualAreaM2.outsideBandRange += areaM2(r, alongM)
  }
  void family
  return out
}
