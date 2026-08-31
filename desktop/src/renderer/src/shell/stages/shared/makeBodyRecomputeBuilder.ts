// Async assembly of the body-identity recompute payload (slice 5) — the
// recompute sibling of ``makeVoxelRequestBuilder``, sharing its shape on purpose:
// fetch the section-scoped approved edges fresh at fire time, refuse on any
// partial input, assemble the fence inputs, and hand the pure builder
// (``buildBodyRecomputePayload``) the rest.
//
// Differences from the voxel builder, each deliberate:
//   * Approved edges are fetched with ``dropSuspendedReviewEdges`` — the body
//     resolver SUSPENDS ``class_changed`` / ``ambiguous_band`` flagged ties from
//     unioning (owner ruling F31), so identity geometry must not weld through them.
//   * Refusals RETURN NULL with a warning instead of throwing: the recompute is a
//     background debounce, not a click — there is no user gesture to answer with an
//     error dialog, and the next mutation reschedules anyway.

import {
  assembleLithoSectionInputs,
  type InvestigationLocation,
  type LithoLayerLike,
  type SectionLike,
} from '../../../utils/assembleLithoSectionInputs'
import { api } from '../../../api/client'
import type { BodyBoundaryResponse } from '../../../api/clients/geology.types'
import {
  buildBodyRecomputePayload,
  type RecomputeBodiesRequest,
} from '../../../utils/buildBodyRecomputePayload'
import { FREEDRAW_EDIT_ENABLED } from '../../../utils/freedrawEditFlag'
import { log } from '../../../utils/log'
import { fetchApprovedEdgesBySection } from './fetchApprovedEdgesBySection'

/** Inputs the recompute assembly reads at fire time. */
export interface BodyRecomputeAssemblyParams {
  /** The app project id, or null when no project is open. */
  projectId: string | null
  /** The model id to recompute (litho / geotech), or null when absent. */
  modelId: string | null
  /** The visible sections to project onto. */
  visibleSections: readonly SectionLike[]
  /** All visible CPTs + boreholes in the projection shape. */
  investigations: readonly InvestigationLocation[]
  /** The model's layer rows (litho or geotech — model-agnostic). */
  layers: readonly LithoLayerLike[]
  /** Log channel label ('litho-recompute' / 'geotech-recompute'). */
  logLabel: string
  /**
   * Geotech formation id → canonical class key (``buildPackingClassOf``) — the
   * identity the evidence groups by (owner 2026-08-21: one mass one body).
   * Omit for the litho model, which keeps row identity.
   */
  packingClassOf?: ReadonlyMap<string, string>
  /**
   * The LITHO model to frame this recompute on — set on the GEOTECH recompute
   * only (owner ruling R6, debt #278). With it, body identity is the
   * hierarchical fill on the litho frame's columns (the picture the geotech axis
   * renders); without it the recompute is the model's own whole-section
   * partition, which is what the litho stage wants.
   */
  frameModelId?: string | null
  /** The frame model's litho-layer rows; required alongside ``frameModelId``. */
  frameLayers?: readonly LithoLayerLike[]
}

/**
 * Assemble the recompute payload for one model, or ``null`` when nothing can /
 * should be sent.
 *
 * ``null`` covers: no project/model/sections; a section's approved-edge fetch
 * failed (partial input — the payload would encode a differently-tied model);
 * the LITHO FRAME's approved-edge fetch failed on a framed geotech recompute
 * (same reason — a payload from a partial frame would state the wrong families);
 * the boundary-shape fetch failed while freedraw is enabled (same reason); or
 * the assembly came out EMPTY (the endpoint 422s on an empty payload).
 *
 * Parameters
 * ----------
 * params : BodyRecomputeAssemblyParams
 *     The fire-time snapshot of the model's inputs.
 *
 * Returns
 * -------
 * Promise<RecomputeBodiesRequest | null>
 *     The payload, or null (with the reason logged) when nothing fires.
 */
