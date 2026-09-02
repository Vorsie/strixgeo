/**
 * Section API client — typed wrappers for ``/projects/{pid}/sections/*``
 * endpoints, plus DEM sampling (``/dem/*``).
 *
 * ``CrossSectionResponse`` lives here because it is the canonical section
 * primitive; geology responses that reference it import from this module.
 *
 * @module clients/section
 */
import type { SectionPartitionInput } from '../../utils/buildVoxelRequest'
import { del, get, getBytes, patch, post, postBytes } from './shared'

// ---------------------------------------------------------------------------
// DEM types
// ---------------------------------------------------------------------------

/**
 * One elevation sample along a section line.
 *
 * ``elevation_m`` is null at NoData pixels (outside DHMVII coverage or
 * known data holes); the renderer breaks the polyline there rather than
 * connecting across the gap.
 */
export interface DemSamplePoint {
  along_m: number
  elevation_m: number | null
}

/** Full DEM line-sample response — source identifier + ordered sample array. */
export interface DemSampleLineResponse {
  source: string
  samples: DemSamplePoint[]
}

// ---------------------------------------------------------------------------
// Cross-section types
// ---------------------------------------------------------------------------

/**
 * Cross-section row — mirrors ``CrossSectionResponse`` on the backend 1:1.
 *
 * The renderer reads endpoints + buffer + display prefs. Explicit-content
 * invariant: ``seeded_formation_contact_ids`` gates which contacts render on
 * this section (owner directive 2026-05-17).
 */
export interface CrossSectionResponse {
  id: string
  app_project_id: string
  name: string
  description: string | null
  start_x: number
  start_y: number
  end_x: number
  end_y: number
  epsg: number
  projection_buffer_m: number
  vertical_exaggeration: number
  excluded_borehole_ids: string[]
  excluded_cpt_ids: string[]
  min_depth_m: number | null
  max_depth_m: number | null
  display_order: number
  /** Schema-less display-preference bag — CPT channel toggles,
   * borehole interpretation toggles, future scale locks. Bundle
   * round-trips this verbatim so user preferences persist across
   * machines without per-toggle migrations. ``null`` on rows from
   * before the column landed; frontend defaults apply via
   * ``readCptChannels`` and similar. */
  view_state: Record<string, unknown> | null
  /**
   * Explicit-content invariant (owner directive 2026-05-17).
   * Only contact ids present in this set render on this section.
   * Empty array = freshly-drawn section, no formation content.
   * Populated by Seed-from-stratigraphy and manual-draw actions.
   */
  seeded_formation_contact_ids: string[]
  /**
   * Body companion linkage (#101 Slice 4; lens→body rename #222).
   * Set when this section was auto-created as the perpendicular companion
   * for the referenced body; null for plain user sections. Cleared to null
   * if the body is deleted (FK ON DELETE SET NULL).
   * Optional because pre-Slice-4 API responses and test fixtures omit it;
   * consumers should treat absence as null.
   */
  companion_body_id?: string | null
  /**
   * Stays true even after companion_body_id is nulled by a body deletion,
   * so the UI can display a "was a body companion" badge without a separate
   * query. False for all pre-Slice-4 sections (server default).
   * Optional because pre-Slice-4 API responses and test fixtures omit it;
   * consumers should treat absence as false.
   */
  is_body_companion?: boolean
  /**
   * Human-readable body name for the "Companion of: <name>" header badge
   * (#101 Slice 6).  Only populated by the perpendicular-companion endpoint
   * (which has the body loaded); all other callers return null.  Optional
   * because most GET /sections responses omit it.
   */
  companion_body_name?: string | null
  created_at: string
  updated_at: string
}

/** Request body for ``POST /projects/{pid}/sections``. */
export interface CrossSectionCreatePayload {
  name: string
  start_x: number
  start_y: number
  end_x: number
  end_y: number
  epsg: number
  description?: string | null
  projection_buffer_m?: number
  vertical_exaggeration?: number
  excluded_borehole_ids?: string[]
  excluded_cpt_ids?: string[]
  min_depth_m?: number | null
  max_depth_m?: number | null
  display_order?: number
}

/** Request body for ``POST /projects/{pid}/sections/batch``. */
export interface BatchCreateSectionsPayload {
  sections: CrossSectionCreatePayload[]
}

/** Response from ``POST /projects/{pid}/sections/batch`` — the created sections. */
export interface BatchCreateSectionsResult {
  sections: CrossSectionResponse[]
}

/** Request body for ``PATCH /projects/{pid}/sections/{sid}``. */
export interface CrossSectionUpdatePayload {
  name?: string | null
  description?: string | null
  start_x?: number | null
  start_y?: number | null
  end_x?: number | null
  end_y?: number | null
  epsg?: number | null
  projection_buffer_m?: number | null
  vertical_exaggeration?: number | null
  excluded_borehole_ids?: string[] | null
  excluded_cpt_ids?: string[] | null
  min_depth_m?: number | null
  max_depth_m?: number | null
  display_order?: number | null
  /** Shallow-merged into the section's view_state JSONB bag. Send
   * a partial dict ({cpt_channels: {...}}) to patch single keys
   * without round-tripping the whole bag. ``null`` for a top-level
   * key removes it; ``{}`` clears the bag entirely; ``null`` for
   * the whole field is the "do not touch" sentinel. */
  view_state?: Record<string, unknown> | null
}

