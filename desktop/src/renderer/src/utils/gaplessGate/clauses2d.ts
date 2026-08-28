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
 * TWO THINGS THIS MODULE OWES THE ENGINEER, both learned from a real report he
 * read on 2026-08-28:
 *
 *  1. **A magnitude he can act on.** See ``formatMeasure`` — clause 1's budget
 *     is small enough that every genuine failure used to round to the word
 *     "0", and a guarantee reported broken by nothing is worse than silence.
 *  2. **Somewhere to go.** Every entry names the gap's own two COLUMNS, not
 *     just its index — see ``gapLocator`` and ``gap_investigation_ids`` in
 *     ``types.ts``. This is the only place in the app where the frame's column
 *     list and the gap index are in scope together, so it is the only place
 *     the pair can honestly be resolved.
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
  /**
   * The investigation each frame column stands on, 1:1 with ``alongM``.
   *
   * Required, not optional: this is the ONLY list a gap index is valid
   * against, and it exists here so the pair can be resolved while the frame is
   * still in scope. A caller that could supply it and did not would mint
   * findings nobody can navigate to (see ``gap_investigation_ids`` in
   * ``types.ts``), so the type refuses to let it be forgotten.
   */
  columnInvestigationIds: readonly string[]
}

const NO_FILL_REASON =
  'no hierarchical geotech fill ran for this section (litho build, or this section has no litho frame)'

/**
 * Format a measurement for a human sentence.
 *
 * Two decimals is the readable default and was, until 2026-08-28, the whole
 * rule. It is a LIE for clause 1. That clause's budget is one snap-grid
 * millimetre per metre of gap width (``areaConservationEpsilonM2``), so on any
 * normal gap the SMALLEST difference it can call a defect is far below
 * 0.005 m² — the point where two decimals round to the word "0". The owner was
 * shown *"which is 0 m² less than the litho cover's 8.42 m²"*: a guarantee
 * reported broken by an amount of nothing.
 *
 * So: two decimals while two decimals still say something, and three
 * significant figures when they do not. Significant figures rather than more
 * decimals because the range this formatter has to cover is the whole span
 * from a square millimetre to thousands of square metres, and a fixed decimal
 * count is wrong at one end or the other by construction — three sig figs is
 * the same amount of information at every magnitude. Only a value that really
 * is zero prints "0", and every number that already read well (2.5 m, 3.4 m²,
 * 50 m²) is untouched, which is why clauses 2 and 3 stay on this one
 * formatter rather than forking a second.
 *
 * @param value The measurement, in whatever unit its sentence names.
 * @returns The number as a human would write it, never rounded to nothing.
 */
function formatMeasure(value: number): string {
  const twoDecimals = Number(value.toFixed(2))
  // ``value === 0`` also catches -0, which must print "0" and not fall through.
  if (twoDecimals !== 0 || value === 0) return twoDecimals.toString()
  return Number(value.toPrecision(3)).toString()
}

/**
 * The locator every 2-D entry carries.
 *
 * The section and the gap index are what the sentence SAYS; the gap's two
 * columns are what a reader navigates BY (see ``gap_investigation_ids`` in
 * ``types.ts`` for why an index must never leave this module). The pair is
 * omitted, never guessed, when the frame's column list does not reach this gap
 * — which happens for a violation the fill reports on a gap the frame's own
 * axis does not hold.
 *
 * @param sectionId The cross-section row id.
 * @param sectionName Its display name.
 * @param gapIndex The gap on the FRAME's own axis.
 * @param columnInvestigationIds The frame's column list, 1:1 with its axis.
 * @returns The locator fields, ready to spread into a ``GaplessClauseEntry``.
 */
function gapLocator(
  sectionId: string,
  sectionName: string,
  gapIndex: number,
  columnInvestigationIds: readonly string[],
): Pick<
  GaplessClauseEntry,
  'section_id' | 'section_name' | 'gap_index' | 'gap_investigation_ids'
