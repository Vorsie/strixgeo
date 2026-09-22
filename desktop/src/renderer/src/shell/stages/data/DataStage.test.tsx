// Smoke + consistency test for the Data stage components (DataStage,
// DataInspector).
//
// Pins that the Data badge (DataStage.ts → useDataStageSummary) and the
// Data inspector (DataInspector.tsx) both source their counts from the
// manifest-filtered ``visibleCpts`` / ``visibleBoreholes`` lists on the
// ShellContext bus.  This was already consistent before the Fix 1/2
// investigation — this test documents and guards the property so a future
// refactor cannot silently regress it.

import { render, cleanup, screen, fireEvent, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import DataInspector from './DataInspector'

// ---------------------------------------------------------------------------
// Minimal ShellContext stub
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)
const noopAsyncNullableModel =
  (): Promise<import('../../../api/client').GeologicalModelResponse | null> =>
    Promise.resolve(null)
const noopAsyncCandidates = (): Promise<{
  candidates: import('../../../hooks/useGeologicalModel').FormationCandidate[]
  collisions: import('../../../hooks/useGeologicalModel').LumpingCollision[]
}> => Promise.resolve({ candidates: [], collisions: [] })

function makeStubContext(): ShellContextValue {
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
      activeLithoModel: null,
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
      handleToggleBoreholeInLithoModel: noopAsync,
      discardContacts: vi.fn(),
      discoverBoreholeFormations: noopAsyncCandidates,
      applyBoreholeFormationSelection: noopAsync,
      handleDeleteModel: noopAsync,
      ensureActiveGeologicalModel: noopAsyncNullableModel,
      ghostsByAnchor: new Map(),
      // Recovery-only setter (docs/design/autosave-recovery.md §2, item 2).
      setGhostsByAnchor: vi.fn(),
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
      handleAcceptLithoSuggestion: () => Promise.resolve(null),
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      handleDeleteLithoModel: noopAsync,
      backdropSurfacesByFormationId: new Map(),
      handleLoadBackdropSurfaces: noopAsync,
      lithoSolids: [],
      startLithoBuild: async () => {},
      cancelLithoBuild: () => {},
      voxelBuildState: { status: 'idle' as const },
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
      geotechGaplessReport: null,
      // Debt #266 — geotech columns standing on litho that has since moved.
      staleLithoGeotechColumns: [],
      staleLithoGeotechColumnIds: new Set<string>(),
      staleLithoGeotechColumnCount: 0,
      unstampedGeotechColumnCount: 0,
      refreshGeotechLithoStaleness: vi.fn(),
      lithoStaleSurfaceCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      activeGeotechModel: null,
      geotechLayers: [],
      geotechLayersLoaded: true,
      geotechLayersVersion: 0,
      geotechContacts: [],
      geotechFormations: [],
      columnsNeedingRederive: [],
      handleCreateManualLithoGhost: vi.fn(),
      copyGhostColumn: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
      markMutated: vi.fn(),
      handleSubdivideAllBodies: noopAsync,
      handleDivideBoreholes: noopAsync,
      requestGeotechLayersRefetch: vi.fn(),
    },
    sections: {
      sections: [],
      selectedSectionId: null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: 'geological' as const,
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
    toasts: {
      toasts: [],
      toast: vi.fn(),
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
      parametersDeepLinkTarget: null,
      setParametersDeepLinkTarget: vi.fn(),
      selectedParameterUnit: null,
      setSelectedParameterUnit: vi.fn(),
      parametersActiveTab: 'per-test',
      setParametersActiveTab: vi.fn(),
      correlationEdgesRefetchNonce: 0,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: 0,
      requestBodyRecompute: vi.fn(),
    handleSelectWithoutView: vi.fn(),
    markMutated: vi.fn(),
    },
  }
}

