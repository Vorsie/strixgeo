// File-aware project hook with two-stage save semantics.
//
// Two project states live side by side:
//
//   * ``project`` (a.k.a. live)   — what the UI displays + what the
//     metadata editor edits. Updated immediately by the editor's Save
//     button via ``applyMetadataDraft``.
//   * ``saved``                   — last-loaded-or-saved snapshot. Equal
//     to ``project`` whenever ``dirty === false``. Provides the
//     "previous saved state" the user can restore by closing the
//     project without saving and reopening from disk.
//
// ``saveProject()`` is the explicit commit: PATCHes the API and rewrites
// the .gmproj file, then aligns ``saved`` with ``project``. File →
// Save (Ctrl+S) and the "Save & close" path of the unsaved-changes
// dialog both call into it.
//
// Imports (CPT, borehole, lab data) deliberately stay out of this
// model — they commit to the DB at the moment of action because they
// represent explicit data ingestion, not field tweaks. Two-stage save
// applies to project metadata only.
//
// On launch the hook starts with no project loaded — the welcome
// screen drives the first interaction (Plaxis / AutoCAD / Photoshop
// pattern). Recent projects are surfaced from the main-process
// userData store; users click one to re-open.

import { useCallback, useMemo, useState } from 'react'

import { api } from '../api/client'
import type {
  ProjectCreatePayload,
  ProjectResponse,
  ProjectUpdatePayload,
} from '../api/client'
import { arraysEqual } from '../utils/arrays'
import { log } from '../utils/log'
import {
  buildProjectFile,
  defaultProjectFileName,
  parseProjectFile,
  projectIdFromFile,
  serialiseProjectFile,
} from '../utils/projectFile'

interface UseProjectState {
  /** Live in-memory project state — what the editor sees. */
  project: ProjectResponse | null
  /** Last-saved snapshot. Equal to ``project`` when ``dirty === false``. */
  saved: ProjectResponse | null
  /** ``true`` when ``project`` differs from ``saved``. */
  dirty: boolean
  /** Path to the .gmproj file on disk. */
  filePath: string | null
}

/** Tri-state outcome for picker-driven opens — lets the caller show
 * an error banner only when the failure is real (not just a cancelled
 * file dialog). */
export type PickAndOpenResult =
  | { outcome: 'opened'; project: ProjectResponse; path: string }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; path: string }

interface UseProjectActions {
  newProject: (metadata: ProjectCreatePayload) => Promise<ProjectResponse | null>
  openProjectFile: (filePath: string) => Promise<ProjectResponse | null>
  pickAndOpenProject: () => Promise<PickAndOpenResult>
  /** Apply an in-memory patch to ``project`` (no API call, no file write). */
  applyMetadataDraft: (patch: ProjectUpdatePayload) => void
  /** Commit ``project`` to the DB + .gmproj file. No-op silently when clean. */
  saveProject: () => Promise<boolean>
  /** Deep-duplicate the current project (DB + all CPTs/boreholes), write a
   * new .gmproj at a user-chosen path, and switch the hook to point at the
   * new project. Returns the duplicate on success, null on cancel/error. */
  saveAsProject: () => Promise<ProjectResponse | null>
  /** Revert ``project`` to ``saved`` (drop in-memory edits). */
  discardEdits: () => void
  archiveCurrent: () => Promise<void>
  closeProject: () => void
}

export type UseProject = UseProjectState & UseProjectActions

