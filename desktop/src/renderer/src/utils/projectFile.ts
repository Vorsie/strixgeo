// .gmproj file format helpers — parse / build / validate the JSON payload
// that lives on disk alongside the project's data in the local DB.
//
// File layout (format_version = 2): bundles the project metadata + the
// full data tree (every CPT with its series, every borehole with its
// child tree). The file is the user's anchor — opening it must always
// succeed and bring the data back, even after a DB wipe.
//
//   {
//     "format_version": 2,
//     "project":  { id, name, ...metadata },
//     "cpts":     [ ...full CPT + series payload per row ],
//     "boreholes":[ ...full borehole tree per row ]
//   }
//
// v1 files (metadata-only) are still readable for backwards compatibility
// — they parse with empty ``cpts`` / ``boreholes`` arrays, which means
// the user has to re-import their data once on open. v2 saves bring it
// all along.
//
// Note: the bundle's per-row shape mirrors the backend's
// ``GET /projects/{id}/bundle`` response 1:1; the renderer never
// inspects individual columns, just round-trips the dicts.

import type { ProjectBundleResponse, ProjectResponse } from '../api/client'

// Bump this when the file shape changes in a backwards-incompatible way.
// The parser accepts v1 (legacy metadata-only) and v2 (with bundle).
export const PROJECT_FILE_FORMAT_VERSION = 2

// v1 — legacy metadata-only files. Still readable; we map them into the
// v2 shape with empty cpts/boreholes on parse.
export interface ProjectFileV1 {
  format_version: 1
  id: string
  name: string
  project_number: string | null
  client: string | null
  site_label: string | null
  description: string | null
  tags: string[]
  default_horizontal_epsg: number | null
  default_vertical_epsg: number | null
  phase: string | null
  status: string
}

// v2 — bundles the full data tree alongside the metadata. The metadata
// fields nest under ``project`` to mirror the backend's bundle shape.
export interface ProjectFileV2 {
  format_version: 2
  // Mirrors ``GET /projects/{id}/bundle``. ``project`` carries every
  // metadata column of the project row (including its UUID id, which
  // takes precedence over any other id-bearing structure on save).
  // ``cpts`` and ``boreholes`` are opaque dicts the renderer never
  // inspects — it just persists them and POSTs them back on restore.
  project: Record<string, unknown>
  cpts: Record<string, unknown>[]
  boreholes: Record<string, unknown>[]
}

export type ProjectFile = ProjectFileV1 | ProjectFileV2

// Build a v2 file payload from the live API bundle response. The bundle
// already carries the project metadata + every child row in the exact
// shape the backend's restore endpoint accepts on the way back, so we
// just store it verbatim with the format tag.
export function buildProjectFile(bundle: ProjectBundleResponse): ProjectFileV2 {
  return {
    format_version: PROJECT_FILE_FORMAT_VERSION,
    project: bundle.project,
    cpts: bundle.cpts,
    boreholes: bundle.boreholes,
  }
}

// Pretty-print the file payload. Two-space indent + trailing newline so
// the file looks reasonable when opened in an editor / diffed in git.
// Big projects produce big files — JSON arrays of 10k-row series add
// up — but the format stays human-inspectable, which the team values.
export function serialiseProjectFile(payload: ProjectFileV2): string {
  return JSON.stringify(payload, null, 2) + '\n'
}

// Validate + parse a string read from disk. Returns ``null`` when the
// payload is unrecognisable (corrupt JSON, missing required fields).
// Accepts both v1 (legacy) and v2 — v1 is upgraded to v2 with empty
// data arrays so callers never have to branch on the version.
export function parseProjectFile(raw: string): ProjectFileV2 | null {
  let candidate: unknown
  try {
    candidate = JSON.parse(raw)
  } catch {
    return null
  }
  if (isProjectFileV2(candidate)) return candidate
  if (isProjectFileV1(candidate)) return upgradeV1(candidate)
  return null
}

function isProjectFileV2(value: unknown): value is ProjectFileV2 {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.format_version === 2 &&
    typeof v.project === 'object' &&
    v.project !== null &&
    Array.isArray(v.cpts) &&
    Array.isArray(v.boreholes)
  )
}

function isProjectFileV1(value: unknown): value is ProjectFileV1 {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.format_version === 1 &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.tags) &&
    v.tags.every(t => typeof t === 'string') &&
    typeof v.status === 'string'
  )
}

// Backwards-compat: a v1 file is metadata-only. Wrap it in the v2 shape
// with empty data arrays so downstream code only has to deal with one
// type. On restore, the user gets the project shell back but their
// data (CPTs / boreholes) won't reappear — they were never in the v1
// file. New saves always emit v2.
function upgradeV1(v1: ProjectFileV1): ProjectFileV2 {
  return {
    format_version: 2,
    project: {
      id: v1.id,
      name: v1.name,
      project_number: v1.project_number,
      client: v1.client,
      site_label: v1.site_label,
      description: v1.description,
      tags: v1.tags,
      default_horizontal_epsg: v1.default_horizontal_epsg,
      default_vertical_epsg: v1.default_vertical_epsg,
      phase: v1.phase,
      status: v1.status,
    },
    cpts: [],
    boreholes: [],
  }
}

// Convenience helper: pull the id from either v1 (top-level) or v2
// (``project.id``). The id is the .gmproj's anchor — every other field
// is either negotiable on restore or transient.
export function projectIdFromFile(file: ProjectFileV2): string {
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
  file: ProjectFileV2,
): Partial<ProjectResponse> {
  return file.project as Partial<ProjectResponse>
}

// File extension used in the open / save dialogs. Lower-case + no leading
// dot — Electron's ``FileFilter.extensions`` field expects this shape.
export const PROJECT_FILE_EXTENSION = 'gmproj'

// Default suggested filename when saving a new project. Sanitised so the
// project name doesn't blow up the OS file picker (Windows forbids
// ``< > : " / \ | ? *``).
export function defaultProjectFileName(projectName: string): string {
  const safe = projectName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'project'
  return `${safe}.${PROJECT_FILE_EXTENSION}`
}