// ---------------------------------------------------------------------------
// Test lifecycle
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Data stage (smoke + consistency)', () => {
  it('DataInspector renders without throwing when project is empty', () => {
    const ctx = makeStubContext()
    render(
      <ShellContext.Provider value={ctx}>
        <DataInspector />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('DataInspector count == badge — both read visibleCpts.length + visibleBoreholes.length', () => {
    // Pins the Fix 2 investigation result: badge (DataStage.ts) and inspector
    // (DataInspector.tsx) were ALREADY consistent — both read visibleCpts /
    // visibleBoreholes (manifest-filtered).  This test guards the property so
    // a future refactor cannot silently regress it.
    //
    // Set up: DB has 3 CPTs but only 2 are in the .gmproj manifest
    // (investigations.cpts.length = 3, visibleCpts.length = 2).
    // The inspector footer must show "2 CPTs", not "3 CPTs".
    const ctx = makeStubContext()
    const makeCpt = (id: string, name: string) => ({
      id,
      app_project_id: 'proj-1',
      name,
      cpt_type: 'CPTU' as const,
      location_x: 0,
      location_y: 0,
      location_epsg: 31370,
      epsg: 31370,
      z_epsg: 5710,
      elevation_m: null,
      elevation_source: 'dov',
      start_date: '2024-01-01',
      max_depth_m: 20,
      n_rows: 200,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    })
    const cpt1 = makeCpt('cpt-1', 'CPT-01')
    const cpt2 = makeCpt('cpt-2', 'CPT-02')
    const cpt3 = makeCpt('cpt-3', 'CPT-03')

    // Raw list has 3; manifest-filtered visible list has 2.
    ctx.investigations.cpts = [cpt1, cpt2, cpt3]
    ctx.visibleCpts = [cpt1, cpt2]

    render(
      <ShellContext.Provider value={ctx}>
        <DataInspector />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()

    // The footer text reads from visibleCpts.length (2), not cpts.length (3).
    expect(screen.getByText('2 CPTs')).toBeTruthy()
    // CPT-03 (not in visibleCpts) must not appear in the list.
    expect(screen.queryByText('CPT-03')).toBeNull()
    // CPT-01 and CPT-02 (in visibleCpts) must appear.
    expect(screen.getByText('CPT-01')).toBeTruthy()
    expect(screen.getByText('CPT-02')).toBeTruthy()
  })

  // R3 (debt #12): these two contracts used to live in Sidebar.test.tsx.
  // The multi-select / bulk-remove + removed-footer logic was copied
  // verbatim from Sidebar.tsx into DataInspector; porting the
  // load-bearing assertions here lets Sidebar.tsx + Sidebar.test.tsx be
  // deleted without losing user-visible coverage. The exhaustive
  // shift-range / mirror-deselect permutations from Sidebar.test are
  // deliberately NOT re-ported — identical copied logic, and the
  // bulk-bar→Remove integration below is the contract that actually
  // protects the user-facing behaviour.
  const makeCpt = (id: string, name: string) => ({
    id,
    app_project_id: 'proj-1',
    name,
    cpt_type: 'CPTU' as const,
    location_x: 0,
    location_y: 0,
    location_epsg: 31370,
    epsg: 31370,
    z_epsg: 5710,
    elevation_m: null,
    elevation_source: 'dov',
    start_date: '2024-01-01',
    max_depth_m: 20,
    n_rows: 200,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })

  it('multi-select reveals the bulk bar and Remove routes the set through handleRemoveCpts', () => {
    const ctx = makeStubContext()
    const cptA = makeCpt('a', 'CPT-A')
    const cptB = makeCpt('b', 'CPT-B')
    ctx.investigations.cpts = [cptA, cptB]
    ctx.visibleCpts = [cptA, cptB]
    const handleRemoveCpts = vi.fn()
    ctx.investigations.handleRemoveCpts = handleRemoveCpts

    render(
      <ShellContext.Provider value={ctx}>
        <DataInspector />
      </ShellContext.Provider>,
    )
    // No bulk bar until something is checked.
    expect(screen.queryByText(/selected/i)).toBeNull()

    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    expect(screen.getByText(/1 selected/i)).toBeTruthy()

    const bar = screen.getByText(/1 selected/i).parentElement!
    fireEvent.click(within(bar).getByText(/^Remove$/i))
    expect(handleRemoveCpts).toHaveBeenCalledTimes(1)
    expect(new Set(handleRemoveCpts.mock.calls[0][0])).toEqual(new Set(['a']))
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('removed-count footer + restore-all appears for removed CPTs and routes to handleRestoreAllCpts', () => {
    const ctx = makeStubContext()
    const cptA = makeCpt('a', 'CPT-A')
    ctx.investigations.cpts = [cptA]
    ctx.visibleCpts = [cptA]
    ctx.investigations.removedCptIds = new Set(['gone-1', 'gone-2'])
    const handleRestoreAllCpts = vi.fn()
    ctx.investigations.handleRestoreAllCpts = handleRestoreAllCpts

    render(
      <ShellContext.Provider value={ctx}>
        <DataInspector />
      </ShellContext.Provider>,
    )
    const restore = screen.getByText(/2 removed · restore all/i)
    expect(restore).toBeTruthy()
    fireEvent.click(restore)
    expect(handleRestoreAllCpts).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})

