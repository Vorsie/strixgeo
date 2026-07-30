// Factory for the async voxel-build-request callback shared by the Lithology
// and Geotechnical canvases (module-ref bridge to the stage toolbars).
//
// Extracted per audit 2026-07-12 FE-SHELL-CLIENTS-10/-11 — the ~45-line
// callback bodies were byte-equal modulo the model id, the layer rows and the
// log label. The builder is async because the correlation edges are
// section-scoped and fetched fresh at click time (Solid mode — the default —
// keeps no edges cache, so the build cannot rely on the fence-mode state).
// Resolves to null when there is nothing to build (no model / no sections),
// which the Build handler surfaces as a "nothing to build" toast.

import {
  assembleLithoSectionInputs,
  type InvestigationLocation,
  type LithoLayerLike,
  type SectionLike,
} from '../../../utils/assembleLithoSectionInputs'
import { api } from '../../../api/client'
import type { BodyBoundaryResponse } from '../../../api/clients/geology.types'
import { buildVoxelRequest, type VoxelBuildRequest } from '../../../utils/buildVoxelRequest'
import { readLithoSegmenterPrefs } from '../../../utils/lithoSegmenterPrefs'
import { log } from '../../../utils/log'
import { fetchApprovedEdgesBySection } from './fetchApprovedEdgesBySection'

/** Inputs captured by the voxel-request builder closure. */
export interface VoxelRequestBuilderParams {
  /** The app project id, or null when no project is open. */
  projectId: string | null
  /** The model id to build (litho / geotech), or null when absent. */
  modelId: string | null
  /** The visible sections to project onto. */
  visibleSections: readonly SectionLike[]
  /** All visible CPTs + boreholes in the projection shape. */
  investigations: readonly InvestigationLocation[]
  /** The model's litho-layer rows (litho or geotech — model-agnostic). */
  layers: readonly LithoLayerLike[]
  /** The project's view_state bag (voxel-spacing prefs live there). */
  viewState: Record<string, unknown> | null | undefined
  /** Log channel label ('litho-voxel' / 'geotech-voxel'). */
  logLabel: string
}

/**
 * Build the async voxel-request callback for a stage's "Build model" button.
 *
 * The canvas assigns the returned function to its module-level voxel ref
 * every render (same pattern as the reset-camera refs); the toolbar's Build
 * onClick invokes it.
 *
 * Parameters
 * ----------
 * params : VoxelRequestBuilderParams
 *     The per-render snapshot the callback closes over.
 *
 * Returns
 * -------
 * () => Promise<VoxelBuildRequest | null>
 *     The builder; null result means "nothing to build".
 */
export function makeVoxelRequestBuilder(
  params: VoxelRequestBuilderParams,
): () => Promise<VoxelBuildRequest | null> {
  const { projectId, modelId, visibleSections, investigations, layers, viewState, logLabel } =
    params

  return async (): Promise<VoxelBuildRequest | null> => {
    if (!projectId || !modelId || visibleSections.length === 0) return null

    // Fetch each section's approved correlation edges fresh (section-scoped;
    // a failed fetch degrades to no edges for that section rather than
    // aborting the whole build — the partition still fills, just without that
    // section's correlations).
    const { edgesBySectionId, failedSectionIds, totalApprovedEdges } =
      await fetchApprovedEdgesBySection(projectId, modelId, visibleSections)
    log.debug(
      logLabel,
      `assembled ${edgesBySectionId.size} sections, ${totalApprovedEdges} approved edges` +
        (failedSectionIds.length > 0
          ? `; ${failedSectionIds.length} section(s) failed → empty: ${failedSectionIds.join(', ')}`
          : ''),
    )

    const sectionInputs = assembleLithoSectionInputs({
      visibleSections,
      investigations,
      lithoLayers: layers,
      edgesBySectionId,
    })

    // Every body's hand-drawn boundary, so the BUILD derives the same apex/contact
    // overrides the section overlay renders with. Without them the model was built
    // from the no-override partition while the user looked at the overridden one
    // (owner 2026-07-30: "the bottom clay is not made 3D" while Fill bands was
    // correct). Same fetch shape as SectionsCanvas' refetchLensData: one list call
    // plus one GET per body. A failure degrades to no overrides — the old
    // behaviour — rather than aborting the build, and says so loudly.
    let boundariesByBodyId: ReadonlyMap<string, BodyBoundaryResponse> | undefined
    try {
      const bodies = await api.geology.listLenses(projectId, modelId)
      boundariesByBodyId = new Map(
        await Promise.all(
          bodies.map(
            async (b) =>
              [b.id, await api.geology.getBodyBoundary(projectId, modelId, b.id)] as const,
          ),
        ),
      )
      log.debug(logLabel, `loaded ${boundariesByBodyId.size} body boundary shape(s) for the build`)
    } catch (err) {
      log.warn(
        logLabel,
        'body boundaries failed to load — building WITHOUT hand-drawn overrides, so a ' +
          'reshaped contact will not match the 2-D view',
        err,
      )
    }

    const { voxelHorizontalSpacingM, voxelVerticalSpacingM } = readLithoSegmenterPrefs(viewState)
    return buildVoxelRequest(
      sectionInputs,
      voxelHorizontalSpacingM,
      voxelVerticalSpacingM,
      boundariesByBodyId,
    )
  }
}
