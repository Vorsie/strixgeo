// Body-identity recompute payload (slice 5, "persist geometric body identity").
//
// The pure sibling of ``buildVoxelRequest``: reshape the per-section fence inputs
// into the payload POSTed to ``POST .../bodies/recompute``. It reuses the SAME
// canonical-columns + alongM + screen-free-overrides frames the voxel build uses
// (``assembleSectionPartitionFrames``) so the identity geometry can never drift from
// the built geometry — the engine CALL is what differs:
//
//   * the fill runs through ``computeSectionFillActiveWithIdentity``, whose v2 arm
//     welds same-litho regions with ``excludeFallback`` (substrate/flood paint never
//     unions two drilled bodies) and returns the weld's merge GROUPS as ORIGINAL
//     body ids;
//   * regions painted by a fallback authority (``fallback === true``) are OMITTED
//     from the payload — inferred fill is not geometry evidence;
//   * ``body_members`` maps each body id to its member LAYER ids from the SAME
//     layer snapshot that produced the regions, so the backend can pin facts to rows.
//
// The async orchestration around this (edge fetch with suspended-review drop,
// boundary fetch, refusal on failed sections) lives in
// ``shell/stages/shared/makeBodyRecomputeBuilder.ts`` — mirroring the
// makeVoxelRequestBuilder / buildVoxelRequest split.

import type { BodyBoundaryResponse } from "../api/clients/geology.types";
import type { LithoLayerLike } from "./assembleLithoSectionInputs";
import type { FenceSectionInput } from "./buildProjectFence";
import {
  assembleSectionPartitionFrames,
  toRegionInputs,
  type SectionPartitionInput,
} from "./buildVoxelRequest";
import { computeSectionFillActiveWithIdentity } from "./partitionEngineSelect";
import { log } from "./log";

/** The full payload POSTed to ``POST .../bodies/recompute``. */
export interface RecomputeBodiesRequest {
  /** One partition per fillable section (same shape the voxel build emits). */
  sections: SectionPartitionInput[];
  /**
   * Per-section merge groups, 1:1 with ``sections``: each section's connected
   * components as ORIGINAL (pre-merge) body ids, from
   * ``mergeTouchingBodiesWithGroups(..., { excludeFallback: true })``.
   */
  body_groups: string[][][];
  /** Body id -> member layer ids, from the SAME layer snapshot as the regions. */
  body_members: Record<string, string[]>;
}

/**
 * Assemble the recompute payload from pre-fetched section inputs.
 *
 * Parameters
 * ----------
 * sections : readonly FenceSectionInput[]
 *     One entry per visible section, edges already attached (and already filtered
 *     of resolver-suspended flagged ties by the caller).
 * layers : readonly LithoLayerLike[]
 *     The model's layer rows — the SAME array that fed ``sections`` — for
 *     ``body_members`` (accepted layers only; a null ``body_id`` has no identity).
 * boundariesByBodyId : ReadonlyMap<string, BodyBoundaryResponse>, optional
 *     Stored hand-drawn boundaries, so the identity partition matches the drawn one.
 * logLabel : string
 *     Log channel label (per-model: 'litho-recompute' / 'geotech-recompute').
 *
 * Returns
 * -------
 * RecomputeBodiesRequest | null
 *     The payload, or ``null`` when the assembly is EMPTY (no fillable section or
 *     zero regions) — the endpoint 422s on an empty payload, so the caller must
 *     never fire one.
 */
export function buildBodyRecomputePayload(
  sections: readonly FenceSectionInput[],
  layers: readonly LithoLayerLike[],
  boundariesByBodyId: ReadonlyMap<string, BodyBoundaryResponse> | undefined,
  logLabel: string,
): RecomputeBodiesRequest | null {
  const outSections: SectionPartitionInput[] = [];
  const bodyGroups: string[][][] = [];
  let totalRegions = 0;

  for (const frame of assembleSectionPartitionFrames(sections, boundariesByBodyId)) {
    const { input, columns, payloadColumns, alongM, apexOverrides, partitionEngineV2 } = frame;
    const { regions, groups } = computeSectionFillActiveWithIdentity(
      columns,
      input.edges,
      apexOverrides,
      alongM,
    );
    // Fallback-painted regions (substrate / flood label authority) are NOT geometry
    // evidence — the backend must never anchor identity facts on inferred fill.
    const drilled = regions.filter((r) => r.fallback !== true);
    totalRegions += drilled.length;
    log.debug(
      logLabel,
      `recompute section: ${payloadColumns.length} cols, ${drilled.length} regions ` +
        `(${regions.length - drilled.length} fallback omitted), ${groups.length} groups, ` +
        `engine=${partitionEngineV2 ? "v2" : "v1"}`,
    );
    outSections.push({
      start_x: input.section.start_x,
      start_y: input.section.start_y,
      end_x: input.section.end_x,
      end_y: input.section.end_y,
      columns: payloadColumns,
      regions: toRegionInputs(drilled),
    });
    bodyGroups.push(groups);
  }

  // The endpoint refuses an empty payload (422 empty_recompute_payload); assembling
  // one here is "nothing to recompute", never a request.
  if (outSections.length === 0 || totalRegions === 0) {
    log.debug(logLabel, "recompute payload empty — nothing to send");
    return null;
  }

  // Body membership from the SAME layer snapshot the regions were filled from:
  // accepted layers only (suggestions never fill), null body_id skipped (no identity).
  const bodyMembers: Record<string, string[]> = {};
  for (const layer of layers) {
    if (layer.status !== "accepted" || layer.body_id == null) continue;
    (bodyMembers[layer.body_id] ??= []).push(layer.id);
  }

  return { sections: outSections, body_groups: bodyGroups, body_members: bodyMembers };
}
