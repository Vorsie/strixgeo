// Behavioral net for LithologyToolbar.
//
// The two former buttons ("Build litho" and "Build solids") have been
// collapsed into a single "Build model" button that calls buildLithoSolids.
// The TIN-surface build is retired from the UI (Task 7, litho-3D plan).
//
// Claims pinned here:
//   BM1  Build model button renders when a litho model is active.
//   BM2  Build model button is absent when no litho model is active
//        (LithologyToolbar returns null).
//   BM3  Clicking Build model calls buildLithoSolids (NOT handleRebuildLithoSurfaces).
//   BM4  Build model is disabled + tooltip matches /cross-section/i when no contacts.
//   BM5  Label shows "· stale" when hasStaleLithoSolid is true.
//   BM6  Label shows "Building…" and button is disabled when lithoSolidsBuilding.
//   BM7  No "Build litho" button and no element with testid litho-build-solids-button.
//   BM8  Reset camera button gates on litho solids (absent without, present with;
//        surfaces-only does NOT show it).

import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  FormationContactResponse,
  FormationSurfaceResponse,
  GeologicalModelResponse,
} from '../../../api/client'

// The LithologyToolbar is inline in LithologyStage.tsx and registered as
// ToolbarComponent.  Import the descriptor and render ToolbarComponent
// directly so these tests are isolated from the canvas / inspector halves.
import LithologyStage from './LithologyStage'

// ---------------------------------------------------------------------------
// Module mocks â€” LithologyCanvas and Geology3DViewer bring Cesium/Leaflet
// ---------------------------------------------------------------------------

vi.mock('./LithologyCanvas', () => ({
  default: () => <div data-testid="litho-canvas-mock" />,
  resetLithoCameraCallback: { current: null },
  resetLithoSplitViewportCallback: { current: null },
  lithoVoxelRequestCallback: { current: null },
}))

vi.mock('../geology/Geology3DViewer', () => ({
  default: () => <div data-testid="geology-3d-viewer" />,
}))

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
// Factories
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

