import { useEffect, useMemo, useState, useCallback } from 'react'
import { useToasts } from './hooks/useToasts'
import { useAppBoot } from './hooks/useAppBoot'
import { useMapOverlays } from './hooks/useMapOverlays'
import { useGeologicalModel } from './hooks/useGeologicalModel'
import { useSections } from './hooks/useSections'
import { useInvestigationData } from './hooks/useInvestigationData'
import { useProjectLifecycle } from './hooks/useProjectLifecycle'
import { useMapState } from './hooks/useMapState'
import { useShellContextValue } from './hooks/useShellContextValue'
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
import AppBootError from './components/AppBootError'
import AppLoading from './components/AppLoading'
import AppDialogs from './components/AppDialogs'
import SettingsDialog from './components/SettingsDialog'
import {
  buildLithoSegmenterPatch,
  readLithoSegmenterPrefs,
  type LithoSegmenterPrefs,
} from './utils/lithoSegmenterPrefs'
import {
  buildSectionDefaultsPatch,
  readSectionDefaults,
  type SectionDefaults,
} from './utils/sectionDefaults'
import AppShell from './shell/AppShell'
import type { ShellContextValue } from './shell/ShellContext'

interface RecentProject {
  path: string
  name: string
  lastOpened: string
}

// Local FileFilter shape — matches Electron's ``Electron.FileFilter`` but
// declared inline so we don't pull in the full ``electron`` ambient
// namespace just for one shape. The renderer doesn't import the
// Electron module directly (main + preload do).
interface FileFilter {
  name: string
  extensions: string[]
}

