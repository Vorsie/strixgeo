import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Map as MapIcon, BarChart2, AlertTriangle, CheckCircle } from 'lucide-react'
import L from 'leaflet'
import {
  api,
  setBaseUrl,
  DuplicateContactError,
  DuplicateCptError,
} from './api/client'
import type {
  BoreholeAxis,
  BoreholeDetailResponse,
  BoreholeListItem,
  CptListItem,
  CptPlotResponse,
  CptResponse,
  CrossSectionResponse,
  FormationContactBatchUpdateEntry,
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalFormationCreatePayload,
  GeologicalFormationResponse,
  GeologicalModelResponse,
} from './api/client'
import { useProject } from './hooks/useProject'
import { useUndoStack } from './hooks/useUndoStack'
import { usePersistedSet } from './hooks/usePersistedSet'
import { useTheme } from './hooks/useTheme'
import { wgs84ToProjected } from './hooks/useWgs84'
import { isTypingTarget } from './utils/keyboard'
import { log } from './utils/log'
import { idsOutsideBounds } from './utils/viewportFilter'
import { addAllToSet } from './utils/sets'
import {
  demSourceForEpsg,
  readDemOverlay,
  type DemOverlayState,
} from './utils/demSources'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import MapView from './components/MapView'
import CptChart from './components/CptChart'
import BoreholeLog from './components/BoreholeLog'
import SectionPanel from './components/SectionPanel'
import WelcomeScreen from './components/WelcomeScreen'
import NewProjectDialog from './components/NewProjectDialog'
import ProjectMetadataDialog from './components/ProjectMetadataDialog'
import UnsavedChangesDialog from './components/UnsavedChangesDialog'
import Modal from './components/ui/Modal'
import Button from './components/ui/Button'

interface RecentProject {
  path: string
  name: string
  lastOpened: string
}

declare global {
  interface Window {
    electron: {
      getApiBaseUrl: () => Promise<string>
      waitForApi: () => Promise<boolean>
      openFile: (filters: Electron.FileFilter[]) => Promise<string | null>
      openFiles: (filters: Electron.FileFilter[]) => Promise<string[]>
      readFile: (filePath: string) => Promise<Buffer>
      // Project file lifecycle (Phase 4 multi-project)
      showProjectOpenDialog: () => Promise<string | null>
      showProjectSaveDialog: (defaultName?: string) => Promise<string | null>
      readProjectFile: (filePath: string) => Promise<string>
      writeProjectFile: (filePath: string, contents: string) => Promise<void>
      // Generic export save-dialog + binary write (v1.0 MVP gate #5).
      showExportSaveDialog: (
        defaultName: string,
        filters: Electron.FileFilter[],
      ) => Promise<string | null>
      writeExportFile: (filePath: string, contents: ArrayBuffer) => Promise<void>
      addRecentProject: (filePath: string, name: string) => Promise<RecentProject[]>
      getRecentProjects: () => Promise<RecentProject[]>
      setWindowTitle: (title: string | null) => Promise<void>
      onAppBeforeQuit: (cb: () => void) => () => void
      notifyQuitDecision: (allowed: boolean) => Promise<void>
      onMenuImportCpt: (cb: () => void) => () => void
      onMenuImportBorehole: (cb: () => void) => () => void
      onMenuProjectNew: (cb: () => void) => () => void
      onMenuProjectOpen: (cb: () => void) => () => void
      onMenuProjectSave: (cb: () => void) => () => void
      onMenuProjectSaveAs: (cb: () => void) => () => void
      onMenuProjectClose: (cb: () => void) => () => void
      onMenuProjectOpenRecent: (cb: (path: string) => void) => () => void
    }
  }
}

type View = 'map' | 'chart'

// The bbox-draw flow can be triggered for either CPT or borehole imports.
// `null` means the user isn't in draw mode; the value tells `handleBboxDrawn`
// which API to call when the rectangle is committed.
type BboxImportType = 'cpt' | 'borehole' | null

interface Toast {
  id: number
  type: 'success' | 'error'
  message: string
}

