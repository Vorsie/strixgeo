import { useEffect, useMemo, useState, useCallback, useRef } from 'react'
import { Map as MapIcon, BarChart2, AlertTriangle, CheckCircle } from 'lucide-react'
import L from 'leaflet'
import { api, setBaseUrl, DuplicateCptError } from './api/client'
import type {
  BoreholeAxis,
  BoreholeDetailResponse,
  BoreholeListItem,
  CptListItem,
  CptPlotResponse,
  CptResponse,
} from './api/client'
import { useProject } from './hooks/useProject'
import { usePersistedSet } from './hooks/usePersistedSet'
import { useTheme } from './hooks/useTheme'
import { log } from './utils/log'
import { idsOutsideBounds } from './utils/viewportFilter'
import { addAllToSet } from './utils/sets'
import Toolbar from './components/Toolbar'
import Sidebar from './components/Sidebar'
import MapView from './components/MapView'
import CptChart from './components/CptChart'
import BoreholeLog from './components/BoreholeLog'
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
      addRecentProject: (filePath: string, name: string) => Promise<RecentProject[]>
      getRecentProjects: () => Promise<RecentProject[]>
      removeRecentProject: (filePath: string) => Promise<RecentProject[]>
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
    newProject,
    openProjectFile,
    pickAndOpenProject,
    applyMetadataDraft,
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
  //      hide. Persisted to localStorage. A row in this set is filtered
  //      OUT before the data ever reaches the Sidebar (visibleCpts /
  //      visibleBoreholes below).
  //   2. ``sessionImportCptIds`` / ``sessionImportBoreholeIds`` — rows
  //      added since the last File → Save. Persisted to localStorage.
  //      Drives the per-row amber asterisks. Cleared by saveProject.
  //   3. ``selectedForRemoval`` (in Sidebar) — multi-select for the
  //      bulk-remove action. Ephemeral (not persisted), reset on tab
  //      switch.
  //
  // Allowed overlap: a row CAN be in (1) and (2) simultaneously after
  // a discard-on-close — discardSessionImports moves session-import
  // ids INTO the removed set so the row stays in the DB but hides from
  // view. (3) and (1) are disjoint by construction since removed rows
  // never reach the Sidebar.
  //
  // Each persisted set is keyed by project id so closing and reopening
  // the app preserves the user's curated state per project.
  const [removedCptIds, setRemovedCptIds] = usePersistedSet(
    project ? `groundmodel.removed.${project.id}.cpt` : undefined,
  )
  const [removedBoreholeIds, setRemovedBoreholeIds] = usePersistedSet(
    project ? `groundmodel.removed.${project.id}.borehole` : undefined,
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

  // Combined "is anything unsaved?" flag. Drives the sidebar / window-
  // title asterisks, the close-attempt branching, and the File → Save
  // no-op-when-clean check. Declared AFTER the four persisted sets it
  // reads from — the inline reads below would TDZ-error if reordered.
  const projectDirty =
    metadataDirty ||
    sessionImportCptIds.size > 0 ||
    sessionImportBoreholeIds.size > 0

  // saveProject orchestration — commits metadata then clears session
  // imports. Failure of either step leaves the dirty flag intact so the
  // user can retry. Returns true on full success.
  const saveProject = useCallback(async (): Promise<boolean> => {
    const ok = await saveMetadata()
    if (!ok) return false
    setSessionImportCptIds(new Set())
    setSessionImportBoreholeIds(new Set())
    return true
  }, [saveMetadata, setSessionImportCptIds, setSessionImportBoreholeIds])

  // Discard rollback — moves session imports into the project-local
  // removed set so the rows stay in the DB (fast re-import via dedup
  // cache) but hide from view. Then clears session imports.
  const discardSessionImports = useCallback(() => {
    addAllToSet(setRemovedCptIds, sessionImportCptIds)
    addAllToSet(setRemovedBoreholeIds, sessionImportBoreholeIds)
    setSessionImportCptIds(new Set())
    setSessionImportBoreholeIds(new Set())
  }, [
    sessionImportCptIds,
    sessionImportBoreholeIds,
    setRemovedCptIds,
    setRemovedBoreholeIds,
    setSessionImportCptIds,
    setSessionImportBoreholeIds,
  ])

  // Apply the project-local filter before anything user-visible reads
  // the lists. Map markers, sidebar rows, layer-control counts all work
  // off the filtered view; the unfiltered cpts / boreholes lists never
  // leave App.
  const visibleCpts = useMemo(
    () => cpts.filter(c => !removedCptIds.has(c.id)),
    [cpts, removedCptIds],
  )
  const visibleBoreholes = useMemo(
    () => boreholes.filter(b => !removedBoreholeIds.has(b.id)),
    [boreholes, removedBoreholeIds],
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
      if (ids.length === 0) return
      setRemovedCptIds(prev => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
      // If the currently-selected CPT is being removed, clear the
      // selection so the chart panel doesn't keep displaying it.
      if (selectedId && ids.includes(selectedId)) {
        setSelectedId(null)
        setView('map')
      }
    },
    [selectedId],
  )

  const handleRemoveBoreholes = useCallback(
    (ids: string[]) => {
      if (ids.length === 0) return
      setRemovedBoreholeIds(prev => {
        const next = new Set(prev)
        for (const id of ids) next.add(id)
        return next
      })
      if (selectedBoreholeId && ids.includes(selectedBoreholeId)) {
        setSelectedBoreholeId(null)
        setView('map')
      }
    },
    [selectedBoreholeId],
  )

  const handleRestoreAllCpts = useCallback(() => setRemovedCptIds(new Set()), [])
  const handleRestoreAllBoreholes = useCallback(() => setRemovedBoreholeIds(new Set()), [])

  // Phase 3a — manual surface-elevation edit handlers. Both update three
  // pieces of state in one go: the list (so the sidebar badge clears),
  // the detail-cache entry (so the chart/borelog header reflects the new
  // value without a re-fetch), and any selection-derived view. The PATCH
  // endpoint returns the updated row, so we patch in place rather than
  // re-fetching.
  const handlePatchCptElevation = useCallback(
    async (id: string, elevationM: number | null, zEpsg: number | null): Promise<void> => {
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
    },
    [],
  )

  const handlePatchBoreholeElevation = useCallback(
    async (id: string, elevationM: number | null, zEpsg: number | null): Promise<void> => {
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
    },
    [],
  )

  // Re-importing or re-fetching a record is an explicit "make this visible
  // again" signal, so clear any of the supplied ids from the project-local
  // removed-set. Without this, a 409-duplicate import returns the existing
  // id, the sidebar's removed-filter hides it, and the user sees no change.
  const unhideCpts = useCallback(
    (ids: Iterable<string>) => {
      setRemovedCptIds(prev => {
        const next = new Set(prev)
        let changed = false
        for (const id of ids) {
          if (next.delete(id)) changed = true
        }
        return changed ? next : prev
      })
    },
    [setRemovedCptIds],
  )
  const unhideBoreholes = useCallback(
    (ids: Iterable<string>) => {
      setRemovedBoreholeIds(prev => {
        const next = new Set(prev)
        let changed = false
        for (const id of ids) {
          if (next.delete(id)) changed = true
        }
        return changed ? next : prev
      })
    },
    [setRemovedBoreholeIds],
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

  // Load CPTs + boreholes whenever the API is ready and a project is selected
  useEffect(() => {
    if (ready && project) {
      refreshList()
      refreshBoreholeList()
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
    void window.electron.setWindowTitle(`Ground Model — ${projectName}${dirtyMark}`)
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
    // Switching to a CPT clears any borehole selection so only one detail
    // panel is rendered at a time.
    setSelectedBoreholeId(null)
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
      // Mutually exclusive with CPT selection.
      setSelectedId(null)
      await loadBoreholeDetail(id)
      setView('chart')
    },
    [loadBoreholeDetail],
  )

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
  }, [project, refreshList, loadChart, unhideCpts, setSessionImportCptIds])

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
      setSessionImportCptIds,
      setSessionImportBoreholeIds,
    ],
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
        <div className="text-red-500 font-medium">Failed to start the Ground Model API</div>
        <div className="text-xs text-gray-400">Check the developer console for the Python traceback.</div>
      </div>
    )
  }

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-100 text-gray-500 text-sm gap-2">
        <div className="animate-spin rounded-full border-2 border-gray-300 border-t-blue-500 w-5 h-5" />
        Starting Ground Model API…
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
          projectFilePath={projectFilePath}
          projectDirty={projectDirty}
          sessionImportCptIds={sessionImportCptIds}
          sessionImportBoreholeIds={sessionImportBoreholeIds}
          onCloseProject={handleSidebarCloseRequest}
          onEditMetadata={() => setMetadataEditorOpen(true)}
          hiddenCptTypes={hiddenCptTypes}
          hiddenBoreholeValues={hiddenBoreholeValues[boreholeAxis]}
          boreholeAxis={boreholeAxis}
          outOfViewportCptIds={outOfViewportCptIds}
          outOfViewportBoreholeIds={outOfViewportBoreholeIds}
        />

        <main className="flex flex-col flex-1 overflow-hidden">
          {hasSelection && (
            <div className="flex items-center gap-1 px-3 py-1 border-b border-gray-200 bg-gray-50">
              <ViewTab icon={<MapIcon size={13} />} label="Map" active={view === 'map'} onClick={() => setView('map')} />
              <ViewTab icon={<BarChart2 size={13} />} label="Chart" active={view === 'chart'} onClick={() => setView('chart')} />
            </div>
          )}

          <div className="flex-1 overflow-hidden">
            {view === 'map' || !hasSelection ? (
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

