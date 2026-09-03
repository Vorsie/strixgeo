// .gmproj file format helpers — parse / build / validate the JSON payload
// that lives on disk alongside the project's data in the local DB.
//
// File layout (format_version = 3): bundles project metadata + the full
// data tree + every per-project engineering decision. The file is the
// user's anchor — opening it must always succeed and bring everything
// back, even after a DB wipe.
//
//   {
//     "format_version": 3,
//     "project":  { id, name, ...metadata, view_state },
//     "cpts":                  [ ...full CPT + series payload per row ],
//     "boreholes":             [ ...full borehole tree per row ],
//     "geological_formations": [ ... ],
//     "geological_models":     [ { ...model, contacts: [...] } ],
//     "cross_sections":        [ ... ],
//     "investigation_reviews": [ ...per-(project, investigation) decisions ],
//     "body_geometry_facts":   [ ...observed layer-pair body unions ]
//   }
//
// Adding a collection here is ADDITIVE and does not bump the version, but it
// takes four edits in this file (interface / buildProjectFile / isProjectFileV3
// / parseProjectFile) plus ``restorePayloadFrom`` in hooks/useProject.ts.
// ``buildProjectFile`` is a hand-written whitelist — it silently drops any
// bundle key it does not name, which is how ``body_geometry_facts`` went
// missing between 2026-08-12 and 2026-08-15.
//
// Every per-project decision lives here, never in localStorage. See
// memory/project_decisions_in_bundle.md.
//
// v1 (legacy metadata-only) and v2 (CPTs + boreholes + geology +
// sections) were dev-only and have been removed. Opening a pre-v3 file
// fails — the caller surfaces a "re-save from a current build" message.
//
// The bundle's per-row shape mirrors the backend's
// ``GET /projects/{id}/bundle`` response 1:1; the renderer never
// inspects individual columns, just round-trips the dicts.
//
// ON-DISK ENCODING (2026-09-01). This module still produces / consumes PLAIN
// JSON — ``serialiseProjectFile`` returns a JSON string, ``parseProjectFile``
// takes one. The BINARY container is a separate concern living entirely in the
// main process: ``project:write-file`` wraps this JSON in the ``STRIXB1``
// container (gzip + seeded keystream) and ``project:read-file`` unwraps it back
// to JSON before the renderer ever sees it (desktop/src/main/strixCodec.ts).
// ``format_version`` here (3) describes the JSON payload INSIDE the container
// and is independent of the container's own codec version — the container is
// opacity around the bundle, not a change to it. Legacy plain-JSON files still
// open: the decoder sniffs a leading ``{`` and returns them verbatim.

import type { ProjectBundleResponse, ProjectResponse } from '../api/client'

// Bump this when the file shape changes in a backwards-incompatible way.
export const PROJECT_FILE_FORMAT_VERSION = 3

// Stable discriminator for a file whose inner bundle ``format_version`` is
// NEWER than this build supports — see ``newerBundleFormatVersion``. A sibling
// to the container-level ``strix-*`` codes from strixCodec.ts; the open flow
// branches on this to show a "saved by a newer build" message instead of the
// generic "may be corrupt" banner (production-readiness audit L4).
export const BUNDLE_NEWER_FORMAT_CODE = 'bundle-newer-format'

/**
 * Why a project file could not be decoded, as surfaced by the main-process
 * ``project:read-file`` IPC.
 *
 * The renderer-side mirror of ``StrixReadFailure`` in
 * ``desktop/src/main/strixCodec.ts`` (duplicated across the main/renderer
 * boundary by convention — neither side imports the other). ``code`` is the
 * stable discriminator (``'strix-corrupt'`` / ``'strix-truncated'`` /
 * ``'strix-unknown-format'``); ``message`` is the user-honest text to show.
 */
export interface StrixReadFailureReason {
  code: string
  message: string
}

/** The discriminated result of reading a project file across the IPC boundary. */
export type ProjectFileReadResult =
  | { ok: true; json: string }
  | { ok: false; reason: StrixReadFailureReason }