export async function assembleBodyRecomputePayload(
  params: BodyRecomputeAssemblyParams,
): Promise<RecomputeBodiesRequest | null> {
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
  } = params
  if (!projectId || !modelId || visibleSections.length === 0) return null

  // Section-scoped approved edges, minus resolver-suspended flagged ties. A failed
  // per-section fetch is indistinguishable from "no correlations" downstream, so the
  // payload must not be assembled on it (same rule as the voxel build).
  const { edgesBySectionId, failedSectionIds, totalApprovedEdges } =
    await fetchApprovedEdgesBySection(projectId, modelId, visibleSections, {
      dropSuspendedReviewEdges: true,
    })
  if (failedSectionIds.length > 0) {
    log.warn(
      logLabel,
      `recompute skipped: ${failedSectionIds.length} of ${visibleSections.length} ` +
        'section(s) failed to load their correlations — a payload from partial edges ' +
        'would weld the wrong bodies; the next mutation reschedules',
    )
    return null
  }
  log.debug(
    logLabel,
    `recompute assembly: ${edgesBySectionId.size} sections, ${totalApprovedEdges} approved edges`,
  )

  // Stored hand-drawn boundaries — identical gating to ``makeVoxelRequestBuilder``:
  // freedraw off = the 2-D render withholds stored shapes, so identity geometry must
  // not apply them either (build/render/identity stay in step in BOTH flag states).
  let boundariesByBodyId: ReadonlyMap<string, BodyBoundaryResponse>
  if (!FREEDRAW_EDIT_ENABLED) {
    boundariesByBodyId = new Map()
  } else {
    try {
      const bodies = await api.geology.listLenses(projectId, modelId)
      boundariesByBodyId = new Map(
        await Promise.all(
          bodies.map(
            async b =>
              [b.id, await api.geology.getBodyBoundary(projectId, modelId, b.id)] as const,
          ),
        ),
      )
    } catch (err) {
      log.warn(
        logLabel,
        'recompute skipped: body boundary shapes failed to load — identity from the ' +
          'no-override partition would not match the drawn sections',
        err,
      )
      return null
    }
  }

  const sectionInputs = assembleLithoSectionInputs({
    visibleSections,
    investigations,
    lithoLayers: layers,
    edgesBySectionId,
  })

  // The LITHO FRAME, for a GEOTECH recompute (owner ruling R6, debt #278): body
  // identity is decided from the picture the render shows — the hierarchical fill
  // on the litho frame's columns. Its correlations decide which litho units are
  // ONE body, which is what the framed fill groups its per-family runs by, so a
  // failed fetch REFUSES the whole assembly (null + warning, not a throw — this
  // is a background debounce, and the next mutation reschedules): a payload from
  // a partial frame would state the wrong families. The frame edges are fetched
  // PLAIN — the litho frame is geometry scaffolding and the suspended review
  // reasons are GEOTECH tie reasons, so ``dropSuspendedReviewEdges`` (which the
  // geotech fetch above uses) must NOT silence a litho tie here.
  let frameSectionInputs: ReturnType<typeof assembleLithoSectionInputs> | undefined
  if (frameModelId && frameLayers !== undefined) {
    const frameEdges = await fetchApprovedEdgesBySection(projectId, frameModelId, visibleSections)
    if (frameEdges.failedSectionIds.length > 0) {
      log.warn(
        logLabel,
        `recompute skipped: ${frameEdges.failedSectionIds.length} of ${visibleSections.length} ` +
          'section(s) failed to load their LITHO frame correlations — a payload from a ' +
          'partial frame would state the wrong families; the next mutation reschedules',
      )
      return null
    }
    frameSectionInputs = assembleLithoSectionInputs({
      visibleSections,
      investigations,
      lithoLayers: frameLayers,
      edgesBySectionId: frameEdges.edgesBySectionId,
    })
    log.debug(
      logLabel,
      `framing the recompute on ${frameSectionInputs.length} litho section(s), ` +
        `${frameEdges.totalApprovedEdges} approved litho edges`,
    )
  }

  return buildBodyRecomputePayload(
    sectionInputs,
    boundariesByBodyId,
    logLabel,
    packingClassOf,
    frameSectionInputs,
  )
}
