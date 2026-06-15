// Build-request contract for the voxel litho builder (TS mirror of
// `src/groundmodel/domain/services/voxel_litho/voxel_types.py`).
//
// These interfaces describe the JSON payload the frontend POSTs to the
// backend voxel builder: the validated 2-D section partition from
// `computeSectionFill` (SectionRegion[]) reshaped into per-section
// partitions. Field names are snake_case to match the Python value
// objects so the payload round-trips the API unchanged.
//
// The `buildVoxelRequest()` function (below) assembles this payload from the
// per-section fence inputs, reusing the exact same partition + canonical-world-
// position passes as `buildProjectFence` so the voxel labelling sees the same
// validated 2-D partition the user sees on screen.

import type { FenceSectionInput } from "./buildProjectFence";
import { computeSectionFill } from "./partitionFill";
import {
  assembleSectionPartitionInput,
  computeCanonicalColumnWorldPositions,
  type AssembledSection,
} from "./sectionFenceData";
import type { FenceColumn } from "./fencePanels";
import type { PartitionColumn } from "./partitionFill";

/** One filled region of a 2-D section partition (mirrors `SectionRegion`). */
export interface RegionInput {
  /** The lithostratigraphic formation this region belongs to. */
  formation_id: string;
  /** Resolver-assigned body identity, or null when not part of a body. */
  body_id: string | null;
  /**
   * Region outline as `[fraction, elevation_m]` points: `fraction` is the
   * gap-local horizontal position in [0, 1] (0 = left column, 1 = right
   * column); `elevation_m` is the absolute elevation (mTAW).
   */
  polygon: [number, number][];
  /**
   * Zero-based index of the gap's LEFT column within the section's column
   * list (matches `SectionRegion.gapIndex`).
   */
  gap_index: number;
}

/** One investigation column of a section, with its canonical world position. */
export interface SectionColumnInput {
  /** Identifier of the CPT / borehole this column represents. */
  investigation_id: string;
  /** Distance along the section line in metres, from the start point. */
  along_m: number;
  /** Easting of the column in metres (project CRS, e.g. Lambert-72). */
  world_x: number;
  /** Northing of the column in metres (project CRS). */
  world_y: number;
}

/** One section's full 2-D partition: its line, columns, and filled regions. */
export interface SectionPartitionInput {
  /** Easting of the section line's start point in metres (project CRS). */
  start_x: number;
  /** Northing of the section line's start point in metres (project CRS). */
  start_y: number;
  /** Easting of the section line's end point in metres (project CRS). */
  end_x: number;
  /** Northing of the section line's end point in metres (project CRS). */
  end_y: number;
  /** On-section investigation columns, ordered along the line. */
  columns: SectionColumnInput[];
  /** Filled partition regions; each references the column pair it fills. */
  regions: RegionInput[];
}

/** The full payload POSTed to the backend voxel builder. */
export interface VoxelBuildRequest {
  /** One partition per section in the litho model. */
  sections: SectionPartitionInput[];
  /** Voxel grid spacing in metres. */
  grid_spacing_m: number;
}

/**
 * Assemble the voxel-builder payload from the project's per-section fence inputs.
 *
 * This is the partition-payload sibling of ``buildProjectFence``: for each
 * section it assembles the partition columns (accepted layers + ordered
 * columns), reuses the SAME canonical-world-position reconciliation so a tie
 * column and a cross-section column for the same test agree at the crossing,
 * runs ``computeSectionFill`` with that section's approved edges, and reshapes
 * the result into a ``SectionPartitionInput``. The partition itself is never
 * altered — the backend voxel labeller sees exactly the regions the user sees
 * on screen.
 *
 * Sections whose assembled ``columns.length < 2`` (no fillable gap) are skipped,
 * matching ``buildProjectFence``.
 *
 * Parameters
 * ----------
 * sections : readonly FenceSectionInput[]
 *     One entry per section in the litho model (order is irrelevant — each
 *     section is independent).
 * gridSpacingM : number
 *     Voxel grid spacing in metres, passed through to the request unchanged.
 *
 * Returns
 * -------
 * VoxelBuildRequest
 *     ``{ sections, grid_spacing_m }`` ready to POST to the backend voxel
 *     builder. Empty input yields ``{ sections: [], grid_spacing_m }``.
 */
export function buildVoxelRequest(
  sections: readonly FenceSectionInput[],
  gridSpacingM: number,
): VoxelBuildRequest {
  // Pass 1: assemble every section, keeping only those with a fillable gap
  // (>=2 columns), then compute the canonical per-test world positions across
  // all of them (shared with buildProjectFence so crossings agree).
  const assembled: {
    input: FenceSectionInput;
    columns: PartitionColumn[];
    orderedColumns: FenceColumn[];
  }[] = [];
  for (const input of sections) {
    const { columns, orderedColumns } = assembleSectionPartitionInput(
      input.projectedColumns,
      input.layers,
    );
    if (columns.length < 2) continue;
    assembled.push({ input, columns, orderedColumns });
  }
  const canonical = computeCanonicalColumnWorldPositions(
    assembled.map<AssembledSection>(({ input, columns, orderedColumns }) => ({
      section: input.section,
      columns,
      orderedColumns,
    })),
  );

  // Pass 2: reshape each section's columns + regions into the payload, stamping
  // each column's canonical world position.
  const out: SectionPartitionInput[] = [];
  for (const { input, columns, orderedColumns } of assembled) {
    const payloadColumns: SectionColumnInput[] = orderedColumns.map((c) => {
      const w = canonical.get(c.investigationId);
      return {
        investigation_id: c.investigationId,
        along_m: c.alongM,
        // Fall back to the section's own projection only if (defensively) the
        // canonical map has no entry — every column with >=2 section columns
        // contributes one, so the fallback should not trigger in practice.
        world_x: w ? w.x : Number.NaN,
        world_y: w ? w.y : Number.NaN,
      };
    });

    const regions: RegionInput[] = computeSectionFill(columns, input.edges).map(
      (r) => ({
        formation_id: r.formationId,
        body_id: r.bodyId,
        polygon: r.polygon.map(
          (p) => [p.fraction, p.elevation] as [number, number],
        ),
        gap_index: r.gapIndex,
      }),
    );

    out.push({
      start_x: input.section.start_x,
      start_y: input.section.start_y,
      end_x: input.section.end_x,
      end_y: input.section.end_y,
      columns: payloadColumns,
      regions,
    });
  }

  return { sections: out, grid_spacing_m: gridSpacingM };
}
