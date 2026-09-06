// Behavioral net for the slice-3 (#55) litho-suggestion state machine in
// useGeologicalModel.
//
// Claims pinned here:
//   S1  handleSuggestLitho stores layers + sets investigationId/anchorKind.
//   S2  handleRejectLithoSuggestion marks the index rejected only (no API
//       call fired).
//   S3  handleAcceptLithoSuggestion issues ONE acceptLithoSuggestions call
//       (bulk endpoint, single-item payload) per accepted layer.
//   S4  applyUpdatedSection is forwarded from the accept response — #57
//       regression guard (explicit-content invariant).
//   S5  clearLithoSuggestions resets all suggestion state atoms to empty.
//   S6  handleAcceptAllLithoSuggestions issues ONE bulk call (not N).
//   S7  Switching the active litho model clears a showing overlay (B-1).
//   S8  Accept pushes an undo command that deletes the created rows.
//   S9  Accepting an already-committed (found-only) layer pushes no undo.
//   S10 handleStripLithoAdmixtures clears admixtures on matching ghosts.
//   S11 handleReseedLithoAdmixtures drops the admixture override.
//   S12 handleClearLithoModel dismisses the litho suggestion ghosts.
//   S13 contact-edit handlers route to the contact's own model (axis-safe).
//
// Strategy: mock the whole api.geology module so every call resolves to a
// stable sentinel.  Drive handleSuggestLitho first (via mocked suggestLitho)
// to populate lithoSuggestions, then drive accept/reject, then assert on
// the hook's exported state.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, type MockInstance } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type {
  AcceptLithoSuggestionsResponse,
  GeologicalFormationResponse,
  FormationContactResponse,
  GeologicalModelResponse,
  LithoLayerSuggestion,
  ProjectResponse,
} from '../api/client'

// ---------------------------------------------------------------------------
// Module mocks — api.geology + log + toast helper
// ---------------------------------------------------------------------------

// We need vi.mock hoisted before any import resolution.
vi.mock('../api/client', () => ({
  api: {
    geology: {
      listModels: vi.fn(),
      listFormations: vi.fn(),
      listContacts: vi.fn(),
      listLayers: vi.fn().mockResolvedValue([]),
      listSurfaces: vi.fn(),
      validateCrossings: vi.fn(),
      createModel: vi.fn(),
      activateModel: vi.fn(),
      createFormation: vi.fn(),
      createContact: vi.fn(),
      suggestLitho: vi.fn(),
      acceptLithoSuggestions: vi.fn(),
      batchAcceptLithoSuggestions: vi.fn(),
      autoCorrelateContacts: vi.fn().mockResolvedValue({
        edges_created: 0,
        edges_skipped_existing: 0,
      }),
      clearLithoModel: vi.fn(),
      // rarely-called methods — resolve empty so hooks don't throw
      updateFormation: vi.fn(),
      deleteFormation: vi.fn(),
      updateModel: vi.fn(),
      deleteModel: vi.fn(),
      updateContact: vi.fn(),
      deleteContact: vi.fn(),
      updateContactsBatch: vi.fn(),
      autoPopulateFromStratigraphy: vi.fn(),
      dedupeContacts: vi.fn(),
      rebuildSurfaces: vi.fn(),
      exportPlaxis3d: vi.fn(),
      discoverFromStratigraphy: vi.fn(),
      applyBoreholeFormationSelection: vi.fn(),
      suggestBoreholeFormations: vi.fn(),
      buildGroundSurface: vi.fn(),
      exportSectionPlaxis2d: vi.fn(),
      listLithoSolids: vi.fn().mockResolvedValue([]),
      getGaplessBuildReport: vi.fn().mockResolvedValue(null),
      // Debt #266 — the geotech axis reads which columns stand on edited litho.
      geotechLithoStaleness: vi.fn().mockResolvedValue({
        geotech_model_id: '',
        litho_model_id: null,
        stale_columns: [],
        stale_column_count: 0,
        banded_column_count: 0,
        unstamped_column_count: 0,
      }),
      setBodyColor: vi.fn().mockResolvedValue({}),
      hideMarkers: false,
      setHideMarkers: vi.fn(),
    },
    cpt: { list: vi.fn(), get: vi.fn() },
    borehole: { list: vi.fn(), get: vi.fn() },
    section: { list: vi.fn() },
    project: { get: vi.fn(), update: vi.fn() },
  },
  DuplicateContactError: class DuplicateContactError extends Error {
    existingContactId: string
    constructor(existingContactId: string) {
      super('duplicate')
      this.existingContactId = existingContactId
    }
  },
}))

