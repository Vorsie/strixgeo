// Behavioral net for the Slice-4 Correlate toolbar button in SectionsToolbar.
//
// Claims pinned here:
//   CT1  Correlate button is HIDDEN when the section axis is geological
//        (isLitho = false → the whole {isLitho && …} block is absent).
//   CT2  Correlate button is DISABLED when activeLithoModel is null, even
//        when the axis is lithostratigraphic.
//   CT3  Correlate button is DISABLED when no section is selected
//        (selectedSectionId = null), even with a litho model present.
//   CT4  When activeLithoModel is set AND a section is selected, the button
//        is enabled. Clicking it calls enterCorrelateMode.
//   CT5  When correlateMode is true, the button label spells out the
//        next-step action ("Correlate · click 2 bands") and clicking
//        it calls exitCorrelateMode. The label was changed from
//        "Correlating…" on 2026-05-20 because users mistook the
//        spinner-style phrasing for "work in progress, please wait"
//        instead of "click bands to proceed".
//   CT6  Switching the axis from lithostratigraphic back to geological
//        invokes setSectionModelAxis('geological') — the toolbar delegates
//        clearing correlate mode to the useSections axis-switch wrapper.
//
//   Auto-correlate pre-check (Slice 4 Half-A) — handleAutoCorrelateWithCheck:
//   ACW1 0 existing auto edges → fires handleAutoCorrelate immediately (no dialog).
//   ACW2 N>0 existing auto edges → opens ReCorrelateConfirmDialog instead of
//        firing immediately.
//   ACW3 listCorrelations API error → toasts an error, does NOT open dialog,
//        does NOT fire handleAutoCorrelate.

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import { api } from '../../../api/client'
import type { GeologicalModelResponse, LithoCorrelationEdge } from '../../../api/client'
import SectionsToolbar from './SectionsToolbar'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// vi.mock is hoisted — the factory must NOT reference top-level `const`
// variables declared in the test module (TDZ). All mock functions are
// created inside the factory so they are available at hoist time.
// The ACW tests override them per-call with .mockResolvedValueOnce().
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        // Default: empty list → ACW1 branch (no dialog). ACW tests override
        // with .mockResolvedValueOnce() via the imported api object.
        listCorrelations: vi.fn().mockResolvedValue([]),
        deleteAutoCorrelations: vi.fn().mockResolvedValue({ deleted: 0 }),
        autoCorrelate: vi.fn().mockResolvedValue({
          edges_created: 0,
          edges_skipped_existing: 0,
          formations_recomputed: 0,
          wedge_tips_materialised: 0,
        }),
      },
      virtueleBoring: {
        getModels: vi.fn().mockResolvedValue([]),
      },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Stub context factory
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)

