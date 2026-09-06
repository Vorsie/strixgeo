// Mount-time smoke test for App.tsx (debt #47).
//
// App.tsx is ~3,200 lines of state + effects + callbacks. The
// per-component vitest suite caught zero of the TDZ runtime crashes
// that hit mid-dogfooding (2026-05-13 contact-selection toolbox;
// 2026-05-14 saveProject auto-build). This test mounts <App /> with
// stubs for window.electron, the api wrappers, and the persistence
// layer; the only assertion is that mount completes without throwing
// (the WelcomeScreen text appears once the boot effect resolves).
//
// CLAUDE.md rule that motivated this test:
//
// > Add a top-level smoke test (``render(<App />)``) when the
// > component crosses the threshold where mental tracking gets
// > unreliable.
//
// Today the project is null on mount → App renders <WelcomeScreen>;
// MapView / SectionPanel / CptChart are NOT mounted, so leaflet + the
// data-loading effects stay dormant. Extending the test to cover a
// loaded-project mount path is future work (debt #47 escalation).

import { render, cleanup, waitFor, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'
import type { UseProject } from './hooks/useProject'

// ---------------------------------------------------------------------------
// useProject is the project-source gate: project===null → WelcomeScreen,
// project!==null → AppShell. R1 (debt #12): the original smoke test only
// ever reached the WelcomeScreen branch, so a TDZ in AppShell / any stage
// component / the shellContextValue consumption was invisible. We mock
// useProject behind a per-test toggle so one test keeps the null →
// WelcomeScreen contract and a second test drives the loaded-project →
// AppShell subtree. The stub mirrors the real initial shape; useProject's
// own internals are a separate hook's concern (this smoke test exists for
// App.tsx-body + render-subtree TDZ, per the file header).
// ---------------------------------------------------------------------------

const LOADED_PROJECT = {
  id: 'proj-smoke-1',
  name: 'Smoke Project',
  project_number: null,
  client: null,
  site_label: null,
  description: null,
  tags: [],
  default_horizontal_epsg: 31370,
  default_vertical_epsg: 5710,
  phase: 'design',
  status: 'active',
  view_state: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  archived_at: null,
}

let mockProjectLoaded = false

function makeUseProjectStub(): UseProject {
  const project = mockProjectLoaded
    ? (LOADED_PROJECT as unknown as UseProject['project'])
    : null
  const emptySet: ReadonlySet<string> = new Set()
  return {
    project,
    saved: project,
    dirty: false,
    filePath: null,
    manifestCptIds: emptySet,
    manifestBoreholeIds: emptySet,
    manifestFormationIds: emptySet,
    manifestSectionIds: emptySet,
    newProject: vi.fn().mockResolvedValue(null),
    openProjectFile: vi.fn().mockResolvedValue(null),
    pickAndOpenProject: vi.fn().mockResolvedValue({ outcome: 'cancelled' }),
    addToManifest: vi.fn(),
    removeFromManifest: vi.fn(),
    applyMetadataDraft: vi.fn(),
    applyViewStatePatch: vi.fn().mockResolvedValue(true),
    saveProject: vi.fn().mockResolvedValue(true),
    // Crash recovery asks whether the last save reached the .gmproj file
    // (docs/design/autosave-recovery.md §4) — the smoke test never saves.
    lastSaveWroteFile: vi.fn().mockReturnValue(false),
    // ...and whether a clean transition may delete the recovery file. A
    // session that never saved has no failed write to distrust, so the
    // answer is yes — the two flags differ for exactly that reason.
    recoveryClearAllowed: vi.fn().mockReturnValue(true),
    // Discriminated outcome, not a boolean: this stub is the never-saved
    // project, whose Discard deletes the session creates. A refusal or a
    // failure is a different arm entirely (see useProjectLifecycle.test.ts).
    revertToLastSaved: vi.fn().mockResolvedValue('no-snapshot'),
    resetStagedLumpingToSaved: vi.fn().mockResolvedValue(undefined),
    saveAsProject: vi.fn().mockResolvedValue(null),
    discardEdits: vi.fn(),
    archiveCurrent: vi.fn().mockResolvedValue(undefined),
    closeProject: vi.fn(),
    stageLumping: vi.fn(),
    currentLumping: null,
    savedLumping: null,
    lumpingRevision: null,
  }
}

vi.mock('./hooks/useProject', () => ({
  useProject: () => makeUseProjectStub(),
}))

// MapView pulls in Leaflet, which does not render in jsdom. The
// loaded-project path mounts DataCanvas → MapView; stub it so the
// smoke test exercises the shell + DataInspector/DataToolbar without
// a Leaflet crash (the architect's R1 note: full MapView render is
// not needed to catch TDZ in the loaded-project subtree).
vi.mock('./components/MapView', () => ({ default: () => null }))

// ---------------------------------------------------------------------------
// Module-level mock of ../api/client.
//
// Replaces the ``api`` export with a deep object of ``vi.fn()`` stubs
// so any code path that fires an API call resolves with a benign value
// instead of touching the network. ``importActual`` preserves the
// non-api exports (error classes, ``setBaseUrl``, types) so App's
// other imports still resolve.
// ---------------------------------------------------------------------------
vi.mock('./api/client', async () => {
  const actual = await vi.importActual<typeof import('./api/client')>('./api/client')
  // Generic resolver-stub: returns ``undefined`` (acceptable for
  // every endpoint whose return is unused at mount).
  const stub = (): ReturnType<typeof vi.fn> => vi.fn().mockResolvedValue(undefined)
  const stubArr = (): ReturnType<typeof vi.fn> => vi.fn().mockResolvedValue([])
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      cpt: {
        list: stubArr(),
        get: stub(),
        plot: stub(),
        plotBatch: stubArr(),
        delete: stub(),
        patchElevation: stub(),
        import: stub(),
      },
      borehole: {
        list: stubArr(),
        get: stub(),
        patchElevation: stub(),
      },
      project: {
        get: stub(),
        create: stub(),
        update: stub(),
        archive: stub(),
        duplicate: stub(),
        bundle: stub(),
        restore: stub(),
        patchViewState: stub(),
      },
      dem: {
        sampleLine: stub(),
      },
      geology: {
        listFormations: stubArr(),
        createFormation: stub(),
        updateFormation: stub(),
        deleteFormation: stub(),
        listModels: stubArr(),
        createModel: stub(),
        updateModel: stub(),
        activateModel: stub(),
        deleteModel: stub(),
        listContacts: stubArr(),
        createContact: stub(),
        updateContact: stub(),
        deleteContact: stub(),
        updateContactsBatch: stub(),
        autoPopulateFromStratigraphy: stub(),
        listSurfaces: stubArr(),
        dedupeContacts: stub(),
        rebuildSurfaces: stub(),
        exportPlaxis3d: stub(),
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
      },
      review: {
        list: stubArr(),
        upsert: stub(),
        delete: stub(),
      },
      section: {
        list: stubArr(),
        get: stub(),
        create: stub(),
        update: stub(),
        delete: stub(),
        exportDxf: stub(),
      },
      bedOverrides: {
        list: stubArr(),
        create: stub(),
        update: stub(),
        delete: stub(),
      },
      codelists: {
        g3dv3: vi.fn().mockResolvedValue({ formations: [] }),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// window.electron stub.
//
// Every method App.tsx calls on mount (or registers as a menu/quit
// subscriber) gets a stub. Subscriber methods return an unsubscribe
// function so the useEffect cleanup paths run cleanly on unmount.
// ---------------------------------------------------------------------------
function installElectronStub(): void {
  const noopUnsubscribe = (): void => {}
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
    getApiBaseUrl: vi.fn().mockResolvedValue('http://localhost:8000'),
    waitForApi: vi.fn().mockResolvedValue(true),
    openFile: vi.fn().mockResolvedValue(null),
    openFiles: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    showProjectOpenDialog: vi.fn().mockResolvedValue(null),
    showProjectSaveDialog: vi.fn().mockResolvedValue(null),
    projectFileExists: vi.fn().mockResolvedValue(true),
    readProjectFile: vi.fn().mockResolvedValue({ ok: true, json: '{}' }),
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    showExportSaveDialog: vi.fn().mockResolvedValue(null),
    writeExportFile: vi.fn().mockResolvedValue(undefined),
    addRecentProject: vi.fn().mockResolvedValue([]),
    getRecentProjects: vi.fn().mockResolvedValue([]),
    setWindowTitle: vi.fn().mockResolvedValue(undefined),
    onAppBeforeQuit: vi.fn().mockReturnValue(noopUnsubscribe),
    notifyQuitDecision: vi.fn().mockResolvedValue(undefined),
    onMenuImportCpt: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuImportBorehole: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuProjectNew: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuProjectOpen: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuProjectSave: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuProjectSaveAs: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuProjectClose: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuProjectOpenRecent: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuEditUndo: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuEditRedo: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuOpenSettings: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuOpenCheatsheet: vi.fn().mockReturnValue(noopUnsubscribe),
    // Launch prototypes (#93 / #3 / #6) — menu subscribers fire on mount, so
    // they must return an unsubscribe; the invoke stubs are here for completeness.
    // launchFlags is read SYNCHRONOUSLY during the first render (the activation
    // gate's useState initializer + the onboarding auto-open effect + the
    // LicensingDialog preview row), so it must be a plain object: a dev, non-e2e
    // launch, which keeps the gate 'pass' and never fetches status.
    launchFlags: { e2e: false, packaged: false },
    onMenuOpenOnboarding: vi.fn().mockReturnValue(noopUnsubscribe),
    // "Load sample project" (#93) — invoke stubs; never called on mount (the
    // overlay is marked seen), here for completeness like the tutorial bridges.
    sampleAvailable: vi.fn().mockResolvedValue(false),
    sampleInstall: vi.fn().mockResolvedValue(null),
    onMenuTutorial: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuRestartTutorial: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuOpenLicensing: vi.fn().mockReturnValue(noopUnsubscribe),
    onMenuCheckUpdates: vi.fn().mockReturnValue(noopUnsubscribe),
    onUpdaterEvent: vi.fn().mockReturnValue(noopUnsubscribe),
    getActivationStatus: vi.fn().mockResolvedValue({
      verdict: {
        state: 'unactivated',
        blocked: true,
        tier: null,
        isTrial: false,
        daysRemaining: null,
        graceDaysRemaining: null,
        expiresAtMs: null,
        graceEndsAtMs: null,
        reason: 'no licence',
      },
      deviceLabel: 'smoke-host',
      keyMasked: null,
      isTrial: false,
    }),
    activateLicence: vi.fn().mockResolvedValue({ ok: false, code: 'unknown_key', message: '' }),
    startTrial: vi.fn().mockResolvedValue({ ok: false, code: 'already_trialled', message: '' }),
    deactivateLicence: vi.fn().mockResolvedValue({ ok: false, code: 'unreachable', message: '' }),
    previewActivationState: vi.fn().mockResolvedValue(undefined),
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    downloadUpdate: vi.fn().mockResolvedValue(undefined),
    quitAndInstallUpdate: vi.fn().mockResolvedValue(undefined),
    // #214 — distribution robustness stubs
    onAppBackendFailed: vi.fn().mockReturnValue(noopUnsubscribe),
    getLogsPath: vi.fn().mockResolvedValue('/tmp/strix-logs'),
    logRendererError: vi.fn().mockResolvedValue(undefined),
    // Crash recovery (docs/design/autosave-recovery.md). The default is
    // "nothing crashed": no recovery file, so no prompt. The two recovery
    // tests below override ``readRecovery`` per test.
    writeRecovery: vi.fn().mockResolvedValue(undefined),
    listRecovery: vi.fn().mockResolvedValue([]),
    readRecovery: vi.fn().mockResolvedValue(null),
    deleteRecovery: vi.fn().mockResolvedValue(true),
  }
}

/** A minimally valid recovery payload for the smoke-level trigger tests. */
function makeRecoveryPayload(): unknown {
  return {
    snapshot_version: 1,
    filePath: 'C:/projects/smoke.strix',
    lumping: { current: null, revision: null },
    ghosts: [],
    metadataDraftPatch: {},
    manifests: { cpt: [], borehole: [], formation: [], section: [] },
    sessionImports: { cpt: [], borehole: [], formation: [], section: [], contact: [] },
    hasUnsavedMutations: true,
  }
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  mockProjectLoaded = false
  installElectronStub()
  // Mark onboarding seen so the first-launch overlay does not auto-open and
  // change this smoke test's DOM (the overlay has its own coverage). The flag
  // key mirrors utils/onboardingSeen.ts.
  localStorage.setItem('strix.onboarding.seen.v1', '1')
  // React swallows render-time errors that hit an error boundary and
  // reports them via console.error. Spy so the test can fail on any
  // unexpected console.error (which the smoke test would otherwise
  // miss because waitFor sees the loading state and never times out).
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

describe('App (smoke)', () => {
  it('mounts without throwing and reaches the WelcomeScreen', async () => {
    const { findByText } = render(<App />)

    // The principal assertion. The boot effect (getApiBaseUrl +
    // waitForApi) is async; the "Starting StrixGeo API…" splash
    // renders first, then ready=true flips and WelcomeScreen
    // appears. If anything in App's render or initial effects
    // throws (TDZ ReferenceError, missing globals, hook-ordering
    // crashes), React unwinds before this text ever lands and
    // findByText times out — that IS the test failure.
    const heading = await findByText('Ground Model')
    expect(heading).toBeInTheDocument()

    // Belt-and-braces. React reports caught errors through
    // console.error rather than re-throwing, so a render-time
    // throw inside a child component (caught by an internal
    // boundary, or by act() in the test harness) can land on
    // the WelcomeScreen branch anyway and look like a pass.
    // Failing on any console.error call surfaces those.
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  // Owner 2026-09-03 ("shouldn't i get a beta key screen before that?"): a
  // PACKAGED build with a blocked verdict shows the licence start screen while
  // the engine is deferred — never the "Starting StrixGeo API…" splash, which
  // would wait forever for an engine that only starts after activation.
  it('a packaged build with a blocked verdict shows the licence screen, not the starting splash', async () => {
    type Status = { verdict: Record<string, unknown> }
    type MockFn = { mockResolvedValue: (v: unknown) => void; mockReturnValue: (v: unknown) => void }
    const electron = window.electron as unknown as {
      launchFlags: { e2e: boolean; packaged: boolean }
      getActivationStatus: (() => Promise<Status>) & MockFn
      waitForApi: (() => Promise<boolean>) & MockFn
    }
    electron.launchFlags = { e2e: false, packaged: true }
    const base = await electron.getActivationStatus()
    electron.getActivationStatus.mockResolvedValue({
      ...base,
      verdict: { ...base.verdict, blocked: true, state: 'unactivated' },
    })
    // A deferred engine: readiness is never answered.
    electron.waitForApi.mockReturnValue(new Promise(() => {}))
    render(<App />)
    await waitFor(() => expect(screen.getByTestId('licensing-key-input')).toBeInTheDocument())
    expect(screen.queryByTestId('app-loading')).toBeNull()
  })

  it('mounts the loaded-project AppShell subtree without throwing (R1, debt #12)', async () => {
    // The escalation the debt called for: with a project loaded, App
    // renders AppShell → StageSpine + StageToolbar + StageCanvas
    // (DataCanvas) + Inspector (DataInspector), and the shellContextValue
    // useMemo is actually CONSUMED. A TDZ / hook-ordering / dep-array
    // crash anywhere in that subtree unwinds React before the spine
    // labels land — findByText times out → test failure. The
    // WelcomeScreen-only test could never see this.
    mockProjectLoaded = true
    const { findByText } = render(<App />)

    // StageSpine renders a button per stage with its spineLabel. Seeing
    // "Stratigraphy" proves AppShell + the spine mounted past the project gate.
    const spineLabel = await findByText('Stratigraphy')
    expect(spineLabel).toBeInTheDocument()

    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // The App-level recovery trigger (docs/design/autosave-recovery.md §4).
  // A recovery file present when a project opens means the previous session
  // never reached a clean exit — and the check lives in ONE effect keyed on
  // the open project, not in each of the four open paths.
  // -------------------------------------------------------------------------

  it('offers to restore unsaved work when the opened project has a recovery file', async () => {
    mockProjectLoaded = true
    ;(
      window.electron as unknown as { readRecovery: ReturnType<typeof vi.fn> }
    ).readRecovery = vi.fn().mockResolvedValue(makeRecoveryPayload())

    const { findByTestId } = render(<App />)
    expect(await findByTestId('recovery-prompt-dialog')).toBeInTheDocument()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('offers nothing when the recovery payload is malformed — recovery never breaks an open', async () => {
    mockProjectLoaded = true
    ;(
      window.electron as unknown as { readRecovery: ReturnType<typeof vi.fn> }
    ).readRecovery = vi.fn().mockResolvedValue({ snapshot_version: 999, junk: true })
    const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const { findByText, queryByTestId } = render(<App />)
    // Wait for the shell so the detection effect has had its chance to run.
    await findByText('Stratigraphy')
    await waitFor(() => expect(consoleWarnSpy).toHaveBeenCalled())
    expect(queryByTestId('recovery-prompt-dialog')).not.toBeInTheDocument()
  })
})
