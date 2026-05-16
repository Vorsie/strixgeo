// Project lifecycle — dirty-flag computation, File menu wiring, close-flow
// dialogs, Save / Save As / Discard, and the OS window title / quit
// handshake.
//
// ``discardSessionImports`` depends on ``discardContacts`` and
// ``activeGeologicalModel``. Both are injected so the hook avoids reaching
// across architectural layers.

import { useCallback, useEffect, useState } from 'react'

import { api } from '../api/client'
import { log } from '../utils/log'

/** Shape of the active geological model (id only — enough for contact cleanup). */
interface ActiveModel {
  id: string
}

export interface UseProjectLifecycleResult {
  /** True when live project state differs from the last File → Save. */
  projectDirty: boolean
  // Dialog open/close state — consumed by the App render.
  newProjectOpen: boolean
  setNewProjectOpen: (open: boolean) => void
  metadataEditorOpen: boolean
  setMetadataEditorOpen: (open: boolean) => void
  closeConfirmOpen: boolean
  setCloseConfirmOpen: (open: boolean) => void
  unsavedDialogOpen: boolean
  unsavedSaving: boolean
  /** Commit metadata + clear session-imports sets. */
  saveProject: () => Promise<boolean>
  /** Roll back session imports without touching the DB rows. */
  discardSessionImports: () => void
  /** Close-project request (toolbar X / File → Close funnel) —
   *  checks dirty + source. */
  handleCloseProjectRequest: () => void
  /** "Save and close" branch from the unsaved-changes dialog. */
  handleUnsavedSave: () => Promise<void>
  /** "Discard" branch — rolls back + closes. */
  handleUnsavedDiscard: () => void
  /** "Cancel" branch — aborts the close / quit. */
  handleUnsavedCancel: () => void
}

/**
 * React hook that owns the project lifecycle: dirty-flag computation,
 * File-menu IPC wiring, close-flow dialogs (save-or-discard +
 * click-protection confirm), Save / Save As, Discard, and the OS window
 * title + quit handshake.
 *
 * ``saveProject`` persists metadata and clears session-import sets.
 * Surface rebuild is a separate explicit action ("Build 3D model" in
 * the Geology toolbar) and is NOT auto-fired on save.
 *
 * ``discardSessionImports`` removes session-imported IDs from the
 * manifest and DB-deletes any unsaved formation contacts (fire-and-
 * forget) so they do not reappear on the next project open.
 *
 * Parameters
 * ----------
 * project
 *     Active project.  ``null`` when no project is open.
 * metadataDirty
 *     ``true`` when live metadata differs from the last-saved snapshot.
 * sessionImportCptIds
 *     Session-level CPT import tracking set.
 * setSessionImportCptIds
 *     Setter for the CPT session-import set.
 * sessionImportBoreholeIds
 *     Session-level borehole import tracking set.
 * setSessionImportBoreholeIds
 *     Setter for the borehole session-import set.
 * sessionImportFormationIds
 *     Session-level formation import tracking set.
 * setSessionImportFormationIds
 *     Setter for the formation session-import set.
 * sessionImportSectionIds
 *     Session-level section import tracking set.
 * setSessionImportSectionIds
 *     Setter for the section session-import set.
 * sessionImportContactIds
 *     Session-level contact import tracking set.
 * setSessionImportContactIds
 *     Setter for the contact session-import set.
 * removeFromManifest
 *     From ``useProject`` — drops ids from the visible-set.
 * saveMetadata
 *     From ``useProject`` — commits live metadata to DB + .gmproj.
 * saveAsProject
 *     From ``useProject`` — duplicates the project at a new path.
 * closeProject
 *     From ``useProject`` — tears down the live project state.
 * pickAndOpenProject
 *     From ``useProject`` — open-dialog + load flow.
 * openProjectFile
 *     From ``useProject`` — load from a known path (Recent list).
 * discardContacts
 *     From ``useGeologicalModel`` — removes unsaved contacts from cache.
 * activeGeologicalModel
 *     From ``useGeologicalModel`` — needed for contact cleanup on discard.
 *
 * Returns
 * -------
 * UseProjectLifecycleResult
 *     Dirty flag, dialog state, and all action callbacks.
 */
