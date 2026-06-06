/**
 * Section API client — typed wrappers for ``/projects/{pid}/sections/*``
 * endpoints, plus DEM sampling (``/dem/*``).
 *
 * ``CrossSectionResponse`` lives here because it is the canonical section
 * primitive; geology responses that reference it import from this module.
 *
 * @module clients/section
 */
import { _base, del, get, patch, post } from './shared'

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
   * Lens companion linkage (#101 Slice 4).
   * Set when this section was auto-created as the perpendicular companion
   * for the referenced lens; null for plain user sections. Cleared to null
   * if the lens is deleted (FK ON DELETE SET NULL).
   * Optional because pre-Slice-4 API responses and test fixtures omit it;
   * consumers should treat absence as null.
   */
  companion_lens_id?: string | null
  /**
   * Stays true even after companion_lens_id is nulled by a lens deletion,
   * so the UI can display a "was a lens companion" badge without a separate
   * query. False for all pre-Slice-4 sections (server default).
   * Optional because pre-Slice-4 API responses and test fixtures omit it;
   * consumers should treat absence as false.
   */
  is_lens_companion?: boolean
  /**
   * Human-readable lens name for the "Companion of: <name>" header badge
   * (#101 Slice 6).  Only populated by the perpendicular-companion endpoint
   * (which has the lens loaded); all other callers return null.  Optional
   * because most GET /sections responses omit it.
   */
  companion_lens_name?: string | null
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

  update: (
    projectId: string,
    sectionId: string,
    body: CrossSectionUpdatePayload,
  ): Promise<CrossSectionResponse> =>
    patch(`/projects/${projectId}/sections/${sectionId}`, body),

  delete: (projectId: string, sectionId: string): Promise<void> =>
    del(`/projects/${projectId}/sections/${sectionId}`),

  // Download the section's DXF export as raw bytes. Returns the
  // ``ArrayBuffer`` rather than parsing — callers pipe it straight
  // to a file write (Electron save dialog → fs.writeFileSync).
  // Throws on non-2xx; the 404 case (missing section / model)
  // surfaces through the caller's toast.
  exportDxf: async (
    projectId: string,
    sectionId: string,
    modelId: string,
  ): Promise<ArrayBuffer> => {
    const res = await fetch(
      `${_base}/projects/${projectId}/sections/${sectionId}/export/dxf` +
        `?model_id=${modelId}`,
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `Export failed (${res.status})`)
    }
    return res.arrayBuffer()
  },

  // Debt #52 slice 1: section PDF report. Same byte-pipe contract
  // as exportDxf — the caller writes the ArrayBuffer to a .pdf via
  // the Electron save dialog. The user-editable metadata (title,
  // author, notes) is forwarded as query params; the backend builds
  // sensible defaults when omitted.
  exportPdf: async (
    projectId: string,
    sectionId: string,
    modelId: string,
    metadata: { title?: string; author?: string; notes?: string },
  ): Promise<ArrayBuffer> => {
    const params = new URLSearchParams()
    params.set('model_id', modelId)
    if (metadata.title) params.set('title', metadata.title)
    if (metadata.author) params.set('author', metadata.author)
    if (metadata.notes) params.set('notes', metadata.notes)
    const res = await fetch(
      `${_base}/projects/${projectId}/sections/${sectionId}/export/pdf?${params.toString()}`,
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `Export failed (${res.status})`)
    }
    return res.arrayBuffer()
  },

  // Download the section's Plaxis 2D plxscripting script as raw
  // bytes (debt #29). Same byte-pipe contract as exportDxf — the
  // caller writes the ArrayBuffer straight to a .py file via the
  // Electron save dialog. Throws on non-2xx; the 404 (missing
  // section / model) surfaces through the caller's toast.
  exportPlaxis2d: async (
    projectId: string,
    sectionId: string,
    modelId: string,
  ): Promise<ArrayBuffer> => {
    const res = await fetch(
      `${_base}/projects/${projectId}/sections/${sectionId}/export/plaxis2d` +
        `?model_id=${modelId}`,
    )
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}))
      throw new Error(detail.detail ?? `Export failed (${res.status})`)
    }
    return res.arrayBuffer()
  },
}
