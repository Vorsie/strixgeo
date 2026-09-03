// Behavioural net for the SectionsInspector ModelActions row (debt #97).
//
// Build / Sync geology / Seed / Seed-for-new-tests / Dedupe â€” moved here
// from the Sections toolbar per the owner directive 2026-05-22 ("model-
// management verbs leave the toolbar for the inspector").
//
// Pins:
//   M1  Build button renders + calls handleRebuildSurfaces.
//   M2  Geology axis: Seed button calls handleAutoPopulateFromStratigraphy
//       with the visible-borehole ids + the section's applyUpdatedSection
//       callback (regression for the #57 explicit-content callback drop).
//   M3  Litho axis: Sync geology calls handleLoadBackdropSurfaces with the
//       active litho model's parent geological model id; the autoPopulate
//       handler is NOT called (B6-litho moved from the old toolbar test).
//   M4  Seed-for-new-tests is hidden on the litho axis; visible + disabled
//       when newTestBoreholeIds is empty on the geology axis.
//   M5  Dedupe button confirms before it deletes: the click opens the dialog
//       (M5), Cancel runs nothing (M5b), only the confirm calls
//       handleDedupeContacts (M5c), and the dialog names the loss (M5d).
//   M6  Whole section is omitted when neither model is active.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  BoreholeListItem,
  FormationContactResponse,
  GeologicalModelResponse,
} from '../../../api/client'
import SectionsInspector from './SectionsInspector'

// ---------------------------------------------------------------------------
// Module mocks â€” same shape as SectionsToolbar.axis.test
// ---------------------------------------------------------------------------

vi.mock('../../../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
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
// Fixtures
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)

function makeGeoModel(): GeologicalModelResponse {
  return {
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
  }
}

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

function makeBorehole(id: string): BoreholeListItem {
  return {
    id,
    name: id,
    test_id: id,
    location_x: 0,
    location_y: 0,
    elevation_m: 5,
    epsg: 31370,
    z_epsg: 5710,
    elevation_source: 'manual',
    drill_method: null,
    borehole_type: null,
    total_depth_m: 10,
    start_date: null,
    n_drill_segments: null,
    n_field_log_intervals: null,
  }
}