declare global {
  interface Window {
    electron: {
      getApiBaseUrl: () => Promise<string>
      waitForApi: () => Promise<boolean>
      openFile: (filters: FileFilter[]) => Promise<string | null>
      openFiles: (filters: FileFilter[]) => Promise<string[]>
      readFile: (filePath: string) => Promise<Buffer>
      // Project file lifecycle (Phase 4 multi-project)
      showProjectOpenDialog: () => Promise<string | null>
      showProjectSaveDialog: (defaultName?: string) => Promise<string | null>
      readProjectFile: (filePath: string) => Promise<string>
      writeProjectFile: (filePath: string, contents: string) => Promise<void>
      // Generic export save-dialog + binary write (v1.0 MVP gate #5).
      showExportSaveDialog: (
        defaultName: string,
        filters: FileFilter[],
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
      onMenuOpenSettings: (cb: () => void) => () => void
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
    currentLumping,
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
    revertToLastSaved,
    saveAsProject,
    closeProject,
    stageLumping,
  } = useProject()

  // Toast notifications — extracted to useToasts so ``toast`` is
  // importable by the other hooks that receive it as a dep-injection param.
  const { toasts, toast } = useToasts()

  // API boot sequence — extracted to useAppBoot.
  const { ready, apiError } = useAppBoot()

  // Initialise the theme system. The hook itself owns the class on
  // <html>. ``choice`` + ``setChoice`` feed the Settings dialog's
  // Appearance section so the user can pin light/dark; absent that
  // override, the hook tracks the OS preference live.
  const { choice: themeChoice, setChoice: setThemeChoice } = useTheme()

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

  // File → Settings… (Ctrl+,). Opens the renderer-side SettingsDialog.
  const [settingsOpen, setSettingsOpen] = useState(false)
  useEffect(() => {
    const off = window.electron.onMenuOpenSettings(() => setSettingsOpen(true))
    return off
  }, [])

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

  // Hovered investigation id — DataInspector row hover writes it,
  // MapView reads it to highlight the matching marker (only if that
  // marker is currently visible, since MapView only renders visible
  // ones). Soft coupling via the bus; cleared on project change.
  const [hoveredTestId, setHoveredTestId] = useState<string | null>(null)

  // Geology deep-link target — set from the Sections (litho) canvas when
  // the user picks "Edit in Geology stage" on a geological contact.
  // AppShell watches this, switches to the geology stage, and selects the
  // section. GeologyInspector reads it to highlight the specific contact.
  // Cleared after the navigation applies (single-fire).
  const [geoDeepLinkTarget, setGeoDeepLinkTarget] = useState<{
    sectionId: string
    contactId: string
  } | null>(null)

  // Correlation-edges refetch nonce (#163c). Auto-correlate is fired from
  // SectionsToolbar via the geoModel slice, but the contact-correlation edge
  // state lives in SectionsCanvas (a sibling). Bumping this nonce after a
  // successful auto-correlate is the cross-boundary signal that tells the
  // canvas to refetch its edges so the overlay updates without a manual
  // section reselect. Soft coupling via the bus, same as geoDeepLinkTarget.
  const [correlationEdgesRefetchNonce, setCorrelationEdgesRefetchNonce] =
    useState(0)
  const requestCorrelationEdgesRefetch = useCallback(() => {
    setCorrelationEdgesRefetchNonce(n => n + 1)
  }, [])

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
    setHoveredTestId(null)
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

  // Two-stage save / dirty (#160). Geology MUTATIONS (depth drag, delete,
  // batch update) change pre-existing rows that never flow through the
  // session-import manifest, so without this flag they would never mark the
  // project dirty — the close prompt wouldn't fire and the edits would
  // silently survive a close-without-save. ``markMutated`` is injected into
  // useGeologicalModel; the flag is OR'd into ``projectDirty`` and cleared on
  // save / revert / project switch. Decoupled from the session-import
  // delete-manifest: a mutated row must NOT be deleted on discard — the
  // replace-restore reverts it instead.
  const [hasUnsavedMutations, setHasUnsavedMutations] = useState(false)
  const markMutated = useCallback(() => setHasUnsavedMutations(true), [])
  // Reset on project open / close / switch: a fresh project starts clean,
  // and a close-without-save tears the project down (id → undefined).
  useEffect(() => {
    setHasUnsavedMutations(false)
  }, [project?.id])

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
    manifestFormationIds,
    currentLumping,
    stageLumping,
    requestCorrelationEdgesRefetch,
    markMutated,
  })
  // Local destructure is for App.tsx's own use ONLY. The COMPLETE hook
  // result is handed to the shell as `geoModel: geo` (below) — never a
  // re-listed literal. A hand-mirrored object literal silently dropped
  // discoverBoreholeFormations / applyBoreholeFormationSelection /
  // handleDeleteModel and crashed Fill at runtime (2026-05-16); App.tsx
  // tsc noise is ignored + Vitest stubs the coordinator, so neither gate
  // caught it. Passing `geo` whole makes that drift structurally
  // impossible.
  // Only the geo fields App itself still uses are destructured here.
  // Post-#12: the shellContextValue memo (which referenced the other
  // ~18) moved to useShellContextValue, which receives `geo` whole and
  // re-destructures internally — so those are no longer needed in App
  // scope (pruning them keeps the eslint no-unused-vars gate green).
  const {
    activeGeologicalModel,
    formations,
    contacts,
    // Slice 2 (#55): dep-injected into useSections for axis-aware
    // handleFocusContacts — not used further in App.tsx scope.
    lithoContacts,
    handleFormationDeleted,
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
    handleCloseProjectRequest,
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
    stageLumping,
    currentLumping,
    hasUnsavedMutations,
    setHasUnsavedMutations,
    revertToLastSaved,
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
    dovImportState,
    resetDovImport,
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
    pendingCptPins,
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
    effectiveHorizontalEpsg,
    sectionModelAxis,
    setSectionModelAxis,
    backdropModelIdOverride,
    setBackdropModelIdOverride,
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
    applyUpdatedSection,
    sectionFocusedColumn,
    setSectionFocusedColumn,
    correlateMode,
    correlationSource,
    enterCorrelateMode,
    exitCorrelateMode,
    armCorrelationSource,
    clearCorrelationSource,
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
    // Slice 2 (#55): dep-inject the litho contact list so handleFocusContacts
    // can resolve contacts on the litho axis without coupling useSections to the
    // geo model hook directly.
    lithoContacts,
    boreholes,
    cpts,
    setSelectedId,
    setSelectedBoreholeId,
  })

  // App-level selection wrappers. These live in App (not inside
  // useInvestigationData) because they need ``loadCptDetail`` /
  // ``loadChart`` / ``loadBoreholeDetail`` from ``useInvestigationData``
  // alongside the App-level selection setters.
  //
  // They deliberately do NOT clear the section selection: opening a
  // test's detail (right-click → Open detail on a section, or a map
  // click) keeps the user's open cross-section as their workspace, so
  // Esc / the Sections spine return straight to it instead of an empty
  // Sections stage. On the Data-stage map no section is open, so this
  // is a no-op there.
  const handleSelect = useCallback(
    async (id: string): Promise<void> => {
      setSelectedId(id)
      setSelectedBoreholeId(null)
      await loadCptDetail(id)
      await loadChart(id)
      setView('chart')
    },
    [setSelectedId, setSelectedBoreholeId, loadCptDetail, loadChart, setView],
  )

  const handleSelectBorehole = useCallback(
    async (id: string): Promise<void> => {
      setSelectedBoreholeId(id)
      setSelectedId(null)
      await loadBoreholeDetail(id)
      setView('chart')
    },
    [setSelectedBoreholeId, setSelectedId, loadBoreholeDetail, setView],
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

  // Section PDF report (debt #52 slice 1). Same fetch → save-dialog →
  // file-write flow as handleExportSectionDxf, plus a user-editable
  // metadata bundle (title, author, notes) forwarded as query params.
  // The dialog that collects the metadata lives in the SectionsToolbar
  // Export dropdown — this handler only owns the IO.
  // note: also enters shellContextValue (coordinator slice) — keep its identity stable.
  const handleExportSectionPdf = useCallback(
    async (
      projectId: string,
      sectionId: string,
      sectionName: string,
      modelId: string,
      metadata: { title?: string; author?: string; notes?: string },
    ): Promise<void> => {
      log.info('section', `exportPdf start section=${sectionId} model=${modelId}`)
      try {
        const safeName =
          sectionName.replace(/[^A-Za-z0-9\- _]/g, '_').trim() || 'section'
        const dialogPath = await window.electron.showExportSaveDialog(
          `${safeName}.pdf`,
          [
            { name: 'PDF', extensions: ['pdf'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        )
        if (dialogPath === null) {
          log.debug('section', 'exportPdf cancelled at save dialog')
          return
        }
        const bytes = await api.section.exportPdf(
          projectId,
          sectionId,
          modelId,
          metadata,
        )
        await window.electron.writeExportFile(dialogPath, bytes)
        log.success(
          'section',
          `exportPdf ok section=${sectionId} bytes=${bytes.byteLength} path=${dialogPath}`,
        )
        toast('success', 'PDF exported.')
      } catch (err) {
        log.error('section', 'exportPdf failed', err)
        toast(
          'error',
          err instanceof Error ? err.message : 'Could not export the PDF.',
        )
      }
    },
    // reason: toast from useToasts closes over a toastId ref internally,
    // so identity instability does not cause stale-closure reads here.
    // The handler only dispatches fire-and-forget API calls and dialog
    // interactions that do not depend on any captured state that can go
    // stale — the empty dep array is intentionally safe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Plaxis 2D per-section export (debt #29) — section-scoped sibling
  // of the model-wide Plaxis 3D export. Same fetch → save-dialog →
  // file-write flow as handleExportSectionDxf so the Export hub +
  // Sections toolbar stay storage-agnostic.
  // note: also enters shellContextValue (coordinator slice) — keep its identity stable.
  const handleExportSectionPlaxis2d = useCallback(
    async (
      projectId: string,
      sectionId: string,
      sectionName: string,
      modelId: string,
    ): Promise<void> => {
      log.info('section', `exportPlaxis2d start section=${sectionId} model=${modelId}`)
      try {
        const safeName =
          sectionName.replace(/[^A-Za-z0-9\- _]/g, '_').trim() || 'section'
        const dialogPath = await window.electron.showExportSaveDialog(
          `${safeName}_plaxis2d.py`,
          [
            { name: 'Python script', extensions: ['py'] },
            { name: 'All Files', extensions: ['*'] },
          ],
        )
        if (dialogPath === null) {
          log.debug('section', 'exportPlaxis2d cancelled at save dialog')
          return
        }
        const bytes = await api.section.exportPlaxis2d(projectId, sectionId, modelId)
        await window.electron.writeExportFile(dialogPath, bytes)
        log.success(
          'section',
          `exportPlaxis2d ok section=${sectionId} bytes=${bytes.byteLength} path=${dialogPath}`,
        )
        toast('success', 'Plaxis 2D script exported.')
      } catch (err) {
        log.error('section', 'exportPlaxis2d failed', err)
        toast(
          'error',
          err instanceof Error
            ? err.message
            : 'Could not export the Plaxis 2D script.',
        )
      }
    },
    // reason: identical safety argument to handleExportSectionDxf above —
    // toast's identity instability is internally guarded, and the handler
    // captures no state that can go stale. Empty dep array intentional.
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

  // R4 (debt #12): the manifest-filtered formation list moved INTO
  // useGeologicalModel (it now takes manifestFormationIds). App no
  // longer post-processes the geo slice — see geoModel: geo below.

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
    showConfidenceFade,
    handleSetShowConfidenceFade,
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

  // Settings dialog — initial values + submit handlers must be declared
  // above the early-return ladder so the hook count stays stable across
  // the !project / project transition. The dialog itself mounts in
  // BOTH render branches (welcome + shell).
  const initialLithoSegmenterPrefs = useMemo(
    () => readLithoSegmenterPrefs(project?.view_state ?? null),
    [project],
  )
  const initialSectionDefaults = useMemo(
    () => readSectionDefaults(project?.view_state ?? null),
    [project],
  )
  const handleSettingsLithoSegmenterSubmit = useCallback(
    (next: LithoSegmenterPrefs) => {
      void applyViewStatePatch(buildLithoSegmenterPatch(next))
    },
    [applyViewStatePatch],
  )
  const handleSettingsSectionDefaultsSubmit = useCallback(
    (next: SectionDefaults) => {
      void applyViewStatePatch(buildSectionDefaultsPatch(next))
    },
    [applyViewStatePatch],
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
  // R5/#12 net-first: the 194-line shellContextValue memo moved to
  // useShellContextValue (verbatim body+deps; renderHook-netted for
  // assembly/no-stale/stability — debt #53). App just supplies the
  // bindings it already has in scope.
  const shellContextValue = useShellContextValue({
    // project
    project,
    // lifecycle
    projectDirty, newProjectOpen, setNewProjectOpen, metadataEditorOpen, setMetadataEditorOpen, closeConfirmOpen,
    setCloseConfirmOpen, unsavedDialogOpen, unsavedSaving, saveProject, discardSessionImports, handleCloseProjectRequest,
    handleUnsavedSave, handleUnsavedDiscard, handleUnsavedCancel, stageLumping, currentLumping,
    // investigations
    cpts, detailMap, plotMap, boreholes, boreholeDetailMap, importing,
    bboxImportType, dovImporting, dovImportState, resetDovImport, removedCptIds, removedBoreholeIds, refreshList, refreshBoreholeList,
    loadCptDetail, loadChart, loadBoreholeDetail, cancelBboxDraw, unhideCpts, unhideBoreholes,
    handleRemoveCpts, handleRemoveBoreholes, handleRestoreAllCpts, handleRestoreAllBoreholes, handlePatchCptElevation, handlePatchBoreholeElevation,
    handleImportCpt, handleImportDov, handleImportBoreholeDov, handleBboxDrawn,
    pendingCptPins,
    // visible + geo
    visibleCpts, visibleBoreholes, geo,
    // sections
    sections, selectedSectionId, drawingSection, focusedContactIds, visibleSections, effectiveHorizontalEpsg,
    sectionModelAxis, setSectionModelAxis, backdropModelIdOverride, setBackdropModelIdOverride,
    refreshSectionList, clearSectionSelection, handleSectionCreated, handleSectionDeleted, handleCreateSection, cancelSectionDraw,
    handleSectionLineDrawn, handleDeleteSection, handlePatchSelectedSection, handleSelectSection, handleFocusContacts, applyUpdatedSection, sectionFocusedColumn, setSectionFocusedColumn,
    correlateMode, correlationSource, enterCorrelateMode, exitCorrelateMode, armCorrelationSource, clearCorrelationSource,
    // overlays
    demSource, demOverlay, handleDemOverlayChange, virtueleBoringOverlay, virtueleBoringSectionModels, virtueleBoringPredictions,
    virtueleBoringLoading, virtueleBoringSkippedCount, virtueleBoringPredictionByInvestigationId, cptEffectiveModels, boreholeEffectiveModels, showOverlayOnSection,
    showOverlayOnCpt, showOverlayOnBorehole, cptVirtueleBoringOverride, boreholeVirtueleBoringOverride, handleChangeVirtueleBoringPicker, handleSetShowOverlay,
    handleSetOverlayOverride, showConfidenceFade, handleSetShowConfidenceFade,
    // toast/undo/boot
    toasts, toast, undoStack, ready, apiError,
    // mapState
    mapState,
    // coordinator
    selectedId, selectedBoreholeId, setSelectedId, setSelectedBoreholeId, view, setView,
    handleSelect, handleSelectBorehole, handleExportSectionDxf, handleExportSectionPlaxis2d, handleExportSectionPdf, outOfViewportCptIds, outOfViewportBoreholeIds,
    projectFilePath, manifestFormationIds, sessionImportCptIds, sessionImportBoreholeIds, sessionImportSectionIds, sessionImportFormationIds,
    marqueeSelectedIds, setMarqueeSelectedIds, hoveredTestId, setHoveredTestId,
    geoDeepLinkTarget, setGeoDeepLinkTarget,
    correlationEdgesRefetchNonce,
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // R5 (debt #12): gate GUARDS stay here (below all hooks — Rules of
  // Hooks); the screens are presentational components so App reads as
  // coordinator + a scannable render tree.
  if (apiError) return <AppBootError />
  if (!ready) return <AppLoading />

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
        {/* File → Settings is reachable from the welcome screen too.
            Project-scoped sections are disabled (no project to persist
            into); the Appearance section stays interactive because it
            persists per-device via useTheme. */}
        <SettingsDialog
          open={settingsOpen}
          hasProject={false}
          initialLithoSegmenter={initialLithoSegmenterPrefs}
          initialSectionDefaults={initialSectionDefaults}
          themeChoice={themeChoice}
          onCancel={() => setSettingsOpen(false)}
          onSubmitLithoSegmenter={handleSettingsLithoSegmenterSubmit}
          onSubmitSectionDefaults={handleSettingsSectionDefaultsSubmit}
          onSetThemeChoice={setThemeChoice}
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

      {/* App-level overlays (toasts + the 4 global dialogs) — R5
          (debt #12). Outside ShellContext.Provider so they sit above
          all shell chrome; App owns the state + handlers, AppDialogs
          is pure presentational. */}
      <AppDialogs
        toasts={toasts}
        newProjectOpen={newProjectOpen}
        setNewProjectOpen={setNewProjectOpen}
        newProject={newProject}
        project={project}
        savedProject={savedProject}
        metadataEditorOpen={metadataEditorOpen}
        setMetadataEditorOpen={setMetadataEditorOpen}
        applyMetadataDraft={applyMetadataDraft}
        unsavedDialogOpen={unsavedDialogOpen}
        unsavedSaving={unsavedSaving}
        handleUnsavedSave={handleUnsavedSave}
        handleUnsavedDiscard={handleUnsavedDiscard}
        handleUnsavedCancel={handleUnsavedCancel}
        closeConfirmOpen={closeConfirmOpen}
        setCloseConfirmOpen={setCloseConfirmOpen}
        closeProject={closeProject}
      />
      {/* App-level Settings dialog. Lives outside AppDialogs because
          it persists into ``project.view_state`` (per-project sections)
          and localStorage (Appearance) rather than through the metadata
          draft path. */}
      <SettingsDialog
        open={settingsOpen}
        hasProject={true}
        initialLithoSegmenter={initialLithoSegmenterPrefs}
        initialSectionDefaults={initialSectionDefaults}
        themeChoice={themeChoice}
        onCancel={() => setSettingsOpen(false)}
        onSubmitLithoSegmenter={handleSettingsLithoSegmenterSubmit}
        onSubmitSectionDefaults={handleSettingsSectionDefaultsSubmit}
        onSetThemeChoice={setThemeChoice}
      />
    </>
  )
}

