// Behavioral net for GeotechnicalInspector (F5 — geotech NAD roster).
//
// Claims pinned here:
//   R1  A classified unit (nad_class set) shows the packing-class name from
//       nadClassName and the NAD swatch colour from nadClassColor. Fully
//       cone-derived is the NORM and carries no provenance badge (owner
//       2026-08-27); only "No CPT" / "No CPT (partial)" exceptions badge.
//   R2  A degenerate unit (nad_class=null) shows no label text and no
//       provenance badge (null is rare — borehole CPT extrapolation makes it
//       non-standard; the row just shows a neutral swatch).
//   R3  Rows are sorted ascending by display_order then nad_class.
//   R4  Empty state renders when geotechFormations is empty.
//   R5  The contact-count badge shows the count of geotechContacts filtered
//       to this formation.
//
// Pattern: render GeotechnicalInspector inside a ShellContext.Provider —
// mirrors LithologyInspector.test.tsx.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoLayerConfidence,
  LithoLayerResponse,
} from '../../../api/client'
import GeotechnicalInspector from './GeotechnicalInspector'
import { nadClassColor } from '../../../utils/nadClasses'
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

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    api: { geology: { updateFormation: (...args: unknown[]) => updateFormation(...(args as [string, string, unknown])) } },
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
  /** Litho units — the roster names a geotech unit's SOURCE from these. */
  lithoFormations?: GeologicalFormationResponse[]
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
      activeLithoModel: null,
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
      activeGeotechModel: null,
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
      parametersDeepLinkTarget: null,
      setParametersDeepLinkTarget: vi.fn(),
      selectedParameterUnitId: null,
      setSelectedParameterUnitId: vi.fn(),
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
    expect(screen.queryByRole('list', { name: /geotechnical nad units/i })).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// R1 — Classified unit (nad_class set)
// ---------------------------------------------------------------------------