function makeLithoModel(): GeologicalModelResponse {
  return {
    id: 'model-litho-1',
    app_project_id: 'proj-1',
    name: 'Litho model',
    description: null,
    kind: 'lithostratigraphic',
    parent_geological_model_id: 'model-geo-1',
    is_active: true,
    excluded_borehole_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeAutoEdge(id: string): LithoCorrelationEdge {
  return {
    id,
    formation_a_id: 'fa-1',
    formation_b_id: 'fb-1',
    source: 'auto',
    created_at: '2026-01-01T00:00:00Z',
  }
}

function makeCtx(overrides: {
  activeLithoModel?: GeologicalModelResponse | null
  sectionModelAxis?: 'geological' | 'lithostratigraphic'
  setSectionModelAxis?: (axis: 'geological' | 'lithostratigraphic') => void
  selectedSectionId?: string | null
  correlateMode?: boolean
  enterCorrelateMode?: () => void
  exitCorrelateMode?: () => void
  handleAutoCorrelate?: () => Promise<void>
  toast?: () => void
} = {}): ShellContextValue {
  const setSectionModelAxis = overrides.setSectionModelAxis ?? vi.fn()
  const enterCorrelateMode = overrides.enterCorrelateMode ?? vi.fn()
  const exitCorrelateMode = overrides.exitCorrelateMode ?? vi.fn()
  const toastFn = overrides.toast ?? vi.fn()

  return {
    project: {
      id: 'proj-1',
      name: 'Test',
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
      activeGeologicalModel: {
        id: 'model-geo-1',
        app_project_id: 'proj-1',
        name: 'Default model',
        description: null,
        kind: 'geological',
        parent_geological_model_id: null,
        is_active: true,
        excluded_borehole_ids: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      models: [],
      activeLithoModel: overrides.activeLithoModel ?? null,
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
      handleAutoPopulateFromStratigraphy: noopAsync,
      handleSeedLithoFromParent: noopAsync,
      handleDedupeContacts: () => Promise.resolve(0),
      handleRebuildSurfaces: noopAsync,
      handleExportModelPlaxis3d: noopAsync,
      handleToggleBoreholeInModel: noopAsync,
      discardContacts: vi.fn(),
      discoverBoreholeFormations: () => Promise.resolve({ candidates: [], collisions: [] }),
      applyBoreholeFormationSelection: noopAsync,
      handleDeleteModel: noopAsync,
      ensureActiveGeologicalModel: () => Promise.resolve(null),
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
      handleAcceptLithoSuggestion: noopAsync,
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      pinchOutPreview: null,
      pinchOutLoading: false,
      handlePreviewPinchOut: async () => false,
      handleCommitPinchOut: noopAsync,
      clearPinchOutPreview: vi.fn(),
      handleDeleteLithoModel: noopAsync,
      backdropSurfacesByFormationId: new Map(),
      handleLoadBackdropSurfaces: noopAsync,
      lithoStaleSurfaceCount: 0,
      lithoStaleTinSessionCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: overrides.handleAutoCorrelate ?? noopAsync,
    },
    sections: {
      sections: overrides.selectedSectionId
        ? [{ id: overrides.selectedSectionId, name: 'S1' } as import('../../../api/client').CrossSectionResponse]
        : [],
      selectedSectionId: overrides.selectedSectionId ?? null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: overrides.sectionModelAxis ?? 'lithostratigraphic',
      setSectionModelAxis,
      backdropModelIdOverride: null,
      setBackdropModelIdOverride: vi.fn(),
      refreshSectionList: noopAsync,
      clearSectionSelection: vi.fn(),
      handleSectionCreated: vi.fn(),
      handleSectionDeleted: vi.fn(),
      handleCreateSection: () => Promise.resolve(null),
      cancelSectionDraw: vi.fn(),
      handleSectionLineDrawn: noopAsync,
      handleDeleteSection: noopAsync,
      handlePatchSelectedSection: noopAsync,
      handleSelectSection: vi.fn(),
      handleFocusContacts: vi.fn(),
      applyUpdatedSection: vi.fn(),
      sectionFocusedColumn: null,
      setSectionFocusedColumn: vi.fn(),
      correlateMode: overrides.correlateMode ?? false,
      correlationSource: null,
      enterCorrelateMode,
      exitCorrelateMode,
      armCorrelationSource: vi.fn(),
      clearCorrelationSource: vi.fn(),
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
    },
    mapState: {
      hiddenCptTypes: new Set(),
      hiddenBoreholeValues: {
        drill_method: new Set<string>(),
        borehole_type: new Set<string>(),
      },
      boreholeAxis: 'drill_method',
      viewportBounds: null,
      mapCameraRef: { current: null },
      handleToggleCptType: vi.fn(),
      handleToggleBoreholeValue: vi.fn(),
      setBoreholeAxis: vi.fn(),
      handleViewportChange: vi.fn(),
      handleMapCameraChange: vi.fn(),
    },
    toasts: { toasts: [], toast: toastFn },
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
  } as unknown as ShellContextValue
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderWith(ctx: ShellContextValue) {
  return render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

// ---------------------------------------------------------------------------
// Tests — Correlate mode button (CT1–CT6)
// ---------------------------------------------------------------------------

describe('SectionsToolbar Correlate button (Slice 4)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('CT1: Correlate button absent when axis is geological', () => {
    renderWith(
      makeCtx({
        sectionModelAxis: 'geological',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
      }),
    )
    // The isLitho block is absent on geological axis
    expect(screen.queryByRole('button', { name: /correlate/i })).toBeNull()
  })

  it('CT2: Correlate button disabled when no active litho model', () => {
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: null,
        selectedSectionId: 'sec-1',
      }),
    )
    const btn = screen.getByRole('button', { name: 'Correlate' })
    expect(btn).toBeDisabled()
  })

  it('CT3: Correlate button disabled when no section selected', () => {
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: null,
      }),
    )
    const btn = screen.getByRole('button', { name: 'Correlate' })
    expect(btn).toBeDisabled()
  })

  it('CT4: enabled with litho model + section; click calls enterCorrelateMode', () => {
    const enterCorrelateMode = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        correlateMode: false,
        enterCorrelateMode,
      }),
    )
    const btn = screen.getByRole('button', { name: 'Correlate' })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(enterCorrelateMode).toHaveBeenCalledOnce()
  })

  it('CT5: when correlateMode=true label tells user to click 2 bands; click calls exitCorrelateMode', () => {
    const exitCorrelateMode = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        correlateMode: true,
        exitCorrelateMode,
      }),
    )
    const btn = screen.getByRole('button', { name: /click 2 bands/i })
    fireEvent.click(btn)
    expect(exitCorrelateMode).toHaveBeenCalledOnce()
  })

  it('CT6: switching axis to geological calls setSectionModelAxis("geological")', () => {
    const setSectionModelAxis = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        setSectionModelAxis,
      }),
    )
    // The Geology radio button in the axis toggle (role=radio, not role=button)
    const geoBtn = screen.getByRole('radio', { name: /geology/i })
    fireEvent.click(geoBtn)
    expect(setSectionModelAxis).toHaveBeenCalledWith('geological')
  })
})

