// Behavioral net for LithologyInspector (Slice C, #55 peer-stage scaffolding).
//
// Claims pinned here:
//   I1  When activeGeologicalModel is null: guidance to create a
//       geological model first is shown; no ModelKindPicker.
//   I2  When a litho model is active and formations/contacts exist:
//       the roster renders each formation row with its name and the
//       correct contact count for THIS model.
//   I3  When lithoStaleSurfaceCount > 0: the stale banner renders
//       with the correct count.  When 0: banner is absent.
//
// Pattern: render LithologyInspector inside a ShellContext.Provider —
// same approach as SectionsToolbar.axis.test.tsx.  ModelKindPicker is
// mocked so its internal api calls do not bleed into these tests.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
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
    // Phase 1 litho-builder fields — null on geological-model rows.
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
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
  lithoFormations?: GeologicalFormationResponse[]
  lithoContacts?: FormationContactResponse[]
  lithoStaleSurfaceCount?: number
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
      handleRebuildLithoSurfaces: noopAsync,
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
      lithoSuggestions: [],
      lithoSuggestionInvestigationId: null,
      lithoSuggestionAnchorKind: null,
      lithoSuggestionAccepted: new Set<number>(),
      lithoSuggestionRejected: new Set<number>(),
      lithoSuggesting: false,
      handleSuggestLitho: noopAsync,
      handleAcceptLithoSuggestion: noopAsync,
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
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

describe('LithologyInspector (Slice C, #55)', () => {
  // I1: no geological model → guidance to create one; no ModelKindPicker.
  it('I1 — no geological model: shows "create a geological model first" guidance', () => {
    const ctx = makeCtx({ activeGeologicalModel: null })
    renderInspector(ctx)

    expect(screen.getByText(/create a geological model first/i)).toBeInTheDocument()
    // ModelKindPicker should NOT render — the geological model gate fires first.
    expect(screen.queryByTestId('model-kind-picker')).not.toBeInTheDocument()
  })

  // I2: litho model active + formations + contacts → roster with correct counts.
  it('I2 — litho model + 2 formations + 3 contacts → roster with per-formation counts', () => {
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

    // Contact counts: f-a has 2, f-b has 1.
    // The count is rendered as a bare number in the <span>.
    const rowA = screen.getByTestId('litho-formation-row-f-a')
    const rowB = screen.getByTestId('litho-formation-row-f-b')
    expect(rowA).toHaveTextContent('2')
    expect(rowB).toHaveTextContent('1')

    // Workflow footer is present.
    expect(
      screen.getByText(/draw contacts on sections, then build/i),
    ).toBeInTheDocument()
  })

  // I3a: lithoStaleSurfaceCount > 0 → stale banner renders with correct count.
  it('I3a — stale banner renders when lithoStaleSurfaceCount > 0', () => {
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

  // I3b: lithoStaleSurfaceCount === 0 → no stale banner.
  it('I3b — stale banner is absent when lithoStaleSurfaceCount is 0', () => {
    const ctx = makeCtx({
      activeLithoModel: makeLithoModel(),
      lithoStaleSurfaceCount: 0,
    })
    renderInspector(ctx)

    expect(screen.queryByTestId('litho-stale-banner')).not.toBeInTheDocument()
  })
})
