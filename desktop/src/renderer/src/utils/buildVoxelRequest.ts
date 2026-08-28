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
import { countSpanningRegions } from "./countSpanningRegions";
import { assembleGaplessClauses2d } from "./gaplessGate";
import type { SectionClause2dInput } from "./gaplessGate/clauses2d";
import type { GaplessClauseInput } from "./gaplessGate/types";
import { log } from "./log";
import type {
  CorrelationEdge,
  LensApexOverride,
  PartitionColumn,
  SectionRegion,
} from "./partitionFill";
import { frameAlignedColumns } from "./frameAlignedPartition";
import {
  computeHierarchicalGeotechFill,
  type HierarchicalGeotechFillResult,
} from "./geotechHierarchicalFill";
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
  /**
   * How the 2-D engine terminated this region — the 2/1/0 gesture semantics.
   * `quad` = tied across both columns, `pinch` = present on one column only,
   * `lens` = enclosed minority overlaying its matrix.
   *
   * Sending it is the point of debt #256: without it the builder cannot tell a
   * band from an onlap from a lens, so `_stack_at` pinches all three alike with
   * `max(0, 2w - 1)` and kills them at the equidistance midline.
   */
  kind?: 'quad' | 'pinch' | 'lens';
  /** Carve tier of an overlay region; absent on a main region. */
  overlay_tier?: 'onlap' | 'lens';
  /**
   * Base elevation (mTAW) fixed by an EXPLICIT user correlation. Owner directive
   * 2026-07-08: a user correlation is absolute, so the shallow-TD cap must not
   * chop it flat — which the builder can only honour if it is told the elevation.
   */
  tied_band_base?: number;
  /**
   * Region deliberately kept only ABOVE a sloping cross-lithology tie, so it must
   * never be merged back across that tie.
   */
  tie_clipped?: boolean;
  /**
   * The ``litho_layer`` ids whose drilled units produced this region (v2 label
   * paths; deduped; omitted when empty). The body recompute's cross-section rule
   * runs server-side over these — label-independent evidence that survives the
   * recompute's own body relabels. The voxel build ignores the field (additive on
   * ``RegionInputSchema``).
   */
  layer_ids?: string[];
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
  /**
   * The renderer's half (clauses 1-4) of the seven-clause gapless gate — see
   * ``gaplessGate/types.ts``. Diagnostic freight only: never read by
   * ``_partition_checksum`` (section geometry + spacings + investigation
   * columns only) and never changes the payload's meaning, so it cannot bust
   * a cached build. Always emitted by ``buildVoxelRequest`` — even a litho
   * build reports all four clauses ``not-evaluated`` rather than omitting the
   * field, so "not measured" is never indistinguishable from "not asked".
   */
  gapless_2d?: GaplessClauseInput[];
}

/**
 * Derive one section's hand-drawn apex / contact overrides, screen-free.
 *
 * Stored boundary nodes carry ``along_m`` + ``elevation_m``; the overlay's
 * ``alongToScreenX`` exists only to turn an along position into a gap-local
 * fraction, and ``screenToLevel`` is read only during a LIVE drag. So the
 * identity transform plus gap extents in ALONG METRES reproduce the overlay's
 * fractions exactly, with both drag states null.
 *
 * Exported because the build payload is not its only consumer: the geotech
 * render-vs-build agreement gate must derive the build arm's overrides the way
 * the real builder does or it measures a partition nobody posts. A second
 * hand-copy of this block is precisely the drift that gate exists to detect, so
 * there must only ever be one.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's assembled columns, left to right.
 * edges : readonly CorrelationEdge[]
 *     The section's approved correlation edges.
 * alongM : readonly number[]
 *     Along-section position (metres) per column, 1:1 with ``columns``.
 * boundariesByBodyId : ReadonlyMap<string, BodyBoundaryResponse>, optional
 *     Every body's stored hand-drawn boundary. Omitted / empty means nothing was
 *     drawn, which skips the extra no-override base engine pass entirely.
 * partitionEngineV2 : boolean
 *     Whether the ACTIVE engine consumes contact overrides (v2 does).
 *
 * Returns
 * -------
 * Map<string, LensApexOverride>
 *     Apex overrides keyed as ``buildApexOverridesForGaps`` keys them; empty
 *     when nothing is drawn.
 */
