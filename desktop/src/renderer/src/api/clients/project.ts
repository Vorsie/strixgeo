/**
 * Project API client — typed wrappers for ``/projects/*`` endpoints,
 * plus the investigation-review sub-resource.
 *
 * Covers project CRUD, archive/unarchive, duplicate, bundle get/restore,
 * view-state PATCH, and the per-investigation review upsert/delete.
 *
 * @module clients/project
 */
import { del, get, patch, post, put } from './shared'

// ---------------------------------------------------------------------------
// Project types
// ---------------------------------------------------------------------------

/** Allowed project lifecycle phases. */
export type ProjectPhase = 'feasibility' | 'design' | 'construction' | 'monitoring'

/** Allowed project lifecycle statuses. */
export type ProjectStatus = 'active' | 'on_hold' | 'completed'

/** Full project metadata response — mirrors the backend 1:1. */
export interface ProjectResponse {
  id: string
  name: string
  project_number: string | null
  client: string | null
  site_label: string | null
  description: string | null
  tags: string[]
  default_horizontal_epsg: number | null
  default_vertical_epsg: number | null
  phase: string | null  // ProjectPhase value, kept as string for forward-compat
  status: string         // ProjectStatus value, same reason
  archived_at: string | null
  created_at: string
  updated_at: string
  // Project-level view toggles (DEM overlay, hidden-by-type sets,
  // future preferences). Schema-less JSONB on the server — the keys
  // each consumer cares about are documented in their respective
  // utility module (e.g. ``demSources.readDemOverlay``).
  view_state: Record<string, unknown>
}

/**
 * Full project bundle — metadata + every CPT (with series) + every borehole
 * (with its child tree).
 *
 * Returned by ``GET /projects/{id}/bundle`` and accepted by
 * ``POST /projects/{id}/restore``. The renderer never inspects the row
 * shapes; the data dicts are opaque and round-trip unchanged.
 */
export interface ProjectBundleResponse {
  format_version: number
  project: Record<string, unknown>
  cpts: Record<string, unknown>[]
  boreholes: Record<string, unknown>[]
  geological_formations: Record<string, unknown>[]
  geotechnical_units: Record<string, unknown>[]
  geological_models: Record<string, unknown>[]
  cross_sections: Record<string, unknown>[]
  investigation_reviews: Record<string, unknown>[]
  /** Contact-level correlation edges (#133 Phase 2+3). Absent in older bundles. */
  litho_contact_correlation_edges?: Record<string, unknown>[]
  /** Body (litho lens) metadata rows (slice 4.1 rename). Absent in older bundles. */
  bodies?: Record<string, unknown>[]
  /** Formation absence records (Position 4). Absent in older bundles. */
  formation_absences?: Record<string, unknown>[]
  /** Body boundary shapes + control nodes (#163f Slice 2). Absent in older bundles. */
  body_boundary_shapes?: Record<string, unknown>[]
  body_boundary_nodes?: Record<string, unknown>[]
}

/** Request body for ``POST /projects/``. */
export interface ProjectCreatePayload {
  name: string
  project_number?: string | null
  client?: string | null
  site_label?: string | null
  description?: string | null
  tags?: string[]
  default_horizontal_epsg?: number | null
  default_vertical_epsg?: number | null
  phase?: ProjectPhase | null
  status?: ProjectStatus
}

/** Request body for ``PATCH /projects/{id}``. */
export interface ProjectUpdatePayload {
  name?: string
  project_number?: string | null
  client?: string | null
  site_label?: string | null
  description?: string | null
  tags?: string[]
  default_horizontal_epsg?: number | null
  default_vertical_epsg?: number | null
  phase?: ProjectPhase | null
  status?: ProjectStatus
}

// ---------------------------------------------------------------------------
// Investigation-review types
// ---------------------------------------------------------------------------

/** Polymorphic target kind for an investigation review. */
export type ReviewTargetKind = 'cpt' | 'borehole'

/** Review lifecycle status. */
export type ReviewStatus = 'unreviewed' | 'in_progress' | 'reviewed'

