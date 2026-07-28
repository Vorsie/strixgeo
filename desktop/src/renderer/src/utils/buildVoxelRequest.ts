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
import { computeSectionFillActive } from "./partitionEngineSelect";
import { assembleSectionsWithCanonical } from "./sectionFenceData";

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
  /**
   * Cubic / fallback voxel grid spacing in metres. Kept set for backwards
   * compatibility (a legacy payload carrying only this still builds a cubic
   * grid) and as the per-axis fallback when an explicit axis spacing is absent.
   */
  grid_spacing_m: number;
  /**
   * X/Y (map-plane) voxel spacing in metres. When present, takes precedence over
   * ``grid_spacing_m`` for the horizontal axes. Always emitted by
   * ``buildVoxelRequest`` so the backend's effective-spacing resolver gets an
   * explicit value.
   */
  horizontal_spacing_m?: number;
  /**
   * Z (elevation) voxel spacing in metres. When present, takes precedence over
   * ``grid_spacing_m`` for the vertical axis. A fine Z over a coarse X/Y catches
   * thin layers without exploding the map-plane voxel count. The backend
   * collapses ``vertical === horizontal`` to a cubic grid internally.
   */
  vertical_spacing_m?: number;
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
 * horizontalM : number
 *     X/Y (map-plane) voxel spacing in metres. Emitted as both
 *     ``grid_spacing_m`` (cubic fallback / back-compat) and the explicit
 *     ``horizontal_spacing_m``.
 * verticalM : number
 *     Z (elevation) voxel spacing in metres. Emitted as ``vertical_spacing_m``.
 *     A finer value than ``horizontalM`` catches thin layers at the cost of more
 *     voxels; the backend collapses ``verticalM === horizontalM`` to a cubic grid.
 *
 * Returns
 * -------
 * VoxelBuildRequest
 *     ``{ sections, grid_spacing_m, horizontal_spacing_m, vertical_spacing_m }``
 *     ready to POST to the backend voxel builder. Empty input yields a payload
 *     with ``sections: []`` and the same three spacing fields.
 */
export function buildVoxelRequest(
  sections: readonly FenceSectionInput[],
  horizontalM: number,
  verticalM: number,
): VoxelBuildRequest {
  // Pass 1 (shared with buildProjectFence so crossings agree): assemble every
  // section + compute the canonical per-test world positions.
  const { assembled, canonical } = assembleSectionsWithCanonical(sections);

  // Pass 2: reshape each section's columns + regions into the payload, stamping
  // each column's canonical world position.
  const out: SectionPartitionInput[] = [];
  for (const { input, columns, orderedColumns } of assembled) {
    const payloadColumns: SectionColumnInput[] = orderedColumns.map((c) => {
      const w = canonical.get(c.investigationId);
      // Unreachable invariant guard: every column of an assembled (>=2-column)
      // section contributes a canonical entry, so a miss is impossible by
      // construction. Fail loud naming the offending investigation rather than
      // emitting Number.NaN — the payload's world_x/world_y are required numbers
      // and JSON.stringify(NaN) === "null", so a NaN would surface as a baffling
      // null at the Python backend, far from the real cause.
      if (!w) {
        throw new Error(
          `buildVoxelRequest: no canonical world position for investigation ` +
            `'${c.investigationId}' (expected one per assembled-section column)`,
        );
      }
      return {
        investigation_id: c.investigationId,
        along_m: c.alongM,
        world_x: w.x,
        world_y: w.y,
      };
    });

    // True along-section position (metres) per column, 1:1 with `columns`:
    // assembleSectionPartitionInput pushes to `columns` and `orderedColumns` in
    // lockstep, so they share order + length by construction. Passing alongM lets
    // the deep-to-deep substrate pass slice each gap's deep band at the real column
    // spacing, so the 3D voxel model inherits the same substrate geometry the 2D
    // overlay renders. (3rd arg = lensApexOverrides, unused here → undefined.)
    const alongM = orderedColumns.map((c) => c.alongM);
    const regions: RegionInput[] = computeSectionFillActive(
      columns,
      input.edges,
      undefined,
      alongM,
    ).map(
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

  // grid_spacing_m is kept set to the horizontal spacing for back-compat / the
  // cubic fallback; the explicit anisotropic fields let the backend's
  // effective-spacing resolver pick the right per-axis values.
  return {
    sections: out,
    grid_spacing_m: horizontalM,
    horizontal_spacing_m: horizontalM,
    vertical_spacing_m: verticalM,
  };
}
