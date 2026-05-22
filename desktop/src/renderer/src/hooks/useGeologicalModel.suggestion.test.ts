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
      listSurfaces: vi.fn(),
      validateCrossings: vi.fn(),
      createModel: vi.fn(),
      activateModel: vi.fn(),
      createFormation: vi.fn(),
      createContact: vi.fn(),
      suggestLitho: vi.fn(),
      acceptLithoSuggestions: vi.fn(),
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
    },
    cpt: { list: vi.fn(), get: vi.fn() },
    borehole: { list: vi.fn(), get: vi.fn() },
    section: { list: vi.fn() },
    project: { get: vi.fn(), update: vi.fn() },
    geotechnicalUnit: { list: vi.fn(), create: vi.fn() },
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
    parent_geological_model_id: null,
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
    straddle_split_count: 0,
    stale_tin_fallback_count: 0,
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

  it('B2 — handleAcceptBulkLitho commits one layer + marks the idx accepted on the anchor', async () => {
    geoApi.suggestLitho.mockResolvedValue({
      layers: [makeSuggestion('ZAND', 0.0), makeSuggestion('KLEI', 2.5)],
    })
    geoApi.acceptLithoSuggestions.mockResolvedValue({
      created_formation_ids: ['fid-1'],
      found_formation_ids: [],
      created_contact_ids: ['cid-1'],
      found_contact_ids: [],
      straddle_split_count: 0,
      stale_tin_fallback_count: 0,
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

  it('B3 — handleAcceptAllBulkLitho issues one call per anchor and skips rejected indices', async () => {
    geoApi.suggestLitho.mockResolvedValue({
      layers: [makeSuggestion('ZAND', 0.0), makeSuggestion('KLEI', 2.5)],
    })
    geoApi.acceptLithoSuggestions.mockResolvedValue({
      created_formation_ids: [],
      found_formation_ids: [],
      created_contact_ids: ['cid-1', 'cid-2'],
      found_contact_ids: [],
      straddle_split_count: 0,
      stale_tin_fallback_count: 0,
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
    // Reject layer 0 on cpt-1 — should be skipped in the bulk accept.
    await act(async () => {
      result.current.handleRejectBulkLitho('cpt-1', 0)
    })
    await act(async () => {
      await result.current.handleAcceptAllBulkLitho(null)
    })
    // Two anchors × one or two pending layers per anchor → 2 calls total
    // (one per anchor that has pending layers).
    expect(geoApi.acceptLithoSuggestions).toHaveBeenCalledTimes(2)
    // cpt-1 call carries only idx 1 (idx 0 was rejected).
    const cpt1Call = geoApi.acceptLithoSuggestions.mock.calls.find(
      (c: unknown[]) =>
        (c[2] as { cpt_id?: string }).cpt_id === 'cpt-1',
    )
    expect(
      (cpt1Call?.[2] as { suggestions: unknown[] }).suggestions,
    ).toHaveLength(1)
    // cpt-2 call carries both layers (nothing rejected).
    const cpt2Call = geoApi.acceptLithoSuggestions.mock.calls.find(
      (c: unknown[]) =>
        (c[2] as { cpt_id?: string }).cpt_id === 'cpt-2',
    )
    expect(
      (cpt2Call?.[2] as { suggestions: unknown[] }).suggestions,
    ).toHaveLength(2)
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
      straddle_split_count: 0,
      stale_tin_fallback_count: 0,
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
})
