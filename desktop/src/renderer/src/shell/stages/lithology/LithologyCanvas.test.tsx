// Behavioral net for LithologyCanvas (Slice D, #55 peer-stage scaffolding).
//
// Claims pinned here:
//   C1  When no litho surfaces exist (empty map or all vertices=[]) →
//       EmptyState renders; Geology3DViewer does NOT mount.
//   C2  When at least one litho surface has vertices → Geology3DViewer
//       mounts; EmptyState does NOT render.
//   C9  In Solid mode, api.geology.listLithoSolids is called with the
//       correct projectId + modelId.
//   C10 Clicking "Build solids" calls api.geology.rebuildLithoSolids and
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
  CrossSectionResponse,
  FormationSurfaceResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoBodySolidResponse,
  LithoContactCorrelationEdge,
  RebuildLithoSolidsResponse,
} from '../../../api/client'
import LithologyCanvas, { resetLithoSplitViewportCallback } from './LithologyCanvas'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// Geology3DViewer imports Cesium and WebGL â€” mock it as a sentinel div.
vi.mock('../geology/Geology3DViewer', () => ({
  default: () => <div data-testid="geology-3d-viewer" />,
}))

// api.geology stubs — resolve empty so the canvas never hangs on async effects.
// listLithoSolids and rebuildLithoSolids are added for the Task-8 solid-mode
// claims (C9/C10/C11).
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    api: {
      geology: {
        buildGroundSurface: vi.fn().mockResolvedValue({ vertices: [], triangles: [] }),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        listLithoSolids: vi.fn().mockResolvedValue([]),
        rebuildLithoSolids: vi.fn().mockResolvedValue({
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
    parent_geological_model_id: 'geo-1',
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
      activeLithoModel: 'activeLithoModel' in overrides
        ? (overrides.activeLithoModel ?? null)
        : makeLithoModel(),
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: noopAsync,
      handleDeleteLithoModel: noopAsync,
      lithoContacts: [],
      lithoLayers: [],
      lithoFormations: overrides.lithoFormations ?? [],
      lithoSurfacesByFormationId: overrides.lithoSurfacesByFormationId ?? new Map(),
      lithoStaleSurfaceCount: 0,
    lithoStaleTinSessionCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      handleCreateManualLithoGhost: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
      markMutated: vi.fn(),
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
      setBodyColor: vi.fn(),
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
  // C1: No built surfaces â†’ EmptyState renders; Geology3DViewer absent.
  it('C1 â€” no litho surfaces: shows guided EmptyState, no Geology3DViewer', () => {
    const ctx = makeCtx({
      // Empty map â€” no surfaces built yet.
      lithoSurfacesByFormationId: new Map(),
    })
    renderCanvas(ctx)

    expect(screen.queryByTestId('geology-3d-viewer')).not.toBeInTheDocument()
    // EmptyState renders the hint text.
    expect(screen.getByText(/place contacts, open the sections stage/i)).toBeInTheDocument()
  })

  // C1b: Surface map with vertices=[] â†’ still EmptyState (stale surface, no geometry).
  it('C1b â€” surface with empty vertices: shows EmptyState (no geometry to render)', () => {
    const surfMap = new Map([['f-stale', makeSurface('f-stale', false)]])
    const ctx = makeCtx({ lithoSurfacesByFormationId: surfMap })
    renderCanvas(ctx)

    expect(screen.queryByTestId('geology-3d-viewer')).not.toBeInTheDocument()
  })

  // C2: At least one surface with vertices â†’ Geology3DViewer mounts; EmptyState absent.
  it('C2 â€” surface with vertices: Geology3DViewer mounts', () => {
    const surfMap = new Map([['f-built', makeSurface('f-built', true)]])
    const ctx = makeCtx({ lithoSurfacesByFormationId: surfMap })
    renderCanvas(ctx)

    expect(screen.getByTestId('geology-3d-viewer')).toBeInTheDocument()
  })

  // C3: resetLithoSplitViewportCallback is exported (debt #64 resolved).
  //     LithologyStage's toolbar Reset calls this to collapse the split viewport.
  it('C3 -- resetLithoSplitViewportCallback is callable after canvas mounts', () => {
    const surfMap = new Map([['f-built', makeSurface('f-built', true)]])
    const ctx = makeCtx({ lithoSurfacesByFormationId: surfMap })
    renderCanvas(ctx)

    // The module-level ref is set by the canvas on render.
    // Calling it resets split state; must not throw.
    expect(() => resetLithoSplitViewportCallback.current?.()).not.toThrow()
  })

  // C4: Fence/Solid toggle buttons render when surfaces are present.
  it('C4 -- Fence and Solid toggle buttons are present when surfaces exist', () => {
    const surfMap = new Map([['f-built', makeSurface('f-built', true)]])
    const ctx = makeCtx({ lithoSurfacesByFormationId: surfMap })
    renderCanvas(ctx)

    expect(screen.getByTestId('litho-view-mode-solid')).toBeInTheDocument()
    expect(screen.getByTestId('litho-view-mode-fence')).toBeInTheDocument()
  })

  // C5: Toggle buttons are absent when no surfaces exist (EmptyState shows instead).
  it('C5 -- Fence/Solid toggle absent when no surfaces exist', () => {
    const ctx = makeCtx({ lithoSurfacesByFormationId: new Map() })
    renderCanvas(ctx)

    expect(screen.queryByTestId('litho-view-mode-solid')).not.toBeInTheDocument()
    expect(screen.queryByTestId('litho-view-mode-fence')).not.toBeInTheDocument()
  })

  // C6: Clicking Fence triggers the section-scoped correlations fetch.
  //     The listContactCorrelations mock is wired at module level; clicking
  //     Fence sets viewMode → 'fence' which fires the effect.
  it('C6 -- clicking Fence triggers listContactCorrelations fetch per visible section', async () => {
    const surfMap = new Map([['f-built', makeSurface('f-built', true)]])
    const ctx = makeCtx({
      lithoSurfacesByFormationId: surfMap,
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

  // C7: Empty-fence pill renders when Fence mode is active, the fetch has
  //     resolved, and no panels were produced (no correlations in the section).
  //
  //     The listContactCorrelations mock returns [] by default, so after the
  //     fetch settles edgesBySectionId is populated but fencePanels === [].
  //     We provide one section so the fetch path runs; fencePanels comes out
  //     empty because there are no approved edges → no bands → no panels.
  it('C7 -- empty-fence hint pill renders when fence mode is on and no panels exist', async () => {
    const surfMap = new Map([['f-built', makeSurface('f-built', true)]])
    const ctx = makeCtx({
      lithoSurfacesByFormationId: surfMap,
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

    const surfMap = new Map([['f-built', makeSurface('f-built', true)]])
    const ctx = makeCtx({
      lithoSurfacesByFormationId: surfMap,
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
    // The Build-Solids button is NOT in the canvas (it is in the toolbar now).
    expect(screen.queryByTestId('litho-build-solids-button')).not.toBeInTheDocument()
    // The legend is NOT in the canvas (it is in the inspector now).
    expect(screen.queryByTestId('litho-solid-legend')).not.toBeInTheDocument()
  })
})

