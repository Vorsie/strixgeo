// Behavioural net for useContactCrud's create + delete paths (the
// boundary-move path is covered separately in
// useContactCrud.boundaryMove.test.ts). Pins invariants tied to real
// geological rules + dogfeed bugs, phrased in the rule's vocabulary:
//
//   CC1  A manual contact create appends to local state, records the created
//        id in the session-imports manifest (dirty flag), and registers undo.
//   CC2  (one-top-per-formation-per-borehole rule) A 409 DuplicateContactError
//        does NOT refuse — it MOVES the existing contact to the clicked depth
//        (the engineer clearly wants that formation's top there). A slot the
//        local list shows as taken is moved WITHOUT the refused POST; a 409
//        from a stale list (CC2-net) still lands on the same move.
//   CC3  Snap flags: a snapped placement is source=borehole_observation /
//        confidence=high; a free pick is manual_pick / medium (debt #22/#23).
//   CC4  (P2 explicit-content) A create on a section threads section_id into
//        the payload so the section's explicit-content filter shows it.
//   CC5  A non-duplicate failure surfaces an error toast and does NOT append,
//        record, or register undo (no phantom optimistic state).
//   DEL1 A geological-axis delete routes to deleteContact, prunes local state,
//        marks the project dirty (#160), and registers undo.
//   DEL2 (dogfeed 2026-05-22) A litho-axis delete routes to deleteLayer — NOT
//        deleteContact — and refetches litho contacts. Hard-wiring to the geo
//        model previously made a litho contact undeletable.
//   DEL3 Deleting an unknown id is a no-op (no API call).
//
// Strategy: useContactCrud takes every dependency as a param — render it with
// vi.fn() spies + a mocked api.geology, drive the handlers, assert on calls +
// on the state updaters passed to setContacts.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useContactCrud } from './useContactCrud'
import type {
  FormationContactResponse,
  GeologicalModelResponse,
  LithoLayerResponse,
  ProjectResponse,
} from '../api/client'
import type { UndoCommand } from './useUndoStack'

// ---------------------------------------------------------------------------
// Module mocks — api.geology + log + DuplicateContactError
// ---------------------------------------------------------------------------

// Shared ApiError class, hoisted so the vi.mock factory and the tests
// instanceof-check the SAME constructor (isApiStatus narrows on it).
const { ApiErrorMock } = vi.hoisted(() => ({
  ApiErrorMock: class ApiError extends Error {
    status: number
    constructor(message: string, status: number) {
      super(message)
      this.name = 'ApiError'
      this.status = status
    }
  },
}))

