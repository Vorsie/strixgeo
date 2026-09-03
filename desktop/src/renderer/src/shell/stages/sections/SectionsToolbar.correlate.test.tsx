// Behavioral net for the Slice-4 Correlate toolbar button in SectionsToolbar.
//
// Claims pinned here:
//   CT1  Correlate button is HIDDEN when the section axis is geological
//        (isLitho = false â†’ the whole {isLitho && â€¦} block is absent).
//   CT2  Correlate button is DISABLED when activeLithoModel is null, even
//        when the axis is lithostratigraphic.
//   CT3  Correlate button is DISABLED when no section is selected
//        (selectedSectionId = null), even with a litho model present.
//   CT4  When activeLithoModel is set AND a section is selected, the button
//        is enabled. Clicking it calls enterCorrelateMode.
//   CT5  When correlateMode is true, the button label spells out the
//        next-step action ("Correlate Â· click 2 bands") and clicking
//        it calls exitCorrelateMode. The label was changed from
//        "Correlatingâ€¦" on 2026-05-20 because users mistook the
//        spinner-style phrasing for "work in progress, please wait"
//        instead of "click bands to proceed".
//   CT6  Switching the axis from lithostratigraphic back to geological
//        invokes setSectionModelAxis('geological') â€” the toolbar delegates
//        clearing correlate mode to the useSections axis-switch wrapper.
//
//   Auto-correlate pre-check (Slice 4 Half-A) â€” handleAutoCorrelateWithCheck:
//   ACW1 0 existing auto edges â†’ fires handleAutoCorrelate immediately (no dialog).
//   ACW2 N>0 existing auto edges â†’ opens ReCorrelateConfirmDialog instead of
//        firing immediately.
//   ACW3 listCorrelations API error â†’ toasts an error, does NOT open dialog,
//        does NOT fire handleAutoCorrelate.

import { cleanup, fireEvent, render, screen, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import { api } from '../../../api/client'
import type {
  CrossSectionResponse,
  FormationContactResponse,
  GeologicalModelResponse,
  LithoContactCorrelationEdge,
} from '../../../api/client'
import SectionsToolbar from './SectionsToolbar'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// vi.mock is hoisted â€” the factory must NOT reference top-level `const`
// variables declared in the test module (TDZ). All mock functions are
// created inside the factory so they are available at hoist time.
// The ACW tests override them per-call with .mockResolvedValueOnce().
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        // Default: empty list â†’ ACW1 branch (no dialog). ACW tests override
        // with .mockResolvedValueOnce() via the imported api object.
        // TODO Task 19: renamed from listCorrelations to listContactCorrelations.
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        deleteAutoCorrelations: vi.fn().mockResolvedValue({ deleted: 0 }),
        // TODO Task 19: renamed from autoCorrelate to autoCorrelateContacts.
        autoCorrelateContacts: vi.fn().mockResolvedValue({
          edges_created: 0,
          edges_skipped_existing: 0,
        }),
        acceptContactCorrelations: vi.fn().mockResolvedValue({
          edges_accepted: 0,
          ordinals_changed: 0,
        }),
        materialiseBodyCompanions: vi.fn().mockResolvedValue({
          companion_sections_created: 0,
          skipped_no_primary: 0,
          skipped_unfinished_section: 0,
          errored: 0,
        }),
      },
      virtueleBoring: {
        getModels: vi.fn().mockResolvedValue([]),
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
// Stub context factory
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)