> {
  const left = columnInvestigationIds[gapIndex]
  const right = columnInvestigationIds[gapIndex + 1]
  return {
    section_id: sectionId,
    section_name: sectionName,
    gap_index: gapIndex,
    ...(left !== undefined && right !== undefined && { gap_investigation_ids: [left, right] }),
  }
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
  columnInvestigationIds: readonly string[],
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
    // The two TOTALS deliberately stay at reading precision, so on a small
    // difference the sentence says "totals 8.42 m², which is 0.0012 m² less
    // than … 8.42 m²". That is not a bug to fix by printing more decimals on
    // them: the difference is the finding, the totals are only its scale, and
    // a pair of eight-decimal numbers would bury the one number that matters.
    entries.push({
      label:
        `${sectionName}, gap ${gapIndex}: classed + unclassed cover totals ` +
        `${formatMeasure(classedM2 + unclassedM2)} m², which is ${formatMeasure(Math.abs(deltaM2))} m² ` +
        `${direction} the litho cover's ${formatMeasure(coverM2)} m²` +
        // The allowance, spelled out — clause 1 is the only 2-D clause with a
        // budget that is not zero, and it is derived from THIS gap's width, so
        // the bare difference alone is a number the engineer cannot judge.
        // Naming what the gap was allowed turns it into a verdict he can act
        // on. Clauses 2 and 3 forbid the thing outright, so "more than the 0
        // allowed" would be noise there and they say nothing.
        ` — more than the ${formatMeasure(epsilon)} m² allowed for a gap this wide`,
      ...gapLocator(sectionId, sectionName, gapIndex, columnInvestigationIds),
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
  columnInvestigationIds: readonly string[],
): SectionClauseEvidence {
  const entries: GaplessClauseEntry[] = hierarchical.diagnostics.edgeReachViolations.map((v) => ({
    label:
      `${sectionName}, gap ${v.gapIndex}, ${v.edge === 0 ? 'left' : 'right'} column edge: the 3-D ` +
      `build would read this edge as empty ground, though the litho cover holds ${formatMeasure(v.coverM)} m there`,
    ...gapLocator(sectionId, sectionName, v.gapIndex, columnInvestigationIds),
    measure: { value: v.coverM, unit: 'm', budget: 0 },
  }))
  return { key: 'edge-reach', status: entries.length > 0 ? 'fail' : 'pass', entries }
}

/** Clause 3 (cause-closure) — a verbatim relabel of ``diagnostics.totalityViolations``. */
function causeClosureFor(
  sectionId: string,
  sectionName: string,
  hierarchical: HierarchicalGeotechFillResult,
  columnInvestigationIds: readonly string[],
): SectionClauseEvidence {
  const entries: GaplessClauseEntry[] = hierarchical.diagnostics.totalityViolations.map((v) => ({
    label:
      `${sectionName}, gap ${v.gapIndex}: ${formatMeasure(v.areaM2)} m² of litho cover is neither ` +
      `classed nor accounted for (${v.faces} unanswered ${v.faces === 1 ? 'loop' : 'loops'})`,
    ...gapLocator(sectionId, sectionName, v.gapIndex, columnInvestigationIds),
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
  const { sectionId, sectionName, hierarchical, lithoRegions, alongM, columnInvestigationIds } =
    input
  if (hierarchical === undefined) {
    return (['area-conservation', 'edge-reach', 'cause-closure'] as const).map((key) => ({
      key,
      status: 'not-evaluated' as const,
      notEvaluatedReason: NO_FILL_REASON,
      entries: [],
    }))
  }
  return [
    areaConservationFor(
      sectionId,
      sectionName,
      hierarchical,
      lithoRegions,
      alongM,
      columnInvestigationIds,
    ),
    edgeReachFor(sectionId, sectionName, hierarchical, columnInvestigationIds),
    causeClosureFor(sectionId, sectionName, hierarchical, columnInvestigationIds),
  ]
}
