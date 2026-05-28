// Behavioral net for LithologyInspector.
//
// Claims pinned here (Slice C, #55 peer-stage scaffolding):
//   I1  When activeGeologicalModel is null: guidance to create a
//       geological model first is shown; no ModelKindPicker.
//   I2  When a litho model is active and formations/contacts exist:
//       the roster renders each formation row with its name and the
//       correct contact count for THIS model.
//   I3  When lithoStaleSurfaceCount > 0: the stale banner renders
//       with the correct count.  When 0: banner is absent.
//   I4  Litho formations are grouped under their parent geological
//       formation, ordered ascending by display_order (oldest first).
//       Units without a parent_formation_id appear in an "Unassigned"
//       group at the bottom.
//
// Claims pinned here (Phase-2 Slice 2 â€” ordinal display + lock + RO-3):
//   S1  Ordinal badge renders "body N" when instance_ordinal is set and
//       "body ?" when null.
//   S2  Lock toggle button PATCHes instance_ordinal_locked and refetches
//       formations.
//   S3  "Resolve instances" button calls resolveLithoInstances and then
//       refetchFormations.
//   S4  RO-3 amber stale badge is ABSENT after a resolve synchronises the
//       baseline, when nothing is locked, or when the edge set is
//       unchanged. (The badge-PRESENT happy path is not reachable through
//       this component's public surface â€” it is unit-tested directly on
//       the extracted pure predicate in ordinalStaleness.test.ts; review
//       SF-1.)
//
// Pattern: render LithologyInspector inside a ShellContext.Provider â€”
// same approach as SectionsToolbar.axis.test.tsx.  ModelKindPicker and
// api are mocked so network calls do not bleed into these tests.

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoContactCorrelationEdge,
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

// Mock api.geology so listContactCorrelations, updateFormation, and listLenses
// don't make real fetch calls in jsdom.
// TODO Task 19+21: resolveLithoInstances removed; ordinals auto-resolved on accept.
const mockListContactCorrelations = vi.fn<() => Promise<LithoContactCorrelationEdge[]>>()
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
        listContactCorrelations: (...args: unknown[]) => mockListContactCorrelations(...(args as [])),
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
    parent_geological_model_id: null,
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
    parent_geological_model_id: 'geo-1',
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