// Field-by-field equality for the metadata fields we treat as part of
// the dirty check. ``created_at`` / ``updated_at`` / ``archived_at`` are
// DB-side timestamps and not user-editable, so they don't participate.
//
// DRIFT WARNING: this function and ``fullPatchFrom`` below enumerate
// the same field list as ``ProjectMetadataDialog``'s ``toPatch`` /
// ``isDirty`` and ``utils/projectFile.ts``'s ``buildProjectFile``.
// Adding a field to ``ProjectResponse`` means: (1) include it here,
// (2) include it in fullPatchFrom, (3) include it in the editor's diff
// helpers, (4) include it in buildProjectFile. The compiler can't catch
// missing entries — silent dirty-tracking failures will result.
function projectsEqual(
  a: ProjectResponse | null,
  b: ProjectResponse | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.id !== b.id) return false
  if (a.name !== b.name) return false
  if (a.project_number !== b.project_number) return false
  if (a.client !== b.client) return false
  if (a.site_label !== b.site_label) return false
  if (a.description !== b.description) return false
  if (a.default_horizontal_epsg !== b.default_horizontal_epsg) return false
  if (a.default_vertical_epsg !== b.default_vertical_epsg) return false
  if (a.phase !== b.phase) return false
  if (a.status !== b.status) return false
  if (!arraysEqual(a.tags, b.tags)) return false
  return true
}

// Build a complete patch from a live project. Used when the user hits
// Save and the API expects a body — easiest to re-send everything the
// editor can change. The backend's PATCH semantics ignore identical
// values, so this is safe even if a field hasn't changed.
//
// See the DRIFT WARNING on ``projectsEqual`` above.
function fullPatchFrom(project: ProjectResponse): ProjectUpdatePayload {
  return {
    name: project.name,
    project_number: project.project_number,
    client: project.client,
    site_label: project.site_label,
    description: project.description,
    tags: project.tags,
    default_horizontal_epsg: project.default_horizontal_epsg,
    default_vertical_epsg: project.default_vertical_epsg,
    phase: (project.phase as ProjectUpdatePayload['phase']) ?? null,
    status: project.status as ProjectUpdatePayload['status'],
  }
}