export default function App() {
  const {
    project,
    saved: savedProject,
    dirty: metadataDirty,
    filePath: projectFilePath,
    manifestCptIds,
    manifestBoreholeIds,
    manifestFormationIds,
    manifestSectionIds,
    addToManifest,
    removeFromManifest,
    newProject,
    openProjectFile,
    pickAndOpenProject,
    applyMetadataDraft,
    applyViewStatePatch,
    saveProject: saveMetadata,
    saveAsProject,
    closeProject,
  } = useProject()
  // Controls the NewProjectDialog modal visibility. Triggered by the File
  // menu's New Project item or the Welcome screen's Create button.
  const [newProjectOpen, setNewProjectOpen] = useState(false)
  // Controls the ProjectMetadataDialog modal — opens from the sidebar's
  // project-name button. Open only when a project is loaded. The editor
  // commits its drafts to the live project state via applyMetadataDraft;
  // the project-level ``projectDirty`` (live vs saved) is what gates
  // close-without-save prompts and the File menu's Save state.
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
  // Initialise the theme system. The hook itself owns the class on
  // <html>; we don't need to consume ``resolved``/``setChoice`` until a
  // theme-toggle UI lands (UX Conventions in CLAUDE.md flagged that as
  // a future task — calling the hook here ensures system-preference
  // tracking is active from app start).
  useTheme()

  // Undo / redo for geological-model edits (debt #45). Each mutation
  // handler below pushes a Command after success; Ctrl+Z reverts,
  // Ctrl+Y / Ctrl+Shift+Z reapplies. The stack clears on project
  // switch (see the effect below).
  //
  // CRITICAL: destructure the hook's return into individual stable
  // callbacks. The wrapper object literal is rebuilt every render
  // (busy / canUndo / canRedo are state that changes); putting the
  // whole object into a useEffect / useCallback dep list creates an
  // infinite render loop because the dep is "new" every commit. The
  // four function fields below are individually useCallback-stable.
  const {
    push: pushUndo,
    undo: doUndo,
    redo: doRedo,
    clear: clearUndo,
  } = useUndoStack({
    onError: msg => toast('error', msg),
  })

  // Clear undo history whenever the project changes. Cross-project
  // undo is semantically undefined (the captured ids belong to the
  // old project's DB rows) and the safe move is to start fresh.
  useEffect(() => {
    clearUndo()
  }, [project?.id, clearUndo])

  // Keyboard listener — Ctrl+Z = undo, Ctrl+Y OR Ctrl+Shift+Z =
  // redo. Cmd on macOS, Ctrl on Windows/Linux. ``isTypingTarget``
  // gates so the bindings don't fight an active <input>.
  useEffect(() => {
    function handleKey(e: KeyboardEvent): void {
      if (isTypingTarget(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (!mod) return
      if (e.key === 'z' || e.key === 'Z') {
        e.preventDefault()
        if (e.shiftKey) {
          void doRedo()
        } else {
          void doUndo()
        }
      } else if (e.key === 'y' || e.key === 'Y') {
        e.preventDefault()
        void doRedo()
      }
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [doUndo, doRedo])

  const [ready, setReady] = useState(false)
  const [apiError, setApiError] = useState(false)
  const [cpts, setCpts] = useState<CptListItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detailMap, setDetailMap] = useState<Map<string, CptResponse>>(new Map())
  const [plotMap, setPlotMap] = useState<Map<string, CptPlotResponse>>(new Map())
  // Borehole-side state: list (for sidebar + map) + selected id + lazy detail
  // cache. Mutually exclusive with `selectedId` — selecting one clears the
  // other so only one detail panel is shown at a time.
  const [boreholes, setBoreholes] = useState<BoreholeListItem[]>([])
  const [selectedBoreholeId, setSelectedBoreholeId] = useState<string | null>(null)
  const [boreholeDetailMap, setBoreholeDetailMap] = useState<
    Map<string, BoreholeDetailResponse>
  >(new Map())
  const [view, setView] = useState<View>('map')
  const [importing, setImporting] = useState(false)
  const [bboxImportType, setBboxImportType] = useState<BboxImportType>(null)
  const [dovImporting, setDovImporting] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const toastId = useRef(0)
  // Cross-sections (Phase 4). List comes from the API on project load;
  // selecting a section will surface its panel in the main view in S2+.
  // For S1 the selection is wired but the main view still renders the
  // map / chart / borelog — section view comes next.
  const [sections, setSections] = useState<CrossSectionResponse[]>([])
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null)

  // Geological model state — lifted to App so SectionPanel can
  // render contacts with formation colours AND InterpretationPane
  // can manage the formations vocabulary without double-fetching.
  // Each project gets exactly one active model auto-bootstrapped on
  // first open; multi-model UX comes later.
  const [activeGeologicalModel, setActiveGeologicalModel] =
    useState<GeologicalModelResponse | null>(null)
  const [formations, setFormations] = useState<GeologicalFormationResponse[]>([])
  // Refresh signal for InterpretationPane. The pane keeps its own
  // formations cache; bumping this counter forces a refetch.
  // Bumped after auto-populate from stratigraphy because the new
  // formations land server-side, outside the pane's create-edit-
  // delete flow.
  const [formationsRefreshCounter, setFormationsRefreshCounter] = useState(0)
  const [contacts, setContacts] = useState<FormationContactResponse[]>([])
  // Cached TIN surfaces for the active geological model, keyed by
  // formation id. Recomputed server-side on every contact mutation
  // (debt #11), so the desktop just refetches after each commit. The
  // map shape is convenient because ContactsLayer's slice render
  // looks up "is there a surface for formation X?" per-formation.
  const [surfacesByFormationId, setSurfacesByFormationId] = useState<
    ReadonlyMap<string, FormationSurfaceResponse>
  >(new Map())
  // ``true`` while the user is two-click-drawing a section line on
  // the map. The Sidebar's "+ New cross-section" button enters this
  // mode; the MapView mounts a SectionLineDrawer that completes via
  // ``handleSectionLineDrawn`` below.
  const [drawingSection, setDrawingSection] = useState(false)

  // Layer-visibility state — lifted from MapView so the Sidebar can also
  // grey out + reorder hidden items. We track HIDDEN values (not visible
  // ones) so an empty set means "show everything", which avoids the
  // first-render flash that "visible-set + auto-init effect" would cause
  // every time a new type appears in the data.
  const [hiddenCptTypes, setHiddenCptTypes] = useState<Set<string>>(new Set())
  const [boreholeAxis, setBoreholeAxis] = useState<BoreholeAxis>('drill_method')
  const [hiddenBoreholeValues, setHiddenBoreholeValues] = useState<
    Record<BoreholeAxis, Set<string>>
  >({ drill_method: new Set(), borehole_type: new Set() })

  // Viewport-coupled sidebar — records whose marker is currently
  // outside the map's visible bounds get demoted to the greyed-out
  // hidden-bottom section of each tab. Always-on: items aren't hard-
  // hidden (still visible at opacity-40, still clickable, still counted
  // in the footer), so coupling the sidebar to the map's spatial scope
  // never surprises the user by removing things. ``viewportBounds ===
  // null`` (before the map has reported its initial bounds) treats
  // everything as in-viewport so the first render doesn't flash an
  // empty visible section.
  const [viewportBounds, setViewportBounds] = useState<L.LatLngBounds | null>(null)
  const handleViewportChange = useCallback((bounds: L.LatLngBounds) => {
    setViewportBounds(bounds)
  }, [])

  // Persist the Leaflet camera (center + zoom) across MapView
  // remounts. The map remounts whenever the user navigates
  // map → section panel → back; without this ref the viewport resets
  // to the Belgium-default frame, which is jarring after the user
  // already zoomed into a specific site. Held in a ref instead of
  // useState so updating it doesn't trigger a re-render of the App.
  const mapCameraRef = useRef<{ center: [number, number]; zoom: number } | null>(null)
  const handleMapCameraChange = useCallback(
    (center: [number, number], zoom: number) => {
      mapCameraRef.current = { center, zoom }
    },
    [],
  )

  const handleToggleCptType = useCallback((type: string, visible: boolean) => {
    setHiddenCptTypes(prev => {
      const next = new Set(prev)
      if (visible) next.delete(type)
      else next.add(type)
      return next
    })
  }, [])

  const handleToggleBoreholeValue = useCallback(
    (value: string, visible: boolean) => {
      setHiddenBoreholeValues(prev => {
        const nextAxis = new Set(prev[boreholeAxis])
        if (visible) nextAxis.delete(value)
        else nextAxis.add(value)
        return { ...prev, [boreholeAxis]: nextAxis }
      })
    },
    [boreholeAxis],
  )

  // Three id-keyed sets coordinate the project-scoped row visibility:
  //
  //   1. ``removedCptIds`` / ``removedBoreholeIds`` — project-local
  //      hide, derived from server-side investigation_review rows where
  //      ``is_hidden=true``. Bundle-persisted (rides in the .gmproj on
  //      save, restored on open), so hiding a CPT on PC A shows up
  //      hidden when PC B opens the same .gmproj. Locally maintained
  //      as a state Set for optimistic UX; the server is the source of
  //      truth and the load-on-project-change effect re-seeds it.
  //   2. ``sessionImportCptIds`` / ``sessionImportBoreholeIds`` — rows
  //      added since the last File → Save. Persisted to localStorage.
  //      Drives the project-level dirty signal. Cleared by saveProject.
  //   3. ``selectedForRemoval`` (in Sidebar) — multi-select for the
  //      bulk-remove action. Ephemeral, reset on tab switch.
  const [removedCptIds, setRemovedCptIds] = useState<Set<string>>(new Set())
  const [removedBoreholeIds, setRemovedBoreholeIds] = useState<Set<string>>(new Set())

  // Reload the removed-sets from the server whenever the project
  // changes. The .gmproj-restore path will have pushed the saved
  // is_hidden state into the DB before this fires; the GET picks up
  // exactly what should be hidden in this session. Empty fallback on
  // failure so the user sees ALL rows rather than nothing.
  useEffect(() => {
    if (!project) {
      setRemovedCptIds(new Set())
      setRemovedBoreholeIds(new Set())
      return
    }
    let cancelled = false
    api.review
      .list(project.id)
      .then(reviews => {
        if (cancelled) return
        const cptHidden = new Set<string>()
        const bhHidden = new Set<string>()
        for (const r of reviews) {
          if (!r.is_hidden) continue
          if (r.target_kind === 'cpt') cptHidden.add(r.target_id)
          else if (r.target_kind === 'borehole') bhHidden.add(r.target_id)
        }
        setRemovedCptIds(cptHidden)
        setRemovedBoreholeIds(bhHidden)
      })
      .catch(err => {
        log.warn('reviews', `load failed for project ${project.id}`, err)
      })
    return () => {
      cancelled = true
    }
  }, [project])

  // Geological-model bootstrap + load.
  //
  // Every project carries exactly one active geological model in v1.
  // On project change we (1) fetch the model list, (2) pick the
  // active one, (3) auto-create a "Default" model if the project
  // has none, and (4) refresh the formations + contacts that the
  // editor surfaces (Ground model pane + cross-section overlay).
  //
  // The bootstrap-on-empty step is what makes the editor accessible
  // immediately after File → New — no separate "create model"
  // button to discover. Multi-model UX (named scenarios, model
  // comparison) lands later.
  useEffect(() => {
    if (!project) {
      setActiveGeologicalModel(null)
      setFormations([])
      setContacts([])
      setSurfacesByFormationId(new Map())
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const projectId = project.id
        // Step 1: model list. Bootstrap a default if empty.
        let models = await api.geology.listModels(projectId)
        let active = models.find(m => m.is_active) ?? null
        if (models.length === 0) {
          const created = await api.geology.createModel(projectId, {
            name: 'Default',
            is_active: true,
          })
          models = [created]
          active = created
          log.info('geology', `bootstrapped Default model for ${projectId}`)
        } else if (active === null) {
          // Models exist but none is active — activate the first
          // (alphabetical by name is fine; v1 has at most one).
          const promoted = await api.geology.activateModel(projectId, models[0].id)
          active = promoted
        }
        if (cancelled) return
        setActiveGeologicalModel(active)

        // Step 2: formations + contacts + surfaces in parallel.
        // Surfaces come from the per-mutation recompute cache; on a
        // freshly opened bundle they may already be populated (the
        // bundle round-trips them) so the section paints the slice on
        // first render — no recompute round-trip required.
        const [forms, conts, surfs] = await Promise.all([
          api.geology.listFormations(projectId),
          active === null
            ? Promise.resolve([] as FormationContactResponse[])
            : api.geology.listContacts(projectId, active.id),
          active === null
            ? Promise.resolve([] as FormationSurfaceResponse[])
            : api.geology.listSurfaces(projectId, active.id),
        ])
        if (cancelled) return
        setFormations(forms)
        setContacts(conts)
        const sm = new Map<string, FormationSurfaceResponse>()
        for (const s of surfs) sm.set(s.formation_id, s)
        setSurfacesByFormationId(sm)
      } catch (err) {
        log.warn('geology', `model bootstrap failed for ${project.id}`, err)
        if (!cancelled) {
          setActiveGeologicalModel(null)
          setFormations([])
          setContacts([])
          setSurfacesByFormationId(new Map())
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [project])

  // Session imports — records added since the last File → Save. Drives
  // the per-row amber asterisks in the sidebar AND the project-level
  // dirty signal (combined with metadata-dirty). Persists per project
  // across launches so closing the app without saving doesn't silently
  // drop the "these are unsaved" state.
  //
  // Discard semantics: rather than DELETE the rows from DB (which would
  // throw away the import-cache benefit on re-import), we move the IDs
  // into the project-local "removed" set. The rows stay in the DB,
  // hidden locally; re-importing the same DOV bbox dedups, hits the
  // existing rows, and the dedup branch already calls unhideCpts /
  // unhideBoreholes to restore visibility.
  const [sessionImportCptIds, setSessionImportCptIds] = usePersistedSet(
    project ? `groundmodel.session_imports.${project.id}.cpt` : undefined,
  )
  const [sessionImportBoreholeIds, setSessionImportBoreholeIds] = usePersistedSet(
    project ? `groundmodel.session_imports.${project.id}.borehole` : undefined,
  )
  // Interpretation pane (formations + cross-sections + later
  // geological models + contacts + geotech units) follows the same
  // manifest-dirty model as imports: created-but-not-yet-saved rows
  // sit in these sets so the user sees the amber visual AND the
  // project-level dirty asterisk until File → Save commits the
  // bundle to disk.
  const [sessionImportFormationIds, setSessionImportFormationIds] = usePersistedSet(
    project ? `groundmodel.session_imports.${project.id}.formation` : undefined,
  )
  const [sessionImportSectionIds, setSessionImportSectionIds] = usePersistedSet(
    project ? `groundmodel.session_imports.${project.id}.section` : undefined,
  )
  // Formation contacts created in this session. Drives the project-
  // level dirty flag. Manifest-trim of nested model.contacts is
  // deferred — bundle.geological_models passes through as opaque
  // dicts, so contacts persist across save without further plumbing.
  const [sessionImportContactIds, setSessionImportContactIds] = usePersistedSet(
    project ? `groundmodel.session_imports.${project.id}.contact` : undefined,
  )

  // Combined "is anything unsaved?" flag. Drives the sidebar / window-
  // title asterisks, the close-attempt branching, and the File → Save
  // no-op-when-clean check.
  const projectDirty =
    metadataDirty ||
    sessionImportCptIds.size > 0 ||
    sessionImportBoreholeIds.size > 0 ||
    sessionImportFormationIds.size > 0 ||
    sessionImportSectionIds.size > 0 ||
    sessionImportContactIds.size > 0

  // saveProject orchestration — commits metadata then clears every
  // session-imports set so the project lands clean. Failure of any
  // step leaves the dirty flag intact for retry.
  //
  // On-click build pivot: auto-fire ``Build model`` before the
  // metadata save so the .strix bundle round-trips a fresh cache,
  // not yesterday's geometry. Build failures DO NOT block save —
  // the user's work must always persist; we just toast the failure.
  const saveProject = useCallback(async (): Promise<boolean> => {
    if (project && activeGeologicalModel) {
      try {
        await api.geology.rebuildSurfaces(project.id, activeGeologicalModel.id)
        // Refetch surfaces inline rather than calling the memoised
        // ``refetchSurfaces`` callback — that callback is declared
        // further down the App body, so closing over it here would
        // TDZ at the deps line. Same listSurfaces call, just the
        // body unwrapped.
        try {
          const surfs = await api.geology.listSurfaces(
            project.id,
            activeGeologicalModel.id,
          )
          const sm = new Map<string, FormationSurfaceResponse>()
          for (const s of surfs) sm.set(s.formation_id, s)
          setSurfacesByFormationId(sm)
        } catch (err) {
          log.warn('geology', 'listSurfaces after auto-build failed', err)
        }
        log.success('geology', 'auto-build before save: ok')
      } catch (err) {
        log.warn('geology', 'auto-build before save failed — saving anyway', err)
        toast(
          'error',
          'Could not build the model before saving — file saved with the previous build.',
        )
      }
    }
    const ok = await saveMetadata()
    if (!ok) return false
    setSessionImportCptIds(new Set())
    setSessionImportBoreholeIds(new Set())
    setSessionImportFormationIds(new Set())
    setSessionImportSectionIds(new Set())
    setSessionImportContactIds(new Set())
    return true
  }, [
    project,
    activeGeologicalModel,
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
    if (
      project &&
      activeGeologicalModel &&
      sessionImportContactIds.size > 0
    ) {
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
      setContacts(prev => prev.filter(c => !sessionImportContactIds.has(c.id)))
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
  ])

  // Interpretation-pane callbacks. When the user creates / deletes a
  // formation or section via the pane, we update the manifest + the
  // session-imports set in lockstep so the dirty signal flips
  // immediately and the per-row amber visual lights up.
  //
  // Formations are also kept in App.formations state (consumed by
  // SectionPanel's FormationPickerDialog + ContactsLayer), so each
  // mutation triggers a re-fetch — that way a formation the user
  // just created in the Ground model pane shows up in the picker
  // the next time they click the section. One extra GET per
  // mutation is cheap at typical project cardinality (dozens of
  // formations); promote to a structured-callback shape if a
  // benchmark says otherwise.
  const refetchFormations = useCallback(() => {
    if (!project) return
    void api.geology
      .listFormations(project.id)
      .then(setFormations)
      .catch(err => {
        log.warn('geology', `listFormations refetch failed`, err)
      })
  }, [project])

  // Refetch the per-formation TIN cache. Called after any contact
  // mutation (create / update / delete / batch / auto-populate /
  // dedupe) so the section's slice render tracks the new geometry.
  // Backend recomputes synchronously inside each mutation handler
  // (debt #11), so by the time we call this the cache is already
  // current. Cheap: one GET per mutation, payload is bounded by
  // (formations × triangles) which is tiny at v1 cardinality.
  const refetchSurfaces = useCallback(() => {
    if (!project || !activeGeologicalModel) return
    void api.geology
      .listSurfaces(project.id, activeGeologicalModel.id)
      .then(surfs => {
        const sm = new Map<string, FormationSurfaceResponse>()
        for (const s of surfs) sm.set(s.formation_id, s)
        setSurfacesByFormationId(sm)
      })
      .catch(err => {
        log.warn('geology', `listSurfaces refetch failed`, err)
      })
  }, [project, activeGeologicalModel])

  // Auto-refetch surfaces after any contact mutation. ``contacts``
  // identity changes exactly once per mutation handler (each one
  // calls setContacts), so this useEffect fires once per mutation
  // without per-handler bookkeeping. Post on-click build pivot: the
  // refetch returns is_stale=true for surfaces of formations whose
  // contacts changed (per-edit handlers flip the flag rather than
  // recompute), and is_stale=false after AutoPopulate / Dedupe
  // (those still trigger Delaunay synchronously). Either way the
  // GET reflects the current cache state. Skips on the bootstrap-
  // initial setContacts because the bootstrap already fetched
  // surfaces in parallel. Same trigger bumps the crossings refresh
  // signal so the InterpretationPane's validator banner re-runs
  // whenever picks change.
  const lastSurfaceRefetchContactsRef = useRef<readonly FormationContactResponse[] | null>(null)
  const [crossingsRefreshCounter, setCrossingsRefreshCounter] = useState(0)
  useEffect(() => {
    if (lastSurfaceRefetchContactsRef.current === null) {
      // First observation — bootstrap already fetched. Just record.
      lastSurfaceRefetchContactsRef.current = contacts
      return
    }
    if (lastSurfaceRefetchContactsRef.current === contacts) return
    lastSurfaceRefetchContactsRef.current = contacts
    refetchSurfaces()
    setCrossingsRefreshCounter(c => c + 1)
  }, [contacts, refetchSurfaces])

  const handleFormationCreated = useCallback(
    (id: string) => {
      addToManifest('formation', [id])
      addAllToSet(setSessionImportFormationIds, [id])
      refetchFormations()
    },
    [addToManifest, setSessionImportFormationIds, refetchFormations],
  )
  const handleFormationUpdated = useCallback(() => {
    // No manifest / dirty change on update (the formation is already
    // in the manifest); just resync the cached list so renames and
    // recolour land in the picker + section overlay.
    refetchFormations()
  }, [refetchFormations])
  const handleFormationDeleted = useCallback(
    (id: string) => {
      removeFromManifest('formation', [id])
      setSessionImportFormationIds(prev => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      refetchFormations()
    },
    [removeFromManifest, setSessionImportFormationIds, refetchFormations],
  )
  const handleSectionCreated = useCallback(
    (id: string) => {
      addToManifest('section', [id])
      addAllToSet(setSessionImportSectionIds, [id])
    },
    [addToManifest, setSessionImportSectionIds],
  )
  const handleSectionDeleted = useCallback(
    (id: string) => {
      removeFromManifest('section', [id])
      setSessionImportSectionIds(prev => {
        if (!prev.has(id)) return prev
        const next = new Set(prev)
        next.delete(id)
        return next
      })
    },
    [removeFromManifest, setSessionImportSectionIds],
  )

  // Inline formation create — fired from the formation picker
  // modal's "+ New formation here" affordance during the click-to-
  // place flow. Mirrors the InterpretationPane's handleCreate but
  // routed through App so the new formation lands in App's state
  // (SectionPanel needs it for the next contact placement) and
  // also flips the project dirty.
  const handleInlineCreateFormation = useCallback(
    async (
      payload: GeologicalFormationCreatePayload,
    ): Promise<{ id: string } | null> => {
      if (!project) return null
      try {
        const created = await api.geology.createFormation(project.id, payload)
        setFormations(prev => [...prev, created])
        handleFormationCreated(created.id)
        return { id: created.id }
      } catch (err) {
        log.error('geology', 'inline createFormation failed', err)
        return null
      }
    },
    [project, handleFormationCreated],
  )

  // Forward-ref to ``handleUpdateContactDepth`` (defined below).
  // Used by ``handleCreateContact``'s 409 (duplicate) recovery path
  // to "move the existing contact instead of creating a duplicate"
  // without a TDZ violation in the dep array. The ref's ``.current``
  // is rewired on every render to the latest stable callback.
  const handleUpdateContactDepthRef = useRef<
    | ((
        contactId: string,
        newDepthM: number,
        snapped: boolean,
      ) => Promise<void>)
    | null
  >(null)

  // Create a formation contact at a specific depth on a specific
  // investigation. Wired from SectionPanel — the user clicks on a
  // borehole's lithology strip or commits a CPT's slider depth,
  // picks a formation in the modal, and this fires with the
  // (anchorKind, anchorId, depth, formation) tuple. The new
  // contact lands in DB AND in App's contacts state so the
  // ContactsLayer overlay updates without a refetch.
  const handleCreateContact = useCallback(
    async (
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depth_m: number,
      formationId: string,
      snapped: boolean,
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      log.debug(
        'geology',
        `createContact entry kind=${anchorKind} anchor=${anchorId} depth=${depth_m.toFixed(3)}m formation=${formationId} snapped=${snapped}`,
      )
      try {
        // Snap-placed contacts: depth came from a stratigraphy
        // observation boundary on the borehole, so source =
        // 'borehole_observation' and confidence = 'high'.
        // Free-placed: engineer's manual call, source = 'manual_pick',
        // confidence stays at the schema default 'medium'.
        // Debt #22 / #23.
        const payload = {
          formation_id: formationId,
          depth_top_m: depth_m,
          borehole_id: anchorKind === 'borehole' ? anchorId : null,
          cpt_id: anchorKind === 'cpt' ? anchorId : null,
          source: (snapped ? 'borehole_observation' : 'manual_pick') as
            | 'borehole_observation'
            | 'manual_pick',
          confidence: (snapped ? 'high' : 'medium') as 'high' | 'medium',
        }
        const created = await api.geology.createContact(
          project.id,
          activeGeologicalModel.id,
          payload,
        )
        setContacts(prev => [...prev, created])
        addAllToSet(setSessionImportContactIds, [created.id])
        log.success(
          'geology',
          `createContact ok id=${created.id} depth=${created.depth_top_m.toFixed(3)}m source=${created.source}`,
        )
        // Undo command — captures the created id in a closure
        // variable so the reapply path can overwrite it on
        // redo (the re-POST gets a new server-assigned id).
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        let currentId = created.id
        pushUndo({
          description: 'Create contact',
          revert: async () => {
            await api.geology.deleteContact(projectId, modelId, currentId)
            setContacts(prev => prev.filter(c => c.id !== currentId))
          },
          reapply: async () => {
            const recreated = await api.geology.createContact(
              projectId,
              modelId,
              payload,
            )
            currentId = recreated.id
            setContacts(prev => [...prev, recreated])
            addAllToSet(setSessionImportContactIds, [recreated.id])
          },
        })
      } catch (err) {
        // 409 = a contact for this (borehole, formation) already
        // exists. Backend returns the existing id in detail.existing_contact_id;
        // we treat the click as "move that one to the new depth"
        // rather than refusing — the user clearly wants Boom Klei
        // at the depth they just clicked, and the geological rule
        // is one top per formation per borehole. PATCH the existing
        // contact's depth to the new location.
        const existingId =
          err instanceof DuplicateContactError ? err.existingContactId : null
        if (existingId) {
          log.info(
            'geology',
            `createContact 409 — moving existing ${existingId} to ${depth_m.toFixed(3)}m instead`,
          )
          try {
            await handleUpdateContactDepthRef.current?.(existingId, depth_m, snapped)
          } catch (moveErr) {
            log.error('geology', 'duplicate-contact move failed', moveErr)
            toast('error', 'Could not move the existing contact to the new depth.')
          }
          return
        }
        log.error('geology', 'createContact failed', err)
        toast('error', 'Could not place the formation contact.')
      }
    },
    [project, activeGeologicalModel, setSessionImportContactIds, pushUndo],
  )

  // Re-pick an existing contact's depth — the commit handler for
  // the drag interaction on the section's ContactsLayer. Updates the
  // local contacts list optimistically on success so the polyline
  // settles at the dragged Y without a refetch round-trip.
  const handleUpdateContactDepth = useCallback(
    async (
      contactId: string,
      newDepthM: number,
      snapped: boolean,
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      log.debug(
        'geology',
        `updateContactDepth entry id=${contactId} newDepth=${newDepthM.toFixed(3)}m snapped=${snapped}`,
      )
      try {
        // Snapshot the pre-update contact so undo can restore depth
        // + source + confidence in one PATCH (debt #22 / #23 rule:
        // source/confidence ride along with depth changes).
        const previous = contacts.find(c => c.id === contactId)
        if (!previous) return
        const updated = await api.geology.updateContact(
          project.id,
          activeGeologicalModel.id,
          contactId,
          {
            depth_top_m: newDepthM,
            source: snapped ? 'borehole_observation' : 'manual_pick',
            confidence: snapped ? 'high' : 'medium',
          },
        )
        setContacts(prev => prev.map(c => (c.id === contactId ? updated : c)))
        log.success(
          'geology',
          `updateContactDepth ok id=${contactId} depth=${updated.depth_top_m.toFixed(3)}m source=${updated.source}`,
        )
        // Undo: PATCH the contact back to its pre-drag state.
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        const beforePayload = {
          depth_top_m: previous.depth_top_m,
          source: previous.source as
            | 'borehole_observation'
            | 'manual_pick'
            | 'interpolated',
          confidence: previous.confidence as 'high' | 'medium' | 'low',
        }
        const afterPayload = {
          depth_top_m: updated.depth_top_m,
          source: updated.source as
            | 'borehole_observation'
            | 'manual_pick'
            | 'interpolated',
          confidence: updated.confidence as 'high' | 'medium' | 'low',
        }
        pushUndo({
          description: 'Move contact',
          revert: async () => {
            const reverted = await api.geology.updateContact(
              projectId,
              modelId,
              contactId,
              beforePayload,
            )
            setContacts(prev =>
              prev.map(c => (c.id === contactId ? reverted : c)),
            )
          },
          reapply: async () => {
            const reapplied = await api.geology.updateContact(
              projectId,
              modelId,
              contactId,
              afterPayload,
            )
            setContacts(prev =>
              prev.map(c => (c.id === contactId ? reapplied : c)),
            )
          },
        })
      } catch (err) {
        log.error('geology', 'updateContact failed', err)
        toast('error', 'Could not update the contact depth.')
      }
    },
    [project, activeGeologicalModel, contacts, pushUndo],
  )

  // Wire the forward-ref now that ``handleUpdateContactDepth`` exists.
  // Re-runs each render to keep the ref pointing at the latest stable
  // closure — handleCreateContact's 409 recovery reads via the ref so
  // it can call back into this handler without a TDZ violation.
  handleUpdateContactDepthRef.current = handleUpdateContactDepth

  // Cross-column COPY commit — fired by plain-drag onto a different
  // column. Each entry becomes a new contact at the target anchor;
  // originals stay where they were. The "stamp my interpretation
  // onto a nearby test" workflow that dogfooding identified as the
  // dominant cross-column use case.
  //
  // Implementation: N parallel POSTs via the existing single-create
  // endpoint. Acceptable for v1 (typical stack ≤6 contacts; partial-
  // failure risk small in absolute terms). Promote to a dedicated
  // ``POST /contacts/batch-create`` endpoint when failure rates
  // start to bite.
  const handleBatchCreateContacts = useCallback(
    async (
      creates: readonly import('./components/sections/ContactsLayer').ContactCopyPayload[],
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      if (creates.length === 0) return
      log.debug(
        'geology',
        `batchCreateContacts entry count=${creates.length}`,
      )
      const projectId = project.id
      const modelId = activeGeologicalModel.id

      // Per-entry result: either a fresh POST (newly-created) OR a
      // PATCH of an already-existing (target_borehole, formation)
      // contact whose pre-PATCH state we snapshot for undo. The COPY
      // workflow's intent on collision is "stamp the source's depth
      // onto the target" — so a 409 from the new uniqueness rule
      // becomes a "move existing to here" instead of a hard failure.
      type CreatedItem = { kind: 'created'; row: FormationContactResponse }
      type PatchedItem = {
        kind: 'patched'
        before: FormationContactResponse
        after: FormationContactResponse
      }
      const created: FormationContactResponse[] = []
      const patched: PatchedItem[] = []
      let failed = 0
      const settled = await Promise.allSettled(
        creates.map(c =>
          api.geology
            .createContact(projectId, modelId, c)
            .then<CreatedItem>(row => ({ kind: 'created', row })),
        ),
      )
      // Walk results sequentially so PATCHes for 409s issue in order
      // (avoids ordering surprises in the local contacts state on
      // multi-collision drags).
      for (let i = 0; i < settled.length; i += 1) {
        const result = settled[i]
        if (result.status === 'fulfilled') {
          created.push(result.value.row)
          continue
        }
        const err = result.reason
        if (err instanceof DuplicateContactError) {
          // 409: target already has a contact for this formation.
          // PATCH it to the new depth (the "stamp on target" intent).
          const before = contacts.find(c => c.id === err.existingContactId)
          if (!before) {
            // Defensive: existing contact id not in our local cache —
            // refetch would slow the path; skip this entry, count as
            // failed.
            failed += 1
            log.warning(
              'geology',
              `batchCreateContacts 409 but existing id ${err.existingContactId} not in local cache, skipped`,
            )
            continue
          }
          const payload = creates[i]
          try {
            const after = await api.geology.updateContact(
              projectId,
              modelId,
              err.existingContactId,
              {
                depth_top_m: payload.depth_top_m,
                source: payload.source,
                confidence: payload.confidence,
              },
            )
            patched.push({ kind: 'patched', before, after })
          } catch (patchErr) {
            failed += 1
            log.error(
              'geology',
              `batchCreateContacts PATCH-on-409 failed for existing ${err.existingContactId}`,
              patchErr,
            )
          }
          continue
        }
        // Non-409 failure (network down, validation error, etc.) —
        // count + log, keep going so the rest of the batch still
        // commits whatever it can.
        failed += 1
        log.error('geology', 'batchCreateContacts entry failed', err)
      }

      // Apply local-state changes from BOTH lanes at once.
      if (created.length > 0) {
        setContacts(prev => [...prev, ...created])
        addAllToSet(
          setSessionImportContactIds,
          created.map(c => c.id),
        )
      }
      if (patched.length > 0) {
        const byId = new Map(patched.map(p => [p.after.id, p.after]))
        setContacts(prev => prev.map(c => byId.get(c.id) ?? c))
      }
      const total = created.length + patched.length
      log.success(
        'geology',
        `batchCreateContacts ok created=${created.length} ` +
          `moved-existing=${patched.length} failed=${failed}`,
      )
      if (total === 0) {
        toast(
          'error',
          'Could not copy any contacts to the target — see console for details.',
        )
        return
      }
      if (failed > 0) {
        toast(
          'error',
          `Copied ${total} contact(s); ${failed} failed — some may be missing.`,
        )
      }

      // Undo: revert BOTH lanes — DELETE everything we created, PATCH
      // everything we moved back to its pre-move state. Redo replays
      // the same shape (re-POSTs the creates with fresh ids,
      // re-PATCHes the moves to the post state).
      let currentCreatedIds = created.map(c => c.id)
      const createdPayloads = creates.slice()
      const patchedSnapshots = patched.slice()
      pushUndo({
        description:
          patched.length > 0
            ? `Copy ${created.length}, move ${patched.length} contact(s)`
            : `Copy ${created.length} contact(s)`,
        revert: async () => {
          await Promise.all(
            currentCreatedIds.map(id =>
              api.geology.deleteContact(projectId, modelId, id),
            ),
          )
          const deleted = new Set(currentCreatedIds)
          setContacts(prev => prev.filter(c => !deleted.has(c.id)))
          // PATCH each "moved" contact back to its pre-move state.
          // Run in parallel; per-(model, anchor, formation)
          // uniqueness can't be violated here because we're shrinking
          // toward the previous state.
          await Promise.all(
            patchedSnapshots.map(p =>
              api.geology
                .updateContact(projectId, modelId, p.after.id, {
                  depth_top_m: p.before.depth_top_m,
                  source: p.before.source,
                  confidence: p.before.confidence,
                })
                .then(reverted => {
                  setContacts(prev =>
                    prev.map(c => (c.id === reverted.id ? reverted : c)),
                  )
                }),
            ),
          )
        },
        reapply: async () => {
          // POST fresh creates — capture new server ids for the
          // next revert.
          const recreated: FormationContactResponse[] = []
          // We may NOT 409 this time around (the previous revert
          // deleted them), so a plain POST is safe.
          for (let j = 0; j < createdPayloads.length; j += 1) {
            const r = await api.geology.createContact(
              projectId,
              modelId,
              createdPayloads[j],
            )
            recreated.push(r)
          }
          currentCreatedIds = recreated.map(c => c.id)
          if (recreated.length > 0) {
            setContacts(prev => [...prev, ...recreated])
            addAllToSet(
              setSessionImportContactIds,
              recreated.map(c => c.id),
            )
          }
          // PATCH each previously-moved contact back to the
          // post-move state.
          await Promise.all(
            patchedSnapshots.map(p =>
              api.geology
                .updateContact(projectId, modelId, p.after.id, {
                  depth_top_m: p.after.depth_top_m,
                  source: p.after.source,
                  confidence: p.after.confidence,
                })
                .then(reapplied => {
                  setContacts(prev =>
                    prev.map(c => (c.id === reapplied.id ? reapplied : c)),
                  )
                }),
            ),
          )
        },
      })
    },
    [
      project,
      activeGeologicalModel,
      setSessionImportContactIds,
      pushUndo,
      contacts,
    ],
  )

  // All-or-nothing batch UPDATE commit — fired by the section
  // editor's same-column multi-drag (depth shift) and the explicit
  // Alt+drag cross-column MOVE (re-anchor). Sends one PUT and
  // patches local state with the returned rows so the section
  // overlay updates without a refetch.
  // The single-contact same-anchor depth-only drag still goes
  // through ``handleUpdateContactDepth`` to keep the existing PATCH
  // tests pinned and to avoid a server round-trip per pixel.
  const handleBatchUpdateContacts = useCallback(
    async (
      updates: readonly FormationContactBatchUpdateEntry[],
    ): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      if (updates.length === 0) return
      log.debug(
        'geology',
        `batchUpdateContacts entry count=${updates.length}`,
      )
      try {
        // Snapshot the pre-update state for every contact in the
        // batch so undo can PUT them back in one call.
        const updateIds = updates.map(u => u.contact_id)
        const idSet = new Set(updateIds)
        const beforeById = new Map(
          contacts.filter(c => idSet.has(c.id)).map(c => [c.id, c]),
        )
        const res = await api.geology.updateContactsBatch(
          project.id,
          activeGeologicalModel.id,
          updates,
        )
        // Index by id so the local state patch is O(N+M).
        const byId = new Map(res.contacts.map(c => [c.id, c]))
        setContacts(prev => prev.map(c => byId.get(c.id) ?? c))
        log.success(
          'geology',
          `batchUpdateContacts ok count=${res.contacts.length}`,
        )
        // Undo: PUT the snapshot back. Redo: PUT the original
        // update payload again.
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        const beforeUpdates: FormationContactBatchUpdateEntry[] = updateIds
          .map(id => beforeById.get(id))
          .filter((c): c is FormationContactResponse => Boolean(c))
          .map(c => ({
            contact_id: c.id,
            depth_top_m: c.depth_top_m,
            borehole_id: c.borehole_id,
            cpt_id: c.cpt_id,
            source: c.source as
              | 'borehole_observation'
              | 'manual_pick'
              | 'interpolated',
            confidence: c.confidence as 'high' | 'medium' | 'low',
          }))
        const afterUpdates = updates.slice()
        pushUndo({
          description: `Update ${updateIds.length} contact(s)`,
          revert: async () => {
            const back = await api.geology.updateContactsBatch(
              projectId,
              modelId,
              beforeUpdates,
            )
            const map = new Map(back.contacts.map(c => [c.id, c]))
            setContacts(prev => prev.map(c => map.get(c.id) ?? c))
          },
          reapply: async () => {
            const fwd = await api.geology.updateContactsBatch(
              projectId,
              modelId,
              afterUpdates,
            )
            const map = new Map(fwd.contacts.map(c => [c.id, c]))
            setContacts(prev => prev.map(c => map.get(c.id) ?? c))
          },
        })
      } catch (err) {
        log.error('geology', 'batchUpdateContacts failed', err)
        toast('error', 'Could not update the selected contacts.')
      }
    },
    [project, activeGeologicalModel, contacts, pushUndo],
  )

  // Right-click → confirm → delete an existing contact. ContactsLayer
  // pops the native confirm; we only land here on a user-confirmed
  // destructive action, so no extra gate. Optimistically prune the
  // local contacts list + the session-import id set so the overlay
  // updates without a refetch and the discard-on-close flow doesn't
  // try to re-delete an already-deleted row.
  const handleDeleteContact = useCallback(
    async (contactId: string): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      log.debug('geology', `deleteContact entry id=${contactId}`)
      try {
        // Snapshot the contact before deletion so undo can re-POST
        // an equivalent row (server assigns a new id on the re-create
        // — captured in the closure for redo).
        const snapshot = contacts.find(c => c.id === contactId)
        if (!snapshot) return
        await api.geology.deleteContact(
          project.id,
          activeGeologicalModel.id,
          contactId,
        )
        setContacts(prev => prev.filter(c => c.id !== contactId))
        setSessionImportContactIds(prev => {
          if (!prev.has(contactId)) return prev
          const next = new Set(prev)
          next.delete(contactId)
          return next
        })
        log.success('geology', `deleteContact ok id=${contactId}`)
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        const recreatePayload = {
          formation_id: snapshot.formation_id,
          depth_top_m: snapshot.depth_top_m,
          borehole_id: snapshot.borehole_id,
          cpt_id: snapshot.cpt_id,
          source: snapshot.source as
            | 'borehole_observation'
            | 'manual_pick'
            | 'interpolated',
          confidence: snapshot.confidence as 'high' | 'medium' | 'low',
        }
        // currentId tracks the most-recently-created id so the
        // next revert (delete) targets the latest row. Starts at
        // null because the contact was JUST deleted; the first
        // revert call re-creates it.
        let currentId: string | null = null
        pushUndo({
          description: 'Delete contact',
          revert: async () => {
            const recreated = await api.geology.createContact(
              projectId,
              modelId,
              recreatePayload,
            )
            currentId = recreated.id
            setContacts(prev => [...prev, recreated])
            addAllToSet(setSessionImportContactIds, [recreated.id])
          },
          reapply: async () => {
            if (!currentId) return
            await api.geology.deleteContact(projectId, modelId, currentId)
            const deletedId = currentId
            setContacts(prev => prev.filter(c => c.id !== deletedId))
            currentId = null
          },
        })
      } catch (err) {
        log.error('geology', `deleteContact failed id=${contactId}`, err)
        toast('error', 'Could not delete the contact.')
      }
    },
    [
      project,
      activeGeologicalModel,
      setSessionImportContactIds,
      contacts,
      pushUndo,
    ],
  )

  // Auto-populate the active model with contacts derived from
  // One-shot cleanup for legacy duplicate (anchor, formation)
  // contacts left over from auto-populate runs that predated the
  // per-anchor uniqueness rule. Backend keeps one survivor per
  // group + deletes the rest; we refresh local contacts state +
  // toast the count. NOT in the undo stack — this is an explicit
  // "clean up old data" action with a confirmation dialog, not
  // an interactive edit.
  const handleDedupeContacts = useCallback(async (): Promise<number> => {
    if (!project || !activeGeologicalModel) return 0
    log.debug('geology', `dedupeContacts entry model=${activeGeologicalModel.id}`)
    try {
      const result = await api.geology.dedupeContacts(
        project.id,
        activeGeologicalModel.id,
      )
      // Refresh contacts so deleted rows leave the section view.
      const conts = await api.geology.listContacts(
        project.id,
        activeGeologicalModel.id,
      )
      setContacts(conts)
      log.success(
        'geology',
        `dedupeContacts ok inspected=${result.inspected_groups} removed=${result.duplicates_removed}`,
      )
      if (result.duplicates_removed === 0) {
        toast('success', 'Already clean — no duplicates found.')
      } else {
        toast(
          'success',
          `Removed ${result.duplicates_removed} duplicate ` +
            `contact${result.duplicates_removed === 1 ? '' : 's'} ` +
            `across ${result.inspected_groups} (anchor, formation) ` +
            `pair${result.inspected_groups === 1 ? '' : 's'}.`,
        )
      }
      return result.duplicates_removed
    } catch (err) {
      log.error('geology', 'dedupeContacts failed', err)
      toast('error', 'Could not run the cleanup — see console.')
      return 0
    }
  }, [project, activeGeologicalModel])

  // Manual escape hatch — force-recompute every formation's TIN
  // cache. The auto-recompute hooks attached to every contact-
  // mutating use case keep the cache fresh on the happy path; this
  // covers the cases they don't (anchor elevation edited without a
  // contact mutation, suspected stale checksum). Reversible — no
  // confirmation modal.
  const handleRebuildSurfaces = useCallback(async (): Promise<void> => {
    if (!project || !activeGeologicalModel) return
    log.debug('geology', `rebuildSurfaces entry model=${activeGeologicalModel.id}`)
    try {
      const result = await api.geology.rebuildSurfaces(
        project.id,
        activeGeologicalModel.id,
      )
      // Refetch the cache so the section view's slice render uses
      // the freshly-computed TINs even when the checksum matched.
      refetchSurfaces()
      log.success(
        'geology',
        `rebuildSurfaces ok considered=${result.formations_considered} ` +
          `rebuilt=${result.formations_rebuilt}`,
      )
      if (result.formations_considered === 0) {
        toast('success', 'No formations with picks yet — nothing to rebuild.')
      } else if (result.formations_rebuilt === 0) {
        toast(
          'success',
          `Cache already in sync (${result.formations_considered} ` +
            `formation${result.formations_considered === 1 ? '' : 's'} checked).`,
        )
      } else {
        toast(
          'success',
          `Rebuilt ${result.formations_rebuilt} of ${result.formations_considered} ` +
            `surface${result.formations_considered === 1 ? '' : 's'}.`,
        )
      }
    } catch (err) {
      log.error('geology', 'rebuildSurfaces failed', err)
      toast('error', 'Could not rebuild surfaces — see console.')
    }
  }, [project, activeGeologicalModel, refetchSurfaces])

  // each section borehole's stratigraphy observation (formal
  // preferred, informal fallback). Backend creates contacts +
  // any missing formations in one transaction; we refresh local
  // formations + contacts state from the API afterwards (cheaper
  // and more correct than reconstructing from the returned id
  // lists).
  const handleAutoPopulateFromStratigraphy = useCallback(
    async (boreholeIds: readonly string[]): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      if (boreholeIds.length === 0) return
      log.debug(
        'geology',
        `autoPopulateFromStratigraphy entry boreholes=${boreholeIds.length}`,
      )
      try {
        const outcome = await api.geology.autoPopulateFromStratigraphy(
          project.id,
          activeGeologicalModel.id,
          boreholeIds,
        )
        // Refresh formations + contacts state. The auto-populate
        // path can have created either / both — re-fetching is the
        // simplest path to consistency.
        const [forms, conts] = await Promise.all([
          api.geology.listFormations(project.id),
          api.geology.listContacts(project.id, activeGeologicalModel.id),
        ])
        setFormations(forms)
        setContacts(conts)
        // New formations are session-import entities so they
        // survive the save flow's manifest filter.
        addAllToSet(
          setSessionImportFormationIds,
          outcome.created_formation_ids,
        )
        addAllToSet(
          setSessionImportContactIds,
          outcome.created_contact_ids,
        )
        // Add new formations to the project manifest so the save
        // flow's filter passes them through.
        for (const id of outcome.created_formation_ids) {
          addToManifest('formation', [id])
        }
        // Tell the InterpretationPane (separate state) to refetch
        // — it doesn't observe App's formations cache directly.
        setFormationsRefreshCounter(c => c + 1)
        const created = outcome.created_contact_ids.length
        const skipped =
          outcome.skipped_existing +
          outcome.skipped_unmatched +
          outcome.skipped_no_stratigraphy
        log.success(
          'geology',
          `autoPopulateFromStratigraphy ok +${created} contacts, ` +
            `+${outcome.created_formation_ids.length} formations, ` +
            `skipped ${outcome.skipped_existing} existing / ` +
            `${outcome.skipped_unmatched} unmatched / ` +
            `${outcome.skipped_no_stratigraphy} no-strat`,
        )
        // Undo: delete every created contact + every created formation
        // (contacts first — FK from contact.formation_id). The redo
        // path re-runs the auto-populate against the same boreholes;
        // idempotency on observation_layer_id means the same layers
        // get re-seeded (potentially with new server-assigned ids).
        if (created > 0 || outcome.created_formation_ids.length > 0) {
          const projectId = project.id
          const modelId = activeGeologicalModel.id
          const boreholeIdsSnapshot = boreholeIds.slice()
          // Capture both lists in closure; mutated on each reapply
          // since the recreated rows get fresh server ids.
          let currentContactIds = outcome.created_contact_ids.slice()
          let currentFormationIds = outcome.created_formation_ids.slice()
          pushUndo({
            description: `Seed from stratigraphy (+${created} contacts)`,
            revert: async () => {
              await Promise.all(
                currentContactIds.map(id =>
                  api.geology.deleteContact(projectId, modelId, id),
                ),
              )
              await Promise.all(
                currentFormationIds.map(id =>
                  api.geology.deleteFormation(projectId, id),
                ),
              )
              const droppedContacts = new Set(currentContactIds)
              const droppedFormations = new Set(currentFormationIds)
              setContacts(prev =>
                prev.filter(c => !droppedContacts.has(c.id)),
              )
              setFormations(prev =>
                prev.filter(f => !droppedFormations.has(f.id)),
              )
              setFormationsRefreshCounter(c => c + 1)
            },
            reapply: async () => {
              const next = await api.geology.autoPopulateFromStratigraphy(
                projectId,
                modelId,
                boreholeIdsSnapshot,
              )
              currentContactIds = next.created_contact_ids.slice()
              currentFormationIds = next.created_formation_ids.slice()
              const [forms2, conts2] = await Promise.all([
                api.geology.listFormations(projectId),
                api.geology.listContacts(projectId, modelId),
              ])
              setFormations(forms2)
              setContacts(conts2)
              setFormationsRefreshCounter(c => c + 1)
            },
          })
        }
        // Surface a short summary toast. Tone: success on any new
        // rows; info on a pure-idempotent re-run; warning when
        // nothing was created AND boreholes lacked stratigraphy.
        if (created > 0) {
          toast(
            'success',
            `Seeded ${created} contacts` +
              (outcome.created_formation_ids.length
                ? ` and ${outcome.created_formation_ids.length} new formations`
                : '') +
              '.',
          )
        } else if (outcome.skipped_no_stratigraphy === boreholeIds.length) {
          toast(
            'error',
            'No boreholes on this section carry stratigraphy data.',
          )
        } else if (skipped > 0) {
          toast('success', 'Already in sync — nothing to add.')
        }
      } catch (err) {
        log.error(
          'geology',
          'autoPopulateFromStratigraphy failed',
          err,
        )
        toast('error', 'Could not seed contacts from stratigraphy.')
      }
    },
    [
      project,
      activeGeologicalModel,
      setSessionImportFormationIds,
      setSessionImportContactIds,
      addToManifest,
      pushUndo,
    ],
  )

  // Export the section's drawn geological model to DXF. Owns the
  // full flow (fetch bytes → save dialog → file write) so the
  // SectionPanel + SectionHeader stay storage-agnostic. The button
  // is hidden when no active geological model exists (v1.0 MVP #5).
  const handleExportSectionDxf = useCallback(
    async (
      projectId: string,
      sectionId: string,
      sectionName: string,
      modelId: string,
    ): Promise<void> => {
      log.info('section', `exportDxf start section=${sectionId} model=${modelId}`)
      try {
        // Suggest a filename based on the section name. Sanitise the
        // same way the backend does so the proposed default matches
        // what the user sees in the URL's Content-Disposition.
        const safeName =
          sectionName.replace(/[^A-Za-z0-9\- _]/g, '_').trim() || 'section'
        const dialogPath = await window.electron.showExportSaveDialog(
          `${safeName}.dxf`,
          [
            { name: 'AutoCAD DXF', extensions: ['dxf'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        )
        if (dialogPath === null) {
          log.debug('section', 'exportDxf cancelled at save dialog')
          return
        }
        const bytes = await api.section.exportDxf(projectId, sectionId, modelId)
        await window.electron.writeExportFile(dialogPath, bytes)
        log.success(
          'section',
          `exportDxf ok section=${sectionId} bytes=${bytes.byteLength} path=${dialogPath}`,
        )
        toast('success', 'DXF exported.')
      } catch (err) {
        log.error('section', 'exportDxf failed', err)
        toast(
          'error',
          err instanceof Error ? err.message : 'Could not export the DXF.',
        )
      }
    },
    [],
  )

  // Toggle whether a borehole anchors formation contacts in the
  // active geological model. The model's ``excluded_borehole_ids``
  // is the bundle-portable source of truth. Toggling fires
  // PATCH /projects/{pid}/geology/models/{mid} and updates the
  // local state optimistically so the contacts overlay redraws
  // without waiting for the round-trip.
  //
  // Excluded boreholes still render their lithology strip (the
  // user can still SEE them for context), but their contacts get
  // filtered out of the ContactsLayer. Contact data stays in the
  // DB — re-including the borehole brings the lines back.
  const handleToggleBoreholeInModel = useCallback(
    async (boreholeId: string, included: boolean): Promise<void> => {
      if (!project || !activeGeologicalModel) return
      const previousExcluded = activeGeologicalModel.excluded_borehole_ids
      const current = new Set(previousExcluded)
      // ``included = true`` means the user wants this borehole IN
      // the model → remove from exclusion. ``false`` adds it.
      if (included) current.delete(boreholeId)
      else current.add(boreholeId)
      const nextExcluded = Array.from(current)
      // Optimistic update first, then PATCH. On failure we log
      // and let the next project-change effect reconcile.
      setActiveGeologicalModel(prev =>
        prev === null ? null : { ...prev, excluded_borehole_ids: nextExcluded },
      )
      try {
        await api.geology.updateModel(project.id, activeGeologicalModel.id, {
          excluded_borehole_ids: nextExcluded,
        })
        const projectId = project.id
        const modelId = activeGeologicalModel.id
        const beforeList = previousExcluded.slice()
        const afterList = nextExcluded.slice()
        pushUndo({
          description: included
            ? 'Include borehole in model'
            : 'Exclude borehole from model',
          revert: async () => {
            await api.geology.updateModel(projectId, modelId, {
              excluded_borehole_ids: beforeList,
            })
            setActiveGeologicalModel(prev =>
              prev === null
                ? null
                : { ...prev, excluded_borehole_ids: beforeList },
            )
          },
          reapply: async () => {
            await api.geology.updateModel(projectId, modelId, {
              excluded_borehole_ids: afterList,
            })
            setActiveGeologicalModel(prev =>
              prev === null
                ? null
                : { ...prev, excluded_borehole_ids: afterList },
            )
          },
        })
      } catch (err) {
        log.error('geology', `updateModel exclude-borehole failed for ${boreholeId}`, err)
        // Roll back optimistic state on failure so the toggle
        // visually reflects server truth.
        setActiveGeologicalModel(prev =>
          prev === null
            ? null
            : { ...prev, excluded_borehole_ids: previousExcluded },
        )
      }
    },
    [project, activeGeologicalModel, pushUndo],
  )

  // Apply the project-local filter before anything user-visible reads
  // the lists. Two layers stack here:
  //
  //   1. Manifest gate — only IDs that exist in the .gmproj bundle
  //      (or were imported in this session) are visible. Anything in
  //      the DB but not in the manifest is treated as "unsaved from
  //      a previous session" and stays invisible until the user
  //      explicitly re-imports.
  //   2. Removed-set overlay — project-local hide UX. User-driven
  //      "X this row" never deletes from the DB, just hides from view.
  //
  // Map markers, sidebar rows, layer-control counts all work off the
  // filtered view; the unfiltered cpts / boreholes lists never leave
  // App.
  const visibleCpts = useMemo(
    () => cpts.filter(c => manifestCptIds.has(c.id) && !removedCptIds.has(c.id)),
    [cpts, manifestCptIds, removedCptIds],
  )
  const visibleBoreholes = useMemo(
    () =>
      boreholes.filter(b => manifestBoreholeIds.has(b.id) && !removedBoreholeIds.has(b.id)),
    [boreholes, manifestBoreholeIds, removedBoreholeIds],
  )

  // Cross-sections — same manifest gate as CPTs / boreholes. A
  // section that was created in a previous session but never saved
  // to the .strix file disappears on the next open.
  const visibleSections = useMemo(
    () => sections.filter(s => manifestSectionIds.has(s.id)),
    [sections, manifestSectionIds],
  )

  // Out-of-viewport sets — empty when the map hasn't reported bounds
  // yet. The Lambert72→WGS84 projection inside ``idsOutsideBounds``
  // is memoised so the per-record cost is just a dictionary lookup
  // after the first render.
  const outOfViewportCptIds = useMemo(
    () => idsOutsideBounds(visibleCpts, viewportBounds),
    [visibleCpts, viewportBounds],
  )

  const outOfViewportBoreholeIds = useMemo(
    () => idsOutsideBounds(visibleBoreholes, viewportBounds),
    [visibleBoreholes, viewportBounds],
  )

  const handleRemoveCpts = useCallback(
    (ids: string[]) => {
      if (ids.length === 0 || !project) return
      // Optimistic local update — server upserts fire in parallel and
      // failures are logged but don't roll back the UI (the user can
      // re-hide if needed; the saved-state is what matters and that
      // gets reconciled on next project load).
      setRemovedCptIds(prev => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
      if (selectedId && ids.includes(selectedId)) {
        setSelectedId(null)
        setView('map')
      }
      void Promise.allSettled(
        ids.map(id => api.review.upsert(project.id, 'cpt', id, { is_hidden: true })),
      ).then(results => {
        const failed = results.filter(r => r.status === 'rejected').length
        if (failed > 0) {
          log.warn('reviews', `${failed}/${ids.length} hide-CPT upserts failed`)
        }
      })
    },
    [project, selectedId],
  )

  const handleRemoveBoreholes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0 || !project) return
      setRemovedBoreholeIds(prev => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
      if (selectedBoreholeId && ids.includes(selectedBoreholeId)) {
        setSelectedBoreholeId(null)
        setView('map')
      }
      void Promise.allSettled(
        ids.map(id =>
          api.review.upsert(project.id, 'borehole', id, { is_hidden: true }),
        ),
      ).then(results => {
        const failed = results.filter(r => r.status === 'rejected').length
        if (failed > 0) {
          log.warn('reviews', `${failed}/${ids.length} hide-borehole upserts failed`)
        }
      })
    },
    [project, selectedBoreholeId],
  )

  const handleRestoreAllCpts = useCallback(() => {
    if (!project) return
    const ids = Array.from(removedCptIds)
    setRemovedCptIds(new Set())
    void Promise.allSettled(
      ids.map(id => api.review.upsert(project.id, 'cpt', id, { is_hidden: false })),
    ).then(results => {
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) {
        log.warn('reviews', `${failed}/${ids.length} restore-CPT upserts failed`)
      }
    })
  }, [project, removedCptIds])

  const handleRestoreAllBoreholes = useCallback(() => {
    if (!project) return
    const ids = Array.from(removedBoreholeIds)
    setRemovedBoreholeIds(new Set())
    void Promise.allSettled(
      ids.map(id =>
        api.review.upsert(project.id, 'borehole', id, { is_hidden: false }),
      ),
    ).then(results => {
      const failed = results.filter(r => r.status === 'rejected').length
      if (failed > 0) {
        log.warn('reviews', `${failed}/${ids.length} restore-borehole upserts failed`)
      }
    })
  }, [project, removedBoreholeIds])

  // Phase 3a — manual surface-elevation edit handlers. Both update three
  // pieces of state in one go: the list (so the sidebar badge clears),
  // the detail-cache entry (so the chart/borelog header reflects the new
  // value without a re-fetch), and any selection-derived view. The PATCH
  // endpoint returns the updated row, so we patch in place rather than
  // re-fetching.
  const handlePatchCptElevation = useCallback(
    async (id: string, elevationM: number | null, zEpsg: number | null): Promise<void> => {
      // Snapshot pre-edit values from the list (always fresh) so undo
      // can PATCH them back even if the user's been clicking around.
      const before = cpts.find(c => c.id === id)
      const beforeElev = before?.elevation_m ?? null
      const beforeZ = before?.z_epsg ?? null
      const updated = await api.cpt.patchElevation(id, {
        elevation_m: elevationM,
        z_epsg: zEpsg,
      })
      setDetailMap(prev => new Map(prev).set(id, updated))
      setCpts(prev =>
        prev.map(c =>
          c.id === id
            ? { ...c, elevation_m: updated.elevation_m, z_epsg: updated.z_epsg }
            : c,
        ),
      )
      log.info('cpt', `elevation patched: ${id} → ${elevationM} (z_epsg=${zEpsg})`)
      pushUndo({
        description: 'Edit CPT elevation',
        revert: async () => {
          const back = await api.cpt.patchElevation(id, {
            elevation_m: beforeElev,
            z_epsg: beforeZ,
          })
          setDetailMap(prev => new Map(prev).set(id, back))
          setCpts(prev =>
            prev.map(c =>
              c.id === id
                ? { ...c, elevation_m: back.elevation_m, z_epsg: back.z_epsg }
                : c,
            ),
          )
        },
        reapply: async () => {
          const fwd = await api.cpt.patchElevation(id, {
            elevation_m: elevationM,
            z_epsg: zEpsg,
          })
          setDetailMap(prev => new Map(prev).set(id, fwd))
          setCpts(prev =>
            prev.map(c =>
              c.id === id
                ? { ...c, elevation_m: fwd.elevation_m, z_epsg: fwd.z_epsg }
                : c,
            ),
          )
        },
      })
    },
    [cpts, pushUndo],
  )

  const handlePatchBoreholeElevation = useCallback(
    async (id: string, elevationM: number | null, zEpsg: number | null): Promise<void> => {
      const before = boreholes.find(b => b.id === id)
      const beforeElev = before?.elevation_m ?? null
      const beforeZ = before?.z_epsg ?? null
      const updated = await api.borehole.patchElevation(id, {
        elevation_m: elevationM,
        z_epsg: zEpsg,
      })
      setBoreholes(prev =>
        prev.map(b =>
          b.id === id
            ? { ...b, elevation_m: updated.elevation_m, z_epsg: updated.z_epsg }
            : b,
        ),
      )
      // Patch the detail cache in place — the lab-test children, drill
      // segments, etc. are unchanged so a full re-fetch is wasteful.
      setBoreholeDetailMap(prev => {
        const existing = prev.get(id)
        if (!existing) return prev
        const next = new Map(prev)
        next.set(id, {
          ...existing,
          elevation_m: updated.elevation_m,
          z_epsg: updated.z_epsg,
        })
        return next
      })
      log.info('borehole', `elevation patched: ${id} → ${elevationM} (z_epsg=${zEpsg})`)
      pushUndo({
        description: 'Edit borehole elevation',
        revert: async () => {
          const back = await api.borehole.patchElevation(id, {
            elevation_m: beforeElev,
            z_epsg: beforeZ,
          })
          setBoreholes(prev =>
            prev.map(b =>
              b.id === id
                ? { ...b, elevation_m: back.elevation_m, z_epsg: back.z_epsg }
                : b,
            ),
          )
          setBoreholeDetailMap(prev => {
            const existing = prev.get(id)
            if (!existing) return prev
            const next = new Map(prev)
            next.set(id, {
              ...existing,
              elevation_m: back.elevation_m,
              z_epsg: back.z_epsg,
            })
            return next
          })
        },
        reapply: async () => {
          const fwd = await api.borehole.patchElevation(id, {
            elevation_m: elevationM,
            z_epsg: zEpsg,
          })
          setBoreholes(prev =>
            prev.map(b =>
              b.id === id
                ? { ...b, elevation_m: fwd.elevation_m, z_epsg: fwd.z_epsg }
                : b,
            ),
          )
          setBoreholeDetailMap(prev => {
            const existing = prev.get(id)
            if (!existing) return prev
            const next = new Map(prev)
            next.set(id, {
              ...existing,
              elevation_m: fwd.elevation_m,
              z_epsg: fwd.z_epsg,
            })
            return next
          })
        },
      })
    },
    [boreholes, pushUndo],
  )

  // Re-importing or re-fetching a record is an explicit "make this visible
  // again" signal, so clear any of the supplied ids from the project-local
  // removed-set. Without this, a 409-duplicate import returns the existing
  // id, the sidebar's removed-filter hides it, and the user sees no change.
  // The server-side is_hidden flag is flipped via a parallel upsert so the
  // un-hide rides into the next .gmproj save.
  const unhideCpts = useCallback(
    (ids: Iterable<string>) => {
      const touched: string[] = []
      setRemovedCptIds(prev => {
        const next = new Set(prev)
        for (const id of ids) {
          if (next.delete(id)) touched.push(id)
        }
        return touched.length > 0 ? next : prev
      })
      if (!project || touched.length === 0) return
      void Promise.allSettled(
        touched.map(id => api.review.upsert(project.id, 'cpt', id, { is_hidden: false })),
      )
    },
    [project],
  )
  const unhideBoreholes = useCallback(
    (ids: Iterable<string>) => {
      const touched: string[] = []
      setRemovedBoreholeIds(prev => {
        const next = new Set(prev)
        for (const id of ids) {
          if (next.delete(id)) touched.push(id)
        }
        return touched.length > 0 ? next : prev
      })
      if (!project || touched.length === 0) return
      void Promise.allSettled(
        touched.map(id =>
          api.review.upsert(project.id, 'borehole', id, { is_hidden: false }),
        ),
      )
    },
    [project],
  )

  // ---------------------------------------------------------------------------
  // Boot — wait for API regardless of project state
  // ---------------------------------------------------------------------------

  useEffect(() => {
    async function boot() {
      const base = await window.electron.getApiBaseUrl()
      setBaseUrl(base)
      log.info('boot', `API base = ${base}`)
      const ok = await window.electron.waitForApi()
      if (ok) {
        log.info('boot', 'API ready')
        setReady(true)
      } else {
        log.error('boot', 'API failed to come up within timeout')
        setApiError(true)
      }
    }
    boot()
  }, [])

  // Load CPTs + boreholes + sections whenever the API is ready and a
  // project is selected. ``project?.id`` in the dep array means each
  // project switch re-fetches its own scope (and clears stale section
  // state for the previous project).
  useEffect(() => {
    if (ready && project) {
      refreshList()
      refreshBoreholeList()
      refreshSectionList()
    }
  }, [ready, project?.id])

  // Wire Electron menu → import
  useEffect(() => {
    const off = window.electron.onMenuImportCpt(handleImportCpt)
    return off
  }, [])

  // Mirror the live project state into the OS window title. Title shows
  // 'Ground Model — Site A *' when dirty (Word / Plaxis convention).
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

  // Project menu signals — wire each into a handler. Each subscription
  // returns its own unsubscribe; we register all on mount and tear down
  // on unmount.
  //
  // Note: New Project just opens the dialog; the actual create call fires
  // from the dialog's submit. ``window.prompt`` is unavailable in
  // Electron's renderer, so we never go through that path.
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

  // Sidebar X path — mis-click protection in addition to the dirty check.
  const handleSidebarCloseRequest = useCallback(() => {
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

  // File menu Save / Ctrl+S — soft no-op when clean, commit when dirty.
  // Failure is logged but doesn't surface here (the unsaved-changes
  // dialog has its own retry path; for direct-Save we trust the user
  // sees the toast / retries).
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

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  const refreshList = useCallback(async () => {
    if (!project) return
    try {
      const list = await api.cpt.list(project.id)
      setCpts(list)
      log.debug('cpt', `refreshList: ${list.length} CPTs`)
      // No per-CPT detail fetch here: CptListItem already carries location_x/y for
      // map markers. Detail is fetched lazily by handleSelect when a CPT is clicked.
    } catch (err) {
      log.error('cpt', 'refreshList failed', err)
      toast('error', 'Failed to load CPT list')
    }
  }, [project])

  const loadChart = useCallback(async (id: string) => {
    if (plotMap.has(id)) return
    try {
      const plot = await api.cpt.plot(id)
      setPlotMap(prev => new Map(prev).set(id, plot))
    } catch (err) {
      log.error('cpt', `loadChart(${id}) failed`, err)
      toast('error', 'Failed to load chart data')
    }
  }, [plotMap])

  const refreshBoreholeList = useCallback(async () => {
    if (!project) return
    try {
      const list = await api.borehole.list(project.id)
      setBoreholes(list)
      log.debug('borehole', `refreshList: ${list.length} boreholes`)
    } catch (err) {
      log.error('borehole', 'refreshList failed', err)
      toast('error', 'Failed to load borehole list')
    }
  }, [project])

  const refreshSectionList = useCallback(async () => {
    if (!project) return
    try {
      const list = await api.section.list(project.id)
      setSections(list)
      log.debug('section', `refreshList: ${list.length} sections`)
    } catch (err) {
      log.error('section', 'refreshList failed', err)
      toast('error', 'Failed to load cross-sections.')
    }
  }, [project])

  // Placeholder geometry generator. S1 ships the discovery surface
  // "+ New cross-section" enters a two-click draw mode on the map.
  // The Sidebar fires this; the MapView mounts a SectionLineDrawer
  // that ultimately calls ``handleSectionLineDrawn`` below with the
  // captured endpoints. Returning ``null`` keeps the SectionList's
  // contract (creation returns the row or null); the row materialises
  // asynchronously via the draw flow instead of in this handler.
  const handleCreateSection = useCallback(async (): Promise<
    CrossSectionResponse | null
  > => {
    if (!project) return null
    if (project.default_horizontal_epsg == null) {
      toast('error', 'Set a Default horizontal CRS in Project metadata first.')
      return null
    }
    // Drop any active section selection so the map is the visible
    // surface for drawing. Also clear CPT/borehole selection for the
    // same reason — the user shouldn't have a detail panel obscuring
    // half the map mid-draw.
    setSelectedSectionId(null)
    setSelectedId(null)
    setSelectedBoreholeId(null)
    setDrawingSection(true)
    return null
  }, [project])

  const cancelSectionDraw = useCallback(() => {
    setDrawingSection(false)
  }, [])

  // Fires from the SectionLineDrawer once the user has placed both
  // endpoints. Converts WGS84 (Leaflet's native CRS) → the project's
  // horizontal EPSG and POSTs the section. On success the new row
  // is added to local state and selected so the user immediately
  // sees the section panel render.
  const handleSectionLineDrawn = useCallback(
    async (
      start: { lat: number; lng: number },
      end: { lat: number; lng: number },
    ) => {
      setDrawingSection(false)
      if (!project) return
      const epsg = project.default_horizontal_epsg
      if (epsg == null) return // gated upstream, defensive only
      const [sx, sy] = wgs84ToProjected(start.lat, start.lng, epsg)
      const [ex, ey] = wgs84ToProjected(end.lat, end.lng, epsg)
      // Defensive guard for the "double-click same spot" race —
      // the backend rejects zero-length lines, but a clearer toast
      // beats a backend 400.
      if (sx === ex && sy === ey) {
        toast('error', 'The two endpoints landed at the same point. Try again.')
        return
      }
      const ordinal = sections.length + 1
      try {
        const createPayload = {
          name: `Cross-section ${ordinal}`,
          epsg,
          start_x: sx,
          start_y: sy,
          end_x: ex,
          end_y: ey,
        }
        const created = await api.section.create(project.id, createPayload)
        setSections(prev => [...prev, created])
        setSelectedSectionId(created.id)
        // Manifest + session-imports update so the new section
        // tracks as dirty until File → Save (matches the CPT /
        // borehole import lifecycle).
        handleSectionCreated(created.id)
        log.success('section', `created ${created.name} from map draw`)
        const projectId = project.id
        let currentId = created.id
        pushUndo({
          description: 'Create cross-section',
          revert: async () => {
            await api.section.delete(projectId, currentId)
            setSections(prev => prev.filter(s => s.id !== currentId))
            setSelectedSectionId(prev => (prev === currentId ? null : prev))
          },
          reapply: async () => {
            const recreated = await api.section.create(projectId, createPayload)
            currentId = recreated.id
            setSections(prev => [...prev, recreated])
            setSelectedSectionId(recreated.id)
            handleSectionCreated(recreated.id)
          },
        })
      } catch (err) {
        log.error('section', 'create-from-draw failed', err)
        toast('error', 'Could not create the cross-section.')
      }
    },
    [project, sections.length, handleSectionCreated, pushUndo],
  )

  const handleDeleteSection = useCallback(
    async (id: string) => {
      if (!project) return
      try {
        // Snapshot the section so undo can re-POST an equivalent.
        const snapshot = sections.find(s => s.id === id)
        if (!snapshot) return
        await api.section.delete(project.id, id)
        setSections(prev => prev.filter(s => s.id !== id))
        if (selectedSectionId === id) setSelectedSectionId(null)
        handleSectionDeleted(id)
        log.info('section', `deleted ${id}`)
        const projectId = project.id
        const recreatePayload = {
          name: snapshot.name,
          description: snapshot.description,
          epsg: snapshot.epsg,
          start_x: snapshot.start_x,
          start_y: snapshot.start_y,
          end_x: snapshot.end_x,
          end_y: snapshot.end_y,
          projection_buffer_m: snapshot.projection_buffer_m,
          vertical_exaggeration: snapshot.vertical_exaggeration,
        }
        let currentId: string | null = null
        pushUndo({
          description: 'Delete cross-section',
          revert: async () => {
            const recreated = await api.section.create(projectId, recreatePayload)
            currentId = recreated.id
            setSections(prev => [...prev, recreated])
            handleSectionCreated(recreated.id)
          },
          reapply: async () => {
            if (!currentId) return
            await api.section.delete(projectId, currentId)
            const deletedId = currentId
            setSections(prev => prev.filter(s => s.id !== deletedId))
            setSelectedSectionId(prev => (prev === deletedId ? null : prev))
            currentId = null
          },
        })
      } catch (err) {
        log.error('section', `delete ${id} failed`, err)
        toast('error', 'Could not delete the cross-section.')
      }
    },
    [
      project,
      selectedSectionId,
      handleSectionDeleted,
      handleSectionCreated,
      sections,
      pushUndo,
    ],
  )

  // PATCH the currently-selected section. Used by the SectionPanel's
  // buffer + VEX sliders (fires on release, not on every pixel of
  // drag, to avoid hammering the backend). Updates local state with
  // the row the server returns so subsequent renders use the
  // server-truth value.
  const handlePatchSelectedSection = useCallback(
    async (patch: {
      projection_buffer_m?: number
      vertical_exaggeration?: number
      view_state?: Record<string, unknown>
      excluded_cpt_ids?: string[]
      excluded_borehole_ids?: string[]
    }) => {
      if (!project || !selectedSectionId) return
      try {
        const updated = await api.section.update(
          project.id,
          selectedSectionId,
          patch,
        )
        setSections(prev =>
          prev.map(s => (s.id === updated.id ? updated : s)),
        )
        log.debug(
          'section',
          `patched ${selectedSectionId} → ${JSON.stringify(patch)}`,
        )
      } catch (err) {
        log.error('section', `patch ${selectedSectionId} failed`, err)
        toast('error', 'Could not save the section change.')
      }
    },
    [project, selectedSectionId],
  )

  const loadBoreholeDetail = useCallback(
    async (id: string) => {
      if (boreholeDetailMap.has(id)) return
      try {
        const detail = await api.borehole.get(id)
        setBoreholeDetailMap(prev => new Map(prev).set(id, detail))
      } catch (err) {
        log.error('borehole', `loadDetail(${id}) failed`, err)
        toast('error', 'Failed to load borehole detail')
      }
    },
    [boreholeDetailMap],
  )

  // ---------------------------------------------------------------------------
  // Selection
  // ---------------------------------------------------------------------------

  const handleSelect = useCallback(async (id: string) => {
    setSelectedId(id)
    // Switching to a CPT clears any borehole / section selection so
    // only one detail panel is rendered at a time.
    setSelectedBoreholeId(null)
    setSelectedSectionId(null)
    // Lazy-load full detail for the chart panel (mTAW elevation, cone props, etc).
    if (!detailMap.has(id)) {
      api.cpt.get(id).then(detail => {
        setDetailMap(prev => new Map(prev).set(id, detail))
      }).catch(() => { /* chart can render without detail */ })
    }
    await loadChart(id)
    setView('chart')
  }, [loadChart, detailMap])

  const handleSelectBorehole = useCallback(
    async (id: string) => {
      setSelectedBoreholeId(id)
      // Mutually exclusive with CPT + section selection.
      setSelectedId(null)
      setSelectedSectionId(null)
      await loadBoreholeDetail(id)
      setView('chart')
    },
    [loadBoreholeDetail],
  )

  // Cross-section selection — exclusive with CPT + borehole. Clearing
  // the others on entry means the existing view-tab logic doesn't
  // have to know about sections; the dedicated section panel renders
  // whenever ``selectedSectionId`` is set and supersedes everything.
  const handleSelectSection = useCallback((id: string) => {
    setSelectedSectionId(id)
    setSelectedId(null)
    setSelectedBoreholeId(null)
  }, [])

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  const handleImportCpt = useCallback(async () => {
    if (!project) return
    const filePaths = await window.electron.openFiles([
      { name: 'GEF Files', extensions: ['gef'] },
      { name: 'All Files', extensions: ['*'] }
    ])
    if (filePaths.length === 0) return

    setImporting(true)
    try {
      const results = await Promise.allSettled(
        filePaths.map(fp => api.cpt.import(fp, project.id))
      )

      let imported = 0, warnings = 0, duplicates = 0, errors = 0
      let firstId: string | null = null
      const touchedIds: string[] = []
      // IDs that were CREATED in this import (not duplicates of existing
      // rows). These get tagged as session-imports so the sidebar paints
      // the amber asterisk and the project becomes dirty until File →
      // Save commits the new state.
      const newIds: string[] = []

      for (const r of results) {
        if (r.status === 'fulfilled') {
          if (r.value.has_errors) warnings++
          else imported++
          firstId ??= r.value.cpt_id
          touchedIds.push(r.value.cpt_id)
          newIds.push(r.value.cpt_id)
        } else if (r.reason instanceof DuplicateCptError) {
          duplicates++
          firstId ??= r.reason.cptId
          touchedIds.push(r.reason.cptId)
        } else {
          errors++
        }
      }

      const ok = imported + warnings
      const parts: string[] = []
      if (ok > 0) parts.push(`${ok} imported${warnings > 0 ? ` (${warnings} with warnings)` : ''}`)
      if (duplicates > 0) parts.push(`${duplicates} already existed`)
      if (errors > 0) parts.push(`${errors} failed`)
      toast(errors > 0 && ok === 0 ? 'error' : 'success', parts.join(', '))

      unhideCpts(touchedIds)
      // Append to the manifest (visibility gate) AND the session-
      // imports tracking set (drives project-level dirty + discard
      // rollback). Both sets see the same IDs; they answer different
      // questions about them.
      addToManifest('cpt', newIds)
      addAllToSet(setSessionImportCptIds, newIds)
      await refreshList()
      if (firstId) {
        setSelectedId(firstId)
        await loadChart(firstId)
        if (filePaths.length === 1) setView('chart')
      }
    } finally {
      setImporting(false)
    }
  }, [project, refreshList, loadChart, unhideCpts, addToManifest, setSessionImportCptIds])

  // ---------------------------------------------------------------------------
  // DOV import
  // ---------------------------------------------------------------------------

  const handleImportDov = useCallback(() => {
    setView('map')
    setBboxImportType('cpt')
  }, [])

  const handleImportBoreholeDov = useCallback(() => {
    setView('map')
    setBboxImportType('borehole')
  }, [])

  const handleBboxDrawn = useCallback(
    async (west: number, south: number, east: number, north: number) => {
      if (!project) return
      const importType = bboxImportType
      setBboxImportType(null)
      if (!importType) return // defensive — shouldn't happen
      setDovImporting(true)
      try {
        if (importType === 'cpt') {
          // Snapshot ids BEFORE the API call so we can diff for the
          // session-imports tagging. ``result.cpt_ids`` includes both
          // newly-imported and pre-existing rows; we only want the new.
          const beforeIds = new Set(cpts.map(c => c.id))
          const result = await api.cpt.importDov({ west, south, east, north }, project.id)
          const parts: string[] = []
          if (result.imported > 0) parts.push(`${result.imported} imported`)
          if (result.duplicates > 0) parts.push(`${result.duplicates} already existed`)
          if (result.failed > 0) parts.push(`${result.failed} failed`)
          toast(
            result.failed > 0 && result.imported === 0 ? 'error' : 'success',
            parts.join(', ') || 'No CPTs found in this area',
          )
          unhideCpts(result.cpt_ids)
          // Every CPT returned by DOV (new or duplicate) needs to be
          // visible — add them all to the manifest. Session-imports
          // tracking only flags the genuinely-new ones so a re-import
          // of an already-saved area doesn't re-dirty the project.
          addToManifest('cpt', result.cpt_ids)
          addAllToSet(
            setSessionImportCptIds,
            result.cpt_ids.filter(id => !beforeIds.has(id)),
          )
          await refreshList()
          if (result.imported === 1 && result.cpt_ids.length > 0) {
            const id = result.cpt_ids[0]
            setSelectedId(id)
            setSelectedBoreholeId(null)
            await loadChart(id)
            setView('chart')
          }
        } else {
          const beforeIds = new Set(boreholes.map(b => b.id))
          const result = await api.borehole.importDov(
            { west, south, east, north },
            project.id,
          )
          const parts: string[] = []
          if (result.imported > 0) parts.push(`${result.imported} imported`)
          if (result.duplicates > 0) parts.push(`${result.duplicates} already existed`)
          if (result.failed > 0) parts.push(`${result.failed} failed`)
          const extras: string[] = []
          if (result.interpretations_attached)
            extras.push(`${result.interpretations_attached} obs`)
          if (result.samples_attached) extras.push(`${result.samples_attached} samples`)
          if (result.grain_sizes_attached)
            extras.push(`${result.grain_sizes_attached} grain-size`)
          const summary = parts.join(', ') || 'No boreholes found in this area'
          const detail = extras.length > 0 ? ` (+ ${extras.join(', ')})` : ''
          toast(
            result.failed > 0 && result.imported === 0 ? 'error' : 'success',
            summary + detail,
          )
          unhideBoreholes(result.borehole_ids)
          addToManifest('borehole', result.borehole_ids)
          addAllToSet(
            setSessionImportBoreholeIds,
            result.borehole_ids.filter(id => !beforeIds.has(id)),
          )
          await refreshBoreholeList()
          if (result.imported === 1 && result.borehole_ids.length > 0) {
            const id = result.borehole_ids[0]
            setSelectedBoreholeId(id)
            setSelectedId(null)
            await loadBoreholeDetail(id)
            setView('chart')
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'DOV import failed'
        log.error('import', `DOV bbox import failed: ${msg}`, err)
        toast('error', msg)
      } finally {
        setDovImporting(false)
      }
    },
    [
      project,
      bboxImportType,
      cpts,
      boreholes,
      refreshList,
      refreshBoreholeList,
      loadChart,
      loadBoreholeDetail,
      unhideCpts,
      unhideBoreholes,
      addToManifest,
      setSessionImportCptIds,
      setSessionImportBoreholeIds,
    ],
  )


  // ---------------------------------------------------------------------------
  // DEM hillshade overlay state
  // ---------------------------------------------------------------------------
  //
  // The source is determined by the project's default_horizontal_epsg
  // (Belgium → DHMVII, NL → AHN); the overlay state lives in
  // ``project.view_state.dem_overlay`` and round-trips via the
  // .gmproj bundle. ``readDemOverlay`` clamps out-of-range values so
  // a hand-edited bundle can't render an invisible / saturated
  // overlay forever. Memoised on the project handle so render-loop
  // callers don't churn the object identity.
  //
  // These hooks MUST live above every early-return ladder below
  // (apiError / !ready / !project) — Rules of Hooks: the hook count
  // must be identical across renders, and the WelcomeScreen branch
  // would otherwise short-circuit before reaching them, shifting the
  // ordering once a project is opened.
  const demSource = useMemo(
    () => demSourceForEpsg(project?.default_horizontal_epsg ?? null),
    [project?.default_horizontal_epsg],
  )
  const demOverlay = useMemo(
    () => readDemOverlay(project?.view_state),
    [project?.view_state],
  )
  const handleDemOverlayChange = useCallback(
    async (next: DemOverlayState) => {
      // Optimistic UI — the WMS layer flips on/off as fast as the
      // browser can mount the TileLayer. PATCH /view-state runs in
      // the background; failure surfaces a toast but the local UI
      // already reflects the new state. Subsequent saves will write
      // whatever the server has committed by then.
      const ok = await applyViewStatePatch({ dem_overlay: next })
      if (!ok) {
        toast('error', 'Could not save the terrain overlay setting.')
      }
    },
    // ``toast`` is a hoisted ``function`` declaration in this body —
    // stable across renders, omitted from deps to match the
    // convention used by every other callback here.
    [applyViewStatePatch],
  )

  // Resolve the currently-selected section from id + list. Lives here
  // (above the early-return ladder) so the hook count stays stable
  // across renders — same Rules-of-Hooks constraint that put the DEM
  // hooks above this point. The actual render branch consumes
  // ``selectedSection`` below.
  const selectedSection = useMemo(
    () =>
      selectedSectionId
        ? sections.find(s => s.id === selectedSectionId) ?? null
        : null,
    [selectedSectionId, sections],
  )

  // ---------------------------------------------------------------------------
  // Toasts
  // ---------------------------------------------------------------------------

  function toast(type: 'success' | 'error', message: string) {
    const id = ++toastId.current
    setToasts(prev => [...prev, { id, type, message }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (apiError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-gray-100 text-gray-500 text-sm gap-2">
        <div className="text-red-500 font-medium">Failed to start the Strix API</div>
        <div className="text-xs text-gray-400">Check the developer console for the Python traceback.</div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 text-gray-500 text-sm gap-2">
        <div className="animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 w-5 h-5" />
        Starting Strix API…
      </div>
    )
  }

  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={async name => {
            await newProject({ name })
          }}
          onOpenProject={async () => {
            const result = await pickAndOpenProject()
            return result.outcome
          }}
          onOpenRecent={async path => {
            const result = await openProjectFile(path)
            return result !== null
          }}
        />
        {/* The File-menu's New Project item also opens the dialog from
            the welcome screen (where the inline name input would normally
            be enough). Keeping a single dialog instance means the two
            entry points produce identical UX. */}
        <NewProjectDialog
          open={newProjectOpen}
          onCancel={() => setNewProjectOpen(false)}
          onSubmit={async name => {
            const created = await newProject({ name })
            if (created !== null) setNewProjectOpen(false)
          }}
        />
      </>
    )
  }

  const selectedCpt = cpts.find(c => c.id === selectedId)
  const drawingBbox = bboxImportType !== null
  const hasSelection = selectedId !== null || selectedBoreholeId !== null

  return (
    <div className="flex flex-col h-screen bg-white overflow-hidden">
      <Toolbar
            onImportCpt={handleImportCpt}
            onImportDov={handleImportDov}
            onImportBoreholeDov={handleImportBoreholeDov}
            importing={importing || dovImporting}
            drawingBbox={drawingBbox}
          />

      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          cpts={visibleCpts}
          boreholes={visibleBoreholes}
          selectedCptId={selectedId}
          selectedBoreholeId={selectedBoreholeId}
          onSelectCpt={handleSelect}
          onSelectBorehole={handleSelectBorehole}
          onRemoveCpts={handleRemoveCpts}
          onRemoveBoreholes={handleRemoveBoreholes}
          removedCptCount={removedCptIds.size}
          removedBoreholeCount={removedBoreholeIds.size}
          onRestoreAllCpts={handleRestoreAllCpts}
          onRestoreAllBoreholes={handleRestoreAllBoreholes}
          projectName={project.name}
          projectId={project.id}
          projectFilePath={projectFilePath}
          projectDirty={projectDirty}
          sessionImportCptIds={sessionImportCptIds}
          sessionImportBoreholeIds={sessionImportBoreholeIds}
          sessionImportFormationIds={sessionImportFormationIds}
          manifestFormationIds={manifestFormationIds}
          sessionImportSectionIds={sessionImportSectionIds}
          onCloseProject={handleSidebarCloseRequest}
          onEditMetadata={() => setMetadataEditorOpen(true)}
          hiddenCptTypes={hiddenCptTypes}
          hiddenBoreholeValues={hiddenBoreholeValues[boreholeAxis]}
          boreholeAxis={boreholeAxis}
          outOfViewportCptIds={outOfViewportCptIds}
          outOfViewportBoreholeIds={outOfViewportBoreholeIds}
          sections={visibleSections}
          selectedSectionId={selectedSectionId}
          onSelectSection={handleSelectSection}
          onCreateSection={handleCreateSection}
          onDeleteSection={handleDeleteSection}
          canCreateSection={project.default_horizontal_epsg != null}
          onFormationCreated={handleFormationCreated}
          onFormationUpdated={handleFormationUpdated}
          onFormationDeleted={handleFormationDeleted}
          formationsRefreshSignal={formationsRefreshCounter}
          crossingsRefreshSignal={crossingsRefreshCounter}
          activeModelId={activeGeologicalModel?.id ?? null}
          staleSurfaceCount={
            // On-click build pivot: how many cached surfaces no
            // longer reflect the current contacts. Drives the
            // "N unbuilt edits" badge on the Build button.
            Array.from(surfacesByFormationId.values()).filter(
              s => s.is_stale === true,
            ).length
          }
          pushUndoCommand={pushUndo}
          onDedupeContacts={
            activeGeologicalModel ? handleDedupeContacts : undefined
          }
          onRebuildSurfaces={
            activeGeologicalModel ? handleRebuildSurfaces : undefined
          }
          visibleBoreholeIds={visibleBoreholes.map(b => b.id)}
          activeModelName={activeGeologicalModel?.name ?? null}
          visibleBoreholes={visibleBoreholes}
          excludedBoreholeIds={
            activeGeologicalModel?.excluded_borehole_ids ?? []
          }
          onToggleBoreholeInModel={handleToggleBoreholeInModel}
        />

        <main className="flex flex-col flex-1 overflow-hidden">
          {/* Map / Chart tabs only apply to the CPT + borehole flow.
              The Section panel renders fullscreen below and ignores
              this toggle — sections have their own header strip with
              its own controls. */}
          {hasSelection && selectedSection === null && (
            <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-200 bg-gray-50">
              <ViewTab icon={<MapIcon size={13} />} label="Map" active={view === 'map'} onClick={() => setView('map')} />
              <ViewTab icon={<BarChart2 size={13} />} label="Chart" active={view === 'chart'} onClick={() => setView('chart')} />
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {selectedSection !== null ? (
              <SectionPanel
                section={selectedSection}
                zEpsg={project.default_vertical_epsg}
                cpts={visibleCpts}
                boreholes={visibleBoreholes}
                onPatch={handlePatchSelectedSection}
                onClose={() => setSelectedSectionId(null)}
                onSelectCpt={handleSelect}
                onSelectBorehole={handleSelectBorehole}
                contacts={contacts}
                formations={formations}
                surfacesByFormationId={surfacesByFormationId}
                excludedBoreholeIds={
                  activeGeologicalModel?.excluded_borehole_ids ?? []
                }
                onCreateContact={handleCreateContact}
                onUpdateContactDepth={handleUpdateContactDepth}
                onDeleteContact={handleDeleteContact}
                onBatchUpdateContacts={handleBatchUpdateContacts}
                onBatchCreateContacts={handleBatchCreateContacts}
                onAutoPopulateFromStratigraphy={
                  activeGeologicalModel
                    ? handleAutoPopulateFromStratigraphy
                    : undefined
                }
                onCreateFormation={handleInlineCreateFormation}
                onExportDxf={
                  activeGeologicalModel
                    ? () =>
                        handleExportSectionDxf(
                          project.id,
                          selectedSection.id,
                          selectedSection.name,
                          activeGeologicalModel.id,
                        )
                    : undefined
                }
              />
            ) : view === 'map' || !hasSelection ? (
              <MapView
                    cpts={visibleCpts}
                    boreholes={visibleBoreholes}
                    selectedCptId={selectedId}
                    selectedBoreholeId={selectedBoreholeId}
                    onSelectCpt={handleSelect}
                    onSelectBorehole={handleSelectBorehole}
                    hiddenCptTypes={hiddenCptTypes}
                    hiddenBoreholeValues={hiddenBoreholeValues}
                    boreholeAxis={boreholeAxis}
                    onToggleCptType={handleToggleCptType}
                    onToggleBoreholeValue={handleToggleBoreholeValue}
                    onChangeBoreholeAxis={setBoreholeAxis}
                    drawMode={drawingBbox}
                    onBboxDrawn={handleBboxDrawn}
                    onCancelDraw={() => setBboxImportType(null)}
                    onViewportChange={handleViewportChange}
                    demSource={demSource}
                    demOverlay={demOverlay}
                    onDemOverlayChange={handleDemOverlayChange}
                    drawSectionMode={drawingSection}
                    onSectionLineDrawn={handleSectionLineDrawn}
                    onCancelSectionDraw={cancelSectionDraw}
                    sections={sections}
                    selectedSectionId={selectedSectionId}
                    onSelectSection={handleSelectSection}
                    initialCenter={mapCameraRef.current?.center}
                    initialZoom={mapCameraRef.current?.zoom}
                    onCameraChange={handleMapCameraChange}
                  />
            ) : selectedBoreholeId ? (
              boreholeDetailMap.has(selectedBoreholeId) ? (
                <BoreholeLog
                  borehole={boreholeDetailMap.get(selectedBoreholeId)!}
                  onElevationChange={(elevationM, zEpsg) =>
                    handlePatchBoreholeElevation(selectedBoreholeId, elevationM, zEpsg)
                  }
                />
              ) : (
                <div className="flex items-center justify-center h-full text-sm text-gray-400">
                  Loading borehole…
                </div>
              )
            ) : (
              selectedCpt && plotMap.has(selectedId!)
                ? <CptChart
                    plot={plotMap.get(selectedId!)!}
                    name={selectedCpt.name}
                    detail={detailMap.get(selectedId!)}
                    onElevationChange={(elevationM, zEpsg) =>
                      handlePatchCptElevation(selectedId!, elevationM, zEpsg)
                    }
                  />
                : <div className="flex items-center justify-center h-full text-sm text-gray-400">Loading chart…</div>
            )}
          </div>
        </main>
      </div>

      {/* Toast stack — z-[1100] keeps it above Leaflet's stacked
          controls (z-1000) so success / error notifications aren't
          obscured by the legend / layer toggle. */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-[1100]">
        {toasts.map(t => (
          <div
            key={t.id}
            className={[
              'flex items-center gap-2 px-3 py-2 rounded shadow-lg text-sm text-white',
              t.type === 'success' ? 'bg-green-600' : 'bg-red-600'
            ].join(' ')}
          >
            {t.type === 'success' ? <CheckCircle size={14} /> : <AlertTriangle size={14} />}
            {t.message}
          </div>
        ))}
      </div>

      {/* New-project dialog. Sits at the App-shell level so the File-menu
          signal can open it whether the user has a project loaded or not. */}
      <NewProjectDialog
        open={newProjectOpen}
        onCancel={() => setNewProjectOpen(false)}
        onSubmit={async name => {
          const created = await newProject({ name })
          if (created !== null) setNewProjectOpen(false)
        }}
      />

      {/* Project metadata editor. Triggered by clicking the project name
          in the sidebar header. The editor's Save button no longer
          touches the API — it commits to the live project state via
          ``applyMetadataDraft``. The actual DB + file write happens
          when the user invokes File → Save / Ctrl+S, or via "Save and
          close" on the unsaved-changes prompt. */}
      <ProjectMetadataDialog
        open={metadataEditorOpen}
        project={project}
        saved={savedProject}
        onCancel={() => setMetadataEditorOpen(false)}
        onSubmit={patch => {
          applyMetadataDraft(patch)
          setMetadataEditorOpen(false)
        }}
      />

      {/* Close-flow dialogs. Only one is visible at a time; ``attemptClose``
          decides which based on dirty state + trigger source. */}
      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        projectName={project.name}
        busy={unsavedSaving}
        onSave={() => void handleUnsavedSave()}
        onDiscard={handleUnsavedDiscard}
        onCancel={handleUnsavedCancel}
      />
      <Modal
        open={closeConfirmOpen}
        onCancel={() => setCloseConfirmOpen(false)}
        labelledBy="close-project-title"
        cardClassName="w-80"
      >
        <div className="p-5">
          <h2
            id="close-project-title"
            className="text-sm font-semibold text-gray-800 mb-1"
          >
            Close this project?
          </h2>
          <p className="text-xs text-gray-500 mb-4">
            <span className="font-medium text-gray-700">{project.name}</span>{' '}
            will close and you'll be returned to the welcome screen. The
            .gmproj file and your saved data are kept — you can reopen from
            the Recent list.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              size="md"
              onClick={() => setCloseConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              size="md"
              onClick={() => {
                setCloseConfirmOpen(false)
                closeProject()
              }}
            >
              Close project
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function ViewTab({ icon, label, active, onClick }: {
  icon: React.ReactNode; label: string; active: boolean; onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors',
        active ? 'bg-white border border-gray-200 shadow-sm text-gray-800' : 'text-gray-500 hover:text-gray-700'
      ].join(' ')}
    >
      {icon}
      {label}
    </button>
  )
}

