// C2 audit fix — ProvenanceConflictDialog retry-race regression tests.
//
// BPR-1  handleClaimBodyExtent: a first-time 409 opens the dialog
//        (ProvenanceConflictDialog mounts with the right bodyId/side/kind).
//
// BPR-2  onApply happy path: clear succeeds + retry claim succeeds
//        → dialog closes, success toast fires, dialog does NOT reopen.
//
// BPR-3  onApply retry race: clear succeeds + retry claim returns 409 again
//        → dialog does NOT reopen, an error toast fires instead ("Couldn't
//        claim extent — try again.").
//
// These tests exercise the boundary between SectionsCanvas (the wiring) and
// the ProvenanceConflictDialog (the rendered dialog).  SectionPanel is mocked
// so tests can invoke onClaimBodyExtent without a real canvas.

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import { ProvenanceViolationError } from '../../../api/client'
import type { GeologicalModelResponse } from '../../../api/client'
import { makeBody } from '../../../components/sections/__tests__/bodyTestFixtures'

// ---------------------------------------------------------------------------
// Mocks — SectionPanel + MapView (same pattern as SectionsCanvas.p2.test.tsx)
// ---------------------------------------------------------------------------

// Capture the onClaimBodyExtent callback so tests can trigger the gesture.
let capturedOnClaimBodyExtent:
  | ((bodyId: string, side: 'left' | 'right', kind: string) => void)
  | undefined = undefined

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: {
    onClaimBodyExtent?: (bodyId: string, side: 'left' | 'right', kind: string) => void
    [key: string]: unknown
  }) => {
    capturedOnClaimBodyExtent = props.onClaimBodyExtent
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

// ---- API mocks -----------------------------------------------------------

const mockListLenses = vi.fn()
const mockGetLensBoundary = vi.fn()
const mockClaimBodyExtent = vi.fn()
const mockClearBodyExtent = vi.fn()

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        acceptLithoSuggestions: vi.fn().mockResolvedValue(null),
        createContactCorrelation: vi.fn().mockResolvedValue(undefined),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        listLenses: (...args: unknown[]) => mockListLenses(...args),
        getLensBoundary: (...args: unknown[]) => mockGetLensBoundary(...args),
        claimBodyExtent: (...args: unknown[]) => mockClaimBodyExtent(...args),
        clearBodyExtent: (...args: unknown[]) => mockClearBodyExtent(...args),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
      section: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)


