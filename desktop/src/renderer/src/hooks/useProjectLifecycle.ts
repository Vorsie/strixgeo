// Project lifecycle — dirty-flag computation, File menu wiring, close-flow
// dialogs, Save / Save As / Discard, and the OS window title / quit
// handshake.
//
// ``discardSessionImports`` depends on ``discardContacts`` and
// ``activeGeologicalModel``. Both are injected so the hook avoids reaching
// across architectural layers.

import { useCallback, useEffect, useMemo, useState } from 'react'

import { api } from '../api/client'
import type { ProjectResponse } from '../api/client'
import { log } from '../utils/log'
// Module-level t() reads the active language at call time — the right shape for
// a toast built inside a useCallback without threading a translator into deps.
import { t } from '../i18n/translate'
import { noteCloseFlow } from '../utils/closeFlowNote'
import { isProjectClosed } from '../utils/openProjectGuard'
import { isProjectOpenUnreadable } from './useProject'
import type {
  PickAndOpenResult,
  ProjectOpenUnreadable,
  RevertToLastSavedResult,
} from './useProject'
import type { StratigraphyLumping } from '../utils/projectFile'
import { buildUnsavedWorkSummary } from '../utils/unsavedWorkSummary'
import type { UnsavedWorkSummary } from '../utils/unsavedWorkSummary'
import {
  failedRevertMessage,
  failedSaveMessage,
  refusedRevertMessage,
} from '../utils/closeFlowMessages'

/** Shape of the active geological model (id only — enough for contact cleanup). */
interface ActiveModel {
  id: string
}

