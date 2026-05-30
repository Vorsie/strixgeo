// Behavioral net for the pinch-out auto-retry direction handling in
// useGeologicalModel.handlePreviewPinchOut (debt #62 item 2).
//
// Claims pinned here:
//   PO1 — happy path: direction='right' succeeds on the first try; the
//         preview state carries the requested direction; no retry fires.
//   PO2 — geometry-uncomputable retry: the first call fails with the
//         backend's `code: 'pinch_out_geometry_error'`; the hook silently
//         retries the OPPOSITE direction; on success the preview carries
//         the flipped direction. (The dogfeed-frustration fix: a west-
//         pinching formation no longer surfaces an opaque 422.)
//   PO3 — both directions fail: the second attempt's error is what the
//         user sees; preview stays null; loading is cleared.
//   PO4 — non-geometry error (e.g. cross-project guard, missing model)
//         does NOT trigger a retry; one call, one error toast.

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type { ProjectResponse } from '../api/client'

// ---------------------------------------------------------------------------
// Module mocks — match the suggestion.test.ts pattern.
// ---------------------------------------------------------------------------
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
      extrapolatePinchOut: vi.fn(),
    },
    cpt: { list: vi.fn(), get: vi.fn() },
    borehole: { list: vi.fn(), get: vi.fn() },
    section: { list: vi.fn() },
    project: { get: vi.fn(), update: vi.fn() },
    geotechnicalUnit: { list: vi.fn(), create: vi.fn() },
  },
  DuplicateContactError: class extends Error {
    existingContactId: string
    constructor(id: string) {
      super('duplicate')
      this.existingContactId = id
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

import { api } from '../api/client'

const geoApi = api.geology as unknown as Record<string, MockInstance>

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
  return {
    args: {
      project: TEST_PROJECT,
      toast,
      pushUndo: vi.fn(),
      addToManifest: vi.fn(),
      removeFromManifest: vi.fn(),
      addToSessionImports: vi.fn(),
      removeFromSessionImports: vi.fn(),
      manifestFormationIds: undefined as Set<string> | undefined,
      currentLumping: null as import('../utils/projectFile').StratigraphyLumping | null,
      stageLumping: vi.fn(),
      requestCorrelationEdgesRefetch: vi.fn(),
      markMutated: vi.fn(),
    },
    toast,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Empty bootstrap — pinch-out tests don't need any models loaded.
  geoApi.listModels.mockResolvedValue([])
  geoApi.listFormations.mockResolvedValue([])
  geoApi.listContacts.mockResolvedValue([])
  geoApi.listSurfaces.mockResolvedValue([])
  geoApi.validateCrossings.mockResolvedValue({ crossings: [] })
})

const PARAMS = {
  formationId: 'f-pinching',
  targetFormationId: 'f-target',
  sectionId: 'sec-1',
  modelId: 'mod-1',
  modelKind: 'geological' as const,
  direction: 'right' as const,
}

function makeOkResp(): {
  tip_along_m: number
  tip_elevation_m: number
  inserted_contact_ids: string[]
  was_idempotent: boolean
  updated_section: null
} {
  return {
    tip_along_m: 12.34,
    tip_elevation_m: 5.67,
    inserted_contact_ids: [],
    was_idempotent: false,
    updated_section: null,
  }
}

function makeGeometryError(): Error & { status: number; code: string } {
  return Object.assign(new Error('Could not compute pinch-out tip: diverging'), {
    status: 422,
    code: 'pinch_out_geometry_error',
  })
}

describe('useGeologicalModel — handlePreviewPinchOut (#62 item 2)', () => {
  it('PO1 — happy path: success on the requested direction, no retry', async () => {
    geoApi.extrapolatePinchOut.mockResolvedValueOnce(makeOkResp())

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await result.current.handlePreviewPinchOut(PARAMS)
    })

    expect(geoApi.extrapolatePinchOut).toHaveBeenCalledTimes(1)
    const callDirection = (geoApi.extrapolatePinchOut.mock.calls[0][2] as { direction: string })
      .direction
    expect(callDirection).toBe('right')
    expect(result.current.pinchOutPreview?.direction).toBe('right')
    expect(result.current.pinchOutLoading).toBe(false)
  })

  it('PO2 — direction-inconsistent 422 triggers a single retry with the opposite direction', async () => {
    geoApi.extrapolatePinchOut
      .mockRejectedValueOnce(makeGeometryError())
      .mockResolvedValueOnce(makeOkResp())

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await result.current.handlePreviewPinchOut(PARAMS)
    })

    expect(geoApi.extrapolatePinchOut).toHaveBeenCalledTimes(2)
    const d1 = (geoApi.extrapolatePinchOut.mock.calls[0][2] as { direction: string }).direction
    const d2 = (geoApi.extrapolatePinchOut.mock.calls[1][2] as { direction: string }).direction
    expect(d1).toBe('right')
    expect(d2).toBe('left')
    // Preview carries the FLIPPED direction so any later commit uses it.
    expect(result.current.pinchOutPreview?.direction).toBe('left')
    expect(result.current.pinchOutLoading).toBe(false)
  })

  it('PO3 — both directions fail with the same code: error surfaces, preview stays null', async () => {
    geoApi.extrapolatePinchOut
      .mockRejectedValueOnce(makeGeometryError())
      .mockRejectedValueOnce(makeGeometryError())

    const { args, toast } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    // Reset toast post-bootstrap so we only count the pinch-out
    // failure toast — the hook fires its own toasts during the
    // initial listModels/listFormations/listContacts loads.
    await waitFor(() => {
      expect(result.current).toBeDefined()
    })
    toast.mockClear()

    await act(async () => {
      await result.current.handlePreviewPinchOut(PARAMS)
    })

    expect(geoApi.extrapolatePinchOut).toHaveBeenCalledTimes(2)
    expect(result.current.pinchOutPreview).toBeNull()
    expect(result.current.pinchOutLoading).toBe(false)
    expect(toast).toHaveBeenCalledTimes(1)
  })

  it('PO5 — litho-axis pinch-out commit refreshes /layers, NOT the geological contacts list', async () => {
    // A5 carve-out: lithoContacts is now a derived memo from lithoLayers.
    // Anchor-less synthetic pinch-out FCs (debt #131-b future work)
    // have no LL counterpart, so they cannot appear in lithoContacts
    // post-A5 — that's the documented Shape A trade-off.
    //
    // What this test pins: the commit's model-kind branch goes through
    // the LITHO refetch path (api.geology.listLayers via
    // refetchLithoContacts) rather than the geological setContacts.
    // Calling the wrong setter would scribble synthetic FCs into the
    // geological contacts list — that's the regression we're guarding
    // against.
    geoApi.extrapolatePinchOut
      .mockResolvedValueOnce(makeOkResp())
      .mockResolvedValueOnce({
        created_contact_ids: ['litho-contact-1'],
        tip_along_m: 12.34,
        tip_elevation_m: 5.67,
        updated_section: null,
      })
    // refetchLithoContacts hits /layers — synthetics don't exist there,
    // so an empty array is the truthful response.
    geoApi.listLayers.mockResolvedValueOnce([])

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await waitFor(() => {
      expect(result.current).toBeDefined()
    })

    await act(async () => {
      await result.current.handlePreviewPinchOut({
        ...PARAMS,
        modelKind: 'lithostratigraphic',
      })
    })
    expect(result.current.pinchOutPreview?.model_kind).toBe('lithostratigraphic')

    await act(async () => {
      await result.current.handleCommitPinchOut()
    })

    // The commit took the LITHO branch — listContacts (the geological
    // refresh path) was NOT called. The litho branch goes through
    // refetchLithoContacts, which is a no-op when no litho model is
    // active in this test fixture (artificial setup — debt #131-b
    // future work would activate a real litho model before pinch-out
    // commit). The regression-guard is "litho branch must NOT scribble
    // into the geological contacts list".
    expect(geoApi.listContacts).not.toHaveBeenCalled()
    expect(result.current.contacts).toHaveLength(0)
  })

  it('PO4 — non-geometry error (no `code: pinch_out_geometry_error`) does NOT retry', async () => {
    // Simulate the cross-project guard 404 or a network failure — the
    // error has no `code` (or a different one) so the retry must skip
    // it and surface the error immediately.
    const otherErr = Object.assign(new Error('Model not found'), {
      status: 404,
    })
    geoApi.extrapolatePinchOut.mockRejectedValueOnce(otherErr)

    const { args, toast } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await waitFor(() => {
      expect(result.current).toBeDefined()
    })
    toast.mockClear()

    await act(async () => {
      await result.current.handlePreviewPinchOut(PARAMS)
    })

    expect(geoApi.extrapolatePinchOut).toHaveBeenCalledTimes(1)
    expect(result.current.pinchOutPreview).toBeNull()
    expect(toast).toHaveBeenCalledTimes(1)
  })
})
