// Behavioral net for LithologyCanvas (Slice D, #55 peer-stage scaffolding).
//
// Claims pinned here:
//   C1  When hasLithoSolids is false → EmptyState renders; Geology3DViewer
//       does NOT mount.  Surfaces being present (vertices or not) is
//       irrelevant — only solids gate the pane.
//   C1b Surfaces map with vertices present but hasLithoSolids=false →
//       still EmptyState (surfaces alone no longer mount the pane).
//   C2  When hasLithoSolids is true → Geology3DViewer mounts; EmptyState
//       does NOT render.
//   C9  In Solid mode, api.geology.listLithoSolids is called with the
//       correct projectId + modelId.
//   C10 Clicking "Build solids" calls api.geology.buildVoxelLithoModel and
//       toasts the result; the nonce bump causes listLithoSolids re-fetch.
//   C11 The stale badge is shown when any solid has is_stale = true.
//
// Geology3DViewer is mocked as a bare <div data-testid="geology-3d-viewer">
// to avoid the Cesium / WebGL harness (same pattern as the existing
// debt #41 part-a discussion).

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import { api } from '../../../api/client'
import type {
  BoreholeListItem,
  CptListItem,
  CrossSectionResponse,
  FormationSurfaceResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoBodySolidResponse,
  LithoContactCorrelationEdge,
  LithoLayerResponse,
  RebuildLithoSolidsResponse,
} from '../../../api/client'
import LithologyCanvas, {
  resetLithoSplitViewportCallback,
  lithoVoxelRequestCallback,
  lithoFenceExportCallback,
} from './LithologyCanvas'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Geology3DViewer imports Cesium and WebGL — mock it as a sentinel div.
// The div mirrors the bodySolidsWireframe prop into a data-attribute so the
// wireframe-toggle test can assert the prop flips without a WebGL harness.
vi.mock('../geology/Geology3DViewer', () => ({
  default: (props: { bodySolidsWireframe?: boolean }) => (
    <div
      data-testid="geology-3d-viewer"
      data-wireframe={String(props.bodySolidsWireframe ?? false)}
    />
  ),
}))

