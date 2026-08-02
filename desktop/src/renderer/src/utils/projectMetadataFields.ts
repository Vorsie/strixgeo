// The project's user-editable metadata scalars, in ONE place.
//
// WHY this module exists: the same ten fields were enumerated by hand in
// ``useProject``'s ``projectsEqual`` / ``fullPatchFrom`` and in
// ``ProjectMetadataDialog``'s diff helpers, guarded only by a DRIFT WARNING
// comment. Crash recovery needs the list a fourth time — it carries the
// live-vs-saved metadata delta into the recovery file
// (docs/design/autosave-recovery.md §2, item 3) — so the list became a
// shared export instead of a fourth copy.
//
// Pure: no React, no API, no logging.

import type { ProjectResponse } from '../api/client'
import { arraysEqual } from './arrays'

/**
 * Every project field the user can edit, and therefore every field that
 * can be dirty. DB-side timestamps (``created_at`` / ``updated_at`` /
 * ``archived_at``), the id, ``view_state`` and the lumping columns are
 * deliberately absent: they are not part of the metadata draft.
 */
export const PROJECT_METADATA_FIELDS = [
  'name',
  'project_number',
  'client',
  'site_label',
  'description',
  'tags',
  'default_horizontal_epsg',
  'default_vertical_epsg',
  'phase',
  'status',
] as const

/** One member of {@link PROJECT_METADATA_FIELDS}. */
export type ProjectMetadataField = (typeof PROJECT_METADATA_FIELDS)[number]

/** The uncommitted part of a metadata edit — only the fields that differ. */
export type ProjectMetadataDraft = Partial<Pick<ProjectResponse, ProjectMetadataField>>

/**
 * Compare one metadata field across two projects.
 *
 * ``tags`` is the only non-scalar, so it is the only field that needs a
 * structural comparison; everything else is a string / number / null.
 *
 * @param field - The field to compare.
 * @param a - First project.
 * @param b - Second project.
 * @returns ``true`` when the two projects agree on that field.
 */
function fieldsEqual(
  field: ProjectMetadataField,
  a: ProjectResponse,
  b: ProjectResponse,
): boolean {
  if (field === 'tags') return arraysEqual(a.tags, b.tags)
  return a[field] === b[field]
}

/**
 * Whether two projects agree on every user-editable metadata field.
 *
 * @param a - First project.
 * @param b - Second project.
 * @returns ``true`` when no metadata field differs.
 */
export function projectMetadataEqual(a: ProjectResponse, b: ProjectResponse): boolean {
  return PROJECT_METADATA_FIELDS.every(field => fieldsEqual(field, a, b))
}

/**
 * The metadata delta a crash would destroy: live values that differ from
 * the last-saved snapshot.
 *
 * WHY only the delta: the whole point of item 3 in the design is that the
 * saved values are already durable (in the DB and in the ``.gmproj``), so
 * carrying them would bloat the recovery file without protecting anything.
 * A project with no saved snapshot at all has never been committed, so
 * every field is a draft.
 *
 * @param live - The in-memory project the editor sees, or ``null``.
 * @param saved - The last-saved snapshot, or ``null`` for a never-saved
 *   project.
 * @returns A patch holding only the differing fields; empty when the live
 *   project is clean or absent.
 */
export function projectMetadataDraftPatch(
  live: ProjectResponse | null,
  saved: ProjectResponse | null,
): ProjectMetadataDraft {
  const patch: ProjectMetadataDraft = {}
  if (live === null) return patch
  for (const field of PROJECT_METADATA_FIELDS) {
    if (saved !== null && fieldsEqual(field, live, saved)) continue
    // The index signature is erased by the ``Partial<Pick<...>>`` mapped
    // type, so a generic write needs one localised cast. The VALUE still
    // comes from a typed read, so the pair can never drift.
    ;(patch as Record<string, unknown>)[field] = live[field]
  }
  return patch
}
