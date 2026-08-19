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
 *  3. per gap, work out which two tests the ground runs between, what each
 *     band's envelope is there, and hand it to ``fillGap``.
 *
 * @module utils/geotechHierarchicalFill/constructive/familyFill
 */

import { fillGap } from './fillGap'
import { resolveRunTies, type RunBand, type RunColumn, type RunTie } from './constructs'
import type { MatrixReader, ReachLine } from './matrixOwner'
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
  /** Every litho region per gap, in the render's z-order — ownership authority. */
  paintByGap: ReadonlyMap<number, SectionRegion[]>
  /** Litho unit layer id → its frame column index. */
  lithoColumnOfLayer: ReadonlyMap<string, number>
  /** Litho unit layer id → its own elevations. */
  lithoUnitElev: ReadonlyMap<string, { top: number; base: number }>
  /** Packing band layer id → the litho unit it subdivides. */
  parentOfBand: ReadonlyMap<string, string>
}

/** What one family produced. */
export interface FamilyFillResult {
  regions: SectionRegion[]
  /** Cover no class reached — the "correlate me" hatch. */
  fallback: SectionRegion[]
  conflicts: TieConflict[]
  /** Gaps with no run of banded tests over them. */
  oneSidedGaps: number
  /** Cover the matrix rulings classified, in m². */
  matrixAreaM2: number
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
 * The masses this family's own correlations declare: bands a tie joins are one
 * mass and their paint welds in Phase 3; an untied band is alone in its own.
 * This is what keeps a deleted tie deleted through the merge.
 */
function tieGroups(
  edges: readonly CorrelationEdge[],
  bandOfLayer: ReadonlyMap<string, RunBand>,
): Map<string, string> {
  const groupOf = new Map<string, string>()
  const root = (layerId: string): string => {
    let found = groupOf.get(layerId) ?? layerId
    while (found !== (groupOf.get(found) ?? found)) found = groupOf.get(found) as string
    groupOf.set(layerId, found)
    return found
  }
  for (const edge of edges) {
    const ra = root(edge.a)
    const rb = root(edge.b)
    if (ra !== rb) groupOf.set(ra, rb)
  }
  for (const layerId of bandOfLayer.keys()) groupOf.set(layerId, root(layerId))
  return groupOf
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
    fallback: [],
    conflicts: [],
    oneSidedGaps: 0,
    matrixAreaM2: 0,
    residualAreaM2: { noBands: 0, outsideBandRange: 0 },
  }

  const bandOfLayer = new Map<string, RunBand>()
  for (const column of own.values()) for (const band of column.bands) bandOfLayer.set(band.layerId, band)
  // The family's OWN correlations — both ends its own bands. The envelope reads
  // these and only these; the bounding set (which may name a neighbouring
  // family's band on a shared contact) is a line source, not an envelope.
  const familyEdges = context.boundingEdges.filter(
    (e) => bandOfLayer.has(e.a) && bandOfLayer.has(e.b),
  )
  const tieGroupOf = tieGroups(familyEdges, bandOfLayer)

