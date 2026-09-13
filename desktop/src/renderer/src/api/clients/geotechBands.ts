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
import type {
  GeotechBandEditPlanResponse,
  GeotechBandEditResponse,
  GeotechStatisticResponse,
  RestatedContactMoveResponse,
} from './geology.types'

export const geotechBandsClient = {
  /**
   * POST .../geotech/bands/set-class — set a BOREHOLE band's NAD class by hand.
   *
   * Owner ask 2026-08-18: a borehole band's class is donor-extrapolated, not
   * measured, so the engineer's judgement outranks it. Commits directly (the
   * change is one number and fully undoable); the server refuses CPT bands
   * and classes outside the band's soil family with a 422.
   */
  setGeotechBandClass: (
    projectId: string,
    geotechModelId: string,
    bandId: string,
    nadClass: number,
  ): Promise<GeotechBandEditResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/bands/set-class`, {
      band_id: bandId,
      nad_class: nadClass,
    }),

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
   *
   * ``restore`` is the additive escape from re-derivation: when present, each half
   * is assigned the given class + source DIRECTLY, no qc is read and the borehole
   * refusal is lifted. Two callers pass it — the merge undo (restoring the two
   * pre-merge bands exactly, owner #35) and a borehole split (a borehole has no
   * qc, so both halves keep the original band's class). Omit it for the ordinary
   * re-deriving CPT split.
   */
  splitGeotechBand: (
    projectId: string,
    geotechModelId: string,
    bandId: string,
    splitDepthM: number,
    restore?: {
      upperNadClass: number | null
      lowerNadClass: number | null
      upperSource?: string | null
      lowerSource?: string | null
    },
  ): Promise<GeotechBandEditResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/bands/split`, {
      band_id: bandId,
      split_depth_m: splitDepthM,
      ...(restore === undefined
        ? {}
        : {
            restore: true,
            restore_upper_nad_class: restore.upperNadClass,
            restore_lower_nad_class: restore.lowerNadClass,
            restore_upper_source: restore.upperSource ?? null,
            restore_lower_source: restore.lowerSource ?? null,
          }),
    }),

  /**
   * POST .../geotech/bands/merge — commit the merge and re-derive the union.
   *
   * Flag-not-drop (owner 2026-08-07): the absorbed band's ACCEPTED ties are
   * transferred to the survivor and flagged for review (never silently
   * cascaded away); pending ties go with the row. The response's
   * ``flagged_edge_ids`` / ``cleared_edge_ids`` say what moved.
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

  /**
   * POST .../geotech/bands/preview-merge with the RUN form — what absorbing a
   * contiguous run (host + lens + host) into one band would do. One honest
   * preview over the whole union, one undo step.
   */
  previewMergeGeotechRun: (
    projectId: string,
    geotechModelId: string,
    bandIds: readonly string[],
  ): Promise<GeotechBandEditPlanResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/bands/preview-merge`, {
      band_ids: bandIds,
    }),

  /** POST .../geotech/bands/merge with the RUN form — commit the N-band union. */
  mergeGeotechRun: (
    projectId: string,
    geotechModelId: string,
    bandIds: readonly string[],
  ): Promise<GeotechBandEditResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/bands/merge`, {
      band_ids: bandIds,
    }),

  /**
   * POST .../geotech/bands/preview-move — what dragging this boundary to this
   * depth would do. Both resulting intervals re-derive their class (ruling 3);
   * a boundary between different litho parents is a CONTACT and 422s.
   */
  previewMoveGeotechBoundary: (
    projectId: string,
    geotechModelId: string,
    upperBandId: string,
    lowerBandId: string,
    newDepthM: number,
  ): Promise<GeotechBandEditPlanResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/bands/preview-move`, {
      upper_band_id: upperBandId,
      lower_band_id: lowerBandId,
      new_depth_m: newDepthM,
    }),

  /**
   * POST .../geotech/bands/move — commit the drag: an atomic two-row write,
   * both classes re-derived, ties flagged/withdrawn per flag-not-drop.
   */
  moveGeotechBoundary: (
    projectId: string,
    geotechModelId: string,
    upperBandId: string,
    lowerBandId: string,
    newDepthM: number,
  ): Promise<GeotechBandEditResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/bands/move`, {
      upper_band_id: upperBandId,
      lower_band_id: lowerBandId,
      new_depth_m: newDepthM,
    }),

  /**
   * POST .../geotech/contact/move — drag the boundary that RESTATES a
   * lithostratigraphic contact, moving every model that records it.
   *
   * The sibling of ``moveGeotechBoundary``, for the other kind of boundary.
   * That one moves a packing boundary inside one litho unit; this one moves the
   * boundary BETWEEN two units, so the packing bands, the litho contact and —
   * when the row carries one — the geological contact all move in a single
   * transaction. Both bands re-derive their class, because their extents
   * changed and the chain is soil type → qc → NAD parameters.
   *
   * The response names what was carried, so the UI can say it.
   */
  moveRestatedContact: (
    projectId: string,
    geotechModelId: string,
    upperBandId: string,
    lowerBandId: string,
    newDepthM: number,
  ): Promise<RestatedContactMoveResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/contact/move`, {
      upper_band_id: upperBandId,
      lower_band_id: lowerBandId,
      new_depth_m: newDepthM,
    }),

  /**
   * POST .../geotech/statistic — set the model's representative-qc statistic
   * (rulings 7+8). Writes ONE column; never re-derives bands. The response's
   * ``bands_stale`` drives the "re-subdivide under <statistic>" tag.
   */
  setGeotechStatistic: (
    projectId: string,
    geotechModelId: string,
    statistic: 'median' | 'arithmetic' | 'harmonic' | 'geometric',
  ): Promise<GeotechStatisticResponse> =>
    post(`/projects/${projectId}/geology/models/${geotechModelId}/geotech/statistic`, {
      statistic,
    }),
}
