// Behavioral net for the F3 geotechnical axis toggle in SectionsToolbar.
//
// Pinned claims:
//   BG1  A "Geotech" radio button is present in the axis toggle group.
//   BG2  When activeGeotechModel is null, the "Geotech" button is disabled.
//   BG3  When activeGeotechModel is present, clicking "Geotech" calls
//        setSectionModelAxis('geotechnical').
//   BG4  When activeGeotechModel is present and axis is 'geotechnical',
//        the "Geotech" button is aria-checked=true.
//   BG5  When axis is 'geotechnical', the "Geology" and "Litho" buttons are
//        both aria-checked=false.
//
// Rendering SectionsToolbar via ShellContext.Provider — same pattern as
// SectionsToolbar.axis.test.tsx.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { GeologicalModelResponse } from '../../../api/client'
import SectionsToolbar from './SectionsToolbar'

// ---------------------------------------------------------------------------
// Module mocks — same as SectionsToolbar.axis.test.tsx
// ---------------------------------------------------------------------------

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
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
// Stub context factory — mirrors the axis test's makeCtx; adds
// activeGeotechModel override.
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)

function makeGeotechModel(): GeologicalModelResponse {
  return {
    id: 'model-geotech-1',
    app_project_id: 'proj-1',
    name: 'Geotech model',
    description: null,
    kind: 'geotechnical',
    parent_geological_model_id: 'model-litho-1',
    is_active: true,
    excluded_borehole_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

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

function makeCtx(overrides: {
  activeGeotechModel?: GeologicalModelResponse | null
  activeLithoModel?: GeologicalModelResponse | null
  selectedSectionId?: string | null
  sectionModelAxis?: 'geological' | 'lithostratigraphic' | 'geotechnical'
  setSectionModelAxis?: (axis: 'geological' | 'lithostratigraphic' | 'geotechnical') => void
  handleSubdivideAllBodies?: () => Promise<void>
  handleDivideBoreholes?: () => Promise<void>
  correlateMode?: boolean
  enterCorrelateMode?: () => void
  exitCorrelateMode?: () => void
} = {}): ShellContextValue {
  const setSectionModelAxis = overrides.setSectionModelAxis ?? vi.fn()

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
      activeGeotechModel: overrides.activeGeotechModel ?? null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: async () => {},
      lithoContacts: [],
      lithoLayers: [],
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
      handleAcceptLithoSuggestion: noopAsyncNull,
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      handleDeleteLithoModel: noopAsync,
      backdropSurfacesByFormationId: new Map(),
      handleLoadBackdropSurfaces: noopAsync,
      lithoSolids: [],
      lithoSolidsLoading: false,
      lithoSolidsBuilding: false,
      hasLithoSolids: false,
      hasStaleLithoSolid: false,
      buildLithoSolids: noopAsync,
      setBodyColor: vi.fn(),
      hideMarkers: false,
      setHideMarkers: vi.fn(),
      geotechSolids: [],
      geotechSolidsLoading: false,
      geotechSolidsBuilding: false,
      hasGeotechSolids: false,
      hasStaleGeotechSolid: false,
      buildGeotechSolids: noopAsync,
      setGeotechBodyColor: vi.fn(),
      geotechHideMarkers: false,
      setGeotechHideMarkers: vi.fn(),
      lithoStaleSurfaceCount: 0,
      lithoStaleTinSessionCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      geotechLayers: [],
      geotechContacts: [],
      geotechFormations: [],
      handleCreateManualLithoGhost: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
      markMutated: vi.fn(),
      // F4 — "Subdivide all bodies" verb handler.
      handleSubdivideAllBodies: overrides.handleSubdivideAllBodies ?? noopAsync,
      // "Divide boreholes" verb handler.
      handleDivideBoreholes: overrides.handleDivideBoreholes ?? noopAsync,
      requestGeotechLayersRefetch: vi.fn(),
    },
    sections: {
      sections: [],
      selectedSectionId: overrides.selectedSectionId ?? null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: overrides.sectionModelAxis ?? 'geological',
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
      enterCorrelateMode: overrides.enterCorrelateMode ?? vi.fn(),
      exitCorrelateMode: overrides.exitCorrelateMode ?? vi.fn(),
      armCorrelationSource: vi.fn(),
      clearCorrelationSource: vi.fn(),
      suggestedTies: [],
      handleSuggestTies: vi.fn(),
      handleAcceptTie: vi.fn(),
      handleAcceptAllTies: vi.fn(),
      handleRejectTie: vi.fn(),
      handleClearTieSuggestions: vi.fn(),
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
    toasts: { toasts: [], toast: vi.fn() },
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
      requestCorrelationEdgesRefetch: vi.fn(),
    },
  } as unknown as ShellContextValue
}

