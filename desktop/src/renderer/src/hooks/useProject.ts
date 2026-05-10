// File-aware project hook for the multi-project model.
//
// Holds the currently-open project's metadata + the path to its .gmproj
// file on disk. The DB is the live source of truth for metadata; the file
// mirrors it for portability.
//
// Lifecycle the hook exposes (see desktop/src/main/index.ts for the IPC
// surface and src/utils/projectFile.ts for the on-disk format):
//
//   newProject(metadata)        POST /projects + save-file dialog + write
//   openProjectFile(path?)      read file + GET /projects/{id}
//   updateMetadata(patch)       PATCH /projects/{id} + re-write file
//   archiveCurrent()            POST /projects/{id}/archive (closes locally)
//   closeProject()              forget current selection (file untouched)
//
// On launch the hook starts with no project loaded — the welcome screen
// drives the first interaction. This matches the engineering-app
// convention (Plaxis / AutoCAD / Photoshop all show a welcome / recent
// screen on launch rather than auto-opening the last file). Recent
// projects are surfaced from the main-process userData store; users
// click one to re-open.

import { useCallback, useState } from 'react'

import { api } from '../api/client'
import type { ProjectCreatePayload, ProjectResponse, ProjectUpdatePayload } from '../api/client'
import { log } from '../utils/log'
import {
  buildProjectFile,
  defaultProjectFileName,
  parseProjectFile,
  serialiseProjectFile,
} from '../utils/projectFile'

interface UseProjectState {
  project: ProjectResponse | null
  filePath: string | null
}

interface UseProjectActions {
  newProject: (metadata: ProjectCreatePayload) => Promise<ProjectResponse | null>
  openProjectFile: (filePath: string) => Promise<ProjectResponse | null>
  pickAndOpenProject: () => Promise<ProjectResponse | null>
  updateMetadata: (patch: ProjectUpdatePayload) => Promise<ProjectResponse | null>
  archiveCurrent: () => Promise<void>
  closeProject: () => void
}

export type UseProject = UseProjectState & UseProjectActions

export function useProject(): UseProject {
  const [project, setProject] = useState<ProjectResponse | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)

  // Adopt a project + path pair into both state and the recent-projects
  // list. Single helper so every entry point (new / open / open-recent)
  // funnels through the same side-effects.
  const adopt = useCallback(
    async (next: ProjectResponse, path: string): Promise<void> => {
      setProject(next)
      setFilePath(path)
      try {
        await window.electron.addRecentProject(path, next.name)
      } catch (err) {
        // Recent-list failure shouldn't block project use — log and move on.
        log.warn('project', 'addRecentProject failed', err)
      }
    },
    [],
  )

  const openProjectFile = useCallback(
    async (path: string): Promise<ProjectResponse | null> => {
      try {
        const raw = await window.electron.readProjectFile(path)
        const parsed = parseProjectFile(raw)
        if (parsed === null) {
          log.error('project', `unrecognisable .gmproj at ${path}`)
          return null
        }
        // The DB row is the live state; the file's metadata is just a
        // snapshot from the last write. Always re-fetch.
        const fresh = await api.project.get(parsed.id)
        await adopt(fresh, path)
        log.info('project', `opened ${fresh.name} from ${path}`)
        return fresh
      } catch (err) {
        log.error('project', `openProjectFile(${path}) failed`, err)
        return null
      }
    },
    [adopt],
  )

  const pickAndOpenProject = useCallback(async (): Promise<ProjectResponse | null> => {
    const path = await window.electron.showProjectOpenDialog()
    if (path === null) return null
    return openProjectFile(path)
  }, [openProjectFile])

  const newProject = useCallback(
    async (metadata: ProjectCreatePayload): Promise<ProjectResponse | null> => {
      // Step 1: API call first. Failing here means we never wrote a file
      // pointing at a non-existent DB row.
      const created = await api.project.create(metadata)

      // Step 2: ask the user where to save. Cancel = roll back the API
      // create by archiving the row (data isn't lost; the user can find
      // it later under "Open archived"). We don't hard-delete because
      // delete cascades aren't wired up and archiving is reversible.
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

      // Step 3: write the file. If this fails, archive the row for the
      // same reason as cancel.
      try {
        const payload = buildProjectFile(created)
        await window.electron.writeProjectFile(path, serialiseProjectFile(payload))
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

  const updateMetadata = useCallback(
    async (patch: ProjectUpdatePayload): Promise<ProjectResponse | null> => {
      if (project === null || filePath === null) return null
      try {
        const updated = await api.project.update(project.id, patch)
        setProject(updated)
        // Mirror to the file so the on-disk snapshot stays current. If the
        // file write fails we keep the in-memory state — the DB has the
        // truth and we'll retry on next save.
        try {
          const payload = buildProjectFile(updated)
          await window.electron.writeProjectFile(
            filePath,
            serialiseProjectFile(payload),
          )
        } catch (err) {
          log.warn('project', 'file write after metadata update failed', err)
        }
        return updated
      } catch (err) {
        log.error('project', 'updateMetadata failed', err)
        return null
      }
    },
    [project, filePath],
  )

  const archiveCurrent = useCallback(async (): Promise<void> => {
    if (project === null) return
    try {
      await api.project.archive(project.id)
      log.info('project', `archived ${project.id}`)
    } catch (err) {
      log.error('project', 'archive failed', err)
    }
    setProject(null)
    setFilePath(null)
  }, [project])

  const closeProject = useCallback((): void => {
    setProject(null)
    setFilePath(null)
  }, [])

  return {
    project,
    filePath,
    newProject,
    openProjectFile,
    pickAndOpenProject,
    updateMetadata,
    archiveCurrent,
    closeProject,
  }
}
