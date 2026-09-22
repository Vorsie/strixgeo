// Behavioral net for LithologyInspector.
//
// Claims pinned here (Slice C, #55 peer-stage scaffolding):
//   I1  When activeGeologicalModel is null: guidance to create a
//       geological model first is shown; no ModelKindPicker.
//   I2  When a litho model is active and formations/contacts exist:
//       the roster renders each formation row with its name and the
//       correct contact count for THIS model.
//   I4  A2 flat roster: litho units appear as a flat list ordered ascending
//       by display_order (oldest first). No parent-group headers or
//       “Unassigned” bucket. All unit rows are always visible regardless
//       of parent_formation_id.
//
// Claims pinned here (Resolve action):
//   S3  “Resolve instances” button refetches formations (roster refresh).
//
// Body-model migration (Task 11): the per-formation ordinal badge, the
// instance-ordinal lock toggle, and the RO-3 stale-ordinal badge were
// removed from the inspector (instance numbering is now per-body on the
// section). The S1/S2/S4 claims that pinned that obsolete chrome were
// deleted along with it.
//
// Pattern: render LithologyInspector inside a ShellContext.Provider —
// same approach as SectionsToolbar.axis.test.tsx.  ModelKindPicker and
// api are mocked so network calls do not bleed into these tests.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { RenderResult } from '@testing-library/react'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoBodySolidResponse,
} from '../../../api/client'
import LithologyInspector from './LithologyInspector'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// ModelKindPicker makes api calls internally (listModels, createModel, etc.).
// Mock it as a no-op div so the inspector tests are isolated.
vi.mock('./ModelKindPicker', () => ({
  default: () => <div data-testid="model-kind-picker" />,
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

// Mock api.geology so updateFormation and listLenses don't make real fetch
// calls in jsdom.
const mockUpdateFormation = vi.fn<() => Promise<GeologicalFormationResponse>>()
// listLenses: returns an empty lens list by default â€” keeps existing tests
// isolated; individual tests can override via mockListLenses.mockResolvedValue.
const mockListLenses = vi.fn<() => Promise<[]>>()

vi.mock('../../../api/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../api/client')>()
  return {
    ...orig,
    api: {
      ...((orig as Record<string, unknown>).api as object),
      geology: {
        ...(((orig as Record<string, unknown>).api as Record<string, unknown>).geology as object),
        updateFormation: (...args: unknown[]) => mockUpdateFormation(...(args as [])),
        listLenses: (...args: unknown[]) => mockListLenses(...(args as [])),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// Sentinel factories
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()

function makeGeoModel(): GeologicalModelResponse {
  return {
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
  }
}

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

function makeFormation(
  id: string,
  name: string,
  overrides?: Partial<GeologicalFormationResponse>,
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    color: '#aabbcc',
    code: null,
    display_order: 0,
    lithology: 'ZAND',
    nad_class: null,
    regional_ref: null,
    description: null,
    pinned_order: false,
    // Phase 1 litho-builder fields â€” null on geological-model rows.
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    // Slice 5 / debt #67: server-resolved parent name, null by default.
    parent_formation_name: null,
    // Debt #87: parent-extrapolated flag; default false.
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeContact(id: string, formationId: string): FormationContactResponse {
  return {
    id,
    model_id: 'litho-1',
    formation_id: formationId,
    borehole_id: 'bh-1',
    cpt_id: null,
    depth_top_m: 1.0,
    source: 'borehole_observation',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

// ---------------------------------------------------------------------------
// ShellContext stub factory
// ---------------------------------------------------------------------------

function makeCtx(overrides: {
  activeGeologicalModel?: GeologicalModelResponse | null
  activeLithoModel?: GeologicalModelResponse | null
  formations?: GeologicalFormationResponse[]
  lithoFormations?: GeologicalFormationResponse[]
  lithoContacts?: FormationContactResponse[]
  refetchFormations?: () => Promise<void>
  lithoSolids?: LithoBodySolidResponse[]
  setBodyColor?: (bodyId: string, color: string | null) => void
  hideMarkers?: boolean
  setHideMarkers?: (value: boolean) => void
  // Debt #65: excluded-boreholes list inputs.
  visibleBoreholes?: ShellContextValue['visibleBoreholes']
  handleToggleBoreholeInLithoModel?: (boreholeId: string, included: boolean) => Promise<void>
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
    visibleBoreholes: overrides.visibleBoreholes ?? [],
    geoModel: {
      activeGeologicalModel: 'activeGeologicalModel' in overrides
        ? (overrides.activeGeologicalModel ?? null)
        : makeGeoModel(),
      models: [],
      activeLithoModel: overrides.activeLithoModel ?? null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: noopAsync,
      handleDeleteLithoModel: noopAsync,
      lithoContacts: overrides.lithoContacts ?? [],
      lithoLayers: [],
      lithoFormations: overrides.lithoFormations ?? [],
      lithoSurfacesByFormationId: new Map(),
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
      formations: overrides.formations ?? [],
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
      refetchFormations: overrides.refetchFormations ?? vi.fn().mockResolvedValue(undefined),
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
      handleToggleBoreholeInLithoModel:
        overrides.handleToggleBoreholeInLithoModel ?? noopAsync,
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
      hasLithoSolids: false,
      hasStaleLithoSolid: false,
      buildLithoSolids: noopAsync,
      startLithoBuild: async () => {},
      cancelLithoBuild: () => {},
      voxelBuildState: { status: 'idle' as const },
      setBodyColor: overrides.setBodyColor ?? vi.fn(),
      hideMarkers: overrides.hideMarkers ?? false,
      setHideMarkers: overrides.setHideMarkers ?? vi.fn(),
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
      <LithologyInspector />
    </ShellContext.Provider>,
  )
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  mockUpdateFormation.mockResolvedValue(makeFormation('f-a', 'Zand'))
  // Default: no lenses â€” keeps existing tests isolated.
  mockListLenses.mockResolvedValue([])
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Slice C / #55 tests (I1â€“I4)
// ---------------------------------------------------------------------------

describe('LithologyInspector (Slice C, #55)', () => {
  // I1: no geological model â†’ guidance to create one; no ModelKindPicker.
  it('I1 â€” no geological model: shows "create a stratigraphic model first" guidance', () => {
    const ctx = makeCtx({ activeGeologicalModel: null })
    renderInspector(ctx)

    expect(screen.getByText(/create a stratigraphic model first/i)).toBeInTheDocument()
    // ModelKindPicker should NOT render â€” the geological model gate fires first.
    expect(screen.queryByTestId('model-kind-picker')).not.toBeInTheDocument()
  })

  // I2: litho model active + formations + contacts â†’ roster with correct counts.
  it('I2 â€” litho model + 2 formations + 3 contacts â†’ roster with per-formation counts', () => {
    const formA = makeFormation('f-a', 'Zand')
    const formB = makeFormation('f-b', 'Klei')
    const contacts = [
      makeContact('c1', 'f-a'),
      makeContact('c2', 'f-a'),
      makeContact('c3', 'f-b'),
    ]
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [formA, formB],
      lithoContacts: contacts,
    })
    renderInspector(ctx)

    // Formation rows rendered.
    expect(screen.getByTestId('litho-formation-row-f-a')).toBeInTheDocument()
    expect(screen.getByTestId('litho-formation-row-f-b')).toBeInTheDocument()

    // Names rendered.
    expect(screen.getByText('Zand')).toBeInTheDocument()
    expect(screen.getByText('Klei')).toBeInTheDocument()

    // Workflow footer is present.
    expect(
      screen.getByText(/draw contacts on sections, then build/i),
    ).toBeInTheDocument()
  })

  // I4 (A2 flat roster): units appear in display_order-ascending order
  // regardless of parent_formation_id. No group headers, no “Unassigned”
  // bucket — all units are always directly visible in the flat list.
  it('I4 — A2 flat roster: units ordered by display_order, no group headers', () => {
    // Three units with display_order deliberately scrambled.
    const unitA = makeFormation('lf-a', 'Zand', { display_order: 2, parent_formation_id: null })
    const unitB = makeFormation('lf-b', 'Klei', { display_order: 0, parent_formation_id: null })
    const unitC = makeFormation('lf-c', 'Veen', { display_order: 1, parent_formation_id: null })

    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [unitA, unitB, unitC],
      lithoContacts: [
        makeContact('c-a', 'lf-a'),
        makeContact('c-b', 'lf-b'),
        makeContact('c-c', 'lf-c'),
      ],
    })
    renderInspector(ctx)

    // All three unit rows are present.
    expect(screen.getByTestId('litho-formation-row-lf-a')).toBeInTheDocument()
    expect(screen.getByTestId('litho-formation-row-lf-b')).toBeInTheDocument()
    expect(screen.getByTestId('litho-formation-row-lf-c')).toBeInTheDocument()

    // No “Unassigned” group header.
    expect(screen.queryByText('Unassigned')).not.toBeInTheDocument()

    // Rows appear in ascending display_order: B(0) < C(1) < A(2).
    const rows = screen.getAllByTestId(/^litho-formation-row-/)
    const ids = rows.map(r => r.getAttribute('data-testid'))
    expect(ids).toEqual([
      'litho-formation-row-lf-b',
      'litho-formation-row-lf-c',
      'litho-formation-row-lf-a',
    ])
  })
})

// ---------------------------------------------------------------------------
// Resolve action (S3)
// ---------------------------------------------------------------------------

describe('LithologyInspector (Resolve action)', () => {
  // S3: the Resolve button refetches formations (roster refresh). Instance
  // ordinals are resolved server-side per-body on accept; this button no
  // longer triggers re-numbering or fetches correlation edges.
  it('S3 â€” Resolve instances button calls refetchFormations', async () => {
    const refetchFormations = vi.fn()

    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      refetchFormations,
    })
    renderInspector(ctx)

    const resolveBtn = screen.getByTestId('resolve-instances-btn')
    await act(async () => {
      fireEvent.click(resolveBtn)
    })

    await waitFor(() => {
      expect(refetchFormations).toHaveBeenCalled()
    })
  })
})

// ---------------------------------------------------------------------------
// Debt #87 â€” parent-review badge + ConfirmParentDialog flow
// ---------------------------------------------------------------------------

describe('LithologyInspector (debt #87 â€” parent review)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateFormation.mockResolvedValue(makeFormation('any', 'any'))
  })
  afterEach(() => {
    cleanup()
  })

  // P1: rows without parent_extrapolated AND with a parent are NOT badged.
  it('P1 â€” clean rows do not render the parent-review dot', async () => {
    const parent = makeFormation('geo-a', 'Boom Klei', { lithology: null })
    const litho = makeFormation('lit-a', 'Zand', {
      parent_formation_id: 'geo-a',
      parent_extrapolated: false,
      litho_main_soil_code: 'ZAND',
    })
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      formations: [parent, litho],
      lithoFormations: [litho],
      lithoContacts: [makeContact('c1', 'lit-a')],
    })
    renderInspector(ctx)
    await waitFor(() => {
      expect(screen.getByTestId('litho-formation-row-lit-a')).toBeInTheDocument()
    })
    expect(screen.queryByTestId('parent-review-lit-a')).not.toBeInTheDocument()
  })

  // P2: parent_extrapolated rows render the dot AND open the dialog.
  it('P2 â€” extrapolated rows render the dot and open the confirm dialog', async () => {
    const parent = makeFormation('geo-a', 'Boom Klei', { lithology: null })
    const litho = makeFormation('lit-a', 'Zand', {
      parent_formation_id: 'geo-a',
      parent_extrapolated: true,
      litho_main_soil_code: 'ZAND',
    })
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      formations: [parent, litho],
      lithoFormations: [litho],
      lithoContacts: [makeContact('c1', 'lit-a')],
    })
    renderInspector(ctx)
    await waitFor(() => {
      expect(screen.getByTestId('parent-review-lit-a')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByTestId('parent-review-lit-a'))
    expect(screen.getByTestId('confirm-parent-select')).toBeInTheDocument()
  })

  // P3: submitting the dialog PATCHes parent_extrapolated=false + parent_formation_id.
  it('P3 â€” Confirm submits parent_extrapolated=false + the chosen parent id', async () => {
    const parent = makeFormation('geo-a', 'Boom Klei', { lithology: null })
    const litho = makeFormation('lit-a', 'Zand', {
      parent_formation_id: 'geo-a',
      parent_extrapolated: true,
      litho_main_soil_code: 'ZAND',
    })
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      formations: [parent, litho],
      lithoFormations: [litho],
      lithoContacts: [makeContact('c1', 'lit-a')],
    })
    renderInspector(ctx)
    fireEvent.click(await screen.findByTestId('parent-review-lit-a'))
    await act(async () => {
      fireEvent.click(screen.getByTestId('confirm-parent-submit'))
    })
    expect(mockUpdateFormation).toHaveBeenCalledWith(
      'proj-1',
      'lit-a',
      { parent_formation_id: 'geo-a', parent_extrapolated: false },
    )
  })

})

