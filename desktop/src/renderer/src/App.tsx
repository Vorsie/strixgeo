import { useEffect, useMemo, useState, useCallback } from 'react'
import { useToasts } from './hooks/useToasts'
import { useAppBoot } from './hooks/useAppBoot'
import { useMapOverlays } from './hooks/useMapOverlays'
import { useGeologicalModel } from './hooks/useGeologicalModel'
import { useSections } from './hooks/useSections'
import type { SectionModelAxis } from './hooks/useSections'
import { useBedOverrides } from './hooks/useBedOverrides'
import { useInvestigationData } from './hooks/useInvestigationData'
import { useProjectBodyRecompute } from './hooks/useProjectBodyRecompute'
import { useProjectLifecycle } from './hooks/useProjectLifecycle'
import { useRecoveryAutosave } from './hooks/useRecoveryAutosave'
import { useRecoveryOffer } from './hooks/useRecoveryOffer'
import { useRecoveryRestore } from './hooks/useRecoveryRestore'
import { useMapState } from './hooks/useMapState'
import { useShellContextValue } from './hooks/useShellContextValue'
import { api } from './api/client'
import { useProject, isProjectOpenUnreadable } from './hooks/useProject'
import { useUndoStack } from './hooks/useUndoStack'
import { usePersistedSet } from './hooks/usePersistedSet'
import { useTheme } from './hooks/useTheme'
import { addAllToSet, removeAllFromSet } from './utils/sets'
import { isTypingTarget } from './utils/keyboard'
import { log } from './utils/log'
import { idsOutsideBounds } from './utils/viewportFilter'
import WelcomeScreen from './components/WelcomeScreen'
import RecoveryPromptDialog from './components/RecoveryPromptDialog'
import NewProjectDialog from './components/NewProjectDialog'
import AppBootError from './components/AppBootError'
import BackendFailedModal from './components/BackendFailedModal'
import BackendUnreachableBanner from './components/BackendUnreachableBanner'
import BackendRestartingBanner from './components/BackendRestartingBanner'
import CptRefreshConfirmDialog from './components/CptRefreshConfirmDialog'
import ConfirmDialog from './components/ui/ConfirmDialog'
import { usePromiseConfirm } from './hooks/usePromiseConfirm'
import { revertBeforeDiscardBackup as revertBeforeDiscardBackupDecision } from './utils/discardBackupRevert'
import { discardBackupRevertMessage } from './utils/closeFlowMessages'
import AppLoading from './components/AppLoading'
import AppDialogs from './components/AppDialogs'
import SettingsDialog from './components/SettingsDialog'
import CheatsheetDialog from './components/ui/CheatsheetDialog'
// Launch prototypes (debt #93 / #3 / #6) — see
// docs/design/onboarding-activation-updater-proto.md.
import OnboardingOverlay from './components/onboarding/OnboardingOverlay'
import TutorialOverlay from './tutorial/TutorialOverlay'
import { clearTutorialProgress } from './tutorial/tutorialProgress'
import LicensingDialog from './components/licensing/LicensingDialog'
import UpdateNotification from './components/updater/UpdateNotification'
import { hasSeenOnboarding, markOnboardingSeen, shouldAutoOpenOnboarding } from './utils/onboardingSeen'
import { activationGateDecision, type GateDecision } from './utils/activationGate'
import { t as tMsg } from './i18n/translate'
import type {
  ActivationActionResultDto,
  ActivationStatusDto,
  UpdaterEventDto,
} from './utils/launchPrototypeTypes'
import {
  buildGeotechSubdivisionPatch,
  readGeotechSubdivisionPrefs,
  type GeotechSubdivisionPrefs,
} from './utils/geotechSubdivisionPrefs'
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
import type { ParameterUnitScope, ParametersTabId, ShellContextValue } from './shell/ShellContext'
// Value import: the tutorial overlay reads the shell bus, so App wraps it in the
// provider at each mount site (the overlay sits outside AppShell's own provider).
import { ShellContext } from './shell/ShellContext'

type View = 'map' | 'chart'