describe('GeotechnicalInspector classified unit row (R1)', () => {
  it('names the packing class as soil header + firmness row, never both on one row', () => {
    // NAD class 6 = "SAND, medium dense" (from NAD_CLASS_NAMES, English).
    // Owner, 2026-08-26, on the mockup he approved: "the class row label is the
    // FIRMNESS/DENSITY name, not a repeat of the soil". So the two halves of
    // that name land on two different rows and neither says both.
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [makeContact('c-1', 'f-1')] }),
    )

    expect(screen.getByTestId('geotech-soil-header-SAND').textContent).toContain('SAND')
    const row = screen.getByTestId('geotech-unit-row-f-1')
    expect(row.textContent).toContain('medium dense')
    expect(row.textContent).not.toContain('SAND, medium dense')
  })

  // Owner, 2026-08-27: "CPT est. die flag mag eruit, bijna alle
  // packingsklassen zijn altijd uit sonderingen afgeleid" — cone-derived is
  // the NORM, so the norm carries no badge; only the exceptions (no cone, or
  // partly no cone) are worth marking.
  it('a fully cone-derived unit carries NO provenance badge — that is the norm', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    renderInspector(
      makeCtx({
        geotechFormations: [formation],
        geotechContacts: [],
        // CPT-derived bands: `subdivide_all_bodies` writes 'medium',
        // `cpt_interpolated` borehole fill writes 'high'.
        geotechLayers: [makeLayer('f-1', 'high')],
      }),
    )

    expect(screen.queryByTestId('cpt-est-badge-f-1')).toBeNull()
    expect(screen.queryByTestId('no-cpt-badge-f-1')).toBeNull()
    expect(screen.queryByTestId('partial-cpt-badge-f-1')).toBeNull()
  })

  // No cone touched this soil: the class is `body_min` (weakest class seen
  // elsewhere in the body) or `absolute_min` (a hard-coded lithology floor),
  // both persisted as confidence 'low'. Calling that "CPT est. — derived from
  // CPT qc series" is the app presenting an invented value as a measured one.
  it('does NOT claim "CPT est." on a unit filled from the conservative fallback', () => {
    const formation = makeFormation('f-fb', { nad_class: 21, display_order: 0 })
    renderInspector(
      makeCtx({
        geotechFormations: [formation],
        geotechContacts: [],
        geotechLayers: [makeLayer('f-fb', 'low')],
      }),
    )

    expect(screen.queryByTestId('cpt-est-badge-f-fb')).toBeNull()
    expect(screen.getByTestId('no-cpt-badge-f-fb').textContent).toBe('No CPT')
  })

  // RETIRED 2026-08-26: 'a classified unit with nothing in the model waits
  // behind "show empty", and still refuses to claim CPT'. Its first claim is
  // the lever the owner removed ("if a bin is empty ... nothing exists"), and
  // its second is already pinned verbatim by the fallback test directly above,
  // on a unit that HAS content. Nothing is left for it to say.

  // Owner's reading of the roster: "No CPT" has to mean there was no cone. On the dev
  // model 9 of the 14 NAD units carry at least one borehole-fill band among dozens of
  // cone-derived ones (ZAND (NAD 6): 141 cone bands, 1 fallback) — telling him those
  // units have "No CPT data behind this class" is as untrue as claiming CPT for a pure
  // fallback, and it empties the roster of the honest badge.
  it('a unit that is mostly cone with one fallback band is badged partial, not "No CPT"', () => {
    const formation = makeFormation('f-mix', { nad_class: 6, display_order: 0 })
    renderInspector(
      makeCtx({
        geotechFormations: [formation],
        geotechContacts: [],
        geotechLayers: [makeLayer('f-mix', 'high'), makeLayer('f-mix', 'low')],
      }),
    )

    expect(screen.queryByTestId('cpt-est-badge-f-mix')).toBeNull()
    expect(screen.queryByTestId('no-cpt-badge-f-mix')).toBeNull()
    // "CPT est. (partial)" died with the norm badge — with cone-derived
    // unlabelled, the exception must name what is MISSING, not what is normal.
    expect(screen.getByTestId('partial-cpt-badge-f-mix').textContent).toBe('No CPT (partial)')
  })

  // Owner, 2026-08-15: "I don't really like the word fallback, this just means
  // the model isn't ready." The provenance tooltips are the only place on the
  // roster that said it out loud; they must state what is actually true about
  // where the class came from instead.
  it('WF1: neither provenance tooltip says "fallback" — they say where the class came from', () => {
    renderInspector(
      makeCtx({
        geotechFormations: [
          makeFormation('f-fb', { nad_class: 21, display_order: 0 }),
          makeFormation('f-mix', { nad_class: 6, display_order: 1 }),
        ],
        geotechContacts: [],
        geotechLayers: [
          makeLayer('f-fb', 'low'),
          makeLayer('f-mix', 'high'),
          makeLayer('f-mix', 'low'),
        ],
      }),
    )

    for (const testId of ['no-cpt-badge-f-fb', 'partial-cpt-badge-f-mix']) {
      const tip = screen.getByTestId(testId).getAttribute('title') ?? ''
      expect(tip.toLowerCase()).not.toContain('fallback')
      // Still has to say WHY there is no cone behind the class, or the badge
      // becomes a shrug.
      expect(tip.toLowerCase()).toContain('weakest class')
    }
  })

  it('applies nadClassColor to the swatch, NOT f.color', () => {
    // nad_class 6 → '#d4b84a' from nadClassColor; f.color = '#aabbcc' (should NOT appear).
    const formation = makeFormation('f-1', { nad_class: 6, color: '#aabbcc', display_order: 0 })
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [makeContact('c-1', 'f-1')] }),
    )

    const swatch = screen.getByTestId('geotech-unit-swatch-f-1')
    // The inline style must use the NAD class colour (ndClassColor(6)), not f.color.
    const style = (swatch as HTMLElement).style.backgroundColor
    // CSS parses #d4b84a → rgb(212, 184, 74).
    expect(style).toBe('rgb(212, 184, 74)')
  })
})

// ---------------------------------------------------------------------------
// R2 — No-qc unit (nad_class = null)
// ---------------------------------------------------------------------------

