// .gmproj file format helpers — parse / build / validate the JSON payload
// that lives on disk alongside the project's data in the local DB.
//
// File layout (format_version = 1):
//
//   {
//     "format_version": 1,
//     "id": "<uuid>",                    // canonical project id; matches DB row
//     "name": "Antwerp port — quay 7",
//     "project_number": "GEO-2026-042",
//     "client": "Port of Antwerp",
//     "site_label": "Quay 7",
//     "description": "Foundation investigation for new container terminal",
//     "tags": ["foundation", "marine"],
//     "default_horizontal_epsg": 31370,
//     "default_vertical_epsg": 5710,
//     "phase": "design",
//     "status": "active"
//   }
//
// The DB is the live source of truth for metadata; the file mirrors it for
// portability (the user emails a colleague the .gmproj path along with the
// understanding that the data needs to be on the colleague's machine — a
// proper "export project bundle" flow is future work).

import type { ProjectResponse } from '../api/client'

// Bump this when the file shape changes in a backwards-incompatible way.
// Older versions can be read by mapping their fields into the current shape
// (the loader returns ``null`` for now if format_version doesn't match).
export const PROJECT_FILE_FORMAT_VERSION = 1

// Disk-format type. Matches ``ProjectResponse`` exactly except for the
// timestamp fields (``created_at`` / ``updated_at`` / ``archived_at``) and
// ``project_number`` etc that the DB owns. We intentionally don't persist
// timestamps to the file — they live in the DB and round-trip on every
// open. Saving the file twice with no DB change leaves the file
// byte-identical, which is friendly to git/diff.
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

// Build a file payload from the live ``ProjectResponse`` (i.e. the DB-side
// representation). Callers always source from the API so the file never
// drifts from the latest metadata.
export function buildProjectFile(project: ProjectResponse): ProjectFileV1 {
  return {
    format_version: PROJECT_FILE_FORMAT_VERSION,
    id: project.id,
    name: project.name,
    project_number: project.project_number,
    client: project.client,
    site_label: project.site_label,
    description: project.description,
    tags: project.tags,
    default_horizontal_epsg: project.default_horizontal_epsg,
    default_vertical_epsg: project.default_vertical_epsg,
    phase: project.phase,
    status: project.status,
  }
}

// Pretty-print the file payload. Two-space indent + trailing newline so
// the file looks reasonable when opened in an editor / diffed in git.
export function serialiseProjectFile(payload: ProjectFileV1): string {
  return JSON.stringify(payload, null, 2) + '\n'
}

// Validate + parse a string read from disk. Returns ``null`` when the
// payload is unrecognisable (wrong version, missing required fields).
// Callers surface a friendly error and refuse to proceed — opening the
// wrong file shouldn't silently scribble over project state.
export function parseProjectFile(raw: string): ProjectFileV1 | null {
  let candidate: unknown
  try {
    candidate = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isProjectFileV1(candidate)) return null
  return candidate
}

function isProjectFileV1(value: unknown): value is ProjectFileV1 {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    v.format_version === PROJECT_FILE_FORMAT_VERSION &&
    typeof v.id === 'string' &&
    typeof v.name === 'string' &&
    Array.isArray(v.tags) &&
    v.tags.every(t => typeof t === 'string') &&
    typeof v.status === 'string'
  )
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