function makeContact(id: string, boreholeId: string): FormationContactResponse {
  return {
    id,
    model_id: 'model-geo-1',
    formation_id: 'f-1',
    borehole_id: boreholeId,
    cpt_id: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    depth_top_m: 2,
    source: 'manual_pick' as const,
    confidence: 'high' as const,
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

interface CtxOverrides {
  axis?: 'geological' | 'lithostratigraphic'
  activeGeologicalModel?: GeologicalModelResponse | null
  activeLithoModel?: GeologicalModelResponse | null
  visibleBoreholes?: readonly BoreholeListItem[]
  contacts?: readonly FormationContactResponse[]
  selectedSectionId?: string | null
  staleSurfaceCount?: number
  applyUpdatedSection?: (updated: import('../../../api/client').CrossSectionResponse) => void
  handleRebuildSurfaces?: () => Promise<void>
  handleDedupeContacts?: () => Promise<number>
  handleAutoPopulateFromStratigraphy?: (
    boreholeIds: readonly string[],
    sectionId?: string | null,
    onSectionUpdated?: (updated: import('../../../api/client').CrossSectionResponse) => void,
  ) => Promise<void>
  handleLoadBackdropSurfaces?: (modelId: string) => Promise<void>
}

function makeCtx(o: CtxOverrides = {}): ShellContextValue {
  const activeGeologicalModel =
    o.activeGeologicalModel === undefined ? makeGeoModel() : o.activeGeologicalModel
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
    // ShellContext types these as mutable; the test helper accepts readonly
    // for ergonomics so we widen via spread.
    visibleBoreholes: o.visibleBoreholes ? [...o.visibleBoreholes] : [],
    geoModel: {
      activeGeologicalModel,
      models: [],
      activeLithoModel: o.activeLithoModel ?? null,
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
      contacts: o.contacts ? [...o.contacts] : [],
      surfacesByFormationId: new Map(),
      crossingsRefreshCounter: 0,
      staleSurfaceCount: o.staleSurfaceCount ?? 0,
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
      handleAutoPopulateFromStratigraphy:
        o.handleAutoPopulateFromStratigraphy ?? noopAsync,
      handleDedupeContacts: o.handleDedupeContacts ?? (() => Promise.resolve(0)),
      handleRebuildSurfaces: o.handleRebuildSurfaces ?? noopAsync,
      handleExportModelPlaxis3d: noopAsync,
      handleToggleBoreholeInModel: noopAsync,
      handleToggleBoreholeInLithoModel: noopAsync,
      discardContacts: vi.fn(),
      discoverBoreholeFormations: () =>
        Promise.resolve({ candidates: [], collisions: [] }),
      applyBoreholeFormationSelection: noopAsync,
      handleDeleteModel: noopAsync,
      ensureActiveGeologicalModel: () => Promise.resolve(null),
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
      handleLoadBackdropSurfaces: o.handleLoadBackdropSurfaces ?? noopAsync,
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
      selectedSectionId: o.selectedSectionId ?? null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: o.axis ?? 'geological',
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
      applyUpdatedSection: o.applyUpdatedSection ?? vi.fn(),
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

function renderInspector(ctx: ShellContextValue) {
  return render(
    <ShellContext.Provider value={ctx}>
      <SectionsInspector />
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

describe('SectionsInspector â€” Model actions (debt #97)', () => {
  it('M1 â€” Build button renders + calls handleRebuildSurfaces', async () => {
    const handleRebuild = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({ handleRebuildSurfaces: handleRebuild })
    renderInspector(ctx)
    const btn = screen.getByTestId('inspector-build')
    fireEvent.click(btn)
    await vi.waitFor(() => expect(handleRebuild).toHaveBeenCalledOnce())
  })

  it('M2 â€” Geology axis: Seed calls handleAutoPopulateFromStratigraphy with visible-borehole ids + applyUpdatedSection', async () => {
    const autoPopulate = vi.fn().mockResolvedValue(undefined)
    const applyUpdatedSection = vi.fn()
    const ctx = makeCtx({
      axis: 'geological',
      visibleBoreholes: [makeBorehole('bh-1'), makeBorehole('bh-2')],
      selectedSectionId: 'sec-1',
      handleAutoPopulateFromStratigraphy: autoPopulate,
      applyUpdatedSection,
    })
    renderInspector(ctx)
    fireEvent.click(screen.getByTestId('inspector-seed'))
    await vi.waitFor(() => expect(autoPopulate).toHaveBeenCalledOnce())
    expect(autoPopulate.mock.calls[0][0]).toEqual(['bh-1', 'bh-2'])
    expect(autoPopulate.mock.calls[0][1]).toBe('sec-1')
    // Regression: the section-update callback MUST be forwarded, else the
    // server-echoed seeded_formation_contact_ids is dropped and the
    // explicit-content filter hides every seeded contact (#57 class).
    expect(autoPopulate.mock.calls[0][2]).toBe(applyUpdatedSection)
  })

  it('M3 â€” Litho axis: Sync geology calls handleLoadBackdropSurfaces (not autoPopulate) with the parent geological model id', async () => {
    const loadBackdrop = vi.fn().mockResolvedValue(undefined)
    const autoPopulate = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      axis: 'lithostratigraphic',
      activeLithoModel: makeLithoModel(),
      handleLoadBackdropSurfaces: loadBackdrop,
      handleAutoPopulateFromStratigraphy: autoPopulate,
    })
    renderInspector(ctx)
    fireEvent.click(screen.getByTestId('inspector-sync-geology'))
    await vi.waitFor(() => {
      expect(loadBackdrop).toHaveBeenCalledOnce()
      expect(loadBackdrop).toHaveBeenCalledWith('model-geo-1')
      expect(autoPopulate).not.toHaveBeenCalled()
    })
  })

  it('M4a â€” Litho axis: Seed-for-new-tests is NOT rendered', () => {
    const ctx = makeCtx({
      axis: 'lithostratigraphic',
      activeLithoModel: makeLithoModel(),
    })
    renderInspector(ctx)
    expect(screen.queryByTestId('inspector-seed-new-tests')).toBeNull()
    expect(screen.queryByTestId('inspector-seed')).toBeNull()
  })

  it('M4b â€” Geology axis: Seed-for-new-tests is disabled when no new boreholes', () => {
    // Visible borehole bh-1 already has a contact â†’ newTestBoreholeIds empty.
    const ctx = makeCtx({
      axis: 'geological',
      visibleBoreholes: [makeBorehole('bh-1')],
      contacts: [makeContact('c-1', 'bh-1')],
    })
    renderInspector(ctx)
    const btn = screen.getByTestId('inspector-seed-new-tests')
    expect(btn).toBeDisabled()
  })

  it('M5 â€” Dedupe opens the confirmation and deletes nothing yet', () => {
    // Dedupe DB-deletes contacts and nothing restores them, so the verb has to
    // ask first here exactly as it does on the Geology toolbar. It used to call
    // the cleanup straight through on the first click.
    const dedupe = vi.fn().mockResolvedValue(0)
    const ctx = makeCtx({ handleDedupeContacts: dedupe })
    renderInspector(ctx)
    fireEvent.click(screen.getByTestId('inspector-dedupe'))
    expect(
      document.body.querySelector('[data-testid="dedupe-contacts-confirm-dialog"]'),
    ).not.toBeNull()
    expect(dedupe).not.toHaveBeenCalled()
  })

  it('M5b - cancelling the Dedupe confirmation deletes nothing', () => {
    const dedupe = vi.fn().mockResolvedValue(0)
    const ctx = makeCtx({ handleDedupeContacts: dedupe })
    renderInspector(ctx)
    fireEvent.click(screen.getByTestId('inspector-dedupe'))
    fireEvent.click(screen.getByTestId('dedupe-contacts-cancel'))
    expect(dedupe).not.toHaveBeenCalled()
    expect(
      document.body.querySelector('[data-testid="dedupe-contacts-confirm-dialog"]'),
    ).toBeNull()
  })

  it('M5c - confirming the Dedupe confirmation calls handleDedupeContacts', async () => {
    const dedupe = vi.fn().mockResolvedValue(0)
    const ctx = makeCtx({ handleDedupeContacts: dedupe })
    renderInspector(ctx)
    fireEvent.click(screen.getByTestId('inspector-dedupe'))
    fireEvent.click(screen.getByTestId('dedupe-contacts-confirm'))
    await vi.waitFor(() => expect(dedupe).toHaveBeenCalledOnce())
  })

  it('M5d - the confirmation says how many contacts the run will remove', () => {
    // Two picks of the same formation on bh-1, so one of them goes.
    const ctx = makeCtx({
      contacts: [makeContact('c-1', 'bh-1'), makeContact('c-2', 'bh-1')],
    })
    renderInspector(ctx)
    fireEvent.click(screen.getByTestId('inspector-dedupe'))
    const count = document.body.querySelector('[data-testid="dedupe-contacts-count"]')
    expect(count?.textContent).toContain('1 contact ')
  })

  it('M6 â€” Whole Model-actions section is omitted when neither model is active', () => {
    const ctx = makeCtx({ activeGeologicalModel: null, activeLithoModel: null })
    renderInspector(ctx)
    expect(screen.queryByTestId('inspector-build')).toBeNull()
    expect(screen.queryByTestId('inspector-dedupe')).toBeNull()
  })
})

