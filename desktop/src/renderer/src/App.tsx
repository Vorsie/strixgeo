import { useEffect, useMemo, useState, useCallback } from 'react'
import { useToasts } from './hooks/useToasts'
import { useAppBoot } from './hooks/useAppBoot'
import { useMapOverlays } from './hooks/useMapOverlays'
import { useGeologicalModel } from './hooks/useGeologicalModel'
import { useSections } from './hooks/useSections'
import { useInvestigationData } from './hooks/useInvestigationData'
import { useProjectLifecycle } from './hooks/useProjectLifecycle'
import { useMapState } from './hooks/useMapState'
import { AlertTriangle, CheckCircle } from 'lucide-react'
import { api } from './api/client'
import { useProject } from './hooks/useProject'
import { useUndoStack } from './hooks/useUndoStack'
import { usePersistedSet } from './hooks/usePersistedSet'
import { useTheme } from './hooks/useTheme'
import { addAllToSet, removeAllFromSet } from './utils/sets'
import { isTypingTarget } from './utils/keyboard'
import { log } from './utils/log'
import { idsOutsideBounds } from './utils/viewportFilter'
import WelcomeScreen from './components/WelcomeScreen'
import NewProjectDialog from './components/NewProjectDialog'
import ProjectMetadataDialog from './components/ProjectMetadataDialog'
import UnsavedChangesDialog from './components/UnsavedChangesDialog'
import Modal from './components/ui/Modal'
import Button from './components/ui/Button'
import AppShell from './shell/AppShell'
import type { ShellContextValue } from './shell/ShellContext'

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
  // Capture the full result so the shell context can expose the live
  // canUndo / canRedo / busy flags (B1 fix). The object is rebuilt
  // every render whenever busy / canUndo / canRedo state changes, so
  // it MUST NOT go into any useEffect or useCallback dep array — that
  // would create an infinite render loop.
  //
  // CRITICAL: destructure the individual stable callbacks from the
  // result and use ONLY those callbacks in effects + other hooks.
  // The wrapper object (``undoStack``) goes into the shell context
  // memo dep array (correct — the memo SHOULD rebreak when undo state
  // changes so stage components see updated canUndo / canRedo), but
  // NEVER into a useEffect / useCallback dep list.
  const undoStack = useUndoStack({
    onError: msg => toast('error', msg),
  })
  const {
    push: pushUndo,
    undo: doUndo,
    redo: doRedo,
    clear: clearUndo,
  } = undoStack

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

  // Map marquee selection — investigation IDs selected by Shift+drag on
  // the map. Drives the checkbox state in DataInspector so map and list
  // stay in sync. Cleared when the project changes (cross-project IDs
  // are semantically undefined). Lives in App (not DataInspector) because
  // MapView writes it and DataInspector reads it — different components
  // that cannot share local state without the coordinator bus.
  const [marqueeSelectedIds, setMarqueeSelectedIds] = useState<Set<string>>(new Set())

  // Map layer-visibility, viewport bounds, and Leaflet camera persistence —
  // all lifted to App so the Sidebar can read/write the same state as
  // MapView, but grouped in a hook so App stays a thin coordinator.
  // Capture the full result as ``mapState`` so it can enter the shell
  // context bus; individual callbacks are destructured for use in hooks
  // + effects whose dep arrays must not see the rebuilt object each render.
  const mapState = useMapState()
  const {
    hiddenCptTypes,
    boreholeAxis,
    hiddenBoreholeValues,
    viewportBounds,
    mapCameraRef,
    handleToggleCptType,
    handleToggleBoreholeValue,
    setBoreholeAxis,
    handleViewportChange,
    handleMapCameraChange,
  } = mapState

  // Reset the persisted Leaflet camera on project switch. mapCameraRef is
  // a stable ref that outlives any single project; without this reset,
  // opening project B after panning project A would restore A's viewport
  // and suppress auto-fit (B's investigations would land off-screen).
  // Pairs with the FitOnLoad re-arm in MapView. Placed AFTER the mapState
  // destructure (not next to clearUndo) — mapCameraRef is declared here,
  // so an earlier effect would hit a TDZ.
  useEffect(() => {
    mapCameraRef.current = null
    // Also clear the map marquee selection — cross-project IDs are
    // semantically undefined; start fresh on each project open.
    setMarqueeSelectedIds(new Set())
  }, [project?.id, mapCameraRef])

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

  // Dual of ``addToSessionImports`` — drops ids from the session-import
  // set so deleting a created-but-unsaved formation/contact clears its
  // contribution to ``projectDirty``. Restores behaviour the pre-hook
  // App.tsx had inline in ``handleFormationDeleted``; without it a
  // create-then-delete-before-save leaves the project permanently dirty.
  const removeFromSessionImports = useCallback(
    (kind: 'formation' | 'contact', ids: string[]) => {
      if (kind === 'formation') removeAllFromSet(setSessionImportFormationIds, ids)
      else removeAllFromSet(setSessionImportContactIds, ids)
    },
    [setSessionImportFormationIds, setSessionImportContactIds],
  )

  // Geological model — formations, contacts, TIN surfaces, and all
  // mutation handlers (create / update / delete / batch, auto-populate,
  // dedupe, rebuild, Plaxis export, borehole toggle). The cluster is
  // large enough to own its own hook; useGeologicalModel.ts has the
  // full implementation with commentary.
  const geo = useGeologicalModel({
    project,
    toast,
    pushUndo,
    addToManifest,
    removeFromManifest,
    addToSessionImports,
    removeFromSessionImports,
  })
  // Local destructure is for App.tsx's own use ONLY. The COMPLETE hook
  // result is handed to the shell as `geoModel: geo` (below) — never a
  // re-listed literal. A hand-mirrored object literal silently dropped
  // discoverBoreholeFormations / applyBoreholeFormationSelection /
  // handleDeleteModel and crashed Fill at runtime (2026-05-16); App.tsx
  // tsc noise is ignored + Vitest stubs the coordinator, so neither gate
  // caught it. Passing `geo` whole makes that drift structurally
  // impossible.
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
  } = geo

  // Project lifecycle — dirty flag, File menu IPC, close-flow dialogs,
  // Save / Discard / window title / OS quit handshake. Wired here (after
  // useGeologicalModel) because discardSessionImports calls discardContacts
  // + activeGeologicalModel.
  const {
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
    handleSidebarCloseRequest,
    handleUnsavedSave,
    handleUnsavedDiscard,
    handleUnsavedCancel,
  } = useProjectLifecycle({
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

  // Wire the File → Import CPT menu signal to the import flow. The
  // handler now lives in useInvestigationData (post hook-split), so this
  // subscription effect sits here — without it the menu item is silently
  // dead (the keyboard path goes through the Toolbar button, the menu
  // path needs this). onMenuImportBorehole has never been wired (pre-
  // existing gap, tracked separately — not restored here so this stays a
  // faithful behaviour restoration, not a feature add).
  useEffect(() => {
    const off = window.electron.onMenuImportCpt(() => void handleImportCpt())
    return off
  }, [handleImportCpt])

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


  // Export the section's drawn geological model to DXF. Owns the
  // full flow (fetch bytes → save dialog → file write) so the
  // SectionPanel + SectionHeader stay storage-agnostic. The button
  // is hidden when no active geological model exists (v1.0 MVP #5).
  // note: also enters shellContextValue (coordinator slice) — keep its identity stable.
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
    // reason: toast from useToasts closes over a toastId ref internally,
    // so identity instability does not cause stale-closure reads here.
    // The handler only dispatches fire-and-forget API calls and dialog
    // interactions that do not depend on any captured state that can go
    // stale — the empty dep array is intentionally safe.
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

  // Manifest-filtered formation list — single source of truth for
  // "which formations are visible". Injected onto the geoModel bus so
  // GeologyInspector, GeologyStage badge, and SectionsToolbar Seed gate
  // all read the same value (Fix 3 — 2026-05-16). Formations have no
  // removed-set; the manifest is the only filter.
  const visibleFormations = useMemo(
    () =>
      manifestFormationIds !== undefined
        ? formations.filter(f => manifestFormationIds.has(f.id))
        : formations,
    [formations, manifestFormationIds],
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



  // DEM hillshade + DOV Virtuele Boring overlays — extracted to useMapOverlays.
  // Depends only on project (for view_state keys) and applyViewStatePatch.
  const {
    demSource,
    demOverlay,
    handleDemOverlayChange,
    virtueleBoringOverlay,
    virtueleBoringSectionModels,
    virtueleBoringPredictions,
    virtueleBoringLoading,
    virtueleBoringSkippedCount,
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
  // Shell context value — assembled here and passed to AppShell.
  //
  // §8 Risk 2 mitigation: wrapped in useMemo so the object reference stays
  // stable across renders where none of the hook results actually changed.
  // Without the memo, every App render would recreate the object and cause
  // every useShell() consumer to re-render.
  //
  // The dep array lists every hook return object. Each hook already returns
  // stable references via useCallback/useMemo internally, so this outer
  // memo only breaks when something genuinely changes.
  //
  // ``project`` is listed separately and cast to non-null because AppShell
  // only mounts inside the project gate (``if (!project) return <WelcomeScreen />``
  // runs first). The cast is safe at the point AppShell renders.
  // ---------------------------------------------------------------------------
  const shellContextValue = useMemo((): ShellContextValue => ({
    // project is non-null here — AppShell is only rendered inside the
    // project gate below. The loaded-project branch asserts project is truthy.
    project: project!,
    lifecycle: {
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
      handleSidebarCloseRequest,
      handleUnsavedSave,
      handleUnsavedDiscard,
      handleUnsavedCancel,
    },
    investigations: {
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
    },
    visibleCpts,
    visibleBoreholes,
    // Whole hook result — see the comment at the useGeologicalModel call.
    // Re-listing fields here is what dropped Fill's discover/apply.
    // visibleFormations is overridden here because the hook itself does not
    // have access to manifestFormationIds (a coordinator-level value). The
    // spread adds the single extra field without re-listing every other field;
    // all other geo fields remain exactly as the hook returned them.
    geoModel: { ...geo, visibleFormations },
    sections: {
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
    },
    overlays: {
      demSource,
      demOverlay,
      handleDemOverlayChange,
      virtueleBoringOverlay,
      virtueleBoringSectionModels,
      virtueleBoringPredictions,
      virtueleBoringLoading,
      virtueleBoringSkippedCount,
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
    },
    toasts: { toasts, toast },
    undo: undoStack,
    boot: { ready, apiError },
    mapState,
    coordinator: {
      selectedId,
      selectedBoreholeId,
      setSelectedId,
      setSelectedBoreholeId,
      view,
      setView,
      handleSelect,
      handleSelectBorehole,
      handleExportSectionDxf,
      outOfViewportCptIds,
      outOfViewportBoreholeIds,
      projectFilePath,
      manifestFormationIds,
      sessionImportCptIds,
      sessionImportBoreholeIds,
      sessionImportSectionIds,
      sessionImportFormationIds,
      marqueeSelectedIds,
      setMarqueeSelectedIds,
    },
  }), [
    project,
    // lifecycle fields
    projectDirty, newProjectOpen, setNewProjectOpen,
    metadataEditorOpen, setMetadataEditorOpen,
    closeConfirmOpen, setCloseConfirmOpen,
    unsavedDialogOpen, unsavedSaving,
    saveProject, discardSessionImports, handleSidebarCloseRequest,
    handleUnsavedSave, handleUnsavedDiscard, handleUnsavedCancel,
    // investigation fields
    cpts, detailMap, plotMap, boreholes, boreholeDetailMap,
    importing, bboxImportType, dovImporting,
    removedCptIds, removedBoreholeIds,
    refreshList, refreshBoreholeList,
    loadCptDetail, loadChart, loadBoreholeDetail,
    cancelBboxDraw, unhideCpts, unhideBoreholes,
    handleRemoveCpts, handleRemoveBoreholes,
    handleRestoreAllCpts, handleRestoreAllBoreholes,
    handlePatchCptElevation, handlePatchBoreholeElevation,
    handleImportCpt, handleImportDov, handleImportBoreholeDov, handleBboxDrawn,
    visibleCpts, visibleBoreholes,
    // geological model fields
    activeGeologicalModel, formations, visibleFormations, formationsRefreshCounter,
    contacts, surfacesByFormationId, crossingsRefreshCounter, staleSurfaceCount,
    handleFormationCreated, handleFormationUpdated, handleFormationDeleted,
    handleInlineCreateFormation, refetchFormations,
    handleCreateContact, handleUpdateContactDepth,
    handleBatchCreateContacts, handleBatchUpdateContacts, handleDeleteContact,
    handleAutoPopulateFromStratigraphy, handleDedupeContacts,
    handleRebuildSurfaces, handleExportModelPlaxis3d,
    handleToggleBoreholeInModel, discardContacts,
    // sections fields
    sections, selectedSectionId, drawingSection, focusedContactIds, visibleSections,
    refreshSectionList, clearSectionSelection,
    handleSectionCreated, handleSectionDeleted,
    handleCreateSection, cancelSectionDraw, handleSectionLineDrawn,
    handleDeleteSection, handlePatchSelectedSection,
    handleSelectSection, handleFocusContacts,
    // overlay fields
    demSource, demOverlay, handleDemOverlayChange,
    virtueleBoringOverlay, virtueleBoringSectionModels,
    virtueleBoringPredictions, virtueleBoringLoading, virtueleBoringSkippedCount,
    virtueleBoringPredictionByInvestigationId,
    cptEffectiveModels, boreholeEffectiveModels,
    showOverlayOnSection, showOverlayOnCpt, showOverlayOnBorehole,
    cptVirtueleBoringOverride, boreholeVirtueleBoringOverride,
    handleChangeVirtueleBoringPicker, handleSetShowOverlay, handleSetOverlayOverride,
    // toast + undo + boot
    toasts, toast,
    undoStack,
    ready, apiError,
    // mapState — object rebuilt each render when layer-visibility changes;
    // include it so context updates when the user toggles a CPT type or moves the map.
    mapState,
    // coordinator slice — all are either useState values or stable useCallback refs.
    selectedId, selectedBoreholeId, setSelectedId, setSelectedBoreholeId,
    view, setView,
    handleSelect, handleSelectBorehole, handleExportSectionDxf,
    outOfViewportCptIds, outOfViewportBoreholeIds,
    projectFilePath, manifestFormationIds,
    sessionImportCptIds, sessionImportBoreholeIds, sessionImportSectionIds,
    sessionImportFormationIds,
    marqueeSelectedIds, setMarqueeSelectedIds,
  ])

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

  // S3: project is loaded — render the shell with empty stage slot placeholders.
  // The old Toolbar / Sidebar / main content block is deferred to S4/S5
  // (DataStage + SectionsStage migration). Dialogs and toasts remain at App
  // level because they overlay the entire shell.
  //
  // IMPORTANT: the WelcomeScreen path above must remain intact and the smoke
  // test must stay green (it never loads a project so it always hits the
  // !project branch). This branch only renders when project is non-null.

  return (
    <>
      {/* Shell — takes the full viewport. Stage zone components are
          placeholder nulls in S3; S4/S5 fill them. */}
      <AppShell context={shellContextValue} />

      {/* Toast stack — stays at App level (outside ShellContext.Provider) so
          it overlays all shell chrome. z-[1100] keeps it above Leaflet's
          stacked controls (z-1000). */}
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

      {/* New-project dialog. Sits at the App level so the File-menu signal
          can open it whether a project is loaded or not. */}
      <NewProjectDialog
        open={newProjectOpen}
        onCancel={() => setNewProjectOpen(false)}
        onSubmit={async name => {
          const created = await newProject({ name })
          if (created !== null) setNewProjectOpen(false)
        }}
      />

      {/* Project metadata editor. Triggered by clicking the project name in
          the sidebar header. Save commits to live state; the DB + file write
          happens on File → Save / Ctrl+S. */}
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
    </>
  )
}

