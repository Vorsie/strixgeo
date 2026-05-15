import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { useToasts } from './hooks/useToasts'
import { useAppBoot } from './hooks/useAppBoot'
import { useMapOverlays } from './hooks/useMapOverlays'
import { useGeologicalModel } from './hooks/useGeologicalModel'
import type { ContactCopyPayload } from './hooks/useGeologicalModel'
import { useSections } from './hooks/useSections'
import { useInvestigationData } from './hooks/useInvestigationData'
import { Map as MapIcon, BarChart2, AlertTriangle, CheckCircle } from 'lucide-react'
import L from 'leaflet'
import { api } from './api/client'
import type { BoreholeAxis } from './api/client'
import { useProject } from './hooks/useProject'
import { useUndoStack } from './hooks/useUndoStack'
import { usePersistedSet } from './hooks/usePersistedSet'
import { useTheme } from './hooks/useTheme'
import { addAllToSet } from './utils/sets'
import { isTypingTarget } from './utils/keyboard'
import { log } from './utils/log'
import { idsOutsideBounds } from './utils/viewportFilter'
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
      onMenuEditUndo: (cb: () => void) => () => void
      onMenuEditRedo: (cb: () => void) => () => void
    }
  }
}

type View = 'map' | 'chart'

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

  // Toast notifications — extracted to useToasts so ``toast`` is
  // importable by the other hooks that receive it as a dep-injection param.
  const { toasts, toast } = useToasts()

  // API boot sequence — extracted to useAppBoot.
  const { ready, apiError } = useAppBoot()

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

  // Subscribe to the Edit-menu IPC signals. The menu's keyboard
  // accelerators are display-only (registerAccelerator: false in
  // main/index.ts) so the document keydown listener above still owns
  // the actual keystroke; these handlers route the menu *click* path.
  useEffect(() => {
    const offs = [
      window.electron.onMenuEditUndo(() => void doUndo()),
      window.electron.onMenuEditRedo(() => void doRedo()),
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [doUndo, doRedo])

  // CPT and borehole selection + view tab — these are cross-cutting
  // coordinator state. Both useInvestigationData and useSections need to
  // read / write selection; keeping them in App avoids a circular hook
  // dependency. ``view`` is also App-level since import handlers need to
  // navigate to the chart tab.
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedBoreholeId, setSelectedBoreholeId] = useState<string | null>(null)
  const [view, setView] = useState<View>('map')

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

  // Stable bridge for the geological model hook — abstracts the two
  // separate session-import setters (formation / contact) behind a
  // single ``addToSessionImports(kind, ids)`` dep so the hook's
  // interface stays orthogonal to the session-imports state shape.
  const addToSessionImports = useCallback(
    (kind: 'formation' | 'contact', ids: string[]) => {
      if (kind === 'formation') addAllToSet(setSessionImportFormationIds, ids)
      else addAllToSet(setSessionImportContactIds, ids)
    },
    [setSessionImportFormationIds, setSessionImportContactIds],
  )

  // Geological model — formations, contacts, TIN surfaces, and all
  // mutation handlers (create / update / delete / batch, auto-populate,
  // dedupe, rebuild, Plaxis export, borehole toggle). The cluster is
  // large enough to own its own hook; useGeologicalModel.ts has the
  // full implementation with commentary.
  const {
    activeGeologicalModel,
    formations,
    formationsRefreshCounter,
    contacts,
    surfacesByFormationId,
    crossingsRefreshCounter,
    staleSurfaceCount,
    handleFormationCreated,
    handleFormationUpdated,
    handleFormationDeleted,
    handleInlineCreateFormation,
    refetchFormations,
    handleCreateContact,
    handleUpdateContactDepth,
    handleBatchCreateContacts,
    handleBatchUpdateContacts,
    handleDeleteContact,
    handleAutoPopulateFromStratigraphy,
    handleDedupeContacts,
    handleRebuildSurfaces,
    handleExportModelPlaxis3d,
    handleToggleBoreholeInModel,
    discardContacts,
  } = useGeologicalModel({
    project,
    toast,
    pushUndo,
    addToManifest,
    removeFromManifest,
    addToSessionImports,
  })

  // CPT + borehole data, import flows, hide/restore, elevation edits.
  // Selection state (selectedId/selectedBoreholeId) and view tab are
  // owned by App (declared above) and injected so this hook avoids a
  // circular dep with useSections, which also needs those setters.
  const {
    cpts,
    detailMap,
    plotMap,
    boreholes,
    boreholeDetailMap,
    importing,
    bboxImportType,
    dovImporting,
    removedCptIds,
    removedBoreholeIds,
    refreshList,
    refreshBoreholeList,
    loadCptDetail,
    loadChart,
    loadBoreholeDetail,
    cancelBboxDraw,
    unhideCpts,
    unhideBoreholes,
    handleRemoveCpts,
    handleRemoveBoreholes,
    handleRestoreAllCpts,
    handleRestoreAllBoreholes,
    handlePatchCptElevation,
    handlePatchBoreholeElevation,
    handleImportCpt,
    handleImportDov,
    handleImportBoreholeDov,
    handleBboxDrawn,
  } = useInvestigationData({
    project,
    ready,
    toast,
    pushUndo,
    addToManifest,
    setSessionImportCptIds,
    setSessionImportBoreholeIds,
    selectedId,
    setSelectedId,
    selectedBoreholeId,
    setSelectedBoreholeId,
    setView,
  })

  // Cross-section state and handlers — sections list, selection, draw
  // mode, focused-contact highlight, and all CRUD. The lifecycle
  // callbacks (handleSectionCreated / handleSectionDeleted) are
  // internalised here so the manifest + session-imports bookkeeping
  // is co-located with the mutation handlers that trigger it.
  const {
    sections,
    selectedSectionId,
    drawingSection,
    focusedContactIds,
    visibleSections,
    refreshSectionList,
    clearSectionSelection,
    handleSectionCreated,
    handleSectionDeleted,
    handleCreateSection,
    cancelSectionDraw,
    handleSectionLineDrawn,
    handleDeleteSection,
    handlePatchSelectedSection,
    handleSelectSection,
    handleFocusContacts,
  } = useSections({
    project,
    ready,
    toast,
    pushUndo,
    manifestSectionIds,
    addToManifest,
    removeFromManifest,
    setSessionImportSectionIds,
    contacts,
    boreholes,
    cpts,
    setSelectedId,
    setSelectedBoreholeId,
  })

  // App-level selection wrappers. These live in App (not inside
  // useInvestigationData) because they orchestrate across two hooks:
  // they need ``clearSectionSelection`` from ``useSections`` AND they
  // need ``loadCptDetail`` / ``loadChart`` / ``loadBoreholeDetail``
  // from ``useInvestigationData``. Putting them in either hook would
  // create a circular dependency.
  const handleSelect = useCallback(
    async (id: string): Promise<void> => {
      setSelectedId(id)
      setSelectedBoreholeId(null)
      clearSectionSelection()
      await loadCptDetail(id)
      await loadChart(id)
      setView('chart')
    },
    [setSelectedId, setSelectedBoreholeId, clearSectionSelection, loadCptDetail, loadChart, setView],
  )

  const handleSelectBorehole = useCallback(
    async (id: string): Promise<void> => {
      setSelectedBoreholeId(id)
      setSelectedId(null)
      clearSectionSelection()
      await loadBoreholeDetail(id)
      setView('chart')
    },
    [setSelectedBoreholeId, setSelectedId, clearSectionSelection, loadBoreholeDetail, setView],
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
  //
  // ``handleRebuildSurfaces`` is stable because useGeologicalModel is
  // called above — no TDZ, and the dep array correctly lists it.
  const saveProject = useCallback(async (): Promise<boolean> => {
    // Auto-build: fire-and-forget failure — the user's work must
    // always persist; build failure only means the bundle carries
    // the previous surface cache. handleRebuildSurfaces toasts
    // its own error, so no extra toast needed here.
    try {
      await handleRebuildSurfaces()
    } catch {
      // handleRebuildSurfaces already logged and toasted. Proceed.
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
    handleRebuildSurfaces,
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


  // DEM hillshade + DOV Virtuele Boring overlays — extracted to useMapOverlays.
  // Depends only on project (for view_state keys) and applyViewStatePatch.
  const {
    demSource,
    demOverlay,
    handleDemOverlayChange,
    virtueleBoringOverlay,
    virtueleBoringSectionModels,
    virtueleBoringPredictions,
    virtueleBoringPredictionByInvestigationId,
    cptEffectiveModels,
    boreholeEffectiveModels,
    showOverlayOnSection,
    showOverlayOnCpt,
    showOverlayOnBorehole,
    cptVirtueleBoringOverride,
    boreholeVirtueleBoringOverride,
    handleChangeVirtueleBoringPicker,
    handleSetShowOverlay,
    handleSetOverlayOverride,
  } = useMapOverlays({ project, applyViewStatePatch, toast })

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
          onFocusContacts={handleFocusContacts}
          pushUndoCommand={pushUndo}
          onDedupeContacts={
            activeGeologicalModel ? handleDedupeContacts : undefined
          }
          onRebuildSurfaces={
            activeGeologicalModel ? handleRebuildSurfaces : undefined
          }
          onExportPlaxis3d={
            activeGeologicalModel ? handleExportModelPlaxis3d : undefined
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
                onClose={clearSectionSelection}
                onSelectCpt={handleSelect}
                onSelectBorehole={handleSelectBorehole}
                contacts={contacts}
                formations={formations}
                surfacesByFormationId={surfacesByFormationId}
                focusedContactIds={focusedContactIds}
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
                virtueleBoringActiveModels={virtueleBoringSectionModels}
                virtueleBoringPredictions={virtueleBoringPredictions}
                virtueleBoringModelA={virtueleBoringOverlay.modelA}
                virtueleBoringModelB={virtueleBoringOverlay.modelB}
                virtueleBoringMaxDepthM={virtueleBoringOverlay.maxDepthM}
                virtueleBoringShowOnSection={showOverlayOnSection}
                onChangeVirtueleBoringPicker={handleChangeVirtueleBoringPicker}
                onChangeVirtueleBoringShowOnSection={next =>
                  handleSetShowOverlay('section', next)
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
                    onCancelDraw={cancelBboxDraw}
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
                  virtueleBoringPrediction={
                    virtueleBoringPredictionByInvestigationId.get(selectedBoreholeId) ?? null
                  }
                  virtueleBoringActiveModels={boreholeEffectiveModels}
                  virtueleBoringMaxDepthM={virtueleBoringOverlay.maxDepthM}
                  virtueleBoringVisible={showOverlayOnBorehole}
                  onToggleVirtueleBoringVisible={() =>
                    handleSetShowOverlay('borehole', !showOverlayOnBorehole)
                  }
                  virtueleBoringOverrideModel={boreholeVirtueleBoringOverride}
                  onChangeVirtueleBoringOverrideModel={next =>
                    handleSetOverlayOverride('borehole', next)
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
                    virtueleBoringPrediction={
                      virtueleBoringPredictionByInvestigationId.get(selectedId!) ?? null
                    }
                    virtueleBoringActiveModels={cptEffectiveModels}
                    virtueleBoringMaxDepthM={virtueleBoringOverlay.maxDepthM}
                    virtueleBoringVisible={showOverlayOnCpt}
                    onToggleVirtueleBoringVisible={() =>
                      handleSetShowOverlay('cpt', !showOverlayOnCpt)
                    }
                    virtueleBoringOverrideModel={cptVirtueleBoringOverride}
                    onChangeVirtueleBoringOverrideModel={next =>
                      handleSetOverlayOverride('cpt', next)
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

