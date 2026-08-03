// Assemble the per-section ``FenceSectionInput[]`` from shell-bus data.
//
// Extracted from ``LithologyCanvas.tsx`` so the SAME assembly feeds both the
// Fence-mode 3D walls (``buildProjectFence``) and the voxel "Build model" payload
// (``buildVoxelRequest``). Both consumers need the identical reshape of accepted
// litho layers + projected columns + approved correlation edges into the
// section-partition contract — keeping it in one place stops the two paths from
// drifting (the maintenance rule: extract on the second copy).

import { investigationsOnSection } from './sectionProjection'
import type { FenceSectionInput } from './buildProjectFence'
import type { FenceProjectedColumn, FenceLayerInput } from './sectionFenceData'

/** Minimal investigation shape needed to project a column onto a section. */
export interface InvestigationLocation {
  /** CPT / borehole identifier. */
  id: string
  /** Easting in the project CRS (metres). */
  location_x: number
  /** Northing in the project CRS (metres). */
  location_y: number
  /** Collar elevation in metres (mTAW), or null when unknown. */
  elevation_m: number | null
}

/** Minimal litho-layer shape needed to map a layer to a fence input. */
export interface LithoLayerLike {
  /** Layer identifier. */
  id: string
  /** Source CPT id, or null when borehole-anchored. */
  cpt_id: string | null
  /** Source borehole id, or null when CPT-anchored. */
  borehole_id: string | null
  /** The lithostratigraphic formation this layer belongs to. */
  formation_id: string
  /** Resolver-assigned body identity, or null. */
  body_id: string | null
  /** Top depth in metres below the collar. */
  depth_top_m: number
  /** Base depth in metres below the collar. */
  depth_base_m: number
  /** Layer acceptance status; only ``'accepted'`` layers fill the partition. */
  status: string
}

/** Minimal section shape needed to project columns + read exclusions. */
export interface SectionLike {
  id: string
  /**
   * Section name, when the caller has it.
   *
   * Not used for geometry — it is what a build-cancelled message names so the
   * engineer knows WHICH cross-section failed to load (audit 2026-08-02).
   */
  name?: string
  start_x: number
  start_y: number
  end_x: number
  end_y: number
  /** Lateral half-width of the projection corridor (metres). */
  projection_buffer_m: number
  excluded_cpt_ids?: string[] | null
  excluded_borehole_ids?: string[] | null
}

/**
 * One approved correlation edge on a section.
 *
 * The SIDES are load-bearing and must not be dropped. An edge joins a specific
 * CONTACT of each layer, and the partition engine keys off that: a base<->base
 * bottom tie is what lets the DEEPEST unit band, and it must not be counted as a
 * top-keyed edge. Until 2026-07-30 this type carried only ``a``/``b``, so the
 * build path silently turned every base tie into a duplicate top tie — the
 * compiler could not object, because ``CorrelationEdge.aSide/bSide`` are optional
 * and documented as "Omitted ⇒ 'top'". On the owner's model that erased a clay
 * both tests bottom out in from three whole gaps of Cross-section 1 while the
 * section view drew it correctly.
 */
export interface ApprovedEdge {
  a: string
  b: string
  /** Which contact of layer ``a`` the edge joins. Omitted ⇒ ``'top'``. */
  aSide?: 'top' | 'base'
  /** Which contact of layer ``b`` the edge joins. Omitted ⇒ ``'top'``. */
  bSide?: 'top' | 'base'
}

/**
 * Reshape shell-bus investigations + litho layers + approved correlation edges
 * into one ``FenceSectionInput`` per visible section.
 *
 * Sections are independent — each is projected, its layers mapped, and its
 * approved edges attached. Layers carrying neither a ``cpt_id`` nor a
 * ``borehole_id`` are skipped (no investigation anchor to project).
 *
 * Parameters
 * ----------
 * params.visibleSections : readonly SectionLike[]
 *     The sections to assemble (one ``FenceSectionInput`` each).
 * params.investigations : readonly InvestigationLocation[]
 *     All visible CPTs + boreholes, used to project columns onto each section.
 * params.lithoLayers : readonly LithoLayerLike[]
 *     The model's litho layers (accepted + suggested); only accepted ones fill.
 * params.edgesBySectionId : ReadonlyMap<string, readonly ApprovedEdge[]>
 *     Approved correlation edges per section id (missing section → no edges).
 *
 * Returns
 * -------
 * FenceSectionInput[]
 *     One entry per visible section, ready for ``buildProjectFence`` /
 *     ``buildVoxelRequest``.
 */
export function assembleLithoSectionInputs(params: {
  visibleSections: readonly SectionLike[]
  investigations: readonly InvestigationLocation[]
  lithoLayers: readonly LithoLayerLike[]
  edgesBySectionId: ReadonlyMap<string, readonly ApprovedEdge[]>
}): FenceSectionInput[] {
  const { visibleSections, investigations, lithoLayers, edgesBySectionId } = params

  const allItems = investigations.map(inv => ({
    id: inv.id,
    location_x: inv.location_x,
    location_y: inv.location_y,
    elevation_m: inv.elevation_m,
  }))

  // Skip layers that carry neither a cpt_id nor a borehole_id — they have no
  // investigation anchor and cannot be projected onto a section column.
  const layerInputs: FenceLayerInput[] = lithoLayers.flatMap(layer => {
    const invId = layer.cpt_id ?? layer.borehole_id
    if (!invId) return []
    return [
      {
        investigationId: invId,
        layerId: layer.id,
        formationId: layer.formation_id,
        bodyId: layer.body_id ?? null,
        topDepthM: layer.depth_top_m,
        baseDepthM: layer.depth_base_m,
        accepted: layer.status === 'accepted',
      },
    ]
  })

  return visibleSections.map<FenceSectionInput>(section => {
    const excludedIds = new Set([
      ...(section.excluded_cpt_ids ?? []),
      ...(section.excluded_borehole_ids ?? []),
    ])
    const projected = investigationsOnSection(section, allItems, excludedIds)

    const projectedColumns: FenceProjectedColumn[] = projected.map(p => ({
      investigationId: p.item.id,
      alongM: p.along,
      surfaceElevM: p.item.elevation_m,
    }))

    // Carry the SIDES. Dropping them made every base<->base bottom tie arrive as
    // a duplicate top<->top tie, so the deepest unit had a top bound and no bottom
    // bound and could not band (owner 2026-07-30).
    const edges = (edgesBySectionId.get(section.id) ?? []).map(e => ({
      a: e.a,
      b: e.b,
      aSide: e.aSide,
      bSide: e.bSide,
    }))

    return {
      section: {
        start_x: section.start_x,
        start_y: section.start_y,
        end_x: section.end_x,
        end_y: section.end_y,
      },
      projectedColumns,
      layers: layerInputs,
      edges,
    }
  })
}
