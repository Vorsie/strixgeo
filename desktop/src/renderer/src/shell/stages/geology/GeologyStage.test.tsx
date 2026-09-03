// Smoke test for the Geology stage components (GeologyToolbar, GeologyInspector).
//
// Mirrors SectionsStage.test.tsx.  Mounts the two Geology zone components with
// a stub ShellContext to catch:
//   * TDZ crashes (in particular the reorderFormations â†' visibleFormations
//     ordering constraint documented in geology-stage-architecture.md Â§8.1 Risk 3)
//   * Missing imports
//   * Render-time throws from stale deps or bad JSX
//
// Scope: smoke-render only.  Behavioural correctness is covered by the
// backend unit tests and future integration tests.

import { render, cleanup, screen, fireEvent, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import GeologyToolbar from './GeologyToolbar'
import GeologyInspector from './GeologyInspector'

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        // GeologyInspector fetches crossings on mount.
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        // PATCH path exercised by the colour-swatch override (and any other
        // formation-row inline edit). Returns the (mutated) row that the
        // caller passed in — tests override per-case via mockImplementation.
        updateFormation: vi.fn(),
      },
    },
  }
})

// FormationDialog is a form modal; stub it so the inspector doesn't need
// the full dialog tree to pass the smoke render.
vi.mock('../../../components/interpretation/FormationDialog', () => ({
  default: () => null,
}))

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
      // G1 additions
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
// Test helpers
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

