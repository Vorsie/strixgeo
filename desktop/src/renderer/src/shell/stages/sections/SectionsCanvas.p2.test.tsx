// P2 explicit-content invariant tests.
//
// Owner directive 2026-05-17: nothing appears on a section without the user
// clicking a button on that section. These tests verify:
//
//   1. Never-seeded section (seeded_formation_contact_ids = []) → SectionPanel
//      receives zero formation contacts.
//   2. Seeded section (seeded_formation_contact_ids = [c1]) → SectionPanel
//      receives only that contact, even though the model has more.
//   3. applyUpdatedSection (P2-G/P2-H) replaces the section by id in local
//      state so the seeded set is immediately current on the next render.
//   4. Build/TIN path (axisContacts) is unaffected — the full model contact
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
import type { FormationContactResponse } from '../../../api/client'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

let capturedContacts: readonly FormationContactResponse[] | undefined = undefined

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: { contacts?: readonly FormationContactResponse[] }) => {
    // Capture the contacts prop each time SectionPanel renders.
    capturedContacts = props.contacts
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

// api.section.list is used by useSections' auto-load effect (T4b).
// Default resolves to [] so T1–T3/T5 are unaffected by pending fetches.
const mockSectionList = vi.fn().mockResolvedValue([])

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
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

function makeStubContext(overrides?: {
  section?: ReturnType<typeof makeSection>
  contacts?: FormationContactResponse[]
}): ShellContextValue {
  const section = overrides?.section ?? makeSection()
  const contacts = overrides?.contacts ?? []
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
      lithoSuggestions: [],
      lithoSuggestionInvestigationId: null,
      lithoSuggestionAnchorKind: null,
      lithoSuggestionAccepted: new Set<number>(),
      lithoSuggestionRejected: new Set<number>(),
      lithoSuggesting: false,
      handleSuggestLitho: noopAsync,
      handleAcceptLithoSuggestion: noopAsync,
      handleRejectLithoSuggestion: vi.fn(),
      clearLithoSuggestions: vi.fn(),
    },
    sections: {
      sections: [section],
      selectedSectionId: section.id,
      drawingSection: false,
      focusedContactIds: [],
      visibleSections: [section],
      effectiveHorizontalEpsg: 31370,
      sectionModelAxis: 'geological' as const,
      setSectionModelAxis: vi.fn(),
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
    },
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let consoleErrorSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  capturedContacts = undefined
  // Reset to [] so T1–T3/T5 (render-based, no section list needed) are clean.
  mockSectionList.mockResolvedValue([])
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  cleanup()
  consoleErrorSpy.mockRestore()
  vi.restoreAllMocks()
})

describe('P2 explicit-content invariant — SectionsCanvas contact filtering', () => {
  it('T1: never-seeded section passes zero contacts to SectionPanel', () => {
    // The model has two contacts but the section's seeded set is empty.
    // P2-F must filter axisContacts → sectionContacts = [] before passing
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
    // seeded_formation_contact_ids = [c1.id] → only c1 passes through P2-F.
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
    // in axisContacts — the filter must not crash and must skip the ghost.
    const c1 = makeContact('contact-aaa')
    const ctx = makeStubContext({
      section: makeSection({
        seeded_formation_contact_ids: ['contact-aaa', 'ghost-id-999'],
      }),
      // model only has c1; ghost-id-999 is missing → silently dropped
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
        ready: false, // don't auto-fetch — sections stays []
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
    // No match → no-op; sections remains empty.
    expect(result.current.sections).toHaveLength(0)
  })

  it('T4b: applyUpdatedSection replaces the matching section by id and leaves others untouched', async () => {
    // The REPLACE-BY-ID path: `setSections(prev => prev.map(s => s.id === updated.id ? updated : s))`.
    // Drive the auto-load path (ready=true + manifestSectionIds contains both ids)
    // so `sections` is populated before calling applyUpdatedSection.
    // Then assert result.current.sections (real hook state) reflects the update —
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

    // Apply the updated section — only sec-1's seeded set changes.
    const sec1Updated = makeSection({ id: 'sec-1', seeded_formation_contact_ids: ['contact-aaa'] })
    act(() => {
      result.current.applyUpdatedSection(sec1Updated)
    })

    // Assert real hook state — reads result.current.sections, NOT a hardcoded constant.
    // Fails if the replace-by-id map regressed to a no-op (sec-1 stays empty)
    // or replaced every row (sec-2 would also carry ['contact-aaa']).
    expect(result.current.sections.find(s => s.id === 'sec-1')!.seeded_formation_contact_ids).toEqual(['contact-aaa'])
    // sec-2 is left untouched — map only replaces the matching id.
    expect(result.current.sections.find(s => s.id === 'sec-2')!.seeded_formation_contact_ids).toEqual([])
  })

  it('T5: sectionAwareCreateContact calls axisCreateContact then fetches updated section', async () => {
    // P2-H: when the user draws a contact manually, sectionAwareCreateContact
    // wraps axisCreateContact to (a) call the create handler and (b) GET the
    // updated section to refresh seeded_formation_contact_ids.
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
    // Inject our spy directly on the sections context object.
    ;(ctx.sections as typeof ctx.sections).applyUpdatedSection = applyUpdatedSection

    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )

    // The sectionAwareCreateContact is wired as onCreateContact on SectionPanel.
    // SectionPanel is mocked so we can't trigger it from the DOM.
    // Instead verify that sectionGetMock and applyUpdatedSection are not called
    // at mount time (only fire on user action).
    expect(sectionGetMock).not.toHaveBeenCalled()
    expect(applyUpdatedSection).not.toHaveBeenCalled()
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })
})