// ---------------------------------------------------------------------------
// Debt #94 â€” committed-contacts pill + wipe confirm flow
// ---------------------------------------------------------------------------

describe('LithologyInspector (debt #94 â€” wipe committed contacts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockUpdateFormation.mockResolvedValue(makeFormation('any', 'any'))
  })
  afterEach(() => {
    cleanup()
  })

  // W1: pill is absent when BOTH contacts AND formations are empty.
  it('W1 â€” clear-model pill is absent when lithoContacts and lithoFormations are both empty', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoContacts: [],
      lithoFormations: [],
    })
    renderInspector(ctx)
    expect(screen.queryByTestId('litho-committed-pill')).not.toBeInTheDocument()
  })

  // W1b: pill IS visible when contacts are empty but litho formations remain
  // (the "orphan units" broken state the old contact-only wipe left behind).
  it('W1b â€” clear-model pill is visible when lithoFormations.length > 0 even if contacts are empty', async () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoContacts: [],
      lithoFormations: [makeFormation('f-a', 'ZAND')],
    })
    renderInspector(ctx)
    const pill = await screen.findByTestId('litho-committed-pill')
    expect(pill).toBeInTheDocument()
  })

  // W2: pill renders and shows contact + unit counts when contacts exist.
  it('W2 â€” clear-model pill renders with correct counts when lithoContacts.length > 0', async () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoContacts: [makeContact('c1', 'f-a'), makeContact('c2', 'f-a'), makeContact('c3', 'f-b')],
      lithoFormations: [makeFormation('f-a', 'ZAND'), makeFormation('f-b', 'KLEI')],
    })
    renderInspector(ctx)
    const pill = await screen.findByTestId('litho-committed-pill')
    expect(pill).toBeInTheDocument()
    expect(pill).toHaveTextContent(/3 contact/i)
    expect(pill).toHaveTextContent(/2 unit/i)
  })

  // W3: singular wording for both when exactly one contact + one formation.
  it('W3 â€” pill uses singular wording when lithoContacts.length is 1 and lithoFormations.length is 1', async () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoContacts: [makeContact('c1', 'f-a')],
      lithoFormations: [makeFormation('f-a', 'ZAND')],
    })
    renderInspector(ctx)
    const pill = await screen.findByTestId('litho-committed-pill')
    expect(pill).toHaveTextContent(/1 contact/i)
    expect(pill).toHaveTextContent(/1 unit/i)
  })

  // W4: clicking the Wipe button opens the confirm dialog.
  it('W4 â€” clicking the Wipe button opens the confirm dialog', async () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoContacts: [makeContact('c1', 'f-a'), makeContact('c2', 'f-b')],
    })
    renderInspector(ctx)

    const wipeBtn = await screen.findByTestId('wipe-litho-contacts-btn')
    await act(async () => {
      fireEvent.click(wipeBtn)
    })

    expect(screen.getByTestId('wipe-litho-contacts-confirm-btn')).toBeInTheDocument()
  })

  // W5: clicking Cancel in the confirm dialog closes it without calling the handler.
  it('W5 â€” Cancel closes the dialog without invoking handleClearLithoModel', async () => {
    const wipeSpy = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoContacts: [makeContact('c1', 'f-a')],
    })
    // Override the handler directly in the geoModel mock.
    ctx.geoModel.handleClearLithoModel = wipeSpy

    renderInspector(ctx)

    await act(async () => {
      fireEvent.click(await screen.findByTestId('wipe-litho-contacts-btn'))
    })

    // Confirm dialog is open; click Cancel.
    const cancelBtn = screen.getByRole('button', { name: /cancel/i })
    await act(async () => {
      fireEvent.click(cancelBtn)
    })

    expect(wipeSpy).not.toHaveBeenCalled()
    // Dialog dismissed.
    expect(screen.queryByTestId('wipe-litho-contacts-confirm-btn')).not.toBeInTheDocument()
  })

  // CM1 (debt #147 follow-up, 2026-05-27): roster is empty when the
  // active model has no contacts, even if the project's litho
  // vocabulary still carries formation rows from a sibling/old
  // model.  The Clear-pill stays visible (orphan-recovery affordance)
  // but the roster honours the "0 contacts, 0 units" pill exactly.
  it('CM1 â€” roster is empty when active model has 0 contacts even if lithoFormations is populated', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [
        makeFormation('orphan-1', 'Old Zand'),
        makeFormation('orphan-2', 'Old Klei'),
      ],
      lithoContacts: [],
    })
    renderInspector(ctx)

    // No formation rows.
    expect(screen.queryByTestId('litho-formation-row-orphan-1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('litho-formation-row-orphan-2')).not.toBeInTheDocument()
    // Empty-state message visible instead.
    expect(screen.getByText(/no litho units in this model yet/i)).toBeInTheDocument()
    // Clear pill still reachable so orphans can be wiped.
    expect(screen.getByTestId('litho-committed-pill')).toBeInTheDocument()
  })

  // CM2: roster shows ONLY formations with at least one contact in
  // the active model, even if other formations exist in the project.
  it('CM2 â€” roster filters lithoFormations down to those referenced by contacts', () => {
    const used = makeFormation('used', 'Used Zand')
    const orphan = makeFormation('orphan', 'Orphan Klei')
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [used, orphan],
      lithoContacts: [makeContact('c1', 'used')],
    })
    renderInspector(ctx)

    expect(screen.getByTestId('litho-formation-row-used')).toBeInTheDocument()
    expect(screen.queryByTestId('litho-formation-row-orphan')).not.toBeInTheDocument()
  })

  // W6: confirming the dialog calls handleClearLithoModel.
  it('W6 â€” confirming the dialog calls handleClearLithoModel', async () => {
    const wipeSpy = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoContacts: [makeContact('c1', 'f-a'), makeContact('c2', 'f-b')],
    })
    ctx.geoModel.handleClearLithoModel = wipeSpy

    renderInspector(ctx)

    await act(async () => {
      fireEvent.click(await screen.findByTestId('wipe-litho-contacts-btn'))
    })

    const confirmBtn = screen.getByTestId('wipe-litho-contacts-confirm-btn')
    await act(async () => {
      fireEvent.click(confirmBtn)
    })

    await waitFor(() => {
      expect(wipeSpy).toHaveBeenCalledTimes(1)
    })
  })
})