function makeLithoModel(): GeologicalModelResponse {
  return {
    id: 'model-litho-1',
    app_project_id: 'proj-1',
    name: 'Litho model',
    description: null,
    kind: 'lithostratigraphic',
    parent_model_id: 'model-geo-1',
    is_active: true,
    excluded_borehole_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

// TODO Task 19: makeAutoEdge now returns LithoContactCorrelationEdge.
function makeAutoEdge(id: string): LithoContactCorrelationEdge {
  return {
    id,
    layer_a_id: 'ca-1',
    layer_b_id: 'cb-1',
    model_id: 'm-1',
    section_id: 's-1',
    source: 'auto',
    user_approved: false,
    layer_a_side: 'top',
    layer_b_side: 'top',
    created_at: '2026-01-01T00:00:00Z',
  }
}

function makeCtx(overrides: {
  activeLithoModel?: GeologicalModelResponse | null
  sectionModelAxis?: 'geological' | 'lithostratigraphic'
  setSectionModelAxis?: (axis: 'geological' | 'lithostratigraphic') => void
  selectedSectionId?: string | null
  /** Section row's seeded_formation_contact_ids. No longer gates the Correlate
   *  button (classification follows the test, 2026-06-08) — kept for the few
   *  call sites that still pass it; the gate now reads the in-corridor set. */
  sectionSeededContactIds?: string[]
  /** Active litho model contacts. Defaults to ``[{ id: 'c-1', anchor bh-1 }]``
   *  so the default in-corridor borehole (bh-1) puts one litho contact on the
   *  section and CT4/CT5 stay enabled. */
  lithoContacts?: FormationContactResponse[]
  /** Visible CPTs/boreholes — the section's corridor is computed from these.
   *  ``visibleBoreholes`` defaults to one in-corridor bh-1 (matching the
   *  default litho contact's anchor). Pass ``[]`` to model "no investigation
   *  on this section" (the new "nothing to correlate" state). */
  visibleCpts?: ShellContextValue['visibleCpts']
  visibleBoreholes?: ShellContextValue['visibleBoreholes']
  correlateMode?: boolean
  enterCorrelateMode?: () => void
  exitCorrelateMode?: () => void
  handleAutoCorrelate?: () => Promise<void>
  handleClearSuggestions?: () => Promise<void>
  requestCorrelationEdgesRefetch?: () => void
  toast?: () => void
} = {}): ShellContextValue {
  const setSectionModelAxis = overrides.setSectionModelAxis ?? vi.fn()
  const enterCorrelateMode = overrides.enterCorrelateMode ?? vi.fn()
  const exitCorrelateMode = overrides.exitCorrelateMode ?? vi.fn()
  const toastFn = overrides.toast ?? vi.fn()
  const sectionSeededContactIds = overrides.sectionSeededContactIds ?? ['c-1']
  // The section corridor is (0,0)→(100,0) with a 50 m buffer (see the section
  // stub below). The default borehole sits on the line so the default litho
  // contact (anchor bh-1) projects in-corridor → sectionHasLithoContacts true.
  const visibleCpts = overrides.visibleCpts ?? []
  const visibleBoreholes =
    overrides.visibleBoreholes ??
    ([{ id: 'bh-1', name: 'BH-1', location_x: 50, location_y: 0 }] as unknown as ShellContextValue['visibleBoreholes'])
  const lithoContacts =
    overrides.lithoContacts ??
    ([
      {
        id: 'c-1',
        app_project_id: 'proj-1',
        geological_model_id: 'model-litho-1',
        formation_id: 'f-1',
        cpt_id: null,
        borehole_id: 'bh-1',
        depth_top_m: 1.0,
        source: 'manual',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ] as unknown as FormationContactResponse[])

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
    visibleCpts,
    visibleBoreholes,
    geoModel: {
      activeGeologicalModel: {
        id: 'model-geo-1',
        app_project_id: 'proj-1',
        name: 'Default model',
        description: null,
        kind: 'geological',
        parent_model_id: null,
        is_active: true,
        excluded_borehole_ids: [],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      models: [],
      activeLithoModel: overrides.activeLithoModel ?? null,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: async () => {},
      lithoContacts,
      lithoFormations: [],
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
      handleAcceptLithoSuggestion: noopAsyncNull,
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      handleDeleteLithoModel: noopAsync,
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
      handleAutoCorrelate: overrides.handleAutoCorrelate ?? noopAsync,
      handleClearSuggestions: overrides.handleClearSuggestions ?? noopAsync,
      // Read by the re-subdivide confirmation's hand-edit count. Always an
      // array on the real bus; this stub predates the field.
      geotechLayers: [],
      // Read by the D-Series export rows — the packing-class identity map and
      // the litho frame the geotech fill is drawn on. Same story as
      // ``geotechLayers``: always arrays on the real bus.
      geotechFormations: [],
      lithoLayers: [],
      requestCorrelationEdgesRefetch: overrides.requestCorrelationEdgesRefetch ?? vi.fn(),
    },
    sections: {
      sections: overrides.selectedSectionId
        ? [
            {
              id: overrides.selectedSectionId,
              name: 'S1',
              seeded_formation_contact_ids: sectionSeededContactIds,
              // Geometry so inCorridorInvestigationIds can project the visible
              // boreholes/CPTs: a 100 m line with a 50 m lateral buffer.
              start_x: 0,
              start_y: 0,
              end_x: 100,
              end_y: 0,
              projection_buffer_m: 50,
              excluded_cpt_ids: [],
              excluded_borehole_ids: [],
            } as unknown as CrossSectionResponse,
          ]
        : [],
      selectedSectionId: overrides.selectedSectionId ?? null,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: overrides.sectionModelAxis ?? 'lithostratigraphic',
      setSectionModelAxis,
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
      correlateMode: overrides.correlateMode ?? false,
      correlationSource: null,
      enterCorrelateMode,
      exitCorrelateMode,
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
    },
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
    toasts: { toasts: [], toast: toastFn },
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
  } as unknown as ShellContextValue
}

// ---------------------------------------------------------------------------
// Render helper
// ---------------------------------------------------------------------------

function renderWith(ctx: ShellContextValue) {
  return render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

// Helper â€” open the SplitToolbarButton's caret so the Auto-correlate +
// Accept-correlations items render into the portalled menu and become
// queryable by their testids.  Used by every test that asserts state
// on those items (debt #141 â€” three buttons collapsed into one slot).
function openCorrelateCaret(): void {
  fireEvent.click(screen.getByTestId('correlate-mode-caret'))
}

// ---------------------------------------------------------------------------
// Tests â€” Correlate mode button (CT1â€“CT6)
// ---------------------------------------------------------------------------

describe('SectionsToolbar Correlate button (Slice 4)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('CT1: Correlate button absent when axis is geological', () => {
    renderWith(
      makeCtx({
        sectionModelAxis: 'geological',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
      }),
    )
    // The isLitho block is absent on geological axis
    expect(screen.queryByRole('button', { name: /correlate/i })).toBeNull()
  })

  it('CT2: Correlate button disabled when no active litho model', () => {
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: null,
        selectedSectionId: 'sec-1',
      }),
    )
    const btn = screen.getByRole('button', { name: 'Correlate' })
    expect(btn).toBeDisabled()
  })

  it('CT3: Correlate primary does NOT enter mode when no section selected', () => {
    // With "Clear correlation suggestions" now a caret item gated only on the
    // model, the caret always has an enabled item when a model exists, so the
    // disabled primary becomes a "click for options" caret-fallback rather
    // than fully inert. The #139 protection that matters is preserved: a click
    // must NOT enter correlate mode (it opens the options menu instead).
    const enterCorrelateMode = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: null,
        enterCorrelateMode,
      }),
    )
    fireEvent.click(screen.getByTestId('correlate-mode'))
    expect(enterCorrelateMode).not.toHaveBeenCalled()
  })

  it('CT4: enabled with litho model + section; click calls enterCorrelateMode', () => {
    const enterCorrelateMode = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        correlateMode: false,
        enterCorrelateMode,
      }),
    )
    const btn = screen.getByRole('button', { name: 'Correlate' })
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(enterCorrelateMode).toHaveBeenCalledOnce()
  })

  it('CT5: when correlateMode=true label tells user to click 2 bands; click calls exitCorrelateMode', () => {
    const exitCorrelateMode = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        correlateMode: true,
        exitCorrelateMode,
      }),
    )
    // Both the primary button and the caret's aria-label contain "click
    // 2 bands" after the SplitToolbarButton refactor.  Target the
    // primary by its testid (correlate-mode); the caret testid is
    // correlate-mode-caret.
    const btn = screen.getByTestId('correlate-mode')
    expect(btn.textContent).toMatch(/click 2 bands/i)
    fireEvent.click(btn)
    expect(exitCorrelateMode).toHaveBeenCalledOnce()
  })

  // Debt #139 â€” entering correlate mode on a section with zero litho
  // contacts produces no clickable hit-rects (CorrelationEdgesOverlay
  // only renders gesture rects when contacts.length > 0).  Gate the
  // toolbar button so the failure mode is discoverable.
  it('CT7: Correlate primary does NOT enter mode when section has 0 litho contacts', () => {
    // Caret-fallback (see CT3): a click opens options instead of entering a
    // correlate mode that would find nothing clickable (#139 protection).
    const enterCorrelateMode = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        // Section selected but no contacts seeded â†’ nothing to correlate.
        sectionSeededContactIds: [],
        lithoContacts: [],
        enterCorrelateMode,
      }),
    )
    fireEvent.click(screen.getByTestId('correlate-mode'))
    expect(enterCorrelateMode).not.toHaveBeenCalled()
  })

  it('CT7b: Correlate primary does NOT enter mode when model has contacts but NONE on this section', () => {
    // Litho model has a contact (default anchor bh-1), but no investigation
    // projects into this section's corridor (visibleBoreholes = []), so the
    // contact is not on the section and correlate mode finds nothing clickable.
    const enterCorrelateMode = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        // No in-corridor investigation → the default litho contact's anchor
        // (bh-1) is off-section, so the gate reads "nothing to correlate".
        visibleBoreholes: [],
        enterCorrelateMode,
      }),
    )
    fireEvent.click(screen.getByTestId('correlate-mode'))
    expect(enterCorrelateMode).not.toHaveBeenCalled()
  })

  it('CT-CLR: Clear correlation suggestions is a caret item, enabled with a model, and clears', () => {
    // Moved under the Correlate caret (dogfeed 2026-05-29). Gated on the model
    // only, so it stays enabled even when the section has 0 contacts.
    const handleClearSuggestions = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        sectionSeededContactIds: [],
        lithoContacts: [],
        handleClearSuggestions,
      }),
    )
    openCorrelateCaret()
    const clear = screen.getByTestId('litho-clear-suggestions')
    expect(clear).not.toBeDisabled()
    expect(clear.textContent).toMatch(/clear correlation suggestions/i)
    fireEvent.click(clear)
    expect(handleClearSuggestions).toHaveBeenCalledOnce()
  })

  it('CT8: still clickable to EXIT when correlateMode is already on, even with 0 contacts', () => {
    // Once in correlate mode, the button must remain usable so the user
    // can leave it.  Disabling here would trap the user in a mode they
    // cannot exit via the toolbar.
    const exitCorrelateMode = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        sectionSeededContactIds: [],
        lithoContacts: [],
        correlateMode: true,
        exitCorrelateMode,
      }),
    )
    const btn = screen.getByTestId('correlate-mode')
    expect(btn).not.toBeDisabled()
    fireEvent.click(btn)
    expect(exitCorrelateMode).toHaveBeenCalledOnce()
  })

  // Debt #139 dogfeed follow-up (2026-05-27) â€” owner asked for the
  // Auto-correlate + Accept-correlations buttons to share the
  // Correlate button's "no litho contacts on section" gate.  All three
  // correlation verbs are contextually scoped to "this section", so
  // disabling them together when the section is empty matches user
  // expectation (a single visual story, not three independently-
  // gated buttons).
  it('CT9: Auto-correlate item disabled when section has 0 litho contacts', () => {
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        sectionSeededContactIds: [],
        lithoContacts: [],
      }),
    )
    openCorrelateCaret()
    expect(screen.getByTestId('litho-auto-correlate')).toBeDisabled()
  })

  it('CT10: Accept correlations item disabled when section has 0 litho contacts', () => {
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        sectionSeededContactIds: [],
        lithoContacts: [],
      }),
    )
    openCorrelateCaret()
    expect(screen.getByTestId('litho-accept-correlations')).toBeDisabled()
  })

  it('CT11: Auto-correlate tooltip drops the stale "dip-transfer" wording', () => {
    // Phase 2+3 of debt #133 moved auto-correlate from the formation-
    // level dip-transfer algorithm to the contact-level depth+distance
    // matcher (``AutoCorrelateContactEdges``).  The tooltip referred to
    // the old algorithm by name until dogfeed 2026-05-27 flagged it.
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
      }),
    )
    openCorrelateCaret()
    const btn = screen.getByTestId('litho-auto-correlate')
    expect(btn.getAttribute('title') ?? '').not.toMatch(/dip[- ]transfer|dip correction/i)
    expect(btn.getAttribute('title') ?? '').toMatch(/contact/i)
  })

  it('CT6: switching axis to geological calls setSectionModelAxis("geological")', () => {
    const setSectionModelAxis = vi.fn()
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        setSectionModelAxis,
      }),
    )
    // The Geology radio button in the axis toggle (role=radio, not role=button)
    const geoBtn = screen.getByRole('radio', { name: /geology/i })
    fireEvent.click(geoBtn)
    expect(setSectionModelAxis).toHaveBeenCalledWith('geological')
  })
})