describe('GeotechnicalInspector unclassified unit row (R2)', () => {
  it('a unit with no packing class says so — it is never a bare number', () => {
    // The owner's paste, 2026-08-26: two rows in the pane were literally just
    // the character "0". They are units the materialiser made without a class
    // (no cone reached the soil) and the pane asked nadClassName for a label,
    // which answers "" for null. A row that names no ground cannot be acted on.
    const formation = makeFormation('f-null', {
      nad_class: null,
      litho_main_soil_code: 'ZAND',
      display_order: 0,
    })
    renderInspector(
      makeCtx({
        geotechFormations: [formation],
        geotechContacts: [makeContact('c-1', 'f-null')],
      }),
    )

    const row = screen.getByTestId('geotech-unit-row-f-null')
    expect(row.textContent).toContain('not yet classified')
    expect(screen.getByTestId('geotech-soil-header-SAND')).toBeTruthy()
    // "No qc" wording stays gone.
    expect(row.textContent).not.toContain('No qc')
  })

  it('does NOT show the "CPT est." badge for an unclassified unit', () => {
    // There is no classification to state a provenance for.
    const formation = makeFormation('f-null', {
      nad_class: null,
      litho_main_soil_code: 'ZAND',
      display_order: 0,
    })
    renderInspector(
      makeCtx({
        geotechFormations: [formation],
        geotechContacts: [makeContact('c-1', 'f-null')],
      }),
    )

    expect(screen.queryByTestId('cpt-est-badge-f-null')).toBeNull()
    expect(screen.queryByTestId('no-cpt-badge-f-null')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// R3 — Sort order
// ---------------------------------------------------------------------------

describe('GeotechnicalInspector row sort order (R3)', () => {
  /** The class rows in render order, by the unit each represents. */
  function classRowOrder(): (string | null)[] {
    return screen
      .getAllByTestId(/^geotech-unit-row-/)
      .map(el => el.getAttribute('data-testid'))
  }

  it('runs the packing sequence loosest-first inside a soil', () => {
    const formations = [
      makeFormation('f-b', { nad_class: 7, display_order: 2 }),
      makeFormation('f-a', { nad_class: 5, display_order: 1 }),
      makeFormation('f-c', { nad_class: 8, display_order: 3 }),
    ]
    renderInspector(
      makeCtx({
        geotechFormations: formations,
        geotechContacts: [
          makeContact('c-a', 'f-a'),
          makeContact('c-b', 'f-b'),
          makeContact('c-c', 'f-c'),
        ],
      }),
    )

    // All three are SAND classes, so they share one header and read in class
    // order underneath it.
    expect(screen.getAllByTestId(/^geotech-soil-header-/)).toHaveLength(1)
    expect(classRowOrder()).toEqual([
      'geotech-unit-row-f-a',
      'geotech-unit-row-f-b',
      'geotech-unit-row-f-c',
    ])
  })

  it('puts the unclassified row at the BOTTOM of its soil, after the packing sequence', () => {
    // It has no place in a density ramp, and the classified reading should not
    // be interrupted by it.
    const formations = [
      // The soil code is what puts an unclassified unit under the same header
      // as its classified siblings — its NAD class cannot say which ground it
      // is, so the inherited lithology has to.
      makeFormation('f-none', {
        nad_class: null,
        litho_main_soil_code: 'ZAND',
        display_order: 0,
      }),
      makeFormation('f-low', { nad_class: 5, display_order: 0 }),
      makeFormation('f-high', { nad_class: 10, display_order: 0 }),
    ]
    renderInspector(
      makeCtx({
        geotechFormations: formations,
        geotechContacts: [
          makeContact('c-1', 'f-none'),
          makeContact('c-2', 'f-low'),
          makeContact('c-3', 'f-high'),
        ],
      }),
    )

    expect(classRowOrder()).toEqual([
      'geotech-unit-row-f-low',
      'geotech-unit-row-f-high',
      'geotech-unit-row-f-none',
    ])
  })

  it('orders the soil headers stratigraphically, shallowest display_order first', () => {
    const formations = [
      makeFormation('f-clay', {
        nad_class: 21,
        litho_main_soil_code: 'KLEI',
        display_order: 5,
      }),
      makeFormation('f-sand', { nad_class: 6, display_order: 2 }),
    ]
    renderInspector(
      makeCtx({
        geotechFormations: formations,
        geotechContacts: [makeContact('c-1', 'f-clay'), makeContact('c-2', 'f-sand')],
      }),
    )

    expect(
      screen.getAllByTestId(/^geotech-soil-header-/).map(el => el.getAttribute('data-testid')),
    ).toEqual(['geotech-soil-header-SAND', 'geotech-soil-header-CLAY'])
  })
})

// ---------------------------------------------------------------------------
// R5 — Contact count badge
// ---------------------------------------------------------------------------

describe('GeotechnicalInspector contact count badge (R5)', () => {
  it('shows contact count matching this formation in geotechContacts', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    const contacts = [
      makeContact('c-1', 'f-1'),
      makeContact('c-2', 'f-1'),
      makeContact('c-3', 'f-other'), // different formation — must not count
    ]
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: contacts }))

    const badge = screen.getByTestId('geotech-unit-contact-count-f-1')
    expect(badge.textContent).toBe('2')
  })

  it('shows 0 contact count when no contacts match', () => {
    // A unit whose bands are all still pending: it has layers, so it describes
    // something and stays on the roster, but nothing accepted, so it counts 0.
    const formation = makeFormation('f-empty', { nad_class: 6, display_order: 0 })
    renderInspector(
      makeCtx({
        geotechFormations: [formation],
        geotechContacts: [],
        geotechLayers: [makeLayer('f-empty', 'high')],
      }),
    )

    const badge = screen.getByTestId('geotech-unit-contact-count-f-empty')
    expect(badge.textContent).toBe('0')
  })
})

// ---------------------------------------------------------------------------
// PI — Part 3: confidence badge + assignment source display
// ---------------------------------------------------------------------------

describe('GeotechnicalInspector confidence badge (PI)', () => {
  it('PI1 — shows "High" confidence badge when all geotechLayers for the formation are high confidence', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    const layers = [makeLayer('f-1', 'high'), makeLayer('f-1', 'high')]
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [], geotechLayers: layers }),
    )

    const badge = screen.getByTestId('confidence-badge-f-1')
    expect(badge.textContent).toContain('High')
  })

  it('PI2 — shows "Low" confidence badge when any layer is low confidence', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    const layers = [makeLayer('f-1', 'low'), makeLayer('f-1', 'high')]
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [], geotechLayers: layers }),
    )

    const badge = screen.getByTestId('confidence-badge-f-1')
    expect(badge.textContent).toContain('Low')
  })

  it('PI3 — shows "Medium" confidence badge when any layer is medium and none are low', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    const layers = [makeLayer('f-1', 'medium'), makeLayer('f-1', 'high')]
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [], geotechLayers: layers }),
    )

    const badge = screen.getByTestId('confidence-badge-f-1')
    expect(badge.textContent).toContain('Medium')
  })

  it('PI4 — shows no confidence badge when no geotechLayers exist for the formation', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [], geotechLayers: [] }),
    )

    expect(screen.queryByTestId('confidence-badge-f-1')).toBeNull()
  })
})