// ---------------------------------------------------------------------------
// LithoSolidLegend — grouped body solids section (lifted from canvas overlay)
// ---------------------------------------------------------------------------

function makeSolid(
  bodyId: string,
  formationId: string,
  bodyOrdinal = 1,
  overrides: Partial<LithoBodySolidResponse> = {},
): LithoBodySolidResponse {
  return {
    id: `solid-${bodyId}`,
    model_id: 'litho-1',
    body_id: bodyId,
    formation_id: formationId,
    body_ordinal: bodyOrdinal,
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

describe('LithoSolidLegend — grouped-by-lithology body solids section', () => {
  // SL1: empty state when no solids — shows "Build the 3D model" prompt.
  it('SL1 — empty state message when no solids built yet', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoSolids: [],
    })
    renderInspector(ctx)
    expect(screen.getByTestId('litho-solid-legend')).toBeInTheDocument()
    expect(screen.getByText(/build the 3d model/i)).toBeInTheDocument()
  })

  // SL2: group header shows name, body count, and marker count for flagged bodies.
  //   Given 2 formations (SILT: 3 bodies, 1 flagged) + (ZAND: 1 body, 0 flagged):
  //   - SILT group header shows "3 bodies" and "(1 marker)"
  //   - ZAND group header shows "1 body" with no "(0 markers)" text
  it('SL2 — group header shows correct body count and marker count', () => {
    const silt = makeFormation('f-silt', 'SILT', { display_order: 1, color: '#aaaaaa' })
    const zand = makeFormation('f-zand', 'ZAND', { display_order: 2, color: '#bbbbbb' })
    const solids = [
      makeSolid('b-s1', 'f-silt', 1),
      makeSolid('b-s2', 'f-silt', 2),
      makeSolid('b-s3', 'f-silt', 3, { is_flagged: true }),
      makeSolid('b-z1', 'f-zand', 1),
    ]
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [silt, zand],
      lithoSolids: solids,
    })
    renderInspector(ctx)

    // Both group headers visible.
    const siltHeader = screen.getByTestId('solid-group-header-f-silt')
    const zandHeader = screen.getByTestId('solid-group-header-f-zand')

    expect(siltHeader).toBeInTheDocument()
    expect(siltHeader).toHaveTextContent(/3 bod/i)
    expect(siltHeader).toHaveTextContent(/1 marker/i)

    expect(zandHeader).toBeInTheDocument()
    expect(zandHeader).toHaveTextContent(/1 body/i)
    expect(zandHeader).not.toHaveTextContent(/marker/i)
  })

  // SL3: per-body rows visible after expanding a group; stale dot + flagged icon present.
  it('SL3 — per-body rows rendered with stale dot and flagged icon when set', () => {
    const silt = makeFormation('f-silt', 'SILT', { display_order: 1 })
    const solids = [
      makeSolid('b-stale', 'f-silt', 1, { is_stale: true }),
      makeSolid('b-flagged', 'f-silt', 2, { is_flagged: true }),
    ]
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [silt],
      lithoSolids: solids,
    })
    renderInspector(ctx)

    // The group (2 bodies, ≤8) should be expanded by default.
    expect(screen.getByTestId('solid-legend-row-b-stale')).toBeInTheDocument()
    expect(screen.getByTestId('solid-legend-row-b-flagged')).toBeInTheDocument()

    // Stale dot on the stale row.
    const staleRow = screen.getByTestId('solid-legend-row-b-stale')
    expect(staleRow.textContent).toMatch(/•/)

    // Flagged icon on the flagged row — AlertTriangle renders an <svg> inside a span.
    const flaggedRow = screen.getByTestId('solid-legend-row-b-flagged')
    expect(flaggedRow.querySelector('svg')).not.toBeNull()
  })

  // SL5: groups expand after ASYNC arrival of solids.
  //
  // The legend's expand state must initialise to "open for small groups" even
  // when lithoSolids arrives asynchronously (empty on first render, then
  // populated).  The lazy useState(() => new Set(groups.filter(...))) captures
  // an empty Set on mount and never updates — this test pins the fixed behaviour.
  //
  // Protocol: render with empty solids first, then rerender with populated
  // solids, assert the small group (≤8 bodies) is EXPANDED (body rows visible).
  it('SL5 — small group expands after async arrival of solids (empty → populated)', async () => {
    const silt = makeFormation('f-silt', 'SILT', { display_order: 1 })
    const solids = [
      makeSolid('b1', 'f-silt', 1),
      makeSolid('b2', 'f-silt', 2),
    ]

    // Start: no solids — simulates the async-load window.
    let renderResult: RenderResult
    await act(async () => {
      renderResult = renderInspector(
        makeCtx({
          activeLithoModel: makeLithoModel(),
          lithoFormations: [silt],
          lithoSolids: [],
        }),
      )
    })

    // Body rows must NOT be present yet (no solids, empty state).
    expect(screen.queryByTestId('solid-legend-row-b1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('solid-legend-row-b2')).not.toBeInTheDocument()

    // Simulate async arrival: rerender with populated solids.
    await act(async () => {
      renderResult!.rerender(
        <ShellContext.Provider
          value={makeCtx({
            activeLithoModel: makeLithoModel(),
            lithoFormations: [silt],
            lithoSolids: solids,
          })}
        >
          <LithologyInspector />
        </ShellContext.Provider>,
      )
    })

    // The group has 2 bodies (≤ LEGEND_COLLAPSE_THRESHOLD=8), so it MUST be
    // expanded automatically — body rows visible without any user interaction.
    await waitFor(() => {
      expect(screen.getByTestId('solid-legend-row-b1')).toBeInTheDocument()
    })
    expect(screen.getByTestId('solid-legend-row-b2')).toBeInTheDocument()
  })

  // SL4: colour picker fires setBodyColor with null when Reset button clicked.
  it('SL4 — Reset button calls setBodyColor(bodyId, null)', async () => {
    const setColor = vi.fn()
    const silt = makeFormation('f-silt', 'SILT', { display_order: 1 })
    const solid = makeSolid('b-color', 'f-silt', 1, { display_color: '#ff0000' })
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [silt],
      lithoSolids: [solid],
      setBodyColor: setColor,
    })
    renderInspector(ctx)

    const resetBtn = screen.getByTestId('solid-color-reset-b-color')
    await act(async () => {
      fireEvent.click(resetBtn)
    })

    expect(setColor).toHaveBeenCalledWith('b-color', null)
  })
})

