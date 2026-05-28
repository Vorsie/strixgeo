// P2 explicit-content invariant tests.
//
// Owner directive 2026-05-17: nothing appears on a section without the user
// clicking a button on that section. These tests verify:
//
//   1. Never-seeded section (seeded_formation_contact_ids = []) â†’ SectionPanel
//      receives zero formation contacts.
//   2. Seeded section (seeded_formation_contact_ids = [c1]) â†’ SectionPanel
//      receives only that contact, even though the model has more.
//   3. applyUpdatedSection (P2-G/P2-H) replaces the section by id in local
//      state so the seeded set is immediately current on the next render.
//   4. Build/TIN path (axisContacts) is unaffected â€” the full model contact
//      list remains available regardless of the section's seeded set.
//
// SectionPanel is mocked so the test captures the props it receives.
// MapView is mocked because Leaflet requires a real DOM.

import { render, cleanup, act } from '@testing-library/react'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import type { FormationContactResponse, GeologicalModelResponse } from '../../../api/client'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let capturedContacts: readonly FormationContactResponse[] | undefined = undefined
// Capture the section-aware callbacks so tests can invoke them (the real
// user gestures: manual draw â†’ onCreateContact, drag-copy â†’ onBatchCreateContacts).
let capturedOnCreateContact:
  | ((
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depth_m: number,
      formationId: string,
      snapped: boolean,
      sectionId?: string | null,
    ) => Promise<void>)
  | undefined = undefined
let capturedOnBatchCreateContacts:
  | ((creates: readonly unknown[]) => Promise<void>)
  | undefined = undefined
// Capture the manual litho unit create callback for M1/M2 tests.
let capturedOnManualLithoUnitCreate:
  | ((
      mainCode: string,
      admixtures: unknown[],
      anchorKind: 'cpt' | 'borehole',
      anchorId: string,
      depthM: number,
    ) => Promise<{ formationId: string } | null>)
  | undefined = undefined
// Capture axisMode so the geological-axis regression (S3) can assert the
// litho picker is NOT wired on the geology axis.
let capturedAxisMode: 'geological' | 'lithostratigraphic' | undefined = undefined

