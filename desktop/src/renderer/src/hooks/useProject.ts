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
// Stratigraphy lumping (Fill-from-boreholes alias map) follows the
// same two-stage save model as metadata:
//   * ``currentLumping``  — in-memory staging area; updated by stageLumping.
//   * ``savedLumping``    — last-loaded-or-saved lumping snapshot.
//   * dirty includes ``currentLumping !== savedLumping`` so Apply flips
//     the dirty flag and File→Save clears it.
//
// On launch the hook starts with no project loaded — the welcome
// screen drives the first interaction (Plaxis / AutoCAD / Photoshop
// pattern). Recent projects are surfaced from the main-process
// userData store; users click one to re-open.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { api } from '../api/client'
import { clearProjectScopedCaches } from './useWgs84'
import type {
  ProjectBundleResponse,
  ProjectCreatePayload,
  ProjectResponse,
  ProjectUpdatePayload,
} from '../api/client'
// Imported from the DEFINING module rather than the ``../api/client``
// barrel: unit tests routinely ``vi.mock`` that barrel, and a mocked
// barrel would hand this module an undefined binding — breaking the
// ``instanceof`` check inside ``isApiStatus`` at runtime while the types
// still compile.
import { isApiStatus } from '../api/clients/shared'
import { log } from '../utils/log'
import { withSlowRestoreHint } from '../utils/slowRestoreHint'
import {
  BUNDLE_NEWER_FORMAT_CODE,
  buildProjectFile,
  defaultProjectFileName,
  newerBundleFormatVersion,
  parseProjectFile,
  projectIdFromFile,
  serialiseProjectFile,
} from '../utils/projectFile'
import { t } from '../i18n/translate'
import type {
  ProjectFile,
  StratigraphyLumping,
  StrixReadFailureReason,
} from '../utils/projectFile'
import {
  lumpingsEqual,
  nextLumpingRevision,
  resolveOpenLumping,
  storedRevisionFromStaleError,
} from '../utils/stratigraphyLumping'
import { projectMetadataEqual } from '../utils/projectMetadataFields'
import type { ProjectMetadataField } from '../utils/projectMetadataFields'

/**
 * Outcome of ``revertToLastSaved`` — four states that want four behaviours.
 *
 * A bare ``false`` used to carry all three failure shapes at once, and the
 * close-flow read every one of them as "never-saved project", falling through
 * to a DB-DELETE of the session's creates. Discarding by deleting is only
 * correct when there is genuinely no snapshot to replay; on a refusal or a
 * failure it destroys work the file never contained (audit 2026-08-02).
 *
 * * ``'reverted'`` — the file was replayed over the database.
 * * ``'no-snapshot'`` — never-saved project (no file path): the caller may
 *   delete the session creates, because nothing on disk can restore them.
 * * ``'refused-not-latest-save'`` — a file exists but it is NOT this
 *   project's latest save (a hand-made copy, or the file of a save whose
 *   write never landed). Replaying it would delete everything saved since,
 *   and deleting the session creates would throw away work the file does not
 *   hold. The caller must do NEITHER and tell the engineer.
 * * ``'failed'`` — the read / parse / restore threw. Same rule: change
 *   nothing, report it.
 */
export type RevertToLastSavedResult =
  | 'reverted'
  | 'no-snapshot'
  | 'refused-not-latest-save'
  | 'failed'

interface UseProjectState {
  /** Live in-memory project state — what the editor sees. */
  project: ProjectResponse | null
  /** Last-saved snapshot. Equal to ``project`` when ``dirty === false``. */
  saved: ProjectResponse | null
  /** ``true`` when ``project`` differs from ``saved``. */
  dirty: boolean
  /** Path to the .gmproj file on disk. */
  filePath: string | null
  /**
   * In-memory staging area for the lumping snapshot — updated by
   * ``stageLumping`` (Fill-from-boreholes Apply), seeded from the
   * file on open.  Null when no lumping has been applied yet.
   * Exposed so consumers (useGeologicalModel, GeologyToolbar) can
   * read the current map without an additional file read.
   */
  currentLumping: StratigraphyLumping | null
  /**
   * Last-saved lumping snapshot — equal to ``currentLumping`` when
   * the lumping is clean (``dirty === false``).  Used internally to
   * compute the dirty flag; exposed so callers can detect unsaved
   * lumping independently of metadata if needed.
   */
  savedLumping: StratigraphyLumping | null
  /**
   * Monotonic counter for the lumping map, bumped on every stage and
   * written to BOTH the database and the crash-recovery file. It is what
   * recovery reconciliation compares — never wall-clocks
   * (docs/design/autosave-recovery.md §3). Null until this project has
   * been staged by a revision-aware client. Exposed so the recovery
   * writer can stamp the same number it staged.
   */
  lumpingRevision: number | null
  /** Set of CPT IDs that this project's saved-on-disk .gmproj
   * references. Seeded from the file on open; appended to when the
   * user imports new CPTs; trimmed on discard. NOT persisted to
   * localStorage — a Ctrl+C kill loses any in-memory additions
   * (= unsaved imports), exactly the behaviour the user wants.
   * Drives the visible-list filter in App. */
  manifestCptIds: ReadonlySet<string>
  /** Same as ``manifestCptIds`` but for boreholes. */
  manifestBoreholeIds: ReadonlySet<string>
  /** Same as ``manifestCptIds`` but for geological formations. A
   * formation created via the Interpretation pane that isn't yet
   * saved sits in this set during the session and disappears on a
   * Ctrl+C reload. */
  manifestFormationIds: ReadonlySet<string>
  /** Same as ``manifestCptIds`` but for cross-sections. */
  manifestSectionIds: ReadonlySet<string>
}

/** Kind of entity the manifest tracks. All bundle-persistent
 * top-level arrays (cpts, boreholes, geological_formations,
 * cross_sections) follow the same lifecycle: seed from file on
 * open, append on session creation, drop on discard, trim before
 * file write. */
export type ManifestKind = 'cpt' | 'borehole' | 'formation' | 'section'

/**
 * The file decoded-failed: the ``.strix`` container is damaged, truncated, or
 * from a newer build. Distinct from a bare ``null`` (a generic parse / DB
 * failure) so the open flow can show the specific, user-honest ``reason.message``
 * — the RAM-corruption-mid-save case this machine has seen needs a LOUD,
 * specific banner, not the generic "may be corrupt, or the API isn't reachable".
 */
export interface ProjectOpenUnreadable {
  outcome: 'unreadable'
  reason: StrixReadFailureReason
}

/** Narrow an ``openProjectFile`` result to the unreadable-file failure. */
export function isProjectOpenUnreadable(
  result: ProjectResponse | 'file-missing' | ProjectOpenUnreadable | null,
): result is ProjectOpenUnreadable {
  return (
    typeof result === 'object' &&
    result !== null &&
    (result as { outcome?: unknown }).outcome === 'unreadable'
  )
}

/** Tri-state outcome for picker-driven opens — lets the caller show
 * an error banner only when the failure is real (not just a cancelled
 * file dialog). ``message`` carries the specific decode reason when the failure
 * was an unreadable file; absent for a generic failure (caller shows its
 * default banner). */
export type PickAndOpenResult =
  | { outcome: 'opened'; project: ProjectResponse; path: string }
  | { outcome: 'cancelled' }
  | { outcome: 'failed'; path: string; message?: string }