// api.geology stubs — resolve empty so the canvas never hangs on async effects.
// listLithoSolids and buildVoxelLithoModel are added for the Task-8 solid-mode
// claims (C9/C10/C11).
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    api: {
      geology: {
        buildGroundSurface: vi.fn().mockResolvedValue({ vertices: [], triangles: [] }),
        // The footprint ring fetch (owner ballot 2026-08-26). Answers the
        // "never built" shape — an empty polygon with a reason — which is the
        // 200 the real endpoint gives for a model with no build generation.
        getModelFootprint: vi.fn().mockResolvedValue({
          polygon: [],
          generation_id: null,
          built_at: null,
          unavailable_reason: 'this model has not been built yet',
        }),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        // The build fetches every body's hand-drawn boundary and now CANCELS
        // when that fetch fails (audit 2026-08-02) — an unmocked listLenses
        // used to land in the silent-degradation branch this suite was
        // unknowingly exercising.
        listLenses: vi.fn().mockResolvedValue([]),
        getBodyBoundary: vi.fn().mockResolvedValue({ nodes: [] }),
        listLithoSolids: vi.fn().mockResolvedValue([]),
        buildVoxelLithoModel: vi.fn().mockResolvedValue({
          bodies_considered: 0,
          bodies_built: 0,
          bodies_skipped_checksum: 0,
          bodies_flagged: 0,
          orphans_deleted: 0,
          solids: [],
        } satisfies RebuildLithoSolidsResponse),
        setBodyColor: vi.fn().mockResolvedValue({ body_id: 'b-1', display_color: '#ff0000' }),
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
// Sentinels
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()

function makeLithoModel(): GeologicalModelResponse {
  return {
    id: 'litho-1',
    app_project_id: 'proj-1',
    name: 'Litho Model',
    description: null,
    kind: 'lithostratigraphic',
    is_active: true,
    excluded_borehole_ids: [],
    parent_model_id: 'geo-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeSection(id = 'sec-1'): CrossSectionResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: `Section ${id}`,
    description: null,
    start_x: 200000,
    start_y: 200000,
    end_x: 201000,
    end_y: 200000,
    epsg: 31370,
    projection_buffer_m: 50,
    vertical_exaggeration: 1,
    excluded_borehole_ids: [],
    excluded_cpt_ids: [],
    min_depth_m: null,
    max_depth_m: null,
    display_order: 0,
    view_state: null,
    seeded_formation_contact_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeSolid(bodyId: string, formationId: string, overrides: Partial<LithoBodySolidResponse> = {}): LithoBodySolidResponse {
  return {
    id: `solid-${bodyId}`,
    model_id: 'litho-1',
    body_id: bodyId,
    formation_id: formationId,
    body_ordinal: 0,
    method: 'watertight',
    vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]] as [number, number, number][],
    triangles: [[0, 1, 2]] as [number, number, number][],
    is_stale: false,
    is_flagged: false,
    display_color: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeSurface(formationId: string, hasVertices: boolean): FormationSurfaceResponse {
  return {
    id: `surf-${formationId}`,
    model_id: 'litho-1',
    formation_id: formationId,
    method: 'tin',
    is_stale: false,
    vertices: hasVertices
      ? ([
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ] as [number, number, number][])
      : [],
    triangles: hasVertices ? ([[0, 1, 2]] as [number, number, number][]) : [],
    source_contact_count: 3,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// ShellContext stub
// ---------------------------------------------------------------------------

function makeCtx(overrides: {
  activeLithoModel?: GeologicalModelResponse | null
  lithoFormations?: GeologicalFormationResponse[]
  lithoSurfacesByFormationId?: ReadonlyMap<string, FormationSurfaceResponse>
  visibleSections?: CrossSectionResponse[]
  toast?: (type: 'success' | 'error' | 'warning', message: string) => void
  lithoSolids?: LithoBodySolidResponse[]
  hasLithoSolids?: boolean
  lithoLayers?: LithoLayerResponse[]
  visibleCpts?: CptListItem[]
  visibleBoreholes?: BoreholeListItem[]
  view_state?: Record<string, unknown>
} = {}): ShellContextValue {
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
      view_state: overrides.view_state ?? {},
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
    visibleCpts: overrides.visibleCpts ?? [],
    visibleBoreholes: overrides.visibleBoreholes ?? [],
    geoModel: {
      activeGeologicalModel: null,
      // Debt #266 — geotech columns standing on litho that has since moved.
      staleLithoGeotechColumns: [],
      staleLithoGeotechColumnIds: new Set<string>(),
      staleLithoGeotechColumnCount: 0,
      unstampedGeotechColumnCount: 0,
      refreshGeotechLithoStaleness: vi.fn(),
      models: [],
      activeLithoModel: 'activeLithoModel' in overrides
        ? (overrides.activeLithoModel ?? null)
        : makeLithoModel(),
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: noopAsync,
      handleDeleteLithoModel: noopAsync,
      lithoContacts: [],
      lithoLayers: overrides.lithoLayers ?? [],
      lithoFormations: overrides.lithoFormations ?? [],
      lithoSurfacesByFormationId: overrides.lithoSurfacesByFormationId ?? new Map(),
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
      // F4 — stub so the interface is satisfied; not exercised in litho tests.
      handleSubdivideAllBodies: noopAsync,
      handleDivideBoreholes: noopAsync,
      requestGeotechLayersRefetch: vi.fn(),
      handleCreateLithoContact: noopAsync,
      handleInlineLithoCreateFormation: () => Promise.resolve(null),
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
      handleInlineCreateFormation: () => Promise.resolve(null),
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
      discoverBoreholeFormations: () => Promise.resolve({ candidates: [], collisions: [] }),
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
      handleAcceptLithoSuggestion: () => Promise.resolve(null),
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      backdropSurfacesByFormationId: new Map(),
      handleLoadBackdropSurfaces: noopAsync,
      lithoSolids: overrides.lithoSolids ?? [],
      lithoSolidsLoading: false,
      lithoSolidsBuilding: false,
      hasLithoSolids: overrides.hasLithoSolids ?? false,
      hasStaleLithoSolid: false,
      buildLithoSolids: noopAsync,
      startLithoBuild: async () => {},
      cancelLithoBuild: () => {},
      voxelBuildState: { status: 'idle' as const },
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
    },
    sections: {
      sections: [],
      selectedSectionId: null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: overrides.visibleSections ?? [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: 'geological' as const,
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
    toasts: { toasts: [], toast: overrides.toast ?? vi.fn() },
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

function renderCanvas(ctx: ShellContextValue) {
  return render(
    <ShellContext.Provider value={ctx}>
      <LithologyCanvas />
    </ShellContext.Provider>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  // Clear call counts on module-mock vi.fn()s so each test starts fresh.
  vi.clearAllMocks()
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

describe('LithologyCanvas (Slice D, #55)', () => {
  // C1: hasLithoSolids=false → EmptyState renders; Geology3DViewer absent.
  //     Surfaces being present (vertices or not) does not mount the pane.
  it('C1 — no solids: shows guided EmptyState, no Geology3DViewer', () => {
    const ctx = makeCtx({
      hasLithoSolids: false,
      lithoSolids: [],
    })
    renderCanvas(ctx)

    expect(screen.queryByTestId('geology-3d-viewer')).not.toBeInTheDocument()
    // EmptyState renders the updated hint text (references Build model now).
    expect(screen.getByText(/build model on the lithology toolbar/i)).toBeInTheDocument()
  })

  // C1b: Surfaces map with real vertices but hasLithoSolids=false → still EmptyState.
  //      This pins the key behavioural change: surfaces alone no longer mount the pane.
  it('C1b — surfaces present but no solids: shows EmptyState (surfaces no longer gate the pane)', () => {
    const surfMap = new Map([['f-built', makeSurface('f-built', true)]])
    const ctx = makeCtx({
      lithoSurfacesByFormationId: surfMap,
      hasLithoSolids: false,
      lithoSolids: [],
    })
    renderCanvas(ctx)

    expect(screen.queryByTestId('geology-3d-viewer')).not.toBeInTheDocument()
  })

  // C2: hasLithoSolids=true → Geology3DViewer mounts; EmptyState absent.
  it('C2 — solids present: Geology3DViewer mounts', () => {
    const solid = makeSolid('b-1', 'f-built')
    const ctx = makeCtx({
      lithoSolids: [solid],
      hasLithoSolids: true,
    })
    renderCanvas(ctx)

    expect(screen.getByTestId('geology-3d-viewer')).toBeInTheDocument()
  })

  // C3: resetLithoSplitViewportCallback is exported (debt #64 resolved).
  //     LithologyStage's toolbar Reset calls this to collapse the split viewport.
  it('C3 -- resetLithoSplitViewportCallback is callable after canvas mounts', () => {
    const solid = makeSolid('b-1', 'f-built')
    const ctx = makeCtx({
      lithoSolids: [solid],
      hasLithoSolids: true,
    })
    renderCanvas(ctx)

    // The module-level ref is set by the canvas on render.
    // Calling it resets split state; must not throw.
    expect(() => resetLithoSplitViewportCallback.current?.()).not.toThrow()
  })

  // C4: Fence/Solid toggle buttons render when solids are present.
  it('C4 -- Fence and Solid toggle buttons are present when solids exist', () => {
    const solid = makeSolid('b-1', 'f-built')
    const ctx = makeCtx({
      lithoSolids: [solid],
      hasLithoSolids: true,
    })
    renderCanvas(ctx)

    expect(screen.getByTestId('litho-view-mode-solid')).toBeInTheDocument()
    expect(screen.getByTestId('litho-view-mode-fence')).toBeInTheDocument()
  })

  // C5: Toggle buttons are absent when no solids exist (EmptyState shows instead).
  it('C5 -- Fence/Solid toggle absent when no solids exist', () => {
    const ctx = makeCtx({ hasLithoSolids: false, lithoSolids: [] })
    renderCanvas(ctx)

    expect(screen.queryByTestId('litho-view-mode-solid')).not.toBeInTheDocument()
    expect(screen.queryByTestId('litho-view-mode-fence')).not.toBeInTheDocument()
  })

  // CW1: The wireframe toggle is present in Solid mode (the default) and
  //      starts un-pressed; the viewer receives bodySolidsWireframe=false.
  it('CW1 -- wireframe toggle renders in Solid mode, starts off', () => {
    const solid = makeSolid('b-1', 'f-built')
    const ctx = makeCtx({ lithoSolids: [solid], hasLithoSolids: true })
    renderCanvas(ctx)

    const toggle = screen.getByTestId('litho-view-wireframe')
    expect(toggle).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByTestId('geology-3d-viewer')).toHaveAttribute(
      'data-wireframe',
      'false',
    )
  })

  // CW2: Clicking the wireframe toggle flips aria-pressed AND forwards
  //      bodySolidsWireframe=true to Geology3DViewer.
  it('CW2 -- clicking wireframe flips the toggle and the viewer prop', async () => {
    const solid = makeSolid('b-1', 'f-built')
    const ctx = makeCtx({ lithoSolids: [solid], hasLithoSolids: true })
    renderCanvas(ctx)

    await act(async () => {
      fireEvent.click(screen.getByTestId('litho-view-wireframe'))
    })

    expect(screen.getByTestId('litho-view-wireframe')).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    expect(screen.getByTestId('geology-3d-viewer')).toHaveAttribute(
      'data-wireframe',
      'true',
    )
  })

  // CW3: The wireframe toggle is hidden in Fence mode (wireframe applies to
  //      the filled body-solid render, which Fence mode does not draw).
  it('CW3 -- wireframe toggle is absent in Fence mode', async () => {
    const solid = makeSolid('b-1', 'f-built')
    const ctx = makeCtx({
      lithoSolids: [solid],
      hasLithoSolids: true,
      visibleSections: [makeSection('sec-1')],
    })
    renderCanvas(ctx)

    expect(screen.getByTestId('litho-view-wireframe')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByTestId('litho-view-mode-fence'))
    })

    expect(screen.queryByTestId('litho-view-wireframe')).not.toBeInTheDocument()
  })

  // C6: Clicking Fence triggers the section-scoped correlations fetch.
  //     The listContactCorrelations mock is wired at module level; clicking
  //     Fence sets viewMode → 'fence' which fires the effect.
  it('C6 -- clicking Fence triggers listContactCorrelations fetch per visible section', async () => {
    const solid = makeSolid('b-1', 'f-built')
    const ctx = makeCtx({
      lithoSolids: [solid],
      hasLithoSolids: true,
      visibleSections: [makeSection('sec-1')],
    })
    renderCanvas(ctx)

    // Confirm the mock has not been called before toggling.
    expect(vi.mocked(api.geology.listContactCorrelations)).not.toHaveBeenCalled()

    // Click the Fence toggle — the viewMode effect fires listContactCorrelations.
    await act(async () => {
      fireEvent.click(screen.getByTestId('litho-view-mode-fence'))
    })

    // The fetch must have been called exactly once for the one visible section.
    expect(vi.mocked(api.geology.listContactCorrelations)).toHaveBeenCalledOnce()
    expect(vi.mocked(api.geology.listContactCorrelations)).toHaveBeenCalledWith(
      'proj-1',
      'litho-1',
      'sec-1',
    )
  })

  // C6b: A section whose correlation fetch FAILS resolves to zero edges, which
  //      looks exactly like "this section has no correlations" — so the fence
  //      would render untied panels and claim to be complete. The rule, in the
  //      rule's own words: if the fence is missing correlations it could not
  //      load, the engineer is told which sections (audit 2026-08-02, Class 1;
  //      fetchApprovedEdgesBySection makes acting on failedSectionIds a caller
  //      obligation, and this consumer used to drop them on the floor).
  it('C6b -- warns the engineer, naming the sections, when a fence correlation fetch fails', async () => {
    const solid = makeSolid('b-1', 'f-built')
    const toast = vi.fn()
    const ctx = makeCtx({
      lithoSolids: [solid],
      hasLithoSolids: true,
      visibleSections: [makeSection('sec-1'), makeSection('sec-2')],
      toast,
    })
    vi.mocked(api.geology.listContactCorrelations).mockImplementation(
      async (_p: string, _m: string, sectionId?: string | null) => {
        if (sectionId === 'sec-2') throw new Error('network down')
        return [] as LithoContactCorrelationEdge[]
      },
    )
    renderCanvas(ctx)

    await act(async () => {
      fireEvent.click(screen.getByTestId('litho-view-mode-fence'))
    })

    const warnings = toast.mock.calls.filter(call => call[0] === 'warning')
    expect(warnings).toHaveLength(1)
    expect(String(warnings[0][1])).toContain('Section sec-2')
    expect(String(warnings[0][1])).not.toContain('Section sec-1')
  })

  // C7: Empty-fence pill renders when Fence mode is active, the fetch has
  //     resolved, and no panels were produced (no correlations in the section).
  //
  //     The listContactCorrelations mock returns [] by default, so after the
  //     fetch settles edgesBySectionId is populated but fencePanels === [].
  //     We provide one section so the fetch path runs; fencePanels comes out
  //     empty because there are no approved edges → no bands → no panels.
  it('C7 -- empty-fence hint pill renders when fence mode is on and no panels exist', async () => {
    const solid = makeSolid('b-1', 'f-built')
    const ctx = makeCtx({
      lithoSolids: [solid],
      hasLithoSolids: true,
      visibleSections: [makeSection('sec-1')],
    })
    renderCanvas(ctx)

    // The hint must NOT be visible in Solid mode (the default).
    expect(screen.queryByTestId('fence-empty-hint')).not.toBeInTheDocument()

    // Switch to Fence and let the fetch + useMemo settle.
    await act(async () => {
      fireEvent.click(screen.getByTestId('litho-view-mode-fence'))
    })

    // After the mock resolves (empty edges → empty panels) the hint appears.
    expect(screen.getByTestId('fence-empty-hint')).toBeInTheDocument()
    expect(screen.getByTestId('fence-empty-hint')).toHaveTextContent(
      /accept correlations in the sections stage/i,
    )
  })

  // C8: Both toggle buttons carry disabled={true} while the fence fetch is
  //     in flight (fenceLoading = true).  We hold the mock promise unresolved
  //     for the duration of the assertion so fenceLoading stays true.
  it('C8 -- toggle buttons are disabled while the fence fetch is pending', async () => {
    // Hold the promise so fenceLoading never clears during the assertion.
    let resolveFetch!: () => void
    const pending = new Promise<LithoContactCorrelationEdge[]>(resolve => {
      resolveFetch = () => resolve([])
    })
    vi.mocked(api.geology.listContactCorrelations).mockReturnValue(pending)

    const solid = makeSolid('b-1', 'f-built')
    const ctx = makeCtx({
      lithoSolids: [solid],
      hasLithoSolids: true,
      visibleSections: [makeSection('sec-1')],
    })
    renderCanvas(ctx)

    // Buttons start enabled in Solid mode.
    expect(screen.getByTestId('litho-view-mode-solid')).not.toBeDisabled()
    expect(screen.getByTestId('litho-view-mode-fence')).not.toBeDisabled()

    // Click Fence — the effect fires but the promise is unresolved →
    // fenceLoading = true → both buttons become disabled.
    await act(async () => {
      fireEvent.click(screen.getByTestId('litho-view-mode-fence'))
    })

    expect(screen.getByTestId('litho-view-mode-solid')).toBeDisabled()
    expect(screen.getByTestId('litho-view-mode-fence')).toBeDisabled()

    // Resolve the fetch so the component cleans up properly after the test.
    await act(async () => {
      resolveFetch()
    })
  })

  // C9 (updated 2026-06-10 — Build button + legend moved to toolbar +
  //     inspector).  The canvas reads lithoSolids from context (useLithoSolids
  //     via geoModel bus) and forwards them to Geology3DViewer.  The canvas
  //     itself no longer calls listLithoSolids — that is the hook's job.
  //
  //     Claim: when hasLithoSolids is true in the context, the canvas suppresses
  //     TIN sheets (surfacesMapForViewer = EMPTY_SURFACES_MAP) so the viewer
  //     renders only the opaque solids.  The canvas still mounts — no crash.
  it('C9 -- canvas mounts cleanly when lithoSolids are provided via context', async () => {
    const surfMap = new Map([['f-built', makeSurface('f-built', true)]])
    const solid = makeSolid('b-1', 'f-built')
    const ctx = makeCtx({
      lithoSurfacesByFormationId: surfMap,
      lithoSolids: [solid],
      hasLithoSolids: true,
    })

    await act(async () => {
      renderCanvas(ctx)
    })

    // Geology3DViewer still renders (canvas did not crash).
    expect(screen.getByTestId('geology-3d-viewer')).toBeInTheDocument()
    // The Build model button is NOT in the canvas (it is in the toolbar now).
    expect(screen.queryByTestId('litho-build-model-button')).not.toBeInTheDocument()
    // The legend is NOT in the canvas (it is in the inspector now).
    expect(screen.queryByTestId('litho-solid-legend')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Voxel Build wiring (Task 5)
// ---------------------------------------------------------------------------

function makeCpt(id: string, x: number, y: number): CptListItem {
  return {
    id,
    name: id,
    cpt_type: 'CPTU',
    max_depth_m: 20,
    n_rows: 1000,
    location_x: x,
    location_y: y,
    epsg: 31370,
    elevation_m: 10,
    z_epsg: 5710,
    elevation_source: 'dov',
    start_date: null,
  }
}

function makeLithoLayer(
  id: string,
  cptId: string,
  formationId: string,
  bodyId: string,
): LithoLayerResponse {
  return {
    id,
    model_id: 'litho-1',
    formation_id: formationId,
    borehole_id: null,
    cpt_id: cptId,
    depth_top_m: 0,
    depth_base_m: 5,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: bodyId,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('LithologyCanvas voxel Build wiring (Task 5)', () => {
  // V1: After the canvas mounts, lithoVoxelRequestCallback is populated and,
  //     when invoked, fetches each section's edges fresh and returns a
  //     VoxelBuildRequest carrying the partition + the anisotropic spacings
  //     read from the project's litho_segmenter view-state.
  it('V1 — the populated callback assembles a VoxelBuildRequest with view-state spacings', async () => {
    const section = makeSection('sec-1')
    const ctx = makeCtx({
      hasLithoSolids: true,
      lithoSolids: [makeSolid('b-1', 'ZAND')],
      visibleSections: [section],
      visibleCpts: [makeCpt('A', 200000, 200000), makeCpt('B', 201000, 200000)],
      lithoLayers: [
        makeLithoLayer('a1', 'A', 'ZAND', 'z'),
        makeLithoLayer('b1', 'B', 'ZAND', 'z'),
      ],
      view_state: {
        litho_segmenter: {
          voxel_horizontal_spacing_m: 3.0,
          voxel_vertical_spacing_m: 0.5,
        },
      },
    })

    await act(async () => {
      renderCanvas(ctx)
    })

    expect(lithoVoxelRequestCallback.current).not.toBeNull()

    let request: Awaited<ReturnType<NonNullable<typeof lithoVoxelRequestCallback.current>>> = null
    await act(async () => {
      request = await lithoVoxelRequestCallback.current!()
    })

    // Edges fetched fresh, once per visible section.
    expect(vi.mocked(api.geology.listContactCorrelations)).toHaveBeenCalledWith(
      'proj-1',
      'litho-1',
      'sec-1',
    )

    expect(request).not.toBeNull()
    // Anisotropic spacings come from the view-state prefs.
    expect(request!.grid_spacing_m).toBe(3.0)
    expect(request!.horizontal_spacing_m).toBe(3.0)
    expect(request!.vertical_spacing_m).toBe(0.5)
    // One section assembled with both columns projected onto it.
    expect(request!.sections).toHaveLength(1)
    expect(request!.sections[0].columns.map(c => c.investigation_id).sort()).toEqual(['A', 'B'])
  })

  // V2: With no visible section there is nothing to project onto → the
  //     callback resolves to null (the "nothing to build" no-op path).
  it('V2 — the callback resolves to null when there are no visible sections', async () => {
    const ctx = makeCtx({
      hasLithoSolids: true,
      lithoSolids: [makeSolid('b-1', 'ZAND')],
      visibleSections: [],
    })

    await act(async () => {
      renderCanvas(ctx)
    })

    let request: VoxelBuildRequestResult = undefined
    await act(async () => {
      request = await lithoVoxelRequestCallback.current!()
    })
    expect(request).toBeNull()
  })
})

type VoxelBuildRequestResult =
  | Awaited<ReturnType<NonNullable<typeof lithoVoxelRequestCallback.current>>>
  | undefined

// ---------------------------------------------------------------------------
// Module-ref cleanup on unmount (debt #276)
//
// The canvas ⟷ toolbar bridges are module-level refs the canvas writes every
// render. Debt #276: most were never nulled on unmount, so "a toolbar click
// that fires after the canvas unmounted [ran] against a destroyed view".
// Two properties are pinned here, in the debt entry's own words:
//   (1) the ref is null after the owning canvas unmounts, so a toolbar click
//       after a stage switch is a no-op, not a call against a destroyed view;
//   (2) the MOUNT-ORDER guard: React can mount a replacement canvas before it
//       runs the previous one's cleanup (both stages can also be alive at once
//       in the split viewport), so an older instance's unmount must NOT null a
//       ref a newer instance has already claimed.
// ---------------------------------------------------------------------------

describe('LithologyCanvas module-ref cleanup on unmount (#276)', () => {
  function mountedCtx(): ShellContextValue {
    return makeCtx({
      hasLithoSolids: true,
      lithoSolids: [makeSolid('b-1', 'ZAND')],
      visibleSections: [makeSection('sec-1')],
      visibleCpts: [makeCpt('A', 200000, 200000), makeCpt('B', 201000, 200000)],
      lithoLayers: [
        makeLithoLayer('a1', 'A', 'ZAND', 'z'),
        makeLithoLayer('b1', 'B', 'ZAND', 'z'),
      ],
    })
  }

  // U1 — the split-viewport ref (never nulled before this fix). A Reset click
  // after the canvas unmounts must not run against a destroyed view.
  it('U1 — split-viewport ref is null after the canvas unmounts', () => {
    const r = renderCanvas(mountedCtx())
    expect(resetLithoSplitViewportCallback.current).not.toBeNull()
    r.unmount()
    expect(resetLithoSplitViewportCallback.current).toBeNull()
  })

  // U2 — the voxel-build ref. A "Build model" click after the canvas unmounts
  // must not build a destroyed view's partition.
  it('U2 — voxel-request ref is null after the canvas unmounts', () => {
    const r = renderCanvas(mountedCtx())
    expect(lithoVoxelRequestCallback.current).not.toBeNull()
    r.unmount()
    expect(lithoVoxelRequestCallback.current).toBeNull()
  })

  // U3 — the mount-order guard. Mount A, mount B, unmount A → the ref must
  // still hold B's callback (an older canvas cannot wipe a newer one's claim).
  it('U3 — an older canvas unmount does not wipe a ref the newer canvas claimed', () => {
    const rA = renderCanvas(mountedCtx())
    const aBuilder = lithoVoxelRequestCallback.current
    const rB = renderCanvas(mountedCtx())
    const bBuilder = lithoVoxelRequestCallback.current
    expect(bBuilder).not.toBe(aBuilder)
    rA.unmount()
    expect(lithoVoxelRequestCallback.current).toBe(bBuilder)
    rB.unmount()
    expect(lithoVoxelRequestCallback.current).toBeNull()
  })

  // U4 — the fence-export ref (the precedent this fix generalises). Populated
  // only in Fence mode; still must be nulled on unmount.
  it('U4 — fence-export ref is null after the canvas unmounts', async () => {
    const r = renderCanvas(mountedCtx())
    await act(async () => {
      fireEvent.click(screen.getByTestId('litho-view-mode-fence'))
    })
    expect(lithoFenceExportCallback.current).not.toBeNull()
    r.unmount()
    expect(lithoFenceExportCallback.current).toBeNull()
  })
})