// Capture correlateGestureState so the S5 test can invoke onCorrelate
// and assert the armed source is NOT cleared on a failed POST.
let capturedCorrelateGestureState:
  | { onCorrelate?: (a: string, b: string) => Promise<void> }
  | undefined = undefined

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: {
    contacts?: readonly FormationContactResponse[]
    onCreateContact?: typeof capturedOnCreateContact
    onBatchCreateContacts?: typeof capturedOnBatchCreateContacts
    onManualLithoUnitCreate?: typeof capturedOnManualLithoUnitCreate
    axisMode?: 'geological' | 'lithostratigraphic'
    correlateGestureState?: { onCorrelate?: (a: string, b: string) => Promise<void> }
  }) => {
    // Capture the props each time SectionPanel renders.
    capturedContacts = props.contacts
    capturedOnCreateContact = props.onCreateContact
    capturedOnBatchCreateContacts = props.onBatchCreateContacts
    capturedOnManualLithoUnitCreate = props.onManualLithoUnitCreate
    capturedAxisMode = props.axisMode
    capturedCorrelateGestureState = props.correlateGestureState
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

// api.section.list is used by useSections' auto-load effect (T4b).
// Default resolves to [] so T1â€“T3/T5 are unaffected by pending fetches.
const mockSectionList = vi.fn().mockResolvedValue([])
// api.geology.acceptLithoSuggestions is exercised by M1/M2.
const mockAcceptLithoSuggestions = vi.fn()
// api.geology.correlate is exercised by S5 (armed-source-persists-on-422).
const mockCorrelate = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        acceptLithoSuggestions: (...args: unknown[]) => mockAcceptLithoSuggestions(...args),
        // TODO Task 19: correlate/uncorrelate/listCorrelations removed;
        // replaced by contact-level methods in the full migration.
        createContactCorrelation: (...args: unknown[]) => mockCorrelate(...args),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
      },
      virtueleBoring: {
        getModels: vi.fn().mockResolvedValue([]),
      },
      section: {
        list: (...args: unknown[]) => mockSectionList(...args),
        get: vi.fn(),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const noopAsync = (): Promise<void> => Promise.resolve()
const noopAsyncNull = (): Promise<null> => Promise.resolve(null)

function makeContact(id: string): FormationContactResponse {
  return {
    id,
    model_id: 'model-1',
    formation_id: 'form-1',
    borehole_id: 'bh-1',
    cpt_id: null,
    observation_id: null,
    observation_layer_id: null,
    depth_top_m: 5.0,
    source: 'manual_pick',
    confidence: 'high',
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeSection(overrides?: Partial<ShellContextValue['sections']['sections'][0]>) {
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
    ...overrides,
  }
}

function makeLithoModel(id = 'litho-model-1'): GeologicalModelResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: 'Lithostratigraphic Model',
    description: null,
    is_active: true,
    excluded_borehole_ids: [],
    kind: 'lithostratigraphic',
    parent_geological_model_id: 'geo-model-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeStubContext(overrides?: {
  section?: ReturnType<typeof makeSection>
  contacts?: FormationContactResponse[]
  lithoModel?: GeologicalModelResponse | null
  sectionModelAxis?: 'geological' | 'lithostratigraphic'
}): ShellContextValue {
  const section = overrides?.section ?? makeSection()
  const contacts = overrides?.contacts ?? []
  const lithoModel = overrides?.lithoModel !== undefined ? overrides.lithoModel : null
  const sectionModelAxis = overrides?.sectionModelAxis ?? 'geological'
  const applyUpdatedSection = vi.fn()

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
      activeLithoModel: lithoModel,
      handleCreateLithoModel: async () => null,
      handleActivateLithoModel: async () => {},
      lithoContacts: [],
      lithoFormations: [],
      lithoSurfacesByFormationId: new Map(),
      handleCreateLithoContact: noopAsync,
      handleInlineLithoCreateFormation: noopAsyncNull,
      formations: [],
      visibleFormations: [],
      formationsRefreshCounter: 0,
      // axisContacts = contacts (geological axis is default)
      contacts,
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
      pinchOutPreview: null,
      pinchOutLoading: false,
      handlePreviewPinchOut: async () => false,
      handleCommitPinchOut: noopAsync,
      clearPinchOutPreview: vi.fn(),
      handleSeedLithoFromParent: noopAsync,
      handleDeleteLithoModel: noopAsync,
      backdropSurfacesByFormationId: new Map(),
      handleLoadBackdropSurfaces: noopAsync,
      lithoStaleSurfaceCount: 0,
    lithoStaleTinSessionCount: 0,
      handleRebuildLithoSurfaces: noopAsync,
      handleAutoCorrelate: noopAsync,
      handleCreateManualLithoGhost: vi.fn(),
      handleExtendLithoGhostToNearestContacts: vi.fn(() => ({ ok: true })),
    },
    sections: {
      sections: [section],
      selectedSectionId: section.id,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [section],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: sectionModelAxis as 'geological' | 'lithostratigraphic',
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
      applyUpdatedSection,
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
      correlationEdgesRefetchNonce: 0,
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  capturedContacts = undefined
  capturedOnManualLithoUnitCreate = undefined
  capturedAxisMode = undefined
  capturedCorrelateGestureState = undefined
  // Reset to [] so T1â€“T3/T5 (render-based, no section list needed) are clean.
  mockSectionList.mockResolvedValue([])
  mockAcceptLithoSuggestions.mockReset()
  mockCorrelate.mockReset()
  mockCorrelate.mockResolvedValue(undefined)
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

describe('P2 explicit-content invariant â€” SectionsCanvas contact filtering', () => {
  it('T1: never-seeded section passes zero contacts to SectionPanel', () => {
    // The model has two contacts but the section's seeded set is empty.
    // P2-F must filter axisContacts â†’ sectionContacts = [] before passing
    // to SectionPanel, so a never-seeded section shows no formation content.
    const c1 = makeContact('contact-aaa')
    const c2 = makeContact('contact-bbb')
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      contacts: [c1, c2],
    })
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    // SectionPanel receives no contacts even though the model has two.
    expect(capturedContacts).toEqual([])
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('T2: section with one seeded id passes only that contact to SectionPanel', () => {
    // seeded_formation_contact_ids = [c1.id] â†’ only c1 passes through P2-F.
    // c2 exists in the model but is not on this section.
    const c1 = makeContact('contact-aaa')
    const c2 = makeContact('contact-bbb')
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: ['contact-aaa'] }),
      contacts: [c1, c2],
    })
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    expect(capturedContacts).toHaveLength(1)
    expect(capturedContacts?.[0].id).toBe('contact-aaa')
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('T3: stale id in seeded set (contact deleted from model) is silently skipped', () => {
    // seeded_formation_contact_ids includes a ghost id that no longer exists
    // in axisContacts â€” the filter must not crash and must skip the ghost.
    const c1 = makeContact('contact-aaa')
    const ctx = makeStubContext({
      section: makeSection({
        seeded_formation_contact_ids: ['contact-aaa', 'ghost-id-999'],
      }),
      // model only has c1; ghost-id-999 is missing â†’ silently dropped
      contacts: [c1],
    })
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    expect(capturedContacts).toHaveLength(1)
    expect(capturedContacts?.[0].id).toBe('contact-aaa')
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('T4: applyUpdatedSection no-ops when section id is absent (defensive guard)', async () => {
    // Verify the defensive branch of applyUpdatedSection (P2-G/P2-H):
    // calling it when sections = [] must be a no-op and leave sections empty.
    const { useSections } = await import('../../../hooks/useSections')

    const updatedSection = makeSection({ seeded_formation_contact_ids: ['contact-aaa'] })

    const { result } = renderHook(() =>
      useSections({
        project: { id: 'proj-1', name: 'Test', default_horizontal_epsg: 31370 },
        ready: false, // don't auto-fetch â€” sections stays []
        toast: vi.fn(),
        pushUndo: vi.fn(),
        manifestSectionIds: new Set<string>(),
        addToManifest: vi.fn(),
        removeFromManifest: vi.fn(),
        setSessionImportSectionIds: vi.fn(),
        contacts: [],
        lithoContacts: [],
        boreholes: [],
        cpts: [],
        setSelectedId: vi.fn(),
        setSelectedBoreholeId: vi.fn(),
      }),
    )

    act(() => {
      result.current.applyUpdatedSection(updatedSection)
    })
    // No match â†’ no-op; sections remains empty.
    expect(result.current.sections).toHaveLength(0)
  })

  it('T4b: applyUpdatedSection replaces the matching section by id and leaves others untouched', async () => {
    // The REPLACE-BY-ID path: `setSections(prev => prev.map(s => s.id === updated.id ? updated : s))`.
    // Drive the auto-load path (ready=true + manifestSectionIds contains both ids)
    // so `sections` is populated before calling applyUpdatedSection.
    // Then assert result.current.sections (real hook state) reflects the update â€”
    // this assertion fails if the map regresses to a no-op or replaces the wrong row.
    const { useSections } = await import('../../../hooks/useSections')

    const sec1Initial = makeSection({ id: 'sec-1', seeded_formation_contact_ids: [] })
    const sec2 = makeSection({ id: 'sec-2', seeded_formation_contact_ids: [] })

    // Inject via the module-level mockSectionList so the auto-load effect
    // resolves to [sec1Initial, sec2] when the hook mounts with ready=true.
    mockSectionList.mockResolvedValue([sec1Initial, sec2])

    const { result } = renderHook(() =>
      useSections({
        project: { id: 'proj-1', name: 'Test', default_horizontal_epsg: 31370 },
        ready: true, // triggers auto-load via api.section.list
        toast: vi.fn(),
        pushUndo: vi.fn(),
        manifestSectionIds: new Set(['sec-1', 'sec-2']),
        addToManifest: vi.fn(),
        removeFromManifest: vi.fn(),
        setSessionImportSectionIds: vi.fn(),
        contacts: [],
        lithoContacts: [],
        boreholes: [],
        cpts: [],
        setSelectedId: vi.fn(),
        setSelectedBoreholeId: vi.fn(),
      }),
    )

    // Wait for the auto-load effect to resolve.
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Precondition: both sections loaded with empty seeded sets.
    expect(result.current.sections).toHaveLength(2)
    expect(result.current.sections.find(s => s.id === 'sec-1')!.seeded_formation_contact_ids).toEqual([])
    expect(result.current.sections.find(s => s.id === 'sec-2')!.seeded_formation_contact_ids).toEqual([])

    // Apply the updated section â€” only sec-1's seeded set changes.
    const sec1Updated = makeSection({ id: 'sec-1', seeded_formation_contact_ids: ['contact-aaa'] })
    act(() => {
      result.current.applyUpdatedSection(sec1Updated)
    })

    // Assert real hook state â€” reads result.current.sections, NOT a hardcoded constant.
    // Fails if the replace-by-id map regressed to a no-op (sec-1 stays empty)
    // or replaced every row (sec-2 would also carry ['contact-aaa']).
    expect(result.current.sections.find(s => s.id === 'sec-1')!.seeded_formation_contact_ids).toEqual(['contact-aaa'])
    // sec-2 is left untouched â€” map only replaces the matching id.
    expect(result.current.sections.find(s => s.id === 'sec-2')!.seeded_formation_contact_ids).toEqual([])
  })

  it('T5: manual draw threads the section id and refreshes the seeded set', async () => {
    // Regression net for the "draw does nothing" dogfeed bug: the
    // section-aware wrapper MUST (a) pass selectedSection.id as the 6th
    // arg so the backend seeds seeded_formation_contact_ids, and (b) GET
    // the updated section + applyUpdatedSection so P2-F's filter shows it.
    // Before the fix the section id never reached the create body.
    const { api } = await import('../../../api/client')
    const sectionGetMock = api.section.get as Mock
    const updatedSection = makeSection({
      seeded_formation_contact_ids: ['contact-new'],
    })
    sectionGetMock.mockResolvedValue(updatedSection)

    const handleCreateContact = vi.fn().mockResolvedValue(undefined)
    const applyUpdatedSection = vi.fn()
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      contacts: [],
    })
    ctx.geoModel.handleCreateContact = handleCreateContact
    ;(ctx.sections as typeof ctx.sections).applyUpdatedSection = applyUpdatedSection

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // Not fired at mount â€” only on the user gesture.
    expect(sectionGetMock).not.toHaveBeenCalled()

    // Invoke the captured onCreateContact (the real manual-draw gesture).
    expect(capturedOnCreateContact).toBeDefined()
    await act(async () => {
      await capturedOnCreateContact!('cpt', 'cpt-9', 5.0, 'form-1', false)
    })

    // (a) section id threaded as the 6th arg.
    expect(handleCreateContact).toHaveBeenCalledWith(
      'cpt',
      'cpt-9',
      5.0,
      'form-1',
      false,
      'sec-1',
    )
    // (b) seeded set refreshed from the authoritative section row.
    expect(sectionGetMock).toHaveBeenCalledWith('proj-1', 'sec-1')
    expect(applyUpdatedSection).toHaveBeenCalledWith(updatedSection)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('T6: drag-copy (batch) threads the section id and refreshes the seeded set', async () => {
    // The actual reported bug: dragging contacts to the next test
    // (one-by-one / marquee / shift-drag all funnel through
    // onBatchCreateContacts). The section-aware batch wrapper must pass
    // selectedSection.id to handleBatchCreateContacts (so the backend
    // seeds every copied id) and then GET + applyUpdatedSection so the
    // P2-F filter renders them. Before the fix the copy created contacts
    // the filter immediately hid (no section id, no refresh).
    const { api } = await import('../../../api/client')
    const sectionGetMock = api.section.get as Mock
    const updatedSection = makeSection({
      seeded_formation_contact_ids: ['copied-1', 'copied-2'],
    })
    sectionGetMock.mockResolvedValue(updatedSection)

    const handleBatchCreateContacts = vi.fn().mockResolvedValue(undefined)
    const applyUpdatedSection = vi.fn()
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      contacts: [],
    })
    ctx.geoModel.handleBatchCreateContacts = handleBatchCreateContacts
    ;(ctx.sections as typeof ctx.sections).applyUpdatedSection = applyUpdatedSection

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedOnBatchCreateContacts).toBeDefined()
    const creates = [
      {
        formation_id: 'form-1',
        depth_top_m: 3.2,
        borehole_id: null,
        cpt_id: 'cpt-9',
        source: 'manual_pick' as const,
        confidence: 'medium' as const,
      },
    ]
    await act(async () => {
      await capturedOnBatchCreateContacts!(creates)
    })

    // section id passed as the 2nd arg â†’ backend seeds every copied id.
    expect(handleBatchCreateContacts).toHaveBeenCalledWith(creates, 'sec-1')
    // one section refresh after the batch so P2-F shows the copies.
    expect(sectionGetMock).toHaveBeenCalledWith('proj-1', 'sec-1')
    expect(applyUpdatedSection).toHaveBeenCalledWith(updatedSection)
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// S3 â€” geological axis must NOT wire the litho picker (regression guard)
// ---------------------------------------------------------------------------

describe('Axis mode â€” geology axis keeps FormationPickerDialog', () => {
  it('S3: geological axis passes axisMode=geological and no onManualLithoUnitCreate', () => {
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      sectionModelAxis: 'geological',
    })

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // Geology axis must keep the unchanged FormationPickerDialog path:
    // the litho-only manual-create prop must be absent and axisMode
    // explicitly 'geological'.
    expect(capturedAxisMode).toBe('geological')
    expect(capturedOnManualLithoUnitCreate).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// M1 / M2 â€” manual litho unit DIRECT INSERT (debt #151 dogfeed refinement
// 2026-05-27 owner directive: "how about we don't wire it through the
// suggestion and it immediately becomes an accepted litho layer").
//
// New contract: handleManualLithoUnitCreate now creates a real accepted
// contact at depthM with the chosen lithology AND seeds the section.  No
// pending-ghost intermediate.  When a SURROUNDING litho contact exists
// above depthM with a different lithology, a SECOND acceptLithoSuggestions
// call fires to restore the original band below the inserted layer.
// ---------------------------------------------------------------------------

describe('Manual litho unit creation â€” handleManualLithoUnitCreate (direct insert)', () => {
  it('M1: new unit â†’ acceptLithoSuggestions seeds the section AND calls applyUpdatedSection', async () => {
    const updatedSection = makeSection({
      seeded_formation_contact_ids: ['contact-new-1'],
    })
    mockAcceptLithoSuggestions.mockResolvedValue({
      updated_section: updatedSection,
      created_formation_ids: ['form-new-1'],
      found_formation_ids: [],
      created_contact_ids: ['contact-new-1'],
      found_contact_ids: [],
    })

    const applyUpdatedSection = vi.fn()
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      lithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
    })
    ;(ctx.sections as typeof ctx.sections).applyUpdatedSection = applyUpdatedSection

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedOnManualLithoUnitCreate).toBeDefined()

    const result = await act(async () =>
      capturedOnManualLithoUnitCreate!('ZAND', [], 'borehole', 'bh-1', 5.5),
    )

    // (a) acceptLithoSuggestions called with section_id (real seed); no
    //     create_formation_only flag â€” the backend creates the contact.
    //     No surrounding litho contact exists in this stub context, so
    //     only ONE call fires (no restoration needed).
    expect(mockAcceptLithoSuggestions).toHaveBeenCalledTimes(1)
    const [, , payload] = mockAcceptLithoSuggestions.mock.calls[0]
    expect(payload.borehole_id).toBe('bh-1')
    expect(payload.section_id).toBe('sec-1')
    expect(payload.create_formation_only).toBeUndefined()
    expect(payload.suggestions).toHaveLength(1)
    expect(payload.suggestions[0].suggested_lithology).toBe('ZAND')
    expect(payload.suggestions[0].source).toBe('manual_pick')
    // depth_base = depth_top + 0.20 (20 cm band).
    expect(payload.suggestions[0].depth_base_m).toBeCloseTo(5.7)

    // (b) applyUpdatedSection IS called now â€” the new contact seeded
    //     the section's seeded_formation_contact_ids.
    expect(applyUpdatedSection).toHaveBeenCalledTimes(1)
    expect(applyUpdatedSection).toHaveBeenCalledWith(updatedSection)

    // (c) formationId returned so the caller can react if needed.
    expect(result).toEqual({ formationId: 'form-new-1' })
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('M2: idempotent re-create (formation already exists) â†’ returns found formationId, seeds section', async () => {
    const updatedSection = makeSection({
      seeded_formation_contact_ids: ['contact-existing-1', 'contact-new-2'],
    })
    mockAcceptLithoSuggestions.mockResolvedValue({
      updated_section: updatedSection,
      created_formation_ids: [],
      found_formation_ids: ['form-existing-x'],
      created_contact_ids: ['contact-new-2'],
      found_contact_ids: [],
    })

    const applyUpdatedSection = vi.fn()
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: ['contact-existing-1'] }),
      lithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
    })
    ;(ctx.sections as typeof ctx.sections).applyUpdatedSection = applyUpdatedSection

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    expect(capturedOnManualLithoUnitCreate).toBeDefined()
    const result = await act(async () =>
      capturedOnManualLithoUnitCreate!('KLEI', [], 'cpt', 'cpt-7', 3.0),
    )

    expect(applyUpdatedSection).toHaveBeenCalledTimes(1)
    expect(applyUpdatedSection).toHaveBeenCalledWith(updatedSection)
    // formationId comes from found_formation_ids[0] when created_formation_ids is empty.
    expect(result).toEqual({ formationId: 'form-existing-x' })
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// S5 â€” a failed correlate keeps the armed source + surfaces the error
// TODO Task 19: handleCorrelate is stubbed (formation-level API removed).
// Re-enable this test when Task 19 wires createContactCorrelation.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// LX â€” litho-axis left-click must NOT open the picker dialog (Bug B fix,
// dogfeed 2026-05-26 + 2nd-pass fix 2026-05-26)
//
// Root cause: the picker (useContactPicker) opens in handlePickCpt /
// handlePickBorehole which are wired to ContactPickBar's onCommitDepth and
// BoreholeColumn's onCommitDepth.  Those callbacks fire BEFORE
// sectionAwareCreateContact runs â€” so the previous internal `if (isLitho) return`
// guard was too late in the chain.
//
// The correct fix: pass onCreateContact={undefined} on the litho axis.
// SectionPanel gates ContactPickBar's onCommitDepth on whether onCreateContact
// is present (line 1901: `onCommitDepth={onCreateContact ? handlePickCpt : undefined}`).
// So passing undefined disarms the pick-bar and BoreholeColumn overlays
// entirely, preventing the picker from opening.
//
// LX1 â€” the original test: callback is a no-op (still passes; the no-op is
//        now enforced at the prop boundary rather than inside the callback).
// LX2 â€” the real guard: onCreateContact is undefined on the litho axis so
//        the picker cannot open (ContactPickBar / BoreholeColumn are disarmed).
// ---------------------------------------------------------------------------

describe('Litho axis left-click is a no-op (Bug B â€” dogfeed 2026-05-26)', () => {
  it('LX2 â€” onCreateContact is undefined on the litho axis so the picker never opens', () => {
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      lithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
    })

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // The prop must be undefined â€” ContactPickBar/BoreholeColumn's onCommitDepth
    // are gated on onCreateContact, so undefined fully disarms the pick-bar and
    // prevents handlePickCpt/handlePickBorehole (and therefore the picker) from
    // firing on left-click.  This is the correct fix for the "picker still opens
    // on litho axis" dogfeed (previous guard was inside sectionAwareCreateContact
    // which is too late â€” the picker opens before that callback runs).
    expect(capturedOnCreateContact).toBeUndefined()
  })

  it('LX1 â€” geological axis still wires onCreateContact (regression guard)', () => {
    const ctx = makeStubContext({
      section: makeSection({ seeded_formation_contact_ids: [] }),
      sectionModelAxis: 'geological',
    })

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // On the geological axis the callback must be present so the pick-bar works.
    expect(capturedOnCreateContact).toBeDefined()
  })
})

describe('handleCorrelate â€” armed source persists on failure (review S5)', () => {
  it.skip('S5 â€” failed POST does NOT clear the armed source and toasts an error [Task 19]', async () => {
    mockCorrelate.mockRejectedValue(new Error('422 cross-group race'))
    const ctx = makeStubContext({
      lithoModel: makeLithoModel(),
      sectionModelAxis: 'lithostratigraphic',
    })

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // onCorrelate is wired on the litho axis regardless of correlate mode.
    expect(capturedCorrelateGestureState?.onCorrelate).toBeDefined()
    await act(async () => {
      await capturedCorrelateGestureState!.onCorrelate!('f-a', 'f-b')
    })

    // Contract (spec / #57-adjacent): the armed source stays armed so the
    // user can retry or pick a different target, and the failure is
    // surfaced rather than silently swallowed.
    expect(ctx.sections.clearCorrelationSource).not.toHaveBeenCalled()
    expect(ctx.toasts.toast).toHaveBeenCalledWith('error', expect.any(String))
  })
})