function renderToolbar(ctx: ShellContextValue): void {
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

describe('SectionsToolbar geotech axis toggle (F3)', () => {
  it('BG1 — a "Geotech" radio button is present in the axis group', () => {
    renderToolbar(makeCtx())
    expect(screen.getByText('Geotech')).toBeTruthy()
  })

  it('BG2 — "Geotech" button is disabled when activeGeotechModel is null', () => {
    renderToolbar(makeCtx({ activeGeotechModel: null }))
    const btn = screen.getByTestId('axis-geotech')
    expect(btn).toBeDisabled()
  })

  it('BG3 — clicking "Geotech" calls setSectionModelAxis("geotechnical") when model exists', () => {
    const setSectionModelAxis = vi.fn()
    renderToolbar(makeCtx({ activeGeotechModel: makeGeotechModel(), setSectionModelAxis }))
    fireEvent.click(screen.getByTestId('axis-geotech'))
    expect(setSectionModelAxis).toHaveBeenCalledWith('geotechnical')
  })

  it('BG4 — when axis is "geotechnical", Geotech button is aria-checked=true', () => {
    renderToolbar(
      makeCtx({ activeGeotechModel: makeGeotechModel(), sectionModelAxis: 'geotechnical' }),
    )
    expect(screen.getByTestId('axis-geotech').getAttribute('aria-checked')).toBe('true')
  })

  it('BG5 — when axis is "geotechnical", Geology and Litho are both aria-checked=false', () => {
    renderToolbar(
      makeCtx({ activeGeotechModel: makeGeotechModel(), sectionModelAxis: 'geotechnical' }),
    )
    const geoBtn = screen.getByText('Geology').closest('button')
    const lithoBtn = screen.getByText('Litho').closest('button')
    expect(geoBtn?.getAttribute('aria-checked')).toBe('false')
    expect(lithoBtn?.getAttribute('aria-checked')).toBe('false')
  })
})

// ---------------------------------------------------------------------------
// F4 — "Subdivide all bodies" toolbar verb
// ---------------------------------------------------------------------------
//
// Pinned claims:
//   BF1  The "Subdivide all bodies" button is present on the geotech axis.
//   BF2  The button is absent on the geology and litho axes.
//   BF3  The button is disabled when activeLithoModel is null; enabled when
//        the model is present (section selection is no longer required — the
//        operation is model-wide).
//   BF4  Clicking the enabled button calls handleSubdivideAllBodies with no
//        arguments (model-wide, no section id).

describe('SectionsToolbar "Subdivide all bodies" verb (F4)', () => {
  it('BF1 — button is present when the axis is "geotechnical"', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'section-1',
      }),
    )
    expect(screen.getByTestId('geotech-subdivide-all-bodies')).toBeTruthy()
  })

  it('BF2 — button is absent on the geology axis', () => {
    renderToolbar(makeCtx({ sectionModelAxis: 'geological' }))
    expect(screen.queryByTestId('geotech-subdivide-all-bodies')).toBeNull()
  })

  it('BF2b — button is absent on the lithostratigraphic axis', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
      }),
    )
    expect(screen.queryByTestId('geotech-subdivide-all-bodies')).toBeNull()
  })

  it('BF3 — button is disabled when no litho model exists', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: null,
        selectedSectionId: 'section-1',
      }),
    )
    expect(screen.getByTestId('geotech-subdivide-all-bodies')).toBeDisabled()
  })

  it('BF3b — button is ENABLED even when no section is selected (model-wide operation)', () => {
    // The operation no longer requires a section; only the litho model matters.
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: null,
      }),
    )
    expect(screen.getByTestId('geotech-subdivide-all-bodies')).not.toBeDisabled()
  })

  it('BF4 — clicking the button calls handleSubdivideAllBodies with no arguments (model-wide)', () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'section-abc',
        handleSubdivideAllBodies,
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-subdivide-all-bodies'))
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith()
  })
})

// ---------------------------------------------------------------------------
// C1 — re-subdivide confirmation gate (§7)
// ---------------------------------------------------------------------------
//
// Pinned claims:
//   BC1  Clicking "Subdivide all bodies" when a geotech model already exists
//        OPENS the re-subdivide confirm dialog (a re-run wipes manual packing
//        connections) instead of running the subdivide directly.
//   BC2  Clicking it when NO geotech model exists (first-ever subdivide) runs
//        directly and does NOT open the dialog.

