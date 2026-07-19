/**
 * partitionFillV2/computeSectionFillV2.ts — the v2 whole-section entry point.
 *
 * Same signature and output contract as v1 ``computeSectionFill`` (design §5):
 *
 *   computeSectionFillV2(columns, edges, lensApexOverrides?, alongM?) ->
 *     SectionRegion[]
 *
 * Pipeline (design §3):
 *   1. normalise input        (sectionGeom.buildSectionInput)
 *   2. emit the four curve     (emitCurves.emitCurves)
 *      families + detect
 *      crossing-tie conflicts
 *   3. build planar arrangement (arrangement.buildArrangement) -> trace faces
 *   4. label faces             (labelFaces.labelFaces)
 *   5. slice at column          (slice.sliceFaces) -> per-gap SectionRegion[]
 *      verticals
 *
 * Deep-to-deep substrate bridges are DEFERRED to increment 3 — sub-TD strips with
 * no tie anchor stay unfilled (design §4 / owner §8 Q3).
 *
 * The detected crossing-tie conflicts are exposed via
 * ``computeSectionFillV2WithConflicts`` for the (later) UI warning surface; the
 * plain ``computeSectionFillV2`` returns only the regions (drop-in for v1).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { buildArrangement } from './arrangement'
import { emitCurves, type TieConflict } from './emitCurves'
import { labelFaces } from './labelFaces'
import { mergeTouchingBodies } from './mergeTouchingBodies'
import { buildSectionInput } from './sectionGeom'
import { sliceFaces } from './slice'
import { twoSidedTerminationsEnabled } from './tileFlags'
import {
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type SectionRegion,
} from '../partitionFill'

/**
 * Compute the v2 partition fill for a whole section.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     Litho columns (units sorted shallow->deep). Empty columns are dropped.
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges (layer-id pairs, side-aware).
 * lensApexOverrides : optional per-(body, gap) apex / freedraw overrides.
 * alongM : optional real along-section metres, 1:1 with ``columns`` (load-bearing;
 *     uniform spacing diverges). When absent, columns are treated as unit-spaced.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     Per-gap regions in fraction×elevation space (design §5).
 */
export function computeSectionFillV2(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): SectionRegion[] {
  return computeSectionFillV2WithConflicts(columns, edges, lensApexOverrides, alongM).regions
}

/**
 * Same as ``computeSectionFillV2`` but also returns the detected crossing-tie
 * conflicts (owner §8 Q4). The conflicts are the pairs of approved ties that
 * geometrically cross in a gap; both were suspended for banding and their units
 * fell back to pinch/lens closing curves. The UI warning surface consumes these
 * (built later — this increment only surfaces the data).
 */
export function computeSectionFillV2WithConflicts(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): { regions: SectionRegion[]; conflicts: TieConflict[] } {
  const section = buildSectionInput(columns, edges, lensApexOverrides, alongM)
  if (section.columns.length < 2) return { regions: [], conflicts: [] }

  const { curves, conflicts, lensLabels } = emitCurves(section)
  const arrangement = buildArrangement(curves)
  // Pass the whole ARRANGEMENT so the flag-ON seed path (labelFaces, SEED_FILL_MANDATE) can
  // measure each face's non-zero column-edge seeds from the half-edge provenance. Flag-OFF
  // ignores it and takes the original vote path (byte-identical).
  const labelled = labelFaces(arrangement.faces, section.columns, lensLabels, arrangement)
  const sliced = sliceFaces(labelled, section.columns)
  // RULING 8j "MERGE AFTER FILL" (2026-07-17): after the fill, same-litho regions that TOUCH
  // (within-gap footprint + cross-gap shared-column overlap) merge into one body — the staged
  // body model, stage 1 (per-section geometric connect, small to large). Body-only relabel:
  // never moves a vertex, so holes/overlaps/conformance are invariant. Gated on the hoist flag so
  // flag-OFF stays the frozen v1-seam baseline byte-identical (the campaign safety line).
  const regions = twoSidedTerminationsEnabled() ? mergeTouchingBodies(sliced, section.columns) : sliced
  return { regions, conflicts }
}