// ---------------------------------------------------------------------------
// Hide-markers toggle — BS1–BS4
// ---------------------------------------------------------------------------

describe('LithoSolidLegend — hide-markers toggle (BS1–BS4)', () => {
  // BS1: hideMarkers=false (default) — all body rows visible, no "(N markers hidden)" note.
  it('BS1 — hideMarkers false: all body rows visible, no "hidden" note', () => {
    const silt = makeFormation('f-silt', 'SILT', { display_order: 1 })
    const solids = [
      makeSolid('b-real', 'f-silt', 1, { is_flagged: false }),
      makeSolid('b-marker', 'f-silt', 2, { is_flagged: true }),
    ]
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [silt],
      lithoSolids: solids,
      hideMarkers: false,
    })
    renderInspector(ctx)

    // Both body rows present.
    expect(screen.getByTestId('solid-legend-row-b-real')).toBeInTheDocument()
    expect(screen.getByTestId('solid-legend-row-b-marker')).toBeInTheDocument()

    // No "hidden" note on the header.
    expect(screen.queryByTestId('solid-group-markers-hidden-f-silt')).not.toBeInTheDocument()
    // "(1 marker)" present (unflagged display mode).
    expect(screen.getByTestId('solid-group-header-f-silt')).toHaveTextContent(/1 marker/i)
  })

  // BS2: hideMarkers=true — marker rows gone, real rows remain, header shows "(N markers hidden)".
  it('BS2 — hideMarkers true: marker rows hidden, real rows present, header note shows count', () => {
    const silt = makeFormation('f-silt', 'SILT', { display_order: 1 })
    const solids = [
      makeSolid('b-real', 'f-silt', 1, { is_flagged: false }),
      makeSolid('b-marker1', 'f-silt', 2, { is_flagged: true }),
      makeSolid('b-marker2', 'f-silt', 3, { is_flagged: true }),
    ]
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [silt],
      lithoSolids: solids,
      hideMarkers: true,
    })
    renderInspector(ctx)

    // Real body row still visible.
    expect(screen.getByTestId('solid-legend-row-b-real')).toBeInTheDocument()
    // Marker rows gone.
    expect(screen.queryByTestId('solid-legend-row-b-marker1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('solid-legend-row-b-marker2')).not.toBeInTheDocument()

    // Header note shows "(2 markers hidden)".
    const hiddenNote = screen.getByTestId('solid-group-markers-hidden-f-silt')
    expect(hiddenNote).toBeInTheDocument()
    expect(hiddenNote).toHaveTextContent(/2 markers hidden/i)

    // Header still shows total body count (3 bodies).
    expect(screen.getByTestId('solid-group-header-f-silt')).toHaveTextContent(/3 bod/i)
  })

  // BS3: all-markers group — hideMarkers true keeps the header visible (honest) with "(N markers hidden)".
  it('BS3 — all-markers group: header kept with hidden note, body list empty', () => {
    const silt = makeFormation('f-silt', 'SILT', { display_order: 1 })
    const solids = [
      makeSolid('b-m1', 'f-silt', 1, { is_flagged: true }),
      makeSolid('b-m2', 'f-silt', 2, { is_flagged: true }),
    ]
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [silt],
      lithoSolids: solids,
      hideMarkers: true,
    })
    renderInspector(ctx)

    // Group header still rendered.
    expect(screen.getByTestId('solid-group-header-f-silt')).toBeInTheDocument()
    // "(2 markers hidden)" note present.
    const note = screen.getByTestId('solid-group-markers-hidden-f-silt')
    expect(note).toHaveTextContent(/2 markers hidden/i)

    // No body rows.
    expect(screen.queryByTestId('solid-legend-row-b-m1')).not.toBeInTheDocument()
    expect(screen.queryByTestId('solid-legend-row-b-m2')).not.toBeInTheDocument()
  })

  // BS4: toggle button calls setHideMarkers with the inverse of the current state.
  it('BS4 — toggle button calls setHideMarkers with !current value', async () => {
    const setHideMarkers = vi.fn()
    const silt = makeFormation('f-silt', 'SILT', { display_order: 1 })
    const solids = [
      makeSolid('b-real', 'f-silt', 1, { is_flagged: false }),
      makeSolid('b-flag', 'f-silt', 2, { is_flagged: true }),
    ]
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [silt],
      lithoSolids: solids,
      hideMarkers: false,
      setHideMarkers,
    })
    renderInspector(ctx)

    const toggle = screen.getByTestId('hide-markers-toggle')
    await act(async () => {
      fireEvent.click(toggle)
    })

    // Called with true (toggled from false).
    expect(setHideMarkers).toHaveBeenCalledWith(true)
  })
})


