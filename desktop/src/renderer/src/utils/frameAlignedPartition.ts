/**
 * Assemble a model's partition on ANOTHER model's column axis — the litho
 * frame's, for the geotech axis (owner dogfeed 2026-08-15).
 *
 * THE CASE. A borehole the packing pipeline has not divided yet carries litho
 * layers and NO packing bands. The shared column assembly
 * (``assembleSectionPartitionInput``) drops a column with no accepted units, so
 * the geotech partition was built over a SHORTER column list than the litho
 * frame: the engine saw one wide test-to-test gap straight over the borehole
 * and tiled it with terminations answering to no column ("what are those weird
 * polygons between the boreholes?"), and because the two gap axes no longer
 * lined up index-for-index the litho-frame clip was skipped entirely ("clearly
 * the litho model isn't the base of the geotech fill") — which also left the
 * un-banded areas unidentified, so the "correlate me" texture had nothing to
 * draw over ("i don't see the hashed fallback nowhere"). One cause, three
 * symptoms.
 *
 * THE FIX, structural: the geotech partition is assembled over the FRAME's
 * column set, an un-banded column contributing an EMPTY stack. The engine
 * itself cannot carry such a column — ``sectionGeom`` drops it and re-indexes
 * the gaps, which is the very re-indexing that caused the misalignment — so
 * the frame axis is honoured OUTSIDE the engine: the frame's columns are split
 * into maximal runs of consecutive BANDED columns, each run is partitioned on
 * its own, and its regions are shifted back onto the frame's gap axis. A gap
 * that touches an un-banded column therefore receives NO packing geometry at
 * all, which is the honest answer — nothing was classified there — and the
 * litho-frame clip resolves it to bare ground the texture then marks.
 *
 * Pure geometry bookkeeping, no I/O; the caller owns the engine and memoises.
 */

import { lensApexOverrideKey, type LensApexOverride } from './sectionPartition'
import type { PartitionColumn, SectionRegion } from './sectionPartition'

/** One run of consecutive banded columns, placed on the frame's axis. */
export interface FrameGapRun {
  /** The run's columns, left→right; always at least two. */
  columns: PartitionColumn[]
  /** Their along-section metres, 1:1 with ``columns``. */
  alongM: number[]
  /**
   * Frame index of ``columns[0]``. Because gap ``i`` is flanked by columns
   * ``i`` and ``i + 1``, this is also the frame gap index of the run's gap 0.
   */
  offset: number
}

/**
 * Place a model's columns on the frame's column axis.
 *
 * Parameters
 * ----------
 * frameColumns : readonly PartitionColumn[]
 *     The frame's own columns, left→right — the axis every index refers to.
 * bandedByInvestigation : ReadonlyMap<string, PartitionColumn>
 *     The model's assembled columns, keyed by investigation id. A frame column
 *     absent from this map has no bands in the model.
 *
 * Returns
 * -------
 * PartitionColumn[]
 *     One entry per frame column, in the frame's order: the model's column
 *     where it exists, otherwise the frame column's identity and collar with an
 *     EMPTY unit stack. A model column that is NOT a frame column is dropped —
 *     the frame is the frame ("nothing may exceed it"), and for the geotech
 *     axis such a column cannot exist anyway: a packing band is derived from a
 *     litho unit, so its investigation always carries litho layers.
 */
export function frameAlignedColumns(
  frameColumns: readonly PartitionColumn[],
  bandedByInvestigation: ReadonlyMap<string, PartitionColumn>,
): PartitionColumn[] {
  return frameColumns.map(
    (frameColumn) =>
      bandedByInvestigation.get(frameColumn.investigationId) ?? {
        investigationId: frameColumn.investigationId,
        surfaceElevM: frameColumn.surfaceElevM,
        units: [],
      },
  )
}

/**
 * Split a frame-aligned column list into the runs the engine can partition.
 *
 * A run is a maximal stretch of CONSECUTIVE columns that all carry units, and
 * it is only emitted when it spans at least one gap (two columns) — a lone
 * banded column between two un-banded ones has no gap to fill.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     Frame-aligned columns (see :func:`frameAlignedColumns`).
 * alongM : readonly number[]
 *     Their along-section metres, 1:1 with ``columns``.
 *
 * Returns
 * -------
 * FrameGapRun[]
 *     The runs left→right, each carrying its frame ``offset``.
 */