describe('SectionsToolbar re-subdivide confirmation gate (C1)', () => {
  it('BC1 — opens the confirm dialog (not a direct run) when a geotech model exists', () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
        handleSubdivideAllBodies,
      }),
    )
    // Dialog is not mounted before the click.
    expect(screen.queryByTestId('re-subdivide-confirm-dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('geotech-subdivide-all-bodies'))
    // The re-run is gated behind the confirm dialog — it must appear, and the
    // handler must NOT have fired yet (the user has to confirm first).
    expect(screen.getByTestId('re-subdivide-confirm-dialog')).toBeTruthy()
    expect(handleSubdivideAllBodies).not.toHaveBeenCalled()
  })

  it('BC2 — first-ever subdivide (no geotech model) runs directly, no dialog', () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: null,
        handleSubdivideAllBodies,
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-subdivide-all-bodies'))
    expect(screen.queryByTestId('re-subdivide-confirm-dialog')).toBeNull()
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith()
  })
})

// ---------------------------------------------------------------------------
// D — "Correlate packing" verb (manual same-class/same-body packing connect)
// ---------------------------------------------------------------------------
//
// Pinned claims:
//   BD1  The "Correlate packing" verb renders on the geotech axis.
//   BD2  Clicking it (when correlate mode is off) calls enterCorrelateMode.
//   BD3  Clicking it (when correlate mode is on) calls exitCorrelateMode, and
//        the active state is reflected (amber + "click 2 bands" label).

describe('SectionsToolbar "Correlate packing" verb (D)', () => {
  it('BD1 — verb renders on the geotech axis when a geotech model exists', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
      }),
    )
    expect(screen.getByTestId('geotech-correlate-packing')).toBeTruthy()
  })

  it('BD2 — clicking enters correlate mode when off', () => {
    const enterCorrelateMode = vi.fn()
    const exitCorrelateMode = vi.fn()
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
        correlateMode: false,
        enterCorrelateMode,
        exitCorrelateMode,
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-correlate-packing'))
    expect(enterCorrelateMode).toHaveBeenCalled()
    expect(exitCorrelateMode).not.toHaveBeenCalled()
  })

  it('BD3 — clicking exits correlate mode when on, and active state is reflected', () => {
    const enterCorrelateMode = vi.fn()
    const exitCorrelateMode = vi.fn()
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
        correlateMode: true,
        enterCorrelateMode,
        exitCorrelateMode,
      }),
    )
    const btn = screen.getByTestId('geotech-correlate-packing')
    // Active-state cue: label switches to the in-progress prompt.
    expect(btn.textContent).toContain('click 2 bands')
    fireEvent.click(btn)
    expect(exitCorrelateMode).toHaveBeenCalled()
    expect(enterCorrelateMode).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// E — "Divide boreholes" verb
// ---------------------------------------------------------------------------
//
// Pinned claims:
//   BE1  The "Divide boreholes" button is present on the geotech axis when
//        a geotech model exists.
//   BE2  The button is disabled when activeGeotechModel is null (SAB must run
//        first to create the model and CPT geotech layers).
//   BE3  Clicking the enabled button calls handleDivideBoreholes.
//   BE4  The button is absent on the geology and litho axes.

describe('SectionsToolbar "Divide boreholes" verb (E)', () => {
  it('BE1 — button is present on geotech axis when a geotech model exists', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
      }),
    )
    expect(screen.getByTestId('geotech-divide-boreholes')).toBeTruthy()
  })

  it('BE2 — button is disabled when activeGeotechModel is null', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: null,
      }),
    )
    expect(screen.getByTestId('geotech-divide-boreholes')).toBeDisabled()
  })

  it('BE3 — clicking the enabled button calls handleDivideBoreholes', () => {
    const handleDivideBoreholes = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'geotechnical',
        activeLithoModel: makeLithoModel(),
        activeGeotechModel: makeGeotechModel(),
        handleDivideBoreholes,
      }),
    )
    fireEvent.click(screen.getByTestId('geotech-divide-boreholes'))
    expect(handleDivideBoreholes).toHaveBeenCalled()
  })

  it('BE4 — button is absent on the geology axis', () => {
    renderToolbar(makeCtx({ sectionModelAxis: 'geological' }))
    expect(screen.queryByTestId('geotech-divide-boreholes')).toBeNull()
  })

  it('BE4b — button is absent on the lithostratigraphic axis', () => {
    renderToolbar(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
      }),
    )
    expect(screen.queryByTestId('geotech-divide-boreholes')).toBeNull()
  })
})