export function useProject(): UseProject {
  const [project, setProject] = useState<ProjectResponse | null>(null)
  const [saved, setSaved] = useState<ProjectResponse | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)

  const dirty = useMemo(() => !projectsEqual(project, saved), [project, saved])

  // Adopt a project + path pair into both state slots and the recent-
  // projects list. Used by every entry point (new / open / open-recent)
  // and by saveProject after a successful commit.
  const adopt = useCallback(
    async (next: ProjectResponse, path: string): Promise<void> => {
      setProject(next)
      setSaved(next)
      setFilePath(path)
      try {
        await window.electron.addRecentProject(path, next.name)
      } catch (err) {
        log.warn('project', 'addRecentProject failed', err)
      }
    },
    [],
  )

  const openProjectFile = useCallback(
    async (path: string): Promise<ProjectResponse | null> => {
      let parsed: ReturnType<typeof parseProjectFile> = null
      let parsedId: string | null = null
      try {
        const raw = await window.electron.readProjectFile(path)
        parsed = parseProjectFile(raw)
        if (parsed === null) {
          log.error('project', `unrecognisable .gmproj at ${path}`)
          return null
        }
        parsedId = projectIdFromFile(parsed)
        // The DB row is the live source of truth when it exists. We
        // always GET first so any metadata edits made elsewhere (the
        // file is a stale snapshot) win over the file's copy.
        const fresh = await api.project.get(parsedId)
        await adopt(fresh, path)
        log.info('project', `opened ${fresh.name} from ${path}`)
        return fresh
      } catch (err) {
        // 404 ⇒ DB has lost the row (wiped DB / fresh install / row
        // pruned elsewhere). The file IS the user's anchor; rehydrate
        // the project + every CPT (with series) + every borehole
        // (with its full tree) from the bundle embedded in the file
        // so opening a .gmproj always brings the data back. Idempotent
        // server-side — existing rows are skipped, missing ones get
        // inserted with their original ids.
        if (
          parsed !== null &&
          parsedId !== null &&
          err instanceof Error &&
          err.message.includes('→ 404')
        ) {
          try {
            const restored = await api.project.restore(parsedId, {
              format_version: parsed.format_version,
              project: parsed.project,
              cpts: parsed.cpts,
              boreholes: parsed.boreholes,
            })
            await adopt(restored, path)
            log.info(
              'project',
              `restored ${restored.name} from ${path} ` +
                `(+${parsed.cpts.length} CPTs, +${parsed.boreholes.length} boreholes)`,
            )
            return restored
          } catch (restoreErr) {
            log.error('project', `restore failed for ${path}`, restoreErr)
            return null
          }
        }
        log.error('project', `openProjectFile(${path}) failed`, err)
        return null
      }
    },
    [adopt],
  )

  const pickAndOpenProject = useCallback(async (): Promise<PickAndOpenResult> => {
    const path = await window.electron.showProjectOpenDialog()
    if (path === null) return { outcome: 'cancelled' }
    const project = await openProjectFile(path)
    if (project === null) return { outcome: 'failed', path }
    return { outcome: 'opened', project, path }
  }, [openProjectFile])

  const newProject = useCallback(
    async (metadata: ProjectCreatePayload): Promise<ProjectResponse | null> => {
      const created = await api.project.create(metadata)
      const suggestedName = defaultProjectFileName(created.name)
      const path = await window.electron.showProjectSaveDialog(suggestedName)
      if (path === null) {
        try {
          await api.project.archive(created.id)
          log.info('project', `cancelled new-project flow, archived ${created.id}`)
        } catch (err) {
          log.warn('project', 'rollback-archive after cancel failed', err)
        }
        return null
      }
      try {
        // Fresh project has no data yet — the bundle is the metadata
        // plus empty cpts / boreholes arrays. One bundle GET is cheap
        // here even though we know it'll be empty: it keeps the file's
        // ``project`` dict shape identical to what the bundle endpoint
        // returns, so the round-trip stays symmetric.
        const bundle = await api.project.bundle(created.id)
        await window.electron.writeProjectFile(
          path,
          serialiseProjectFile(buildProjectFile(bundle)),
        )
      } catch (err) {
        log.error('project', `writeProjectFile failed, rolling back`, err)
        try {
          await api.project.archive(created.id)
        } catch (rollbackErr) {
          log.warn('project', 'rollback-archive after write failure failed', rollbackErr)
        }
        return null
      }
      await adopt(created, path)
      log.info('project', `created ${created.name} → ${path}`)
      return created
    },
    [adopt],
  )

  // Editor's Save button calls this. Spreading the patch keys onto the
  // current project replaces only the fields the user changed; the
  // ``saved`` snapshot stays untouched so ``dirty`` flips to true.
  const applyMetadataDraft = useCallback((patch: ProjectUpdatePayload): void => {
    setProject(prev => {
      if (prev === null) return prev
      // Cast: ProjectUpdatePayload's values are narrower than
      // ProjectResponse's (no id / timestamps), but every field present
      // is a valid override.
      return { ...prev, ...(patch as Partial<ProjectResponse>) }
    })
  }, [])

  // File → Save / Ctrl+S / "Save and close" all funnel here. Returns
  // ``true`` on success (or when the project is already clean — a
  // silent no-op), ``false`` on failure.
  const saveProject = useCallback(async (): Promise<boolean> => {
    if (project === null || filePath === null) return false
    if (!dirty) {
      // Already in sync. The Save action stays a soft no-op so the user
      // can hit Ctrl+S compulsively without surprises.
      return true
    }
    try {
      const patch = fullPatchFrom(project)
      const updated = await api.project.update(project.id, patch)
      try {
        // Fetch the full bundle (metadata + every CPT/series + every
        // borehole tree) and write it to disk. The file is the user's
        // anchor — re-opening it after a DB wipe must bring data back.
        // Save is a relatively rare, user-initiated action so the extra
        // round-trip and JSON-encoding cost (potentially MB for big
        // projects) is acceptable.
        const bundle = await api.project.bundle(project.id)
        await window.electron.writeProjectFile(
          filePath,
          serialiseProjectFile(buildProjectFile(bundle)),
        )
      } catch (err) {
        // File write failure leaves the DB ahead of the file. Log loudly
        // but treat as success — the next save will catch up, and the
        // DB is the source of truth.
        log.warn('project', 'file write after saveProject failed', err)
      }
      setProject(updated)
      setSaved(updated)
      log.success('project', `saved ${updated.name}`)
      return true
    } catch (err) {
      log.error('project', 'saveProject failed', err)
      return false
    }
  }, [project, filePath, dirty])

  // Revert in-memory changes back to the last-saved snapshot. Useful
  // for explicit "Revert" UX (not wired today) and as a building block
  // for the unsaved-changes dialog's Discard path.
  const discardEdits = useCallback((): void => {
    setProject(saved)
  }, [saved])

  // File → Save As. Asks the user for a new .gmproj path, derives the
  // project name from the chosen basename, POSTs to /projects/{id}/duplicate
  // (which deep-clones the project + every CPT/borehole tree under it),
  // writes a fresh .gmproj at the chosen path, and adopts the new
  // project as the live one. The source project stays untouched on
  // disk and in DB — only the live UI switches.
  //
  // Failure paths archive the freshly-duplicated DB row so we never
  // leave an orphan project pointing at no file (same convention as
  // the newProject rollback).
  const saveAsProject = useCallback(async (): Promise<ProjectResponse | null> => {
    if (project === null) return null

    const suggested = defaultProjectFileName(`Copy of ${project.name}`)
    const path = await window.electron.showProjectSaveDialog(suggested)
    if (path === null) return null

    // Derive the new project name from the chosen file's basename
    // (sans extension). Matches Word / Plaxis behaviour where Save As
    // implicitly names the artefact after the file the user typed.
    const basename = path.split(/[\\/]/).pop() ?? path
    const newName = basename.replace(/\.gmproj$/i, '') || 'Untitled'

    let duplicated: ProjectResponse
    try {
      duplicated = await api.project.duplicate(project.id, newName)
    } catch (err) {
      log.error('project', 'saveAsProject: duplicate failed', err)
      return null
    }

    try {
      // Save As writes a full bundle for the duplicate too — the
      // duplicated DB row already has its own CPTs / boreholes
      // (deep-cloned by ``POST /projects/{id}/duplicate``), so the
      // bundle endpoint returns everything we need.
      const bundle = await api.project.bundle(duplicated.id)
      await window.electron.writeProjectFile(
        path,
        serialiseProjectFile(buildProjectFile(bundle)),
      )
    } catch (err) {
      log.error('project', 'saveAsProject: writeProjectFile failed, rolling back', err)
      try {
        await api.project.archive(duplicated.id)
      } catch (rollbackErr) {
        log.warn(
          'project',
          'saveAsProject: rollback-archive after write failure failed',
          rollbackErr,
        )
      }
      return null
    }

    await adopt(duplicated, path)
    log.info('project', `saved-as ${duplicated.name} → ${path}`)
    return duplicated
  }, [project, adopt])

  const archiveCurrent = useCallback(async (): Promise<void> => {
    if (project === null) return
    try {
      await api.project.archive(project.id)
      log.info('project', `archived ${project.id}`)
    } catch (err) {
      log.error('project', 'archive failed', err)
    }
    setProject(null)
    setSaved(null)
    setFilePath(null)
  }, [project])

  const closeProject = useCallback((): void => {
    setProject(null)
    setSaved(null)
    setFilePath(null)
  }, [])

  return {
    project,
    saved,
    dirty,
    filePath,
    newProject,
    openProjectFile,
    pickAndOpenProject,
    applyMetadataDraft,
    saveProject,
    saveAsProject,
    discardEdits,
    archiveCurrent,
    closeProject,
  }
}
