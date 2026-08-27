// handleSnapLithoToGeo / handleMoveGeoToLitho — error paths
//
// SE1 — when the snap PATCH rejects, the error toast must fire AND the
//        busy + prompt state must clear (the finally-block is the
//        load-bearing path — it was previously untested).
// SE2 — same invariant for the move-geo-to-litho branch, including the
//        best-effort rollback that swallows a secondary failure.
//
// Design:
//   • SectionPanel mock captures onUpdateContactDepth so the test can
//     call handleLithoSnapAwareUpdateContactDepth directly (opening the
//     snap prompt) without synthesising a canvas drag event.
//   • LithoGeoSnapDialog mock captures its props so the test can drive
//     onSnapToGeo / onMoveGeoToLitho and observe open/busy state.
//   • findGeoSnapCandidates is mocked to return one candidate so the
//     prompt opens after the drag commit.
//   • geoModel.handleUpdateContactDepth is a per-test vi.fn() whose
//     call sequence is: call-1 (drag) → resolves, call-2 (snap/move)
//     → rejects, call-3 SE2 rollback → rejects (swallowed).

import { render, cleanup, act, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import type { FormationContactResponse } from '../../../api/client'
import type { SectionModelAxis } from '../../../hooks/useSections'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Updated on every SectionPanel render — gives test access to the snap handler. */
let capturedOnUpdateContactDepth:
  | ((id: string, depth: number, snapped: boolean, field?: 'top' | 'base') => Promise<void>)
  | undefined = undefined

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: {
    onUpdateContactDepth?: (
      id: string,
      depth: number,
      snapped: boolean,
      field?: 'top' | 'base',
    ) => Promise<void>
    [key: string]: unknown
  }) => {
    capturedOnUpdateContactDepth = props.onUpdateContactDepth
    return null
  },
}))

/** Updated on every LithoGeoSnapDialog render — observable open/busy state. */
let capturedDialogProps:
  | {
      open: boolean
      candidates: FormationContactResponse[]
      lithoDepthM: number
      onSnapToGeo: (id: string) => void
      onMoveGeoToLitho: (id: string) => void
      onCancel: () => void
      busy: boolean
    }
  | undefined = undefined

