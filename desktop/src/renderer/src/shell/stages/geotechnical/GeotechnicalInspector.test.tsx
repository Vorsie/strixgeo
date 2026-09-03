// Behavioral net for GeotechnicalInspector (F5 — geotech units roster).
//
// The roster is now soil ▸ litho body ▸ packing body (owner ruling 2026-08-31);
// its detailed rendering is pinned in GeotechnicalUnitRoster.test.tsx (which
// drives the roster with props directly). This file pins the INSPECTOR-level
// concerns that surround it:
//   R4  Empty state renders when geotechFormations is empty.
//   SB  The selected-body panel (packing-class name + NAD number, the raw
//       assignment-source token as a title, the CPT-estimate disclaimer).
//   INT The roster integration: the geotech-body + LITHO-body rosters (debt #278
//       D2) fetch and thread into the three-level tree, and a colour edit on a
//       packing leaf PATCHes the body's HOME geotech unit.
//
// Pattern: render GeotechnicalInspector inside a ShellContext.Provider —
// mirrors LithologyInspector.test.tsx.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  BodyListItem,
  BodyUnionListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoLayerConfidence,
  LithoLayerResponse,
} from '../../../api/client'
import GeotechnicalInspector from './GeotechnicalInspector'
import { selectGeotechBody } from '../../../utils/geotechBodySelectionStore'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

