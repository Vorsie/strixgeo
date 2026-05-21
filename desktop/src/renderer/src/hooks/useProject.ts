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
import type { StratigraphyLumping } from '../utils/projectFile'

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
  /**
   * Stage a lumping snapshot in-memory and mark the project dirty.
   * Called immediately after a Fill-from-boreholes Apply confirm so the
   * user's grouping flips the dirty flag and persists only when the user
   * explicitly File→Saves — exactly like an unsaved metadata edit.
   *
   * WHY in-memory only (not immediate disk write): the old behaviour
   * (``writeLumpingSnapshot``) wrote the .gmproj file immediately on Apply,
   * which violated the two-stage save model — the lumping "stuck" even
   * without a File→Save.  Aligning it with the save model gives the user
   * a consistent mental model: close without saving → lumping is gone,
   * exactly like an unsaved CPT import or an unsaved metadata change.
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

// Structural equality for two lumping snapshots.  Two nulls are equal;
// a null vs a non-null are not.  When both are non-null, the maps are
// compared key-by-key (not reference equality, because stageLumping
// produces a new object reference each call).
//
// schema_version and applied_at are intentionally excluded from the
// comparison: applied_at is a timestamp that changes on every Apply even
// when the alias map hasn't changed, and schema_version is structural
// metadata not an engineering decision.  The engineering decision is the
// map contents — if the map is identical the user didn't make a new
// decision and the project shouldn't go dirty.
function lumpingsEqual(
  a: StratigraphyLumping | null,
  b: StratigraphyLumping | null,
): boolean {
  if (a === b) return true
  if (a === null || b === null) return false
  const keysA = Object.keys(a.map)
  const keysB = Object.keys(b.map)
  if (keysA.length !== keysB.length) return false
  for (const k of keysA) {
    if (a.map[k] !== b.map[k]) return false
  }
  return true
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

export function useProject(): UseProject {
  const [project, setProject] = useState<ProjectResponse | null>(null)
  const [saved, setSaved] = useState<ProjectResponse | null>(null)
  const [filePath, setFilePath] = useState<string | null>(null)

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
        // Seed the manifest from the file's bundle. The .strix file
        // is the user's anchor — anything in the DB but NOT in the
        // file is treated as "unsaved from a previous session" and
        // stays invisible until the user re-creates it. Ctrl+C kills
        // can't leak imported / added rows back into view this way.
        setManifestCptIds(new Set(idsFromBundle(parsed.cpts)))
        setManifestBoreholeIds(new Set(idsFromBundle(parsed.boreholes)))
        setManifestFormationIds(new Set(idsFromBundle(parsed.geological_formations)))
        setManifestSectionIds(new Set(idsFromBundle(parsed.cross_sections)))
        // Seed both lumping slots from the file so the dirty flag starts
        // clean (currentLumping === savedLumping after open).  Bundles
        // saved before this field existed carry null.
        const seededLumping = parsed.stratigraphy_lumping ?? null
        setCurrentLumping(seededLumping)
        setSavedLumping(seededLumping)
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
              geological_formations: parsed.geological_formations,
              // geotechnical_units was added to the v3 schema after
              // the initial restore wiring landed; omitting it here
              // silently drops every saved unit on a 404→restore
              // open. Backend defaults to empty list if missing,
              // which is exactly the data-loss path we want to avoid.
              geotechnical_units: parsed.geotechnical_units,
              geological_models: parsed.geological_models,
              cross_sections: parsed.cross_sections,
              investigation_reviews: parsed.investigation_reviews,
            })
            await adopt(restored, path)
            // Same manifest seeding as the happy path — the .strix
            // file is now the authoritative list of every
            // bundle-tracked entity this project sees.
            setManifestCptIds(new Set(idsFromBundle(parsed.cpts)))
            setManifestBoreholeIds(new Set(idsFromBundle(parsed.boreholes)))
            setManifestFormationIds(new Set(idsFromBundle(parsed.geological_formations)))
            setManifestSectionIds(new Set(idsFromBundle(parsed.cross_sections)))
            // Seed both lumping slots on restore — same pattern as the happy path.
            const restoredLumping = parsed.stratigraphy_lumping ?? null
            setCurrentLumping(restoredLumping)
            setSavedLumping(restoredLumping)
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
                `+${parsed.geotechnical_units.length} geotech units, ` +
                `+${parsed.geological_models.length} models ` +
                `(+${contactCount} contacts), ` +
                `+${parsed.cross_sections.length} sections, ` +
                `+${parsed.investigation_reviews.length} reviews)`,
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
      // Fresh project starts with an empty manifest — no entities
      // yet. Imports + Interpretation creates will append.
      setManifestCptIds(new Set())
      setManifestBoreholeIds(new Set())
      setManifestFormationIds(new Set())
      setManifestSectionIds(new Set())
      // A new project has no lumping decision — reset both staging and
      // saved snapshots so prior-project state does not leak in.
      setCurrentLumping(null)
      setSavedLumping(null)
      log.info('project', `created ${created.name} → ${path}`)
      return created
    },
    [adopt],
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

  // File → Save / Ctrl+S / "Save and close" all funnel here. Returns
  // ``true`` on success (or when the project is already clean — a
  // silent no-op), ``false`` on failure.
  const saveProject = useCallback(async (): Promise<boolean> => {
    if (project === null || filePath === null) return false
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
        const referencedFormationIds = new Set<string>()
        for (const m of bundle.geological_models as Array<{
          contacts?: Array<{ formation_id?: string }>
        }>) {
          for (const c of m.contacts ?? []) {
            if (c.formation_id) referencedFormationIds.add(c.formation_id)
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
      } catch (err) {
        // File write failure leaves the DB ahead of the file. Log loudly
        // but treat as success — the next save will catch up, and the
        // DB is the source of truth.
        log.warn('project', 'file write after saveProject failed', err)
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
  ])

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
    log.info('project', `saved-as ${duplicated.name} → ${path}`)
    return duplicated
  }, [project, adopt, currentLumping])

  function clearAllManifests(): void {
    setManifestCptIds(new Set())
    setManifestBoreholeIds(new Set())
    setManifestFormationIds(new Set())
    setManifestSectionIds(new Set())
    setCurrentLumping(null)
    setSavedLumping(null)
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

  // Stage a lumping snapshot in-memory and mark the project dirty.
  //
  // WHY no disk write: the old ``writeLumpingSnapshot`` wrote the .gmproj
  // immediately on Apply, which violated the two-stage save model — the
  // lumping survived a close-without-save, defeating the user's "discard
  // means discard" expectation.  This function is the aligned replacement:
  // it updates currentLumping (which is included in every subsequent
  // buildProjectFile call) and because savedLumping is left unchanged,
  // dirty becomes true — exactly as if the user had edited a metadata field.
  // File→Save then writes the lumping and aligns savedLumping.
  const stageLumping = useCallback(
    (lumping: StratigraphyLumping): void => {
      setCurrentLumping(lumping)
      log.debug('project', `stageLumping: staged lumping snapshot (map size ${Object.keys(lumping.map).length})`)
    },
    [],
  )

  return {
    project,
    saved,
    dirty,
    filePath,
    currentLumping,
    savedLumping,
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
    saveAsProject,
    discardEdits,
    archiveCurrent,
    closeProject,
    stageLumping,
  }
}
