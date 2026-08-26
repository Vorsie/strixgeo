// The drawn partition for ONE section, for the exports that carry geometry.
//
// D-Stability and D-Sheet Piling are the CLOSED-geometry export family: their
// model IS the section's filled polygons, and that fill is computed here in the
// renderer — so the partition travels in the POST body rather than being
// re-derived server-side. This module decides WHERE that partition comes from.
//
// WHY not the canvas voxel refs (``lithoVoxelRequestCallback`` /
// ``geotechVoxelRequestCallback``), which already hold a builder:
//
//   * ``StageCanvas`` renders exactly ONE stage's ``CanvasComponent``, so on
//     the Sections stage neither ``LithologyCanvas`` nor ``GeotechnicalCanvas``
//     is mounted. ``GeotechnicalToolbar`` states the same fact for its own Build
//     verb: a Build button on the Sections stage "would never have the callback
//     and would be a permanent no-op".
//   * Both canvases assign their ref in the RENDER BODY and never clear it on
//     unmount. So after the engineer visits one of those stages once, the ref on
//     the Sections stage holds a STALE closure over that render's sections,
//     layers and model id — which is worse than null, because it exports ground
//     the open section does not draw, with no symptom.
//
// So the partition is assembled here instead — but assembled by the SAME
// factory the 3-D build uses (``makeVoxelRequestBuilder``), scoped to the one
// open section. Reuse, not re-derivation: the export and the build run the same
// edge fetch, the same ``assembleLithoSectionInputs``, the same
// ``computeSectionFill`` / hierarchical fill, and the same
// ``buildVoxelRequest`` reshape. The two cannot drift, which is the whole point
// — what is exported is what the section draws.

import {
  makeVoxelRequestBuilder,
  type VoxelRequestBuilderParams,
} from '../shared/makeVoxelRequestBuilder'
import type { SectionPartitionInput } from '../../../utils/buildVoxelRequest'
import type { SectionLike } from '../../../utils/assembleLithoSectionInputs'

/**
 * Inputs the export partition is assembled from, read at press time.
 *
 * Every field carries the meaning it has in ``VoxelRequestBuilderParams`` —
 * deliberately, so the export cannot be configured differently from the build.
 * The one difference is ``section``: the build takes every visible section, the
 * export takes the one the engineer has open.
 */
export interface SectionExportPartitionParams
  extends Omit<VoxelRequestBuilderParams, 'visibleSections'> {
  /** The single section being exported, or null when none is selected. */
  section: SectionLike | null
}

/**
 * Assemble the drawn 2-D partition for the one open section.
 *
 * Scoping to a single section is not just a filter on the result: it is what
 * the whole assembly runs on, so the correlation fetch is one call for one
 * section and no other cross-section's ground is ever read, let alone posted.
 *
 * Parameters
 * ----------
 * params : SectionExportPartitionParams
 *     The press-time snapshot — project, axis model, the open section, the
 *     visible investigations, the model's layer rows, and (on the geotech axis)
 *     the litho frame that makes the fill hierarchical.
 *
 * Returns
 * -------
 * Promise<SectionPartitionInput | null>
 *     The section's partition, or ``null`` when there is nothing to export: no
 *     project, no active model for the axis, no selected section, or fewer than
 *     two columns on the line (no gap to fill between). Every one of those means
 *     "refuse", never "post an empty model".
 *
 * Raises
 * ------
 * VoxelBuildInputsError
 *     When an input the partition needs failed to load — the section's
 *     correlations, or the litho frame's. Propagated deliberately: an export
 *     built from a partial tie set is indistinguishable from a correct one once
 *     it is open in D-Stability.
 */
export async function buildSectionExportPartition(
  params: SectionExportPartitionParams,
): Promise<SectionPartitionInput | null> {
  const { section, ...rest } = params
  if (section === null) return null

  const build = makeVoxelRequestBuilder({ ...rest, visibleSections: [section] })
  const request = await build()
  return request?.sections[0] ?? null
}