// ---------------------------------------------------------------------------
// Tests — Auto-correlate pre-check (Slice 4 Half-A — ACW1–ACW3)
//
// handleAutoCorrelateWithCheck:
//   1. GET listCorrelations → count source='auto' edges.
//   2. autoCount === 0 → fire handleAutoCorrelate immediately (no dialog).
//   3. autoCount > 0  → open ReCorrelateConfirmDialog.
//
// WHY these tests: the CT tests above only cover the "Correlate mode" toggle
// button. handleAutoCorrelateWithCheck was never exercised by any Vitest test
// before ACW1-ACW3 were added (dogfeed 2026-05-25 regression anchor). The
// dialog wiring is correct in code but the missing tests left the pre-check
// path un-anchored — any refactor that broke the source='auto' filter or
// accidentally swapped the zero-branch logic would have been invisible.
// ---------------------------------------------------------------------------

describe('SectionsToolbar Auto-correlate pre-check (Slice 4 Half-A)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('ACW1: 0 auto edges → fires handleAutoCorrelate immediately, no dialog', async () => {
    // listCorrelations returns [] → autoCount = 0 → immediate fire.
    vi.mocked(api.geology.listCorrelations).mockResolvedValueOnce([])
    const handleAutoCorrelate = vi.fn().mockResolvedValue(undefined)

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        handleAutoCorrelate,
      }),
    )

    const btn = screen.getByTestId('litho-auto-correlate')
    await act(async () => { fireEvent.click(btn) })

    // handleAutoCorrelate fires; the dialog must NOT open.
    expect(handleAutoCorrelate).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('re-correlate-confirm-dialog')).toBeNull()
  })

  it('ACW1b: manual-only edges (source=manual) are NOT counted as auto edges', async () => {
    // A manual edge must not trigger the dialog — only source='auto' counts.
    const manualEdge: LithoCorrelationEdge = {
      id: 'edge-manual-1',
      formation_a_id: 'fa-1',
      formation_b_id: 'fb-1',
      source: 'manual',
      created_at: '2026-01-01T00:00:00Z',
    }
    vi.mocked(api.geology.listCorrelations).mockResolvedValueOnce([manualEdge])
    const handleAutoCorrelate = vi.fn().mockResolvedValue(undefined)

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        handleAutoCorrelate,
      }),
    )

    const btn = screen.getByTestId('litho-auto-correlate')
    await act(async () => { fireEvent.click(btn) })

    // Manual edges do not trigger the dialog — fires immediately.
    expect(handleAutoCorrelate).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('re-correlate-confirm-dialog')).toBeNull()
  })

  it('ACW2: N>0 auto edges → dialog opens, handleAutoCorrelate NOT yet called', async () => {
    // listCorrelations returns 3 auto edges → autoCount = 3 → dialog opens.
    vi.mocked(api.geology.listCorrelations).mockResolvedValueOnce([
      makeAutoEdge('edge-auto-1'),
      makeAutoEdge('edge-auto-2'),
      makeAutoEdge('edge-auto-3'),
    ])
    const handleAutoCorrelate = vi.fn().mockResolvedValue(undefined)

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        handleAutoCorrelate,
      }),
    )

    const btn = screen.getByTestId('litho-auto-correlate')
    await act(async () => { fireEvent.click(btn) })

    // Dialog must be visible.
    expect(screen.getByTestId('re-correlate-confirm-dialog')).not.toBeNull()
    // handleAutoCorrelate must NOT have fired yet — that's the dialog's job.
    expect(handleAutoCorrelate).not.toHaveBeenCalled()
    // Dialog shows the edge count.
    expect(screen.getByText('3')).not.toBeNull()
  })

  it('ACW3: listCorrelations error → toast error, no dialog, handleAutoCorrelate not called', async () => {
    // Pre-check fails → toast error, clean up, no dialog.
    vi.mocked(api.geology.listCorrelations).mockRejectedValueOnce(new Error('network failure'))
    const handleAutoCorrelate = vi.fn()
    const toast = vi.fn()

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        handleAutoCorrelate,
        toast,
      }),
    )

    const btn = screen.getByTestId('litho-auto-correlate')
    await act(async () => { fireEvent.click(btn) })

    // Error toast fired; dialog absent; handleAutoCorrelate never called.
    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('pre-check'))
    expect(screen.queryByTestId('re-correlate-confirm-dialog')).toBeNull()
    expect(handleAutoCorrelate).not.toHaveBeenCalled()
    // Button should return to enabled state (autoCorrelating cleared in finally).
    expect(btn).not.toBeDisabled()
  })
})
