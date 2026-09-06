/**
 * Project API client — typed wrappers for ``/projects/*`` endpoints,
 * plus the investigation-review sub-resource.
 *
 * Covers project CRUD, archive, duplicate, bundle get/restore,
 * view-state PATCH, and the per-investigation review upsert/delete.
 *
 * @module clients/project
 */
import { get, patch, post, put } from './shared'
// Type-only import: the lumping snapshot's shape is owned by the file
// format, and the staged endpoint takes exactly that shape. Importing the
// type (never a value) keeps this module free of a runtime dependency on
// the utils layer, so the mutual `import type` with projectFile.ts stays
// erased at build time.
import type { StratigraphyLumping } from '../../utils/projectFile'

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
  // The lumping map's durable home (docs/design/autosave-recovery.md §3).
  // ``staged`` is written the moment Fill-from-boreholes → Apply runs;
  // ``saved`` is what the last File → Save promoted. ``staged !== saved``
  // is the same dirty signal the renderer derives in memory.
  //
  // Typed as opaque dicts because the READ path on the server is
  // pass-through (a project whose JSONB fails validation must not 500 the
  // whole project list) — so the renderer must narrow these itself before
  // trusting the shape. ``null`` means "no lumping map at all", which is
  // NOT the same as a snapshot whose ``map`` is empty.
  //
  // OPTIONAL, mirroring the backend schema's "additive + optional" stance:
  // a response serialised before these columns existed carries neither, and
  // every read site has to handle the null case regardless.
  stratigraphy_lumping_staged?: Record<string, unknown> | null
  stratigraphy_lumping_saved?: Record<string, unknown> | null
  // Renderer-owned monotonic counter, bumped on every stage. It is what
  // crash-recovery reconciliation compares — never wall-clocks. ``null``
  // means the project has never been staged by a revision-aware client.
  stratigraphy_lumping_revision?: number | null
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
  /**
   * Geometric body-identity facts — observed layer-pair adjacency, unioned
   * with the correlation ties by the body resolver (owner ruling 2026-08-12).
   * Absent in older bundles.
   */
  body_geometry_facts?: Record<string, unknown>[]
  /**
   * Deleted-tie tombstones (owner 2026-08-17: "a tie i delete stays
   * deleted"). Evidence, not cache: dropping them resurrects every tie the
   * engineer deleted on the next derivation. Absent in older bundles.
   */
  geotech_tie_tombstones?: Record<string, unknown>[]
  /**
   * Body separations (debt #278 R5): the "these two are NOT the same body"
   * cannot-link constraints the resolver honours. Evidence, not cache: dropping
   * them re-merges every body the engineer split, on the next resolve. Absent
   * in older bundles.
   */
  body_separations?: Record<string, unknown>[]
  /**
   * Body unions (debt #278, the "Join with…" verb): the "these two ARE the same
   * body" must-link constraints the resolver honours. Evidence, not cache:
   * dropping them re-splits every body the engineer joined, on the next resolve.
   * Absent in older bundles.
   */
  body_unions?: Record<string, unknown>[]
  /**
   * Manual bed-level override polygons (owner ruling 2026-09-06): a polygon with
   * one constant bed elevation. Inside it the ground surface takes that level
   * instead of the DEM. Absent in older bundles.
   */
  bed_overrides?: Record<string, unknown>[]
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

/**
 * Restore response — a ``ProjectResponse`` plus the counts of rows the restore
 * size caps truncated (production-readiness audit L6). Both are 0 when nothing
 * was dropped; a non-zero count is worth a toast ("some depth-series / child
 * rows were too large and were capped on open").
 */
export interface ProjectRestoreResponse extends ProjectResponse {
  dropped_series: number
  dropped_child_rows: number
}

// ---------------------------------------------------------------------------
// Project API surface — ``api.project``
// ---------------------------------------------------------------------------

/** Typed wrappers for all ``/projects/*`` endpoints. */
export const projectClient = {
  get: (id: string): Promise<ProjectResponse> => get(`/projects/${id}`),

  create: (body: ProjectCreatePayload): Promise<ProjectResponse> =>
    post('/projects/', body),

  update: (id: string, body: ProjectUpdatePayload): Promise<ProjectResponse> =>
    patch(`/projects/${id}`, body),

  archive: (id: string): Promise<ProjectResponse> =>
    post(`/projects/${id}/archive`),

  duplicate: (id: string, name?: string): Promise<ProjectResponse> =>
    post(`/projects/${id}/duplicate`, { name: name ?? null }),

  // Full project snapshot — metadata + every CPT (with series) +
  // every borehole (with its child tree). Embedded verbatim in the
  // .gmproj v4 file on save and round-tripped to /restore on open.
  //
  // ``includeSolids`` defaults to false: the .strix file never stores the
  // cached 3-D litho meshes (``buildProjectFile`` drops them) and nothing
  // here reads ``litho_solids`` from the bundle, so pulling ~10 MB of
  // vertices/triangles on every save was wasted work that made saving slow.
  // Pass ``true`` only if a future caller genuinely needs the meshes.
  bundle: (id: string, includeSolids = false): Promise<ProjectBundleResponse> =>
    get(`/projects/${id}/bundle?include_solids=${includeSolids}`),

  // Idempotently materialise a project + its CPTs + boreholes from a
  // bundle when the DB has lost the rows (wiped DB / fresh install).
  // ``replace=true`` (revert-to-last-save, #160): the project's child
  // collections are wiped before the insert so the project ends up
  // matching the bundle EXACTLY.
  restore: (
    id: string,
    body: ProjectBundleResponse,
    replace = false,
  ): Promise<ProjectRestoreResponse> =>
    post(`/projects/${id}/restore${replace ? '?replace=true' : ''}`, body),

  // Shallow-merge a patch into ``project.view_state``. Each TOP-LEVEL
  // key in ``patch`` replaces the same key in the existing dict;
  // siblings are untouched. ``null`` for a key removes it.
  patchViewState: (
    id: string,
    patchBody: Record<string, unknown>,
  ): Promise<ProjectResponse> =>
    patch(`/projects/${id}/view-state`, { patch: patchBody }),

  // Write the lumping snapshot to the project's ``staged`` slot — the
  // Fill-from-boreholes → Apply half of the two-stage model. Whole-value
  // replace; ``null`` clears the slot and is a stage action like any other.
  //
  // ``revision`` is the renderer's monotonic counter. The server rejects a
  // LOWER one with 409 (a stale writer would silently roll the map back);
  // an equal one is an idempotent retry; omitting it leaves the stored
  // counter untouched.
  stageLumping: (
    id: string,
    lumping: StratigraphyLumping | null,
    revision?: number,
  ): Promise<ProjectResponse> =>
    put(`/projects/${id}/stratigraphy-lumping/staged`, {
      lumping,
      ...(revision === undefined ? {} : { revision }),
    }),

  // Copy ``staged`` onto ``saved`` — the File → Save half. Never touches
  // the revision (that counter tracks Applies, not saves) and never clears
  // ``staged``, which is what makes ``staged === saved`` read as clean
  // immediately after a save.
  promoteLumping: (id: string): Promise<ProjectResponse> =>
    post(`/projects/${id}/stratigraphy-lumping/promote`),
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

}