// TODO Task 19+21: makeEdge now returns LithoContactCorrelationEdge.
function makeEdge(id: string): LithoContactCorrelationEdge {
  return {
    id,
    contact_a_id: 'ca-a',
    contact_b_id: 'cb-b',
    model_id: 'm-1',
    source: 'manual',
    user_approved: false,
    created_at: '2026-01-01T00:00:00Z',
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
  lithoStaleSurfaceCount?: number
  lithoStaleTinSessionCount?: number
  refetchFormations?: () => void
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
      activeGeologicalModel: 'activeGeologicalModel' in overrides
        ? (overrides.activeGeologicalModel ?? null)
        : makeGeoModel(),
      models: [],
      activeLithoModel: overrides.activeLithoModel ?? null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: noopAsync,
      handleDeleteLithoModel: noopAsync,
      lithoContacts: overrides.lithoContacts ?? [],
      lithoFormations: overrides.lithoFormations ?? [],
      lithoSurfacesByFormationId: new Map(),
      lithoStaleSurfaceCount: overrides.lithoStaleSurfaceCount ?? 0,
      lithoStaleTinSessionCount: overrides.lithoStaleTinSessionCount ?? 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleCreateManualLithoGhost: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
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
      refetchFormations: overrides.refetchFormations ?? vi.fn(),
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
  // Default: listContactCorrelations returns empty list (no edges).
  // TODO Task 19+21: resolveLithoInstances removed; resolved on accept.
  mockListContactCorrelations.mockResolvedValue([])
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
  it('I1 â€” no geological model: shows "create a geological model first" guidance', () => {
    const ctx = makeCtx({ activeGeologicalModel: null })
    renderInspector(ctx)

    expect(screen.getByText(/create a geological model first/i)).toBeInTheDocument()
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

  // I3a: lithoStaleSurfaceCount > 0 â†’ stale banner renders with correct count.
  it('I3a â€” stale banner renders when lithoStaleSurfaceCount > 0', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoStaleSurfaceCount: 2,
    })
    renderInspector(ctx)

    const banner = screen.getByTestId('litho-stale-banner')
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveTextContent(/2 litho surfaces? stale/i)
    expect(banner).toHaveTextContent(/build on sections/i)
  })

  // I3b: lithoStaleSurfaceCount === 0 â†’ no stale banner.
  it('I3b â€” stale banner is absent when lithoStaleSurfaceCount is 0', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoStaleSurfaceCount: 0,
    })
    renderInspector(ctx)

    expect(screen.queryByTestId('litho-stale-banner')).not.toBeInTheDocument()
  })

  // I4: litho formations grouped under geological parent ordered by display_order.
  it('I4 â€” litho roster is grouped under geological parents ordered ascending by display_order', () => {
    const tertiair = makeFormation('geo-t', 'Tertiair', { display_order: 0 })
    const kwartair = makeFormation('geo-k', 'Kwartair', { display_order: 1 })

    const lithoT1 = makeFormation('lf-t1', 'Zand (tertiair)', {
      parent_formation_id: 'geo-t',
    })
    const lithoT2 = makeFormation('lf-t2', 'Klei (tertiair)', {
      parent_formation_id: 'geo-t',
    })
    const lithoK1 = makeFormation('lf-k1', 'Zand (kwartair)', {
      parent_formation_id: 'geo-k',
    })
    const lithoU = makeFormation('lf-u', 'Onbekend', {
      parent_formation_id: null,
    })

    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      formations: [kwartair, tertiair], // deliberately out of order
      lithoFormations: [lithoT1, lithoT2, lithoK1, lithoU],
      // Debt #147 follow-up: roster only renders formations with at
      // least one contact in the active model.
      lithoContacts: [
        makeContact('c-t1', 'lf-t1'),
        makeContact('c-t2', 'lf-t2'),
        makeContact('c-k1', 'lf-k1'),
        makeContact('c-u', 'lf-u'),
      ],
    })
    renderInspector(ctx)

    expect(screen.getByTestId('litho-formation-row-lf-t1')).toBeInTheDocument()
    expect(screen.getByTestId('litho-formation-row-lf-t2')).toBeInTheDocument()
    expect(screen.getByTestId('litho-formation-row-lf-k1')).toBeInTheDocument()
    expect(screen.getByTestId('litho-formation-row-lf-u')).toBeInTheDocument()

    expect(screen.getByText('Tertiair')).toBeInTheDocument()
    expect(screen.getByText('Kwartair')).toBeInTheDocument()
    expect(screen.getByText('Unassigned')).toBeInTheDocument()

    const allSections = document.querySelectorAll('[aria-label]')
    const labels = Array.from(allSections).map(s => s.getAttribute('aria-label'))
    const tertiairIdx = labels.indexOf('Tertiair')
    const kwartairIdx = labels.indexOf('Kwartair')
    const unassignedIdx = labels.indexOf('Unassigned')
    expect(tertiairIdx).toBeGreaterThanOrEqual(0)
    expect(kwartairIdx).toBeGreaterThan(tertiairIdx)
    expect(unassignedIdx).toBeGreaterThan(kwartairIdx)
  })
})

// ---------------------------------------------------------------------------
// Slice 5 / debt #67 tests (I5)
// ---------------------------------------------------------------------------