export interface UseProjectLifecycleResult {
  /** True when live project state differs from the last File → Save. */
  projectDirty: boolean
  /** Itemised view of ``projectDirty`` for the close-without-save dialog. */
  unsavedSummary: UnsavedWorkSummary
  // Dialog open/close state — consumed by the App render.
  newProjectOpen: boolean
  setNewProjectOpen: (open: boolean) => void
  metadataEditorOpen: boolean
  setMetadataEditorOpen: (open: boolean) => void
  closeConfirmOpen: boolean
  setCloseConfirmOpen: (open: boolean) => void
  unsavedDialogOpen: boolean
  unsavedSaving: boolean
  /**
   * User-facing reason the last close attempt did not go through, or null.
   *
   * Rendered inside the unsaved-changes dialog. A failed save and a refused
   * revert both LEAVE THE DIALOG OPEN, and an open dialog with no explanation
   * reads as an unresponsive button — the engineer clicks it again, gets the
   * same silence, and force-quits (audit 2026-08-02).
   */
  unsavedError: string | null
  /** Commit metadata + clear session-imports sets. */
  saveProject: () => Promise<boolean>
  /** Roll back session imports without touching the DB rows. */
  discardSessionImports: () => void
  /** Close-project request (toolbar X / File → Close funnel) —
   *  checks dirty + source. */
  handleCloseProjectRequest: () => void
  /** "Save and close" branch from the unsaved-changes dialog. */
  handleUnsavedSave: () => Promise<void>
  /** "Discard" branch — reverts the DB to the last save (replace-restore)
   *  or, for a never-saved project, deletes session creates; then closes. */
  handleUnsavedDiscard: () => Promise<void>
  /** "Cancel" branch — aborts the close / quit. */
  handleUnsavedCancel: () => void
  /**
   * The force-revert confirmation prompt is open (owner ruling, installer #26).
   * Opened when a Discard's revert is refused because the .strix on disk is not
   * this project's latest save — instead of dead-ending, the user is offered a
   * named, destructive replace-restore (or Save) so his session is never
   * trapped requiring Task Manager.
   */
  forceRevertPromptOpen: boolean
  /** The prompt body — names the file and spells out the loss, translated. */
  forceRevertMessage: string
  /** Force the replace-restore from the file (bypasses the anchor gate) + close. */
  handleForceRevertConfirm: () => Promise<void>
  /** Save-and-close from the force-revert prompt — the non-destructive way out. */
  handleForceRevertSave: () => Promise<void>
  /** Dismiss the force-revert prompt and abort the close entirely. */
  handleForceRevertCancel: () => void
  /**
   * Stage a lumping snapshot in-memory and mark the project dirty.
   * Called after a Fill-from-boreholes Apply confirm succeeds — the
   * lumping is persisted when the user File→Saves, and is lost on
   * close-without-save (two-stage save model parity).
   *
   * Parameters
   * ----------
   * lumping
   *     The lumping snapshot to stage.
   *
   * Returns
   * -------
   * void
   */
  stageLumping: (lumping: StratigraphyLumping) => void
  /**
   * In-memory mirror of the lumping snapshot last written via
   * ``stageLumping`` or seeded from the file on open.
   * Null when no lumping has been applied to this project yet.
   * Exposed here so ``GeologyToolbar`` (which reads the lifecycle
   * slice) can prefill ``FormationSelectionDialog`` without a
   * separate file read.
   */
  currentLumping: StratigraphyLumping | null
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
 * stageLumping
 *     From ``useProject`` — stages a lumping snapshot in-memory and marks
 *     the project dirty; threaded here so callers can access it through
 *     the lifecycle slice.
 * currentLumping
 *     From ``useProject`` — the in-memory lumping snapshot (null until the
 *     user applies a Fill-from-boreholes confirm with aliases).  Threaded
 *     through the lifecycle slice so ``GeologyToolbar`` can prefill the
 *     ``FormationSelectionDialog`` without a separate file read.
 * clearRecoveryNow
 *     From ``useRecoveryAutosave`` — cancels pending recovery writes and
 *     deletes the open project's recovery file.  Called on every decided
 *     exit (save / discard / close / quit) because the file's existence is
 *     what marks the previous session as crashed.
 * lastSaveWroteFile
 *     From ``useProject`` — whether the last save's ``.gmproj`` write
 *     succeeded.  The recovery clear is gated on this, not on the save's
 *     boolean result.
 * projectFilePath
 *     From ``useProject`` — the ``.strix`` path, or null for a never-saved
 *     project.  Names the file in the save-failed / revert-refused copy.
 * toast
 *     From ``useToasts`` — the only surface a failed Save or a refused
 *     Discard has.  Both used to end in a ``log.error`` the engineer
 *     never sees.
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
  stageLumping,
  currentLumping,
  hasUnsavedMutations,
  setHasUnsavedMutations,
  revertToLastSaved,
  hasSavedSnapshot,
  clearRecoveryNow,
  lastSaveWroteFile,
  projectFilePath,
  toast,
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
  // Source type from useProject — saveAsProject returns the newly-
  // saved project (or null on cancel/failure). The lifecycle hook
  // doesn't read the result; aligned with the source for tsc parity.
  saveAsProject: () => Promise<ProjectResponse | null>
  closeProject: () => void
  // Source type from useProject — `PickAndOpenResult` is the
  // discriminated union the openProjectFile flow returns.
  pickAndOpenProject: () => Promise<PickAndOpenResult>
  // 'file-missing' = the .strix is no longer at its saved location; the
  // menu path toasts it (a moved file must not fail into silence).
  // ``ProjectOpenUnreadable`` = a damaged / truncated / newer container, whose
  // specific reason the menu path also toasts.
  openProjectFile: (
    path: string,
  ) => Promise<ProjectResponse | 'file-missing' | ProjectOpenUnreadable | null>
  discardContacts: (ids: ReadonlySet<string>) => void
  activeGeologicalModel: ActiveModel | null
  stageLumping: (lumping: StratigraphyLumping) => void
  currentLumping: StratigraphyLumping | null
  // Two-stage save / dirty (#160). ``hasUnsavedMutations`` is true when a
  // geology mutation (depth drag, delete, batch) touched a pre-existing row
  // this session. It is OR'd into ``projectDirty`` and cleared via
  // ``setHasUnsavedMutations`` on save / discard. ``revertToLastSaved``
  // replace-restores the DB from the .gmproj file (returns false for a
  // never-saved project, where the caller deletes the session creates).
  hasUnsavedMutations: boolean
  setHasUnsavedMutations: (v: boolean) => void
  revertToLastSaved: (force?: boolean) => Promise<RevertToLastSavedResult>
  // True once the project has a .gmproj path. A never-saved project has no
  // snapshot to revert to, so Discard deletes the session creates instead —
  // the close dialog has to say which of the two it will do.
  hasSavedSnapshot: boolean
  // Crash recovery (docs/design/autosave-recovery.md §4). The recovery
  // file's EXISTENCE is the crash signal — there is no sentinel and no
  // heartbeat — so every DECIDED exit has to delete it, or the next launch
  // offers to restore work the user already committed or discarded.
  // From ``useRecoveryAutosave``: cancels the pending write timers and
  // deletes the open project's recovery file.
  clearRecoveryNow: () => Promise<void>
  // From ``useProject``: did the LAST save reach the .gmproj file?
  // ``saveMetadata`` swallows a file-write failure and returns true anyway
  // (defensible for the DB, wrong as a recovery signal), so the clear is
  // gated on this instead of on the return value.
  lastSaveWroteFile: () => boolean
  // From ``useProject``: the .strix path this project saves to, or null for a
  // never-saved project. Only used to NAME the file in failure copy — a save
  // that could not be written and a revert that was refused are both about a
  // specific file on disk, and "could not save" without the path is a message
  // the engineer cannot act on.
  projectFilePath: string | null
  // From ``useToasts``. Ref-stable (it reads a ref, not state), so it is
  // deliberately absent from the dep arrays below.
  toast: (type: 'success' | 'error' | 'warning', message: string) => void
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
  // Why the last Save / Discard did not close the project. Cleared whenever a
  // new attempt starts so a stale reason never sits under a fresh click.
  const [unsavedError, setUnsavedError] = useState<string | null>(null)
  // The force-revert confirmation prompt (owner ruling, installer #26
  // 2026-09-08). A refused revert — the .strix on disk is not this project's
  // latest save — used to dead-end with a toast and a re-opened dialog, so a
  // user who wanted his session GONE had no way out but Task Manager. This
  // opens instead: a named, destructive confirmation that replaces the DB from
  // the file regardless of the anchor, plus Save as the other way out.
  const [forceRevertPromptOpen, setForceRevertPromptOpen] = useState(false)