vi.mock('../../../utils/log', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const updateFormation = vi.fn(async (_p: string, id: string, body: unknown) => ({ id, body }))
// useModelBodies fetches through listLenses (one call per model id); the union
// effect fetches through listBodyUnions. Both default to empty and are
// configured per test that needs the roster to render leaves.
const listLenses = vi.fn(async (_p: string, _modelId: string): Promise<BodyListItem[]> => [])
const listBodyUnions = vi.fn(
  async (_p: string, _modelId: string): Promise<BodyUnionListItem[]> => [],
)

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    api: {
      geology: {
        updateFormation: (...args: unknown[]) =>
          updateFormation(...(args as [string, string, unknown])),
        listLenses: (...args: unknown[]) => listLenses(...(args as [string, string])),
        listBodyUnions: (...args: unknown[]) => listBodyUnions(...(args as [string, string])),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// Sentinel factories
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()

/** Build a minimal GeologicalFormationResponse for testing. */
function makeFormation(
  id: string,
  overrides?: Partial<GeologicalFormationResponse>,
): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: `Formation ${id}`,
    color: '#aabbcc',
    code: null,
    display_order: 0,
    lithology: 'ZAND',
    nad_class: null,
    regional_ref: null,
    description: null,
    pinned_order: false,
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
    ...overrides,
  }
}

/** Build a minimal LithoLayerResponse for testing. */
let _layerSeq = 0
function makeLayer(formationId: string, confidence: LithoLayerConfidence): LithoLayerResponse {
  _layerSeq += 1
  return {
    id: `layer-${_layerSeq}`,
    model_id: 'geotech-1',
    formation_id: formationId,
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: 1.0,
    depth_base_m: 3.0,
    status: 'accepted',
    source: 'segmenter',
    confidence,
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/** Build a minimal FormationContactResponse for testing. */
function makeContact(id: string, formationId: string): FormationContactResponse {
  return {
    id,
    model_id: 'geotech-1',
    formation_id: formationId,
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: 1.0,
    source: 'manual_pick',
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
  geotechFormations?: GeologicalFormationResponse[]
  geotechContacts?: FormationContactResponse[]
  geotechLayers?: LithoLayerResponse[]
  /** Litho units — the roster composes the L2 litho-body label from these. */
  lithoFormations?: GeologicalFormationResponse[]
  /** Active models — non-null makes the roster fetch its body rosters + unions. */
  activeGeotechModel?: GeologicalModelResponse | null
  activeLithoModel?: GeologicalModelResponse | null
  /** The geotech Build's roster refetch nonce — bumping it re-reads the roster. */
  geotechBodyRosterRefetchNonce?: number
} = {}): ShellContextValue {
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
      activeLithoModel: overrides.activeLithoModel ?? null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: noopAsync,
      handleDeleteLithoModel: noopAsync,
      lithoContacts: [],
      lithoLayers: [],
      lithoFormations: overrides.lithoFormations ?? [],
      lithoSurfacesByFormationId: new Map(),
      lithoStaleSurfaceCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      activeGeotechModel: overrides.activeGeotechModel ?? null,
      geotechLayers: overrides.geotechLayers ?? [],
      geotechLayersLoaded: true,
      geotechLayersVersion: 0,
      geotechContacts: overrides.geotechContacts ?? [],
      geotechFormations: overrides.geotechFormations ?? [],
      columnsNeedingRederive: [],
      handleCreateManualLithoGhost: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
      markMutated: vi.fn(),
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
      geotechBodyRosterRefetchNonce: overrides.geotechBodyRosterRefetchNonce ?? 0,
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
      sectionModelAxis: 'geotechnical' as const,
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
      <GeotechnicalInspector />
    </ShellContext.Provider>,
  )
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  // Reset the selection store so tests that set a selection don't bleed.
  selectGeotechBody(null)
  updateFormation.mockClear()
  listLenses.mockReset()
  listLenses.mockImplementation(async () => [])
  listBodyUnions.mockReset()
  listBodyUnions.mockImplementation(async () => [])
})

afterEach(() => {
  consoleErrorSpy.mockRestore()
  cleanup()
  selectGeotechBody(null)
})

// ---------------------------------------------------------------------------
// R4 — Empty state
// ---------------------------------------------------------------------------

describe('GeotechnicalInspector empty state (R4)', () => {
  it('shows "No geotech units yet" when geotechFormations is empty', () => {
    renderInspector(makeCtx({ geotechFormations: [], geotechContacts: [] }))
    expect(screen.getByText(/No geotech units yet/i)).toBeTruthy()
    expect(screen.queryByRole('list', { name: /geotechnical soil groups/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// SB — the selected-body panel (S2 / S3)
//
// The panel reads the selected body's layer + formation directly, independent
// of the roster tree, so these stay inspector-level. The roster's own rendering
// (soil ▸ litho body ▸ packing body, the selection ring, the badges, the colour
// swatch) is pinned in GeotechnicalUnitRoster.test.tsx.
// ---------------------------------------------------------------------------

describe('GeotechnicalInspector selected-body panel (SB)', () => {
  it('S2 — shows the packing-class name + NAD number for the selected body', () => {
    // NAD class 6 = "SAND, medium dense" in nadClassName.
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    const layer = makeLayer('f-1', 'high')
    ;(layer as unknown as { body_id: string }).body_id = 'body-s2'

    selectGeotechBody({ bodyId: 'body-s2', assignmentSource: 'cpt_interpolated' })
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [], geotechLayers: [layer] }),
    )

    const label = screen.getByTestId('geotech-sample-source-formation')
    expect(label.textContent).toContain('SAND, medium dense')
    expect(label.textContent).toContain('NAD 6')
  })

  it('S3 — the assignment-source label carries the raw token as a title', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    selectGeotechBody({ bodyId: 'body-s3', assignmentSource: 'body_min' })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

    const panel = screen.getByTestId('geotech-sample-source')
    const raw = panel.querySelector('[title="body_min"]')
    expect(raw).not.toBeNull()
    // Translated at the presentation boundary.
    expect(raw?.textContent).toContain('Body minimum')
  })

  it('SB-disclaimer — the CPT-derived-estimate disclaimer is always present', () => {
    renderInspector(
      makeCtx({
        geotechFormations: [makeFormation('f-1', { nad_class: 6, display_order: 0 })],
        geotechContacts: [],
      }),
    )
    expect(screen.getByText(/CPT-derived estimates/i)).toBeTruthy()
  })
})

// ---------------------------------------------------------------------------
// INT — the roster integration (D2 fetch + D3 tree + colour PATCH wiring)
//
// With the active models set, the inspector fetches the geotech model's bodies
// (the L3 leaves), the LITHO model's bodies (the L2 nodes, debt #278 D2) and the
// manual unions (the D4 tag). These pin that the two fetches thread through into
// the three-level roster and that a colour edit on a leaf PATCHes the body's home
// geotech unit.
// ---------------------------------------------------------------------------

/** A body roster row (geotech or litho) with the fields the roster reads. */
function makeBody(overrides: Partial<BodyListItem>): BodyListItem {
  return {
    id: 'b1',
    app_project_id: 'proj-1',
    model_id: 'geotech-1',
    formation_id: 'f-1',
    body_ordinal: 0,
    source_investigation_id: 'inv',
    name: null,
    primary_section_id: null,
    parent_litho_body_id: null,
    content_key: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const GEO_MODEL = { id: 'geo-1' } as unknown as GeologicalModelResponse
const LITHO_MODEL = { id: 'litho-1' } as unknown as GeologicalModelResponse

/** One SAND unit f-1 with one packing body gbA under litho body lbX. */
function intScene() {
  listLenses.mockImplementation(async (_p: string, modelId: string) => {
    if (modelId === 'geo-1') {
      return [makeBody({ id: 'gbA', formation_id: 'f-1', body_ordinal: 0, parent_litho_body_id: 'lbX' })]
    }
    if (modelId === 'litho-1') {
      return [makeBody({ id: 'lbX', model_id: 'litho-1', formation_id: 'lu', body_ordinal: 0 })]
    }
    return []
  })
  const layer = makeLayer('f-1', 'high')
  ;(layer as unknown as { body_id: string }).body_id = 'gbA'
  return makeCtx({
    geotechFormations: [makeFormation('f-1', { nad_class: 6, display_order: 0 })],
    geotechContacts: [],
    geotechLayers: [layer],
    lithoFormations: [makeFormation('lu', { name: 'SAND' })],
    activeGeotechModel: GEO_MODEL,
    activeLithoModel: LITHO_MODEL,
  })
}

describe('GeotechnicalInspector roster integration (INT)', () => {
  it('INT1 — the three levels render once the body rosters land', async () => {
    renderInspector(intScene())
    expect(await screen.findByTestId('geotech-soil-header-SAND')).toBeTruthy()
    // D2: the L2 node reads the LITHO model body ("SAND · #0").
    expect((await screen.findByTestId('geotech-litho-body-SAND|lbX')).textContent).toContain(
      'SAND · #0',
    )
    // D3: the packing leaf under it.
    expect((await screen.findByTestId('geotech-body-row-gbA')).textContent).toContain('SAND · MD #0')
  })

  it('INT2 — editing a leaf colour PATCHes the body’s home geotech unit', async () => {
    renderInspector(intScene())
    const input = await screen.findByTestId('geotech-body-color-input-gbA')

    fireEvent.change(input, { target: { value: '#ff00ff' } })
    fireEvent.blur(input)

    expect(updateFormation).toHaveBeenCalledWith('proj-1', 'f-1', { color_override: '#ff00ff' })
  })

  it('INT4 — a geotech build re-reads the roster so healed litho links group', async () => {
    // Yesterday's fix heals parent_litho_body_id server-side on Build, but the
    // pane kept the pre-Build roster (NULL parents → everything under "no litho
    // body") until a reload. A completed Build bumps geotechBodyRosterRefetchNonce;
    // the geotech roster must re-fetch so the healed links reach the tree — and it
    // is a re-read, never a recompute.
    const ctx = intScene()
    const { rerender } = renderInspector(ctx)
    await screen.findByTestId('geotech-body-row-gbA')
    const geoCallsBefore = listLenses.mock.calls.filter(c => c[1] === 'geo-1').length

    rerender(
      <ShellContext.Provider
        value={{
          ...ctx,
          geoModel: { ...ctx.geoModel, geotechBodyRosterRefetchNonce: 1 },
        }}
      >
        <GeotechnicalInspector />
      </ShellContext.Provider>,
    )

    await waitFor(() => {
      const geoCallsAfter = listLenses.mock.calls.filter(c => c[1] === 'geo-1').length
      expect(geoCallsAfter).toBeGreaterThan(geoCallsBefore)
    })
    // A refetch, not a recompute — the DB is already correct after the Build.
    expect(ctx.coordinator.requestBodyRecompute).not.toHaveBeenCalled()
  })

  it('INT3 — an unstamped geotech model shows no roster tree', () => {
    // No active model → no body fetch → the body-driven tree is empty even
    // though the unit exists.
    renderInspector(
      makeCtx({
        geotechFormations: [makeFormation('f-1', { nad_class: 6, display_order: 0 })],
        geotechContacts: [makeContact('c-1', 'f-1')],
      }),
    )
    expect(screen.queryByTestId('geotech-soil-header-SAND')).toBeNull()
    // The header still counts the unit as having content.
    expect(screen.getByTestId('geotech-roster-summary').textContent).toContain('1')
  })
})