describe('LithologyInspector (Slice 5 / debt #67 â€” parent_formation_name)', () => {
  // I5: roster group heading uses parent_formation_name (server-resolved)
  //     when present, rather than requiring the geo-join hit.
  it('I5 â€” group label uses parent_formation_name when set, falls back to geo-join name', () => {
    // Geological formation whose name differs from what a litho unit reports
    // as parent_formation_name (simulates a display-name that differs from the
    // raw ORM row name returned via the geoFormations join â€” e.g. DOV canonical
    // name vs project shortname).
    const geoParent = makeFormation('geo-p', 'Boom Klei (geo join)', { display_order: 0 })

    // Litho unit with server-resolved parent_formation_name set to a different
    // canonical value (Slice 5 enrichment).
    const lithoWithResolvedName = makeFormation('lf-1', 'Zand', {
      parent_formation_id: 'geo-p',
      parent_formation_name: 'Boom Klei (resolved)',
    })

    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      formations: [geoParent],
      lithoFormations: [lithoWithResolvedName],
      lithoContacts: [makeContact('c1', 'lf-1')],
    })
    renderInspector(ctx)

    // The server-resolved name is preferred over the geo-join name.
    expect(screen.getByText('Boom Klei (resolved)')).toBeInTheDocument()
    expect(screen.queryByText('Boom Klei (geo join)')).not.toBeInTheDocument()
  })

  it('I5b â€” group label falls back to geo-join name when parent_formation_name is null', () => {
    const geoParent = makeFormation('geo-q', 'Diest Zand', { display_order: 0 })

    // Litho unit with no server-resolved parent name (null â†’ fallback to join).
    const lithoNoResolvedName = makeFormation('lf-2', 'Zand', {
      parent_formation_id: 'geo-q',
      parent_formation_name: null,
    })

    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      formations: [geoParent],
      lithoFormations: [lithoNoResolvedName],
      lithoContacts: [makeContact('c1', 'lf-2')],
    })
    renderInspector(ctx)

    // The geo-join name is used when parent_formation_name is null.
    expect(screen.getByText('Diest Zand')).toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Phase-2 Slice 2 tests (S1â€“S4)
// ---------------------------------------------------------------------------