/**
 * Manual lumping snapshot stored in the bundle.
 *
 * Mirrors the backend ``StratigraphyLumping`` Pydantic model.  Nullable at
 * the top level — bundles saved before this field existed carry ``null``.
 * The field is metadata only: on restore the map is stored as-is and NEVER
 * re-applied (formations + contacts in the bundle are the applied result).
 * The dialog pre-populates from this map when the user next opens Fill from
 * boreholes on this project.
 */
export interface StratigraphyLumping {
  /** Always 1 for this shape. Reserved for future additive evolution. */
  schema_version: 1
  /** ISO-8601 UTC timestamp of the last Apply that produced this map. */
  applied_at: string
  /** ``{ normalised_candidate_key: target_formation_name }`` */
  map: Record<string, string>
}

// v3 — the only supported version. Mirrors the backend bundle response;
// every nested dict is opaque to the renderer.
export interface ProjectFileV3 {
  format_version: 3
  project: Record<string, unknown>
  cpts: Record<string, unknown>[]
  boreholes: Record<string, unknown>[]
  geological_formations: Record<string, unknown>[]
  geological_models: Record<string, unknown>[]
  cross_sections: Record<string, unknown>[]
  investigation_reviews: Record<string, unknown>[]
  // Contact-level correlation edges (#133 Phase 2+3).
  litho_contact_correlation_edges: Record<string, unknown>[]
  /**
   * Body (litho lens) metadata rows (slice 4.1 rename from litho_lenses).
   * Absent in files saved before this field shipped — normalised to [] on parse.
   */
  bodies: Record<string, unknown>[]
  /**
   * Formation absence records (Position 4).
   * Absent in files saved before this field shipped — normalised to [] on parse.
   */
  formation_absences: Record<string, unknown>[]
  /**
   * Body boundary shapes + control nodes (#163f Slice 2).
   * Absent in files saved before this field shipped — normalised to [] on parse.
   */
  body_boundary_shapes: Record<string, unknown>[]
  body_boundary_nodes: Record<string, unknown>[]
  /**
   * Geometric body-identity facts — the observed layer-pair adjacencies the
   * body resolver unions with the correlation ties (owner ruling 2026-08-12:
   * "every same litho that is connected should get the same body id").
   *
   * These are EVIDENCE, not a rebuildable cache like ``litho_solids``: a file
   * without them reopens with every geometric body union undone, and nothing
   * says so. Absent in files saved before this field shipped — normalised to
   * [] on parse, which is honestly "no merges recorded".
   */
  body_geometry_facts: Record<string, unknown>[]
  /**
   * Deleted-tie tombstones (owner 2026-08-17: "a tie i delete stays
   * deleted"). EVIDENCE like the geometry facts: a file without them reopens
   * with every deletion forgotten, and the next derivation resurrects the
   * deleted ties. Absent in files saved before this field shipped —
   * normalised to [] on parse (audit P1-1, 2026-08-18).
   */
  geotech_tie_tombstones: Record<string, unknown>[]
  /**
   * Body separations (debt #278 R5): the "these two are NOT the same body"
   * cannot-link constraints. EVIDENCE like the geometry facts + tombstones: a
   * file without them reopens with every split body re-merged on the next
   * resolve. Absent in files saved before this field shipped — normalised to []
   * on parse.
   */
  body_separations: Record<string, unknown>[]
  /**
   * Body unions (debt #278, the "Join with…" verb): the "these two ARE the same
   * body" must-link constraints. EVIDENCE like the separations above: a file
   * without them reopens with every joined body re-split on the next resolve.
   * Absent in files saved before this field shipped — normalised to [] on parse.
   */
  body_unions: Record<string, unknown>[]
  /**
   * Manual lumping map from the last successful Fill-from-boreholes confirm.
   * Null when no lumping has been applied to this project yet, or when the
   * file was saved by an older build that pre-dates this field.
   * Absence on parse is normalised to null (additive, backwards-compatible).
   */
  stratigraphy_lumping: StratigraphyLumping | null
}

export type ProjectFile = ProjectFileV3

