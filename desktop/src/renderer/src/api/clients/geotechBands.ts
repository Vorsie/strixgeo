/**
 * Geotech packing-band hand-edit endpoints — preview and commit for split / merge.
 *
 * Its own module rather than four more methods on ``geology.ts``, which is already past the
 * 500-line god-module line (debt #201). Spread into ``geologyClient`` so callers keep
 * reaching them as ``api.geology.previewSplitGeotechBand(...)``.
 *
 * Every path here takes the **geotechnical** model id, not the litho parent — the router
 * guards on ``require_model_kind(..., "geotechnical")`` and answers 422 otherwise. That is
 * the opposite of ``subdivideAllBodies`` / ``divideBoreholes``, which take the litho parent.
 *
 * The preview calls write nothing. They exist so the consequence of an edit can be shown
 * BEFORE it is committed (owner ruling 6): which way the representative qc moves and what
 * class results. What comes back is advisory — never a veto (owner ruling 5).
 *
 * @module clients/geotechBands
 */
import { post } from './shared'
import type { GeotechBandEditPlanResponse, GeotechBandEditResponse } from './geology.types'

export const geotechBandsClient = {
  /**
   * POST .../geotech/bands/preview-split — what splitting this band here would do.
   *
   * Writes nothing. Returns both halves with their re-derived NAD class and the advisory
   * consequences. A depth outside the band's own litho body comes back 422: the hierarchy
   * is the one thing the owner does not overrule (ruling 2).
   */
  previewSplitGeotechBand: (
    projectId: string,
    geotechModelId: string,
    bandId: string,
    splitDepthM: number,
  ): Promise<GeotechBandEditPlanResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/bands/preview-split`, {
      band_id: bandId,
      split_depth_m: splitDepthM,
    }),

  /**
   * POST .../geotech/bands/preview-merge — what merging these two bands would do.
   *
   * Writes nothing. The merged interval's class is re-derived over the UNION, so it can
   * differ from both inputs; the warnings say, per input band, whether the material it now
   * shares a layer with pulls its representative qc down or up.
   */
  previewMergeGeotechBands: (
    projectId: string,
    geotechModelId: string,
    upperBandId: string,
    lowerBandId: string,
  ): Promise<GeotechBandEditPlanResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/bands/preview-merge`, {
      upper_band_id: upperBandId,
      lower_band_id: lowerBandId,
    }),

  /**
   * POST .../geotech/bands/split — commit the split and re-derive both halves.
   *
   * One transaction. Only the edited column re-derives (ruling 4); correlations on the
   * upper half survive unless the partner's class no longer matches the new one.
   */
  splitGeotechBand: (
    projectId: string,
    geotechModelId: string,
    bandId: string,
    splitDepthM: number,
  ): Promise<GeotechBandEditResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/bands/split`, {
      band_id: bandId,
      split_depth_m: splitDepthM,
    }),

  /**
   * POST .../geotech/bands/merge — commit the merge and re-derive the union.
   *
   * The absorbed (lower) band's row is deleted, so its correlations cascade away with it —
   * real, user-visible correlation loss, deliberate because the band they connected no
   * longer exists as a separate band.
   */
  mergeGeotechBands: (
    projectId: string,
    geotechModelId: string,
    upperBandId: string,
    lowerBandId: string,
  ): Promise<GeotechBandEditResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/bands/merge`, {
      upper_band_id: upperBandId,
      lower_band_id: lowerBandId,
    }),
}
