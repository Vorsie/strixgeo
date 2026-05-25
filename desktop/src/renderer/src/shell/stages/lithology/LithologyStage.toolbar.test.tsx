// Behavioral net for LithologyToolbar (Phase 1 litho accept flow).
//
// "Build litho" was moved from SectionsToolbar to LithologyToolbar so
// it lives beside the model-management surface, not the section editor.
//
// Claims pinned here:
//   BL1  Build litho button renders when a litho model is active.
//   BL2  Build litho button is absent when no litho model is active
//        (LithologyToolbar returns null).
//   BL3  Clicking Build litho calls handleRebuildLithoSurfaces.
//   BL4  When lithoStaleSurfaceCount > 0 the label shows the count.
//   BL5  Reset camera button is absent when no litho surfaces exist;
//        present when at least one surface has vertices.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
// Module mocks — LithologyCanvas and Geology3DViewer bring Cesium/Leaflet
// ---------------------------------------------------------------------------

vi.mock('./LithologyCanvas', () => ({
  default: () => <div data-testid="litho-canvas-mock" />,
  resetLithoCameraCallback: { current: null },
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
    parent_geological_model_id: 'geo-1',
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
  lithoStaleSurfaceCount?: number
  handleRebuildLithoSurfaces?: () => Promise<void>
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
        parent_geological_model_id: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      models: [],
      activeLithoModel: overrides.activeLithoModel ?? null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: noopAsync,
      handleDeleteLithoModel: noopAsync,
      lithoContacts: overrides.lithoContacts ?? [],
      lithoFormations: [],
      lithoSurfacesByFormationId: overrides.lithoSurfacesByFormationId ?? new Map(),
      lithoStaleSurfaceCount: overrides.lithoStaleSurfaceCount ?? 0,
      lithoStaleTinSessionCount: 0,
      handleRebuildLithoSurfaces: overrides.handleRebuildLithoSurfaces ?? noopAsync,
      handleAutoCorrelate: noopAsync,
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
      backdropSurfacesByFormationId: new Map(),
      handleLoadBackdropSurfaces: noopAsync,
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

describe('LithologyToolbar Build litho button (Phase 1 accept flow)', () => {
  // BL1: Build litho renders when a litho model is active.
  it('BL1 — Build litho button renders when a litho model is active', () => {
    const ctx = makeCtx({ activeLithoModel: makeLithoModel() })
    renderToolbar(ctx)
    expect(screen.getByRole('button', { name: /build litho/i })).toBeInTheDocument()
  })

  // BL2: LithologyToolbar returns null (no buttons) when no litho model.
  it('BL2 — toolbar renders nothing when no litho model is active', () => {
    const ctx = makeCtx({ activeLithoModel: null })
    const { container } = renderToolbar(ctx)
    expect(container.firstChild).toBeNull()
  })

  // BL3: Clicking Build litho calls handleRebuildLithoSurfaces.
  // Debt #94: Build is gated on contact presence, so the test fixture
  // seeds one contact for the click to fire.
  it('BL3 — clicking Build litho calls handleRebuildLithoSurfaces', async () => {
    const rebuild = vi.fn().mockResolvedValue(undefined)
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
      handleRebuildLithoSurfaces: rebuild,
    })
    renderToolbar(ctx)

    fireEvent.click(screen.getByRole('button', { name: /build litho/i }))

    await vi.waitFor(() => {
      expect(rebuild).toHaveBeenCalledOnce()
    })
  })

  // BL3b (Debt #94): Build litho is DISABLED when the active litho
  // model has zero contacts; tooltip points to the cross-section view.
  it('BL3b — Build litho is disabled with cross-section hint when no contacts', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoContacts: [],
    })
    renderToolbar(ctx)
    const btn = screen.getByRole('button', { name: /build litho/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    expect(btn.title).toMatch(/cross-section/i)
  })

  // BL4: When lithoStaleSurfaceCount > 0, the label shows the count.
  it('BL4 — stale count appears in button label when > 0', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoStaleSurfaceCount: 3,
    })
    renderToolbar(ctx)
    // Label: "Build litho · 3 stale" — getByRole matches any containing text.
    expect(screen.getByRole('button', { name: /build litho.*3 stale/i })).toBeInTheDocument()
  })
})

describe('LithologyToolbar Reset camera button', () => {
  // BL5a: Reset camera absent when no litho surfaces have vertices.
  it('BL5a — Reset camera absent when no built litho surfaces exist', () => {
    const ctx = makeCtx({ activeLithoModel: makeLithoModel() })
    renderToolbar(ctx)
    expect(screen.queryByRole('button', { name: /reset camera/i })).not.toBeInTheDocument()
  })

  // BL5b: Reset camera present when at least one surface has vertices.
  it('BL5b — Reset camera present when a built litho surface exists', () => {
    const surfaces = new Map([['f-1', makeSurface('f-1', true)]])
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoSurfacesByFormationId: surfaces,
    })
    renderToolbar(ctx)
    expect(screen.getByRole('button', { name: /reset camera/i })).toBeInTheDocument()
  })
})