// Build a v3 file payload from the live API bundle response. The bundle
// already carries the project metadata + every child row in the exact
// shape the backend's restore endpoint accepts on the way back, so we
// just store it verbatim with the format tag.
export function buildProjectFile(
  bundle: ProjectBundleResponse,
  stratigraphyLumping?: StratigraphyLumping | null,
): ProjectFileV3 {
  return {
    format_version: PROJECT_FILE_FORMAT_VERSION,
    project: bundle.project,
    cpts: bundle.cpts,
    boreholes: bundle.boreholes,
    geological_formations: bundle.geological_formations ?? [],
    geological_models: bundle.geological_models ?? [],
    cross_sections: bundle.cross_sections ?? [],
    investigation_reviews: bundle.investigation_reviews ?? [],
    litho_contact_correlation_edges: bundle.litho_contact_correlation_edges ?? [],
    bodies: bundle.bodies ?? [],
    formation_absences: bundle.formation_absences ?? [],
    body_boundary_shapes: bundle.body_boundary_shapes ?? [],
    body_boundary_nodes: bundle.body_boundary_nodes ?? [],
    body_geometry_facts: bundle.body_geometry_facts ?? [],
    geotech_tie_tombstones: bundle.geotech_tie_tombstones ?? [],
    body_separations: bundle.body_separations ?? [],
    body_unions: bundle.body_unions ?? [],
    // WHY parameter-not-bundle: the bundle response comes from GET /bundle
    // which has no knowledge of the lumping map (it lives client-side after
    // the Fill-from-boreholes confirm).  The caller passes the map explicitly
    // so it can be written atomically into the file at save time.
    stratigraphy_lumping: stratigraphyLumping ?? null,
  }
}

// Pretty-print the file payload. Two-space indent + trailing newline so
// the file looks reasonable when opened in an editor / diffed in git.
// Big projects produce big files — JSON arrays of 10k-row series add
// up — but the format stays human-inspectable, which the team values.
export function serialiseProjectFile(payload: ProjectFileV3): string {
  return JSON.stringify(payload, null, 2) + '\n'
}

// Validate + parse a string read from disk. Returns ``null`` when the
// payload isn't a valid v3 .gmproj — corrupt JSON, missing fields, or a
// pre-v3 file. Callers surface the failure as "re-save from a current
// build" since v1/v2 were dev-only and never escaped.
export function parseProjectFile(raw: string): ProjectFileV3 | null {
  let candidate: unknown
  try {
    candidate = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isProjectFileV3(candidate)) return null
  // Backfill arrays added after the v3 floor was sealed so the parsed
  // result always matches the interface contract — older files saved
  // before the field landed would otherwise carry ``undefined`` for
  // these keys and crash downstream array consumers.
  if (candidate.litho_contact_correlation_edges === undefined) {
    candidate.litho_contact_correlation_edges = []
  }
  if (candidate.bodies === undefined) {
    candidate.bodies = []
  }
  if (candidate.formation_absences === undefined) {
    candidate.formation_absences = []
  }
  if (candidate.body_boundary_shapes === undefined) {
    candidate.body_boundary_shapes = []
  }
  if (candidate.body_boundary_nodes === undefined) {
    candidate.body_boundary_nodes = []
  }
  if (candidate.body_geometry_facts === undefined) {
    candidate.body_geometry_facts = []
  }
  if (candidate.geotech_tie_tombstones === undefined) {
    candidate.geotech_tie_tombstones = []
  }
  if (candidate.body_separations === undefined) {
    candidate.body_separations = []
  }
  if (candidate.body_unions === undefined) {
    candidate.body_unions = []
  }
  // Normalise the optional lumping field: absent in older files → null.
  // WHY normalise-not-reject: this field is additive (backwards-compat
  // suspended pre-ship; additive always fine).  Absence means "no lumping
  // has been applied" — treated as null by the dialog's pre-populate logic.
  if (candidate.stratigraphy_lumping === undefined) {
    candidate.stratigraphy_lumping = null
  }
  return candidate
}