describe('Geology stage (smoke)', () => {
  it('GeologyToolbar renders without throwing', () => {
    const ctx = makeStubContext()
    render(
      <ShellContext.Provider value={ctx}>
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('GeologyInspector renders without throwing (TDZ check)', () => {
    // This test exercises the reorderFormations â†' visibleFormations ordering
    // constraint from geology-stage-architecture.md Â§8.1 Risk 3.  If TDZ
    // fires, React will throw during the render phase and consoleError will
    // receive the error.
    const ctx = makeStubContext()
    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('GeologyInspector renders formation list without throwing', () => {
    const ctx = makeStubContext()
    const formation = {
      id: 'form-1',
      app_project_id: 'proj-1',
      name: 'Boom Klei',
      color: '#b45309',
      code: null,
      regional_ref: 'BmKi',
      description: null,
      display_order: 0,
      pinned_order: false,
      lithology: null,
      nad_class: null,
      parent_formation_id: null,
      litho_main_soil_code: null,
      litho_admixtures: null,
      instance_ordinal: null,
      instance_ordinal_locked: false,
      parent_formation_name: null,
      parent_extrapolated: false,
      source_litho_formation_id: null,
      source_geo_formation_id: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    ctx.geoModel.formations = [formation]
    // visibleFormations mirrors formations when all are in the manifest.
    // This is the shared bus value that the inspector reads (Fix 3).
    ctx.geoModel.visibleFormations = [formation]
    ctx.coordinator.manifestFormationIds = new Set(['form-1'])
    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    // Formation name must appear in the list.
    expect(screen.getByText('Boom Klei')).toBeTruthy()
  })

  it('GeologyInspector shows 0 formations when manifest is empty (post-delete)', () => {
    // Guards Fix 3: after Delete model, visibleFormations = [] even when
    // formations list has stale entries. The inspector renders no rows.
    const ctx = makeStubContext()
    ctx.geoModel.formations = [
      {
        id: 'form-1',
        app_project_id: 'proj-1',
        name: 'Boom Klei',
        color: '#b45309',
        code: null,
        regional_ref: null,
        description: null,
        display_order: 0,
        pinned_order: false,
        lithology: null,
        nad_class: null,
        parent_formation_id: null,
        litho_main_soil_code: null,
        litho_admixtures: null,
        instance_ordinal: null,
        instance_ordinal_locked: false,
        parent_formation_name: null,
        parent_extrapolated: false,
        source_litho_formation_id: null,
        source_geo_formation_id: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ]
    // manifest is empty → visibleFormations is empty on the bus
    ctx.geoModel.visibleFormations = []
    ctx.coordinator.manifestFormationIds = new Set()
    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    // Formation must NOT appear â€” the bus visible list is empty.
    expect(screen.queryByText('Boom Klei')).toBeNull()
  })

  // C-3: initial discover carries the persisted alias map so the dialog
  // opens already-consistent (no ~300 ms wrong-state window).
  describe('GeologyToolbar handleFillFromBoreholes â€” initial discover carries persisted map', () => {
    it('calls discoverBoreholeFormations WITHOUT a map when currentLumping is null', async () => {
      const ctx = makeStubContext()
      // A borehole is required for the Fill button to be enabled.
      ctx.visibleBoreholes = [
        {
          id: 'bh-1',
          name: 'BH-1',
          test_id: 'BH-001',
          location_x: 0,
          location_y: 0,
          epsg: 31370,
          elevation_m: null,
          z_epsg: null,
          elevation_source: 'none',
          drill_method: null,
          borehole_type: null,
          total_depth_m: null,
          start_date: null,
          n_drill_segments: null,
          n_field_log_intervals: null,
        },
      ]
      // currentLumping is null â†' no map passed
      ctx.lifecycle.currentLumping = null
      const discoverSpy = vi.fn().mockResolvedValue({ candidates: [], collisions: [] })
      ctx.geoModel.discoverBoreholeFormations = discoverSpy

      render(
        <ShellContext.Provider value={ctx}>
          <GeologyToolbar />
        </ShellContext.Provider>,
      )
      const fillBtn = screen.getByTitle(
        'Discover formation names from borehole stratigraphy and select which to keep',
      )
      await act(async () => {
        fireEvent.click(fillBtn)
      })

      // First positional arg = boreholeIds, second = manualMap (must be undefined).
      expect(discoverSpy).toHaveBeenCalledTimes(1)
      expect(discoverSpy).toHaveBeenCalledWith(['bh-1'], undefined)
    })

    it('calls discoverBoreholeFormations WITH the persisted map when currentLumping is non-empty', async () => {
      const ctx = makeStubContext()
      ctx.visibleBoreholes = [
        {
          id: 'bh-1',
          name: 'BH-1',
          test_id: 'BH-001',
          location_x: 0,
          location_y: 0,
          epsg: 31370,
          elevation_m: null,
          z_epsg: null,
          elevation_source: 'none',
          drill_method: null,
          borehole_type: null,
          total_depth_m: null,
          start_date: null,
          n_drill_segments: null,
          n_field_log_intervals: null,
        },
      ]
      const persistedMap: Record<string, string> = { 'boom klei': 'Quartair' }
      ctx.lifecycle.currentLumping = {
        schema_version: 1,
        applied_at: '2026-05-17T10:00:00.000Z',
        map: persistedMap,
      }
      const discoverSpy = vi.fn().mockResolvedValue({ candidates: [], collisions: [] })
      ctx.geoModel.discoverBoreholeFormations = discoverSpy

      render(
        <ShellContext.Provider value={ctx}>
          <GeologyToolbar />
        </ShellContext.Provider>,
      )
      const fillBtn = screen.getByTitle(
        'Discover formation names from borehole stratigraphy and select which to keep',
      )
      await act(async () => {
        fireEvent.click(fillBtn)
      })

      // The persisted map must be forwarded as the second arg so the server
      // computes candidates + collisions with the aliases already applied.
      expect(discoverSpy).toHaveBeenCalledTimes(1)
      expect(discoverSpy).toHaveBeenCalledWith(['bh-1'], persistedMap)
    })
  })

  describe('GeologyToolbar Delete model confirm modal', () => {
    function renderWithModel() {
      const ctx = makeStubContext()
      ctx.geoModel.activeGeologicalModel = {
        id: 'model-1',
        app_project_id: 'proj-1',
        name: 'Default',
        description: null,
        kind: 'geological',
        parent_model_id: null,
        is_active: true,
        excluded_borehole_ids: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }
      return ctx
    }

    it('opens the confirm modal when Delete model is clicked', () => {
      const ctx = renderWithModel()
      render(
        <ShellContext.Provider value={ctx}>
          <GeologyToolbar />
        </ShellContext.Provider>,
      )
      expect(screen.queryByRole('dialog')).toBeNull()
      // The Delete model button carries the danger title.
      const deleteBtn = screen.getByTitle(
        'Permanently delete the active geological model and all its formations, contacts, and surfaces',
      )
      fireEvent.click(deleteBtn)
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(
        screen.getByRole('heading', { name: /delete geological model/i }),
      ).toBeTruthy()
    })

    it('does NOT call handleDeleteModel when Cancel is clicked', () => {
      const ctx = renderWithModel()
      const handleDeleteModel = vi.fn().mockResolvedValue(undefined)
      ctx.geoModel.handleDeleteModel = handleDeleteModel
      render(
        <ShellContext.Provider value={ctx}>
          <GeologyToolbar />
        </ShellContext.Provider>,
      )
      const deleteBtn = screen.getByTitle(
        'Permanently delete the active geological model and all its formations, contacts, and surfaces',
      )
      fireEvent.click(deleteBtn)
      expect(screen.getByRole('dialog')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(handleDeleteModel).not.toHaveBeenCalled()
    })

    it('calls handleDeleteModel when "Delete geological model" is confirmed', () => {
      const ctx = renderWithModel()
      const handleDeleteModel = vi.fn().mockResolvedValue(undefined)
      ctx.geoModel.handleDeleteModel = handleDeleteModel
      render(
        <ShellContext.Provider value={ctx}>
          <GeologyToolbar />
        </ShellContext.Provider>,
      )
      const deleteBtn = screen.getByTitle(
        'Permanently delete the active geological model and all its formations, contacts, and surfaces',
      )
      fireEvent.click(deleteBtn)
      const confirmBtn = screen.getAllByRole('button', {
        name: /delete geological model/i,
      })[0]
      fireEvent.click(confirmBtn)
      expect(handleDeleteModel).toHaveBeenCalledTimes(1)
    })
  })
})

// ---------------------------------------------------------------------------
// GeologyInspector model-axis-aware filter (#55 litho-Seed slice)
// ---------------------------------------------------------------------------

describe('GeologyInspector axis-aware formation filter (#55 litho-Seed)', () => {
  const makeFormation = (
    id: string,
    name: string,
    order: number,
  ): import('../../../api/client').GeologicalFormationResponse => ({
    id,
    app_project_id: 'proj-1',
    name,
    color: '#aaa',
    code: null,
    regional_ref: null,
    description: null,
    display_order: order,
    pinned_order: false,
    lithology: null,
    nad_class: null,
    // Phase 1 litho-builder fields â€” null on geological-model rows.
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })

  const makeContact = (
    formationId: string,
  ): import('../../../api/client').FormationContactResponse => ({
    id: `contact-${formationId}`,
    model_id: 'litho-model-1',
    formation_id: formationId,
    borehole_id: 'bh-1',
    cpt_id: null,
    depth_top_m: 1.0,
    source: 'geological_model_seed',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })

  it('B7-geo â€” on geological axis all visible formations are shown', () => {
    const ctx = makeStubContext()
    const f1 = makeFormation('f-1', 'Formation A', 0)
    const f2 = makeFormation('f-2', 'Formation B', 1)
    ctx.geoModel.visibleFormations = [f1, f2]
    ctx.geoModel.lithoContacts = []
    ctx.sections.sectionModelAxis = 'geological'

    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )

    expect(screen.getByText('Formation A')).toBeTruthy()
    expect(screen.getByText('Formation B')).toBeTruthy()
  })

  it('B7-litho â€” on litho axis only formations with â‰¥1 litho contact are shown', () => {
    const ctx = makeStubContext()
    const f1 = makeFormation('f-1', 'Formation A', 0) // has a litho contact
    const f2 = makeFormation('f-2', 'Formation B', 1) // no litho contact
    ctx.geoModel.visibleFormations = [f1, f2]
    ctx.geoModel.lithoContacts = [makeContact('f-1')]
    ctx.sections.sectionModelAxis = 'lithostratigraphic'

    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )

    expect(screen.getByText('Formation A')).toBeTruthy()
    expect(screen.queryByText('Formation B')).toBeNull()
  })

  it('B7-litho-empty â€” on litho axis with no contacts the list is empty', () => {
    const ctx = makeStubContext()
    const f1 = makeFormation('f-1', 'Formation A', 0)
    ctx.geoModel.visibleFormations = [f1]
    ctx.geoModel.lithoContacts = []
    ctx.sections.sectionModelAxis = 'lithostratigraphic'

    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )

    expect(screen.queryByText('Formation A')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// GeologyInspector formation colour-swatch click-to-override
//
// Spec: docs/superpowers/specs/2026-05-30-formation-color-swatch-override-design.md
//
// The swatch is a label wrapping a hidden native <input type="color">.
// onChange updates only local state (pendingColor); onBlur is the commit
// point. Each behavioural rule below pins one branch of that contract.
// ---------------------------------------------------------------------------

describe('GeologyInspector colour-swatch override (2026-05-30 spec)', () => {
  const SWATCH_FORMATION_ID = 'form-color-1'

  const makeColorFormation = (
    color: string,
  ): import('../../../api/client').GeologicalFormationResponse => ({
    id: SWATCH_FORMATION_ID,
    app_project_id: 'proj-1',
    name: 'Boom Klei',
    color,
    code: null,
    regional_ref: null,
    description: null,
    display_order: 0,
    pinned_order: false,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })

  function mountWithFormation(
    f: import('../../../api/client').GeologicalFormationResponse,
  ): { undoPush: ReturnType<typeof vi.fn>; formationUpdated: ReturnType<typeof vi.fn> } {
    const ctx = makeStubContext()
    ctx.geoModel.formations = [f]
    ctx.geoModel.visibleFormations = [f]
    ctx.coordinator.manifestFormationIds = new Set([f.id])
    const formationUpdated = vi.fn()
    ctx.geoModel.handleFormationUpdated = formationUpdated
    const undoPush = vi.fn()
    ctx.undo.push = undoPush
    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )
    return { undoPush, formationUpdated }
  }

  /**
   * Resolve the colour ``<input>`` for the test formation.
   * The element has ``sr-only`` styling so it isn't queryable by role.
   */
  function colorInput(): HTMLInputElement {
    const el = document.querySelector(
      `[data-testid="geology-formation-color-input-${SWATCH_FORMATION_ID}"]`,
    )
    if (!(el instanceof HTMLInputElement)) {
      throw new Error('colour input not found')
    }
    return el
  }

  it('CSW1 — swatch input renders the formation colour', () => {
    mountWithFormation(makeColorFormation('#b45309'))
    expect(colorInput().value).toBe('#b45309')
  })

  it('CSW2 — onChange alone (no blur) fires NO PATCH', async () => {
    const { api: apiClient } = await import('../../../api/client')
    const updateFormation = vi.mocked(apiClient.geology.updateFormation)
    updateFormation.mockClear()
    mountWithFormation(makeColorFormation('#b45309'))

    fireEvent.change(colorInput(), { target: { value: '#22c55e' } })

    expect(updateFormation).not.toHaveBeenCalled()
  })

  it('CSW3 — blur after a real change PATCHes, refreshes the bus, and pushes one undo command', async () => {
    const { api: apiClient } = await import('../../../api/client')
    const updateFormation = vi.mocked(apiClient.geology.updateFormation)
    updateFormation.mockClear()
    updateFormation.mockResolvedValue({
      ...makeColorFormation('#22c55e'),
    })
    const { undoPush, formationUpdated } = mountWithFormation(
      makeColorFormation('#b45309'),
    )

    fireEvent.change(colorInput(), { target: { value: '#22c55e' } })
    await act(async () => {
      fireEvent.blur(colorInput())
    })

    expect(updateFormation).toHaveBeenCalledTimes(1)
    expect(updateFormation).toHaveBeenCalledWith(
      'proj-1',
      SWATCH_FORMATION_ID,
      { color: '#22c55e' },
    )
    expect(formationUpdated).toHaveBeenCalled()
    expect(undoPush).toHaveBeenCalledTimes(1)
    const cmd = undoPush.mock.calls[0][0] as {
      description: string
      revert: () => Promise<void>
      reapply: () => Promise<void>
    }
    expect(cmd.description).toBe('Recolor formation')
  })

  it('CSW4 — blur with the SAME colour as formation.color is a no-op', async () => {
    const { api: apiClient } = await import('../../../api/client')
    const updateFormation = vi.mocked(apiClient.geology.updateFormation)
    updateFormation.mockClear()
    const { undoPush } = mountWithFormation(makeColorFormation('#b45309'))

    fireEvent.change(colorInput(), { target: { value: '#b45309' } })
    await act(async () => {
      fireEvent.blur(colorInput())
    })

    expect(updateFormation).not.toHaveBeenCalled()
    expect(undoPush).not.toHaveBeenCalled()
  })

  it('CSW5 — blur without any onChange (Esc-cancel) fires NO PATCH', async () => {
    const { api: apiClient } = await import('../../../api/client')
    const updateFormation = vi.mocked(apiClient.geology.updateFormation)
    updateFormation.mockClear()
    const { undoPush } = mountWithFormation(makeColorFormation('#b45309'))

    await act(async () => {
      fireEvent.blur(colorInput())
    })

    expect(updateFormation).not.toHaveBeenCalled()
    expect(undoPush).not.toHaveBeenCalled()
  })

  it('CSW6 — the undo command revert PATCHes back to the previous colour', async () => {
    const { api: apiClient } = await import('../../../api/client')
    const updateFormation = vi.mocked(apiClient.geology.updateFormation)
    updateFormation.mockClear()
    // Both the initial PATCH and the revert PATCH go through the same mock;
    // returning the requested colour back on each call keeps the bus state
    // consistent for whichever path the test triggers.
    updateFormation.mockImplementation(async (_pid, _fid, body) => ({
      ...makeColorFormation(body.color ?? '#b45309'),
    }))
    const { undoPush } = mountWithFormation(makeColorFormation('#b45309'))

    fireEvent.change(colorInput(), { target: { value: '#22c55e' } })
    await act(async () => {
      fireEvent.blur(colorInput())
    })

    expect(undoPush).toHaveBeenCalledTimes(1)
    const cmd = undoPush.mock.calls[0][0] as {
      revert: () => Promise<void>
    }
    updateFormation.mockClear()
    await act(async () => {
      await cmd.revert()
    })
    expect(updateFormation).toHaveBeenCalledWith(
      'proj-1',
      SWATCH_FORMATION_ID,
      { color: '#b45309' },
    )
  })
})