export function frameGapRuns(
  columns: readonly PartitionColumn[],
  alongM: readonly number[],
): FrameGapRun[] {
  const runs: FrameGapRun[] = []
  let start = -1
  // One past the end so a run reaching the last column is closed by the same
  // branch as one interrupted by an un-banded column.
  for (let i = 0; i <= columns.length; i += 1) {
    const banded = i < columns.length && columns[i].units.length > 0
    if (banded) {
      if (start < 0) start = i
      continue
    }
    if (start >= 0 && i - start >= 2) {
      runs.push({
        columns: columns.slice(start, i),
        alongM: alongM.slice(start, i),
        offset: start,
      })
    }
    start = -1
  }
  return runs
}

/**
 * Shift a run's output back onto the frame's gap axis.
 *
 * Parameters
 * ----------
 * regions : readonly SectionRegion[]
 *     Regions the engine produced for one run, with run-local gap indices.
 * offset : number
 *     The run's frame offset. ``0`` returns the caller's own objects untouched,
 *     so a single full-width run (every column banded, and every call from the
 *     litho axis) is byte-identical to calling the engine directly.
 *
 * Returns
 * -------
 * SectionRegion[]
 *     The regions on the frame's gap axis.
 */
export function shiftRegionGaps(
  regions: readonly SectionRegion[],
  offset: number,
): SectionRegion[] {
  if (offset === 0) return regions as SectionRegion[]
  return regions.map((region) => ({ ...region, gapIndex: region.gapIndex + offset }))
}

/** The subset of a gap-indexed diagnostic the shift touches. */
export interface GapIndexed {
  gapIndex: number
}

/**
 * Shift any gap-indexed diagnostic (crossing conflicts, review flags) the same
 * way :func:`shiftRegionGaps` shifts regions.
 *
 * Parameters
 * ----------
 * items : readonly T[]
 *     Diagnostics carrying a run-local ``gapIndex``.
 * offset : number
 *     The run's frame offset; ``0`` returns the caller's own objects.
 *
 * Returns
 * -------
 * T[]
 *     The diagnostics on the frame's gap axis.
 */
export function shiftGapIndexed<T extends GapIndexed>(
  items: readonly T[],
  offset: number,
): T[] {
  if (offset === 0) return items as T[]
  return items.map((item) => ({ ...item, gapIndex: item.gapIndex + offset }))
}

/**
 * Re-key frame-axis lens apex overrides onto ONE run's local gap axis.
 *
 * Override keys are ``<bodyId>@<gapIndex>`` (``lensApexOverrideKey``), and the
 * caller builds them against the frame's gaps because that is the axis the
 * handles live on. A run only understands its own gaps, so its slice of the
 * overrides is re-keyed and everything outside the run is dropped.
 *
 * Parameters
 * ----------
 * overrides : ReadonlyMap<string, LensApexOverride>
 *     Overrides keyed on the frame's gap axis.
 * run : FrameGapRun
 *     The run to re-key for.
 *
 * Returns
 * -------
 * ReadonlyMap<string, LensApexOverride>
 *     The caller's own map when the run starts at gap 0 and covers every gap
 *     it could own; otherwise the re-keyed subset.
 */
export function rebaseApexOverrides(
  overrides: ReadonlyMap<string, LensApexOverride>,
  run: FrameGapRun,
): ReadonlyMap<string, LensApexOverride> {
  if (run.offset === 0 && overrides.size === 0) return overrides
  const gapCount = run.columns.length - 1
  const out = new Map<string, LensApexOverride>()
  for (const [key, value] of overrides) {
    // Split on the LAST '@' so a bodyId containing '@' still resolves.
    const at = key.lastIndexOf('@')
    if (at < 0) continue
    const frameGap = Number(key.slice(at + 1))
    if (!Number.isFinite(frameGap)) continue
    const localGap = frameGap - run.offset
    if (localGap < 0 || localGap >= gapCount) continue
    out.set(lensApexOverrideKey(key.slice(0, at), localGap), value)
  }
  return out
}
