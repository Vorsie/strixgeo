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
//     "geotechnical_units":    [ ...subdivision of formations (structure-only) ],
//     "geological_models":     [ { ...model, contacts: [...] } ],
//     "cross_sections":        [ ... ],
//     "investigation_reviews": [ ...per-(project, investigation) decisions ]
//   }
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

import type { ProjectBundleResponse, ProjectResponse } from '../api/client'

// Bump this when the file shape changes in a backwards-incompatible way.
export const PROJECT_FILE_FORMAT_VERSION = 3

// v3 — the only supported version. Mirrors the backend bundle response;
// every nested dict is opaque to the renderer.
export interface ProjectFileV3 {
  format_version: 3
  project: Record<string, unknown>
  cpts: Record<string, unknown>[]
  boreholes: Record<string, unknown>[]
  geological_formations: Record<string, unknown>[]
  geotechnical_units: Record<string, unknown>[]
  geological_models: Record<string, unknown>[]
  cross_sections: Record<string, unknown>[]
  investigation_reviews: Record<string, unknown>[]
}

export type ProjectFile = ProjectFileV3

// Build a v3 file payload from the live API bundle response. The bundle
// already carries the project metadata + every child row in the exact
// shape the backend's restore endpoint accepts on the way back, so we
// just store it verbatim with the format tag.
export function buildProjectFile(bundle: ProjectBundleResponse): ProjectFileV3 {
  return {
    format_version: PROJECT_FILE_FORMAT_VERSION,
    project: bundle.project,
    cpts: bundle.cpts,
    boreholes: bundle.boreholes,
    geological_formations: bundle.geological_formations ?? [],
    geotechnical_units: bundle.geotechnical_units ?? [],
    geological_models: bundle.geological_models ?? [],
    cross_sections: bundle.cross_sections ?? [],
    investigation_reviews: bundle.investigation_reviews ?? [],
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
  if (candidate.geotechnical_units === undefined) {
    candidate.geotechnical_units = []
  }
  return candidate
}

function isProjectFileV3(value: unknown): value is ProjectFileV3 {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.format_version === 3 &&
    typeof v.project === 'object' &&
    v.project !== null &&
    Array.isArray(v.cpts) &&
    Array.isArray(v.boreholes) &&
    Array.isArray(v.geological_formations) &&
    // ``geotechnical_units`` was added after the v3 floor was set; tolerate
    // its absence on read so projects saved before this build still open,
    // and normalise to an empty array in the parsed result. New saves
    // always emit the field.
    (v.geotechnical_units === undefined || Array.isArray(v.geotechnical_units)) &&
    Array.isArray(v.geological_models) &&
    Array.isArray(v.cross_sections) &&
    Array.isArray(v.investigation_reviews)
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
export const PROJECT_FILE_EXTENSION = 'gmproj'

// Default suggested filename when saving a new project. Sanitised so the
// project name doesn't blow up the OS file picker (Windows forbids
// ``< > : " / \ | ? *``).
export function defaultProjectFileName(projectName: string): string {
  const safe = projectName.replace(/[<>:"/\\|?*]/g, '_').trim() || 'project'
  return `${safe}.${PROJECT_FILE_EXTENSION}`
}