function makeSurface(
  formationId: string,
  hasVertices: boolean,
): FormationSurfaceResponse {
  return {
    id: `surf-${formationId}`,
    model_id: 'litho-1',
    formation_id: formationId,
    is_stale: false,
    source_contact_count: 0,
    vertices: hasVertices ? [[0, 0, 0]] : [],
    triangles: hasVertices ? [[0, 0, 0]] : [],
    method: 'tin',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeCtx(overrides: {
  activeLithoModel?: GeologicalModelResponse | null
  lithoContacts?: FormationContactResponse[]
  lithoSurfacesByFormationId?: Map<string, FormationSurfaceResponse>
  // Still required by the ShellContext type; the toolbar no longer uses these
  // after Task 7 (BM3 only asserts handleRebuildLithoSurfaces is NOT called).
  lithoStaleSurfaceCount?: number
  handleRebuildLithoSurfaces?: () => Promise<void>
  lithoSolidsBuilding?: boolean
  hasStaleLithoSolid?: boolean
  hasLithoSolids?: boolean
  buildLithoSolids?: () => Promise<void>
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
      activeGeologicalModel: {
        id: 'geo-1',
        app_project_id: 'proj-1',
        name: 'Default',
        description: null,
        kind: 'geological',
        is_active: true,
        excluded_borehole_ids: [],
        parent_model_id: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      models: [],
      activeLithoModel: overrides.activeLithoModel ?? null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: noopAsync,
      handleDeleteLithoModel: noopAsync,
      lithoContacts: overrides.lithoContacts ?? [],
      lithoLayers: [],
      lithoFormations: [],
      lithoSurfacesByFormationId: overrides.lithoSurfacesByFormationId ?? new Map(),
      lithoStaleSurfaceCount: overrides.lithoStaleSurfaceCount ?? 0,
      handleRebuildLithoSurfaces: overrides.handleRebuildLithoSurfaces ?? noopAsync,
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
      lithoSolids: [],
      lithoSolidsLoading: false,
      lithoSolidsBuilding: overrides.lithoSolidsBuilding ?? false,
      hasLithoSolids: overrides.hasLithoSolids ?? false,
      hasStaleLithoSolid: overrides.hasStaleLithoSolid ?? false,
      buildLithoSolids: overrides.buildLithoSolids ?? noopAsync,
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
    },
    sections: {
      sections: [],
      selectedSectionId: null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: 'geological',
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

const { ToolbarComponent: LithologyToolbar } = LithologyStage

function renderToolbar(ctx: ShellContextValue) {
  return render(
    <ShellContext.Provider value={ctx}>
      <LithologyToolbar />
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

describe('LithologyToolbar Build model button (Task 7 — single-button collapse)', () => {
  // BM1: Build model button renders when a litho model is active.
  it('BM1 — Build model button renders when a litho model is active', () => {
    const ctx = makeCtx({ activeLithoModel: makeLithoModel() })
    renderToolbar(ctx)
    expect(screen.getByTestId('litho-build-model-button')).toBeInTheDocument()
  })

  // BM2: LithologyToolbar returns null (no buttons) when no litho model active.
  it('BM2 — toolbar renders nothing when no litho model is active', () => {
    const ctx = makeCtx({ activeLithoModel: null })
    const { container } = renderToolbar(ctx)
    expect(container.firstChild).toBeNull()
  })

  // BM3: Clicking Build model calls buildLithoSolids (not handleRebuildLithoSurfaces).
  // The fixture seeds one contact so the no-contacts gate is open.
  it('BM3 — clicking Build model calls buildLithoSolids', async () => {
    const buildSolids = vi.fn().mockResolvedValue(undefined)
    const rebuildSurfaces = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoContacts: [
        {
          id: 'c1',
          model_id: 'litho-1',
          formation_id: 'f1',
          borehole_id: 'b1',
          cpt_id: null,
          synthetic_x: null,
          synthetic_y: null,
          synthetic_elevation_m: null,
          depth_top_m: 1,
          source: 'manual_pick',
          confidence: 'high',
          observation_id: null,
          observation_layer_id: null,
          notes: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        } as FormationContactResponse,
      ],
      buildLithoSolids: buildSolids,
      handleRebuildLithoSurfaces: rebuildSurfaces,
    })
    renderToolbar(ctx)

    fireEvent.click(screen.getByTestId('litho-build-model-button'))

    await vi.waitFor(() => {
      expect(buildSolids).toHaveBeenCalledOnce()
    })
    // The old TIN-surface build must NOT be called.
    expect(rebuildSurfaces).not.toHaveBeenCalled()
  })

  // BM4: Build model is DISABLED + tooltip points to cross-section when no contacts.
  it('BM4 — Build model is disabled with cross-section hint when no contacts', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoContacts: [],
    })
    renderToolbar(ctx)
    const btn = screen.getByTestId('litho-build-model-button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/cross-section/i)
  })

  // BM5: Label shows “· stale” when hasStaleLithoSolid is true.
  it('BM5 — label shows “· stale” when hasStaleLithoSolid is true', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      hasStaleLithoSolid: true,
    })
    renderToolbar(ctx)
    expect(screen.getByTestId('litho-build-model-button')).toHaveTextContent(/stale/i)
  })

  // BM6: Label shows “Building…” and button is disabled while lithoSolidsBuilding.
  it('BM6 — label shows “Building…” and button is disabled while building', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoSolidsBuilding: true,
    })
    renderToolbar(ctx)
    const btn = screen.getByTestId('litho-build-model-button') as HTMLButtonElement
    expect(btn).toHaveTextContent(/building/i)
    expect(btn.disabled).toBe(true)
  })

  // BM7 (negative): the old “Build litho” and “litho-build-solids-button” are gone.
  it('BM7 — no “Build litho” button and no litho-build-solids-button element', () => {
    const ctx = makeCtx({ activeLithoModel: makeLithoModel() })
    renderToolbar(ctx)
    expect(screen.queryByRole('button', { name: /build litho/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('litho-build-solids-button')).not.toBeInTheDocument()
  })
})