  const resolved = runs.map((indices) => {
    const columns = indices.map((ci) => own.get(ci) as RunColumn)
    const { ties, crossings } = resolveRunTies(
      context.boundingEdges,
      columns,
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
    // ground reads empty, whole (owner ruling 2026-08-15). No construct, no
    // matrix — a class here would be an interpretation the engineer has not
    // accepted, and pressing "4 · Divide boreholes" is what accepts it.
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

    const pair = run === null ? [gap, gap + 1] : [run.left.ci, run.right.ci]
    const reach = buildReach(family, own, bandOfLayer, familyEdges, pair, context)
    const readers: MatrixReader[] = [...own.values()].map((column) => ({
      ci: column.ci,
      x: column.x,
      bands: column.bands,
      reach,
      flank: pair.includes(column.ci),
    }))
    const filled = fillGap({
      gapIndex: gap,
      xa: alongM[gap],
      xb: alongM[gap + 1],
      cover,
      gapPaint: context.paintByGap.get(gap) ?? cover,
      run,
      ties,
      coverTies,
      readers,
      tieGroupOf,
    })
    out.regions.push(...filled.covered)
    out.fallback.push(...filled.residual)
    out.matrixAreaM2 += filled.matrixAreaM2
    for (const r of filled.residual) out.residualAreaM2.outsideBandRange += areaM2(r, alongM)
  }
  return out
}

/**
 * THE ENVELOPE, per band: the lines it carries across THIS ground.
 *
 * A band reaches along the lines drawn for it and nowhere else — that is the
 * whole of the 2/1/0 law applied to the matrix, and it is the same envelope the
 * conformance gate audits, so the fill and the gate cannot disagree. Two
 * sources, and the scope is the pair of tests the ground runs between (a line
 * drawn elsewhere on the section bounds nothing here):
 *
 *  * its own PACKING ties — a correlation is the statement that the band
 *    follows that line, so the form the line closes is the band's to fill;
 *  * its parent unit's LITHO ties — litho approval carries down (ruling A): the
 *    soil is one connected mass across the gap, so its bands may reach along
 *    it. Without this a cover whose geotech restatement was deleted falls apart
 *    and the middle of a twice-tied band renders "correlate me" (his dark clay
 *    quad between B6 and B4). It governs the SOIL cover only — the class
 *    banding still answers to the packing ties alone, so a deleted tie is never
 *    resurrected as a band.
 */
function buildReach(
  family: LithoFamily,
  own: ReadonlyMap<number, RunColumn>,
  bandOfLayer: ReadonlyMap<string, RunBand>,
  familyEdges: readonly CorrelationEdge[],
  pair: readonly number[],
  context: FamilyFillContext,
): Map<string, ReachLine[]> {
  const reach = new Map<string, ReachLine[]>()
  const widen = (layerId: string, line: ReachLine): void => {
    const current = reach.get(layerId)
    if (current === undefined) reach.set(layerId, [line])
    else current.push(line)
  }
  for (const edge of familyEdges) {
    for (const [near, nearSide, far, farSide] of [
      [edge.a, edge.aSide, edge.b, edge.bSide],
      [edge.b, edge.bSide, edge.a, edge.aSide],
    ] as const) {
      const nearBand = bandOfLayer.get(near)
      const farBand = bandOfLayer.get(far)
      if (nearBand === undefined || farBand === undefined) continue
      if (!pair.includes(nearBand.ci) || !pair.includes(farBand.ci)) continue
      if (nearBand.ci === farBand.ci) continue
      // From the tied contact on this band to the tied contact on the far one —
      // both sides matter: a base-side tie leaves the band's base, not its top.
      widen(near, {
        leftX: nearBand.x,
        leftY: nearSide === 'base' ? nearBand.base : nearBand.top,
        rightX: farBand.x,
        rightY: farSide === 'base' ? farBand.base : farBand.top,
      })
    }
  }
  for (const edge of context.lithoEdges) {
    for (const [near, nearSide, far, farSide] of [
      [edge.a, edge.aSide, edge.b, edge.bSide],
      [edge.b, edge.bSide, edge.a, edge.aSide],
    ] as const) {
      if (!family.lithoLayerIds.has(near) || !family.lithoLayerIds.has(far)) continue
      const nearCi = context.lithoColumnOfLayer.get(near)
      const farCi = context.lithoColumnOfLayer.get(far)
      if (nearCi === undefined || farCi === undefined || nearCi === farCi) continue
      if (!pair.includes(nearCi) || !pair.includes(farCi)) continue
      const nearUnit = context.lithoUnitElev.get(near)
      const farUnit = context.lithoUnitElev.get(far)
      if (nearUnit === undefined || farUnit === undefined) continue
      const line: ReachLine = {
        leftX: context.alongM[nearCi],
        leftY: nearSide === 'base' ? nearUnit.base : nearUnit.top,
        rightX: context.alongM[farCi],
        rightY: farSide === 'base' ? farUnit.base : farUnit.top,
      }
      // Every band of the near unit inherits it: the whole unit was tied.
      for (const band of own.get(nearCi)?.bands ?? []) {
        if (context.parentOfBand.get(band.layerId) !== near) continue
        widen(band.layerId, line)
      }
    }
  }
  return reach
}