interface UseProjectActions {
  newProject: (metadata: ProjectCreatePayload) => Promise<ProjectResponse | null>
  // 'file-missing' = the .strix is no longer at its saved location (moved or
  // renamed) — callers surface "did you move it?" instead of the corrupt/API
  // catch-all (owner, 2026-08-17).
  openProjectFile: (
    filePath: string,
  ) => Promise<ProjectResponse | 'file-missing' | ProjectOpenUnreadable | null>
  pickAndOpenProject: () => Promise<PickAndOpenResult>
  /** Append IDs to the manifest. Called by the import handlers after
   * a successful CPT/borehole import so the new rows become visible
   * in the sidebar. */
  addToManifest: (kind: ManifestKind, ids: Iterable<string>) => void
  /** Remove IDs from the manifest. Called by the discard-rollback
   * path so unsaved imports / additions disappear from view. The DB
   * rows stay (DOV cache + already-committed-but-not-yet-saved
   * formation / section rows) but are invisible until a future
   * explicit re-create. */
  removeFromManifest: (kind: ManifestKind, ids: Iterable<string>) => void
  /** Apply an in-memory patch to ``project`` (no API call, no file write). */
  applyMetadataDraft: (patch: ProjectUpdatePayload) => void
  /** Shallow-merge a patch into ``project.view_state``. Fires PATCH
   * /view-state immediately and updates BOTH ``project`` and
   * ``saved`` so the change does NOT flip ``dirty`` — view_state
   * lives on its own auto-persist track (it's reversible UI chrome,
   * not metadata that goes through the Save model). Returns true on
   * success, false on network failure (caller surfaces the toast). */
  applyViewStatePatch: (patch: Record<string, unknown>) => Promise<boolean>
  /**
   * Commit ``project`` to the DB + .gmproj file.
   *
   * The metadata PATCH is skipped when the metadata is clean; the file
   * write never is. Returns ``true`` only when the project reached BOTH
   * durable homes — a bundle fetch or file write that failed reports
   * ``false``, so the caller keeps the project dirty instead of clearing
   * the markers over a stale file.
   */
  saveProject: () => Promise<boolean>
  /**
   * Did the LAST ``saveProject`` reach the ``.gmproj`` file?
   *
   * Overlaps with ``saveProject``'s boolean today but answers a different
   * question, so crash recovery reads THIS: "did the delta reach a durable
   * home", not "did the save succeed". A save that fails before the file
   * (the metadata PATCH) and one that fails at the file are the same
   * ``false`` here and want the same recovery behaviour — the file stays
   * (docs/design/autosave-recovery.md §4, "Clearing"). Reads a ref, so the
   * callback identity is stable and calling it never re-renders.
   *
   * Returns
   * -------
   * boolean
   *     ``true`` when the most recent save wrote the file; ``false`` before
   *     the first save of a session and after a failed write.
   */
  lastSaveWroteFile: () => boolean
  /** Revert the DB to the last-saved .gmproj file (replace-restore, #160):
   *  re-read + parse the file and POST it to ``/restore?replace=true`` so the
   *  project's children match the file EXACTLY — session creates, mutations,
   *  and deletes are all undone. Backs the "Don't Save" close-flow branch.
   *  See ``RevertToLastSavedResult`` for what each outcome obliges the caller
   *  to do — only ``'no-snapshot'`` licenses deleting the session's creates. */
  revertToLastSaved: () => Promise<RevertToLastSavedResult>
  /** Put the lumping's staged slot (DB + in-memory) back onto the saved
   *  snapshot — the "discard means discard" tail shared by the close dialog's
   *  Discard (via ``revertToLastSaved``) and the recovery prompt's Delete
   *  backup, which must leave no trace of the discarded map. */
  resetStagedLumpingToSaved: () => Promise<void>
  /** Deep-duplicate the current project (DB + all CPTs/boreholes), write a
   * new .gmproj at a user-chosen path, and switch the hook to point at the
   * new project. Returns the duplicate on success, null on cancel/error. */
  saveAsProject: () => Promise<ProjectResponse | null>
  /**
   * May crash recovery delete the recovery file on a clean transition?
   *
   * ``lastSaveWroteFile`` alone cannot answer this: it is ``false`` both
   * before the first save of a session and after a save whose file write
   * failed, and those two states want opposite answers. A session that has
   * never saved has no failed write to distrust, so a genuine
   * dirty→clean transition may clear; after a save, only a landed file
   * write means the delta reached a durable home
   * (docs/design/autosave-recovery.md §4, "Clearing").
   *
   * Returns
   * -------
   * boolean
   *     ``true`` when the recovery file may go, ``false`` when the last
   *     save never reached the ``.gmproj``.
   */
  recoveryClearAllowed: () => boolean
  /** Revert ``project`` to ``saved`` (drop in-memory edits). */
  discardEdits: () => void
  archiveCurrent: () => Promise<void>
  closeProject: () => void
  /**
   * Stage a lumping snapshot and mark the project dirty.
   * Called immediately after a Fill-from-boreholes Apply confirm so the
   * user's grouping flips the dirty flag; it lands on disk only when the
   * user explicitly File→Saves — exactly like an unsaved metadata edit.
   *
   * WHY no .gmproj write: the old behaviour (``writeLumpingSnapshot``)
   * rewrote the .gmproj immediately on Apply, which violated the two-stage
   * save model — the lumping "stuck" even without a File→Save. Writing the
   * project's STAGED COLUMN instead is a different thing entirely, and is
   * what ``view_state`` already does: the durable slot moves, the user's
   * saved artefact does not, and ``staged !== saved`` stays the dirty
   * signal (docs/design/autosave-recovery.md §3).
   *
   * Parameters
   * ----------
   * lumping
   *     The lumping snapshot to stage, or ``null`` to clear the map —
   *     clearing is a stage action like any other.
   * revision
   *     Optional explicit revision, for the crash-recovery REPLAY case only
   *     (docs/design/autosave-recovery.md §3, "file revision higher"): the
   *     recovery file already claims a number the database never received,
   *     so the replay has to stage under THAT number rather than a fresh
   *     bump, or the two counters stay out of step. Every ordinary Apply
   *     omits it and gets the monotonic increment.
   *
   * Returns
   * -------
   * Promise<void>
   *     Resolves once the staged PUT has settled. A failed PUT never rolls
   *     back the in-memory stage; awaiting is only useful to sequence a
   *     recovery write behind it.
   */
  stageLumping: (lumping: StratigraphyLumping | null, revision?: number) => Promise<void>
}

export type UseProject = UseProjectState & UseProjectActions

// Equality for the metadata fields we treat as part of the dirty check.
// ``created_at`` / ``updated_at`` / ``archived_at`` are DB-side timestamps
// and not user-editable, so they don't participate.
//
// The field list itself lives in ``utils/projectMetadataFields`` — crash
// recovery needs the same ten fields to carry the metadata draft
// (docs/design/autosave-recovery.md §2, item 3), so it stopped being a
// hand-copied enumeration.
//
// DRIFT WARNING: ``ProjectMetadataDialog``'s ``toPatch`` / ``isDirty`` and
// ``utils/projectFile.ts``'s ``buildProjectFile`` still enumerate the same
// fields by hand. Adding a field to ``ProjectResponse`` means: (1) add it to
// PROJECT_METADATA_FIELDS (which the compiler then forces into
// ``fullPatchFrom``), (2) include it in the editor's diff helpers,
// (3) include it in buildProjectFile.
function projectsEqual(
  a: ProjectResponse | null,
  b: ProjectResponse | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  if (a.id !== b.id) return false
  return projectMetadataEqual(a, b)
}