describe('LithologyToolbar Reset camera button', () => {
  // BM8a: Reset camera absent when no built litho solids exist (the 3D pane
  // that the button controls mounts on solids now, not retired TIN surfaces).
  it('BM8a â€” Reset camera absent when no built litho solids exist', () => {
    const ctx = makeCtx({ activeLithoModel: makeLithoModel(), hasLithoSolids: false })
    renderToolbar(ctx)
    expect(screen.queryByRole('button', { name: /reset camera/i })).not.toBeInTheDocument()
  })

  // BM8b: Reset camera present when built litho solids exist. Surfaces present
  // but no solids must NOT show the button (gate is solids-driven).
  it('BM8b â€” Reset camera present when built litho solids exist', () => {
    const ctx = makeCtx({ activeLithoModel: makeLithoModel(), hasLithoSolids: true })
    renderToolbar(ctx)
    expect(screen.getByRole('button', { name: /reset camera/i })).toBeInTheDocument()
  })

  // BM8c: surfaces-only (no solids) does NOT show Reset camera — proves the
  // gate no longer keys on TIN surfaces.
  it('BM8c â€” Reset camera absent when only surfaces exist (no solids)', () => {
    const surfaces = new Map([['f-1', makeSurface('f-1', true)]])
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoSurfacesByFormationId: surfaces,
      hasLithoSolids: false,
    })
    renderToolbar(ctx)
    expect(screen.queryByRole('button', { name: /reset camera/i })).not.toBeInTheDocument()
  })
})


// ---------------------------------------------------------------------------
// SB — the spine badge says the model is stale
// ---------------------------------------------------------------------------
//
// Owner, 2026-08-10: "add a stale marker on the left stage of the litho pane? the
// build button is stale already though". The Build button only says so once you are
// ON the Lithology stage; a contact dragged from the geotech axis stales the litho
// 3-D model while you are looking at a different stage entirely, and nothing in the
// spine reports it. The badge is how the stage says "there is work here" without
// being opened.

describe('the Lithology spine badge reports a stale 3-D model', () => {
  it('SB1 — amber, and it says stale rather than a unit count', () => {
    const ctx = makeCtx({ hasStaleLithoSolid: true, hasLithoSolids: true })

    const { result } = renderHook(() => LithologyStage.useStageSummary(), {
      wrapper: ({ children }) => (
        <ShellContext.Provider value={ctx}>{children}</ShellContext.Provider>
      ),
    })

    expect(result.current.badgeIntent).toBe('amber')
    // The WORD lives in the label, which is the tooltip and the accessible name. The
    // badge itself must stay within the spine's 4-character budget — anything longer
    // renders as an ellipsis and tells the engineer nothing at all.
    expect(result.current.label).toMatch(/stale/i)
    expect((result.current.badge ?? '').length).toBeLessThanOrEqual(4)
    expect(result.current.badge).not.toBeNull()
  })

  it('SB2 — a fresh model keeps the unit count, in neutral', () => {
    // The badge has a day job. Staleness borrows it, and must hand it back.
    const ctx = makeCtx({ hasStaleLithoSolid: false, hasLithoSolids: true })

    const { result } = renderHook(() => LithologyStage.useStageSummary(), {
      wrapper: ({ children }) => (
        <ShellContext.Provider value={ctx}>{children}</ShellContext.Provider>
      ),
    })

    expect(result.current.badgeIntent).toBe('neutral')
    expect(result.current.label).not.toMatch(/stale/i)
  })

  it('SB3 — with nothing built there is nothing to call stale', () => {
    // hasStaleLithoSolid cannot be true without solids, but the badge must not
    // invent a warning from an empty model either.
    const ctx = makeCtx({ hasStaleLithoSolid: false, hasLithoSolids: false })

    const { result } = renderHook(() => LithologyStage.useStageSummary(), {
      wrapper: ({ children }) => (
        <ShellContext.Provider value={ctx}>{children}</ShellContext.Provider>
      ),
    })

    expect(result.current.badgeIntent).toBe('neutral')
  })
})
