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
//     unions two drilled bodies) and returns the weld's merge GROUPS in LAYER-id
//     space — layer ids never change, so the same geometry always plans the same
//     facts server-side. The first wire design sent BODY ids and oscillated in
//     production: after a successful merge every refetched region carried the merged
//     id, the next payload's evidence collapsed to singletons, and the wholesale
//     fact replace undid the merge (facts flapping 74→3→69 live, 2026-08-12);
//   * regions painted by a fallback authority (``fallback === true``) are OMITTED
//     from the payload — inferred fill is not geometry evidence;
//   * every region carries ``layer_ids`` (its producing layers) so the backend's
//     cross-section rule (shared columns + fence crossings) runs label-free.
//
// The async orchestration around this (edge fetch with suspended-review drop,
// boundary fetch, refusal on failed sections) lives in
// ``shell/stages/shared/makeBodyRecomputeBuilder.ts`` — mirroring the
// makeVoxelRequestBuilder / buildVoxelRequest split.

import type { BodyBoundaryResponse } from "../api/clients/geology.types";
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
  /**
   * One partition per fillable section (same shape the voxel build emits);
   * regions carry ``layer_ids``, fallback regions are omitted.
   */
  sections: SectionPartitionInput[];
  /**
   * Per-section merge groups, 1:1 with ``sections``: each group lists the LAYER
   * ids whose fill regions form one touching component on that section, from
   * ``mergeTouchingBodiesWithGroups(..., { excludeFallback: true })``. Layer ids
   * are the ONLY wire currency — body ids are the labels the recompute itself
   * rewrites, and body-labelled evidence oscillated in production.
   */
  layer_groups: string[][][];
}

/**
 * Assemble the recompute payload from pre-fetched section inputs.
 *
 * Parameters
 * ----------
 * sections : readonly FenceSectionInput[]
 *     One entry per visible section, edges already attached (and already filtered
 *     of resolver-suspended flagged ties by the caller).
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
  boundariesByBodyId: ReadonlyMap<string, BodyBoundaryResponse> | undefined,
  logLabel: string,
): RecomputeBodiesRequest | null {
  const outSections: SectionPartitionInput[] = [];
  const layerGroups: string[][][] = [];
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
    layerGroups.push(groups);
  }

  // The endpoint refuses an empty payload (422 empty_recompute_payload); assembling
  // one here is "nothing to recompute", never a request.
  if (outSections.length === 0 || totalRegions === 0) {
    log.debug(logLabel, "recompute payload empty — nothing to send");
    return null;
  }

  return { sections: outSections, layer_groups: layerGroups };
}