// Classify a rejected file as "saved by a NEWER build" vs plain corruption.
// Returns the numeric ``format_version`` when the raw JSON is an object whose
// version is a number GREATER than this build's supported floor; otherwise
// ``null`` (corrupt JSON, a non-object, a missing/non-numeric version, or an
// older/equal version — all of which are the ordinary "corrupt" path). Pure and
// i18n-free: the caller turns a non-null result into a typed, translated
// "update StrixGeo" reason. Split from ``parseProjectFile`` (which stays a
// boolean-ish "is this openable") so the open flow can tell the two apart
// without re-parsing (production-readiness audit L4).
export function newerBundleFormatVersion(raw: string): number | null {
  let candidate: unknown
  try {
    candidate = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    return null
  }
  const version = (candidate as Record<string, unknown>).format_version
  if (typeof version !== 'number' || version <= PROJECT_FILE_FORMAT_VERSION) {
    return null
  }
  return version
}

function isProjectFileV3(value: unknown): value is ProjectFileV3 {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.format_version === 3 &&
    typeof v.project === 'object' &&
    v.project !== null &&
    // typeof [] === 'object' — without this an array-shaped project block
    // slips past the gatekeeper and only fails later in projectIdFromFile.
    !Array.isArray(v.project) &&
    Array.isArray(v.cpts) &&
    Array.isArray(v.boreholes) &&
    Array.isArray(v.geological_formations) &&
    Array.isArray(v.geological_models) &&
    Array.isArray(v.cross_sections) &&
    Array.isArray(v.investigation_reviews) &&
    // Additive fields — tolerate absence in older files; normalised to []
    // in parseProjectFile.
    (v.litho_contact_correlation_edges === undefined ||
      Array.isArray(v.litho_contact_correlation_edges)) &&
    (v.bodies === undefined || Array.isArray(v.bodies)) &&
    (v.formation_absences === undefined || Array.isArray(v.formation_absences)) &&
    (v.body_boundary_shapes === undefined || Array.isArray(v.body_boundary_shapes)) &&
    (v.body_boundary_nodes === undefined || Array.isArray(v.body_boundary_nodes)) &&
    (v.body_geometry_facts === undefined || Array.isArray(v.body_geometry_facts)) &&
    (v.geotech_tie_tombstones === undefined || Array.isArray(v.geotech_tie_tombstones)) &&
    (v.body_separations === undefined || Array.isArray(v.body_separations)) &&
    (v.body_unions === undefined || Array.isArray(v.body_unions)) &&
    // ``stratigraphy_lumping`` is additive (2026-05-17). Tolerate absent
    // (pre-this-build files) or null (no lumping applied) or a
    // StratigraphyLumping object. Any other type → reject the file.
    (v.stratigraphy_lumping === undefined ||
      v.stratigraphy_lumping === null ||
      (typeof v.stratigraphy_lumping === 'object' &&
        v.stratigraphy_lumping !== null &&
        (v.stratigraphy_lumping as Record<string, unknown>).schema_version === 1))
  )
}

// Convenience helper: pull the id from the file's project block. The id
// is the .gmproj's anchor — every other field is either negotiable on
// restore or transient.
export function projectIdFromFile(file: ProjectFileV3): string {
  const id = file.project.id
  if (typeof id !== 'string') {
    throw new Error('Project file is missing a string id under "project.id"')
  }
  return id
}

// Convenience helper for the live ``ProjectResponse`` shape — used by
// the metadata editor when we just want a ProjectResponse-like dict
// to feed into the welcome screen / sidebar without a fresh API call.
export function projectResponseFromFile(
  file: ProjectFileV3,
): Partial<ProjectResponse> {
  return file.project as Partial<ProjectResponse>
}

// File extension used in the open / save dialogs. Lower-case + no leading
// dot — Electron's ``FileFilter.extensions`` field expects this shape.
// New saves go to ``.strix``. The legacy extension ``.gmproj`` was
// the project's internal codename before the public rebrand; we
// continue to accept .gmproj files on open (see main-process open
// dialog filters) so users with existing files can keep working,
// but every Save / Save As writes the .strix extension going
// forward.
export const PROJECT_FILE_EXTENSION = 'strix'
export const LEGACY_PROJECT_FILE_EXTENSION = 'gmproj'

// Default suggested filename when saving a new project. Sanitised so the
// project name doesn't blow up the OS file picker (Windows forbids
// ``< > : " / \ | ? *``).
export function defaultProjectFileName(projectName: string): string {
  const safe = projectName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'project'
  return `${safe}.${PROJECT_FILE_EXTENSION}`
}