// ---------------------------------------------------------------------------
// Tests â€” Auto-correlate pre-check (Slice 4 Half-A â€” ACW1â€“ACW3)
//
// handleAutoCorrelateWithCheck:
//   1. GET listCorrelations â†’ count source='auto' edges.
//   2. autoCount === 0 â†’ fire handleAutoCorrelate immediately (no dialog).
//   3. autoCount > 0  â†’ open ReCorrelateConfirmDialog.
//
// WHY these tests: the CT tests above only cover the "Correlate mode" toggle
// button. handleAutoCorrelateWithCheck was never exercised by any Vitest test
// before ACW1-ACW3 were added (dogfeed 2026-05-25 regression anchor). The
// dialog wiring is correct in code but the missing tests left the pre-check
// path un-anchored â€” any refactor that broke the source='auto' filter or
// accidentally swapped the zero-branch logic would have been invisible.
// ---------------------------------------------------------------------------

describe('SectionsToolbar Auto-correlate pre-check (Slice 4 Half-A)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('ACW1: 0 auto edges â†’ fires handleAutoCorrelate immediately, no dialog', async () => {
    // listCorrelations returns [] â†’ autoCount = 0 â†’ immediate fire.
    vi.mocked(api.geology.listContactCorrelations).mockResolvedValueOnce([])
    const handleAutoCorrelate = vi.fn().mockResolvedValue(undefined)

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        handleAutoCorrelate,
      }),
    )

    openCorrelateCaret()
    const btn = screen.getByTestId('litho-auto-correlate')
    await act(async () => { fireEvent.click(btn) })

    // handleAutoCorrelate fires; the dialog must NOT open.
    expect(handleAutoCorrelate).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('re-correlate-confirm-dialog')).toBeNull()
  })

  it('ACW1b: manual-only edges (source=manual) are NOT counted as auto edges', async () => {
    // A manual edge must not trigger the dialog â€” only source='auto' counts.
    // TODO Task 19: updated to LithoContactCorrelationEdge.
    const manualEdge: LithoContactCorrelationEdge = {
      id: 'edge-manual-1',
      layer_a_id: 'ca-1',
      layer_b_id: 'cb-1',
      model_id: 'm-1',
      section_id: 's-1',
      source: 'manual',
      user_approved: false,
      layer_a_side: 'top',
      layer_b_side: 'top',
      created_at: '2026-01-01T00:00:00Z',
    }
    vi.mocked(api.geology.listContactCorrelations).mockResolvedValueOnce([manualEdge])
    const handleAutoCorrelate = vi.fn().mockResolvedValue(undefined)

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        handleAutoCorrelate,
      }),
    )

    openCorrelateCaret()
    const btn = screen.getByTestId('litho-auto-correlate')
    await act(async () => { fireEvent.click(btn) })

    // Manual edges do not trigger the dialog â€” fires immediately.
    expect(handleAutoCorrelate).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('re-correlate-confirm-dialog')).toBeNull()
  })

  it('ACW1c: APPROVED auto edges (user_approved=true) do NOT trigger the dialog', async () => {
    // Accepted auto-correlations are committed — re-correlate would not delete
    // them — so they must not pop a spurious "overwrite?" dialog on a section
    // the user already accepted / never suggested on (dogfeed 2026-06-08).
    const acceptedAuto: LithoContactCorrelationEdge = {
      id: 'edge-auto-approved-1',
      layer_a_id: 'ca-1',
      layer_b_id: 'cb-1',
      model_id: 'm-1',
      section_id: 's-1',
      source: 'auto',
      user_approved: true,
      layer_a_side: 'top',
      layer_b_side: 'top',
      created_at: '2026-01-01T00:00:00Z',
    }
    vi.mocked(api.geology.listContactCorrelations).mockResolvedValueOnce([acceptedAuto])
    const handleAutoCorrelate = vi.fn().mockResolvedValue(undefined)

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        handleAutoCorrelate,
      }),
    )

    openCorrelateCaret()
    await act(async () => {
      fireEvent.click(screen.getByTestId('litho-auto-correlate'))
    })

    // Only UNAPPROVED auto edges count → fires immediately, no dialog.
    expect(handleAutoCorrelate).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('re-correlate-confirm-dialog')).toBeNull()
  })

  it('ACW2: N>0 auto edges â†’ dialog opens, handleAutoCorrelate NOT yet called', async () => {
    // listCorrelations returns 3 auto edges â†’ autoCount = 3 â†’ dialog opens.
    vi.mocked(api.geology.listContactCorrelations).mockResolvedValueOnce([
      makeAutoEdge('edge-auto-1'),
      makeAutoEdge('edge-auto-2'),
      makeAutoEdge('edge-auto-3'),
    ])
    const handleAutoCorrelate = vi.fn().mockResolvedValue(undefined)

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        handleAutoCorrelate,
      }),
    )

    openCorrelateCaret()
    const btn = screen.getByTestId('litho-auto-correlate')
    await act(async () => { fireEvent.click(btn) })

    // Dialog must be visible.
    expect(screen.getByTestId('re-correlate-confirm-dialog')).not.toBeNull()
    // handleAutoCorrelate must NOT have fired yet â€” that's the dialog's job.
    expect(handleAutoCorrelate).not.toHaveBeenCalled()
    // Dialog shows the edge count.
    expect(screen.getByText('3')).not.toBeNull()
  })

  it('ACW3: listCorrelations error â†’ toast error, no dialog, handleAutoCorrelate not called', async () => {
    // Pre-check fails â†’ toast error, clean up, no dialog.
    vi.mocked(api.geology.listContactCorrelations).mockRejectedValueOnce(new Error('network failure'))
    const handleAutoCorrelate = vi.fn()
    const toast = vi.fn()

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        handleAutoCorrelate,
        toast,
      }),
    )

    openCorrelateCaret()
    const btn = screen.getByTestId('litho-auto-correlate')
    await act(async () => { fireEvent.click(btn) })

    // Error toast fired; dialog absent; handleAutoCorrelate never called.
    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('pre-check'))
    expect(screen.queryByTestId('re-correlate-confirm-dialog')).toBeNull()
    expect(handleAutoCorrelate).not.toHaveBeenCalled()
    // Item should return to enabled state (autoCorrelating cleared in finally).
    // Re-open the caret so the menu re-renders with the post-flight state.
    openCorrelateCaret()
    expect(screen.getByTestId('litho-auto-correlate')).not.toBeDisabled()
  })
})

