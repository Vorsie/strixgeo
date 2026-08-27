/**
 * CLAUSES 1-3, PER SECTION — the 2-D half of the gapless gate that reads
 * straight off one section's own hierarchical fill.
 *
 * This module computes NOTHING new about whether the fill is correct — clause
 * 2 and clause 3 report exactly what ``edgeReach.ts`` and ``fillTotality.ts``
 * already found (re-deriving would give the report a second opinion that can
 * disagree with the engine). Clause 1 (area-conservation) IS new: nothing in
 * the engine asserts today that classed + unclassed cover equals the litho
 * cover it subdivides, so this module builds that comparison, per gap, from
 * three ``SectionRegion[]`` surfaces already in the same fraction-elevation
 * space (see ``partitionFill/regionArea.ts``).
 *
 * A section that ran no hierarchical fill at all (a litho build has no
 * geotech frame; a section can also simply have no matching litho frame) has
 * nothing for any of the three clauses to measure — ``not-evaluated``, never
 * a soft ``pass`` (see ``gaplessGate/types.ts``'s own doc on the distinction).
 *
 * @module utils/gaplessGate/clauses2d
 */

import { areaConservationEpsilonM2 } from './gaplessGate_constants'
import type { GaplessClauseEntry, GaplessClauseKey, GaplessClauseStatus } from './types'
import type { HierarchicalGeotechFillResult } from '../geotechHierarchicalFill'
import type { SectionRegion } from '../partitionFill'
import { regionAreaM2FromAlongM } from '../partitionFill/regionArea'

/** The three 2-D clause keys this module answers (clause 4 lives in ``sectionClosure.ts``). */
export type Clause2dKey = Extract<GaplessClauseKey, 'area-conservation' | 'edge-reach' | 'cause-closure'>

/** One section's evidence for one of the three 2-D clauses — substance only, no clause number/title. */
export interface SectionClauseEvidence {
  key: Clause2dKey
  status: GaplessClauseStatus
  /** Present only on ``not-evaluated``, mirroring ``GaplessClauseInput``. */
  notEvaluatedReason?: string
  entries: GaplessClauseEntry[]
}

/** Everything one section needs for its three 2-D clauses. */
export interface SectionClause2dInput {
  /** The cross-section row id. */
  sectionId: string
  /** Its display name, so every entry reads without a lookup. */
  sectionName: string
  /**
   * This section's hierarchical fill result, or ``undefined`` when none ran
   * (litho build, or this section has no litho frame) — the ``undefined``
   * case is what drives all three clauses to ``not-evaluated``.
   */
  hierarchical: HierarchicalGeotechFillResult | undefined
  /** The litho frame's own partition for this section — clause 1's reference. */
  lithoRegions: readonly SectionRegion[]
  /** Along-section metres per frame column, 1:1 with the frame's columns. */
  alongM: readonly number[]
}

const NO_FILL_REASON =
  'no hierarchical geotech fill ran for this section (litho build, or this section has no litho frame)'

/** Format a measurement for a human sentence: up to 2 decimals, no trailing zeros. */
function formatMeasure(value: number): string {
  return Number(value.toFixed(2)).toString()
}

/** Sum a region list's area, per gap index, using ``regionAreaM2FromAlongM``. */
function areaByGap(
  regions: readonly SectionRegion[],
  alongM: readonly number[],
): Map<number, number> {
  const out = new Map<number, number>()
  for (const region of regions) {
    out.set(region.gapIndex, (out.get(region.gapIndex) ?? 0) + regionAreaM2FromAlongM(region, alongM))
  }
  return out
}