vi.mock('../api/client', () => ({
  api: {
    geology: {
      createContact: vi.fn(),
      updateContact: vi.fn(),
      updateLayer: vi.fn(),
      moveLayerBoundary: vi.fn(),
      deleteContact: vi.fn(),
      deleteLayer: vi.fn(),
      // Reached only by undo revert/reapply paths — stub so those never throw
      // "is not a function" when the undo command is executed.
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
  // The delete path narrows a 404 rejection via isApiStatus to drop an
  // already-gone contact silently — mirror the real shapes so the narrow works.
  ApiError: ApiErrorMock,
  isApiStatus: (err: unknown, status: number): boolean =>
    err instanceof ApiErrorMock && err.status === status,
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

import { api, DuplicateContactError } from '../api/client'

const MODEL_ID = 'M-geo-1'
const PROJECT = { id: 'P1', view_state: {} } as unknown as ProjectResponse
const GEO_MODEL = { id: MODEL_ID, kind: 'geological' } as unknown as GeologicalModelResponse

const createSpy = api.geology.createContact as unknown as ReturnType<typeof vi.fn>
const updateContactSpy = api.geology.updateContact as unknown as ReturnType<typeof vi.fn>
const deleteContactSpy = api.geology.deleteContact as unknown as ReturnType<typeof vi.fn>
const deleteLayerSpy = api.geology.deleteLayer as unknown as ReturnType<typeof vi.fn>

/** A FormationContactResponse with sensible defaults. */
function makeContact(over: Partial<FormationContactResponse> = {}): FormationContactResponse {
  return {
    id: 'C1',
    model_id: MODEL_ID,
    formation_id: 'F1',
    borehole_id: 'BH1',
    cpt_id: null,
    depth_top_m: 1,
    source: 'manual_pick',
    confidence: 'medium',
    ...over,
  } as FormationContactResponse
}

interface Harness {
  setContacts: ReturnType<typeof vi.fn>
  addToSessionImports: ReturnType<typeof vi.fn>
  pushUndo: ReturnType<typeof vi.fn>
  markMutated: ReturnType<typeof vi.fn>
  refetchLithoContacts: ReturnType<typeof vi.fn>
  toast: ReturnType<typeof vi.fn>
  result: { current: ReturnType<typeof useContactCrud> }
}

function renderHarness(
  over: {
    activeGeologicalModel?: GeologicalModelResponse | null
    contacts?: FormationContactResponse[]
    lithoContacts?: FormationContactResponse[]
    lithoLayers?: LithoLayerResponse[]
  } = {},
): Harness {
  const setContacts = vi.fn()
  const addToSessionImports = vi.fn()
  const pushUndo = vi.fn()
  const markMutated = vi.fn()
  const refetchLithoContacts = vi.fn()
  const toast = vi.fn()
  const { result } = renderHook(() =>
    useContactCrud({
      project: PROJECT,
      activeGeologicalModel: over.activeGeologicalModel ?? GEO_MODEL,
      contacts: over.contacts ?? [],
      setContacts,
      lithoContacts: over.lithoContacts ?? [],
      lithoLayers: over.lithoLayers ?? [],
      refetchContacts: vi.fn(),
      refetchLithoContacts,
      addToSessionImports,
      pushUndo,
      markMutated,
      toast,
    }),
  )
  return { setContacts, addToSessionImports, pushUndo, markMutated, refetchLithoContacts, toast, result }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// handleCreateContact
// ---------------------------------------------------------------------------

describe('handleCreateContact', () => {
  it('CC1: happy path appends, records the created id, and registers undo', async () => {
    createSpy.mockResolvedValue(makeContact({ id: 'C-new', depth_top_m: 3 }))
    const h = renderHarness()

    await act(async () => {
      await h.result.current.handleCreateContact('borehole', 'BH1', 3, 'F1', false)
    })

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(h.setContacts).toHaveBeenCalled()
    // Applying the updater to a seed array must append the created contact.
    const updater = h.setContacts.mock.calls.at(-1)?.[0] as (
      prev: FormationContactResponse[],
    ) => FormationContactResponse[]
    expect(updater([]).map(c => c.id)).toEqual(['C-new'])
    // Dirty-flag manifest + undo.
    expect(h.addToSessionImports).toHaveBeenCalledWith('contact', ['C-new'])
    expect(h.pushUndo).toHaveBeenCalledTimes(1)
  })

  it('CC2: a 409 duplicate MOVES the existing contact instead of refusing', async () => {
    // The create POST 409s; the backend hands back the existing contact id.
    createSpy.mockRejectedValue(new DuplicateContactError('C-existing'))
    updateContactSpy.mockResolvedValue({
      contact: makeContact({ id: 'C-existing', depth_top_m: 4 }),
      deletedContactIds: [],
    })
    // The existing contact must be in local state so the move can find its model.
    const existing = makeContact({ id: 'C-existing', formation_id: 'F1', depth_top_m: 1 })
    const h = renderHarness({ contacts: [existing] })

    await act(async () => {
      await h.result.current.handleCreateContact('borehole', 'BH1', 4, 'F1', false)
    })

    // The existing top is moved to the clicked depth — one top per formation.
    expect(updateContactSpy).toHaveBeenCalledTimes(1)
    const [pid, mid, cid, patch] = updateContactSpy.mock.calls[0]
    expect(pid).toBe('P1')
    expect(mid).toBe(MODEL_ID)
    expect(cid).toBe('C-existing')
    // The move lands the existing top at the CLICKED depth (4), not its old 1.
    expect(patch.depth_top_m).toBe(4)
    // The slot is visibly taken in local state, so the create is never sent
    // (walker finding 2026-10-12: a 409 prints a console error).
    expect(createSpy).not.toHaveBeenCalled()
    // The move itself is undoable, same as a direct depth drag.
    expect(h.pushUndo).toHaveBeenCalledTimes(1)
  })

  it('CC2-net: a 409 from a stale local list still MOVES the existing contact, no retry', async () => {
    // Local state does not show F1 on BH1 yet (stale list), so the POST goes
    // out; the backend 409s and hands back the existing id.
    createSpy.mockRejectedValue(new DuplicateContactError('C-existing'))
    updateContactSpy.mockResolvedValue({
      contact: makeContact({ id: 'C-existing', depth_top_m: 4 }),
      deletedContactIds: [],
    })
    const stale = makeContact({ id: 'C-existing', formation_id: 'F-before-refresh', depth_top_m: 1 })
    const h = renderHarness({ contacts: [stale] })

    await act(async () => {
      await h.result.current.handleCreateContact('borehole', 'BH1', 4, 'F1', false)
    })

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(updateContactSpy).toHaveBeenCalledTimes(1)
    expect(updateContactSpy.mock.calls[0][2]).toBe('C-existing')
    expect(updateContactSpy.mock.calls[0][3].depth_top_m).toBe(4)
  })

  it('CC3: snap flags — snapped=borehole_observation/high, free=manual_pick/medium', async () => {
    createSpy.mockResolvedValue(makeContact({ id: 'C-s' }))
    const h = renderHarness()

    await act(async () => {
      await h.result.current.handleCreateContact('borehole', 'BH1', 3, 'F1', true) // snapped
    })
    let payload = createSpy.mock.calls[0][2]
    expect(payload.source).toBe('borehole_observation')
    expect(payload.confidence).toBe('high')

    createSpy.mockClear()
    await act(async () => {
      await h.result.current.handleCreateContact('borehole', 'BH1', 3, 'F1', false) // free
    })
    payload = createSpy.mock.calls[0][2]
    expect(payload.source).toBe('manual_pick')
    expect(payload.confidence).toBe('medium')
  })

  it('CC4: a create on a section threads section_id into the payload', async () => {
    createSpy.mockResolvedValue(makeContact({ id: 'C-sec' }))
    const h = renderHarness()

    await act(async () => {
      await h.result.current.handleCreateContact('cpt', 'CPT9', 2, 'F1', false, 'S1')
    })
    const payload = createSpy.mock.calls[0][2]
    expect(payload.section_id).toBe('S1')
    // cpt anchor → cpt_id set, borehole_id null.
    expect(payload.cpt_id).toBe('CPT9')
    expect(payload.borehole_id).toBeNull()
  })

  it('CC5: a non-duplicate failure toasts and leaves no optimistic state', async () => {
    createSpy.mockRejectedValue(new Error('boom'))
    const h = renderHarness()

    await act(async () => {
      await h.result.current.handleCreateContact('borehole', 'BH1', 3, 'F1', false)
    })

    expect(h.toast).toHaveBeenCalledWith('error', expect.any(String))
    expect(h.setContacts).not.toHaveBeenCalled()
    expect(h.addToSessionImports).not.toHaveBeenCalled()
    expect(h.pushUndo).not.toHaveBeenCalled()
  })

  it('CC-undo-reapply: redo re-POSTs with a fresh server id; the next revert targets it', async () => {
    // The undo command captures the created id in a closure and overwrites it
    // on reapply — the re-POST gets a new server-assigned id. Without that
    // recapture, a redo-then-undo would delete the already-deleted original id.
    createSpy
      .mockResolvedValueOnce(makeContact({ id: 'C-original' }))
      .mockResolvedValueOnce(makeContact({ id: 'C-after-redo' }))
    deleteContactSpy.mockResolvedValue(undefined)
    const h = renderHarness()

    await act(async () => {
      await h.result.current.handleCreateContact('borehole', 'BH1', 3, 'F1', false)
    })
    const cmd = h.pushUndo.mock.calls[0][0] as UndoCommand

    // Revert deletes the original id.
    await act(async () => {
      await cmd.revert()
    })
    expect(deleteContactSpy).toHaveBeenCalledWith('P1', MODEL_ID, 'C-original')

    // Reapply re-creates → new server id.
    await act(async () => {
      await cmd.reapply()
    })
    expect(createSpy).toHaveBeenCalledTimes(2)

    // The SECOND revert must target the reapply's id, not the stale original.
    deleteContactSpy.mockClear()
    await act(async () => {
      await cmd.revert()
    })
    expect(deleteContactSpy).toHaveBeenCalledWith('P1', MODEL_ID, 'C-after-redo')
  })
})

// ---------------------------------------------------------------------------
// handleDeleteContact
// ---------------------------------------------------------------------------

describe('handleDeleteContact', () => {
  it('DEL1: a geological-axis delete routes to deleteContact + prunes + dirties + undo', async () => {
    deleteContactSpy.mockResolvedValue(undefined)
    const c = makeContact({ id: 'C-geo', model_id: MODEL_ID })
    const h = renderHarness({ contacts: [c] })

    await act(async () => {
      await h.result.current.handleDeleteContact('C-geo')
    })

    expect(deleteContactSpy).toHaveBeenCalledWith('P1', MODEL_ID, 'C-geo')
    expect(deleteLayerSpy).not.toHaveBeenCalled()
    // Prune from local state.
    const updater = h.setContacts.mock.calls.at(-1)?.[0] as (
      prev: FormationContactResponse[],
    ) => FormationContactResponse[]
    expect(updater([c]).some(x => x.id === 'C-geo')).toBe(false)
    expect(h.markMutated).toHaveBeenCalled()
    expect(h.pushUndo).toHaveBeenCalledTimes(1)
  })

  it('DEL2: a litho-axis delete routes to deleteLayer, not deleteContact (dogfeed 2026-05-22)', async () => {
    deleteLayerSpy.mockResolvedValue(undefined)
    const lithoContact = makeContact({ id: 'L-1', model_id: 'M-litho-9' })
    const lithoLayer = { id: 'L-1', model_id: 'M-litho-9' } as unknown as LithoLayerResponse
    const h = renderHarness({ lithoContacts: [lithoContact], lithoLayers: [lithoLayer] })

    await act(async () => {
      await h.result.current.handleDeleteContact('L-1')
    })

    expect(deleteLayerSpy).toHaveBeenCalledWith('P1', 'M-litho-9', 'L-1')
    expect(deleteContactSpy).not.toHaveBeenCalled()
    expect(h.refetchLithoContacts).toHaveBeenCalled()
    // A litho delete is a mutation of a pre-existing row → dirty + undoable.
    expect(h.markMutated).toHaveBeenCalled()
    expect(h.pushUndo).toHaveBeenCalledTimes(1)
  })

  it('DEL-failure: a delete API error toasts and leaves state untouched', async () => {
    deleteContactSpy.mockRejectedValue(new Error('network'))
    const c = makeContact({ id: 'C-geo' })
    const h = renderHarness({ contacts: [c] })

    await act(async () => {
      await h.result.current.handleDeleteContact('C-geo')
    })

    expect(h.toast).toHaveBeenCalledWith('error', expect.any(String))
    // setContacts prune + markMutated + undo are all AFTER the awaited delete,
    // so a failed delete must not touch any of them (no optimistic prune).
    expect(h.setContacts).not.toHaveBeenCalled()
    expect(h.markMutated).not.toHaveBeenCalled()
    expect(h.pushUndo).not.toHaveBeenCalled()
  })

  it('DEL-404: deleting a boundary the model no longer has removes it from the screen without an error', async () => {
    // Owner ruling (installer #20 dogfeed 2026-09-06): a cross-merge can delete
    // a boundary that still shows on the section; right-clicking → Delete on it
    // must drop it from the screen silently — a 404 means "already gone", not an
    // error toast.
    deleteContactSpy.mockRejectedValue(new ApiErrorMock('gone', 404))
    const c = makeContact({ id: 'C-gone' })
    const h = renderHarness({ contacts: [c] })

    await act(async () => {
      await h.result.current.handleDeleteContact('C-gone')
    })

    // No error toast — deleting an already-gone boundary is not a failure.
    expect(h.toast).not.toHaveBeenCalled()
    // The boundary is pruned from local state so it leaves the section.
    const updater = h.setContacts.mock.calls.at(-1)?.[0] as (
      prev: FormationContactResponse[],
    ) => FormationContactResponse[]
    expect(updater([c]).some(x => x.id === 'C-gone')).toBe(false)
  })

  it('DEL3: deleting an unknown id is a no-op', async () => {
    const h = renderHarness({ contacts: [makeContact({ id: 'C-known' })] })

    await act(async () => {
      await h.result.current.handleDeleteContact('C-nonexistent')
    })

    expect(deleteContactSpy).not.toHaveBeenCalled()
    expect(deleteLayerSpy).not.toHaveBeenCalled()
    expect(h.pushUndo).not.toHaveBeenCalled()
  })
})