// ---------------------------------------------------------------------------
// Debt #65 — excluded-boreholes list
// ---------------------------------------------------------------------------

/** Minimal borehole list item — only id + name are read by the inspector. */
function makeBorehole(id: string, name: string): ShellContextValue['visibleBoreholes'][number] {
  return {
    id,
    name,
    test_id: id,
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
  }
}

describe('LithologyInspector (debt #65 — excluded boreholes)', () => {
  it('lists the boreholes excluded from the active litho model by name', () => {
    const ctx = makeCtx({
      activeLithoModel: { ...makeLithoModel(), excluded_borehole_ids: ['bh-1'] },
      visibleBoreholes: [makeBorehole('bh-1', 'Borehole A'), makeBorehole('bh-2', 'Borehole B')],
    })
    renderInspector(ctx)

    expect(screen.getByTestId('litho-excluded-boreholes')).toBeTruthy()
    expect(screen.getByText('Borehole A')).toBeTruthy()
    // bh-2 is not excluded, so it does not appear in this list.
    expect(screen.queryByText('Borehole B')).toBeNull()
    expect(screen.getByTestId('litho-include-borehole-bh-1')).toBeTruthy()
  })

  it('shows no excluded-boreholes section when the litho model excludes nothing', () => {
    const ctx = makeCtx({
      activeLithoModel: { ...makeLithoModel(), excluded_borehole_ids: [] },
      visibleBoreholes: [makeBorehole('bh-1', 'Borehole A')],
    })
    renderInspector(ctx)

    expect(screen.queryByTestId('litho-excluded-boreholes')).toBeNull()
  })

  it('Include again re-includes the borehole in the litho model (included = true)', () => {
    const handleToggleBoreholeInLithoModel = vi.fn().mockResolvedValue(undefined)
    const ctx = makeCtx({
      activeLithoModel: { ...makeLithoModel(), excluded_borehole_ids: ['bh-1'] },
      visibleBoreholes: [makeBorehole('bh-1', 'Borehole A')],
      handleToggleBoreholeInLithoModel,
    })
    renderInspector(ctx)

    fireEvent.click(screen.getByTestId('litho-include-borehole-bh-1'))

    expect(handleToggleBoreholeInLithoModel).toHaveBeenCalledTimes(1)
    expect(handleToggleBoreholeInLithoModel).toHaveBeenCalledWith('bh-1', true)
  })

  // The remaining half of #65: the in-UI EXCLUDE gesture, mirroring the
  // geological stage's "Boreholes in model" checkbox roster. Excluding a
  // borehole from the litho stage removes it from the model immediately (a
  // reversible action, no confirm dialog) and it appears in the excluded list
  // with "Include again".
  it('excluding a borehole in "Boreholes in model" fires handleToggleBoreholeInLithoModel(id, false), then it appears in the excluded list with Include again', () => {
    const handleToggleBoreholeInLithoModel = vi.fn().mockResolvedValue(undefined)
    const boreholes = [makeBorehole('bh-1', 'Borehole A'), makeBorehole('bh-2', 'Borehole B')]
    // Start: bh-1 is IN the litho model (nothing excluded).
    const rr = renderInspector(
      makeCtx({
        activeLithoModel: { ...makeLithoModel(), excluded_borehole_ids: [] },
        visibleBoreholes: boreholes,
        handleToggleBoreholeInLithoModel,
      }),
    )

    // The exclude gesture lives in the "Boreholes in model" roster — expand it,
    // then uncheck bh-1 to exclude it from the litho build.
    fireEvent.click(screen.getByTestId('litho-boreholes-in-model-toggle'))
    fireEvent.click(screen.getByTestId('litho-borehole-in-model-bh-1'))
    expect(handleToggleBoreholeInLithoModel).toHaveBeenCalledWith('bh-1', false)

    // The real handler updates the model optimistically; simulate that state and
    // confirm bh-1 now shows in the excluded list with an "Include again" undo.
    rr.rerender(
      <ShellContext.Provider
        value={makeCtx({
          activeLithoModel: { ...makeLithoModel(), excluded_borehole_ids: ['bh-1'] },
          visibleBoreholes: boreholes,
          handleToggleBoreholeInLithoModel,
        })}
      >
        <LithologyInspector />
      </ShellContext.Provider>,
    )
    expect(screen.getByTestId('litho-excluded-boreholes')).toBeInTheDocument()
    expect(screen.getByTestId('litho-include-borehole-bh-1')).toBeInTheDocument()
  })
})
