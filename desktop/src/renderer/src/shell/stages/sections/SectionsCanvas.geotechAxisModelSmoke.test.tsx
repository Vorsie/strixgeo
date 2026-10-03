// TDZ / render smoke net for SectionsCanvas on the GEOTECH axis.
//
// WHY this exists: SectionsCanvas is a ~2700-line god component. Its body carries
// a `geotechAxisModel` useMemo that runs on every render of the geotech axis and
// is threaded into SectionPanel -> PartitionFillOverlay through
// SectionScopeContext. A Temporal-Dead-Zone bug (a `const` read above its
// declaration) or a bad field access in that block throws a ReferenceError at
// RUNTIME on first render - tsc, the hook-order lint, and the isolated
// PartitionFillOverlay tests all pass while the real geotech section is a
// blank/crashed canvas. This is exactly the class of bug the project's TDZ rule
// (CLAUDE.md) says to guard with a top-level smoke render once a component
// crosses the size threshold.
//
// What the isolated tests already cover, and the gap this closes:
//   - PartitionFillOverlay.geotechDirect.test.tsx (GD1-GD7) renders the REAL
//     overlay on the geotech axis - but NOT through SectionsCanvas.
//   - SectionsCanvas.geotechGuard.test.tsx renders the REAL SectionsCanvas on
//     the geotech axis - but with EMPTY geotech/litho data, so the bundle's
//     field-access loops never run.
//   - THIS test renders the REAL SectionsCanvas on the geotech axis with
//     POPULATED data, so the `geotechAxisModel` useMemo actually executes its
//     loops, and asserts the well-formed bundle reaches SectionPanel.
//
// Claims pinned here:
//   SC-TDZ-1  Real SectionsCanvas mounts on the geotech axis with populated
//             geotech + litho formations and geotech sub-band layers WITHOUT
//             throwing and WITHOUT a React render error on console.error (a TDZ
//             would surface as one or the other).
//   SC-TDZ-2  The bundle SectionsCanvas builds and passes to SectionPanel is
//             well-formed: geotechLayers passed through, nadMeta keyed by
//             geotech formation id (NAD class + soil code), and both litho maps
//             keyed by litho formation id (soil code + colour). Ties the
//             assertions to the input so the smoke is non-vacuous.
//   SC-TDZ-3  The bundle carries NO pre-filtered packing-edge list (owner ruling
//             2026-08-13): the geotech partition is framed by the
//             `geotechCorrelationEdges` prop, and a second copy assembled here
//             could drift from it silently.
//
// NOTE (test-fixture debt): the ~300-line ShellContextValue builder below is the
// 4th near-verbatim copy (geotechGuard / p2 / snapError each carry one). It is
// duplicated rather than shared because extracting a `makeSectionsCtx` factory
// would touch three passing test files - out of scope for this smoke add. Worth
// extracting to a `__testutils__` module when the next SectionsCanvas test lands.

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoLayerResponse,
} from '../../../api/client'
import type { GeotechAxisModel } from '../../../components/sections/geotechAxisModel'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsCanvas from './SectionsCanvas'

// ---------------------------------------------------------------------------
// Mocks — SectionPanel captures the `refinement` prop the god component builds;
// MapView pulls in Leaflet (no jsdom canvas) so it is stubbed. This mirrors the
// established SectionsCanvas.*.test.tsx pattern: mount the REAL SectionsCanvas,
// stub only its two heavyweight children.
// ---------------------------------------------------------------------------

import { useSectionScope } from '../../../components/sections/SectionScopeContext'

let capturedGeotechModel: GeotechAxisModel | undefined = undefined
/** Body ids of the built solids the canvas handed the panel for the active axis. */
let capturedSolidBodyIds: string[] | undefined = undefined

// The refinement bundle rides SectionScopeContext since the #201 round-2
// rerouting — the mock reads it from the scope, not from a prop.
vi.mock('../../../components/SectionPanel', () => ({
  default: () => {
    const scope = useSectionScope()
    capturedGeotechModel = scope.geotechModel
    capturedSolidBodyIds = scope.modelSolids?.map(s => s.body_id)
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        createContactCorrelation: vi.fn().mockResolvedValue(undefined),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        listGeotechPackingCorrelations: vi.fn().mockResolvedValue([]),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
      section: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
    },
  }
})

// ---------------------------------------------------------------------------
// Fixtures — populated so the geotechRefinement useMemo runs its loops.
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)

const LITHO_SAND_ID = 'litho-fm-sand'
const LITHO_CLAY_ID = 'litho-fm-clay'
const GEO_SAND_MEDIUM_ID = 'geo-fm-sand-6'
const GEO_SAND_DENSE_ID = 'geo-fm-sand-7'
const SAND_COLOR = '#fbbf24'
const CLAY_COLOR = '#6b7280'