export function useProjectLifecycle({
  project,
  metadataDirty,
  sessionImportCptIds,
  setSessionImportCptIds,
  sessionImportBoreholeIds,
  setSessionImportBoreholeIds,
  sessionImportFormationIds,
  setSessionImportFormationIds,
  sessionImportSectionIds,
  setSessionImportSectionIds,
  sessionImportContactIds,
  setSessionImportContactIds,
  removeFromManifest,
  saveMetadata,
  saveAsProject,
  closeProject,
  pickAndOpenProject,
  openProjectFile,
  discardContacts,
  activeGeologicalModel,
}: {
  project: { id: string; name: string } | null
  metadataDirty: boolean
  sessionImportCptIds: ReadonlySet<string>
  setSessionImportCptIds: (v: Set<string>) => void
  sessionImportBoreholeIds: ReadonlySet<string>
  setSessionImportBoreholeIds: (v: Set<string>) => void
  sessionImportFormationIds: ReadonlySet<string>
  setSessionImportFormationIds: (v: Set<string>) => void
  sessionImportSectionIds: ReadonlySet<string>
  setSessionImportSectionIds: (v: Set<string>) => void
  sessionImportContactIds: ReadonlySet<string>
  setSessionImportContactIds: (v: Set<string>) => void
  removeFromManifest: (kind: 'cpt' | 'borehole' | 'formation' | 'section', ids: Iterable<string>) => void
  saveMetadata: () => Promise<boolean>
  saveAsProject: () => Promise<void>
  closeProject: () => void
  pickAndOpenProject: () => Promise<{ outcome: 'opened' | 'cancelled' | 'error' }>
  openProjectFile: (path: string) => Promise<unknown>
  discardContacts: (ids: ReadonlySet<string>) => void
  activeGeologicalModel: ActiveModel | null
}): UseProjectLifecycleResult {
  // ---------------------------------------------------------------------------
  // Dialog state
  // ---------------------------------------------------------------------------

  const [newProjectOpen, setNewProjectOpen] = useState(false)
  const [metadataEditorOpen, setMetadataEditorOpen] = useState(false)

  // Close-flow state. Two dialogs guard the close action; only one is
  // ever visible at a time. ``unsavedSaving`` debounces the save-and-
  // close path so we can disable buttons while the API call is in flight.
  // ``unsavedDialogMode`` distinguishes "close just this project" from
  // "the OS window is being closed and the app needs to exit after we
  // settle the dirty state" — the latter funnels back through
  // ``window.electron.notifyQuitDecision`` after each branch resolves.
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false)
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false)
  const [unsavedSaving, setUnsavedSaving] = useState(false)
  const [unsavedDialogMode, setUnsavedDialogMode] = useState<'close-project' | 'quit-app'>(
    'close-project',
  )

  // ---------------------------------------------------------------------------
  // Dirty flag
  // ---------------------------------------------------------------------------

  const projectDirty =
    metadataDirty ||
    sessionImportCptIds.size > 0 ||
    sessionImportBoreholeIds.size > 0 ||
    sessionImportFormationIds.size > 0 ||
    sessionImportSectionIds.size > 0 ||
    sessionImportContactIds.size > 0

  // ---------------------------------------------------------------------------
  // Save / discard
  // ---------------------------------------------------------------------------

  // saveProject orchestration — commits metadata then clears every
  // session-imports set so the project lands clean. Failure of any
  // step leaves the dirty flag intact for retry.
  //
  // Surface rebuild is NOT auto-fired here. The user triggers it
  // explicitly via "Build 3D model" in the Geology toolbar (or the
  // Sections toolbar). Dedupe's auto-recompute is unaffected (it is
  // a build-shaped intent, not a File → Save concern).
  const saveProject = useCallback(async (): Promise<boolean> => {
    const ok = await saveMetadata()
    if (!ok) return false
    setSessionImportCptIds(new Set())
    setSessionImportBoreholeIds(new Set())
    setSessionImportFormationIds(new Set())
    setSessionImportSectionIds(new Set())
    setSessionImportContactIds(new Set())
    return true
  }, [
    saveMetadata,
    setSessionImportCptIds,
    setSessionImportBoreholeIds,
    setSessionImportFormationIds,
    setSessionImportSectionIds,
    setSessionImportContactIds,
  ])

  // Discard rollback — drops the session-imported IDs from the
  // manifest so they disappear from view. The DB rows stay (DOV
  // cache preserved per ``project_no_db_delete_on_rollback``) but
  // are no longer part of THIS project's manifest — equivalent to
  // "these imports were never saved" per the user's intent. Then
  // clears the session-imports tracking set.
  //
  // Old behaviour moved IDs into the project-local removed-set
  // (localStorage-persisted, surfaced with "N removed · restore
  // all"). That conflicted with the new "unsaved = lost" rule and
  // is gone — restore-all only applies to manually-hidden rows
  // from a saved project now.
  const discardSessionImports = useCallback(() => {
    removeFromManifest('cpt', sessionImportCptIds)
    removeFromManifest('borehole', sessionImportBoreholeIds)
    removeFromManifest('formation', sessionImportFormationIds)
    removeFromManifest('section', sessionImportSectionIds)
    setSessionImportCptIds(new Set())
    setSessionImportBoreholeIds(new Set())
    setSessionImportFormationIds(new Set())
    setSessionImportSectionIds(new Set())
    // Contacts aren't in the manifest (the geological_models bundle
    // walks contacts as opaque dicts). On discard, the session's
    // created contacts must be DB-deleted — otherwise the next
    // project open re-fetches them from /geology/.../contacts and
    // they reappear despite the "unsaved → lost" promise. Fire and
    // forget; an individual DELETE failure just leaves the row
    // orphaned in the DB (acceptable trade-off vs. a blocking
    // discard).
    if (project && activeGeologicalModel && sessionImportContactIds.size > 0) {
      const projectId = project.id
      const modelId = activeGeologicalModel.id
      const idsToDelete = Array.from(sessionImportContactIds)
      for (const contactId of idsToDelete) {
        void api.geology
          .deleteContact(projectId, modelId, contactId)
          .catch(err =>
            log.error('geology', `discard deleteContact failed id=${contactId}`, err),
          )
      }
      discardContacts(sessionImportContactIds)
    }
    setSessionImportContactIds(new Set())
  }, [
    sessionImportCptIds,
    sessionImportBoreholeIds,
    sessionImportFormationIds,
    sessionImportSectionIds,
    sessionImportContactIds,
    removeFromManifest,
    setSessionImportCptIds,
    setSessionImportBoreholeIds,
    setSessionImportFormationIds,
    setSessionImportSectionIds,
    setSessionImportContactIds,
    project,
    activeGeologicalModel,
    discardContacts,
  ])

  // ---------------------------------------------------------------------------
  // Close-flow handlers
  // ---------------------------------------------------------------------------

  // Single entry point for every "close this project" trigger. Branches
  // on (a) whether the live project differs from the last-saved snapshot,
  // and (b) which surface fired the request:
  //
  //   * Dirty (unsaved live edits) → save-or-discard prompt
  //   * Clean + Sidebar X → click-protection confirm (mis-click guard)
  //   * Clean + File menu / Ctrl+W → close immediately (explicit intent)
  const attemptClose = useCallback(
    (source: 'sidebar' | 'menu') => {
      if (projectDirty) {
        // In-app close paths use the close-project mode; the OS-X close
        // path overrides this back to 'quit-app' before opening the
        // dialog (see the ``onAppBeforeQuit`` effect below).
        setUnsavedDialogMode('close-project')
        setUnsavedDialogOpen(true)
        return
      }
      if (source === 'sidebar') {
        setCloseConfirmOpen(true)
        return
      }
      closeProject()
    },
    [projectDirty, closeProject],
  )

  // File menu / Ctrl+W shortcut path — explicit intent, so skip the
  // click-protection confirm. The dirty check still runs.
  const handleMenuProjectClose = useCallback(() => {
    attemptClose('menu')
  }, [attemptClose])

  // Toolbar X / close-project path — mis-click protection in addition
  // to the dirty check. The 'sidebar' source tag is an internal
  // close-origin enum kept stable for attemptClose's logging; only the
  // public handler name changed (debt #12 R2).
  const handleCloseProjectRequest = useCallback(() => {
    attemptClose('sidebar')
  }, [attemptClose])

  // "Save and close" from the unsaved-drafts dialog: commit the live
  // project to the DB + .gmproj file, then close on success. On failure
  // we keep the prompt open so the user can retry (the live state stays
  // intact regardless). When the dialog was opened in ``quit-app`` mode
  // (OS-X close), notify the main process so it can finish exiting.
  const handleUnsavedSave = useCallback(async () => {
    setUnsavedSaving(true)
    try {
      const ok = await saveProject()
      if (!ok) return
      setUnsavedDialogOpen(false)
      setMetadataEditorOpen(false)
      if (unsavedDialogMode === 'quit-app') {
        void window.electron.notifyQuitDecision(true)
      } else {
        closeProject()
      }
    } finally {
      setUnsavedSaving(false)
    }
  }, [saveProject, closeProject, unsavedDialogMode])

  // Discard: drop in-memory metadata edits + roll back session imports
  // (move them into the project-local removed set so DB rows stay put
  // for fast re-import) + close. The .gmproj file is untouched on disk;
  // reopening the file restores the saved state.
  const handleUnsavedDiscard = useCallback(() => {
    setUnsavedDialogOpen(false)
    setMetadataEditorOpen(false)
    discardSessionImports()
    if (unsavedDialogMode === 'quit-app') {
      void window.electron.notifyQuitDecision(true)
    } else {
      closeProject()
    }
  }, [discardSessionImports, closeProject, unsavedDialogMode])

  // Cancel from the unsaved-drafts dialog. In quit-app mode that means
  // 'don't exit the app'; we tell main to abort the close.
  const handleUnsavedCancel = useCallback(() => {
    setUnsavedDialogOpen(false)
    if (unsavedDialogMode === 'quit-app') {
      void window.electron.notifyQuitDecision(false)
    }
  }, [unsavedDialogMode])

  // ---------------------------------------------------------------------------
  // File menu IPC + quit handshake
  // ---------------------------------------------------------------------------

  const handleMenuProjectNew = useCallback(() => {
    setNewProjectOpen(true)
  }, [])

  const handleMenuProjectOpen = useCallback(async () => {
    await pickAndOpenProject()
  }, [pickAndOpenProject])

  const handleMenuProjectOpenRecent = useCallback(
    async (path: string) => {
      await openProjectFile(path)
    },
    [openProjectFile],
  )

  // File menu Save / Ctrl+S — soft no-op when clean, commit when dirty.
  const handleMenuProjectSave = useCallback(async () => {
    await saveProject()
  }, [saveProject])

  // File menu Save As / Ctrl+Shift+S — duplicates the project (DB rows
  // + new .gmproj at a user-chosen path) and switches the live view to
  // the new copy. The source stays intact. No-ops when no project is
  // loaded (the menu item is enabled regardless but a single guard
  // here covers the keyboard-shortcut path too).
  const handleMenuProjectSaveAs = useCallback(async () => {
    if (project === null) return
    await saveAsProject()
  }, [project, saveAsProject])

  useEffect(() => {
    const offs = [
      window.electron.onMenuProjectNew(handleMenuProjectNew),
      window.electron.onMenuProjectOpen(() => void handleMenuProjectOpen()),
      window.electron.onMenuProjectOpenRecent(path => void handleMenuProjectOpenRecent(path)),
      window.electron.onMenuProjectSave(() => void handleMenuProjectSave()),
      window.electron.onMenuProjectSaveAs(() => void handleMenuProjectSaveAs()),
      window.electron.onMenuProjectClose(handleMenuProjectClose),
    ]
    return () => offs.forEach(off => off())
  }, [
    handleMenuProjectNew,
    handleMenuProjectOpen,
    handleMenuProjectOpenRecent,
    handleMenuProjectSave,
    handleMenuProjectSaveAs,
    handleMenuProjectClose,
  ])

  // OS window-close handshake. Main fires ``app:before-quit`` when the
  // user clicks the OS X (or Alt+F4). We consult the project state:
  // clean → tell main it's OK to quit; dirty → show the save-or-discard
  // prompt in quit-app mode and let the handlers above signal back.
  useEffect(() => {
    const off = window.electron.onAppBeforeQuit(() => {
      if (project === null || !projectDirty) {
        void window.electron.notifyQuitDecision(true)
        return
      }
      setUnsavedDialogMode('quit-app')
      setUnsavedDialogOpen(true)
    })
    return off
  }, [project, projectDirty])

  // ---------------------------------------------------------------------------
  // Window title
  // ---------------------------------------------------------------------------

  // Mirror the live project state into the OS window title. Title shows
  // 'Strix — Site A *' when dirty (Word / Plaxis convention).
  // Falls back to the bare app title when no project is loaded.
  //
  // Deps narrowed to the two scalars the title actually shows. Depending
  // on the whole ``project`` object would spam the IPC every time
  // applyMetadataDraft replaces the live state object (most keystrokes
  // committed via the editor's Save), even though the title content
  // hasn't changed.
  const projectName = project?.name ?? null
  useEffect(() => {
    if (projectName === null) {
      void window.electron.setWindowTitle(null)
      return
    }
    const dirtyMark = projectDirty ? ' *' : ''
    void window.electron.setWindowTitle(`Strix — ${projectName}${dirtyMark}`)
  }, [projectName, projectDirty])

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    projectDirty,
    newProjectOpen,
    setNewProjectOpen,
    metadataEditorOpen,
    setMetadataEditorOpen,
    closeConfirmOpen,
    setCloseConfirmOpen,
    unsavedDialogOpen,
    unsavedSaving,
    saveProject,
    discardSessionImports,
    handleCloseProjectRequest,
    handleUnsavedSave,
    handleUnsavedDiscard,
    handleUnsavedCancel,
  }
}
