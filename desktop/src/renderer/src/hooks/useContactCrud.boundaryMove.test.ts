// Behavioural net for the accepted shared-boundary move in
// useContactCrud.handleUpdateContactDepth (dogfeed 2026-06-06).
//
// Claims pinned here:
//   B1  Dragging a boundary shared between two ACCEPTED layers routes to
//       api.geology.moveLayerBoundary (atomic two-row resize) and does NOT
//       call the single-layer api.geology.updateLayer.
//   B2  An outer edge (no accepted partner on the same anchor) falls
//       through to the single-layer api.geology.updateLayer path.
//   B3  Over-dragging past a neighbour edge clamps new_depth_m strictly
//       into (upper.depth_top_m, lower.depth_base_m).
//   B4  Undo replays moveLayerBoundary back to the pre-drag boundary depth.
//
// Strategy: useContactCrud takes every dependency as a param, so we render
// it directly with vi.fn() spies and a mocked api.geology, then drive
// handleUpdateContactDepth and assert on the calls.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useContactCrud } from './useContactCrud'
import type {
  FormationContactResponse,
  LithoLayerResponse,
  ProjectResponse,
} from '../api/client'
import type { UndoCommand } from './useUndoStack'

// ---------------------------------------------------------------------------
// Module mocks — api.geology + log
// ---------------------------------------------------------------------------

