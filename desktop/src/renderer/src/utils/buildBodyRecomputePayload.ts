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
import { mergeTouchingBodiesWithGroups } from "./partitionFillV2/mergeTouchingBodies";
import { log } from "./log";

/** The full payload POSTed to ``POST .../bodies/recompute``. */
export interface RecomputeBodiesRequest {
  /**
   * One partition per fillable section (same shape the voxel build emits);
   * regions carry ``layer_ids``, fallback regions are omitted.
   */
  sections: SectionPartitionInput[];
  /**
   * One cross-section id per entry in ``sections``, same order. The replace
   * is model-wide, so the server refuses any payload whose id set does not
   * equal the project's sections (audit P1-3) — a partial post must never
   * erase the omitted sections' evidence.
   */
  section_ids: string[];
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
  packingClassOf?: ReadonlyMap<string, string>,
): RecomputeBodiesRequest | null {
  const outSections: SectionPartitionInput[] = [];
  const sectionIds: string[] = [];
  const layerGroups: string[][][] = [];
  let totalRegions = 0;

  for (const frame of assembleSectionPartitionFrames(sections, boundariesByBodyId)) {
    const { input, columns, payloadColumns, alongM, apexOverrides } = frame;
    const { regions, groups: rowGroups } = computeSectionFillActiveWithIdentity(
      columns,
      input.edges,
      apexOverrides,
      alongM,
    );
    // GEOTECH: identity is the CLASS, never the formation row (owner
    // 2026-08-21, "one mass one body" + option 3 — a touching same-class lens
    // welds without a tie). The identity engine grouped per row; re-derive the
    // groups with the class key so the evidence states what the ruling states.
    // The regions posted below stay the identity engine's own — only the
    // GROUPS change. Litho passes no map and keeps row groups.
    const groups = packingClassOf
      ? mergeTouchingBodiesWithGroups(
          regions,
          // Only the along positions matter here (the per-gap snap tolerance).
          alongM.map((x) => ({ x })),
          {
            excludeFallback: true,
            identityKeyOf: (formationId) => packingClassOf.get(formationId) ?? formationId,
          },
        ).groups
      : rowGroups;
    // Fallback-painted regions (substrate / flood label authority) are NOT geometry
    // evidence — the backend must never anchor identity facts on inferred fill.
    const drilled = regions.filter((r) => r.fallback !== true);
    totalRegions += drilled.length;
    log.debug(
      logLabel,
      `recompute section: ${payloadColumns.length} cols, ${drilled.length} regions ` +
        `(${regions.length - drilled.length} fallback omitted), ${groups.length} groups, ` +
        `engine=v2`,
    );
    if (input.sectionId === undefined) {
      // Without the id the server cannot verify coverage — refusing to build
      // beats posting a payload the server must reject (audit P1-3).
      log.warn(logLabel, "recompute skipped: a section input carries no section id");
      return null;
    }
    outSections.push({
      start_x: input.section.start_x,
      start_y: input.section.start_y,
      end_x: input.section.end_x,
      end_y: input.section.end_y,
      columns: payloadColumns,
      regions: toRegionInputs(drilled),
    });
    sectionIds.push(input.sectionId);
    layerGroups.push(groups);
  }

  // Sections the frame assembly skipped (fewer than two columns — no gaps,
  // no partition) still need representing: the server's coverage rule is
  // exact, and "this section holds no fill evidence" is a true statement an
  // EMPTY frame makes honestly.
  for (const input of sections) {
    if (input.sectionId === undefined) {
      log.warn(logLabel, "recompute skipped: a section input carries no section id");
      return null;
    }
    if (sectionIds.includes(input.sectionId)) continue;
    outSections.push({
      start_x: input.section.start_x,
      start_y: input.section.start_y,
      end_x: input.section.end_x,
      end_y: input.section.end_y,
      columns: [],
      regions: [],
    });
    sectionIds.push(input.sectionId);
    layerGroups.push([]);
  }

  // The endpoint refuses an empty payload (422 empty_recompute_payload); assembling
  // one here is "nothing to recompute", never a request.
  if (outSections.length === 0 || totalRegions === 0) {
    log.debug(logLabel, "recompute payload empty — nothing to send");
    return null;
  }

  return { sections: outSections, section_ids: sectionIds, layer_groups: layerGroups };
}