describe('GeotechnicalInspector confidence badge colours (B2)', () => {
  it('B2-medium — medium badge uses slate classes, not amber', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    const layers = [makeLayer('f-1', 'medium')]
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [], geotechLayers: layers }),
    )

    const badge = screen.getByTestId('confidence-badge-f-1')
    // B2: amber is reserved for unsaved-state; medium uses neutral slate.
    expect(badge.className).toContain('bg-slate-100')
    expect(badge.className).toContain('text-slate-600')
    expect(badge.className).not.toContain('amber')
  })

  it('B2-low — low badge uses orange classes, not red', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    const layers = [makeLayer('f-1', 'low')]
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [], geotechLayers: layers }),
    )

    const badge = screen.getByTestId('confidence-badge-f-1')
    // B2: red is reserved for errors; low confidence uses orange.
    expect(badge.className).toContain('bg-orange-100')
    expect(badge.className).toContain('text-orange-700')
    expect(badge.className).not.toContain('red')
  })
})

describe('GeotechnicalInspector selected body panel (S2/S3)', () => {
  it('S2 — shows packing-class name + NAD number when a body has a matching layer', () => {
    // NAD class 6 = "SAND, medium dense" in nadClassName.
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    const layer = makeLayer('f-1', 'high')
    // Override body_id so the selection lookup finds this layer.
    ;(layer as any).body_id = 'body-s2'

    selectGeotechBody({ bodyId: 'body-s2', assignmentSource: 'cpt_interpolated' })
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [], geotechLayers: [layer] }),
    )

    const formationLabel = screen.getByTestId('geotech-sample-source-formation')
    // Shows the class name + NAD number.
    expect(formationLabel.textContent).toContain('SAND, medium dense')
    expect(formationLabel.textContent).toContain('NAD 6')
  })

  it('S2 — matching roster row receives selection highlight when body is selected', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    const layer = makeLayer('f-1', 'high')
    ;(layer as any).body_id = 'body-s2-row'

    selectGeotechBody({ bodyId: 'body-s2-row', assignmentSource: null })
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [], geotechLayers: [layer] }),
    )

    const row = screen.getByTestId('geotech-unit-row-f-1')
    // Blue selection tint class applied to the matching row.
    expect(row.className).toContain('bg-blue-50')
  })

  it('S3 — assignment source label carries the raw token as a title attribute', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    selectGeotechBody({ bodyId: 'body-s3', assignmentSource: 'body_min' })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

    const panel = screen.getByTestId('geotech-sample-source')
    // S3: the raw token 'body_min' must appear as a title attribute on the
    // translated label so domain experts can verify the mapping.
    const span = panel.querySelector('[title="body_min"]')
    expect(span).not.toBeNull()
    expect(span!.textContent).toContain('Body minimum')
  })
})