export function deriveSectionApexOverrides(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[],
  boundariesByBodyId: ReadonlyMap<string, BodyBoundaryResponse> | undefined,
  partitionEngineV2: boolean,
): Map<string, LensApexOverride> {
  const gapXs: GapExtent[] = alongM
    .slice(0, -1)
    .map((leftX, i) => ({ leftX, rightX: alongM[i + 1] }));
  const alongIdentity = (along: number): number => along;
  // Mirrors the overlay: a no-override BASE pass first, so a stored node that
  // shapes a two-sided body's lens tip routes through the lens path rather than
  // the un-routable contact path (§91). Skipped when nothing is drawn, so the
  // common case costs no extra engine pass.
  const persistedLensBodies =
    boundariesByBodyId && boundariesByBodyId.size > 0
      ? detectPersistedLensBodies(
          computeSectionFillActive(columns, edges, undefined, alongM),
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
  return apexOverrides;
}

/**
 * One section's fully-derived partition FRAME: everything a payload builder needs to run
 * the partition engine, minus the engine call itself. Extracted (2026-08-12) because the
 * body-identity recompute payload (``buildBodyRecomputePayload``) is the second consumer
 * of the exact canonical-columns + alongM + screen-free-overrides prefix ``buildVoxelRequest``
 * assembled inline — the engine CALL is what differs (plain fill vs identity fill).
 */
export interface SectionPartitionFrame {
  /** The section's raw fence input (line + layers + this section's edges). */
  input: FenceSectionInput;
  /** Assembled partition columns, left→right (engine input). */
  columns: PartitionColumn[];
  /** Payload columns with canonical world positions, 1:1 with ``columns``. */
  payloadColumns: SectionColumnInput[];
  /** True along-section metres per column, 1:1 with ``columns``. */
  alongM: number[];
  /** Screen-free hand-drawn apex/contact overrides for this section. */
  apexOverrides: Map<string, LensApexOverride>;
  /** Which engine the overrides were derived for (v2 consumes contact overrides). */
  partitionEngineV2: boolean;
}

/**
 * Assemble one partition frame per fillable section (columns.length >= 2).
 *
 * Pass 1 is shared with ``buildProjectFence`` so crossings agree: every section is
 * assembled together and the canonical per-test world positions reconciled. Pass 2
 * stamps each column's canonical position and derives the section's screen-free
 * hand-drawn overrides (owner directive 2026-07-30 — the build and the render MUST
 * consume the same overrides; see ``deriveSectionApexOverrides``).
 *
 * Parameters
 * ----------
 * sections : readonly FenceSectionInput[]
 *     One entry per section (order irrelevant — sections are independent).
 * boundariesByBodyId : ReadonlyMap<string, BodyBoundaryResponse>, optional
 *     Every body's stored hand-drawn boundary; omit only when nothing is drawn.
 *
 * Returns
 * -------
 * SectionPartitionFrame[]
 *     One frame per assembled section, ready for an engine call + payload reshape.
 *
 * Raises
 * ------
 * Error
 *     When an assembled column has no canonical world position (unreachable by
 *     construction; failing loud beats emitting NaN → JSON null at the backend).
 */
export function assembleSectionPartitionFrames(
  sections: readonly FenceSectionInput[],
  boundariesByBodyId?: ReadonlyMap<string, BodyBoundaryResponse>,
): SectionPartitionFrame[] {
  const { assembled, canonical } = assembleSectionsWithCanonical(sections);

  const frames: SectionPartitionFrame[] = [];
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
    // The derivation is SCREEN-FREE — see ``deriveSectionApexOverrides``, which
    // owns it so the agreement gate can measure the SAME derivation instead of a
    // hand-copy that drifts.
    const partitionEngineV2 = isPartitionEngineV2Active();
    const apexOverrides = deriveSectionApexOverrides(
      columns,
      input.edges,
      alongM,
      boundariesByBodyId,
      partitionEngineV2,
    );

    frames.push({ input, columns, payloadColumns, alongM, apexOverrides, partitionEngineV2 });
  }
  return frames;
}