vi.mock('../utils/log', () => ({
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Phase 2 of debt #77: the bus exposes `ghostsByAnchor` + `focusedSuggestAnchorId`
// instead of six derived single-anchor accessors. These helpers translate
// the assertions below into the new shape without rewriting each test.
// ---------------------------------------------------------------------------

type HookResult = { current: ReturnType<typeof useGeologicalModel> }

function focused(r: HookResult): ReturnType<typeof useGeologicalModel>['ghostsByAnchor'] extends ReadonlyMap<string, infer V> ? V | undefined : never {
  const id = r.current.focusedSuggestAnchorId
  return (id !== null ? r.current.ghostsByAnchor.get(id) : undefined) as never
}

function bulkSubset(r: HookResult): ReadonlyMap<string, NonNullable<ReturnType<typeof focused>>> {
  const id = r.current.focusedSuggestAnchorId
  const map = r.current.ghostsByAnchor as ReadonlyMap<string, NonNullable<ReturnType<typeof focused>>>
  if (id === null || !map.has(id)) return map
  const next = new Map(map)
  next.delete(id)
  return next
}

// ---------------------------------------------------------------------------
// Sentinel factories
// ---------------------------------------------------------------------------

function makeModel(id: string, kind: string = 'lithostratigraphic'): GeologicalModelResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: kind === 'lithostratigraphic' ? 'Litho Model' : 'Default',
    description: null,
    kind: kind as GeologicalModelResponse['kind'],
    is_active: true,
    excluded_borehole_ids: [],
    parent_model_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeFormation(id: string, lithology: string): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: lithology,
    color: '#cccccc',
    code: null,
    display_order: 0,
    lithology,
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
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeContact(id: string, formationId: string): FormationContactResponse {
  return {
    id,
    model_id: 'litho-model-1',
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

function makeSuggestion(
  lithology: string,
  depth: number,
  overrides?: Partial<LithoLayerSuggestion>,
): LithoLayerSuggestion {
  return {
    depth_top_m: depth,
    depth_base_m: depth + 2.0,
    suggested_lithology: lithology,
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'medium' as const,
    source: 'robertson2015',
    // Phase 1 additions.
    suggested_admixtures: [],
    parent_formation_id: null,
    spans_boundary: false,
    ...overrides,
  }
}

/** Minimal AcceptLithoSuggestionsResponse stub for accept-path tests. */
function makeAcceptResponse(
  overrides?: Partial<AcceptLithoSuggestionsResponse>,
): AcceptLithoSuggestionsResponse {
  return {
    created_formation_ids: ['form-new'],
    found_formation_ids: [],
    created_contact_ids: ['contact-new'],
    found_contact_ids: [],
    updated_section: null,
    ...overrides,
  }
}

// ---------------------------------------------------------------------------
// Hook args factory
// ---------------------------------------------------------------------------

const TEST_PROJECT: ProjectResponse = {
  id: 'proj-1',
  name: 'Test',
  default_horizontal_epsg: 31370,
  default_vertical_epsg: null,
  project_number: null,
  client: null,
  site_label: null,
  description: null,
  tags: [],
  phase: null,
  status: 'active',
  view_state: {},
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  archived_at: null,
}

function makeArgs() {
  const toast = vi.fn()
  const pushUndo = vi.fn()
  const addToManifest = vi.fn()
  const removeFromManifest = vi.fn()
  const addToSessionImports = vi.fn()
  const removeFromSessionImports = vi.fn()
  const requestCorrelationEdgesRefetch = vi.fn()
  return {
    args: {
      project: TEST_PROJECT,
      toast,
      pushUndo,
      addToManifest,
      removeFromManifest,
      addToSessionImports,
      removeFromSessionImports,
      manifestFormationIds: undefined as Set<string> | undefined,
      currentLumping: null as import('../utils/projectFile').StratigraphyLumping | null,
      stageLumping: vi.fn(),
      requestCorrelationEdgesRefetch,
      markMutated: vi.fn(),
    },
    toast,
  }
}

// ---------------------------------------------------------------------------
// Setup: configure api mocks to let the hook bootstrap cleanly
// ---------------------------------------------------------------------------

// Import the mocked module so we can access the vi.fn() instances.
import { api } from '../api/client'

const geoApi = api.geology as unknown as Record<string, MockInstance>

function setupBootstrapMocks(): void {
  const geoModel = makeModel('geo-model-1', 'geological')
  const lithoModel = makeModel('litho-model-1', 'lithostratigraphic')

  // listModels called multiple times (bootstrap + refreshModels).
  // Always return both models so the hook picks up activeLithoModel.
  geoApi.listModels.mockResolvedValue([geoModel, lithoModel])
  geoApi.listFormations.mockResolvedValue([])
  // listContacts is called per model: return empty for both
  geoApi.listContacts.mockResolvedValue([])
  geoApi.listSurfaces.mockResolvedValue([])
  geoApi.validateCrossings.mockResolvedValue({ crossings: [] })
  // suggestLitho — each test configures its own resolve value
  geoApi.createFormation.mockReset()
  geoApi.createContact.mockReset()
  geoApi.suggestLitho.mockReset()
  geoApi.acceptLithoSuggestions.mockReset()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGeologicalModel suggestion state machine (slice 3, #55)', () => {
  beforeEach(() => {
    setupBootstrapMocks()
  })

  it('S1 — handleSuggestLitho stores layers + investigationId + anchorKind', async () => {
    const suggestions: LithoLayerSuggestion[] = [
      makeSuggestion('ZAND', 0.0),
      makeSuggestion('KLEI', 2.5),
    ]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    // Wait for bootstrap to settle
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Initially empty
    expect((focused(result)?.suggestions ?? [])).toHaveLength(0)
    expect(result.current.focusedSuggestAnchorId).toBeNull()
    expect((focused(result)?.kind ?? null)).toBeNull()

    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    expect((focused(result)?.suggestions ?? [])).toHaveLength(2)
    expect((focused(result)?.suggestions ?? [])[0].suggested_lithology).toBe('ZAND')
    expect((focused(result)?.suggestions ?? [])[1].suggested_lithology).toBe('KLEI')
    expect(result.current.focusedSuggestAnchorId).toBe('bh-1')
    expect((focused(result)?.kind ?? null)).toBe('borehole')
    expect(result.current.lithoSuggesting).toBe(false) // cleared after resolve
  })

  it('S2 — handleRejectLithoSuggestion marks index rejected; no API calls', async () => {
    const suggestions: LithoLayerSuggestion[] = [
      makeSuggestion('ZAND', 0.0),
      makeSuggestion('KLEI', 2.5),
    ]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    await act(async () => {
      await result.current.handleSuggestLitho('cpt', 'cpt-1')
    })

    act(() => {
      result.current.handleRejectLithoSuggestion(0)
    })

    expect((focused(result)?.rejected ?? new Set<number>()).has(0)).toBe(true)
    expect((focused(result)?.rejected ?? new Set<number>()).has(1)).toBe(false)
    expect((focused(result)?.accepted ?? new Set<number>()).has(0)).toBe(false)

    // No formation or contact creation
    expect(geoApi.createFormation).not.toHaveBeenCalled()
    expect(geoApi.createContact).not.toHaveBeenCalled()
  })

  it('S3 — handleAcceptLithoSuggestion issues ONE acceptLithoSuggestions call per accepted layer', async () => {
    // Each per-layer accept calls the bulk endpoint with a single-item
    // suggestions array.  Formation reuse / creation is the server's
    // responsibility; the client only owns state marking.
    const suggestions: LithoLayerSuggestion[] = [
      makeSuggestion('ZAND', 0.0),
      makeSuggestion('KLEI', 3.0),
    ]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })
    geoApi.acceptLithoSuggestions
      .mockResolvedValueOnce(makeAcceptResponse({ created_formation_ids: ['form-zand'], created_contact_ids: ['c-zand'] }))
      .mockResolvedValueOnce(makeAcceptResponse({ created_formation_ids: ['form-klei'], created_contact_ids: ['c-klei'] }))

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    // Accept both layers sequentially
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0)
    })
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(1)
    })

    // Two separate bulk calls — one per layer.
    expect(geoApi.acceptLithoSuggestions).toHaveBeenCalledTimes(2)
    expect(geoApi.acceptLithoSuggestions).toHaveBeenCalledWith(
      'proj-1',
      'litho-model-1',
      expect.objectContaining({
        borehole_id: 'bh-1',
        suggestions: [expect.objectContaining({ suggested_lithology: 'ZAND' })],
      }),
    )
    expect(geoApi.acceptLithoSuggestions).toHaveBeenCalledWith(
      'proj-1',
      'litho-model-1',
      expect.objectContaining({
        borehole_id: 'bh-1',
        suggestions: [expect.objectContaining({ suggested_lithology: 'KLEI' })],
      }),
    )

    // Both accepted, none rejected.
    expect((focused(result)?.accepted ?? new Set<number>()).has(0)).toBe(true)
    expect((focused(result)?.accepted ?? new Set<number>()).has(1)).toBe(true)
    expect((focused(result)?.rejected ?? new Set<number>()).size).toBe(0)

    // The old client-side formation/contact creation is gone.
    expect(geoApi.createFormation).not.toHaveBeenCalled()
    expect(geoApi.createContact).not.toHaveBeenCalled()
  })

  it('S4 — accept handler forwards updated_section via onSectionUpdated (#57 regression guard)', async () => {
    // The explicit-content invariant (#57, recurred 3x): the accept
    // handler MUST call onSectionUpdated when the response includes
    // an updated_section, otherwise seeded contacts go invisible.
    const suggestions: LithoLayerSuggestion[] = [makeSuggestion('ZAND', 0.0)]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })

    const updatedSection = {
      id: 'sec-1',
      app_project_id: 'proj-1',
      name: 'Section A',
      description: null,
      start_x: 0,
      start_y: 0,
      end_x: 100,
      end_y: 0,
      width_m: 50,
      epsg: 31370,
      projection_buffer_m: 50,
      vertical_exaggeration: 1,
      excluded_borehole_ids: [],
      excluded_cpt_ids: [],
      seeded_formation_contact_ids: ['contact-new'],
      min_depth_m: null,
      max_depth_m: null,
      display_order: 0,
      view_state: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    geoApi.acceptLithoSuggestions.mockResolvedValueOnce(
      makeAcceptResponse({ updated_section: updatedSection }),
    )

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    const onSectionUpdated = vi.fn()
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0, 'sec-1', onSectionUpdated)
    })

    // The callback MUST have been called with the updated section.
    expect(onSectionUpdated).toHaveBeenCalledOnce()
    expect(onSectionUpdated).toHaveBeenCalledWith(updatedSection)

    // Layer is marked accepted.
    expect((focused(result)?.accepted ?? new Set<number>()).has(0)).toBe(true)
  })

  it('S5 — clearLithoSuggestions resets all suggestion state to empty', async () => {
    const suggestions: LithoLayerSuggestion[] = [makeSuggestion('VEEN', 1.0)]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    await act(async () => {
      await result.current.handleSuggestLitho('cpt', 'cpt-42')
    })

    // Populated
    expect((focused(result)?.suggestions ?? [])).toHaveLength(1)
    expect(result.current.focusedSuggestAnchorId).toBe('cpt-42')

    act(() => {
      result.current.clearLithoSuggestions()
    })

    expect((focused(result)?.suggestions ?? [])).toHaveLength(0)
    expect(result.current.focusedSuggestAnchorId).toBeNull()
    expect((focused(result)?.kind ?? null)).toBeNull()
    expect((focused(result)?.accepted ?? new Set<number>()).size).toBe(0)
    expect((focused(result)?.rejected ?? new Set<number>()).size).toBe(0)
  })

  it('S6 — handleAcceptAllLithoSuggestions issues ONE bulk call, skips rejected, marks all accepted', async () => {
    // The "Accept all" button's contract: one server round-trip for
    // the whole pending set.  Rejected layers are excluded.
    const suggestions: LithoLayerSuggestion[] = [
      makeSuggestion('ZAND', 0.0),
      makeSuggestion('KLEI', 3.0),
      makeSuggestion('VEEN', 6.0), // will be rejected
    ]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })
    geoApi.acceptLithoSuggestions.mockResolvedValueOnce(
      makeAcceptResponse({
        created_formation_ids: ['form-zand', 'form-klei'],
        created_contact_ids: ['c-zand', 'c-klei'],
      }),
    )

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    // Reject index 2 before accepting all.
    act(() => {
      result.current.handleRejectLithoSuggestion(2)
    })

    const onSectionUpdated = vi.fn()
    await act(async () => {
      await result.current.handleAcceptAllLithoSuggestions('sec-1', onSectionUpdated)
    })

    // ONE call only (not N), payload excludes the rejected layer.
    expect(geoApi.acceptLithoSuggestions).toHaveBeenCalledTimes(1)
    const [, , body] = geoApi.acceptLithoSuggestions.mock.calls[0] as [string, string, { suggestions: LithoLayerSuggestion[], section_id: string | null }]
    expect(body.suggestions).toHaveLength(2) // idx 0 + 1 only
    expect(body.suggestions[0].suggested_lithology).toBe('ZAND')
    expect(body.suggestions[1].suggested_lithology).toBe('KLEI')
    expect(body.section_id).toBe('sec-1')

    // Indices 0 and 1 are accepted; 2 is rejected (not accepted).
    expect((focused(result)?.accepted ?? new Set<number>()).has(0)).toBe(true)
    expect((focused(result)?.accepted ?? new Set<number>()).has(1)).toBe(true)
    expect((focused(result)?.accepted ?? new Set<number>()).has(2)).toBe(false)
    expect((focused(result)?.rejected ?? new Set<number>()).has(2)).toBe(true)

    // updated_section is null in the stub → onSectionUpdated not called.
    expect(onSectionUpdated).not.toHaveBeenCalled()

    // No old-style creation calls.
    expect(geoApi.createFormation).not.toHaveBeenCalled()
    expect(geoApi.createContact).not.toHaveBeenCalled()
  })

  it('S7 — switching the active litho model clears a showing suggestion overlay (B-1)', async () => {
    // Data-integrity regression (senior-review B-1): a ghost overlay
    // left showing across a model switch would accept onto the NEW
    // model while the suggestion still references the old
    // investigation. The .id-keyed effect must wipe it on switch.
    geoApi.suggestLitho.mockResolvedValueOnce({
      layers: [makeSuggestion('ZAND', 0.0)],
    })
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })
    expect((focused(result)?.suggestions ?? [])).toHaveLength(1)
    expect(result.current.focusedSuggestAnchorId).toBe('bh-1')

    // Switch the active litho model: refreshModels now resolves a
    // DIFFERENT active litho id → activeLithoModelId changes → the
    // B-1 effect must clear the stale overlay.
    geoApi.listModels.mockResolvedValue([
      makeModel('geo-model-1', 'geological'),
      makeModel('litho-model-2', 'lithostratigraphic'),
    ])
    geoApi.activateModel.mockResolvedValueOnce(
      makeModel('litho-model-2', 'lithostratigraphic'),
    )
    await act(async () => {
      await result.current.handleActivateLithoModel('litho-model-2')
    })

    expect((focused(result)?.suggestions ?? [])).toHaveLength(0)
    expect(result.current.focusedSuggestAnchorId).toBeNull()
    expect((focused(result)?.kind ?? null)).toBeNull()
  })

  // -- Phase 3 / debt #73 bulk-suggest tests ----------------------------

  it('B1 — handleSuggestAllLitho fans out one segmenter call per anchor and populates the Map', async () => {
    geoApi.suggestLitho.mockResolvedValue({
      layers: [makeSuggestion('ZAND', 0.0)],
    })
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestAllLitho([
        { kind: 'cpt', id: 'cpt-1', surfaceElevationM: 10 },
        { kind: 'borehole', id: 'bh-1', surfaceElevationM: 12 },
      ])
    })
    expect(geoApi.suggestLitho).toHaveBeenCalledTimes(2)
    expect(bulkSubset(result).size).toBe(2)
    expect(bulkSubset(result).get('cpt-1')?.kind).toBe('cpt')
    expect(bulkSubset(result).get('cpt-1')?.surfaceElevationM).toBe(10)
    expect(bulkSubset(result).get('bh-1')?.kind).toBe('borehole')
    expect(bulkSubset(result).get('cpt-1')?.suggestions).toHaveLength(1)
  })

  it('B1b — Suggest-all commits ghosts once after the whole fan-out, not progressively per anchor (#155)', async () => {
    // Hand each segmenter call a deferred promise we resolve one at a time, so
    // we can observe whether ghosts trickle in (old O(N²)-render behaviour) or
    // land in a single flush after every anchor completes (the #155 fix).
    const deferreds: Array<(v: { layers: LithoLayerSuggestion[] }) => void> = []
    geoApi.suggestLitho.mockImplementation(
      () =>
        new Promise<{ layers: LithoLayerSuggestion[] }>(resolve => {
          deferreds.push(resolve)
        }),
    )
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Kick off the fan-out without awaiting — both workers fire suggestLitho.
    let fanout!: Promise<void>
    await act(async () => {
      fanout = result.current.handleSuggestAllLitho([
        { kind: 'cpt', id: 'cpt-1', surfaceElevationM: 10 },
        { kind: 'cpt', id: 'cpt-2', surfaceElevationM: 11 },
      ])
      await Promise.resolve()
    })
    expect(deferreds).toHaveLength(2)

    // Resolve ONLY the first anchor's segmenter call.
    await act(async () => {
      deferreds[0]({ layers: [makeSuggestion('ZAND', 0.0)] })
      await Promise.resolve()
    })
    // Coalesced: nothing committed until the whole fan-out finishes. The old
    // per-anchor setState would already show size 1 here.
    expect(bulkSubset(result).size).toBe(0)

    // Resolve the second anchor — now the single coalesced flush lands.
    await act(async () => {
      deferreds[1]({ layers: [makeSuggestion('KLEI', 1.0)] })
      await fanout
    })
    expect(bulkSubset(result).size).toBe(2)
  })

  it('B2 — handleAcceptBulkLitho commits one layer + marks the idx accepted on the anchor', async () => {
    geoApi.suggestLitho.mockResolvedValue({
      layers: [makeSuggestion('ZAND', 0.0), makeSuggestion('KLEI', 2.5)],
    })
    geoApi.acceptLithoSuggestions.mockResolvedValue({
      created_formation_ids: ['fid-1'],
      found_formation_ids: [],
      created_contact_ids: ['cid-1'],
      found_contact_ids: [],
      updated_section: null,
    })
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestAllLitho([
        { kind: 'cpt', id: 'cpt-1', surfaceElevationM: 10 },
      ])
    })
    await act(async () => {
      await result.current.handleAcceptBulkLitho('cpt-1', 1, null)
    })
    expect(geoApi.acceptLithoSuggestions).toHaveBeenCalledTimes(1)
    const callBody = geoApi.acceptLithoSuggestions.mock.calls[0][2]
    expect(callBody.cpt_id).toBe('cpt-1')
    expect(callBody.suggestions).toHaveLength(1)
    // Only the requested idx is marked accepted; idx 0 stays pending.
    expect(bulkSubset(result).get('cpt-1')?.accepted.has(1)).toBe(true)
    expect(bulkSubset(result).get('cpt-1')?.accepted.has(0)).toBe(false)
  })

  it('B3 — handleAcceptAllBulkLitho sends ONE batch call with all anchors, skipping rejected indices', async () => {
    geoApi.suggestLitho.mockResolvedValue({
      layers: [makeSuggestion('ZAND', 0.0), makeSuggestion('KLEI', 2.5)],
    })
    // The batch endpoint echoes per-anchor results back so the hook can mark
    // accepted indices + build undo ops.
    geoApi.batchAcceptLithoSuggestions.mockResolvedValue({
      anchors: [
        {
          cpt_id: 'cpt-1',
          borehole_id: null,
          created_formation_ids: [],
          found_formation_ids: [],
          created_contact_ids: ['cid-1'],
          found_contact_ids: [],
          error: null,
        },
        {
          cpt_id: 'cpt-2',
          borehole_id: null,
          created_formation_ids: [],
          found_formation_ids: [],
          created_contact_ids: ['cid-2', 'cid-3'],
          found_contact_ids: [],
          error: null,
        },
      ],
      total_created_contacts: 3,
      total_found_contacts: 0,
      total_created_formations: 0,
      failed_anchor_count: 0,
      inference_ran: true,
      updated_section: null,
    })
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestAllLitho([
        { kind: 'cpt', id: 'cpt-1', surfaceElevationM: 10 },
        { kind: 'cpt', id: 'cpt-2', surfaceElevationM: 8 },
      ])
    })
    // Reject layer 0 on cpt-1 — should be skipped in the batch payload.
    await act(async () => {
      result.current.handleRejectBulkLitho('cpt-1', 0)
    })
    await act(async () => {
      await result.current.handleAcceptAllBulkLitho(null)
    })
    // The whole bulk accept is ONE call (not one per anchor), and the legacy
    // per-anchor endpoint is never touched.
    expect(geoApi.batchAcceptLithoSuggestions).toHaveBeenCalledTimes(1)
    expect(geoApi.acceptLithoSuggestions).not.toHaveBeenCalled()
    const body = geoApi.batchAcceptLithoSuggestions.mock.calls[0][2] as {
      anchors: { cpt_id?: string; suggestions: unknown[] }[]
      run_inference?: boolean
    }
    expect(body.run_inference).toBe(true)
    expect(body.anchors).toHaveLength(2)
    // cpt-1 anchor carries only idx 1 (idx 0 rejected); cpt-2 carries both.
    const cpt1 = body.anchors.find(a => a.cpt_id === 'cpt-1')
    const cpt2 = body.anchors.find(a => a.cpt_id === 'cpt-2')
    expect(cpt1?.suggestions).toHaveLength(1)
    expect(cpt2?.suggestions).toHaveLength(2)
    // Both anchors' pending indices are marked accepted from the response.
    expect(bulkSubset(result).get('cpt-1')?.accepted.has(1)).toBe(true)
    expect(bulkSubset(result).get('cpt-2')?.accepted.has(0)).toBe(true)
    expect(bulkSubset(result).get('cpt-2')?.accepted.has(1)).toBe(true)
    // #140 (owner directive 2026-05-28): accept-all no longer auto-correlates;
    // the user runs Auto-correlate explicitly so accepting never surprises
    // them with amber edges.
    expect(geoApi.autoCorrelateContacts).not.toHaveBeenCalled()
  })

  it('B4 — handleEditBulkLitho overrides the layer depth at accept time', async () => {
    geoApi.suggestLitho.mockResolvedValue({
      layers: [makeSuggestion('ZAND', 0.0)],
    })
    geoApi.acceptLithoSuggestions.mockResolvedValue({
      created_formation_ids: [],
      found_formation_ids: [],
      created_contact_ids: ['cid-1'],
      found_contact_ids: [],
      updated_section: null,
    })
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestAllLitho([
        { kind: 'cpt', id: 'cpt-1', surfaceElevationM: 10 },
      ])
    })
    await act(async () => {
      result.current.handleEditBulkLitho('cpt-1', 0, { depth_top_m: 1.5 })
    })
    await act(async () => {
      await result.current.handleAcceptBulkLitho('cpt-1', 0, null)
    })
    const callBody = geoApi.acceptLithoSuggestions.mock.calls[0][2] as {
      suggestions: { depth_top_m: number }[]
    }
    // The edited depth wins — accept commits at 1.5 not the original 0.0.
    expect(callBody.suggestions[0].depth_top_m).toBe(1.5)
  })

  it('B5 — clearBulkLithoGhosts empties the Map', async () => {
    geoApi.suggestLitho.mockResolvedValue({
      layers: [makeSuggestion('ZAND', 0.0)],
    })
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestAllLitho([
        { kind: 'cpt', id: 'cpt-1', surfaceElevationM: 10 },
      ])
    })
    expect(bulkSubset(result).size).toBe(1)
    await act(async () => {
      result.current.clearBulkLithoGhosts()
    })
    expect(bulkSubset(result).size).toBe(0)
  })

  it('S8 — accept pushes an undo command that deletes the created contact + formation', async () => {
    const suggestions: LithoLayerSuggestion[] = [makeSuggestion('ZAND', 0.0)]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })
    geoApi.acceptLithoSuggestions.mockResolvedValueOnce(
      makeAcceptResponse({
        created_formation_ids: ['form-zand'],
        created_contact_ids: ['c-zand'],
      }),
    )
    geoApi.deleteContact.mockResolvedValue(undefined)
    geoApi.deleteFormation.mockResolvedValue(undefined)

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0)
    })

    // The accept registered exactly one undo command.
    expect(args.pushUndo).toHaveBeenCalledTimes(1)
    expect((focused(result)?.accepted ?? new Set<number>()).has(0)).toBe(true)

    // Revert deletes the created contact + formation (contacts first —
    // FK order) and returns the ghost layer to pending.
    const cmd = args.pushUndo.mock.calls[0][0] as { revert: () => Promise<void> }
    await act(async () => {
      await cmd.revert()
    })
    expect(geoApi.deleteContact).toHaveBeenCalledWith('proj-1', 'litho-model-1', 'c-zand')
    expect(geoApi.deleteFormation).toHaveBeenCalledWith('proj-1', 'form-zand')
    expect((focused(result)?.accepted ?? new Set<number>()).has(0)).toBe(false)
  })

  it('S9 — accepting an already-committed (found-only) layer pushes no undo', async () => {
    // The server returns only found_* ids when nothing was created;
    // there is nothing to delete, so no undo entry is pushed.
    const suggestions: LithoLayerSuggestion[] = [makeSuggestion('ZAND', 0.0)]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })
    geoApi.acceptLithoSuggestions.mockResolvedValueOnce(
      makeAcceptResponse({
        created_formation_ids: [],
        created_contact_ids: [],
        found_formation_ids: ['form-existing'],
        found_contact_ids: ['c-existing'],
      }),
    )

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0)
    })

    expect(args.pushUndo).not.toHaveBeenCalled()
  })

  // -------------------------------------------------------------------------
  // #144 — accepting a litho suggestion must mark the project dirty, exactly
  // like creating a contact does (handleCreateContact → addToSessionImports).
  // Every contact mutation writes to the DB immediately; the dirty flag +
  // unsaved-changes prompt + .gmproj write are gated on the session-imports
  // manifest. Accept used to skip that manifest, so a stack of accepted
  // layers left the amber flag dark and the .gmproj silently stale on close.
  // -------------------------------------------------------------------------

  it('D1 — single accept records the created contact + formation ids in the session-imports manifest', async () => {
    const suggestions: LithoLayerSuggestion[] = [makeSuggestion('ZAND', 0.0)]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })
    geoApi.acceptLithoSuggestions.mockResolvedValueOnce(
      makeAcceptResponse({
        created_formation_ids: ['form-zand'],
        created_contact_ids: ['c-zand'],
      }),
    )

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0)
    })

    // The newly created rows go into the manifest so projectDirty lights up.
    expect(args.addToSessionImports).toHaveBeenCalledWith('formation', ['form-zand'])
    expect(args.addToSessionImports).toHaveBeenCalledWith('contact', ['c-zand'])
  })

  it('D2 — accepting an already-committed (found-only) layer does NOT dirty-mark', async () => {
    // Nothing was created, so there is nothing new for the .gmproj to miss;
    // the manifest must stay untouched (mirrors S9's no-undo semantics).
    const suggestions: LithoLayerSuggestion[] = [makeSuggestion('ZAND', 0.0)]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })
    geoApi.acceptLithoSuggestions.mockResolvedValueOnce(
      makeAcceptResponse({
        created_formation_ids: [],
        created_contact_ids: [],
        found_formation_ids: ['form-existing'],
        found_contact_ids: ['c-existing'],
      }),
    )

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0)
    })

    expect(args.addToSessionImports).not.toHaveBeenCalled()
  })

  it('D3 — accept-all-bulk records every committed anchor created id in the manifest', async () => {
    geoApi.suggestLitho.mockResolvedValue({
      layers: [makeSuggestion('ZAND', 0.0), makeSuggestion('KLEI', 2.5)],
    })
    geoApi.batchAcceptLithoSuggestions.mockResolvedValue({
      anchors: [
        {
          cpt_id: 'cpt-1',
          borehole_id: null,
          created_formation_ids: ['fid-1'],
          found_formation_ids: [],
          created_contact_ids: ['cid-1'],
          found_contact_ids: [],
          error: null,
        },
        {
          cpt_id: 'cpt-2',
          borehole_id: null,
          created_formation_ids: [],
          found_formation_ids: [],
          created_contact_ids: ['cid-2', 'cid-3'],
          found_contact_ids: [],
          error: null,
        },
      ],
      total_created_contacts: 3,
      total_found_contacts: 0,
      total_created_formations: 1,
      failed_anchor_count: 0,
      inference_ran: true,
      updated_section: null,
    })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestAllLitho([
        { kind: 'cpt', id: 'cpt-1', surfaceElevationM: 10 },
        { kind: 'cpt', id: 'cpt-2', surfaceElevationM: 8 },
      ])
    })
    await act(async () => {
      await result.current.handleAcceptAllBulkLitho(null)
    })

    // Every committed anchor's created contacts + formations land in the
    // manifest — aggregated across anchors, not per-anchor.
    expect(args.addToSessionImports).toHaveBeenCalledWith(
      'contact',
      expect.arrayContaining(['cid-1', 'cid-2', 'cid-3']),
    )
    expect(args.addToSessionImports).toHaveBeenCalledWith(
      'formation',
      expect.arrayContaining(['fid-1']),
    )
  })

  it('S10 — handleStripLithoAdmixtures clears admixtures on matching ghosts', async () => {
    const suggestions: LithoLayerSuggestion[] = [
      makeSuggestion('ZAND', 0.0, {
        suggested_admixtures: [{ soil_code: 'KL', amount: 'M', locally: false }],
      }),
    ]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    act(() => {
      result.current.handleStripLithoAdmixtures('borehole')
    })

    // The ghost layer carries an edit with empty admixtures.
    expect(focused(result)?.edits.get(0)?.suggested_admixtures).toEqual([])
  })

  it('S11 — handleReseedLithoAdmixtures drops the admixture override on borehole ghosts', async () => {
    const suggestions: LithoLayerSuggestion[] = [
      makeSuggestion('ZAND', 0.0, {
        suggested_admixtures: [{ soil_code: 'KL', amount: 'M', locally: false }],
      }),
    ]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    // Strip, then reseed — the override is removed and the layer falls
    // back to the raw segmenter admixtures.
    act(() => {
      result.current.handleStripLithoAdmixtures('borehole')
    })
    expect(focused(result)?.edits.get(0)?.suggested_admixtures).toEqual([])

    act(() => {
      result.current.handleReseedLithoAdmixtures()
    })
    expect(focused(result)?.edits.get(0)?.suggested_admixtures).toBeUndefined()
  })

  it('S12 — handleClearLithoModel dismisses the litho suggestion ghosts', async () => {
    // Clearing the litho model is a DB-only delete; the ghost overlay is
    // ephemeral session state. The user expects "Clear litho model" to
    // also dismiss the coloured suggestion bands on the section.
    const suggestions: LithoLayerSuggestion[] = [makeSuggestion('ZAND', 0.0)]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })
    geoApi.clearLithoModel.mockResolvedValueOnce({
      contacts: 0,
      edges: 0,
      surfaces: 0,
      formations: 0,
    })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    // Ghost overlay is populated after Suggest.
    expect(focused(result)?.suggestions ?? []).toHaveLength(1)

    await act(async () => {
      await result.current.handleClearLithoModel()
    })

    // Clearing the model also wiped the ghost overlay.
    expect(result.current.focusedSuggestAnchorId).toBeNull()
    expect(result.current.ghostsByAnchor.size).toBe(0)
  })

  it('S14 — handleUpdateContactDepth does a full refetch on every successful 200 commit (drag-up fix)', async () => {
    // Bug C fix (dogfeed 2026-05-26): the previous implementation pruned peers
    // client-side on drag-up (optimistic filter over [newDepthM, oldDepthM)).
    // That prune was buggy when contacts from different formations occupied the
    // pruning window — the BE may have deleted them but the client couldn't tell.
    // Fix: always refetch after a 200 response, both for drag-up and drag-down.
    // This test verifies that listContacts is called after a successful 200 PATCH,
    // regardless of direction (drag-up path: newDepthM < oldDepthM).
    const originalContact = makeContact('c-geo', 'f-geo')
    originalContact.model_id = 'geo-model-1'
    originalContact.borehole_id = 'bh-1'
    originalContact.cpt_id = null
    originalContact.depth_top_m = 5.0  // original depth

    const updatedContact = { ...originalContact, depth_top_m: 2.0 }  // drag UP

    // Bootstrap: the hook calls listContacts once for the geological model and
    // once for the litho model.  The contact must ONLY appear in the geological
    // model's list so the hook routes the refetch to refetchContacts (not
    // refetchLithoContacts).  Use a per-argument mock to differentiate.
    geoApi.listContacts.mockImplementation(
      (_projectId: string, modelId: string) =>
        modelId === 'geo-model-1'
          ? Promise.resolve([originalContact])
          : Promise.resolve([]),
    )

    // updateContact returns the survivor outcome (not absorbed) — the dragger
    // survives as a committed contact; no peers were crossed here.
    geoApi.updateContact.mockResolvedValueOnce({ contact: updatedContact, deletedContactIds: [] })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Snapshot the call count BEFORE the drag commit so we can assert
    // exactly one MORE call was made (the refetch). This avoids coupling
    // the assertion to the number of bootstrap calls (which varies
    // across hook init phases and other effects in the describe block).
    const callsBefore = geoApi.listContacts.mock.calls.length

    // Drive the drag commit: move from 5.0 m to 2.0 m (drag UP — crosses the
    // interval [2.0, 5.0) where the BE may have deleted peers).
    await act(async () => {
      await result.current.handleUpdateContactDepth('c-geo', 2.0, false)
    })

    // At least one more listContacts call must have fired (the refetch).
    const callsAfter = geoApi.listContacts.mock.calls.length
    expect(callsAfter).toBeGreaterThan(callsBefore)

    // The refetch call must target the geological model (geo-model-1), NOT the
    // litho model — the contact's own model_id is used.
    const refetchCall = geoApi.listContacts.mock.calls[callsBefore]
    expect(refetchCall[1]).toBe('geo-model-1')
  })

  it("S13 — handleDeleteContact routes the DELETE to the contact's own model", async () => {
    // Regression: the contact-edit handlers (delete / depth / batch)
    // were hard-wired to the geological model, so deleting a litho
    // contact 404'd. The model must be derived from the contact's own
    // model_id — makeContact() stamps 'litho-model-1'.
    geoApi.listContacts.mockResolvedValue([makeContact('c-litho', 'f1')])
    geoApi.deleteContact.mockResolvedValue(undefined)

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    await act(async () => {
      await result.current.handleDeleteContact('c-litho')
    })

    // The DELETE used the contact's model (litho-model-1), NOT the
    // geological model (geo-model-1).
    expect(geoApi.deleteContact).toHaveBeenCalledWith(
      'proj-1',
      'litho-model-1',
      'c-litho',
    )
  })

  // -------------------------------------------------------------------------
  // #163c — after auto-correlate runs, the correlation edges/banners must
  // appear without the user manually reloading or reselecting the section.
  // The edge state lives in SectionsCanvas (a sibling of the toolbar that
  // fires auto-correlate), so handleAutoCorrelate has to signal that view to
  // refetch. The hook's half of that contract: a successful auto-correlate
  // requests a correlation-edges refetch.
  // -------------------------------------------------------------------------

  it('AC1 — a successful auto-correlate requests a correlation-edges refetch', async () => {
    geoApi.autoCorrelateContacts.mockResolvedValueOnce({
      edges_created: 2,
      edges_skipped_existing: 0,
    })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    await act(async () => {
      await result.current.handleAutoCorrelate()
    })

    expect(args.requestCorrelationEdgesRefetch).toHaveBeenCalled()
  })

  it('AC2 — a failed auto-correlate does NOT request a refetch', async () => {
    geoApi.autoCorrelateContacts.mockRejectedValueOnce(new Error('boom'))

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    await act(async () => {
      await result.current.handleAutoCorrelate()
    })

    expect(args.requestCorrelationEdgesRefetch).not.toHaveBeenCalled()
  })
})