describe('GeotechnicalInspector assignment source panel (PI)', () => {
  it('PI5 — shows no assignment source panel when no body is selected', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

    expect(screen.queryByTestId('geotech-sample-source')).toBeNull()
  })

  it('PI6 — shows translated "CPT interpolated" when selection assignmentSource is cpt_interpolated', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    selectGeotechBody({ bodyId: 'body-1', assignmentSource: 'cpt_interpolated' })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

    const panel = screen.getByTestId('geotech-sample-source')
    expect(panel.textContent).toContain('CPT interpolated')
  })

  it('PI7 — shows translated "Body minimum" when selection assignmentSource is body_min', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    selectGeotechBody({ bodyId: 'body-1', assignmentSource: 'body_min' })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

    const panel = screen.getByTestId('geotech-sample-source')
    expect(panel.textContent).toContain('Body minimum')
  })

  it('PI8 — shows no assignment source text when assignmentSource is null', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    selectGeotechBody({ bodyId: 'body-1', assignmentSource: null })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

    // Panel renders but assignment source line is absent.
    const panel = screen.getByTestId('geotech-sample-source')
    expect(panel.textContent).not.toContain('CPT interpolated')
    expect(panel.textContent).not.toContain('Body minimum')
  })
})

// ---------------------------------------------------------------------------
// GT — the tree the owner approved (mockup panel 2, 2026-08-26)
//
// "Same tree shape as the legend, so the two panes read as one system. One row
// per NAD class with bands SUMMED across its unit instances; provenance
// collapses to the worst badge in the group (partial/low bubbles up — that is
// the one you need to see)." Zero-content units first went behind a 'show
// empty' lever; the owner overturned that the same day (GT4) and they are now
// simply not listed.
// ---------------------------------------------------------------------------