vi.mock('../api/client', () => ({
  api: {
    geology: {
      moveLayerBoundary: vi.fn().mockResolvedValue({ upper: {}, lower: {} }),
      updateLayer: vi.fn().mockResolvedValue({
        id: 'L-lower',
        depth_top_m: 2,
        formation_id: 'F1',
        source: 'manual',
        confidence: 'medium',
      }),
      updateContact: vi.fn(),
      createContact: vi.fn(),
      deleteContact: vi.fn(),
      deleteLayer: vi.fn(),
      bulkCreateLayers: vi.fn(),
      batchUpdateLayers: vi.fn(),
      updateContactsBatch: vi.fn(),
      linkLayerToGeo: vi.fn(),
    },
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

// Pull the mocked api in after the mock is registered.
import { api } from '../api/client'

const MODEL_ID = 'M1'

const PROJECT = { id: 'P1' } as ProjectResponse

/** Build a litho layer row with sensible defaults for the fields the
 * boundary-move logic reads (anchor XOR, depths, status). */
function makeLayer(over: Partial<LithoLayerResponse>): LithoLayerResponse {
  return {
    id: 'L?',
    model_id: MODEL_ID,
    formation_id: 'F1',
    borehole_id: 'BH1',
    cpt_id: null,
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted',
    source: 'manual',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

/** A FormationContactResponse mirror of a layer's TOP — drives the
 * lithoContacts.some(isLitho) detection and the `previous` lookup. */
function makeContact(over: Partial<FormationContactResponse>): FormationContactResponse {
  return {
    id: 'L?',
    model_id: MODEL_ID,
    formation_id: 'F1',
    borehole_id: 'BH1',
    cpt_id: null,
    depth_top_m: 0,
    source: 'manual_pick',
    confidence: 'medium',
    ...over,
  } as FormationContactResponse
}

interface Harness {
  pushUndo: ReturnType<typeof vi.fn>
  markMutated: ReturnType<typeof vi.fn>
  refetchLithoContacts: ReturnType<typeof vi.fn>
  result: { current: ReturnType<typeof useContactCrud> }
}

/** Render useContactCrud with the given litho layers/contacts and spy deps. */
function renderHarness(
  lithoLayers: LithoLayerResponse[],
  lithoContacts: FormationContactResponse[],
): Harness {
  const pushUndo = vi.fn()
  const markMutated = vi.fn()
  const refetchLithoContacts = vi.fn()
  const { result } = renderHook(() =>
    useContactCrud({
      project: PROJECT,
      activeGeologicalModel: null,
      contacts: [],
      setContacts: vi.fn(),
      lithoContacts,
      lithoLayers,
      refetchContacts: vi.fn(),
      refetchLithoContacts,
      addToSessionImports: vi.fn(),
      pushUndo,
      markMutated,
      toast: vi.fn(),
    }),
  )
  return { pushUndo, markMutated, refetchLithoContacts, result }
}

describe('useContactCrud — accepted shared-boundary move', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // Two accepted adjacent layers on BH1: upper [0, 2], lower [2, 5].
  // Their shared boundary is at 2 m; dragging the lower layer's TOP
  // (field='top') up to 1.5 m must resize both via moveLayerBoundary.
  function twoAcceptedLayers(): { layers: LithoLayerResponse[]; contacts: FormationContactResponse[] } {
    const upper = makeLayer({ id: 'L-upper', depth_top_m: 0, depth_base_m: 2 })
    const lower = makeLayer({ id: 'L-lower', depth_top_m: 2, depth_base_m: 5 })
    const layers = [upper, lower]
    const contacts = [
      makeContact({ id: 'L-upper', depth_top_m: 0 }),
      makeContact({ id: 'L-lower', depth_top_m: 2 }),
    ]
    return { layers, contacts }
  }

  it('B1: routes the shared boundary to moveLayerBoundary, not updateLayer', async () => {
    const { layers, contacts } = twoAcceptedLayers()
    const h = renderHarness(layers, contacts)

    await act(async () => {
      // Drag the lower layer's TOP boundary up to 1.5 m.
      await h.result.current.handleUpdateContactDepth('L-lower', 1.5, false, 'top')
    })

    expect(api.geology.moveLayerBoundary).toHaveBeenCalledTimes(1)
    expect(api.geology.moveLayerBoundary).toHaveBeenCalledWith('P1', MODEL_ID, {
      upper_layer_id: 'L-upper',
      lower_layer_id: 'L-lower',
      new_depth_m: 1.5,
    })
    expect(api.geology.updateLayer).not.toHaveBeenCalled()
    expect(h.markMutated).toHaveBeenCalled()
    expect(h.refetchLithoContacts).toHaveBeenCalled()
  })

  it('B2: an outer edge (no accepted partner) falls through to updateLayer', async () => {
    // Single accepted layer [0, 2] on BH1 — dragging its TOP has no
    // accepted partner above, so it must use the single-layer path.
    const only = makeLayer({ id: 'L-only', depth_top_m: 0, depth_base_m: 2 })
    const contacts = [makeContact({ id: 'L-only', depth_top_m: 0 })]
    const h = renderHarness([only], contacts)

    await act(async () => {
      await h.result.current.handleUpdateContactDepth('L-only', 0.5, false, 'top')
    })

    expect(api.geology.moveLayerBoundary).not.toHaveBeenCalled()
    expect(api.geology.updateLayer).toHaveBeenCalledTimes(1)
  })

  it('B3: over-drag clamps new_depth_m strictly inside (upper.top, lower.base)', async () => {
    const { layers, contacts } = twoAcceptedLayers()
    const h = renderHarness(layers, contacts)

    await act(async () => {
      // Drag far past the lower layer's base (5 m) — must clamp below 5.
      await h.result.current.handleUpdateContactDepth('L-lower', 99, false, 'top')
    })

    expect(api.geology.moveLayerBoundary).toHaveBeenCalledTimes(1)
    const call = (api.geology.moveLayerBoundary as ReturnType<typeof vi.fn>).mock.calls[0]
    const depth = call[2].new_depth_m as number
    expect(depth).toBeGreaterThan(0) // > upper.top
    expect(depth).toBeLessThan(5) // < lower.base
  })

  it('B4: undo replays moveLayerBoundary back to the pre-drag boundary depth', async () => {
    const { layers, contacts } = twoAcceptedLayers()
    const h = renderHarness(layers, contacts)

    await act(async () => {
      await h.result.current.handleUpdateContactDepth('L-lower', 1.5, false, 'top')
    })

    expect(h.pushUndo).toHaveBeenCalledTimes(1)
    const cmd = h.pushUndo.mock.calls[0][0] as UndoCommand
    ;(api.geology.moveLayerBoundary as ReturnType<typeof vi.fn>).mockClear()

    await act(async () => {
      await cmd.revert()
    })

    // Revert moves the boundary back to its original 2 m position.
    expect(api.geology.moveLayerBoundary).toHaveBeenCalledWith('P1', MODEL_ID, {
      upper_layer_id: 'L-upper',
      lower_layer_id: 'L-lower',
      new_depth_m: 2,
    })
  })
})
