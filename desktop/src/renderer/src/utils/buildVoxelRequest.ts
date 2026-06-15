// Build-request contract for the voxel litho builder (TS mirror of
// `src/groundmodel/domain/services/voxel_litho/voxel_types.py`).
//
// These interfaces describe the JSON payload the frontend POSTs to the
// backend voxel builder: the validated 2-D section partition from
// `computeSectionFill` (SectionRegion[]) reshaped into per-section
// partitions. Field names are snake_case to match the Python value
// objects so the payload round-trips the API unchanged.
//
// The `buildVoxelRequest()` function that assembles this payload from the
// section partitions + project fence arrives in Task 2 — this file is the
// type stub it will be defined in.

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