describe('GeotechnicalInspector unit tree (GT)', () => {
  it('GT1 — several units of one class become ONE row carrying their bands added up', () => {
    const formations = [
      makeFormation('i1', { nad_class: 6, display_order: 0 }),
      makeFormation('i2', { nad_class: 6, display_order: 1 }),
      makeFormation('i3', { nad_class: 6, display_order: 2 }),
    ]
    renderInspector(
      makeCtx({
        geotechFormations: formations,
        geotechContacts: [
          ...Array.from({ length: 20 }, (_, i) => makeContact(`a${i}`, 'i1')),
          ...Array.from({ length: 5 }, (_, i) => makeContact(`b${i}`, 'i2')),
          ...Array.from({ length: 6 }, (_, i) => makeContact(`c${i}`, 'i3')),
        ],
      }),
    )

    // One class row, not three unit rows.
    const classRow = screen.getByTestId('geotech-unit-row-SAND|6')
    expect(classRow.textContent).toContain('medium dense')
    expect(screen.getByTestId('geotech-unit-contact-count-SAND|6').textContent).toBe('31')
    expect(screen.getByTestId('geotech-soil-header-SAND').textContent).toContain('31 bands')
    // The individual units are not rows yet.
    expect(screen.queryByTestId('geotech-unit-row-i1')).toBeNull()
  })

  it('GT2 — a class with several units expands to show which one is the weak one', () => {
    const formations = [
      makeFormation('clean', { nad_class: 6, display_order: 0 }),
      makeFormation('weak', { nad_class: 6, display_order: 1 }),
    ]
    renderInspector(
      makeCtx({
        geotechFormations: formations,
        geotechContacts: [makeContact('c-1', 'clean'), makeContact('c-2', 'weak')],
        geotechLayers: [makeLayer('clean', 'high'), makeLayer('weak', 'low')],
      }),
    )

    // Collapsed, the row shows the WORST of the two — one weak unit must not
    // hide inside a row that reads healthy.
    expect(screen.getByTestId('no-cpt-badge-SAND|6')).toBeTruthy()
    expect(screen.getByTestId('confidence-badge-SAND|6').textContent).toContain('Low')
    expect(screen.queryByTestId('geotech-unit-row-weak')).toBeNull()

    fireEvent.click(screen.getByTestId('geotech-class-expander-SAND|6'))

    // Expanded, each unit answers for itself — which is the point of opening
    // it. The clean unit is the unbadged norm (owner 2026-08-27); only the
    // weak one is marked.
    expect(screen.getByTestId('geotech-unit-row-clean')).toBeTruthy()
    expect(screen.queryByTestId('cpt-est-badge-clean')).toBeNull()
    expect(screen.getByTestId('no-cpt-badge-weak')).toBeTruthy()
  })

  it('GT3 — a class carried by ONE unit has nothing to expand', () => {
    const formation = makeFormation('only', { nad_class: 6, display_order: 0 })
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [makeContact('c-1', 'only')] }),
    )

    expect(screen.getByTestId('geotech-unit-row-only')).toBeTruthy()
    expect(screen.queryByTestId('geotech-class-expander-SAND|6')).toBeNull()
  })

  it('GT4 — a bin with nothing in it is off the pane, and no lever brings it back', () => {
    // Owner, dogfeed 2026-08-26: "The show empty is weird though, if a bin is
    // empty that means there is nothing in it and nothing exists". So the pane
    // lists ground, full stop. RETIRES the pair of pins that encoded the
    // "show empty (N)" lever — the count of invisible rows was itself the thing
    // that read as weird, and the orphan sweep deletes those units shortly.
    const formations = [
      makeFormation('live', { nad_class: 6, display_order: 0 }),
      makeFormation('gone-a', { nad_class: 7, display_order: 1 }),
      makeFormation('gone-b', { nad_class: 8, display_order: 2 }),
    ]
    renderInspector(
      makeCtx({ geotechFormations: formations, geotechContacts: [makeContact('c-1', 'live')] }),
    )

    expect(screen.getByTestId('geotech-unit-row-live')).toBeTruthy()
    expect(screen.queryByTestId('geotech-unit-row-gone-a')).toBeNull()
    expect(screen.queryByTestId('geotech-unit-row-gone-b')).toBeNull()
    expect(screen.queryByTestId('geotech-show-empty-toggle')).toBeNull()
  })

  it('GT5 — an unclassified unit that HAS bands is content, and stays on the pane', () => {
    // The control for GT4: "no class" is not "no content". This row is real
    // ground the geotech stage has not classified, and hiding it would hide
    // the very thing the engineer has to go and act on.
    const formation = makeFormation('skeleton', { nad_class: null, display_order: 0 })
    renderInspector(
      makeCtx({
        geotechFormations: [formation],
        geotechContacts: [makeContact('c-1', 'skeleton')],
      }),
    )

    expect(screen.getByTestId('geotech-unit-row-skeleton')).toBeTruthy()
    expect(screen.queryByTestId('geotech-show-empty-toggle')).toBeNull()
  })

  it('GT6 — a soil header collapses its classes away and brings them back', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    renderInspector(
      makeCtx({ geotechFormations: [formation], geotechContacts: [makeContact('c-1', 'f-1')] }),
    )

    // Soils start OPEN: the class row is the level the engineer works at.
    const header = screen.getByTestId('geotech-soil-header-SAND')
    expect(header.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByTestId('geotech-unit-row-f-1')).toBeTruthy()

    fireEvent.click(header)
    expect(screen.queryByTestId('geotech-unit-row-f-1')).toBeNull()

    fireEvent.click(header)
    expect(screen.getByTestId('geotech-unit-row-f-1')).toBeTruthy()
  })

  it('GT7 — same-soil unclassified units are told apart by their source litho unit', () => {
    // Five identical "KLEI (geotech)" skeletons exist on the owner project,
    // each from a different litho formation. Collapsed they are one row; opened
    // they have to be distinguishable or the expansion says nothing.
    const formations = [
      makeFormation('k1', {
        nad_class: null,
        litho_main_soil_code: 'KLEI',
        source_litho_formation_id: 'litho-a',
        display_order: 0,
      }),
      makeFormation('k2', {
        nad_class: null,
        litho_main_soil_code: 'KLEI',
        source_litho_formation_id: 'litho-b',
        display_order: 1,
      }),
    ]
    renderInspector(
      makeCtx({
        geotechFormations: formations,
        geotechContacts: [makeContact('c-1', 'k1'), makeContact('c-2', 'k2')],
        lithoFormations: [
          makeFormation('litho-a', { litho_main_soil_code: 'KLEI', name: 'a' }),
          makeFormation('litho-b', { litho_main_soil_code: 'ZAND', name: 'b' }),
        ],
      }),
    )

    fireEvent.click(screen.getByTestId('geotech-class-expander-CLAY|'))

    expect(screen.getByTestId('geotech-unit-row-k1').textContent).toContain(
      'CLAY — not yet classified (CLAY)',
    )
    expect(screen.getByTestId('geotech-unit-row-k2').textContent).toContain(
      'CLAY — not yet classified (SAND)',
    )
  })

  it('GT8 — a selected body still highlights its row, even inside a collapsed class', () => {
    // Preserved from the flat roster: the sample dot on the canvas is the only
    // thing that selects here, and the roster has to answer it.
    const formations = [
      makeFormation('sel', { nad_class: 6, display_order: 0 }),
      makeFormation('other', { nad_class: 6, display_order: 1 }),
    ]
    const layer = makeLayer('sel', 'high')
    ;(layer as unknown as { body_id: string }).body_id = 'body-gt8'

    selectGeotechBody({ bodyId: 'body-gt8', assignmentSource: null })
    renderInspector(
      makeCtx({
        geotechFormations: formations,
        geotechContacts: [makeContact('c-1', 'sel'), makeContact('c-2', 'other')],
        geotechLayers: [layer],
      }),
    )

    // The class row carries the ring while collapsed, so the selection is
    // visible without the engineer having to guess which class holds it.
    expect(screen.getByTestId('geotech-unit-row-SAND|6').className).toContain('bg-blue-50')

    fireEvent.click(screen.getByTestId('geotech-class-expander-SAND|6'))
    expect(screen.getByTestId('geotech-unit-row-sel').className).toContain('bg-blue-50')
    expect(screen.getByTestId('geotech-unit-row-other').className).not.toContain('bg-blue-50')
  })
})