function makeLithoModel(id = 'litho-model-1'): GeologicalModelResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: 'Lithostratigraphic Model',
    description: null,
    is_active: true,
    excluded_borehole_ids: [],
    kind: 'lithostratigraphic',
    parent_geological_model_id: 'geo-model-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeStubContext(): ShellContextValue {
  const section = {
    id: 'sec-1',
    app_project_id: 'proj-1',
    name: 'Section A-A',
    description: null,
    start_x: 0,
    start_y: 0,
    end_x: 100,
    end_y: 0,
    epsg: 31370,
    projection_buffer_m: 50,
    vertical_exaggeration: 2,
    excluded_borehole_ids: [],
    excluded_cpt_ids: [],
    seeded_formation_contact_ids: [] as string[],
    min_depth_m: null,
    max_depth_m: null,
    display_order: 0,
    view_state: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
  const lithoModel = makeLithoModel()
  const mockToast = vi.fn()

  return {
    project: {
      id: 'proj-1',
      name: 'Test Project',
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
    },
    lifecycle: {
      projectDirty: false,
      newProjectOpen: false,
      setNewProjectOpen: vi.fn(),
      metadataEditorOpen: false,
      setMetadataEditorOpen: vi.fn(),
      closeConfirmOpen: false,
      setCloseConfirmOpen: vi.fn(),
      unsavedDialogOpen: false,
      unsavedSaving: false,
      saveProject: () => Promise.resolve(true),
      discardSessionImports: vi.fn(),
      handleCloseProjectRequest: vi.fn(),
      handleUnsavedSave: noopAsync,
      handleUnsavedDiscard: vi.fn(),
      handleUnsavedCancel: vi.fn(),
      stageLumping: vi.fn(),
      currentLumping: null,
    },
    investigations: {
      cpts: [],
      boreholes: [],
      detailMap: new Map(),
      plotMap: new Map(),
      boreholeDetailMap: new Map(),
      importing: false,
      dovImporting: false,
      dovImportState: { status: 'idle' } as const,
      resetDovImport: vi.fn(),
      bboxImportType: null,
      removedCptIds: new Set(),
      removedBoreholeIds: new Set(),
      refreshList: noopAsync,
      refreshBoreholeList: noopAsync,
      loadCptDetail: noopAsync,
      loadChart: noopAsync,
      loadBoreholeDetail: noopAsync,
      cancelBboxDraw: vi.fn(),
      unhideCpts: vi.fn(),
      unhideBoreholes: vi.fn(),
      handleRemoveCpts: vi.fn(),
      handleRemoveBoreholes: vi.fn(),
      handleRestoreAllCpts: vi.fn(),
      handleRestoreAllBoreholes: vi.fn(),
      handlePatchCptElevation: noopAsync,
      handlePatchBoreholeElevation: noopAsync,
      handleImportCpt: noopAsync,
      handleImportDov: vi.fn(),
      handleImportBoreholeDov: vi.fn(),
      handleBboxDrawn: noopAsync,
      pendingCptPins: [],
    },
    visibleCpts: [],
    visibleBoreholes: [],
    geoModel: {
      activeGeologicalModel: null,
      models: [],
      activeLithoModel: lithoModel,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: async () => {},
      lithoContacts: [],
      lithoFormations: [],
      lithoSurfacesByFormationId: new Map(),
      handleCreateLithoContact: noopAsync,
      handleInlineLithoCreateFormation: noopAsyncNull,
      formations: [],
      visibleFormations: [],
      formationsRefreshCounter: 0,
      contacts: [],
      surfacesByFormationId: new Map(),
      crossingsRefreshCounter: 0,
      staleSurfaceCount: 0,
      handleFormationCreated: vi.fn(),
      handleFormationUpdated: vi.fn(),
      handleFormationDeleted: vi.fn(),
      handleInlineCreateFormation: noopAsyncNull,
      refetchFormations: vi.fn(),
      handleCreateContact: noopAsync,
      handleUpdateContactDepth: noopAsync,
      handleBatchCreateContacts: noopAsync,
      handleBatchUpdateContacts: noopAsync,
      handleDeleteContact: noopAsync,
      handleUnlinkLithoFromGeo: noopAsync,
      handleLinkLithoToGeo: noopAsync,
      handleAutoPopulateFromStratigraphy: noopAsync,
      handleDedupeContacts: () => Promise.resolve(0),
      handleRebuildSurfaces: noopAsync,
      handleExportModelPlaxis3d: noopAsync,
      handleToggleBoreholeInModel: noopAsync,
      discardContacts: vi.fn(),
      discoverBoreholeFormations: async () => ({ candidates: [], collisions: [] }),
      applyBoreholeFormationSelection: noopAsync,
      handleDeleteModel: noopAsync,
      ensureActiveGeologicalModel: async () => null,
      ghostsByAnchor: new Map(),
      focusedSuggestAnchorId: null,
      handleEditLithoSuggestion: () => {},
      bulkLithoSuggesting: false,
      handleSuggestAllLitho: async () => {},
      handleAcceptBulkLitho: async () => {},
      handleAcceptAllBulkLitho: async () => {},
      handleRejectBulkLitho: () => {},
      handleUnrejectBulkLitho: () => {},
      handleEditBulkLitho: () => {},
      handleInsertLithoLayer: vi.fn(),
      handleSplitLithoLayer: vi.fn(),
      handleMergeLithoLayers: vi.fn(),
      handleAbsorbLithoLayer: vi.fn(),
      clearBulkLithoGhosts: () => {},
      handleStripLithoAdmixtures: () => {},
      handleReseedLithoAdmixtures: () => {},
      handleClearLithoModel: noopAsync,
      refetchLithoContacts: () => {},
      lithoSuggesting: false,
      handleSuggestLitho: noopAsync,
      handleAcceptLithoSuggestion: noopAsyncNull,
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      handleSeedLithoFromParent: noopAsync,
      handleDeleteLithoModel: noopAsync,
      backdropSurfacesByFormationId: new Map(),
      handleLoadBackdropSurfaces: noopAsync,
      lithoStaleSurfaceCount: 0,
      lithoStaleTinSessionCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      handleCreateManualLithoGhost: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
      markMutated: vi.fn(),
    },
    sections: {
      sections: [section],
      selectedSectionId: section.id,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [section],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: 'lithostratigraphic',
      setSectionModelAxis: vi.fn(),
      backdropModelIdOverride: null,
      setBackdropModelIdOverride: vi.fn(),
      refreshSectionList: noopAsync,
      clearSectionSelection: vi.fn(),
      handleSectionCreated: vi.fn(),
      handleSectionDeleted: vi.fn(),
      handleCreateSection: noopAsyncNull,
      cancelSectionDraw: vi.fn(),
      handleSectionLineDrawn: noopAsync,
      handleDeleteSection: noopAsync,
      handlePatchSelectedSection: noopAsync,
      handleSelectSection: vi.fn(),
      handleFocusContacts: vi.fn(),
      applyUpdatedSection: vi.fn(),
      sectionFocusedColumn: null,
      setSectionFocusedColumn: vi.fn(),
      correlateMode: false,
      correlationSource: null,
      enterCorrelateMode: vi.fn(),
      exitCorrelateMode: vi.fn(),
      armCorrelationSource: vi.fn(),
      clearCorrelationSource: vi.fn(),
      pinchOutCandidates: [],
      setPinchOutCandidates: vi.fn(),
    },
    overlays: {
      demSource: null,
      demOverlay: { enabled: false, opacity: 0.6 },
      handleDemOverlayChange: noopAsync,
      virtueleBoringOverlay: { modelA: null, modelB: null, maxDepthM: null },
      virtueleBoringSectionModels: [],
      virtueleBoringPredictions: [],
      virtueleBoringLoading: false,
      virtueleBoringSkippedCount: 0,
      virtueleBoringPredictionByInvestigationId: new Map(),
      cptEffectiveModels: [],
      boreholeEffectiveModels: [],
      showOverlayOnSection: false,
      showOverlayOnCpt: false,
      showOverlayOnBorehole: false,
      cptVirtueleBoringOverride: '',
      boreholeVirtueleBoringOverride: '',
      handleChangeVirtueleBoringPicker: noopAsync,
      handleSetShowOverlay: vi.fn(),
      handleSetOverlayOverride: vi.fn(),
      showConfidenceFade: true,
      handleSetShowConfidenceFade: vi.fn(),
    },
    toasts: {
      toasts: [],
      toast: mockToast,
    },
    undo: {
      push: vi.fn(),
      undo: noopAsync,
      redo: noopAsync,
      clear: vi.fn(),
      canUndo: false,
      canRedo: false,
      busy: false,
    },
    boot: { ready: true, apiError: false },
    mapState: {
      hiddenCptTypes: new Set(),
      hiddenBoreholeValues: { drill_method: new Set<string>(), borehole_type: new Set<string>() },
      boreholeAxis: 'drill_method',
      viewportBounds: null,
      mapCameraRef: { current: null },
      handleToggleCptType: vi.fn(),
      handleToggleBoreholeValue: vi.fn(),
      setBoreholeAxis: vi.fn(),
      handleViewportChange: vi.fn(),
      handleMapCameraChange: vi.fn(),
    },
    coordinator: {
      selectedId: null,
      selectedBoreholeId: null,
      setSelectedId: vi.fn(),
      setSelectedBoreholeId: vi.fn(),
      view: 'map',
      setView: vi.fn(),
      handleSelect: noopAsync,
      handleSelectBorehole: noopAsync,
      handleExportSectionDxf: noopAsync,
      handleExportSectionPlaxis2d: noopAsync,
      handleExportSectionPdf: vi.fn(),
      outOfViewportCptIds: new Set(),
      outOfViewportBoreholeIds: new Set(),
      projectFilePath: null,
      manifestFormationIds: new Set(),
      sessionImportCptIds: new Set(),
      sessionImportBoreholeIds: new Set(),
      sessionImportSectionIds: new Set(),
      sessionImportFormationIds: new Set(),
      marqueeSelectedIds: new Set(),
      setMarqueeSelectedIds: vi.fn(),
      hoveredTestId: null,
      setHoveredTestId: vi.fn(),
      geoDeepLinkTarget: null,
      setGeoDeepLinkTarget: vi.fn(),
      sectionsDeepLinkTarget: null,
      setSectionsDeepLinkTarget: vi.fn(),
      correlationEdgesRefetchNonce: 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  capturedOnClaimBodyExtent = undefined
  // Return the body in the lensList so _doClaimExtent can look it up.
  mockListLenses.mockResolvedValue([makeBody({ id: 'body-1' })])
  mockGetLensBoundary.mockResolvedValue({ lens_id: 'body-1', content_key: null, render_style: 'straight', upper_nodes: [], lower_nodes: [] })
  mockClaimBodyExtent.mockReset()
  mockClearBodyExtent.mockReset()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SectionsCanvas — ProvenanceConflictDialog retry-race (C2 audit)', () => {
  it('BPR-1 — first-time 409 from handleClaimBodyExtent opens the conflict dialog', async () => {
    // Arrange: claimBodyExtent throws 409 on the first call.
    mockClaimBodyExtent.mockRejectedValue(
      new ProvenanceViolationError('left', 'pinch_out_halfway'),
    )

    const ctx = makeStubContext()
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // Wait for listLenses to load the body into lensList.
    await act(async () => {})

    // Trigger the claim gesture via the captured SectionPanel callback.
    expect(capturedOnClaimBodyExtent).toBeDefined()
    await act(async () => {
      capturedOnClaimBodyExtent?.('body-1', 'left', 'pinch_out_halfway')
    })

    // The conflict dialog must now be open.
    expect(screen.getByTestId('provenance-conflict-dialog')).not.toBeNull()
    // The dialog does NOT show a second time — only one instance.
    expect(screen.getAllByTestId('provenance-conflict-dialog')).toHaveLength(1)
  })

  it('BPR-2 — onApply happy path: clear + retry succeed → dialog closes, no second open', async () => {
    // Arrange: first call → 409; subsequent calls → success.
    let callCount = 0
    mockClaimBodyExtent.mockImplementation(() => {
      callCount++
      if (callCount === 1) {
        return Promise.reject(new ProvenanceViolationError('left', 'pinch_out_halfway'))
      }
      return Promise.resolve(makeBody({ id: 'body-1' }))
    })
    mockClearBodyExtent.mockResolvedValue(null) // body reaped (204 path)

    const ctx = makeStubContext()
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    await act(async () => {})

    // Trigger first claim → 409 → dialog opens.
    await act(async () => {
      capturedOnClaimBodyExtent?.('body-1', 'left', 'pinch_out_halfway')
    })
    expect(screen.queryByTestId('provenance-conflict-dialog')).not.toBeNull()

    // Click Apply — clear + retry claim both succeed.
    await act(async () => {
      screen.getByTestId('provenance-conflict-apply').click()
    })

    // Dialog must be gone after apply.
    expect(screen.queryByTestId('provenance-conflict-dialog')).toBeNull()

    // Verify clearBodyExtent and a second claimBodyExtent were both called.
    expect(mockClearBodyExtent).toHaveBeenCalledTimes(1)
    expect(mockClaimBodyExtent).toHaveBeenCalledTimes(2)
  })

  it('BPR-3 — onApply retry race: second claim returns 409 → dialog does NOT reopen, toast fires', async () => {
    // Arrange: ALL calls to claimBodyExtent throw ProvenanceViolationError.
    // This simulates a DetectBodies sweep re-claiming between clear and retry.
    mockClaimBodyExtent.mockRejectedValue(
      new ProvenanceViolationError('left', 'pinch_out_halfway'),
    )
    mockClearBodyExtent.mockResolvedValue(null)

    const ctx = makeStubContext()
    const mockToast = (ctx.toasts.toast) as Mock
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    await act(async () => {})

    // First claim → 409 → dialog opens.
    await act(async () => {
      capturedOnClaimBodyExtent?.('body-1', 'left', 'pinch_out_halfway')
    })
    expect(screen.queryByTestId('provenance-conflict-dialog')).not.toBeNull()

    // Click Apply — clear succeeds, retry claim also returns 409.
    await act(async () => {
      screen.getByTestId('provenance-conflict-apply').click()
    })

    // The CRITICAL assertion: dialog must NOT reopen after the race.
    expect(screen.queryByTestId('provenance-conflict-dialog')).toBeNull()

    // An error toast must fire instead of reopening the dialog.
    expect(mockToast).toHaveBeenCalledWith(
      'error',
      expect.stringContaining("Couldn't claim extent"),
    )
  })
})