/** Clause 1 (area-conservation) for one section that DID run a hierarchical fill. */
function areaConservationFor(
  sectionId: string,
  sectionName: string,
  hierarchical: HierarchicalGeotechFillResult,
  lithoRegions: readonly SectionRegion[],
  alongM: readonly number[],
): SectionClauseEvidence {
  const classed = areaByGap(hierarchical.regions, alongM)
  const unclassed = areaByGap(hierarchical.lithoFallback, alongM)
  const cover = areaByGap(lithoRegions, alongM)
  const gapIndices = new Set<number>([...classed.keys(), ...unclassed.keys(), ...cover.keys()])
  const entries: GaplessClauseEntry[] = []
  for (const gapIndex of [...gapIndices].sort((a, b) => a - b)) {
    const width = alongM[gapIndex + 1] - alongM[gapIndex]
    if (!Number.isFinite(width)) continue // gapIndex outside this frame's own axis — nothing to measure
    const classedM2 = classed.get(gapIndex) ?? 0
    const unclassedM2 = unclassed.get(gapIndex) ?? 0
    const coverM2 = cover.get(gapIndex) ?? 0
    const deltaM2 = classedM2 + unclassedM2 - coverM2
    const epsilon = areaConservationEpsilonM2(width)
    if (Math.abs(deltaM2) <= epsilon) continue
    const direction = deltaM2 > 0 ? 'more than' : 'less than'
    entries.push({
      label:
        `${sectionName}, gap ${gapIndex}: classed + unclassed cover totals ` +
        `${formatMeasure(classedM2 + unclassedM2)} m², which is ${formatMeasure(Math.abs(deltaM2))} m² ` +
        `${direction} the litho cover's ${formatMeasure(coverM2)} m²`,
      section_id: sectionId,
      section_name: sectionName,
      gap_index: gapIndex,
      measure: { value: Math.abs(deltaM2), unit: 'm2', budget: epsilon },
    })
  }
  return { key: 'area-conservation', status: entries.length > 0 ? 'fail' : 'pass', entries }
}

/** Clause 2 (edge-reach) — a verbatim relabel of ``diagnostics.edgeReachViolations``. */
function edgeReachFor(
  sectionId: string,
  sectionName: string,
  hierarchical: HierarchicalGeotechFillResult,
): SectionClauseEvidence {
  const entries: GaplessClauseEntry[] = hierarchical.diagnostics.edgeReachViolations.map((v) => ({
    label:
      `${sectionName}, gap ${v.gapIndex}, ${v.edge === 0 ? 'left' : 'right'} column edge: the 3-D ` +
      `build would read this edge as empty ground, though the litho cover holds ${formatMeasure(v.coverM)} m there`,
    section_id: sectionId,
    section_name: sectionName,
    gap_index: v.gapIndex,
    measure: { value: v.coverM, unit: 'm', budget: 0 },
  }))
  return { key: 'edge-reach', status: entries.length > 0 ? 'fail' : 'pass', entries }
}

/** Clause 3 (cause-closure) — a verbatim relabel of ``diagnostics.totalityViolations``. */
function causeClosureFor(
  sectionId: string,
  sectionName: string,
  hierarchical: HierarchicalGeotechFillResult,
): SectionClauseEvidence {
  const entries: GaplessClauseEntry[] = hierarchical.diagnostics.totalityViolations.map((v) => ({
    label:
      `${sectionName}, gap ${v.gapIndex}: ${formatMeasure(v.areaM2)} m² of litho cover is neither ` +
      `classed nor accounted for (${v.faces} unanswered ${v.faces === 1 ? 'loop' : 'loops'})`,
    section_id: sectionId,
    section_name: sectionName,
    gap_index: v.gapIndex,
    measure: { value: v.areaM2, unit: 'm2', budget: 0 },
  }))
  return { key: 'cause-closure', status: entries.length > 0 ? 'fail' : 'pass', entries }
}

/**
 * One section's evidence for clauses 1-3.
 *
 * @param input See {@link SectionClause2dInput}.
 * @returns Exactly three entries, one per clause key, in clause-number order.
 */
export function clauses2dForSection(input: SectionClause2dInput): SectionClauseEvidence[] {
  const { sectionId, sectionName, hierarchical, lithoRegions, alongM } = input
  if (hierarchical === undefined) {
    return (['area-conservation', 'edge-reach', 'cause-closure'] as const).map((key) => ({
      key,
      status: 'not-evaluated' as const,
      notEvaluatedReason: NO_FILL_REASON,
      entries: [],
    }))
  }
  return [
    areaConservationFor(sectionId, sectionName, hierarchical, lithoRegions, alongM),
    edgeReachFor(sectionId, sectionName, hierarchical),
    causeClosureFor(sectionId, sectionName, hierarchical),
  ]
}