// ---------------------------------------------------------------------------
// CP — the engineer picks the colour
//
// Owner ruling, dogfeed 2026-08-26: "Colours on the right hand pane need to be
// choosable if user wants." The swatch that was read-only becomes the control,
// following the geological formation swatch already in GeologyInspector: a
// label wrapping a native colour input, committed on blur so one decision is
// one write rather than one per step of a colour wheel.
// ---------------------------------------------------------------------------

describe('the colour is choosable on the pane (CP)', () => {
  it('CP1 — the swatch is a colour control, showing what the unit is drawn in', () => {
    renderInspector(
      makeCtx({
        geotechFormations: [makeFormation('f-1', { nad_class: 6, display_order: 0 })],
        geotechContacts: [makeContact('c-1', 'f-1')],
      }),
    )

    const input = screen.getByTestId('geotech-unit-color-input-f-1') as HTMLInputElement
    expect(input.getAttribute('type')).toBe('color')
    expect(input.value).toBe(nadClassColor(6))
  })

  it('CP2 — picking a colour records it as the engineer’s own, not as the unit colour', () => {
    renderInspector(
      makeCtx({
        geotechFormations: [makeFormation('f-1', { nad_class: 6, display_order: 0 })],
        geotechContacts: [makeContact('c-1', 'f-1')],
      }),
    )
    const input = screen.getByTestId('geotech-unit-color-input-f-1')

    fireEvent.change(input, { target: { value: '#ff00ff' } })
    fireEvent.blur(input)

    expect(updateFormation).toHaveBeenCalledTimes(1)
    expect(updateFormation).toHaveBeenCalledWith('proj-1', 'f-1', { color_override: '#ff00ff' })
  })

  it('CP3 — a row standing for several units writes the colour to every one of them', () => {
    renderInspector(
      makeCtx({
        geotechFormations: [
          makeFormation('a', { nad_class: 6, display_order: 0 }),
          makeFormation('b', { nad_class: 6, display_order: 1 }),
        ],
        geotechContacts: [makeContact('c-1', 'a'), makeContact('c-2', 'b')],
      }),
    )
    const input = screen.getByTestId('geotech-unit-color-input-SAND|6')

    fireEvent.change(input, { target: { value: '#ff00ff' } })
    fireEvent.blur(input)

    expect(updateFormation).toHaveBeenCalledTimes(2)
    expect(updateFormation).toHaveBeenCalledWith('proj-1', 'a', { color_override: '#ff00ff' })
    expect(updateFormation).toHaveBeenCalledWith('proj-1', 'b', { color_override: '#ff00ff' })
  })

  it('CP4 — blurring without changing anything writes nothing', () => {
    renderInspector(
      makeCtx({
        geotechFormations: [makeFormation('f-1', { nad_class: 6, display_order: 0 })],
        geotechContacts: [makeContact('c-1', 'f-1')],
      }),
    )
    const input = screen.getByTestId('geotech-unit-color-input-f-1')

    fireEvent.change(input, { target: { value: nadClassColor(6) } })
    fireEvent.blur(input)

    expect(updateFormation).not.toHaveBeenCalled()
  })

  it('CP5 — a unit he has coloured offers to go back to automatic', () => {
    renderInspector(
      makeCtx({
        geotechFormations: [
          makeFormation('f-1', { nad_class: 6, display_order: 0, color_override: '#ff00ff' }),
        ],
        geotechContacts: [makeContact('c-1', 'f-1')],
      }),
    )

    const swatch = screen.getByTestId('geotech-unit-color-input-f-1') as HTMLInputElement
    expect(swatch.value).toBe('#ff00ff')

    fireEvent.click(screen.getByTestId('geotech-unit-color-reset-f-1'))

    // Clearing the pick, NOT writing the automatic colour into it — otherwise
    // the unit would be frozen at today's NAD colour forever.
    expect(updateFormation).toHaveBeenCalledWith('proj-1', 'f-1', { color_override: null })
  })

  it('CP6 — a unit nobody has coloured has nothing to reset', () => {
    renderInspector(
      makeCtx({
        geotechFormations: [makeFormation('f-1', { nad_class: 6, display_order: 0 })],
        geotechContacts: [makeContact('c-1', 'f-1')],
      }),
    )

    expect(screen.queryByTestId('geotech-unit-color-reset-f-1')).toBeNull()
  })
})