  // ---------------------------------------------------------------------------
  // Dirty flag
  // ---------------------------------------------------------------------------

  const projectDirty =
    metadataDirty ||
    hasUnsavedMutations ||
    sessionImportCptIds.size > 0 ||
    sessionImportBoreholeIds.size > 0 ||
    sessionImportFormationIds.size > 0 ||
    sessionImportSectionIds.size > 0 ||
    sessionImportContactIds.size > 0

  // The same seven sources, itemised — the close dialog names what a Discard
  // takes, and one OR'd boolean cannot carry that. Derivation lives in
  // utils/unsavedWorkSummary so this file does not grow it.
  const unsavedSummary = useMemo(
    () =>
      buildUnsavedWorkSummary({
        hasSavedSnapshot,
        sessionImportCptIds,
        sessionImportBoreholeIds,
        sessionImportFormationIds,
        sessionImportSectionIds,
        sessionImportContactIds,
        hasUnsavedMutations,
        metadataDirty,
      }),
    [
      hasSavedSnapshot,
      sessionImportCptIds,
      sessionImportBoreholeIds,
      sessionImportFormationIds,
      sessionImportSectionIds,
      sessionImportContactIds,
      hasUnsavedMutations,
      metadataDirty,
    ],
  )

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
  // Empty every session-import tracking set. Shared by saveProject (commit
  // → clean) and the revert branch of handleUnsavedDiscard (replace-restore
  // already wiped the created rows; just clear the tracking so the next open
  // starts clean). Does NOT touch the DB — see discardSessionImports for the
  // never-saved path that DB-deletes the session creates.
  const resetSessionImportSets = useCallback(() => {
    setSessionImportCptIds(new Set())
    setSessionImportBoreholeIds(new Set())
    setSessionImportFormationIds(new Set())
    setSessionImportSectionIds(new Set())
    setSessionImportContactIds(new Set())
  }, [
    setSessionImportCptIds,
    setSessionImportBoreholeIds,
    setSessionImportFormationIds,
    setSessionImportSectionIds,
    setSessionImportContactIds,
  ])

