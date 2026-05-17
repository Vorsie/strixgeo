// Behavioral net for the slice-3 (#55) litho-suggestion state machine in
// useGeologicalModel.
//
// Claims pinned here:
//   S1  handleSuggestLitho stores layers + sets investigationId/anchorKind.
//   S2  handleRejectLithoSuggestion marks the index rejected only (no API
//       call, no formation created, no contact created).
//   S3  handleAcceptLithoSuggestion — distinct lithologies → N unique
//       formation creations + N contact creations (one per distinct layer).
//   S4  Reuse-not-duplicate: re-accepting the same lithology token reuses
//       the formation already created (one createFormation, two createContact).
//   S5  clearLithoSuggestions resets all suggestion state atoms to empty.
//
// Strategy: mock the whole api.geology module so every call resolves to a
// stable sentinel.  Drive handleSuggestLitho first (via mocked suggestLitho)
// to populate lithoSuggestions, then drive accept/reject, then assert on
// the hook's exported state.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, type MockInstance } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type {
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function makeSuggestion(lithology: string, depth: number): LithoLayerSuggestion {
  return {
    depth_top_m: depth,
    depth_base_m: depth + 2.0,
    suggested_lithology: lithology,
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'medium' as const,
    source: 'robertson2015',
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
    expect(result.current.lithoSuggestions).toHaveLength(0)
    expect(result.current.lithoSuggestionInvestigationId).toBeNull()
    expect(result.current.lithoSuggestionAnchorKind).toBeNull()

    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    expect(result.current.lithoSuggestions).toHaveLength(2)
    expect(result.current.lithoSuggestions[0].suggested_lithology).toBe('ZAND')
    expect(result.current.lithoSuggestions[1].suggested_lithology).toBe('KLEI')
    expect(result.current.lithoSuggestionInvestigationId).toBe('bh-1')
    expect(result.current.lithoSuggestionAnchorKind).toBe('borehole')
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

    expect(result.current.lithoSuggestionRejected.has(0)).toBe(true)
    expect(result.current.lithoSuggestionRejected.has(1)).toBe(false)
    expect(result.current.lithoSuggestionAccepted.has(0)).toBe(false)

    // No formation or contact creation
    expect(geoApi.createFormation).not.toHaveBeenCalled()
    expect(geoApi.createContact).not.toHaveBeenCalled()
  })

  it('S3 — distinct lithologies → N createFormation + N createContact calls', async () => {
    const suggestions: LithoLayerSuggestion[] = [
      makeSuggestion('ZAND', 0.0),
      makeSuggestion('KLEI', 3.0),
    ]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })

    const zandFormation = makeFormation('form-zand', 'ZAND')
    const kleiFormation = makeFormation('form-klei', 'KLEI')
    geoApi.createFormation
      .mockResolvedValueOnce(zandFormation)
      .mockResolvedValueOnce(kleiFormation)

    const zandContact = makeContact('c-zand', 'form-zand')
    const kleiContact = makeContact('c-klei', 'form-klei')
    geoApi.createContact
      .mockResolvedValueOnce(zandContact)
      .mockResolvedValueOnce(kleiContact)

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    // Accept both layers
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0)
    })
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(1)
    })

    // Two formations created (one per distinct lithology)
    expect(geoApi.createFormation).toHaveBeenCalledTimes(2)
    expect(geoApi.createFormation).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ lithology: 'ZAND' }),
    )
    expect(geoApi.createFormation).toHaveBeenCalledWith(
      'proj-1',
      expect.objectContaining({ lithology: 'KLEI' }),
    )

    // Two contacts created
    expect(geoApi.createContact).toHaveBeenCalledTimes(2)
    expect(geoApi.createContact).toHaveBeenCalledWith(
      'proj-1',
      'litho-model-1',
      expect.objectContaining({ formation_id: 'form-zand', depth_top_m: 0.0 }),
    )
    expect(geoApi.createContact).toHaveBeenCalledWith(
      'proj-1',
      'litho-model-1',
      expect.objectContaining({ formation_id: 'form-klei', depth_top_m: 3.0 }),
    )

    // Both accepted, none rejected
    expect(result.current.lithoSuggestionAccepted.has(0)).toBe(true)
    expect(result.current.lithoSuggestionAccepted.has(1)).toBe(true)
    expect(result.current.lithoSuggestionRejected.size).toBe(0)
  })

  it('S4 — reuse-not-duplicate: re-accepting the same lithology token reuses formation', async () => {
    // Two suggestions with the same lithology token at different depths.
    // First accept creates the formation; second accept must reuse it.
    const suggestions: LithoLayerSuggestion[] = [
      makeSuggestion('ZAND', 0.0),
      makeSuggestion('ZAND', 5.0),
    ]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })

    const zandFormation = makeFormation('form-zand', 'ZAND')
    // createFormation should only be called once — return the formation on first call
    geoApi.createFormation.mockResolvedValueOnce(zandFormation)

    const contactA = makeContact('c-zand-a', 'form-zand')
    const contactB = { ...makeContact('c-zand-b', 'form-zand'), depth_top_m: 5.0 }
    geoApi.createContact
      .mockResolvedValueOnce(contactA)
      .mockResolvedValueOnce(contactB)

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    // Accept index 0 — should create formation 'ZAND' + contact at 0.0m
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0)
    })

    expect(geoApi.createFormation).toHaveBeenCalledTimes(1)
    expect(geoApi.createContact).toHaveBeenCalledTimes(1)
    expect(geoApi.createContact).toHaveBeenCalledWith(
      'proj-1',
      'litho-model-1',
      expect.objectContaining({ formation_id: 'form-zand', depth_top_m: 0.0 }),
    )

    // Accept index 1 — same 'ZAND' lithology; formation must be reused, not recreated
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(1)
    })

    // Still only one formation created
    expect(geoApi.createFormation).toHaveBeenCalledTimes(1)
    // But two contacts created (different depths)
    expect(geoApi.createContact).toHaveBeenCalledTimes(2)
    expect(geoApi.createContact).toHaveBeenCalledWith(
      'proj-1',
      'litho-model-1',
      expect.objectContaining({ formation_id: 'form-zand', depth_top_m: 5.0 }),
    )

    // Both accepted
    expect(result.current.lithoSuggestionAccepted.has(0)).toBe(true)
    expect(result.current.lithoSuggestionAccepted.has(1)).toBe(true)
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
    expect(result.current.lithoSuggestions).toHaveLength(1)
    expect(result.current.lithoSuggestionInvestigationId).toBe('cpt-42')

    act(() => {
      result.current.clearLithoSuggestions()
    })

    expect(result.current.lithoSuggestions).toHaveLength(0)
    expect(result.current.lithoSuggestionInvestigationId).toBeNull()
    expect(result.current.lithoSuggestionAnchorKind).toBeNull()
    expect(result.current.lithoSuggestionAccepted.size).toBe(0)
    expect(result.current.lithoSuggestionRejected.size).toBe(0)
  })

  it('S6 — BURST reuse: two same-lithology accepts with NO flush between still create one formation', async () => {
    // The real "accept the sand layers off a CPT" workflow: consecutive
    // same-lithology accepts fired faster than React commits +
    // refreshes lithoFormationsRef. S4 passes only because it act()s
    // between accepts (flushing the ref). This pins the un-flushed
    // burst — it FAILS on the pre-fix stale-ref code (two
    // createFormation calls) and passes with the synchronous
    // per-token guard.
    const suggestions: LithoLayerSuggestion[] = [
      makeSuggestion('ZAND', 0.0),
      makeSuggestion('ZAND', 5.0),
    ]
    geoApi.suggestLitho.mockResolvedValueOnce({ layers: suggestions })
    const zandFormation = makeFormation('form-zand', 'ZAND')
    geoApi.createFormation.mockResolvedValue(zandFormation)
    geoApi.createContact
      .mockResolvedValueOnce(makeContact('c-a', 'form-zand'))
      .mockResolvedValueOnce({
        ...makeContact('c-b', 'form-zand'),
        depth_top_m: 5.0,
      })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    await act(async () => {
      await result.current.handleSuggestLitho('borehole', 'bh-1')
    })

    // Both accepts inside ONE act, concurrently — no render/effect
    // flush separates them (unlike S4).
    await act(async () => {
      await Promise.all([
        result.current.handleAcceptLithoSuggestion(0),
        result.current.handleAcceptLithoSuggestion(1),
      ])
    })

    // The race must NOT have duplicated the formation.
    expect(geoApi.createFormation).toHaveBeenCalledTimes(1)
    expect(geoApi.createContact).toHaveBeenCalledTimes(2)
    expect(result.current.lithoSuggestionAccepted.has(0)).toBe(true)
    expect(result.current.lithoSuggestionAccepted.has(1)).toBe(true)
  })
})