// Build a complete patch from a live project. Used when the user hits
// Save and the API expects a body — easiest to re-send everything the
// editor can change. The backend's PATCH semantics ignore identical
// values, so this is safe even if a field hasn't changed.
//
// The ``Record<ProjectMetadataField, unknown>`` intersection is a
// compile-time tie to the shared field list: adding a field there without
// adding it here is a type error, which is what the old DRIFT WARNING could
// only ask for in prose.
function fullPatchFrom(
  project: ProjectResponse,
): ProjectUpdatePayload & Record<ProjectMetadataField, unknown> {
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

/**
 * Build the restore payload from a parsed ``.strix``.
 *
 * THE single enumeration of the file's collections for every restore-shaped
 * call. Both restore call sites — the DB-lost recovery inside
 * ``openProjectFile`` and the replace-restore inside ``revertToLastSaved`` —
 * go through here, because the two used to enumerate the collections by
 * hand and drifted: the recovery path listed seven arrays while the revert
 * listed twelve, so a .strix opened after a DB wipe came back with no
 * bodies, no correlation edges, no formation absences and no body
 * boundaries. A collection added to the file format is added HERE, once.
 *
 * Parameters
 * ----------
 * file
 *     The parsed ``.strix`` payload.
 *
 * Returns
 * -------
 * ProjectBundleResponse
 *     The bundle body ``POST /projects/{id}/restore`` accepts.
 */
function restorePayloadFrom(file: ProjectFile): ProjectBundleResponse {
  return {
    format_version: file.format_version,
    project: file.project,
    cpts: file.cpts,
    boreholes: file.boreholes,
    geological_formations: file.geological_formations,
    geological_models: file.geological_models,
    cross_sections: file.cross_sections,
    investigation_reviews: file.investigation_reviews,
    bodies: file.bodies,
    formation_absences: file.formation_absences,
    litho_contact_correlation_edges: file.litho_contact_correlation_edges,
    body_boundary_shapes: file.body_boundary_shapes,
    body_boundary_nodes: file.body_boundary_nodes,
    body_geometry_facts: file.body_geometry_facts,
    geotech_tie_tombstones: file.geotech_tie_tombstones,
    body_separations: file.body_separations,
    body_unions: file.body_unions,
    bed_overrides: file.bed_overrides,
  }
}

/**
 * Key under which the save anchor lives in ``project.view_state``.
 *
 * WHY view_state: the anchor has to sit on the project ROW and inside the
 * ``.strix`` at once, and ``view_state`` is the only durable project-scoped
 * bag that already round-trips through both (the bundle serialises the
 * project row's columns verbatim, and ``PATCH /view-state`` shallow-merges
 * top-level keys). No migration, no new column.
 */
const SAVE_ANCHOR_KEY = 'save_anchor'

/**
 * Read the save anchor out of a ``view_state`` bag.
 *
 * Parameters
 * ----------
 * viewState
 *     A project's ``view_state`` — from the API row or from the file's
 *     ``project`` block, both of which are opaque here.
 *
 * Returns
 * -------
 * string | null
 *     The anchor token, or ``null`` when the project pre-dates anchors or
 *     the slot holds something that is not a string.
 */
function saveAnchorOf(viewState: unknown): string | null {
  if (typeof viewState !== 'object' || viewState === null) return null
  const token = (viewState as Record<string, unknown>)[SAVE_ANCHOR_KEY]
  return typeof token === 'string' ? token : null
}

/** The anchor carried by a parsed ``.strix``'s embedded project block. */
function saveAnchorOfFile(file: ProjectFile): string | null {
  return saveAnchorOf(file.project.view_state)
}

/**
 * Mint a fresh save-anchor token.
 *
 * Time-ordered so the value is readable in a log or in the JSON, and
 * random-suffixed so two saves in the same millisecond — or a save on a
 * clock that stepped backwards — still produce different tokens. Only
 * equality is ever tested; the ordering is a debugging affordance.
 *
 * Returns
 * -------
 * string
 *     A token of the form ``"2026-08-03T09:12:44.201Z-4f2c9a"``.
 */
function mintSaveAnchor(): string {
  return `${new Date().toISOString()}-${Math.random().toString(36).slice(2, 8)}`
}

// Extract the string ``id`` field from each bundle row. Filters out
// rows whose id isn't a string (defensive — the file format guarantees
// it, but the renderer treats bundle entries as opaque ``Record``s so
// the type system can't.).
function idsFromBundle(rows: Record<string, unknown>[]): string[] {
  return rows
    .map(r => r.id)
    .filter((id): id is string => typeof id === 'string')
}

export function useProject(
  {
    toast,
  }: {
    // From ``useToasts``. Optional so the many hook tests that render
    // ``useProject()`` bare keep compiling; the App always supplies it. Held in
    // a ref below rather than closed over directly, so ``openProjectFile``'s
    // identity stays stable (it re-registers the File-menu IPC effect on every
    // change, and ``toast`` is a fresh closure each render).
    toast?: (type: 'success' | 'error' | 'warning', message: string) => void
  } = {},
): UseProject {
  const [project, setProject] = useState<ProjectResponse | null>(null)
  const [saved, setSaved] = useState<ProjectResponse | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)

  // Keep the latest ``toast`` in a ref so callbacks can reach it without
  // listing it in their dep arrays (the same ref-stable pattern useToasts is
  // built for). Assigning during render is safe — a ref write triggers no
  // re-render and always reflects the current closure.
  const toastRef = useRef(toast)
  toastRef.current = toast

  // Audit L8: drop the module-level proj4 memo caches (``useWgs84``) whenever the
  // active project changes — open, switch, or close (``project?.id`` → a new id
  // or ``undefined``). Those caches are keyed by ``(epsg, x, y)`` and grow with
  // the coordinate data a project touches, so without this they accumulate every
  // project's coordinates for the life of the session. Placed here because
  // ``useProject`` is the single owner of the project lifecycle. Clearing is
  // pure-safe (projection recomputes on the next lookup), so there is no
  // ordering hazard with the map re-projecting on the next render.
  useEffect(() => {
    clearProjectScopedCaches()
  }, [project?.id])

  // Manifest: in-memory only. Seeded from the .gmproj bundle on open
  // and from the duplicate's bundle on saveAs; cleared on close /
  // archive. NOT persisted — a hard kill (Ctrl+C, crash) loses any
  // additions the user hadn't yet committed via File → Save. That's
  // the documented intent: unsaved imports are LOST on shutdown, and
  // the .gmproj on disk is the only source of truth on reload.
  const [manifestCptIds, setManifestCptIds] = useState<Set<string>>(new Set())
  const [manifestBoreholeIds, setManifestBoreholeIds] = useState<Set<string>>(new Set())
  const [manifestFormationIds, setManifestFormationIds] = useState<Set<string>>(new Set())
  const [manifestSectionIds, setManifestSectionIds] = useState<Set<string>>(new Set())

  // In-memory staging area for the lumping snapshot.  Updated by stageLumping
  // (Fill-from-boreholes Apply) and seeded from the file on open.  Passed to
  // buildProjectFile in saveProject so File→Save always writes the current map.
  const [currentLumping, setCurrentLumping] = useState<StratigraphyLumping | null>(null)

  // Last-saved lumping snapshot — mirrors currentLumping after a successful
  // saveProject, and is seeded from the file on open (same as project/saved).
  // WHY a parallel saved slot: dirty must be derived (not a boolean flag) so
  // the project title asterisk and the unsaved-changes guard stay in sync with
  // the save/discard model without any manual true/false juggling.  The
  // cleanest faithful extension of the projectsEqual pattern is to compare
  // currentLumping with savedLumping — if they differ the project is dirty.
  const [savedLumping, setSavedLumping] = useState<StratigraphyLumping | null>(null)

  // Monotonic revision for the lumping map. Kept in BOTH a state slot and a
  // ref on purpose: the state is what re-renders consumers (the recovery
  // writer needs to see the new number), while the ref is what ``stageLumping``
  // reads — so the callback keeps a stable identity across stages and can
  // never bump from a stale closure value, which would replay a revision the
  // server already stores and earn a 409.
  // Whether the last save's .gmproj write landed. A ref, not state: the
  // only reader is the crash-recovery clear, which asks at call time — and
  // re-rendering the app on a save-outcome flag would buy nothing.
  const fileWriteSucceededRef = useRef(false)
  const lastSaveWroteFile = useCallback((): boolean => fileWriteSucceededRef.current, [])

  // Has a save been ATTEMPTED at all this session? Pairs with
  // ``fileWriteSucceededRef`` to separate the two states that flag conflates:
  // "no save yet" (nothing to distrust) from "the last save never reached the
  // file" (the delta is still homeless). Only the second may block the
  // recovery clear.
  const saveAttemptedRef = useRef(false)
  const recoveryClearAllowed = useCallback(
    (): boolean => !saveAttemptedRef.current || fileWriteSucceededRef.current,
    [],
  )

  // The save-anchor token the project ROW carries, as far as this session
  // knows: seeded on open, replaced on every save. ``revertToLastSaved``
  // compares the .strix it is about to replay against this — a
  // replace-restore from anything that is not the project's latest save
  // deletes work that file never contained. A ref, not state: nothing
  // renders from it, and a stale closure would defeat the very check it
  // exists to perform.
  const dbAnchorRef = useRef<string | null>(null)

  const [lumpingRevision, setLumpingRevision] = useState<number | null>(null)
  const lumpingRevisionRef = useRef<number | null>(null)
  const applyLumpingRevision = useCallback((next: number | null): void => {
    lumpingRevisionRef.current = next
    setLumpingRevision(next)
  }, [])

  // Single writer for the staged slot, shared by Apply and by the discard
  // path (which re-stages the saved snapshot). Never throws: a stage that
  // does not reach the server still stands in memory, and the recovery file
  // carries the higher revision — which is precisely the design's "file
  // wins" reconciliation case, not a state to unwind.
  //
  // It DOES report whether the PUT landed, because the two promote sites care:
  // promoting copies the database's staged slot onto its saved slot, so
  // promoting after a stage that never arrived would immortalise whatever
  // stale map the column still holds.
  const stageToDatabase = useCallback(
    async (
      projectId: string,
      lumping: StratigraphyLumping | null,
      revision: number,
    ): Promise<boolean> => {
      try {
        await api.project.stageLumping(projectId, lumping, revision)
        log.debug('project', `staged lumping rev ${revision} for ${projectId}`)
        return true
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const stored = storedRevisionFromStaleError(message)
        if (stored !== null) {
          // A 409 means another writer got ahead of this session's counter.
          // Adopt the server's number so the NEXT stage clears the guard
          // instead of colliding forever.
          applyLumpingRevision(stored)
          log.warn(
            'project',
            `stale lumping stage (rev ${revision}); adopted stored rev ${stored}`,
          )
          return false
        }
        log.warn('project', `staged lumping PUT failed (rev ${revision})`, err)
        return false
      }
    },
    [applyLumpingRevision],
  )

  // Copy the staged slot onto the saved slot so the database's dirty
  // comparison agrees with the one the renderer just cleared. Bookkeeping,
  // not durability — the staged slot has been safe since Apply, so a failure
  // costs at most a project that reopens looking dirty, and must never fail
  // the save that triggered it.
  const promoteInDatabase = useCallback(async (projectId: string): Promise<void> => {
    try {
      await api.project.promoteLumping(projectId)
      log.debug('project', `promoted lumping to saved for ${projectId}`)
    } catch (err) {
      log.warn('project', `promote lumping failed for ${projectId}`, err)
    }
  }, [])

  const dirty = useMemo(
    () => !projectsEqual(project, saved) || !lumpingsEqual(currentLumping, savedLumping),
    [project, saved, currentLumping, savedLumping],
  )

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

  // Seed the two lumping slots + the revision counter when a project opens.
  //
  // WHY the database can outrank the file: the staged slot is written the
  // instant the user hits Apply, whereas the .gmproj is only rewritten on
  // File → Save. So a project that crashed mid-edit reopens with its staged
  // map intact and DIRTY (staged !== saved) — that re-seeded dirty state IS
  // the crash-safety feature, not a bug to normalise away. A project with no
  // revision has never been staged by a revision-aware client, so the file
  // stays authoritative exactly as before.
  //
  // The read path on the server is pass-through, so the blobs are narrowed
  // here rather than trusted; a malformed one falls back to the file.
  const seedLumpingOnOpen = useCallback(
    (fetched: ProjectResponse, fileLumping: StratigraphyLumping | null): void => {
      const resolved = resolveOpenLumping(fetched, fileLumping)
      if (resolved.warning !== null) {
        log.warn(
          'project',
          `lumping columns unusable for ${fetched.id} (${resolved.warning}); seeding from file`,
        )
      }
      setCurrentLumping(resolved.current)
      setSavedLumping(resolved.saved)
      applyLumpingRevision(resolved.revision)
      log.debug(
        'project',
        `seeded lumping from ${resolved.source} (rev ${String(resolved.revision)})`,
      )
    },
    [applyLumpingRevision],
  )

  const openProjectFile = useCallback(
    async (
      path: string,
    ): Promise<ProjectResponse | 'file-missing' | ProjectOpenUnreadable | null> => {
      let parsed: ReturnType<typeof parseProjectFile> = null
      let parsedId: string | null = null
      try {
        // The file IS the anchor — a recents entry whose .strix has been moved
        // or renamed must say so, not fall through to the catch-all "corrupt or
        // API unreachable" banner (owner, 2026-08-17: "file not found, did you
        // change it's location"). Probed explicitly rather than sniffed out of
        // the read's wrapped IPC error text — the 404-text gate below documents
        // where that road leads.
        const exists = await window.electron.projectFileExists(path)
        if (!exists) {
          log.warn('project', `openProjectFile(${path}): file not found — moved or renamed?`)
          return 'file-missing'
        }
        // Discriminated read result: the main-process codec flattens a damaged
        // / truncated / newer container into ``{ ok: false, reason }`` rather
        // than throwing across IPC, so we can surface the SPECIFIC, honest
        // message (this machine's RAM corruption once scrambled a .strix
        // mid-save — that case must read LOUD, not fall into the generic
        // "corrupt or API unreachable" banner). Legacy plain-JSON files and
        // successfully-decoded binaries both arrive as ``{ ok: true, json }``.
        const readResult = await window.electron.readProjectFile(path)
        if (!readResult.ok) {
          log.error(
            'project',
            `openProjectFile(${path}): unreadable — ${readResult.reason.code}: ` +
              readResult.reason.message,
          )
          return { outcome: 'unreadable', reason: readResult.reason }
        }
        const raw = readResult.json
        parsed = parseProjectFile(raw)
        if (parsed === null) {
          // A file whose INNER bundle format_version is newer than this build
          // is not corrupt — the build is simply too old. Route it down the
          // same "unreadable" path as the container-level codec failures, with
          // a typed reason and honest, translated copy, instead of the generic
          // "may be corrupt, or the API isn't reachable" banner (audit L4).
          const newerVersion = newerBundleFormatVersion(raw)
          if (newerVersion !== null) {
            log.warn(
              'project',
              `openProjectFile(${path}): saved by a newer build ` +
                `(bundle format_version ${newerVersion})`,
            )
            return {
              outcome: 'unreadable',
              reason: {
                code: BUNDLE_NEWER_FORMAT_CODE,
                message: t('welcome.openNewerBuild', { version: newerVersion }),
              },
            }
          }
          log.error('project', `unrecognisable .gmproj at ${path}`)
          return null
        }
        parsedId = projectIdFromFile(parsed)
        // The DB row is the live source of truth when it exists. We
        // always GET first so any metadata edits made elsewhere (the
        // file is a stale snapshot) win over the file's copy.
        const fresh = await api.project.get(parsedId)
        // Record which save this file is, relative to the row it just
        // bound to. A byte-copied backup carries the SAME project id, so
        // the id proves nothing; the anchor is what says "this file is
        // (not) the project's latest save". Only ``revertToLastSaved``
        // acts on it — opening a stale copy read-only is legitimate.
        const dbAnchor = saveAnchorOf(fresh.view_state)
        const fileAnchor = saveAnchorOfFile(parsed)
        dbAnchorRef.current = dbAnchor
        if (dbAnchor !== null && fileAnchor !== dbAnchor) {
          log.warn(
            'project',
            `opened ${path} is NOT this project's latest save ` +
              `(file anchor ${String(fileAnchor)}, project row ${dbAnchor}); ` +
              `close-without-save will refuse to replace the database from it`,
          )
        }
        await adopt(fresh, path)
        // Seed the manifest from the file's bundle. The .strix file
        // is the user's anchor — anything in the DB but NOT in the
        // file is treated as "unsaved from a previous session" and
        // stays invisible until the user re-creates it. Ctrl+C kills
        // can't leak imported / added rows back into view this way.
        setManifestCptIds(new Set(idsFromBundle(parsed.cpts)))
        setManifestBoreholeIds(new Set(idsFromBundle(parsed.boreholes)))
        setManifestFormationIds(new Set(idsFromBundle(parsed.geological_formations)))
        setManifestSectionIds(new Set(idsFromBundle(parsed.cross_sections)))
        seedLumpingOnOpen(fresh, parsed.stratigraphy_lumping ?? null)
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
        //
        // The status is read off the typed ``ApiError`` the HTTP layer
        // throws. It used to be sniffed out of the error TEXT
        // (``message.includes('→ 404')``), a string the client cannot
        // actually produce for this route — FastAPI sends
        // ``detail: "Project not found"`` and the detail wins — so this
        // entire branch was dead and a .strix opened after a DB wipe
        // reported "could not be opened".
        if (parsed !== null && parsedId !== null && isApiStatus(err, 404)) {
          try {
            const restored = await withSlowRestoreHint(
              api.project.restore(parsedId, restorePayloadFrom(parsed)),
              () => toastRef.current?.('warning', t('project.restoreWaitingToast')),
            )
            // L6: restore truncates over-cap depth-series / child arrays. The
            // response carries how many rows were dropped so this is no longer
            // silent. The log is for the terminal; the WARNING toast is what
            // reaches an engineer on a packaged build (DevTools disabled).
            // Fired ONCE, only when something was actually dropped — a clean
            // restore stays silent.
            if (restored.dropped_series > 0 || restored.dropped_child_rows > 0) {
              log.warn(
                'project',
                `restore of ${path} capped oversized data: ` +
                  `${restored.dropped_series} depth-series and ` +
                  `${restored.dropped_child_rows} child row(s) dropped`,
              )
              toastRef.current?.(
                'warning',
                t('project.restoreDroppedToast', {
                  series: restored.dropped_series,
                  rows: restored.dropped_child_rows,
                }),
              )
            }
            // The database was just built FROM this file, so the file is
            // by definition this project's latest save.
            dbAnchorRef.current = saveAnchorOfFile(parsed)
            await adopt(restored, path)
            // Same manifest seeding as the happy path — the .strix
            // file is now the authoritative list of every
            // bundle-tracked entity this project sees.
            setManifestCptIds(new Set(idsFromBundle(parsed.cpts)))
            setManifestBoreholeIds(new Set(idsFromBundle(parsed.boreholes)))
            setManifestFormationIds(new Set(idsFromBundle(parsed.geological_formations)))
            setManifestSectionIds(new Set(idsFromBundle(parsed.cross_sections)))
            // Seed both lumping slots on restore — same pattern as the happy path.
            seedLumpingOnOpen(restored, parsed.stratigraphy_lumping ?? null)
            // Sum contacts across every model so the log reports the
            // true interpretation-row count, not just the model count
            // (a model with 0 contacts is functionally empty).
            const contactCount = parsed.geological_models.reduce(
              (sum, m) => {
                const contacts = (m as { contacts?: unknown }).contacts
                return sum + (Array.isArray(contacts) ? contacts.length : 0)
              },
              0,
            )
            log.info(
              'project',
              `restored ${restored.name} from ${path} ` +
                `(+${parsed.cpts.length} CPTs, +${parsed.boreholes.length} boreholes, ` +
                `+${parsed.geological_formations.length} formations, ` +
                `+${parsed.geological_models.length} models ` +
                `(+${contactCount} contacts), ` +
                `+${parsed.cross_sections.length} sections, ` +
                `+${parsed.investigation_reviews.length} reviews, ` +
                // The interpretation collections the old hand-rolled
                // payload silently dropped — logged so a restore that
                // brings none of them back is visible, not inferred.
                `+${parsed.bodies.length} bodies, ` +
                `+${parsed.litho_contact_correlation_edges.length} correlation edges, ` +
                `+${parsed.formation_absences.length} absences, ` +
                `+${parsed.body_boundary_shapes.length} boundary shapes, ` +
                `+${parsed.body_geometry_facts.length} body geometry facts, ` +
                `+${parsed.geotech_tie_tombstones.length} tie tombstones, ` +
                `+${parsed.body_separations.length} body separations, ` +
                `+${parsed.body_unions.length} body unions)`,
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
    [adopt, seedLumpingOnOpen],
  )

  const pickAndOpenProject = useCallback(async (): Promise<PickAndOpenResult> => {
    const path = await window.electron.showProjectOpenDialog()
    if (path === null) return { outcome: 'cancelled' }
    const project = await openProjectFile(path)
    // An unreadable file carries a specific decode reason — forward its message
    // so the welcome banner names corruption plainly instead of the generic
    // "corrupt or API unreachable".
    if (isProjectOpenUnreadable(project)) {
      return { outcome: 'failed', path, message: project.reason.message }
    }
    // 'file-missing' is unreachable from the OS picker (it only returns files
    // that exist), so it folds into the ordinary failure outcome.
    if (project === null || project === 'file-missing') return { outcome: 'failed', path }
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
      // Fresh project starts with an empty manifest — no entities
      // yet. Imports + Interpretation creates will append.
      setManifestCptIds(new Set())
      setManifestBoreholeIds(new Set())
      setManifestFormationIds(new Set())
      setManifestSectionIds(new Set())
      // A new project has no lumping decision — reset both staging and
      // saved snapshots so prior-project state does not leak in. The
      // revision resets with them: a fresh row has never been staged, so
      // the first Apply must start the counter at 1.
      setCurrentLumping(null)
      setSavedLumping(null)
      applyLumpingRevision(null)
      // A fresh project has no save anchor yet; the first File → Save mints
      // one. Until then the file and the row agree by both having none.
      dbAnchorRef.current = null
      log.info('project', `created ${created.name} → ${path}`)
      return created
    },
    [adopt, applyLumpingRevision],
  )

  // Manifest mutators — wired into the import handlers + discard path
  // in App.tsx and into the Interpretation pane's create / delete
  // flow. Set-based so caller's iteration order doesn't matter.
  function setterForKind(kind: ManifestKind): typeof setManifestCptIds {
    switch (kind) {
      case 'cpt':
        return setManifestCptIds
      case 'borehole':
        return setManifestBoreholeIds
      case 'formation':
        return setManifestFormationIds
      case 'section':
        return setManifestSectionIds
    }
  }

  const addToManifest = useCallback((kind: ManifestKind, ids: Iterable<string>): void => {
    const setter = setterForKind(kind)
    setter(prev => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })
  }, [])

  const removeFromManifest = useCallback(
    (kind: ManifestKind, ids: Iterable<string>): void => {
      const setter = setterForKind(kind)
      setter(prev => {
        const next = new Set(prev)
        for (const id of ids) next.delete(id)
        return next
      })
    },
    [],
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

  // Reversible UI-chrome decisions (DEM toggle, hidden-by-type sets,
  // future view prefs) live in ``project.view_state``. Unlike metadata
  // changes — which queue under ``dirty`` until the user hits Save —
  // these auto-persist immediately so the toggle feels native and
  // the next .gmproj save bundles the current state. Updating BOTH
  // ``project`` and ``saved`` keeps ``dirty`` false through the
  // round-trip.
  const applyViewStatePatch = useCallback(
    async (patch: Record<string, unknown>): Promise<boolean> => {
      if (project === null) return false
      try {
        const updated = await api.project.patchViewState(project.id, patch)
        setProject(prev => (prev === null ? null : { ...prev, view_state: updated.view_state }))
        setSaved(prev => (prev === null ? null : { ...prev, view_state: updated.view_state }))
        log.info(
          'project',
          `view_state patched for ${project.id}: ${JSON.stringify(patch)}`,
        )
        return true
      } catch (err) {
        log.error('project', `view_state PATCH failed for ${project.id}`, err)
        return false
      }
    },
    [project],
  )

  // Stamp a save anchor on the project row and mirror it into the two
  // in-memory slots, so the token the file is about to carry and the token
  // the row carries are the same value.
  //
  // Writing BOTH ``project`` and ``saved`` keeps ``dirty`` false through
  // the round-trip — the anchor is bookkeeping, not an edit, and must never
  // make a freshly-saved project look unsaved. A failed PATCH is not fatal:
  // the row simply keeps the previous anchor, which reads as "the file on
  // disk is still the latest save" — the behaviour that predates anchors.
  const writeSaveAnchor = useCallback(
    async (projectId: string, anchor: string): Promise<boolean> => {
      try {
        await api.project.patchViewState(projectId, { [SAVE_ANCHOR_KEY]: anchor })
        dbAnchorRef.current = anchor
        // Truthiness, not ``=== null``: a project slot can also hold
        // ``undefined`` (an API wrapper that resolved nothing), and this
        // bookkeeping must never be the thing that throws inside a save.
        const stamp = (prev: ProjectResponse | null): ProjectResponse | null =>
          prev
            ? { ...prev, view_state: { ...prev.view_state, [SAVE_ANCHOR_KEY]: anchor } }
            : prev
        setProject(stamp)
        setSaved(stamp)
        log.debug('project', `save anchor ${anchor} stamped on ${projectId}`)
        return true
      } catch (err) {
        log.warn(
          'project',
          `save anchor PATCH failed for ${projectId}; the revert guard falls back ` +
            `to the previous anchor`,
          err,
        )
        return false
      }
    },
    [],
  )

  // File → Save / Ctrl+S / "Save and close" all funnel here. Returns
  // ``true`` only when the project reached BOTH of its durable homes — the
  // database and the .strix on disk — and ``false`` otherwise.
  //
  // WHY a failed file write is a failed save: this function used to log the
  // write failure and return ``true`` anyway, reasoning that the database
  // is the source of truth. It is not the only one. Close-without-save
  // replays the FILE over the database (``revertToLastSaved``), so a
  // silently-stale file is a live data-loss path — and the caller cleared
  // the dirty markers on the strength of that ``true``, hiding the failure
  // from the engineer entirely.
  const saveProject = useCallback(async (): Promise<boolean> => {
    if (project === null || filePath === null) return false
    // Cleared up front so a failure BEFORE the file write (the metadata
    // PATCH) can never leave the previous save's ``true`` standing.
    fileWriteSucceededRef.current = false
    saveAttemptedRef.current = true
    // Metadata PATCH is gated on the metadata-only ``dirty`` flag so
    // we don't round-trip identical values to the API. The file write
    // below is NOT gated — geological contacts / formations / models /
    // sections are all mutated via separate API calls that never flip
    // the metadata-dirty flag. Every Save MUST refetch the bundle and
    // rewrite the file or those changes silently miss the disk and
    // disappear on next open (a real user-reported data-loss bug).
    try {
      if (dirty) {
        const patch = fullPatchFrom(project)
        const updated = await api.project.update(project.id, patch)
        setProject(updated)
        setSaved(updated)
      }
      try {
        // Stamp this save's anchor on the project ROW *before* fetching
        // the bundle, so the bundle — and therefore the .strix about to be
        // written — carries the very same token. That pairing is what lets
        // ``revertToLastSaved`` tell "this file is the project's latest
        // save" from "this file is a copy, or the file of a save whose
        // write never landed": in both of those the row's token has moved
        // on and the file's has not.
        await writeSaveAnchor(project.id, mintSaveAnchor())
        // Fetch the full bundle (metadata + every CPT/series + every
        // borehole tree + every interpretation row) and write it to
        // disk. The file is the user's anchor — re-opening it after a
        // DB wipe must bring data back. Save is a relatively rare,
        // user-initiated action so the extra round-trip and JSON-
        // encoding cost (potentially MB for big projects) is
        // acceptable, even when nothing has changed since last save.
        const bundle = await api.project.bundle(project.id)
        // Trim every bundle-tracked top-level array to the in-memory
        // manifest before writing. The DB may carry rows from a
        // previous session that the user never saved (imports +
        // Ctrl+C kill, or formation / section creates that were
        // never committed to file). The manifest reflects what's
        // actually displayed in this session, so writing it to disk
        // keeps the .strix truthful. The DB rows stay (DOV cache +
        // referential integrity preserved).
        // Formations referenced by ANY model contact must ride along
        // even when the manifest doesn't carry them — otherwise the
        // contact lands in the file with a dangling formation_id and
        // restore hits an FK violation on next open. This was a real
        // data-loss bug shape: auto-populate created formations
        // server-side, the user saved before the manifest fix, and
        // the contacts ended up orphan-referencing missing formations.
        // Litho and geotech models serialise ``contacts: []`` (the backend
        // skips contacts for the non-stratigraphic kinds) and carry their
        // formation references in ``litho_layers`` instead — so walking
        // contacts alone wrote a file whose litho layers pointed at
        // formations the same file did not contain. On a fresh DB those
        // layers are dropped as orphans on restore, and a "Don't Save"
        // revert is rejected outright by the backend's orphan guard.
        const referencedFormationIds = new Set<string>()
        for (const m of bundle.geological_models as Array<{
          contacts?: Array<{ formation_id?: string }>
          litho_layers?: Array<{ formation_id?: string }>
        }>) {
          for (const c of m.contacts ?? []) {
            if (c.formation_id) referencedFormationIds.add(c.formation_id)
          }
          for (const l of m.litho_layers ?? []) {
            if (l.formation_id) referencedFormationIds.add(l.formation_id)
          }
        }
        // Bundle entries are typed `Record<string, unknown>` (the
        // wire shape is dynamic; the file format owns its schema), so
        // every id-read needs an explicit narrowing to satisfy
        // `Set<string>.has(string)`. A small typed projection per
        // array keeps the cast localised to one expression.
        const idOf = (row: Record<string, unknown>): string =>
          typeof row.id === 'string' ? row.id : ''
        const trimmedBundle = {
          ...bundle,
          cpts: bundle.cpts.filter(c => manifestCptIds.has(idOf(c))),
          boreholes: bundle.boreholes.filter(b => manifestBoreholeIds.has(idOf(b))),
          geological_formations: bundle.geological_formations.filter(f => {
            const id = idOf(f)
            return manifestFormationIds.has(id) || referencedFormationIds.has(id)
          }),
          cross_sections: bundle.cross_sections.filter(s =>
            manifestSectionIds.has(idOf(s)),
          ),
        }
        // Refuse to write a file that contradicts itself. The walk above
        // is meant to make this unreachable; it fires only if a FUTURE
        // formation-referencing array is added and not walked — in which
        // case the engineer gets a failed save with a count, not a silently
        // broken anchor file that drops rows on the next open.
        const writtenFormationIds = new Set(
          trimmedBundle.geological_formations.map(f => idOf(f)),
        )
        const orphanIds = [...referencedFormationIds].filter(
          id => !writtenFormationIds.has(id),
        )
        if (orphanIds.length > 0) {
          throw new Error(
            `refusing to write a self-inconsistent .strix: ${orphanIds.length} ` +
              `formation(s) referenced by models are missing from the file ` +
              `(${orphanIds.slice(0, 5).join(', ')})`,
          )
        }
        await window.electron.writeProjectFile(
          filePath,
          // Pass currentLumping so the staged lumping map is written to disk.
          // The API bundle has no knowledge of the client-side lumping map;
          // the caller must pass it explicitly (see buildProjectFile docstring).
          serialiseProjectFile(buildProjectFile(trimmedBundle, currentLumping)),
        )
        // Align savedLumping with the written snapshot so the dirty flag
        // clears.  Done INSIDE the inner try so a file-write failure leaves
        // savedLumping unchanged (the project stays dirty for retry).
        setSavedLumping(currentLumping)
        // The delta now has a durable home on disk. Recorded for the crash-
        // recovery clear, which must NOT trust this function's return value
        // (see ``lastSaveWroteFile``).
        fileWriteSucceededRef.current = true
        // REPAIR BEFORE PROMOTE. ``stageLumping`` deliberately keeps the
        // user's map in memory when its PUT fails (the design's "file wins"
        // case, §3), so a backend blip during Apply leaves the DATABASE
        // holding an older map under an older revision. Promoting that would
        // copy the stale slot onto ``saved`` — and the recovery-file clear
        // that follows this save deletes the only other carrier of the newer
        // map, so the next open would seed the OLD map from the database
        // while the .strix just written holds the new one. Re-staging what is
        // actually in memory closes that window; the backend accepts an EQUAL
        // revision, so this is a no-op whenever the original stage landed.
        //
        // A null revision means no revision-aware client has ever staged this
        // project, so there is no staged slot to repair and nothing stale to
        // promote over — the open path seeds from the file in that case.
        const repairRevision = lumpingRevisionRef.current
        const stagedSlotIsCurrent =
          repairRevision === null ||
          (await stageToDatabase(project.id, currentLumping, repairRevision))
        // Mirror that alignment into the database. Gated on the file write
        // for the same reason savedLumping is — a save that never reached
        // disk is not a save.
        if (stagedSlotIsCurrent) {
          await promoteInDatabase(project.id)
        } else {
          log.warn(
            'project',
            `skipped lumping promote for ${project.id}: the staged slot could not be ` +
              `repaired to rev ${String(repairRevision)}, and promoting it would make ` +
              `the database's stale map permanent`,
          )
        }
      } catch (err) {
        // The bundle fetch or the file write failed: the database moved
        // but the engineer's anchor file did not. That is a FAILED save,
        // reported as one — the caller keeps the project dirty, leaves the
        // unsaved-changes dialog open for a retry, and never clears the
        // markers that are the only on-screen trace of the problem.
        // Crash recovery draws the same conclusion from the same event:
        // the session delta is still homeless, so its recovery file stays.
        fileWriteSucceededRef.current = false
        log.error(
          'project',
          `saveProject: ${project.name} was committed to the database but NOT written ` +
            `to ${filePath} — the file on disk is now a save behind`,
          err,
        )
        return false
      }
      log.success('project', `saved ${project.name}`)
      return true
    } catch (err) {
      log.error('project', 'saveProject failed', err)
      return false
    }
  }, [
    project,
    filePath,
    dirty,
    manifestCptIds,
    manifestBoreholeIds,
    manifestFormationIds,
    manifestSectionIds,
    currentLumping,
    stageToDatabase,
    promoteInDatabase,
    writeSaveAnchor,
  ])

  // Put the lumping's staged slot back onto the saved snapshot — the shared
  // "discard means discard" tail of BOTH discard surfaces: the close dialog's
  // "Discard all changes" (via revertToLastSaved) and the recovery prompt's
  // "Delete backup" (owner ruling 2026-08-03: "fully delete, no traces of
  // backup left" — without this, the one item the prompt itemises walks out
  // alive through its database home and the project reopens dirty with a map
  // the user just discarded). Re-stages the SAVED snapshot — possibly null —
  // under a fresh revision so staged == saved again, aligns the in-memory
  // slot, and PROMOTES: re-staging alone leaves every pre-columns project
  // (map in .strix, both columns NULL) reading staged !== saved forever.
  const resetStagedLumpingToSaved = useCallback(async (): Promise<void> => {
    if (project === null) return
    const revertRevision = nextLumpingRevision(lumpingRevisionRef.current)
    applyLumpingRevision(revertRevision)
    setCurrentLumping(savedLumping)
    const restaged = await stageToDatabase(project.id, savedLumping, revertRevision)
    if (restaged) {
      await promoteInDatabase(project.id)
    } else {
      log.warn(
        'project',
        `skipped lumping promote for ${project.id} after discard: the saved snapshot ` +
          `could not be re-staged (rev ${revertRevision}), so promoting would copy the ` +
          `discarded map into the saved slot`,
      )
    }
  }, [project, savedLumping, applyLumpingRevision, stageToDatabase, promoteInDatabase])

  // Revert-to-last-save (#160). Re-read the .gmproj file (the canonical
  // last-saved snapshot) and POST it to /restore?replace=true so the DB's
  // child collections are wiped + re-inserted to match the file EXACTLY —
  // undoing every session create, mutation, AND delete. Backs the close-
  // flow "Don't Save" branch: closing reverts the DB so the next open of
  // this project is clean. The file on disk is never touched.
  //
  // The four outcomes are NOT interchangeable — see
  // ``RevertToLastSavedResult``. ``'no-snapshot'`` (never-saved project) is
  // the only one that licenses the caller to delete the session's creates;
  // a refusal or a thrown failure means the caller must change nothing.
  const revertToLastSaved = useCallback(async (): Promise<RevertToLastSavedResult> => {
    if (project === null || filePath === null) return 'no-snapshot'
    try {
      const readResult = await window.electron.readProjectFile(filePath)
      if (!readResult.ok) {
        // A damaged / truncated / newer container. Log the SPECIFIC codec
        // reason (a corrupt restore file is exactly the RAM-corruption case),
        // but keep the graceful 'failed' outcome — the caller must change
        // nothing (the session's creates may be in this file) and, above all,
        // a failed read here must never brick Close.
        log.error(
          'project',
          `revertToLastSaved: unreadable .strix at ${filePath} — ` +
            `${readResult.reason.code}: ${readResult.reason.message}`,
        )
        return 'failed'
      }
      const parsed = parseProjectFile(readResult.json)
      if (parsed === null) {
        // A file exists and cannot be read back. That is a FAILURE, not an
        // absent snapshot: the session's creates may well be in it, so
        // deleting them would destroy work this build simply cannot parse.
        log.error('project', `revertToLastSaved: unrecognisable .gmproj at ${filePath}`)
        return 'failed'
      }
      // SAVE-ANCHOR GATE. ``replace=true`` wipes every child collection of
      // the project — models, contacts, correlation edges, bodies,
      // sections, reviews, CPTs, boreholes — and re-inserts the file's.
      // The project id proves nothing about which file this is: a byte
      // copy of a .strix (a backup the engineer made in Explorer) names
      // the same project. Only the anchor distinguishes "this project's
      // latest save" from "a snapshot from last week" or "the file of a
      // save whose write never landed". Refuse anything else — the caller
      // falls back to the non-destructive discard path.
      //
      // A null row anchor means the project has never been saved by an
      // anchor-aware build, so there is nothing to compare and the revert
      // behaves exactly as it did before anchors existed.
      const dbAnchor = dbAnchorRef.current
      const fileAnchor = saveAnchorOfFile(parsed)
      if (dbAnchor !== null && fileAnchor !== dbAnchor) {
        log.error(
          'project',
          `revertToLastSaved REFUSED for ${filePath}: this file is not ${project.name}'s ` +
            `latest save (file anchor ${String(fileAnchor)}, project row ${dbAnchor}). ` +
            `Replacing the database from it would delete everything saved since.`,
        )
        return 'refused-not-latest-save'
      }
      // Pass the full v3 collection set through the shared enumeration —
      // the same one the DB-lost restore uses, so the two cannot drift.
      await withSlowRestoreHint(
        api.project.restore(project.id, restorePayloadFrom(parsed), true),
        () => toastRef.current?.('warning', t('project.restoreWaitingToast')),
      )
      // The anchor is deliberately NOT touched here. ``replace=true``
      // rewinds the project's CHILDREN but leaves the project row's own
      // metadata alone ("project already exists — leaving metadata
      // untouched", bundle_restore_core), so the row still carries the
      // anchor it had — which is the one this file just matched.
      // Discard means discard — including in the database's staged slot.
      // The replace-restore rewinds the project's children to the file, but
      // the lumping map lives in its own column and would otherwise keep
      // holding the map the user just threw away, resurrecting it on the
      // next open (which now seeds from the database).
      await resetStagedLumpingToSaved()
      log.success('project', `reverted ${project.name} to last save (${filePath})`)
      return 'reverted'
    } catch (err) {
      log.error('project', `revertToLastSaved failed for ${filePath}`, err)
      return 'failed'
    }
  }, [project, filePath, resetStagedLumpingToSaved])

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

    let dupBundle
    try {
      // Save As writes a full bundle for the duplicate too — the
      // duplicated DB row already has its own CPTs / boreholes
      // (deep-cloned by ``POST /projects/{id}/duplicate``), so the
      // bundle endpoint returns everything we need. No trim applied
      // because the duplicate is freshly minted (no extras yet).
      dupBundle = await api.project.bundle(duplicated.id)
      // WHY carry currentLumping: the lumping map is keyed on NORMALISED
      // STRATIGRAPHY NAMES (not borehole or CPT instance ids), so it is
      // valid for a duplicate — the copy has the same stratigraphy names.
      // Dropping it would silently lose a per-project engineering decision
      // and violate the bundle-is-the-anchor invariant documented in
      // memory/project_decisions_in_bundle.md.
      await window.electron.writeProjectFile(
        path,
        serialiseProjectFile(buildProjectFile(dupBundle, currentLumping)),
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
    // The file just written IS the duplicate's first save, and it carries
    // whatever anchor the duplicate's copied ``view_state`` holds — so the
    // two agree from the start. (``duplicate()`` copies ``view_state``,
    // debt #267.)
    dbAnchorRef.current = saveAnchorOf(
      (dupBundle.project as Record<string, unknown>).view_state,
    )
    // Reseed manifest from the duplicate's bundle. The new project is
    // now the live one, so its manifest reflects the cloned content
    // across every bundle-tracked entity.
    // Bundle entries are `Record<string, unknown>`, so the .map walks
    // pass through the same `idOf` narrowing the trimming pass uses
    // above. Inline equivalent: assert id is a string per row.
    setManifestCptIds(
      new Set(dupBundle.cpts.map(c => (typeof c.id === 'string' ? c.id : ''))),
    )
    setManifestBoreholeIds(
      new Set(dupBundle.boreholes.map(b => (typeof b.id === 'string' ? b.id : ''))),
    )
    setManifestFormationIds(new Set(idsFromBundle(dupBundle.geological_formations)))
    setManifestSectionIds(new Set(idsFromBundle(dupBundle.cross_sections)))
    // The file we just wrote carries currentLumping — align savedLumping
    // so dirty correctly reports false after Save As. Without this,
    // a project that has a staged (unsaved) lumping would open dirty
    // immediately after Save As, which is wrong.
    setSavedLumping(currentLumping)
    // The duplicate carries the source's lumping columns forward (the
    // backend's ``duplicate()`` copies all three — debt #267), so the counter
    // continues from the COPIED value; restarting at 1 would collide with the
    // revision the new row already stores and the monotonic guard would 409
    // it. Stage-then-promote leaves the duplicate's staged and saved slots
    // both holding exactly what the file we just wrote holds, so the copy
    // opens clean instead of inheriting the source's older saved snapshot.
    const dupRevision = nextLumpingRevision(duplicated.stratigraphy_lumping_revision ?? null)
    applyLumpingRevision(dupRevision)
    await stageToDatabase(duplicated.id, currentLumping, dupRevision)
    await promoteInDatabase(duplicated.id)
    log.info('project', `saved-as ${duplicated.name} → ${path}`)
    return duplicated
  }, [
    project,
    adopt,
    currentLumping,
    applyLumpingRevision,
    stageToDatabase,
    promoteInDatabase,
  ])

  function clearAllManifests(): void {
    setManifestCptIds(new Set())
    setManifestBoreholeIds(new Set())
    setManifestFormationIds(new Set())
    setManifestSectionIds(new Set())
    setCurrentLumping(null)
    setSavedLumping(null)
    // The counter belongs to the project that just closed; leaving it set
    // would let the next project's first Apply claim a revision it never
    // earned (and, if that project sits higher, silently lose the guard).
    applyLumpingRevision(null)
    // Same reasoning for the anchor: carrying the closed project's token
    // into the next open would compare two unrelated projects' saves.
    dbAnchorRef.current = null
  }

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
    clearAllManifests()
  }, [project])

  const closeProject = useCallback((): void => {
    setProject(null)
    setSaved(null)
    setFilePath(null)
    clearAllManifests()
  }, [])

  // Stage a lumping snapshot and mark the project dirty.
  //
  // WHY no .gmproj write: the old ``writeLumpingSnapshot`` rewrote the file
  // immediately on Apply, which violated the two-stage save model — the
  // lumping survived a close-without-save, defeating the user's "discard
  // means discard" expectation. This function updates currentLumping (which
  // rides into every subsequent buildProjectFile call) and leaves
  // savedLumping alone, so dirty becomes true exactly as if the user had
  // edited a metadata field. File→Save writes the file and aligns both.
  //
  // WHY the staged PUT is nonetheless immediate: the staged COLUMN is a
  // staging area, not the user's artefact — the same thing ``view_state``
  // already does. Writing it on Apply is what makes a crash before File→Save
  // survivable, and ``staged !== saved`` stays the dirty signal either way.
  //
  // The in-memory stage is deliberately NOT rolled back when the PUT fails:
  // the user's decision stands, and the recovery file then carries a higher
  // revision than the database — which is exactly the reconciliation case
  // the file-wins rule exists for (docs/design/autosave-recovery.md §3).
  const stageLumping = useCallback(
    async (lumping: StratigraphyLumping | null, explicitRevision?: number): Promise<void> => {
      // An explicit revision is the crash-recovery replay path (§3): the
      // recovery file carries a number the staged PUT never delivered, so the
      // replay claims exactly that number. Bumping instead would leave the
      // database permanently one or more revisions behind the file it just
      // recovered from.
      const revision = explicitRevision ?? nextLumpingRevision(lumpingRevisionRef.current)
      setCurrentLumping(lumping)
      applyLumpingRevision(revision)
      const size = lumping === null ? 'cleared' : `map size ${Object.keys(lumping.map).length}`
      log.debug('project', `stageLumping: staged snapshot (${size}, rev ${revision})`)
      if (project === null) {
        // No project id to write against (never happens through the Apply
        // flow, which requires an open project) — the in-memory stage still
        // stands and File→Save will carry it to disk.
        log.warn('project', 'stageLumping: no open project, staged in memory only')
        return
      }
      await stageToDatabase(project.id, lumping, revision)
    },
    [project, applyLumpingRevision, stageToDatabase],
  )

  return {
    project,
    saved,
    dirty,
    filePath,
    currentLumping,
    savedLumping,
    lumpingRevision,
    manifestCptIds,
    manifestBoreholeIds,
    manifestFormationIds,
    manifestSectionIds,
    newProject,
    openProjectFile,
    pickAndOpenProject,
    addToManifest,
    removeFromManifest,
    applyMetadataDraft,
    applyViewStatePatch,
    saveProject,
    lastSaveWroteFile,
    recoveryClearAllowed,
    revertToLastSaved,
    resetStagedLumpingToSaved,
    saveAsProject,
    discardEdits,
    archiveCurrent,
    closeProject,
    stageLumping,
  }
}