// ---------------------------------------------------------------------------
// DEM API surface — ``api.dem``
// ---------------------------------------------------------------------------

/** Typed wrappers for the DEM sampling endpoint. */
export const demClient = {
  sampleLine: (params: {
    startX: number
    startY: number
    endX: number
    endY: number
    epsg: number
    nSamples?: number
  }): Promise<DemSampleLineResponse> => {
    const q = new URLSearchParams({
      start_x: String(params.startX),
      start_y: String(params.startY),
      end_x: String(params.endX),
      end_y: String(params.endY),
      epsg: String(params.epsg),
      n_samples: String(params.nSamples ?? 200),
    })
    return get(`/dem/sample?${q.toString()}`)
  },
}

// ---------------------------------------------------------------------------
// Section API surface — ``api.section``
// ---------------------------------------------------------------------------

/** Typed wrappers for all ``/projects/{pid}/sections/*`` endpoints. */
export const sectionClient = {
  list: (projectId: string): Promise<CrossSectionResponse[]> =>
    get(`/projects/${projectId}/sections`),

  get: (projectId: string, sectionId: string): Promise<CrossSectionResponse> =>
    get(`/projects/${projectId}/sections/${sectionId}`),

  create: (
    projectId: string,
    body: CrossSectionCreatePayload,
  ): Promise<CrossSectionResponse> =>
    post(`/projects/${projectId}/sections`, body),

  createBatch: (
    projectId: string,
    body: BatchCreateSectionsPayload,
  ): Promise<BatchCreateSectionsResult> =>
    post(`/projects/${projectId}/sections/batch`, body),

  update: (
    projectId: string,
    sectionId: string,
    body: CrossSectionUpdatePayload,
  ): Promise<CrossSectionResponse> =>
    patch(`/projects/${projectId}/sections/${sectionId}`, body),

  delete: (projectId: string, sectionId: string): Promise<void> =>
    del(`/projects/${projectId}/sections/${sectionId}`),

  // Download the section's DXF export as raw bytes (byte-pipe
  // contract — see `getBytes`).
  exportDxf: (projectId: string, sectionId: string, modelId: string): Promise<ArrayBuffer> =>
    getBytes(`/projects/${projectId}/sections/${sectionId}/export/dxf?model_id=${modelId}`),

  // Download the section's Plaxis 2D plxscripting script as raw
  // bytes (debt #29). Same byte-pipe contract as exportDxf.
  exportPlaxis2d: (projectId: string, sectionId: string, modelId: string): Promise<ArrayBuffer> =>
    getBytes(
      `/projects/${projectId}/sections/${sectionId}/export/plaxis2d?model_id=${modelId}`,
    ),

  /**
   * Download the section as a Deltares D-Stability ``.stix`` (v1.0 gate,
   * owner ballot 2026-08-26).
   *
   * A POST, unlike every other section export: D-Stability's geometry IS the
   * section's closed polygons, and the fill that produces them is computed
   * here in the renderer — so the drawn partition travels in the body. Pass
   * the SAME ``SectionPartitionInput`` shape the voxel build sends
   * (``buildVoxelRequest(...).sections[i]``), so the exported model and the
   * built 3-D model describe the same ground.
   *
   * Rejects with an ``ApiError`` carrying
   * ``detail.code = 'dstability_export_refused'`` when the section has no
   * closed geometry — its ``message`` is engineer-readable and belongs in
   * the toast unchanged.
   */
  exportDstability: (
    projectId: string,
    sectionId: string,
    modelId: string,
    partition: SectionPartitionInput,
  ): Promise<ArrayBuffer> =>
    postBytes(
      `/projects/${projectId}/sections/${sectionId}/export/dstability?model_id=${modelId}`,
      { partition },
    ),

  /**
   * Download a 1-D soil profile through the section as a Deltares D-Sheet
   * Piling ``.shi`` (v1.0 gate, owner ballot 2026-08-26).
   *
   * ``fraction`` is where along the section line to sample — 0.0 at the
   * section's start endpoint, 1.0 at its end, mid-section when omitted.
   *
   * Rejects with ``detail.code = 'dsheetpiling_export_refused'`` when
   * nothing is drawn at the sampled position.
   */
  exportDsheetPiling: (
    projectId: string,
    sectionId: string,
    modelId: string,
    partition: SectionPartitionInput,
    fraction?: number,
  ): Promise<ArrayBuffer> => {
    const params = new URLSearchParams({ model_id: modelId })
    if (fraction !== undefined) params.set('fraction', String(fraction))
    return postBytes(
      `/projects/${projectId}/sections/${sectionId}/export/dsheetpiling?${params.toString()}`,
      { partition },
    )
  },
}
