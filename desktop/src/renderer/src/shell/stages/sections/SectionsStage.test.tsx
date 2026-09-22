// Smoke test for the Sections stage components (SectionsCanvas,
// SectionsToolbar, SectionsInspector).
//
// The App.smoke.test.tsx only mounts App with project=null — it never reaches
// the loaded-project Sections render (WelcomeScreen appears before AppShell
// mounts).  This test exercises the three Sections zone components with a
// stub ShellContext to catch TDZ crashes, missing imports, and render-time
// throws that the main smoke test cannot reach.
//
// Scope: smoke-render only.  Behavioural correctness (does clicking "New"
// actually create a section?) is covered by integration tests.

import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import SectionsToolbar from './SectionsToolbar'
import SectionsInspector from './SectionsInspector'

// ---------------------------------------------------------------------------
// Module-level mocks — keep the component tree from touching the network or
// Leaflet (Leaflet needs a real DOM; jsdom is incomplete for map rendering).
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

// MapView imports Leaflet which crashes in jsdom.  Replace with a null render.
vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

// SectionPanel is a complex component with its own data-fetch hook.
// Replace with a null render to keep the smoke test focused on the
// SectionsCanvas wiring, not SectionPanel's internal behaviour.
vi.mock('../../../components/SectionPanel', () => ({
  default: () => null,
}))

// VirtueleBoringStrip fetches the catalog on mount — stub it.
vi.mock('../../../components/sections/VirtueleBoringStrip', () => ({
  default: () => null,
}))

// ---------------------------------------------------------------------------
// Minimal ShellContext stub — all leaf values needed to render the three
// Sections stage components without throwing.  Optional / unused slices
// default to stable empty values so any future useShell() read in a
// newly-added component doesn't need a stub update.
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)

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
      discoverBoreholeFormations: async () => ({ candidates: [], collisions: [] }),
      applyBoreholeFormationSelection: noopAsync,
      handleDeleteModel: noopAsync,
      ensureActiveGeologicalModel: async () => null,
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
      handleAcceptLithoSuggestion: noopAsyncNull,
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

describe('Sections stage (smoke)', () => {
  it('SectionsCanvas renders without throwing when no section is selected', () => {
    const ctx = makeStubContext()
    // selectedSectionId = null → map fallback branch (MapView is mocked)
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('SectionsCanvas renders without throwing when a section is selected', () => {
    const ctx = makeStubContext()
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
      seeded_formation_contact_ids: [],
      min_depth_m: null,
      max_depth_m: null,
      display_order: 0,
      view_state: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    ctx.sections.sections = [section]
    ctx.sections.selectedSectionId = 'sec-1'
    // SectionPanel is mocked — the render path just confirms the
    // selectedSection branch reaches SectionPanel without throwing.
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('SectionsToolbar renders without throwing', () => {
    const ctx = makeStubContext()
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsToolbar />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('SectionsInspector renders without throwing', () => {
    const ctx = makeStubContext()
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsInspector />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('SectionsInspector count matches badge — both read visibleSections.length', () => {
    // Pins the Fix 1 convergence: badge (SectionsStage.ts) and inspector
    // (SectionsInspector.tsx) must both compute their count from
    // sections.visibleSections, not the unfiltered sections list.
    //
    // Set up: DB has 2 sections, but only 1 is in the .gmproj manifest
    // (i.e. visibleSections.length === 1).  The inspector must show "(1)"
    // in the section-list header, not "(2)" from the raw list.
    const ctx = makeStubContext()
    const sectionA = {
      id: 'sec-visible',
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
      seeded_formation_contact_ids: [],
      min_depth_m: null,
      max_depth_m: null,
      display_order: 0,
      view_state: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const sectionB = { ...sectionA, id: 'sec-not-in-manifest', name: 'Section B-B', display_order: 1 }
    // sections = 2 (raw DB list), visibleSections = 1 (manifest-gated)
    ctx.sections.sections = [sectionA, sectionB]
    ctx.sections.visibleSections = [sectionA]

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsInspector />
      </ShellContext.Provider>,
    )
    expect(consoleErrorSpy).not.toHaveBeenCalled()
    // Inspector header shows "(1)" — the visible count, not "(2)" from the raw list.
    expect(screen.getByText('(1)')).toBeTruthy()
    // The invisible section must not appear in the list.
    expect(screen.queryByText('Section B-B')).toBeNull()
    // The visible section must appear.
    expect(screen.getByText('Section A-A')).toBeTruthy()
  })

  // Delete confirm modal — replaced window.confirm() with Modal pattern.
  // Three paths: open, confirm (deletes), cancel (no delete).
  describe('SectionsToolbar delete confirm modal', () => {
    function renderWithSection() {
      const ctx = makeStubContext()
      const section = {
        id: 'sec-del',
        app_project_id: 'proj-1',
        name: 'Section B-B',
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
        seeded_formation_contact_ids: [],
        min_depth_m: null,
        max_depth_m: null,
        display_order: 0,
        view_state: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      }
      ctx.sections.sections = [section]
      ctx.sections.selectedSectionId = 'sec-del'
      return { ctx, section }
    }

    it('opens the confirm modal when the Delete button is clicked', () => {
      const { ctx } = renderWithSection()
      render(
        <ShellContext.Provider value={ctx}>
          <SectionsToolbar />
        </ShellContext.Provider>,
      )
      // Before clicking: no modal
      expect(screen.queryByRole('dialog')).toBeNull()
      // Click the Delete toolbar button
      const deleteBtn = screen.getByTitle('Delete "Section B-B"')
      fireEvent.click(deleteBtn)
      // Modal should now be open — confirm by dialog role and the heading text.
      expect(screen.getByRole('dialog')).toBeTruthy()
      expect(screen.getByRole('heading', { name: /delete cross-section/i })).toBeTruthy()
    })

    it('does NOT call handleDeleteSection when Cancel is clicked', () => {
      const { ctx } = renderWithSection()
      const handleDeleteSection = vi.fn().mockResolvedValue(undefined)
      ctx.sections.handleDeleteSection = handleDeleteSection
      render(
        <ShellContext.Provider value={ctx}>
          <SectionsToolbar />
        </ShellContext.Provider>,
      )
      fireEvent.click(screen.getByTitle('Delete "Section B-B"'))
      expect(screen.getByRole('dialog')).toBeTruthy()
      fireEvent.click(screen.getByRole('button', { name: /cancel/i }))
      // Modal closed, no delete fired
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(handleDeleteSection).not.toHaveBeenCalled()
    })

    it('calls handleDeleteSection when "Delete cross-section" is clicked', async () => {
      const { ctx } = renderWithSection()
      const handleDeleteSection = vi.fn().mockResolvedValue(undefined)
      ctx.sections.handleDeleteSection = handleDeleteSection
      render(
        <ShellContext.Provider value={ctx}>
          <SectionsToolbar />
        </ShellContext.Provider>,
      )
      fireEvent.click(screen.getByTitle('Delete "Section B-B"'))
      // Click the destructive confirm button (labelled "Delete cross-section")
      const confirmBtn = screen.getAllByRole('button', { name: /delete cross-section/i })[0]
      fireEvent.click(confirmBtn)
      expect(handleDeleteSection).toHaveBeenCalledWith('sec-del')
    })
  })
})