vi.mock('../../../components/LithoGeoSnapDialog', () => ({
  default: (props: {
    open: boolean
    candidates: FormationContactResponse[]
    lithoDepthM: number
    onSnapToGeo: (id: string) => void
    onMoveGeoToLitho: (id: string) => void
    onCancel: () => void
    busy: boolean
  }) => {
    capturedDialogProps = props
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

/** Controllable: returns a candidate so the snap prompt opens. */
const mockFindGeoSnapCandidates = vi.fn()

vi.mock('../../../utils/lithoGeoSnap', () => ({
  findGeoSnapCandidates: (...args: unknown[]) => mockFindGeoSnapCandidates(...args),
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
        // Called by handleMoveGeoToLitho after moving the geo contact.
        // Never reached in the SE2 error path (throw before this line) but
        // must exist in the mock to avoid "not a function" at module init.
        rebuildSurfaces: vi.fn().mockResolvedValue(undefined),
      },
      virtueleBoring: {
        getModels: vi.fn().mockResolvedValue([]),
      },
      section: {
        list: vi.fn().mockResolvedValue([]),
        get: vi.fn(),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)

/** A minimal litho contact — only the fields handleLithoSnapAwareUpdateContactDepth reads. */
const LITHO_CONTACT = {
  id: 'litho-c1',
  cpt_id: 'cpt-1',
  borehole_id: null,
  depth_top_m: 4.8,
  model_id: 'litho-model-1',
  formation_id: 'form-1',
  source: 'manual',
  confidence: 1.0,
} as unknown as FormationContactResponse

/** A geo candidate — only id + depth_top_m are accessed by handleSnapLithoToGeo. */
const GEO_CANDIDATE = {
  id: 'geo-c1',
  depth_top_m: 5.05,
  model_id: 'geo-model-1',
} as unknown as FormationContactResponse

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

/** Signature of geoModel.handleUpdateContactDepth — used for mock parameter typing. */
type UpdateDepthFn = (
  contactId: string,
  newDepthM: number,
  snapped: boolean,
  field?: 'top' | 'base',
) => Promise<void>

/**
 * Litho-axis context wired with a controllable handleUpdateContactDepth.
 * The axis is 'lithostratigraphic' so isLitho === true inside the snap handler.
 */
function makeLithoCtx(mockHandleUpdateContactDepth: UpdateDepthFn): ShellContextValue {
  const section = makeSection()

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
      // The litho contact is needed so handleLithoSnapAwareUpdateContactDepth
      // can find the dragged contact and resolve anchorId = 'cpt-1'.
      lithoContacts: [LITHO_CONTACT],
      lithoLayers: [],
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
      handleUpdateContactDepth: mockHandleUpdateContactDepth,
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
      discoverBoreholeFormations: async () => ({ candidates: [], collisions: [] }),
      applyBoreholeFormationSelection: noopAsync,
      handleDeleteModel: noopAsync,
      ensureActiveGeologicalModel: async () => null,
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
      handleAcceptLithoSuggestion: noopAsyncNull,
      handleAcceptAllLithoSuggestions: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      handleUnrejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
      handleDeleteLithoModel: noopAsync,
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
      lithoStaleSurfaceCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleClearSuggestions: noopAsync,
      lithoCrossingPinchOuts: [],
      // Litho axis — no active geotech model.
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
      // Must be 'lithostratigraphic' so isLitho === true inside the
      // snap handler (the guard that gates the findGeoSnapCandidates call).
      sectionModelAxis: 'lithostratigraphic' as SectionModelAxis,
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

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

/** Opens the snap prompt by simulating a drag commit + geo candidate found. */
async function openSnapPrompt(ctx: ShellContextValue): Promise<void> {
  // call-1 (drag): resolves immediately → prompt opens
  await act(async () => {
    await capturedOnUpdateContactDepth!('litho-c1', 5.0, false, 'top')
  })
  // After the act, React has flushed the setLithoGeoSnapPrompt state update,
  // so capturedDialogProps.open should now be true.
  expect(capturedDialogProps?.open).toBe(true)
  expect(capturedDialogProps?.candidates).toHaveLength(1)
  void ctx // referenced to satisfy linter
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('handleSnapLithoToGeo / handleMoveGeoToLitho — error paths', () => {
  beforeEach(() => {
    capturedOnUpdateContactDepth = undefined
    capturedDialogProps = undefined
    // Return one candidate so handleLithoSnapAwareUpdateContactDepth opens the prompt.
    mockFindGeoSnapCandidates.mockReturnValue([GEO_CANDIDATE])
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('SE1 — snap PATCH rejects → error toast fires and busy/prompt clear', async () => {
    // call-1 (drag) succeeds; call-2 (snap) fails.
    const mockHandleUpdateContactDepth = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('snap patch failed'))

    const ctx = makeLithoCtx(mockHandleUpdateContactDepth as unknown as UpdateDepthFn)

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedOnUpdateContactDepth).toBeDefined()

    // Phase 1: simulate the drag commit to open the prompt.
    await openSnapPrompt(ctx)

    // Phase 2: simulate the dialog calling onSnapToGeo — fires the async
    // handleSnapLithoToGeo but returns void (the prop is `(id) => void handler(id)`).
    act(() => {
      capturedDialogProps!.onSnapToGeo('geo-c1')
    })

    // SE1a: error toast fires with the exact server message prefix.
    await waitFor(() => {
      expect(ctx.toasts.toast).toHaveBeenCalledWith('error', 'Snap failed: snap patch failed')
    })

    // SE1b: the finally-block cleared the prompt (dialog closes).
    expect(capturedDialogProps!.open).toBe(false)

    // SE1c: handleUpdateContactDepth was called exactly twice (drag + snap).
    expect(mockHandleUpdateContactDepth).toHaveBeenCalledTimes(2)
  })

  it('SE2 — move PATCH rejects → error toast fires, rollback swallowed, prompt clears', async () => {
    // call-1 (drag) succeeds; call-2 (move) fails; call-3 (rollback) also
    // fails — the catch inside handleMoveGeoToLitho swallows it silently.
    const mockHandleUpdateContactDepth = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('move patch failed'))
      .mockRejectedValueOnce(new Error('rollback also failed'))

    const ctx = makeLithoCtx(mockHandleUpdateContactDepth as unknown as UpdateDepthFn)

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedOnUpdateContactDepth).toBeDefined()

    // Phase 1: open the snap prompt via a drag commit.
    await openSnapPrompt(ctx)

    // Phase 2: simulate the dialog calling onMoveGeoToLitho.
    act(() => {
      capturedDialogProps!.onMoveGeoToLitho('geo-c1')
    })

    // SE2a: primary error toast fires with the server message.
    await waitFor(() => {
      expect(ctx.toasts.toast).toHaveBeenCalledWith('error', 'Move failed: move patch failed')
    })

    // SE2b: no success toast (move never completed).
    expect(ctx.toasts.toast).not.toHaveBeenCalledWith('success', expect.any(String))

    // SE2c: the finally-block cleared the prompt (dialog closes).
    expect(capturedDialogProps!.open).toBe(false)

    // SE2d: handleUpdateContactDepth called 3 times: drag + move + rollback.
    expect(mockHandleUpdateContactDepth).toHaveBeenCalledTimes(3)
  })
})
