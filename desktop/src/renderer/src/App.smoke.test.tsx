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

import { render, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from './App'

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
        importDov: stub(),
        import: stub(),
      },
      borehole: {
        list: stubArr(),
        get: stub(),
        patchElevation: stub(),
        importDov: stub(),
      },
      project: {
        list: stubArr(),
        listArchived: stubArr(),
        get: stub(),
        create: stub(),
        update: stub(),
        archive: stub(),
        unarchive: stub(),
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
        validateBorehole: stub(),
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
      },
      geotechnicalUnit: {
        list: stubArr(),
        create: stub(),
        update: stub(),
        delete: stub(),
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
    readProjectFile: vi.fn().mockResolvedValue('{}'),
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
  }
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  installElectronStub()
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
    // waitForApi) is async; the "Starting Strix API…" splash
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
})