/**
 * Investigation-review response — per-(project, investigation) row.
 *
 * Drives the sidebar's "remove from project" UX (``is_hidden``) and, in
 * Phase 5, the reviewed-state filter for the geotechnical-decision workflow.
 * Bundle-persisted: rides in the .gmproj on save, restored on open.
 */
export interface InvestigationReviewResponse {
  id: string
  app_project_id: string
  target_kind: ReviewTargetKind
  target_id: string
  review_status: ReviewStatus
  review_notes: string | null
  reviewed_at: string | null
  is_hidden: boolean
  created_at: string
  updated_at: string
}

/** Request body for ``PUT /projects/{pid}/reviews/{kind}/{targetId}``. */
export interface InvestigationReviewUpsertPayload {
  review_status?: ReviewStatus | null
  review_notes?: string | null
  is_hidden?: boolean | null
}

// ---------------------------------------------------------------------------
// Project API surface — ``api.project``
// ---------------------------------------------------------------------------

/** Typed wrappers for all ``/projects/*`` endpoints. */
export const projectClient = {
  list: (includeArchived = false): Promise<ProjectResponse[]> =>
    get(`/projects/${includeArchived ? '?include_archived=true' : ''}`),

  listArchived: (): Promise<ProjectResponse[]> => get('/projects/archived'),

  get: (id: string): Promise<ProjectResponse> => get(`/projects/${id}`),

  create: (body: ProjectCreatePayload): Promise<ProjectResponse> =>
    post('/projects/', body),

  update: (id: string, body: ProjectUpdatePayload): Promise<ProjectResponse> =>
    patch(`/projects/${id}`, body),

  archive: (id: string): Promise<ProjectResponse> =>
    post(`/projects/${id}/archive`),

  unarchive: (id: string): Promise<ProjectResponse> =>
    post(`/projects/${id}/unarchive`),

  duplicate: (id: string, name?: string): Promise<ProjectResponse> =>
    post(`/projects/${id}/duplicate`, { name: name ?? null }),

  // Full project snapshot — metadata + every CPT (with series) +
  // every borehole (with its child tree). Embedded verbatim in the
  // .gmproj v4 file on save and round-tripped to /restore on open.
  bundle: (id: string): Promise<ProjectBundleResponse> =>
    get(`/projects/${id}/bundle`),

  // Idempotently materialise a project + its CPTs + boreholes from a
  // bundle when the DB has lost the rows (wiped DB / fresh install).
  // ``replace=true`` (revert-to-last-save, #160): the project's child
  // collections are wiped before the insert so the project ends up
  // matching the bundle EXACTLY.
  restore: (
    id: string,
    body: ProjectBundleResponse,
    replace = false,
  ): Promise<ProjectResponse> =>
    post(`/projects/${id}/restore${replace ? '?replace=true' : ''}`, body),

  // Shallow-merge a patch into ``project.view_state``. Each TOP-LEVEL
  // key in ``patch`` replaces the same key in the existing dict;
  // siblings are untouched. ``null`` for a key removes it.
  patchViewState: (
    id: string,
    patchBody: Record<string, unknown>,
  ): Promise<ProjectResponse> =>
    patch(`/projects/${id}/view-state`, { patch: patchBody }),
}

// ---------------------------------------------------------------------------
// Review API surface — ``api.review``
// ---------------------------------------------------------------------------

/** Typed wrappers for per-investigation review endpoints. */
export const reviewClient = {
  list: (projectId: string): Promise<InvestigationReviewResponse[]> =>
    get(`/projects/${projectId}/reviews`),

  upsert: (
    projectId: string,
    kind: 'cpt' | 'borehole',
    targetId: string,
    body: InvestigationReviewUpsertPayload,
  ): Promise<InvestigationReviewResponse> =>
    put(`/projects/${projectId}/reviews/${kind}/${targetId}`, body),

  // Idempotent — silently returns when no row exists for the target.
  delete: (projectId: string, kind: 'cpt' | 'borehole', targetId: string): Promise<void> =>
    del(`/projects/${projectId}/reviews/${kind}/${targetId}`),
}