  const saveProject = useCallback(async (): Promise<boolean> => {
    setUnsavedError(null)
    const requestedFor = project?.id ?? null
    const ok = await saveMetadata()
    // The project this save was requested for closed while it ran (the save
    // itself logged "save of <name> abandoned: project closed"). Everything
    // below acts on the OPEN project's session sets, mutations flag, recovery
    // file and error banner, which now belong to the next project: none of it
    // may run on the strength of the closed project's save, and an abandon is
    // not a failure to show.
    if (requestedFor !== null && isProjectClosed(requestedFor)) {
      log.debug('project', `save tail skipped for closed project ${requestedFor}`)
      return false
    }
    if (!ok) {
      // A FAILED SAVE MUST REACH THE ENGINEER. ``saveMetadata`` already
      // returns false for a failed bundle fetch or a failed .strix write,
      // and every caller (Ctrl+S, File → Save, the StageToolbar button, the
      // close dialog's Save) simply discarded that boolean — the only trace
      // was a ``log.error`` in a console a packaged build does not show. The
      // project stays dirty and the title keeps its asterisk, but nothing
      // says WHY, and the engineer's next move after a silent Ctrl+S is to
      // close the project (audit 2026-08-02).
      const message = failedSaveMessage(projectFilePath)
      setUnsavedError(message)
      toast('error', message)
      return false
    }
    resetSessionImportSets()
    setHasUnsavedMutations(false)
    // Crash recovery: the session delta now has a durable home, so the
    // recovery file may go — but ONLY if the .gmproj write actually
    // landed. ``saveMetadata`` reports success even when the file write
    // failed (the DB is still ahead), and in that case the delta is still
    // homeless, so the recovery file has to survive. Awaited so a
    // quit-after-save cannot race the delete.
    //
    // The two lines above already cleared the session-import sets and the
    // mutations flag, so a save whose file write failed leaves the session
    // LOOKING clean — which used to let the scheduler's "everything went
    // clean mid-session" rule delete the file this branch deliberately
    // keeps. That hole is closed on the scheduler's side: it takes the same
    // file-write signal as ``canClearOnClean`` and skips the delete when it
    // says no. (Making a failed file write leave the project DIRTY would be
    // a change to the save model, and is still not smuggled in here.)
    if (lastSaveWroteFile()) await clearRecoveryNow()
    return true
    // reason: ``toast`` is the ref-stable action from useToasts (declared as a
    // plain function there precisely so it never belongs in a dep array).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    saveMetadata,
    resetSessionImportSets,
    setHasUnsavedMutations,
    lastSaveWroteFile,
    clearRecoveryNow,
    projectFilePath,
    project?.id,
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
  // Every branch below notes itself through ``noteCloseFlow``. The close flow
  // never touches the API, so a report of the shape "it discarded my work
  // without asking" has no server log to check and no reliable repro — the
  // console is the only witness. INFO, not DEBUG (DEBUG is stripped from the
  // build the report came from), and mirrored into the MAIN process console,
  // which is the one a pasted terminal log actually shows: a packaged build
  // has DevTools disabled and forwards the renderer console nowhere. One line
  // per decision point answers it: who asked, was it dirty, did a dialog go
  // up, and which button ended it.
  const attemptClose = useCallback(
    (source: 'sidebar' | 'menu') => {
      noteCloseFlow(`close requested from ${source}, dirty=${projectDirty}`)
      if (projectDirty) {
        noteCloseFlow('unsaved-changes dialog opened (mode=close-project)')
        // In-app close paths use the close-project mode; the OS-X close
        // path overrides this back to 'quit-app' before opening the
        // dialog (see the ``onAppBeforeQuit`` effect below).
        setUnsavedDialogMode('close-project')
        setUnsavedDialogOpen(true)
        return
      }
      if (source === 'sidebar') {
        noteCloseFlow('clean close from the sidebar — click-protection confirm opened')
        setCloseConfirmOpen(true)
        return
      }
      noteCloseFlow('clean close from the menu — closing without a prompt')
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
    noteCloseFlow(`unsaved dialog answered: Save (mode=${unsavedDialogMode})`)
    setUnsavedSaving(true)
    // Same reasoning as Discard: the save is the slow part, and on the quit path the
    // window has already been told to go. Hidden first, brought back only if the save
    // FAILS — the dialog stays open for the retry, and a retry nobody can see is not
    // a retry.
    if (unsavedDialogMode === 'quit-app') void window.electron.setWindowVisible(false)
    try {
      const ok = await saveProject()
      // The dialog STAYS OPEN on failure — the live state is intact and the
      // retry lives here. ``saveProject`` has already published the reason
      // into ``unsavedError``, which the dialog renders, so the open dialog
      // now explains itself instead of looking like a dead button.
      if (!ok) {
        noteCloseFlow('unsaved dialog: Save failed — dialog kept open for retry')
        if (unsavedDialogMode === 'quit-app') void window.electron.setWindowVisible(true)
        return
      }
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

  // Discard ("Don't Save"): revert every session change, then close.
  //
  // Two-stage save (#160): for a SAVED project the .gmproj on disk is the
  // last-saved snapshot, so we replace-restore the DB from it — undoing
  // session creates, MUTATIONS (depth drags, deletes), and re-adding deleted
  // rows. The session-import tracking sets are then just cleared (the rows
  // they pointed at are already gone). For a NEVER-SAVED project there is no
  // file to revert to, so we fall back to discardSessionImports, which
  // DB-deletes the session-created rows. Either way the mutations flag is
  // cleared and the project closes. The .gmproj file is never touched.
  //
  // THE FOUR OUTCOMES ARE NOT INTERCHANGEABLE (audit 2026-08-02). This branch
  // used to read a bare boolean and treat every falsy answer as "never-saved
  // project", so a refused revert (the file on disk is not this project's
  // latest save) ran the DB-DELETE fallback: the session's created contacts
  // were destroyed while every session MUTATION stayed in the database, and
  // the engineer was told nothing. Only ``'no-snapshot'`` licenses the delete;
  // a refusal or a failure changes nothing and keeps the project open.
  const handleUnsavedDiscard = useCallback(async () => {
    // The line that answers "it discarded without asking": it is emitted from
    // the dialog's own button handler, so its presence proves a dialog was up
    // and its absence proves the loss came from somewhere else entirely.
    noteCloseFlow(`unsaved dialog answered: Discard (mode=${unsavedDialogMode})`)
    setUnsavedError(null)
    setUnsavedDialogOpen(false)
    setMetadataEditorOpen(false)
    // The window goes NOW, not when the work lands. A discard replace-restores the
    // whole bundle, which on a real project is seconds of apparent hang on a window
    // the engineer has already told to close (owner, 2026-08-10).
    //
    // Only on the quit path: closing a PROJECT keeps the window and returns to the
    // welcome screen, so hiding there would blank an app still in use.
    if (unsavedDialogMode === 'quit-app') void window.electron.setWindowVisible(false)
    const outcome = await revertToLastSaved()
    noteCloseFlow(`revertToLastSaved outcome: ${outcome}`)
    if (outcome === 'refused-not-latest-save') {
      // NOT a dead-end (owner ruling, installer #26 2026-09-08: "I don't want
      // to save, I want the changes to be gone"). The .strix on disk is not
      // this project's latest save, so a blind revert would delete work it
      // never held — but the user must still be able to throw his session away
      // without Task Manager. Offer the named, destructive force-revert prompt
      // (with Save as the other way out) instead of trapping him. The quit is
      // left PENDING — no notifyQuitDecision yet — until he answers the prompt.
      noteCloseFlow('refused revert — opening the force-revert prompt')
      // Bring the window back so the prompt is visible on the quit path.
      if (unsavedDialogMode === 'quit-app') void window.electron.setWindowVisible(true)
      setForceRevertPromptOpen(true)
      return
    }
    if (outcome === 'failed') {
      // A genuine FAULT (unreadable / truncated / newer container), not a
      // decision — the retry dead-end stands: change nothing, re-open the
      // dialog, name the failure. Forcing cannot fix an unreadable file.
      const message = failedRevertMessage(projectFilePath)
      setUnsavedError(message)
      toast('error', message)
      // The close is aborted, so the window has to come back — the dialog is about to
      // re-open onto it, and a dialog nobody can see is worse than the wait was.
      if (unsavedDialogMode === 'quit-app') void window.electron.setWindowVisible(true)
      setUnsavedDialogOpen(true)
      if (unsavedDialogMode === 'quit-app') {
        // Main is waiting on an answer; a cancelled quit is the honest one.
        void window.electron.notifyQuitDecision(false)
        setUnsavedDialogMode('close-project')
      }
      return
    }
    if (outcome === 'reverted') {
      resetSessionImportSets()
    } else {
      // 'no-snapshot' — never saved, so nothing on disk can bring the
      // session's creates back and deleting them IS the discard.
      discardSessionImports()
    }
    setHasUnsavedMutations(false)
    // Discard means discard: the work the recovery file protects is exactly
    // what the user just threw away. Awaited before the quit handshake so
    // the app cannot exit mid-delete and leave a file that offers to
    // restore discarded work.
    await clearRecoveryNow()
    if (unsavedDialogMode === 'quit-app') {
      void window.electron.notifyQuitDecision(true)
    } else {
      closeProject()
    }
    // reason: ``toast`` is ref-stable (see useToasts) and deliberately kept
    // out of dep arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    revertToLastSaved,
    resetSessionImportSets,
    discardSessionImports,
    setHasUnsavedMutations,
    closeProject,
    unsavedDialogMode,
    clearRecoveryNow,
    projectFilePath,
  ])

  // Cancel from the unsaved-drafts dialog. In quit-app mode that means
  // 'don't exit the app'; we tell main to abort the close.
  const handleUnsavedCancel = useCallback(() => {
    noteCloseFlow(`unsaved dialog answered: Cancel (mode=${unsavedDialogMode})`)
    setUnsavedError(null)
    setUnsavedDialogOpen(false)
    if (unsavedDialogMode === 'quit-app') {
      void window.electron.notifyQuitDecision(false)
    }
  }, [unsavedDialogMode])

  // "Revert to file and close" from the force-revert prompt (owner ruling,
  // installer #26 2026-09-08). The user has SEEN the file named and the loss
  // spelled out, and chosen it — so the replace-restore runs with ``force`` and
  // bypasses the save-anchor gate that refused the plain Discard. Then the
  // session is gone and the project closes, exactly as a normal Discard would.
  const handleForceRevertConfirm = useCallback(async () => {
    noteCloseFlow(`force-revert confirmed (mode=${unsavedDialogMode})`)
    setForceRevertPromptOpen(false)
    // The forced replace-restore is the slow part; on the quit path hide the
    // window the user already told to go (brought back only on a fault).
    if (unsavedDialogMode === 'quit-app') void window.electron.setWindowVisible(false)
    const outcome = await revertToLastSaved(true)
    noteCloseFlow(`force revert outcome: ${outcome}`)
    if (outcome === 'failed') {
      // Even forced, the file could not be read back — a fault, not a decision.
      // Change nothing, name it, and re-open the unsaved dialog for a retry.
      const message = failedRevertMessage(projectFilePath)
      setUnsavedError(message)
      toast('error', message)
      if (unsavedDialogMode === 'quit-app') void window.electron.setWindowVisible(true)
      setUnsavedDialogOpen(true)
      if (unsavedDialogMode === 'quit-app') {
        void window.electron.notifyQuitDecision(false)
        setUnsavedDialogMode('close-project')
      }
      return
    }
    // The forced revert applied (or there was no snapshot, defensively). The
    // session is gone: clear tracking, drop the recovery file, then close.
    if (outcome === 'reverted') {
      resetSessionImportSets()
    } else {
      discardSessionImports()
    }
    setHasUnsavedMutations(false)
    await clearRecoveryNow()
    if (unsavedDialogMode === 'quit-app') {
      void window.electron.notifyQuitDecision(true)
    } else {
      closeProject()
    }
    // reason: ``toast`` is ref-stable (see useToasts) and deliberately kept out
    // of dep arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    revertToLastSaved,
    resetSessionImportSets,
    discardSessionImports,
    setHasUnsavedMutations,
    closeProject,
    unsavedDialogMode,
    clearRecoveryNow,
    projectFilePath,
  ])

  // "Save" from the force-revert prompt — the non-destructive way out. Closes
  // the prompt and runs the normal save-and-close path; a failed save keeps the
  // unsaved dialog open (its retry surface) with the reason named.
  const handleForceRevertSave = useCallback(async () => {
    setForceRevertPromptOpen(false)
    // Open the unsaved dialog first so a save FAILURE has a visible retry
    // surface — ``handleUnsavedSave`` closes it again on success (and shows the
    // in-flight spinner meanwhile).
    setUnsavedDialogOpen(true)
    await handleUnsavedSave()
  }, [handleUnsavedSave])

  // "Cancel" from the force-revert prompt — abort the close entirely. The
  // project stays open with the session intact; on the quit path tell main the
  // quit is aborted.
  const handleForceRevertCancel = useCallback(() => {
    noteCloseFlow(`force-revert cancelled (mode=${unsavedDialogMode})`)
    setForceRevertPromptOpen(false)
    if (unsavedDialogMode === 'quit-app') {
      void window.electron.notifyQuitDecision(false)
      setUnsavedDialogMode('close-project')
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
      const outcome = await openProjectFile(path)
      // The menu path has no welcome-screen banner, so a moved file would
      // otherwise fail into silence (the old call ignored the result
      // entirely). Owner, 2026-08-17: "if user moved it you get a toast,
      // file not found, did you change it's location".
      if (outcome === 'file-missing') {
        toast('error', t('project.fileNotFoundToast', { path }))
      } else if (isProjectOpenUnreadable(outcome)) {
        // A damaged / truncated / newer container — toast the codec's own
        // specific, honest message so the menu path names corruption plainly
        // (never bricks anything; the app stays on the current project).
        toast('error', outcome.reason.message)
      }
    },
    [openProjectFile, toast],
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
        noteCloseFlow('quit requested: clean — agreeing without a prompt')
        // A clean quit is a DECIDED exit, so the recovery file goes first —
        // leaving it would make the next launch claim this session crashed.
        // Deletion deliberately hangs off this renderer-side decision and
        // NOT off ``app.on('before-quit')`` in main, which fires before the
        // user has answered and would destroy the file for a cancelled quit.
        void (async () => {
          await clearRecoveryNow()
          await window.electron.notifyQuitDecision(true)
        })()
        return
      }
      noteCloseFlow('quit requested: dirty — unsaved-changes dialog opened (mode=quit-app)')
      setUnsavedDialogMode('quit-app')
      setUnsavedDialogOpen(true)
    })
    return off
  }, [project, projectDirty, clearRecoveryNow])

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
    void window.electron.setWindowTitle(`StrixGeo — ${projectName}${dirtyMark}`)
  }, [projectName, projectDirty])

  // ---------------------------------------------------------------------------
  // Return
  // ---------------------------------------------------------------------------

  return {
    projectDirty,
    unsavedSummary,
    newProjectOpen,
    setNewProjectOpen,
    metadataEditorOpen,
    setMetadataEditorOpen,
    closeConfirmOpen,
    setCloseConfirmOpen,
    unsavedDialogOpen,
    unsavedSaving,
    unsavedError,
    saveProject,
    discardSessionImports,
    handleCloseProjectRequest,
    handleUnsavedSave,
    handleUnsavedDiscard,
    handleUnsavedCancel,
    forceRevertPromptOpen,
    // Recomputed each render (t() reads the active language) so the prompt body
    // names the file in the interface language — cheap, only shown while open.
    forceRevertMessage: refusedRevertMessage(projectFilePath),
    handleForceRevertConfirm,
    handleForceRevertSave,
    handleForceRevertCancel,
    stageLumping,
    currentLumping,
  }
}