/**
 * Map engine regions to the wire ``RegionInput`` shape.
 *
 * Carries the engine's CLASSIFICATION, not just its geometry (debt #256). The
 * builder used to receive four fields and re-derive the rest from the polygons,
 * which it cannot do: a band, an onlap and an enclosed lens are three different
 * terminations with identical outlines. Optional fields are omitted rather than
 * sent as null so the payload stays the same shape when the engine sets nothing.
 *
 * Parameters
 * ----------
 * engineRegions : readonly SectionRegion[]
 *     The engine's per-gap regions.
 *
 * Returns
 * -------
 * RegionInput[]
 *     The wire regions, 1:1 with the input.
 */
export function toRegionInputs(engineRegions: readonly SectionRegion[]): RegionInput[] {
  return engineRegions.map((r) => ({
    formation_id: r.formationId,
    body_id: r.bodyId,
    polygon: r.polygon.map((p) => [p.fraction, p.elevation] as [number, number]),
    gap_index: r.gapIndex,
    kind: r.kind,
    ...(r.overlayTier !== undefined ? { overlay_tier: r.overlayTier } : {}),
    ...(r.tiedBandBase !== undefined ? { tied_band_base: r.tiedBandBase } : {}),
    ...(r.tieClipped !== undefined ? { tie_clipped: r.tieClipped } : {}),
    ...(r.layerIds !== undefined && r.layerIds.length > 0 ? { layer_ids: [...r.layerIds] } : {}),
  }));
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
 * packingClassOf : ReadonlyMap<string, string>, optional
 *     Geotech formation id → canonical class key (``buildPackingClassOf``), for
 *     a framed GEOTECH build — the same mass identity the geotech axis renders
 *     with. Ignored on litho builds.
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
  frameSections?: readonly FenceSectionInput[],
  packingClassOf?: ReadonlyMap<string, string>,
  sectionNames?: ReadonlyMap<string, string>,
): VoxelBuildRequest {
  const out: SectionPartitionInput[] = [];
  // THE GAPLESS GATE'S 2-D HALF (clauses 1-4) — collected per section as the
  // main loop below runs, then assembled once at the end. `builtSectionKeys`
  // is the join key `sectionClosure` compares the litho frame against: it
  // must be the SAME key `frameBySectionId` is keyed by (`sectionKey`, not
  // the raw `sectionId`, since a caller is not required to supply one).
  const section2dInputs: SectionClause2dInput[] = [];
  const builtSectionKeys = new Set<string>();
  // THE LITHO FRAME, for a GEOTECH build (owner ruling 2026-08-18, "densities
  // on top of lithos"). With it, this builder runs the SAME hierarchical fill
  // the geotech axis renders — one path, so the built model is the drawn model.
  // Without it (every litho build) nothing changes: the whole-section run below
  // is the litho stage's own partition.
  // Keyed on the section id when the caller supplies one, else on the line's
  // own endpoints — the same section always projects the same line, and the two
  // models' inputs are assembled from the SAME cross-section rows.
  const sectionKey = (input: FenceSectionInput): string =>
    input.sectionId ??
    `${input.section.start_x},${input.section.start_y},${input.section.end_x},${input.section.end_y}`;
  const frameBySectionId = new Map<string, SectionPartitionFrame>();
  if (frameSections !== undefined) {
    for (const frame of assembleSectionPartitionFrames(frameSections, undefined)) {
      frameBySectionId.set(sectionKey(frame.input), frame);
    }
  }
  for (const frame of assembleSectionPartitionFrames(sections, boundariesByBodyId)) {
    const { input, columns, alongM, apexOverrides, partitionEngineV2 } = frame;
    let { payloadColumns } = frame;

    const lithoFrame = frameBySectionId.get(sectionKey(input));
    let engineRegions: SectionRegion[];
    // Gate inputs for THIS section: undefined `hierarchical` is the signal
    // clauses 1-3 read as "not-evaluated" (see `gaplessGate/clauses2d.ts`).
    let hierarchicalForGate: HierarchicalGeotechFillResult | undefined;
    let lithoRegionsForGate: readonly SectionRegion[] = [];
    let alongMForGate: readonly number[] = alongM;
    // The column list a gate finding's gap index is valid against — always the
    // SAME list `alongMForGate` came off, so the two cannot drift. It is what
    // lets clause 1-3 name a gap by its two columns instead of by an index no
    // other surface can resolve (see `gaplessGate/clauses2d.ts`).
    let gateColumnInvestigationIds: readonly string[] = columns.map((c) => c.investigationId);
    if (lithoFrame !== undefined) {
      // The frame owns the axis: its columns carry the tests the packing model
      // has not divided yet, and the regions below are indexed on ITS gaps, so
      // the payload must name its columns too.
      payloadColumns = lithoFrame.payloadColumns;
      const lithoRegions = computeSectionFillActive(
        lithoFrame.columns,
        lithoFrame.input.edges,
        lithoFrame.apexOverrides,
        lithoFrame.alongM,
      );
      const hierarchical = computeHierarchicalGeotechFill({
        lithoColumns: lithoFrame.columns,
        lithoEdges: lithoFrame.input.edges,
        lithoRegions,
        geotechColumns: frameAlignedColumns(
          lithoFrame.columns,
          new Map(columns.map((c) => [c.investigationId, c])),
        ),
        geotechEdges: input.edges,
        alongM: lithoFrame.alongM,
        // Same class identity as the render — one mass one body (2026-08-21).
        packingClassOf,
      });
      engineRegions = hierarchical.regions;
      hierarchicalForGate = hierarchical;
      lithoRegionsForGate = lithoRegions;
      alongMForGate = lithoFrame.alongM;
      gateColumnInvestigationIds = lithoFrame.columns.map((c) => c.investigationId);
      log.info(
        "litho-voxel",
        `hierarchical payload section: ${hierarchical.diagnostics.families} litho families, ` +
          `${hierarchical.diagnostics.bands} bands → ${engineRegions.length} classed faces, ` +
          `${hierarchical.lithoFallback.length} un-classed`,
      );
    } else {
      engineRegions = computeSectionFillActive(columns, input.edges, apexOverrides, alongM);
    }
    const regions = toRegionInputs(engineRegions);

    const sectionKeyValue = sectionKey(input);
    const sectionIdForGate = input.sectionId ?? sectionKeyValue;
    builtSectionKeys.add(sectionKeyValue);
    section2dInputs.push({
      sectionId: sectionIdForGate,
      sectionName: sectionNames?.get(sectionIdForGate) ?? sectionIdForGate,
      hierarchical: hierarchicalForGate,
      lithoRegions: lithoRegionsForGate,
      alongM: alongMForGate,
      columnInvestigationIds: gateColumnInvestigationIds,
    });

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
    log.info(
      "litho-voxel",
      `payload section: ${payloadColumns.length} cols, ${regions.length} regions ` +
        `(${countSpanningRegions(engineRegions)} span their gap), ${input.edges.length} edges over ` +
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

  // CLAUSE 4's whole-build input: every litho-frame section, named, against
  // the set this build actually produced output for. `hasFrame` is whether a
  // frame was supplied AT ALL, independent of whether it happens to be empty
  // — a litho-only build (no frame) must read "not-evaluated", never a
  // vacuous "pass" that a frame naming zero sections would otherwise produce.
  //
  // NOT ATTEMPTED: attributing a missing section to a CONSENTED investigation
  // exclusion (`excludedInvestigationIds` in `makeVoxelRequestBuilder.ts`).
  // That exclusion is applied identically to both `sections` and
  // `frameSections` by the caller BEFORE either reaches this function, so a
  // section missing here already reflects the SAME exclusion on both sides —
  // this scope cannot tell "dropped because of consent" from "dropped for any
  // other reason" any better than guessing would, and the gate exists to
  // refuse guessing (see `gaplessGate/sectionClosure.ts`'s own doc).
  const frameSectionRefs = [...frameBySectionId.entries()].map(([key, frame]) => {
    const id = frame.input.sectionId ?? key;
    return { sectionId: id, sectionName: sectionNames?.get(id) ?? id };
  });
  const gapless2d = assembleGaplessClauses2d(section2dInputs, {
    hasFrame: frameSections !== undefined,
    frameSections: frameSectionRefs,
    builtSectionIds: builtSectionKeys,
  });

  // grid_spacing_m is kept set to the horizontal spacing for back-compat / the
  // cubic fallback; the explicit anisotropic fields let the backend's
  // effective-spacing resolver pick the right per-axis values.
  return {
    sections: out,
    grid_spacing_m: horizontalM,
    horizontal_spacing_m: horizontalM,
    vertical_spacing_m: verticalM,
    gapless_2d: gapless2d,
  };
}