// ---------------------------------------------------------------------------
// Tests â€” Accept correlations button (S5 â€” Task 19)
//
// handleAcceptCorrelations (litho-accept-correlations):
//   S5-1  Button present when axis=lithostratigraphic + model + section.
//   S5-2  Button disabled when no active litho model.
//   S5-3  Button disabled when no section selected.
//   S5-4  Clicking the button calls acceptContactCorrelations with
//         (projectId, modelId, sectionId) and toasts on success.
//   S5-5  API error â†’ toasts an error, button re-enables.
// ---------------------------------------------------------------------------

describe('SectionsToolbar Accept correlations button (Task 19)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('S5-1: Accept correlations item is present on litho axis with model + section', () => {
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
      }),
    )
    openCorrelateCaret()
    expect(screen.getByTestId('litho-accept-correlations')).not.toBeNull()
  })

  it('S5-2: Accept correlations item disabled when no litho model', () => {
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: null,
        selectedSectionId: 'sec-1',
      }),
    )
    // SplitToolbarButton's caret stays usable even when the primary verb
    // is disabled (fallback path); open it so the items render, then
    // assert the Accept item carries the !activeLithoModel gate.
    openCorrelateCaret()
    expect(screen.getByTestId('litho-accept-correlations')).toBeDisabled()
  })

  it('S5-3: Accept correlations item disabled when no section selected', () => {
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: null,
      }),
    )
    openCorrelateCaret()
    expect(screen.getByTestId('litho-accept-correlations')).toBeDisabled()
  })

  it('S5-4: clicking Accept calls acceptContactCorrelations(projectId, modelId, sectionId), toasts success, and refetches edges', async () => {
    vi.mocked(api.geology.acceptContactCorrelations).mockResolvedValueOnce({
      edges_accepted: 3,
      ordinals_changed: 2,
    })
    const toast = vi.fn()
    // Pin the dogfeed-2026-06-08 fix: the accepted edges flip to approved
    // server-side, so the handler must force the canvas to re-GET them, else
    // they render as stale dashed suggestions even though the accept succeeded.
    const requestCorrelationEdgesRefetch = vi.fn()

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        toast,
        requestCorrelationEdgesRefetch,
      }),
    )

    openCorrelateCaret()
    const btn = screen.getByTestId('litho-accept-correlations')
    await act(async () => { fireEvent.click(btn) })

    expect(api.geology.acceptContactCorrelations).toHaveBeenCalledWith('proj-1', 'model-litho-1', 'sec-1')
    expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('3'))
    expect(requestCorrelationEdgesRefetch).toHaveBeenCalledTimes(1)
  })

  it('S5-5: API error â†’ toasts error, item re-enables after flight', async () => {
    vi.mocked(api.geology.acceptContactCorrelations).mockRejectedValueOnce(new Error('server error'))
    const toast = vi.fn()

    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
        toast,
      }),
    )

    openCorrelateCaret()
    const btn = screen.getByTestId('litho-accept-correlations')
    await act(async () => { fireEvent.click(btn) })

    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('Accept failed'))
    // Re-open the caret so the menu re-renders with the post-flight state.
    openCorrelateCaret()
    expect(screen.getByTestId('litho-accept-correlations')).not.toBeDisabled()
  })
})

describe('SectionsToolbar Accept all pinch-outs', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  const openBodies = (): void => {
    fireEvent.click(screen.getByTestId('litho-bodies-dropdown'))
  }

  it('AP1: Detect / Suggest / Accept / Delete-detected body verbs are absent (retired with body-extent system)', () => {
    // Retired 2026-06-06: the partition fill renders bodies in pure geometry;
    // the manual DB-entity verbs are no longer wired. Fill bands + Materialise
    // are the keeper verbs.
    renderWith(
      makeCtx({
        sectionModelAxis: 'lithostratigraphic',
        activeLithoModel: makeLithoModel(),
        selectedSectionId: 'sec-1',
      }),
    )
    openBodies()
    expect(screen.queryByTestId('litho-detect-lenses')).toBeNull()
    expect(screen.queryByTestId('body-suggest-pinch-outs')).toBeNull()
    expect(screen.queryByTestId('body-accept-all-pinch-outs')).toBeNull()
    expect(screen.queryByTestId('litho-delete-detected-bodies')).toBeNull()
    // The keeper verb is still present.
    expect(screen.getByTestId('litho-fill-bands')).toBeTruthy()
  })
})