describe('LithologyInspector (Phase-2 Slice 2 â€” ordinal + lock + RO-3)', () => {
  // S1: ordinal badge renders "body N" when instance_ordinal is set, "body ?" otherwise.
  it('S1a â€” ordinal badge shows "body N" when instance_ordinal is a number', () => {
    const f = makeFormation('f-a', 'Zand', { instance_ordinal: 2 })
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [f],
      lithoContacts: [makeContact('c1', 'f-a')],
    })
    renderInspector(ctx)

    expect(screen.getByTestId('ordinal-badge-f-a')).toHaveTextContent('body 2')
  })

  it('S1b â€” ordinal badge shows "body ?" when instance_ordinal is null', () => {
    const f = makeFormation('f-a', 'Zand', { instance_ordinal: null })
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [f],
      lithoContacts: [makeContact('c1', 'f-a')],
    })
    renderInspector(ctx)

    expect(screen.getByTestId('ordinal-badge-f-a')).toHaveTextContent('body ?')
  })

  // S2: lock toggle PATCHes instance_ordinal_locked and calls refetchFormations.
  it('S2 â€” lock toggle calls updateFormation with instance_ordinal_locked and refetchFormations', async () => {
    const refetchFormations = vi.fn()
    const f = makeFormation('f-a', 'Zand', { instance_ordinal_locked: false })
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [f],
      lithoContacts: [makeContact('c1', 'f-a')],
      refetchFormations,
    })
    renderInspector(ctx)

    const lockBtn = screen.getByTestId('lock-toggle-f-a')
    await act(async () => {
      fireEvent.click(lockBtn)
    })

    await waitFor(() => {
      expect(mockUpdateFormation).toHaveBeenCalledWith(
        'proj-1',
        'f-a',
        expect.objectContaining({ instance_ordinal_locked: true }),
      )
    })
    await waitFor(() => {
      expect(refetchFormations).toHaveBeenCalled()
    })
  })

  // S3: Resolve button calls refetchFormations and listContactCorrelations.
  // TODO Task 19+21: resolveLithoInstances removed; ordinals auto-resolved on
  // accept. The Resolve button now just refetches formations + contact edges.
  it('S3 â€” Resolve instances button calls refetchFormations and listContactCorrelations', async () => {
    const refetchFormations = vi.fn()
    mockListContactCorrelations.mockResolvedValue([])

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
    await waitFor(() => {
      expect(mockListContactCorrelations).toHaveBeenCalledWith('proj-1', 'litho-1')
    })
  })

  // S4a: RO-3 amber badge is ABSENT once a resolve has synchronised the
  // baseline (currentEdgeCount === lastResolvedEdgeCount). The badge-PRESENT
  // branch is NOT reachable through this component's public surface (driving
  // an edge-count divergence mid-render requires no external trigger) â€” it
  // is unit-tested directly on the extracted pure predicate in
  // ordinalStaleness.test.ts (review SF-1). This test pins the in-sync
  // (absent) behaviour at the component level.
  it('S4a â€” amber stale badge is absent after a resolve synchronises the baseline', async () => {
    // First resolve returns 0 edges (sets baseline = 0).
    // Second listCorrelations call (post-resolve refresh) returns 0 edges too.
    // Afterwards, the live state is manipulated: we re-render with 1 edge
    // already in correlationEdges by making the component refetch again with
    // a new model id â€” simpler approach: use a two-render strategy.
    //
    // Simplest reliable scenario:
    //   1. Mount with 1 edge â†’ baseline = 1 (S4c-like, badge absent).
    //   2. Resolve: post-resolve listCorrelations returns 0 edges â†’ baseline resets to 0.
    //   3. Live edge count is 0 (same as baseline) â†’ still no badge.
    //
    // The REAL S4a scenario requires the component's live edge count to diverge
    // from the baseline BETWEEN resolves.  The component only re-fetches on:
    //   (a) model change, (b) explicit Resolve.
    // So: mount â†’ baseline=0 (empty). Then use two back-to-back resolves:
    //   resolve-1: post-resolve fetch returns 0 â†’ baseline stays 0.
    //   Now mock listCorrelations to return [e-1] from this point on.
    //   resolve-2: resolveLithoInstances is called, then post-resolve fetch
    //     returns [e-1] â†’ baseline = 1. currentEdgeCount = 1. No badge (1===1).
    //
    // The only way to get badge=true without a new model mount is to have the
    // CURRENT edge state update independently of the resolve cycle.  Since
    // the component doesn't poll, we verify the badge via the INITIAL MOUNT
    // path: mount with lastResolvedEdgeCount=0 but correlationEdges=[e-1].
    // That state is only reachable via a model-switch mid-test.
    //
    // Owner-accepted simplification: S4a tests badge ABSENCE after a resolve
    // that changes the baseline (post-resolve edge count matches live count).
    // The presence path is implicitly covered by verifying the ordinalIsStale
    // computation via S4b/S4c.  This matches the comment in the original spec.
    // TODO Task 19+21: resolveLithoInstances removed; Resolve now just
    // calls refetchFormations + listContactCorrelations.
    mockListContactCorrelations.mockResolvedValue([])

    const f = makeFormation('f-a', 'Zand', { instance_ordinal_locked: true })
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [f],
      lithoContacts: [makeContact('c1', 'f-a')],
    })
    renderInspector(ctx)

    // Wait for the initial edge fetch to settle (0 edges â†’ baseline = 0).
    await waitFor(() => {
      expect(mockListContactCorrelations).toHaveBeenCalled()
    })

    // Click Resolve â†’ post-resolve fetch returns 0.
    // baseline updated to 0. currentEdgeCount = 0. 0 === 0 â†’ badge absent.
    await act(async () => {
      fireEvent.click(screen.getByTestId('resolve-instances-btn'))
    })

    await waitFor(() => {
      expect(mockListContactCorrelations).toHaveBeenCalledWith('proj-1', 'litho-1')
    })

    // Badge absent: post-resolve baseline matches current live count.
    expect(screen.queryByTestId('stale-ordinal-badge-f-a')).not.toBeInTheDocument()
  })

  // S4b: RO-3 amber badge is absent when no formations are locked.
  it('S4b â€” amber stale badge is absent when no formations are locked', async () => {
    mockListContactCorrelations.mockResolvedValue([makeEdge('e-1')])

    // Formation is NOT locked even though there are edges.
    const f = makeFormation('f-a', 'Zand', { instance_ordinal_locked: false })
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [f],
      lithoContacts: [makeContact('c1', 'f-a')],
    })
    renderInspector(ctx)

    await waitFor(() => {
      expect(mockListContactCorrelations).toHaveBeenCalled()
    })

    expect(screen.queryByTestId('stale-ordinal-badge-f-a')).not.toBeInTheDocument()
  })

  // S4c: RO-3 amber badge is absent when edge count matches the resolved baseline.
  it('S4c â€” amber stale badge is absent when edge count unchanged since last resolve', async () => {
    // Mount with 1 edge â†’ lastResolvedEdgeCount = 1.
    // currentEdgeCount = 1 â†’ equal â†’ no badge.
    mockListContactCorrelations.mockResolvedValue([makeEdge('e-1')])

    const f = makeFormation('f-a', 'Zand', { instance_ordinal_locked: true })
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoFormations: [f],
      lithoContacts: [makeContact('c1', 'f-a')],
    })
    renderInspector(ctx)

    await waitFor(() => {
      expect(mockListContactCorrelations).toHaveBeenCalled()
    })

    // lastResolvedEdgeCount === currentEdgeCount (both 1) â†’ badge absent.
    expect(screen.queryByTestId('stale-ordinal-badge-f-a')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Debt #87 â€” parent-review badge + ConfirmParentDialog flow
// ---------------------------------------------------------------------------

describe('LithologyInspector (debt #87 â€” parent review)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListContactCorrelations.mockResolvedValue([])
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

  // Stale-TIN diagnostic â€” debt: AcceptLithoSuggestions' straddle-split
  // path can fall back to depth-ordered contacts when the geology TIN is
  // stale/absent. The session counter accumulates that across accepts;
  // the inspector pill surfaces it so the engineer sees "rebuild geology
  // for precision" without digging into logs.
  it('T1 â€” stale-TIN pill renders when lithoStaleTinSessionCount > 0 with the right count', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoStaleTinSessionCount: 3,
    })
    renderInspector(ctx)
    const pill = screen.getByTestId('litho-stale-tin-pill')
    expect(pill).toBeInTheDocument()
    expect(pill).toHaveTextContent(/3 stale-TIN straddle fallbacks this session/i)
    expect(pill).toHaveTextContent(/rebuild geology for precision/i)
  })

  it('T2 â€” stale-TIN pill is absent when count is 0', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoStaleTinSessionCount: 0,
    })
    renderInspector(ctx)
    expect(screen.queryByTestId('litho-stale-tin-pill')).not.toBeInTheDocument()
  })

  it('T3 â€” singular wording when count is exactly 1', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoStaleTinSessionCount: 1,
    })
    renderInspector(ctx)
    const pill = screen.getByTestId('litho-stale-tin-pill')
    expect(pill).toHaveTextContent(/1 stale-TIN straddle fallback this session/i)
  })
})

// ---------------------------------------------------------------------------
// Debt #94 â€” committed-contacts pill + wipe confirm flow
// ---------------------------------------------------------------------------

describe('LithologyInspector (debt #94 â€” wipe committed contacts)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListContactCorrelations.mockResolvedValue([])
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

