// Assemble the 3-D fence panels for one model WITHOUT its 3-D viewer mounted —
// so the Export hub can write the fence DXF for the litho or geotech model even
// though the engineer is on the Export stage, not the Lithology / Geotechnical
// stage (installer #35 — the Export hub is the only export surface).
//
// This mirrors ``useBody3DViewState``'s fence memos EXACTLY so the hub's fence is
// the SAME geometry the 3-D viewer paints and the toolbar button exported:
//   * PLAIN approved edges per section (``fetchApprovedEdgesBySection`` — the
//     fence render does NOT drop resolver-suspended ties, unlike the recompute);
//   * ``assembleLithoSectionInputs`` for the model, and again for the litho
//     FRAME on the geotech axis (owner ruling 2026-08-18, densities on top of
//     lithos);
//   * ``buildProjectFence`` with the same ``packingClassOf`` and the same
//     ``resolveBody`` map (``litho_layer id → body_id``) the viewer uses, so the
//     per-gap panels collapse to one-per-body identically.
//
// It is async because the correlations are section-scoped and fetched fresh at
// press time. It returns the panels the hub hands ``exportFenceDxf`` (with the
// presentation-coloured formations the hub already holds); it does NOT own the
// save-dialog or the empty refusal — ``exportFenceDxf`` does.

import {
  assembleLithoSectionInputs,
  type InvestigationLocation,
  type SectionLike,
} from '../../../utils/assembleLithoSectionInputs'
import type { LithoLayerResponse } from '../../../api/clients/geology.types'
import { buildProjectFence } from '../../../utils/buildProjectFence'
import type { FencePanel } from '../../../utils/fencePanels'
import type { BedPolygon } from '../../../utils/bedPolygonMembership'
import { resolveRegionBodyId } from '../../../components/sections/regionBodyId'
import { log } from '../../../utils/log'
import { throwIfProjectClosed } from '../../../utils/openProjectGuard'
import { fetchApprovedEdgesBySection } from './fetchApprovedEdgesBySection'

/** Inputs the fence assembly reads at press time (a superset shared with the
 *  voxel / recompute builders — same meanings, so the fence cannot drift). */
export interface ProjectFenceBuilderParams {
  /** The app project id, or null when no project is open. */
  projectId: string | null
  /** The model whose fence to build (litho / geotech), or null when absent. */
  modelId: string | null
  /** Every visible section — the fence is the whole-project set of walls. */
  visibleSections: readonly SectionLike[]
  /** All visible CPTs + boreholes in the projection shape. */
  investigations: readonly InvestigationLocation[]
  /** The model's layer rows (litho or geotech). Carries ``body_id`` for the
   *  panel-collapse resolver. */
  layers: readonly LithoLayerResponse[]
  /** Log channel label ('litho-fence' / 'geotech-fence'). */
  logLabel: string
  /** Geotech mass identity (one mass one body); omit on the litho fence. */
  packingClassOf?: ReadonlyMap<string, string>
  /** The LITHO model to frame a GEOTECH fence on; omit on the litho fence. */
  frameModelId?: string | null
  /** The frame model's litho-layer rows; required alongside ``frameModelId``. */
  frameLayers?: readonly LithoLayerResponse[]
  /**
   * The project's bed-override polygons in the panels' horizontal CRS. Where a
   * wall crosses one, the part above the drawn bed level is cut away — the same
   * canal cut-out the section view and the 3-D viewer apply, so the exported
   * fence DXF agrees with the walls on screen (owner 2026-09-13). The caller
   * filters to the sections' CRS; omit / empty → no clip, byte-identical.
   */
  bedPolygons?: readonly BedPolygon[]
}

/**
 * Assemble the whole-project fence panels for one model.
 *
 * Parameters
 * ----------
 * params : ProjectFenceBuilderParams
 *     The press-time snapshot — project, model, every section, the visible
 *     investigations, the model's layer rows, and (on the geotech axis) the
 *     litho frame + packing-class map.
 *
 * Returns
 * -------
 * Promise<FencePanel[] | null>
 *     The fence walls, or ``null`` when there is nothing to build (no project,
 *     no model, no sections). An empty array is a real answer (a model with no
 *     drawable walls); ``exportFenceDxf`` turns that into the "nothing to
 *     export" refusal, so it is not conflated with ``null`` here.
 */
export async function buildProjectFencePanels(
  params: ProjectFenceBuilderParams,
): Promise<FencePanel[] | null> {
  const {
    projectId,
    modelId,
    visibleSections,
    investigations,
    layers,
    logLabel,
    packingClassOf,
    frameModelId,
    frameLayers,
    bedPolygons,
  } = params
  if (!projectId || !modelId || visibleSections.length === 0) return null
  // Bound to the project it was started on: a project closed between two
  // fetches throws ``ProjectClosedError`` (a silent stop for the caller) and
  // sends nothing more for it (utils/openProjectGuard).
  const what = `${logLabel} panels`
  throwIfProjectClosed(projectId, what)

  // PLAIN approved edges — the fence render keeps resolver-suspended ties (unlike
  // the recompute), so the exported fence matches the painted one. A section
  // whose edges fail to load contributes untied panels, exactly as the viewer
  // renders it; the count is logged so the incompleteness is visible.
  const { edgesBySectionId, failedSectionIds } = await fetchApprovedEdgesBySection(
    projectId,
    modelId,
    visibleSections,
  )
  throwIfProjectClosed(projectId, what)
  if (failedSectionIds.length > 0) {
    log.warn(
      logLabel,
      `fence export: ${failedSectionIds.length} of ${visibleSections.length} ` +
        'section(s) failed to load their correlations — those panels export untied',
    )
  }

  const sectionInputs = assembleLithoSectionInputs({
    visibleSections,
    investigations,
    lithoLayers: layers,
    edgesBySectionId,
  })

  // The litho FRAME for a geotech fence (owner ruling 2026-08-18). Its edges are
  // fetched PLAIN too — the litho frame is geometry scaffolding.
  let frameSectionInputs: ReturnType<typeof assembleLithoSectionInputs> | undefined
  if (frameModelId && frameLayers !== undefined) {
    const frameEdges = await fetchApprovedEdgesBySection(projectId, frameModelId, visibleSections)
    throwIfProjectClosed(projectId, what)
    if (frameEdges.failedSectionIds.length > 0) {
      log.warn(
        logLabel,
        `fence export: ${frameEdges.failedSectionIds.length} of ${visibleSections.length} ` +
          'litho-frame section(s) failed to load — the framed panels export untied',
      )
    }
    frameSectionInputs = assembleLithoSectionInputs({
      visibleSections,
      investigations,
      lithoLayers: frameLayers,
      edgesBySectionId: frameEdges.edgesBySectionId,
    })
  }

  // The same label-independent body identity the viewer collapses panels by:
  // ``litho_layer id → body_id`` over the axis's own layer list.
  const bodyIdByLayerId = new Map<string, string | null>()
  for (const l of layers) bodyIdByLayerId.set(l.id, l.body_id ?? null)
  const resolveBody = (layerIds: readonly string[] | undefined): string | null =>
    resolveRegionBodyId(layerIds, bodyIdByLayerId)

  return buildProjectFence(sectionInputs, frameSectionInputs, packingClassOf, resolveBody, bedPolygons)
}
