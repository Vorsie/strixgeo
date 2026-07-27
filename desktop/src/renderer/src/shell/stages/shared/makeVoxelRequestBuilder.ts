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
//
// The litho canvas additionally opts into the enclosed-lens body merge
// (`mergeEnclosedLenses`, debt #243). It lives here rather than in the Build
// handler because the strict merge → reload → repartition → build ordering then
// holds inside ONE async sequence, with no dependence on when React re-renders
// the closure.

import { api } from '../../../api/client'
import {
  assembleLithoSectionInputs,
  type InvestigationLocation,
  type LithoLayerLike,
  type SectionLike,
} from '../../../utils/assembleLithoSectionInputs'
import { buildVoxelRequest, type VoxelBuildRequest } from '../../../utils/buildVoxelRequest'
import { readLithoSegmenterPrefs } from '../../../utils/lithoSegmenterPrefs'
import { log } from '../../../utils/log'
import { fetchApprovedEdgesBySection } from './fetchApprovedEdgesBySection'
import {
  mergeEnclosedLensesForBuild,
  type EnclosedLensMergeReport,
} from './mergeEnclosedLensesForBuild'

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
  /**
   * When true, run the enclosed-lens body merge across every visible section
   * BEFORE assembling the partition, then rebuild the payload from the reloaded
   * layer rows (debt #243). Litho only — the geotech model's bodies are
   * materialised by the subdivision pass and must not be re-merged.
   */
  mergeEnclosedLenses?: boolean
  /**
   * Called with the merge outcome so the caller can report it ("merged N
   * enclosed lenses across M sections"). Only fires when
   * ``mergeEnclosedLenses`` is set.
   */
  onMergeReport?: (report: EnclosedLensMergeReport) => void
  /**
   * Called after a merge actually changed something and the layer rows were
   * reloaded, so the shell's own litho state catches up with the new
   * ``body_id`` stamps. The build itself does NOT depend on this — it uses the
   * rows it fetched directly.
   */
  onLayersReloaded?: () => void
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
  const {
    projectId,
    modelId,
    visibleSections,
    investigations,
    layers,
    viewState,
    logLabel,
    mergeEnclosedLenses = false,
    onMergeReport,
    onLayersReloaded,
  } = params

  return async (): Promise<VoxelBuildRequest | null> => {
    if (!projectId || !modelId || visibleSections.length === 0) return null

    // -----------------------------------------------------------------------
    // Step 0 — enclosed-lens body merge (debt #243).
    //
    // The ORDER below is not negotiable: merge → reload the layer rows →
    // recompute the partition → (caller) POST the build. The merge re-stamps
    // body_id in the DB while the voxel build takes body identity from THIS
    // payload, so a payload assembled from the pre-merge snapshot would carry
    // the old split ids and the mesher would emit a merged island inside two
    // unmerged hosts — strictly worse than not merging.
    //
    // The reloaded rows are used DIRECTLY rather than waiting for the shell's
    // own state to come back round: React would not have re-rendered this
    // closure by the time the next line runs, and predicting the post-fetch
    // state is the mistake memory/feedback_defer_until_loaded_not_predict
    // records three burnt commits for.
    //
    // It also has to run BEFORE the correlation-edge fetch below: the merge
    // CREATES approved edges, and the partition needs to see them.
    // -----------------------------------------------------------------------
    let effectiveLayers = layers
    if (mergeEnclosedLenses) {
      const report = await mergeEnclosedLensesForBuild(projectId, modelId, visibleSections)
      log.info(
        logLabel,
        `enclosed-lens merge: created ${report.edgesCreated} edge(s) across ` +
          `${report.sectionsMerged}/${report.sectionsAttempted} section(s), ` +
          `${report.edgesSkippedExisting} already existed` +
          (report.failedSectionIds.length > 0
            ? `; ${report.failedSectionIds.length} section(s) failed: ${report.failedSectionIds.join(', ')}`
            : ''),
      )
      onMergeReport?.(report)

      if (report.edgesCreated > 0) {
        // Reload is mandatory here, so a failure must abort rather than fall
        // back to the stale closure — building on the pre-merge body ids is
        // the exact failure this ordering exists to prevent.
        try {
          effectiveLayers = await api.geology.listLayers(projectId, modelId)
        } catch (err) {
          log.error(logLabel, 'layer reload after enclosed-lens merge failed', err)
          throw new Error(
            'Enclosed-lens merge succeeded but the layer reload failed — build aborted ' +
              'rather than building on pre-merge body ids.',
          )
        }
        log.info(
          logLabel,
          `reloaded ${effectiveLayers.length} layer row(s) after the enclosed-lens merge`,
        )
        onLayersReloaded?.()
      }
    }

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
      lithoLayers: effectiveLayers,
      edgesBySectionId,
    })

    const { voxelHorizontalSpacingM, voxelVerticalSpacingM } = readLithoSegmenterPrefs(viewState)
    return buildVoxelRequest(sectionInputs, voxelHorizontalSpacingM, voxelVerticalSpacingM)
  }
}
