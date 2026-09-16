// Factory for the async voxel-build-request callback shared by the Lithology
// and Geotechnical canvases (module-ref bridge to the stage toolbars).
//
// Extracted per audit 2026-07-12 FE-SHELL-CLIENTS-10/-11 — the ~45-line
// callback bodies were byte-equal modulo the model id, the layer rows and the
// log label. The builder is async because the correlation edges are
// section-scoped and fetched fresh at click time (Solid mode — the default —
// keeps no edges cache, so the build cannot rely on the fence-mode state).
// Resolves to null when there is nothing to build (no model / no sections),
// which the Build handler surfaces as a "nothing to build" toast — and THROWS
// a VoxelBuildInputsError when an input it needs failed to load, so a model is
// never built from a partial correlation / boundary set (audit 2026-08-02).

import {
  assembleLithoSectionInputs,
  type InvestigationLocation,
  type LithoLayerLike,
  type SectionLike,
} from '../../../utils/assembleLithoSectionInputs'
import { api } from '../../../api/client'
import type { BodyBoundaryResponse } from '../../../api/clients/geology.types'
import { buildVoxelRequest, type VoxelBuildRequest } from '../../../utils/buildVoxelRequest'
import { excludeInvestigationsFromBuild } from '../../../utils/excludeInvestigationsFromBuild'
import { FREEDRAW_EDIT_ENABLED } from '../../../utils/freedrawEditFlag'
import { readLithoSegmenterPrefs } from '../../../utils/lithoSegmenterPrefs'
import { log } from '../../../utils/log'
import { VoxelBuildInputsError } from '../../../utils/voxelBuildInputsError'
import { fetchApprovedEdgesBySection } from './fetchApprovedEdgesBySection'

/** Human-readable name for a section id, for a message the engineer reads. */
function sectionLabel(sections: readonly SectionLike[], id: string): string {
  return sections.find(s => s.id === id)?.name ?? id
}

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
   * The LITHO model to frame this build on — set on the GEOTECH stage only
   * (owner ruling 2026-08-18, "densities on top of lithos"). With it the payload
   * is the hierarchical fill the geotech axis renders, so the built model is the
   * drawn model; without it the build is the model's own whole-section
   * partition, which is what the litho stage wants.
   */
  frameModelId?: string | null
  /** The frame model's litho-layer rows; required alongside ``frameModelId``. */
  frameLayers?: readonly LithoLayerLike[]
  /**
   * Geotech formation id → canonical class key (``buildPackingClassOf``) for a
   * framed geotech build — the same mass identity the geotech axis renders
   * with (owner 2026-08-21: one mass one body). Omit on litho builds.
   */
  packingClassOf?: ReadonlyMap<string, string>
}

/**
 * The stage's "Build model" payload assembler, as the toolbar invokes it.
 *
 * The optional argument is the set of investigations to ignore for THIS build
 * (owner ruling 2026-08-26: *"Build without them should produce the model that
 * was there before the added tests"*). Omitting it is today's build, unchanged.
 */
export type VoxelRequestBuilder = (
  excludedInvestigationIds?: ReadonlySet<string>,
) => Promise<VoxelBuildRequest | null>

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
 * VoxelRequestBuilder
 *     The builder; null result means "nothing to build". It takes an optional
 *     set of investigation ids to EXCLUDE, applied to both the model's own
 *     columns and the litho frame before anything is assembled, so the payload
 *     is the one the model would have had before those tests were imported.
 *
 * Raises
 * ------
 * VoxelBuildInputsError
 *     When any input the build needs failed to load (a section's correlation
 *     edges, or the body boundary shapes). The build is cancelled rather than
 *     run on a partial input set, and ``useLithoSolids`` shows the message.
 */