function makeFormation(
  overrides: Partial<GeologicalFormationResponse> & { id: string },
): GeologicalFormationResponse {
  return {
    app_project_id: 'proj-1',
    name: overrides.id,
    color: '#000000',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    parent_extrapolated: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

const lithoFormations: GeologicalFormationResponse[] = [
  makeFormation({ id: LITHO_SAND_ID, color: SAND_COLOR, litho_main_soil_code: 'ZA' }),
  makeFormation({ id: LITHO_CLAY_ID, color: CLAY_COLOR, litho_main_soil_code: 'KL' }),
]

// Two NAD sub-classes of the sand litho unit — the geotech "formations".
const geotechFormations: GeologicalFormationResponse[] = [
  makeFormation({ id: GEO_SAND_MEDIUM_ID, nad_class: 6, litho_main_soil_code: 'ZA' }),
  makeFormation({ id: GEO_SAND_DENSE_ID, nad_class: 7, litho_main_soil_code: 'ZA' }),
]

function makeLayer(
  id: string,
  formationId: string,
  top: number,
  base: number,
): LithoLayerResponse {
  return {
    id,
    model_id: 'geotech-model-1',
    formation_id: formationId,
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
    // Source value is irrelevant to the refinement bundle (geotechLayers pass
    // through verbatim); use a valid LithoLayerSource so the fixture typechecks.
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: 'body-1',
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as LithoLayerResponse
}

// Two geotech sub-bands (medium over dense sand) on one CPT.
const geotechLayers: LithoLayerResponse[] = [
  makeLayer('gl-1', GEO_SAND_MEDIUM_ID, 8.9, 12.8),
  makeLayer('gl-2', GEO_SAND_DENSE_ID, 12.8, 16.0),
]

function makeGeotechModel(id = 'geotech-model-1'): GeologicalModelResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: 'Geotechnical Model',
    description: null,
    is_active: true,
    excluded_borehole_ids: [],
    kind: 'geotechnical',
    parent_model_id: 'litho-model-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeSection() {
  return {
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
    seeded_formation_contact_ids: [] as string[],
    min_depth_m: null,
    max_depth_m: null,
    display_order: 0,
    view_state: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/**
 * Full ShellContextValue with the geotech axis active, a live geotech model,
 * and POPULATED geotech + litho formations / geotech sub-band layers so the
 * `geotechRefinement` bundle-build branch runs over real data.
 *
 * Copied from SectionsCanvas.geotechGuard.test.tsx (the proven harness that
 * renders the real SectionsCanvas) with the three data arrays filled in.
 */
function makeGeotechCtx(
  overrides: {
    axis?: SectionModelAxis
    lithoSolids?: unknown[]
    geotechSolids?: unknown[]
  } = {},
): ShellContextValue {
  const section = makeSection()
  const geotechModel = makeGeotechModel()

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
      lithoFormations,
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
      lithoSolids: overrides.lithoSolids ?? [],
      lithoSolidsLoading: false,
      lithoSolidsBuilding: false,
      hasLithoSolids: false,
      hasStaleLithoSolid: false,
      buildLithoSolids: noopAsync,
      setBodyColor: vi.fn(),
      hideMarkers: false,
      setHideMarkers: vi.fn(),
      geotechSolids: overrides.geotechSolids ?? [],
      geotechSolidsLoading: false,
      geotechSolidsBuilding: false,
      hasGeotechSolids: false,
      hasStaleGeotechSolid: false,
      buildGeotechSolids: noopAsync,
      setGeotechBodyColor: vi.fn(),
      geotechHideMarkers: false,
      setGeotechHideMarkers: vi.fn(),
      // Debt #266 — geotech columns standing on litho that has since moved.
      staleLithoGeotechColumns: [],
      staleLithoGeotechColumnIds: new Set<string>(),
      staleLithoGeotechColumnCount: 0,
      unstampedGeotechColumnCount: 0,
      refreshGeotechLithoStaleness: vi.fn(),
      // The geometric half of that same answer — read at RENDER time since #266.
      columnsNeedingRederive: [],
      lithoStaleSurfaceCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      activeGeotechModel: geotechModel,
      geotechLayers,
      geotechContacts: [],
      geotechFormations,
      handleCreateManualLithoGhost: vi.fn(),
      copyGhostColumn: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
      markMutated: vi.fn(),
      handleSubdivideAllBodies: noopAsync,
      handleDivideBoreholes: noopAsync,
      requestGeotechLayersRefetch: vi.fn(),
    },
    sections: {
      sections: [section],
      selectedSectionId: section.id,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [section],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: (overrides.axis ?? 'geotechnical') as SectionModelAxis,
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
      correlationEdgesRefetchNonce: 0,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: 0,
      requestBodyRecompute: vi.fn(),
      requestCorrelationEdgesRefetch: vi.fn(),
    },
  } as unknown as ShellContextValue
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  capturedGeotechModel = undefined
  capturedSolidBodyIds = undefined
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

describe('SectionsCanvas — geotech axis model smoke (TDZ net)', () => {
  it('SC-TDZ-1 — mounts on the geotech axis with populated data, no throw / no render error', () => {
    // A TDZ in the geotechRefinement block (or anywhere on the geotech render
    // path) throws synchronously during render → render() rejects, OR React's
    // error path logs to console.error. Assert neither happened.
    expect(() =>
      render(
        <ShellContext.Provider value={makeGeotechCtx()}>
          <SectionsCanvas />
        </ShellContext.Provider>,
      ),
    ).not.toThrow()

    // No React render error surfaced (an error boundary could swallow the throw
    // and log it here instead of rethrowing).
    const renderErrors = consoleErrorSpy.mock.calls.filter((call: unknown[]) => {
      const first = call[0]
      const msg = typeof first === 'string' ? first : String(first ?? '')
      return /ReferenceError|Cannot access|before initialization|The above error/.test(msg)
    })
    expect(renderErrors).toEqual([])
  })

  it('SC-TDZ-2 — builds a well-formed refinement bundle and passes it to SectionPanel', () => {
    render(
      <ShellContext.Provider value={makeGeotechCtx()}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // The geotech axis always builds the bundle (undefined only off-axis).
    expect(capturedGeotechModel).toBeDefined()
    const bundle = capturedGeotechModel!

    // geotechLayers threaded through verbatim.
    expect(bundle.geotechLayers.map((l) => l.id)).toEqual(['gl-1', 'gl-2'])

    // nadMeta keyed by GEOTECH formation id → NAD class + soil code + admixture
    // codes (the seam identity, walk22b; these clean sand fixtures carry none) +
    // the litho unit the row subdivides (the fill's class key, owner 2026-10-03;
    // these fixtures carry none).
    expect(bundle.nadMeta.get(GEO_SAND_MEDIUM_ID)).toEqual({
      nadClass: 6,
      soilCode: 'ZA',
      admixtureCodes: [],
      lithoUnitId: null,
    })
    expect(bundle.nadMeta.get(GEO_SAND_DENSE_ID)).toEqual({
      nadClass: 7,
      soilCode: 'ZA',
      admixtureCodes: [],
      lithoUnitId: null,
    })

    // litho maps keyed by LITHO formation id (soil-code guard + fill colour).
    expect(bundle.lithoSoilByFormationId.get(LITHO_SAND_ID)).toBe('ZA')
    expect(bundle.lithoSoilByFormationId.get(LITHO_CLAY_ID)).toBe('KL')
    expect(bundle.lithoFormationColorById.get(LITHO_SAND_ID)).toBe(SAND_COLOR)
    expect(bundle.lithoFormationColorById.get(LITHO_CLAY_ID)).toBe(CLAY_COLOR)
  })

  it('SC-TDZ-3 — the bundle carries no packing-edge list of its own', () => {
    // Owner ruling 2026-08-13: the geotech partition is framed by the
    // `geotechCorrelationEdges` prop — the SAME rows the correlate overlay
    // draws and the 3-D build fetches. A second, pre-filtered copy assembled
    // here is exactly the kind of duplicate that drifts from its original
    // without anything going red, so its ABSENCE is pinned.
    render(
      <ShellContext.Provider value={makeGeotechCtx()}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    expect(capturedGeotechModel).toBeDefined()
    expect(Object.keys(capturedGeotechModel!).sort()).toEqual([
      'geotechLayers',
      'lithoFormationColorById',
      'lithoSoilByFormationId',
      'nadMeta',
      // Debt #266 — ids only, not a second copy of any edge or layer set. It
      // says WHICH columns are out of date, never what they contain, so it
      // cannot drift from the rows above it the way a pre-filtered edge list
      // would.
      'staleColumnIds',
    ])
  })

  it('SC-TDZ-4 — the geotech axis hands the panel the GEOTECH model’s built solids', () => {
    // Owner 2026-08-26: "can we show the actual 3D model on the 2d sections
    // just like in litho stage". "The actual 3D model" on this axis is the
    // geotech build, so the geotech solids must be what reaches the section —
    // handing over the litho ones would paint a different model's bodies under
    // the geotech axis's NAD colours, which reads as correct and is not.
    render(
      <ShellContext.Provider
        value={makeGeotechCtx({
          lithoSolids: [{ body_id: 'litho-body', triangles: [], vertices: [] }],
          geotechSolids: [{ body_id: 'geotech-body', triangles: [], vertices: [] }],
        })}
      >
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedSolidBodyIds).toEqual(['geotech-body'])
  })

  it('SC-TDZ-5 — the litho axis still hands over the LITHO model’s built solids', () => {
    // Control: the axis each build belongs to is the axis it paints on.
    render(
      <ShellContext.Provider
        value={makeGeotechCtx({
          axis: 'lithostratigraphic',
          lithoSolids: [{ body_id: 'litho-body', triangles: [], vertices: [] }],
          geotechSolids: [{ body_id: 'geotech-body', triangles: [], vertices: [] }],
        })}
      >
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedSolidBodyIds).toEqual(['litho-body'])
  })

  it('SC-TDZ-6 — the geological axis has no model of its own to paint', () => {
    render(
      <ShellContext.Provider
        value={makeGeotechCtx({
          axis: 'geological',
          lithoSolids: [{ body_id: 'litho-body', triangles: [], vertices: [] }],
          geotechSolids: [{ body_id: 'geotech-body', triangles: [], vertices: [] }],
        })}
      >
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedSolidBodyIds).toBeUndefined()
  })
})
