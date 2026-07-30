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

import type { BodyBoundaryResponse } from "../api/clients/geology.types";
// LAYERING EXCEPTION, deliberate: this reaches up into components/sections for the
// override derivation instead of reimplementing it. A second implementation is
// exactly the divergence being fixed here — the render and the build MUST derive
// overrides from one place or they will drift apart again. If the layering matters
// later, move ``apexOverrideWiring`` down into utils/; do not copy it.
import {
  buildApexOverridesForGaps,
  detectPersistedLensBodies,
  type GapExtent,
} from "../components/sections/apexOverrideWiring";
import type { FenceSectionInput } from "./buildProjectFence";
import { log } from "./log";
import {
  computeSectionFillActive,
  isPartitionEngineV2Active,
} from "./partitionEngineSelect";
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
 * runs ``computeSectionFill`` with that section's approved edges AND the same
 * hand-drawn apex/contact overrides the overlay renders with, and reshapes the
 * result into a ``SectionPartitionInput``. The partition itself is never altered —
 * the backend voxel labeller sees exactly the regions the user sees on screen.
 *
 * That last sentence was FALSE until 2026-07-30: the overrides were not passed, so
 * anything the user had reshaped by hand was drawn one way and built another. Pass
 * ``boundariesByBodyId`` to keep the two in step; omitting it reproduces the old
 * no-override partition and is only correct for a model with nothing drawn.
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
 * boundariesByBodyId : ReadonlyMap<string, BodyBoundaryResponse>, optional
 *     Every body's stored hand-drawn boundary (the same map the section overlay
 *     renders from). Used to derive the apex/contact overrides so the built model
 *     matches the drawn partition. Omit only when nothing is drawn.
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
  boundariesByBodyId?: ReadonlyMap<string, BodyBoundaryResponse>,
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
    // overlay renders.
    const alongM = orderedColumns.map((c) => c.alongM);

    // HAND-DRAWN SHAPES REACH THE BUILD (owner directive 2026-07-30).
    //
    // This used to pass ``undefined`` for the engine's third argument while
    // ``PartitionFillOverlay`` passed the real apex overrides, so the model was
    // BUILT from a different partition than the one drawn — the file's own claim
    // that "the backend voxel labeller sees exactly the regions the user sees" was
    // false for every body whose contact the user had reshaped. Measured on the dev
    // model: the basal clay banded across all 23 gaps of Cross-section 1 without
    // overrides, while the posted payload wedged it at four of them (fraction 0.544
    // at `1411-GEO-23/126-B3 .. GEO-23/125-S9`), which is what the owner saw as
    // "the bottom clay is not made 3D" while Fill bands looked correct.
    //
    // The derivation is SCREEN-FREE here. Stored nodes carry ``along_m`` and
    // ``elevation_m``; the overlay's ``alongToScreenX`` exists only to turn along
    // into a gap-local fraction, and ``screenToLevel`` is read only for a LIVE
    // drag. So the identity transform plus gap extents in ALONG metres reproduce
    // the overlay's fractions exactly, with both drag states null.
    const gapXs: GapExtent[] = orderedColumns
      .slice(0, -1)
      .map((c, i) => ({ leftX: c.alongM, rightX: orderedColumns[i + 1].alongM }));
    const alongIdentity = (along: number): number => along;
    const partitionEngineV2 = isPartitionEngineV2Active();
    // Mirrors the overlay: a no-override BASE pass first, so a stored node that
    // shapes a two-sided body's lens tip routes through the lens path rather than
    // the un-routable contact path (§91). Skipped when nothing is drawn, so the
    // common case costs no extra engine pass.
    const persistedLensBodies =
      boundariesByBodyId && boundariesByBodyId.size > 0
        ? detectPersistedLensBodies(
            computeSectionFillActive(columns, input.edges, undefined, alongM),
            columns,
            boundariesByBodyId,
            alongIdentity,
            gapXs,
          )
        : undefined;
    const { apexOverrides } = buildApexOverridesForGaps({
      orderedColumns: columns,
      gapXs,
      boundariesByBodyId,
      alongToScreenX: alongIdentity,
      screenToLevel: undefined,
      lensDrag: null,
      boundaryDrag: null,
      partitionEngineV2,
      persistedLensBodies,
    });

    const regions: RegionInput[] = computeSectionFillActive(
      columns,
      input.edges,
      apexOverrides,
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

    // What the ENGINE ACTUALLY RETURNED for this section, so a payload that does
    // not match a bench run of the same engine on the same inputs is visible
    // without guessing. Added 2026-07-30 after a correlated basal clay was absent
    // from the built model: the payload had 193 regions for a 24-column section
    // while the same engine, on columns / units / edges / alongM verified
    // byte-equal, returned 210 with the body banded across the four gaps the
    // payload left empty. Everything on the input side matched, so the difference
    // has to be visible from inside the app.
    const tiedLayerIds = new Set<string>();
    for (const e of input.edges) {
      tiedLayerIds.add(e.a);
      tiedLayerIds.add(e.b);
    }
    const spanning = regions.filter((r) => {
      const fr = r.polygon.map((p) => p[0]);
      return Math.min(...fr) < 0.01 && Math.max(...fr) > 0.99;
    }).length;
    log.info(
      "litho-voxel",
      `payload section: ${payloadColumns.length} cols, ${regions.length} regions ` +
        `(${spanning} span their gap), ${input.edges.length} edges over ` +
        `${tiedLayerIds.size} tied layers, engine=${partitionEngineV2 ? "v2" : "v1"}, ` +
        `overrides=${apexOverrides.size}`,
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