export function makeVoxelRequestBuilder(
  params: VoxelRequestBuilderParams,
): VoxelRequestBuilder {
  const {
    projectId,
    modelId,
    visibleSections,
    investigations,
    layers,
    viewState,
    logLabel,
    frameModelId,
    frameLayers,
    packingClassOf,
  } = params

  return async (
    excludedInvestigationIds: ReadonlySet<string> = new Set<string>(),
  ): Promise<VoxelBuildRequest | null> => {
    if (!projectId || !modelId || visibleSections.length === 0) return null
    if (excludedInvestigationIds.size > 0) {
      log.info(
        logLabel,
        `building without ${excludedInvestigationIds.size} excluded investigation(s): ` +
          `${[...excludedInvestigationIds].join(', ')}`,
      )
    }

    // Fetch each section's approved correlation edges fresh (section-scoped).
    // A failed fetch yields an EMPTY edge list for that section, which is
    // indistinguishable downstream from "this section has no correlations" —
    // so the build must not run on it. Until 2026-08-02 it did, and the only
    // trace was a console.debug while the fragmented model was persisted
    // behind a green "Built N bodies" toast (audit Class 1).
    const { edgesBySectionId, failedSectionIds, totalApprovedEdges } =
      await fetchApprovedEdgesBySection(projectId, modelId, visibleSections)
    log.debug(
      logLabel,
      `assembled ${edgesBySectionId.size} sections, ${totalApprovedEdges} approved edges`,
    )
    if (failedSectionIds.length > 0) {
      const named = failedSectionIds.map(id => sectionLabel(visibleSections, id))
      log.error(
        logLabel,
        `build cancelled: ${failedSectionIds.length} of ${visibleSections.length} ` +
          `section(s) failed to load their correlations — ${named.join(', ')}`,
      )
      throw new VoxelBuildInputsError(
        `Could not build. Correlations failed to load for ${named.length} of ` +
          `${visibleSections.length} cross-section(s): ${named.join(', ')}. ` +
          'Nothing was changed; retry the build.',
      )
    }

    // "Just plain ignore them" — applied BEFORE assembly, per model, so the
    // excluded tests leave no column, no layer and no dangling edge behind.
    const own = excludeInvestigationsFromBuild(
      { investigations, layers, edgesBySectionId },
      excludedInvestigationIds,
    )
    const sectionInputs = assembleLithoSectionInputs({
      visibleSections,
      investigations: own.investigations,
      lithoLayers: own.layers,
      edgesBySectionId: own.edgesBySectionId,
    })

    // Every body's hand-drawn boundary, so the BUILD derives the same apex/contact
    // overrides the section overlay renders with. Without them the model was built
    // from the no-override partition while the user looked at the overridden one
    // (owner 2026-07-30: "the bottom clay is not made 3D" while Fill bands was
    // correct). Same fetch shape as SectionsCanvas' refetchLensData: one list call
    // plus one GET per body. ONE failing body used to discard ALL overrides with
    // only a console warning; it now cancels the build, because a model silently
    // built from the no-override partition is indistinguishable from a correct
    // one in the viewer and in every downstream export (audit 2026-08-02).
    let boundariesByBodyId: ReadonlyMap<string, BodyBoundaryResponse>
    if (!FREEDRAW_EDIT_ENABLED) {
      // Freedraw off = off end to end (owner ruling 2026-08-07): the 2-D fill
      // withholds stored boundary points while editing is disabled, so the
      // build must not apply them either — the invariant above (build applies
      // shapes iff the render does) holds in BOTH flag states. Not fetching
      // also means a broken boundary endpoint cannot block a build that has
      // no use for the shapes.
      boundariesByBodyId = new Map()
      log.debug(
        logLabel,
        'freedraw disabled — building without stored body boundary shapes (matches the 2-D render)',
      )
    } else {
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
        log.error(
          logLabel,
          'build cancelled: body boundary shapes failed to load — building without them ' +
            'would put reshaped contacts in the 3-D model that do not match the 2-D view',
          err,
        )
        throw new VoxelBuildInputsError(
          'Could not build. The hand-drawn body boundaries failed to load, and ' +
            'building without them would not match the cross-sections. Nothing was ' +
            'changed; retry the build.',
        )
      }
    }

    // The frame model's own sections, assembled the same way. Its correlations
    // decide which litho units are ONE body, which is what the hierarchical fill
    // groups its per-family engine runs by — so a failed fetch here cancels the
    // build for the same reason a failed packing-correlation fetch does: a model
    // built from a partial frame is indistinguishable from a correct one.
    let frameSectionInputs: ReturnType<typeof assembleLithoSectionInputs> | undefined
    if (frameModelId && frameLayers !== undefined) {
      const frameEdges = await fetchApprovedEdgesBySection(projectId, frameModelId, visibleSections)
      if (frameEdges.failedSectionIds.length > 0) {
        const named = frameEdges.failedSectionIds.map(id => sectionLabel(visibleSections, id))
        log.error(
          logLabel,
          `build cancelled: ${named.length} section(s) failed to load their LITHO ` +
            `correlations — ${named.join(', ')}`,
        )
        throw new VoxelBuildInputsError(
          `Could not build. The lithostratigraphic correlations failed to load for ` +
            `${named.length} of ${visibleSections.length} cross-section(s): ${named.join(', ')}. ` +
            'Nothing was changed; retry the build.',
        )
      }
      // The SAME exclusion on the frame. Dropping the test from the packing
      // columns alone would leave its litho column splitting a gap the packing
      // fill has no data for — the hole the ruling exists to close.
      const frame = excludeInvestigationsFromBuild(
        {
          investigations,
          layers: frameLayers,
          edgesBySectionId: frameEdges.edgesBySectionId,
        },
        excludedInvestigationIds,
      )
      frameSectionInputs = assembleLithoSectionInputs({
        visibleSections,
        investigations: frame.investigations,
        lithoLayers: frame.layers,
        edgesBySectionId: frame.edgesBySectionId,
      })
      log.debug(
        logLabel,
        `framing the build on ${frameSectionInputs.length} litho section(s), ` +
          `${frameEdges.totalApprovedEdges} approved litho edges`,
      )
    }

    const { voxelHorizontalSpacingM, voxelVerticalSpacingM } = readLithoSegmenterPrefs(viewState)
    // Section display names for the gapless gate's clause 4 entries (section
    // ids alone are not something an engineer reads out loud).
    const sectionNames = new Map(visibleSections.map(s => [s.id, s.name ?? s.id]))
    return buildVoxelRequest(
      sectionInputs,
      voxelHorizontalSpacingM,
      voxelVerticalSpacingM,
      boundariesByBodyId,
      frameSectionInputs,
      packingClassOf,
      sectionNames,
    )
  }
}