export default function App() {
  // Toast notifications — extracted to useToasts so ``toast`` is
  // importable by the other hooks that receive it as a dep-injection param.
  // Declared BEFORE useProject so the open/restore flow can warn (once) when a
  // DB-lost restore had to cap oversized rows; useToasts holds no external
  // deps and is safe to call this early in the App body.
  const { toasts, toast, dismissToast } = useToasts()

  const {
    project,
    saved: savedProject,
    dirty: metadataDirty,
    filePath: projectFilePath,
    currentLumping,
    savedLumping,
    lumpingRevision,
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
    lastSaveWroteFile,
    recoveryClearAllowed,
    revertToLastSaved,
    resetStagedLumpingToSaved,
    saveAsProject,
    closeProject,
    stageLumping,
  } = useProject({ toast })

  // API boot sequence — extracted to useAppBoot.
  // The activation START-SCREEN gate state lives above the boot hook: the API
  // wait must not start while a packaged build is blocked at the licence page.
  const [activationGate, setActivationGate] = useState<GateDecision | 'unknown'>(() =>
    window.electron.launchFlags.packaged && !window.electron.launchFlags.e2e ? 'unknown' : 'pass',
  )
  const { ready, apiError } = useAppBoot(activationGate === 'pass')

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

  // Help → Gesture cheatsheet… (F1). Opens the renderer-side
  // CheatsheetDialog. Reachable from both the welcome screen and a loaded
  // project — the gesture reference has no project dependency.
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false)
  useEffect(() => {
    const off = window.electron.onMenuOpenCheatsheet(() => setCheatsheetOpen(true))
    return off
  }, [])

  // --- Launch prototypes (#93 / #3 / #6) ------------------------------------
  // Onboarding (#93): auto-opens once on first launch (gated on the persisted
  // "seen" flag) and is re-openable from Help → Getting started…. Reachable from
  // both the welcome screen and a loaded project.
  const [onboardingOpen, setOnboardingOpen] = useState(false)
  useEffect(() => {
    const off = window.electron.onMenuOpenOnboarding(() => setOnboardingOpen(true))
    return off
  }, [])
  // First-launch auto-open — read once on mount. Suppressed under the e2e flag
  // so the harness (whose userData dir persists and never seeds the "seen" flag)
  // does not raise the z-max onboarding modal over ~130 specs (senior BLOCKER).
  useEffect(() => {
    if (shouldAutoOpenOnboarding({ seen: hasSeenOnboarding(), e2e: window.electron.launchFlags.e2e })) {
      setOnboardingOpen(true)
    }
  }, [])
  // Dismissing onboarding (skip or finish) marks it seen so it never re-fires.
  const handleCloseOnboarding = useCallback(() => {
    markOnboardingSeen()
    setOnboardingOpen(false)
  }, [])
  // "Load sample project" intent (#93, owner ruling A8). The worked example
  // ships as an installer resource (main-process sample:* IPC). MECHANISM only:
  // the owner authors the .strix later, so until it is bundled sampleAvailable()
  // is false and the fallback (toast + start empty) stays. When it IS present we
  // install a user-owned COPY — the bundled resource is never opened in place,
  // because a Save from the app rewrites the .strix at its own path — then open
  // that copy exactly as onOpenRecent does.
  // Whether a worked example is bundled — decides if onboarding offers it at all.
  const [sampleAvailable, setSampleAvailable] = useState(false)
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const available = (await window.electron.sampleAvailable?.()) === true
        if (!cancelled) setSampleAvailable(available)
      } catch {
        if (!cancelled) setSampleAvailable(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  const handleLoadSample = useCallback(async () => {
    if (!(await window.electron.sampleAvailable())) {
      log.info('onboarding', 'load-sample requested — no bundled sample; starting empty')
      toast('warning', tMsg('onboarding.sampleUnavailable'))
      return
    }
    const path = await window.electron.sampleInstall()
    if (path === null) return // user cancelled the save dialog
    const result = await openProjectFile(path)
    const opened = result !== null && result !== 'file-missing' && !isProjectOpenUnreadable(result)
    if (opened) {
      toast('success', tMsg('onboarding.sampleLoaded', { path }))
    } else {
      // openProjectFile already logged the specific failure; don't claim success.
      log.error('onboarding', `load-sample: opening the installed copy at ${path} failed`)
    }
  }, [toast, openProjectFile])

  // Guided tutorial (#93, spec 2026-09-02). App owns the active flag; the
  // TutorialOverlay owns its own progress (localStorage). It is started from
  // onboarding ("Start the tutorial") or from Help → Tutorial (start / resume)
  // and Restart tutorial. It has NO auto-start, so the STRIX_E2E auto-start
  // suppression does not apply — the e2e flow starts it explicitly via Help.
  const [tutorialActive, setTutorialActive] = useState(false)
  useEffect(() => {
    const offStart = window.electron.onMenuTutorial(() => setTutorialActive(true))
    const offRestart = window.electron.onMenuRestartTutorial(() => {
      clearTutorialProgress()
      setTutorialActive(true)
    })
    return () => {
      offStart()
      offRestart()
    }
  }, [])

  // Licensing / activation (#3): Help → Licence & activation….
  const [licensingOpen, setLicensingOpen] = useState(false)
  useEffect(() => {
    const off = window.electron.onMenuOpenLicensing(() => setLicensingOpen(true))
    return off
  }, [])

  // Activation START-SCREEN gate (owner ruling A: "a startscreen with beta key
  // input before the actual app opens"). In a PACKAGED build only, a blocked
  // verdict (unactivated / expired / clock-rollback) stops at the licence screen
  // instead of the workspace. Dev and the e2e harness NEVER block — the gate
  // seeds to 'pass' for them and the status is never even fetched, so the owner's
  // dogfeed and the smoke suite are untouched. Once activation succeeds the
  // LicensingDialog reports the new status and the gate opens.
  useEffect(() => {
    const flags = window.electron.launchFlags
    if (!(flags.packaged && !flags.e2e)) return // dev / e2e never block
    let cancelled = false
    void (async () => {
      // A beta build is NOT exempt (owner 2026-09-03): the key comes before the
      // workspace; the beta-expiry gate in the main process ran before this window.
      try {
        const status = await window.electron.getActivationStatus()
        if (cancelled) return
        setActivationGate(
          activationGateDecision({
            packaged: flags.packaged,
            e2e: flags.e2e,
            statusReadFailed: false,
            blocked: status.verdict.blocked,
          }),
        )
      } catch (err) {
        // FAIL CLOSED: a packaged non-beta build whose status read fails is
        // treated as "no licence" — the licence screen, never an open workspace.
        log.warn('activation', 'status read failed; failing closed to the licence screen', err)
        if (!cancelled) {
          setActivationGate(
            activationGateDecision({
              packaged: flags.packaged,
              e2e: flags.e2e,
                statusReadFailed: true,
              blocked: false,
            }),
          )
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])
  // Re-evaluate when the start screen reports a new status; unlock once the
  // verdict is no longer blocked (a valid key, or the trial started). The screen
  // only shows for a packaged build that is still blocked.
  const handleActivationStatusChange = useCallback((status: ActivationStatusDto) => {
    const flags = window.electron.launchFlags
    if (
      activationGateDecision({
        packaged: flags.packaged,
        e2e: flags.e2e,
        statusReadFailed: false,
        blocked: status.verdict.blocked,
      }) === 'pass'
    ) {
      setActivationGate('pass')
    }
  }, [])

  // Updater (#6): Help → Check for updates… fires a manual check; results
  // surface through UpdateNotification's own event subscription.
  useEffect(() => {
    const off = window.electron.onMenuCheckUpdates(() => {
      void window.electron.checkForUpdates()
    })
    return off
  }, [])

  // Backend-failed signal (#214d). Shows BackendFailedModal when the main
  // process reports that the Python backend exited before it was ready.
  // The modal is non-dismissible — the app cannot function without the backend.
  const [backendFailed, setBackendFailed] = useState(false)
  const [logsPath, setLogsPath] = useState<string | null>(null)
  useEffect(() => {
    // Best-effort: fetch the logs path so the modal can display it.
    void window.electron.getLogsPath().then(setLogsPath).catch(() => {})
    const off = window.electron.onAppBackendFailed(() => setBackendFailed(true))
    return off
  // reason: empty dep array — subscribe once at mount; getLogsPath returns a
  // constant from the main process (app.getPath('logs')) so no dep needed.
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Data-stage Import dropdown open state — written by DataToolbar, read by the
  // guided tutorial via useTutorialState so the "Open the Import menu" step
  // moves on by itself (owner ruling 1, 2026-09-06). Lives in App (not
  // DataToolbar-local) because writer and reader are in different subtrees.
  const [importMenuOpen, setImportMenuOpen] = useState(false)

  // Draft CRS / datum from the OPEN project-settings dialog. Written by
  // ProjectMetadataDialog (through AppDialogs), read by the guided tutorial via
  // useTutorialState so the "Set the coordinate system" / "Set the vertical
  // datum" steps move on the moment a value is selected in the dialog, before
  // Save (owner ruling 1, 2026-09-06). Lives in App (not dialog-local) because
  // writer and reader sit in different subtrees, same as importMenuOpen.
  const [metadataDraftCrsDatum, setMetadataDraftCrsDatum] = useState<{
    horizontal: number | null
    vertical: number | null
  }>({ horizontal: null, vertical: null })

  // Geology deep-link target — set from the Sections (litho) canvas when
  // the user picks "Edit in Geology stage" on a geological contact.
  // AppShell watches this, switches to the geology stage, and selects the
  // section. GeologyInspector reads it to highlight the specific contact.
  // Cleared after the navigation applies (single-fire).
  const [geoDeepLinkTarget, setGeoDeepLinkTarget] = useState<{
    sectionId: string
    contactId: string
  } | null>(null)

  // Sections deep-link target — set by the Geology / Sections inspector
  // crossings banner when the user clicks an issue. AppShell switches to
  // the sections stage, selects the chosen section, and triggers the
  // focus-contacts pulse so the section view pans + amber-pulses the
  // offending columns. Cleared after dispatch (single-fire).
  // ``revealInvestigationIds`` rides the same payload for the two column-side
  // deep-links: same three steps (switch stage, select section, act after a
  // beat), columns instead of contacts. ONE id = the Build pre-flight's test to
  // subdivide; TWO = the gapless report's gap, named by the columns it stands
  // between (the panel centres on the midpoint of their span).
  const [sectionsDeepLinkTarget, setSectionsDeepLinkTarget] = useState<{
    sectionId: string
    contactIds: readonly string[]
    revealInvestigationIds?: readonly string[]
  } | null>(null)

  // Parameters deep-link target + the unit the Parameters stage is scoped to
  // (owner ballot 2026-08-26 — the layer → parameters jump; typed litho |
  // geotech scope per the 2026-08-27 R1 ruling). The target is set by a
  // band's or fill region's right-click menu in a cross-section; AppShell
  // switches stage, writes the selected unit, and clears the target
  // (single-fire). The SELECTION outlives the navigation: it is also what a
  // row click in the inspector's unit list writes, and what the Parameters
  // canvas reads to know which unit to summarise. The active tab rides the
  // bus too — the R3 layout flip puts the unit LIST in the inspector, which
  // only shows it while the canvas is on the per-unit tab.
  const [parametersDeepLinkTarget, setParametersDeepLinkTarget] =
    useState<ParameterUnitScope | null>(null)
  const [selectedParameterUnit, setSelectedParameterUnit] =
    useState<ParameterUnitScope | null>(null)
  const [parametersActiveTab, setParametersActiveTab] =
    useState<ParametersTabId>('per-test')

  // Export-stage deep-link target (installer #35 — the Export hub is the only
  // export surface). Set by the Sections toolbar's single "Export…" verb and the
  // 3-D stages' "Export…" verbs; AppShell switches to the Export stage and (when
  // a section is named) selects it + sets the axis so the hub opens already
  // scoped to what the engineer was looking at, then clears the target
  // (single-fire). Same cross-boundary bus rationale as the other deep-links.
  const [exportDeepLinkTarget, setExportDeepLinkTarget] = useState<{
    sectionId: string | null
    axis: SectionModelAxis
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

  // Body-identity recompute nonces (slice 5). Mutation sites spread across
  // hooks / toolbars bump the AXIS whose model they changed (litho tie edits →
  // litho; geotech verbs + subdivide → geotech); ``useProjectBodyRecompute``
  // (below) watches the nonces STAGE-INDEPENDENTLY and schedules the debounced
  // ``bodies/recompute`` POST for that model — it also owns the once-per-
  // project-open initial recompute (owner ruling 2026-08-12). Same
  // soft-coupling bus as ``correlationEdgesRefetchNonce``.
  const [bodyRecomputeLithoNonce, setBodyRecomputeLithoNonce] = useState(0)
  const [bodyRecomputeGeotechNonce, setBodyRecomputeGeotechNonce] = useState(0)
  const requestBodyRecompute = useCallback((kind: 'litho' | 'geotech') => {
    if (kind === 'litho') setBodyRecomputeLithoNonce(n => n + 1)
    else setBodyRecomputeGeotechNonce(n => n + 1)
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
  // Bumped after every bed-override change so the built models' staleness (the
  // voxel solids + TIN surfaces the bed cuts) is re-read without a project
  // reopen (owner 2026-09-13). Declared upstream of useGeologicalModel so the
  // model hook can key its solid / surface re-reads on it; the stable bumper is
  // handed to useBedOverrides below (which sits after the horizontal CRS resolves).
  const [bedStaleNonce, setBedStaleNonce] = useState(0)
  const bumpBedStale = useCallback(() => setBedStaleNonce((n) => n + 1), [])

  const geo = useGeologicalModel({
    project,
    toast,
    bedStaleNonce,
    pushUndo,
    clearUndo,
    addToManifest,
    removeFromManifest,
    addToSessionImports,
    removeFromSessionImports,
    manifestFormationIds,
    currentLumping,
    stageLumping,
    requestCorrelationEdgesRefetch,
    requestBodyRecompute,
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

  // The RESTORE half of crash recovery, declared BEFORE the autosave
  // scheduler because the scheduler is suspended while an offer is pending
  // and therefore has to read ``recoveryOffer``. (Reading a ``const`` above
  // its declaration is a runtime ReferenceError that neither tsc nor Vitest
  // catches — see the TDZ note in the project memory.)
  //
  // ``useRecoveryRestore`` owns WHAT is written back (the six at-risk items,
  // plus the lumping map's revision reconciliation); ``useRecoveryOffer``
  // owns the single detection point — one effect keyed on the open project's
  // id, rather than a check bolted onto each of the four open paths.
  const { restoreFromSnapshot } = useRecoveryRestore({
    setGhostsByAnchor: geo.setGhostsByAnchor,
    applyMetadataDraft,
    addToManifest,
    setSessionImportCptIds,
    setSessionImportBoreholeIds,
    setSessionImportFormationIds,
    setSessionImportSectionIds,
    setSessionImportContactIds,
    setHasUnsavedMutations,
    currentLumping,
    lumpingRevision,
    stageLumping,
  })

  // Delete backup = the crashed session NEVER HAPPENED (owner ruling
  // 2026-08-03, from dogfeeding a destructive crash-session Apply): before
  // the backup dies, the DATABASE reverts to the last save through the same
  // anchored replace-restore the close dialog's Discard uses. Returning
  // false keeps the backup — after an aborted revert it is the only
  // remaining record of the session the user asked to erase.
  //
  // When the file on disk is not this project's latest save the revert is
  // refused; that refusal is ASKED, not toasted (owner 2026-09-10: the toast
  // was a dead end — "users gaan hierop vloeken"). Same question the close
  // flow asks since installer #26: revert anyway (named, Cancel focused) or
  // keep the backup.
  const discardBackupForceRevert = usePromiseConfirm()
  const revertBeforeDiscardBackup = useCallback(
    (): Promise<boolean> =>
      revertBeforeDiscardBackupDecision({
        revert: revertToLastSaved,
        askForceRevert: discardBackupForceRevert.ask,
        toast,
        message: tMsg,
      }),
    [revertToLastSaved, discardBackupForceRevert.ask, toast],
  )

  // After a successful discard, reload the project from its file so the
  // reverted database state is what the user is looking at — the in-memory
  // session still holds the crashed session's leftovers otherwise.
  const reloadAfterDiscardBackup = useCallback(async (): Promise<void> => {
    if (projectFilePath !== null) await openProjectFile(projectFilePath)
  }, [projectFilePath, openProjectFile])

  const {
    offer: recoveryOffer,
    restoreOffer,
    dismissOffer: dismissRecoveryOffer,
    discardOffer: discardRecoveryOffer,
    discarding: discardingRecovery,
  } = useRecoveryOffer({
    projectId: project?.id ?? null,
    projectName: project?.name ?? null,
    onRestore: restoreFromSnapshot,
    onBeforeDiscard: revertBeforeDiscardBackup,
    // Delete backup means "no traces" (owner ruling 2026-08-03): the lumping
    // map's staged DB slot — the one backup item with a second home — is put
    // back onto the saved snapshot when the backup dies.
    onDiscardResidue: resetStagedLumpingToSaved,
    onAfterDiscard: reloadAfterDiscardBackup,
  })

  // Crash-recovery autosave (docs/design/autosave-recovery.md). A crash
  // loses no interpretation — every gesture is an awaited API call — but it
  // does lose the session delta: the lumping map, the litho ghost
  // workspace, the metadata draft, the manifest + session-import sets, and
  // the unsaved-mutations bit. This hook shadow-copies exactly those six on
  // a 2 s debounce with a 15 s cap, and deletes the file the moment the
  // session goes clean.
  //
  // ``ghostsByAnchor`` (the whole store) rather than ``bulkGhostsByAnchor``
  // (the store MINUS the focused anchor): the focused anchor's triage is
  // the most at-risk of all, since it is the one the user is working on.
  const { clearRecoveryNow } = useRecoveryAutosave({
    filePath: projectFilePath,
    project,
    saved: savedProject,
    currentLumping,
    savedLumping,
    lumpingRevision,
    ghostsByAnchor: geo.ghostsByAnchor,
    manifestCptIds,
    manifestBoreholeIds,
    manifestFormationIds,
    manifestSectionIds,
    sessionImportCptIds,
    sessionImportBoreholeIds,
    sessionImportFormationIds,
    sessionImportSectionIds,
    sessionImportContactIds,
    hasUnsavedMutations,
    // The save path clears the session sets and the mutations flag even when
    // the .strix write failed, so the values below can go clean while the
    // delta is still homeless. Gate the scheduler's clean-transition delete
    // on the same file-write signal the lifecycle's explicit clear uses
    // (docs/design/autosave-recovery.md §4).
    canClearOnClean: recoveryClearAllowed,
    // Hold every write and every clear while the recovery prompt is up. In
    // that window the files on disk hold the CRASHED session's work, and the
    // user's answer is about to move them between slots: a debounced write
    // landing mid-answer would replace the crashed copy with this session's
    // thinner delta, and a quit taken mid-question would delete a copy the
    // user never answered for.
    suspended: recoveryOffer !== null,
  })

  // Closing a project is a DECIDED exit, so it takes the recovery file with
  // it — a file left behind would make the next launch claim this session
  // crashed. Wrapping ``closeProject`` here (rather than clearing at each
  // call site) means every close path — the File menu, the toolbar X's
  // confirm dialog, and both branches of the unsaved-changes prompt — is
  // covered by construction.
  const closeProjectAndClearRecovery = useCallback(() => {
    void clearRecoveryNow()
    closeProject()
  }, [clearRecoveryNow, closeProject])

  // Project lifecycle — dirty flag, File menu IPC, close-flow dialogs,
  // Save / Discard / window title / OS quit handshake. Wired here (after
  // useGeologicalModel) because discardSessionImports calls discardContacts
  // + activeGeologicalModel.
  const {
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
    forceRevertMessage,
    handleForceRevertConfirm,
    handleForceRevertSave,
    handleForceRevertCancel,
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
    closeProject: closeProjectAndClearRecovery,
    pickAndOpenProject,
    openProjectFile,
    discardContacts,
    activeGeologicalModel,
    stageLumping,
    currentLumping,
    hasUnsavedMutations,
    setHasUnsavedMutations,
    revertToLastSaved,
    // No file path = never saved, so Discard has no snapshot to revert to.
    hasSavedSnapshot: projectFilePath !== null,
    clearRecoveryNow,
    lastSaveWroteFile,
    projectFilePath,
    toast,
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
    refreshConfirm,
    confirmRefreshImport,
    cancelRefreshImport,
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
    markMutated,
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
    suggestedTies,
    handleSuggestTies,
    handleAcceptTie,
    handleAcceptAllTies,
    handleRejectTie,
    handleClearTieSuggestions,
  } = useSections({
    project,
    ready,
    toast,
    pushUndo,
    requestBodyRecompute,
    manifestSectionIds,
    addToManifest,
    removeFromManifest,
    setSessionImportSectionIds,
    contacts,
    // Slice 2 (#55): dep-inject the litho contact list so handleFocusContacts
    // can resolve contacts on the litho axis without coupling useSections to the
    // geo model hook directly.
    lithoContacts,
    // Installer #36 fix: gate the section model axis on model presence so the
    // litho axis cannot be entered without a litho model (and a stale litho/
    // geotech axis is clamped back to geological). Booleans, not the model
    // objects, so the section state doesn't churn on every model re-identify.
    hasLithoModel: geo.activeLithoModel !== null,
    hasGeotechModel: geo.activeGeotechModel !== null,
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
  //
  // ``handleSelectWithoutView`` is the same gesture MINUS the Data-stage view
  // switch. Stages other than Data select a CPT to draw it in their own
  // surface (Parameters plots it in the inspector), and firing setView there
  // silently rewrites where Data lands next time the engineer returns to it.
  const handleSelectWithoutView = useCallback(
    async (id: string): Promise<void> => {
      setSelectedId(id)
      setSelectedBoreholeId(null)
      await loadCptDetail(id)
      await loadChart(id)
    },
    [setSelectedId, setSelectedBoreholeId, loadCptDetail, loadChart],
  )

  const handleSelect = useCallback(
    async (id: string): Promise<void> => {
      await handleSelectWithoutView(id)
      setView('chart')
    },
    [handleSelectWithoutView, setView],
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
      onSaved?: (path: string) => void,
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
        onSaved?.(dialogPath)
        toast('success', tMsg('app.dxfExported'))
      } catch (err) {
        log.error('section', 'exportDxf failed', err)
        toast(
          'error',
          err instanceof Error ? err.message : tMsg('app.dxfExportFailed'),
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
      onSaved?: (path: string) => void,
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
        onSaved?.(dialogPath)
        toast('success', tMsg('app.plaxis2dExported'))
      } catch (err) {
        log.error('section', 'exportPlaxis2d failed', err)
        toast(
          'error',
          err instanceof Error
            ? err.message
            : tMsg('app.plaxis2dExportFailed'),
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

  // Shell-level body-identity recompute wiring (slice 5, owner ruling
  // 2026-08-12): the initial recompute fires on PROJECT OPEN (once per model
  // per open, event-driven — a closed data gate at open fires later when it
  // opens), and mutation-site nonce bumps schedule regardless of which stage
  // is on screen. Lives HERE because the shell owns every assembly input
  // (investigations + layers + sections); the Sections stage no longer needs
  // to be mounted for identity to persist.
  useProjectBodyRecompute({
    projectId: project?.id ?? null,
    visibleSections,
    visibleCpts,
    visibleBoreholes,
    lithoModelId: geo.activeLithoModel?.id ?? null,
    lithoLayers: geo.lithoLayers,
    geotechModelId: geo.activeGeotechModel?.id ?? null,
    geotechLayers: geo.geotechLayers,
    geotechLayersLoaded: geo.geotechLayersLoaded,
    geotechFormations: geo.geotechFormations,
    bodyRecomputeLithoNonce,
    bodyRecomputeGeotechNonce,
    toast,
  })

  // R4 (debt #12): the manifest-filtered formation list moved INTO
  // useGeologicalModel (it now takes manifestFormationIds). App no
  // longer post-processes the geo slice — see geoModel: geo below.

  // Out-of-viewport sets — empty when the map hasn't reported bounds
  // yet. The Lambert72→WGS84 projection inside ``idsOutsideBounds``
  // is memoised so the per-record cost is just a dictionary lookup
  // after the first render.
  const outOfViewportCptIds = useMemo(
    () => idsOutsideBounds(visibleCpts, viewportBounds, effectiveHorizontalEpsg),
    [visibleCpts, viewportBounds, effectiveHorizontalEpsg],
  )

  const outOfViewportBoreholeIds = useMemo(
    () => idsOutsideBounds(visibleBoreholes, viewportBounds, effectiveHorizontalEpsg),
    [visibleBoreholes, viewportBounds, effectiveHorizontalEpsg],
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

  // Manual bed-level overrides (owner ruling 2026-09-06) — the "Bed level"
  // draw tool + list. Declared above the early-return ladder so the hook count
  // stays stable. Uses the section CRS resolver (project's horizontal EPSG).
  const bedOverrides = useBedOverrides({
    project,
    epsg: effectiveHorizontalEpsg,
    toast,
    onBedChanged: bumpBedStale,
  })

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
  const initialGeotechSubdivisionPrefs = useMemo(
    () => readGeotechSubdivisionPrefs(project?.view_state ?? null),
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
  const handleSettingsGeotechSubdivisionSubmit = useCallback(
    (next: GeotechSubdivisionPrefs) => {
      void applyViewStatePatch(buildGeotechSubdivisionPatch(next))
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
    suggestedTies, handleSuggestTies, handleAcceptTie, handleAcceptAllTies, handleRejectTie, handleClearTieSuggestions,
    // bed overrides (owner ruling 2026-09-06)
    bedOverrides,
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
    handleSelect, handleSelectBorehole, handleExportSectionDxf, handleExportSectionPlaxis2d, outOfViewportCptIds, outOfViewportBoreholeIds,
    projectFilePath, manifestFormationIds, sessionImportCptIds, sessionImportBoreholeIds, sessionImportSectionIds, sessionImportFormationIds,
    marqueeSelectedIds, setMarqueeSelectedIds, hoveredTestId, setHoveredTestId,
    geoDeepLinkTarget, setGeoDeepLinkTarget,
    sectionsDeepLinkTarget, setSectionsDeepLinkTarget,
    parametersDeepLinkTarget, setParametersDeepLinkTarget,
    exportDeepLinkTarget, setExportDeepLinkTarget,
    selectedParameterUnit, setSelectedParameterUnit,
    parametersActiveTab, setParametersActiveTab,
    correlationEdgesRefetchNonce, bodyRecomputeLithoNonce, bodyRecomputeGeotechNonce,
    requestBodyRecompute, handleSelectWithoutView, markMutated,
    importMenuOpen, setImportMenuOpen,
    metadataDraftHorizontalEpsg: metadataDraftCrsDatum.horizontal,
    metadataDraftVerticalEpsg: metadataDraftCrsDatum.vertical,
  })

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  // R5 (debt #12): gate GUARDS stay here (below all hooks — Rules of
  // Hooks); the screens are presentational components so App reads as
  // coordinator + a scannable render tree.
  // Backend-failed modal (#214d) — rendered in every branch because it is
  // a portal to document.body and must survive the early-return gates.
  const backendFailedModal = (
    <BackendFailedModal open={backendFailed} logsPath={logsPath} />
  )

  // Mid-session backend death (#FINDINGS-A 4). Rendered in EVERY branch for the
  // same reason as the modal above: the backend can go away at any moment, and
  // the branch the shell happens to be in when it does must not decide whether
  // the engineer is told. Renders null unless the condition holds.
  const backendUnreachableBanner = <BackendUnreachableBanner />

  // Mid-session backend RESTART (H3(a)) — the hopeful counterpart to the
  // unreachable banner. Rendered wherever that one is, for the same reason: the
  // backend can die at any moment and the branch in view must not decide whether
  // the engineer sees the reconnect. Renders null unless a respawn is in flight.
  const backendRestartingBanner = <BackendRestartingBanner />

  // Activation start-screen gate (owner ruling A) — a packaged build with a
  // blocked verdict shows the licence screen INSTEAD of the workspace. It comes
  // BEFORE the boot returns: while blocked the engine is deferred, so the
  // 'Starting StrixGeo API…' splash would wait forever (installer #8). Never
  // reached in dev / e2e (the gate stays 'pass'). Reuses LicensingDialog as a
  // full-window, non-dismissable start screen; entering a valid key or starting
  // the trial reports through onStatusChange and opens the gate.
  if (activationGate === 'block') {
    return (
      <>
        {backendFailedModal}
        <LicensingDialog
          open
          dismissable={false}
          onClose={() => {}}
          onStatusChange={handleActivationStatusChange}
        />
      </>
    )
  }

  if (apiError) return <>{backendFailedModal}{backendUnreachableBanner}{backendRestartingBanner}<AppBootError /></>
  if (!ready) return <>{backendFailedModal}{backendUnreachableBanner}{backendRestartingBanner}<AppLoading /></>


  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={async name => {
            await newProject({ name })
          }}
          onOpenProject={async () => {
            const result = await pickAndOpenProject()
            // Forward the specific decode message (present only when an
            // unreadable file failed) so the banner can name corruption plainly.
            return result.outcome === 'failed'
              ? { outcome: 'failed', message: result.message }
              : { outcome: result.outcome }
          }}
          onOpenRecent={async path => {
            const result = await openProjectFile(path)
            if (result === 'file-missing') return { outcome: 'missing' }
            if (isProjectOpenUnreadable(result)) {
              return { outcome: 'failed', message: result.reason.message }
            }
            return { outcome: result !== null ? 'opened' : 'failed' }
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
          initialGeotechSubdivision={initialGeotechSubdivisionPrefs}
          initialSectionDefaults={initialSectionDefaults}
          themeChoice={themeChoice}
          onCancel={() => setSettingsOpen(false)}
          onSubmitLithoSegmenter={handleSettingsLithoSegmenterSubmit}
          onSubmitGeotechSubdivision={handleSettingsGeotechSubdivisionSubmit}
          onSubmitSectionDefaults={handleSettingsSectionDefaultsSubmit}
          onSetThemeChoice={setThemeChoice}
        />
        {/* Help → Gesture cheatsheet — also reachable from the welcome screen. */}
        <CheatsheetDialog open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
        {/* Launch prototypes (#93 / #3 / #6) — reachable before a project exists. */}
        <OnboardingOverlay
          open={onboardingOpen}
          onClose={handleCloseOnboarding}
          onLoadSample={handleLoadSample}
        sampleAvailable={sampleAvailable}
          onStartTutorial={() => setTutorialActive(true)}
        />
        {/* Guided tutorial (#93). Wrapped in the shell provider so useShell()
            resolves; renders nothing while inactive. */}
        <ShellContext.Provider value={shellContextValue}>
          <TutorialOverlay active={tutorialActive} onExit={() => setTutorialActive(false)} />
        </ShellContext.Provider>
        <LicensingDialog open={licensingOpen} onClose={() => setLicensingOpen(false)} />
        <UpdateNotification />
        {/* Backend-failed modal — portal to body, safe in every branch. */}
        {backendFailedModal}
        {backendUnreachableBanner}{backendRestartingBanner}
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

      {/* Sits above the shell chrome so it is legible over any stage. */}
      {backendUnreachableBanner}{backendRestartingBanner}

      {/* Refresh-on-reimport consent. Only reachable with a project open (the
          import menu item is), so it lives in this branch alone. */}
      <CptRefreshConfirmDialog
        open={refreshConfirm !== null}
        fileName={refreshConfirm?.fileName ?? ''}
        diff={refreshConfirm?.diff ?? null}
        onConfirm={confirmRefreshImport}
        onCancel={cancelRefreshImport}
      />

      {/* App-level overlays (toasts + the 4 global dialogs) — R5
          (debt #12). Outside ShellContext.Provider so they sit above
          all shell chrome; App owns the state + handlers, AppDialogs
          is pure presentational. */}
      <AppDialogs
        toasts={toasts}
        dismissToast={dismissToast}
        newProjectOpen={newProjectOpen}
        setNewProjectOpen={setNewProjectOpen}
        newProject={newProject}
        project={project}
        savedProject={savedProject}
        metadataEditorOpen={metadataEditorOpen}
        setMetadataEditorOpen={setMetadataEditorOpen}
        applyMetadataDraft={applyMetadataDraft}
        onMetadataDraftCrsDatumChange={setMetadataDraftCrsDatum}
        unsavedDialogOpen={unsavedDialogOpen}
        unsavedSummary={unsavedSummary}
        unsavedSaving={unsavedSaving}
        unsavedError={unsavedError}
        handleUnsavedSave={handleUnsavedSave}
        handleUnsavedDiscard={handleUnsavedDiscard}
        handleUnsavedCancel={handleUnsavedCancel}
        forceRevertPromptOpen={forceRevertPromptOpen}
        forceRevertMessage={forceRevertMessage}
        handleForceRevertConfirm={handleForceRevertConfirm}
        handleForceRevertSave={handleForceRevertSave}
        handleForceRevertCancel={handleForceRevertCancel}
        closeConfirmOpen={closeConfirmOpen}
        setCloseConfirmOpen={setCloseConfirmOpen}
        closeProject={closeProjectAndClearRecovery}
      />
      {/* Crash-recovery prompt — shown over the OPENED project, because the
          lumping map's reconciliation needs the project's live revision to
          compare against (docs/design/autosave-recovery.md §3). Rendered
          outside AppDialogs: it is offered by the recovery hooks, not by the
          save model, and it must survive any future re-grouping of the four
          save-flow dialogs. */}
      {recoveryOffer !== null && (
        <RecoveryPromptDialog
          open
          projectName={recoveryOffer.projectName}
          snapshot={recoveryOffer.snapshot}
          writtenAt={recoveryOffer.writtenAt}
          onRestore={() => void restoreOffer()}
          onOpenWithoutRestoring={() => void dismissRecoveryOffer()}
          onDiscard={() => void discardRecoveryOffer()}
          busy={discardingRecovery}
        />
      )}
      {/* "Delete backup" met a file that is not the latest save: ask instead of
          refusing (owner 2026-09-10). Cancel is default-focused; the danger
          button names the loss. */}
      <ConfirmDialog
        open={discardBackupForceRevert.open}
        labelledBy="discard-backup-force-revert-title"
        title={tMsg('project.discardBackupForceRevertTitle')}
        titleTestid="discard-backup-force-revert-title"
        body={discardBackupRevertMessage(projectFilePath)}
        onCancel={() => discardBackupForceRevert.answer(false)}
        cancelTestid="discard-backup-force-revert-cancel"
        confirm={{
          label: tMsg('project.discardBackupForceRevertConfirm'),
          onClick: () => discardBackupForceRevert.answer(true),
          variant: 'danger',
          testid: 'discard-backup-force-revert-confirm',
        }}
        testid="discard-backup-force-revert-dialog"
      />
      {/* App-level Settings dialog. Lives outside AppDialogs because
          it persists into ``project.view_state`` (per-project sections)
          and localStorage (Appearance) rather than through the metadata
          draft path. */}
      <SettingsDialog
        open={settingsOpen}
        hasProject={true}
        initialLithoSegmenter={initialLithoSegmenterPrefs}
        initialGeotechSubdivision={initialGeotechSubdivisionPrefs}
        initialSectionDefaults={initialSectionDefaults}
        themeChoice={themeChoice}
        onCancel={() => setSettingsOpen(false)}
        onSubmitLithoSegmenter={handleSettingsLithoSegmenterSubmit}
        onSubmitGeotechSubdivision={handleSettingsGeotechSubdivisionSubmit}
        onSubmitSectionDefaults={handleSettingsSectionDefaultsSubmit}
        onSetThemeChoice={setThemeChoice}
      />
      {/* Help → Gesture cheatsheet (F1). App-level overlay above the shell. */}
      <CheatsheetDialog open={cheatsheetOpen} onClose={() => setCheatsheetOpen(false)} />
      {/* Launch prototypes (#93 / #3 / #6) — also reachable with a project open. */}
      <OnboardingOverlay
        open={onboardingOpen}
        onClose={handleCloseOnboarding}
        onLoadSample={handleLoadSample}
        sampleAvailable={sampleAvailable}
        onStartTutorial={() => setTutorialActive(true)}
      />
      {/* Guided tutorial (#93). Wrapped in the shell provider so useShell()
          resolves; renders nothing while inactive. */}
      <ShellContext.Provider value={shellContextValue}>
        <TutorialOverlay active={tutorialActive} onExit={() => setTutorialActive(false)} />
      </ShellContext.Provider>
      <LicensingDialog open={licensingOpen} onClose={() => setLicensingOpen(false)} />
      <UpdateNotification />
      {/* Backend-failed modal — portal to body, safe in every branch. */}
      {backendFailedModal}
    </>
  )
}

