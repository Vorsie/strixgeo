// Behavioral net for the "Reset manual points" verb in SectionsToolbar.
//
// The owner asked for a bulk reset of every hand-drawn body-boundary override
// (the leftover manual points that bend boundaries off the engine default and
// leave gap wedges). It lives in the litho-axis "Bodies" dropdown and — being
// an irreversible DB delete — is gated by a ConfirmDialog (default-focus
// Cancel, action-named danger button, per docs/ux.md).
//
// Pinned claims:
//   BR1  The "Reset manual points" item renders in the Bodies dropdown on the
//        litho axis.
//   BR2  The item is absent on the geology axis (litho-only body action).
//   BR3  Clicking it OPENS the confirm dialog and does NOT call the API yet.
//   BR4  Cancel closes the dialog WITHOUT calling resetManualBoundaries.
//   BR5  Confirming ("Reset points") calls resetManualBoundaries(project, model)
//        and then bumps the correlation-edges refetch (which re-fetches
//        boundaries so the overlay re-renders from the engine default).
//   BR6  The confirm dialog default-focuses Cancel (safe default).

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { GeologicalModelResponse } from '../../../api/client'
import { api } from '../../../api/client'
import SectionsToolbar from './SectionsToolbar'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        resetManualBoundaries: vi.fn().mockResolvedValue({ shapes_deleted: 7 }),
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

function makeLithoModel(): GeologicalModelResponse {
  return {
    id: 'model-litho-1',
    app_project_id: 'proj-1',
    name: 'Litho model',
    description: null,
    kind: 'lithostratigraphic',
    parent_model_id: 'model-geo-1',
    is_active: true,
    excluded_borehole_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeCtx(overrides: {
  activeLithoModel?: GeologicalModelResponse | null
  sectionModelAxis?: 'geological' | 'lithostratigraphic' | 'geotechnical'
  requestCorrelationEdgesRefetch?: () => void
} = {}): ShellContextValue {
  const noopAsync = (): Promise<void> => Promise.resolve()
  const noopAsyncNull = (): Promise<null> => Promise.resolve(null)
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
        parent_model_id: null,
        is_active: true,
        excluded_borehole_ids: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      models: [],
      activeLithoModel: overrides.activeLithoModel ?? null,
      activeGeotechModel: null,
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
      // Debt #266 — geotech columns standing on litho that has since moved.
      staleLithoGeotechColumns: [],
      staleLithoGeotechColumnIds: new Set<string>(),
      staleLithoGeotechColumnCount: 0,
      unstampedGeotechColumnCount: 0,
      refreshGeotechLithoStaleness: vi.fn(),
      // The geometric half of that same answer — read at RENDER time since #266.
      columnsNeedingRederive: [],
      lithoStaleSurfaceCount: 0,
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
      handleSubdivideAllBodies: noopAsync,
      handleDivideBoreholes: noopAsync,
      requestGeotechLayersRefetch: vi.fn(),
      requestCorrelationEdgesRefetch: overrides.requestCorrelationEdgesRefetch ?? vi.fn(),
    },
    sections: {
      sections: [],
      selectedSectionId: null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: overrides.sectionModelAxis ?? 'lithostratigraphic',
      setSectionModelAxis: vi.fn(),
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
      correlateMode: false,
      correlationSource: null,
      enterCorrelateMode: vi.fn(),
      exitCorrelateMode: vi.fn(),
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
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: 0,
      requestBodyRecompute: vi.fn(),
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

// Open the Bodies dropdown so its items are in the DOM.
function openBodiesDropdown(): void {
  fireEvent.click(screen.getByTestId('litho-bodies-dropdown'))
}

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.clearAllMocks()
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
})

describe('SectionsToolbar "Reset manual points" verb', () => {
  it('BR1 — the item renders in the Bodies dropdown on the litho axis', () => {
    renderToolbar(makeCtx({ activeLithoModel: makeLithoModel() }))
    openBodiesDropdown()
    expect(screen.getByTestId('litho-reset-manual-points')).toBeTruthy()
  })

  it('BR2 — the item is absent on the geology axis (litho-only action)', () => {
    renderToolbar(makeCtx({ sectionModelAxis: 'geological', activeLithoModel: makeLithoModel() }))
    // The whole Bodies dropdown is litho-only, so the trigger itself is absent.
    expect(screen.queryByTestId('litho-bodies-dropdown')).toBeNull()
    expect(screen.queryByTestId('litho-reset-manual-points')).toBeNull()
  })

  it('BR3 — clicking the item opens the confirm dialog and does NOT call the API yet', () => {
    const resetMock = api.geology.resetManualBoundaries as ReturnType<typeof vi.fn>
    renderToolbar(makeCtx({ activeLithoModel: makeLithoModel() }))
    openBodiesDropdown()
    expect(screen.queryByTestId('reset-manual-points-dialog')).toBeNull()
    fireEvent.click(screen.getByTestId('litho-reset-manual-points'))
    expect(screen.getByTestId('reset-manual-points-dialog')).toBeTruthy()
    expect(resetMock).not.toHaveBeenCalled()
  })

  it('BR4 — Cancel closes the dialog without calling resetManualBoundaries', () => {
    const resetMock = api.geology.resetManualBoundaries as ReturnType<typeof vi.fn>
    renderToolbar(makeCtx({ activeLithoModel: makeLithoModel() }))
    openBodiesDropdown()
    fireEvent.click(screen.getByTestId('litho-reset-manual-points'))
    fireEvent.click(screen.getByTestId('reset-manual-points-cancel'))
    expect(screen.queryByTestId('reset-manual-points-dialog')).toBeNull()
    expect(resetMock).not.toHaveBeenCalled()
  })

  it('BR5 — confirming calls resetManualBoundaries then bumps the boundary refetch', async () => {
    const resetMock = api.geology.resetManualBoundaries as ReturnType<typeof vi.fn>
    const requestCorrelationEdgesRefetch = vi.fn()
    renderToolbar(
      makeCtx({ activeLithoModel: makeLithoModel(), requestCorrelationEdgesRefetch }),
    )
    openBodiesDropdown()
    fireEvent.click(screen.getByTestId('litho-reset-manual-points'))
    fireEvent.click(screen.getByTestId('reset-manual-points-confirm'))
    await waitFor(() => expect(resetMock).toHaveBeenCalledTimes(1))
    expect(resetMock).toHaveBeenCalledWith('proj-1', 'model-litho-1')
    await waitFor(() => expect(requestCorrelationEdgesRefetch).toHaveBeenCalledTimes(1))
  })

  it('BR6 — the confirm dialog default-focuses Cancel (safe default)', () => {
    renderToolbar(makeCtx({ activeLithoModel: makeLithoModel() }))
    openBodiesDropdown()
    fireEvent.click(screen.getByTestId('litho-reset-manual-points'))
    expect(document.activeElement).toBe(screen.getByTestId('reset-manual-points-cancel'))
  })
})
