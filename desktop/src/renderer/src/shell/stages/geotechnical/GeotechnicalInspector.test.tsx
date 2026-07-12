// Behavioral net for GeotechnicalInspector (F5 — geotech NAD roster).
//
// Claims pinned here:
//   R1  A classified unit (nad_class set) shows the packing-class name from
//       nadClassName, a "CPT est." badge, and the NAD swatch colour from
//       nadClassColor.
//   R2  A degenerate unit (nad_class=null) shows no label text and NO
//       "CPT est." badge (null is rare — borehole CPT extrapolation makes it
//       non-standard; the row just shows a neutral swatch).
//   R3  Rows are sorted ascending by display_order then nad_class.
//   R4  Empty state renders when geotechFormations is empty.
//   R5  The contact-count badge shows the count of geotechContacts filtered
//       to this formation.
//
// Pattern: render GeotechnicalInspector inside a ShellContext.Provider —
// mirrors LithologyInspector.test.tsx.

import { cleanup, render, screen } from '@testing-library/react'
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
      lithoFormations: [],
      lithoSurfacesByFormationId: new Map(),
      lithoStaleSurfaceCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      activeGeotechModel: null,
      geotechLayers: overrides.geotechLayers ?? [],
      geotechContacts: overrides.geotechContacts ?? [],
      geotechFormations: overrides.geotechFormations ?? [],
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
      correlationEdgesRefetchNonce: 0,
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
  it('shows the packing-class name label from nadClassName', () => {
    // NAD class 6 = "SAND, medium dense" (from NAD_CLASS_NAMES, English).
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

    const row = screen.getByTestId('geotech-unit-row-f-1')
    expect(row.textContent).toContain('SAND, medium dense')
  })

  it('shows the "CPT est." badge on a classified unit', () => {
    const formation = makeFormation('f-1', { nad_class: 6, display_order: 0 })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

    expect(screen.getByTestId('cpt-est-badge-f-1')).toBeTruthy()
    expect(screen.getByTestId('cpt-est-badge-f-1').textContent).toBe('CPT est.')
  })

  it('applies nadClassColor to the swatch, NOT f.color', () => {
    // nad_class 6 → '#d4b84a' from nadClassColor; f.color = '#aabbcc' (should NOT appear).
    const formation = makeFormation('f-1', { nad_class: 6, color: '#aabbcc', display_order: 0 })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

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

describe('GeotechnicalInspector degenerate unit row (R2)', () => {
  it('shows no label text for a null nad_class unit (degenerate — empty nadClassName)', () => {
    const formation = makeFormation('f-null', { nad_class: null, display_order: 0 })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

    const row = screen.getByTestId('geotech-unit-row-f-null')
    // nadClassName(null) is now '' — the row has a neutral swatch + contact count
    // but no packing-class name text; "No qc" wording is intentionally gone.
    expect(row.textContent).not.toContain('No qc')
  })

  it('does NOT show the "CPT est." badge for a null nad_class unit', () => {
    const formation = makeFormation('f-null', { nad_class: null, display_order: 0 })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

    expect(screen.queryByTestId('cpt-est-badge-f-null')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// R3 — Sort order
// ---------------------------------------------------------------------------

describe('GeotechnicalInspector row sort order (R3)', () => {
  it('sorts rows ascending by display_order', () => {
    const formations = [
      makeFormation('f-b', { nad_class: 7, display_order: 2 }),
      makeFormation('f-a', { nad_class: 5, display_order: 1 }),
      makeFormation('f-c', { nad_class: 8, display_order: 3 }),
    ]
    renderInspector(makeCtx({ geotechFormations: formations, geotechContacts: [] }))

    const rows = screen.getAllByRole('listitem')
    expect(rows[0].getAttribute('data-testid')).toBe('geotech-unit-row-f-a')
    expect(rows[1].getAttribute('data-testid')).toBe('geotech-unit-row-f-b')
    expect(rows[2].getAttribute('data-testid')).toBe('geotech-unit-row-f-c')
  })

  it('uses nad_class as tiebreaker when display_order is equal', () => {
    const formations = [
      makeFormation('f-high', { nad_class: 10, display_order: 0 }),
      makeFormation('f-low', { nad_class: 5, display_order: 0 }),
    ]
    renderInspector(makeCtx({ geotechFormations: formations, geotechContacts: [] }))

    const rows = screen.getAllByRole('listitem')
    // Lower nad_class (5) should come first.
    expect(rows[0].getAttribute('data-testid')).toBe('geotech-unit-row-f-low')
    expect(rows[1].getAttribute('data-testid')).toBe('geotech-unit-row-f-high')
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
    const formation = makeFormation('f-empty', { nad_class: 6, display_order: 0 })
    renderInspector(makeCtx({ geotechFormations: [formation], geotechContacts: [] }))

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
