// Regression net for the cross-merge prune behaviour (installer #20 dogfeed,
// 2026-09-06). Pins the owner ruling in its own words:
//
//   "after a drag that crosses other boundaries, the crossed boundaries are
//    gone from the section at once, and deleting them again is never offered."
//
//   XM1  A geological drag-DOWN that absorbs the dragger removes the dragger
//        AND the peers the BE named from the section at once (no error), then
//        refetches to settle to DB truth.
//   XM2  A geological drag-UP that crosses peers removes those named peers from
//        the section at once; the surviving dragger stays.
//   XM3  A cross-column COPY whose 409 "stamp on target" move crosses peers
//        created earlier in the SAME batch does NOT leave those peers in local
//        state as phantoms — they never re-appear, and the batch refetches.
//
// Strategy: useContactCrud takes every dependency as a param — render it with
// vi.fn() spies + a mocked api.geology, drive the handlers, then fold every
// setContacts updater over a seed list to read the resulting on-screen state.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useContactCrud } from './useContactCrud'
import type {
  ContactCopyPayload,
} from '../components/sections/ContactsLayer'
import type {
  FormationContactResponse,
  GeologicalModelResponse,
  LithoLayerResponse,
  ProjectResponse,
} from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    geology: {
      createContact: vi.fn(),
      updateContact: vi.fn(),
      updateLayer: vi.fn(),
      moveLayerBoundary: vi.fn(),
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
  ApiError: class ApiError extends Error {},
  isApiStatus: () => false,
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
  refetchContacts: ReturnType<typeof vi.fn>
  pushUndo: ReturnType<typeof vi.fn>
  toast: ReturnType<typeof vi.fn>
  result: { current: ReturnType<typeof useContactCrud> }
}

function renderHarness(contacts: FormationContactResponse[] = []): Harness {
  const setContacts = vi.fn()
  const refetchContacts = vi.fn()
  const pushUndo = vi.fn()
  const toast = vi.fn()
  const { result } = renderHook(() =>
    useContactCrud({
      project: PROJECT,
      activeGeologicalModel: GEO_MODEL,
      contacts,
      setContacts,
      lithoContacts: [],
      lithoLayers: [] as LithoLayerResponse[],
      refetchContacts,
      refetchLithoContacts: vi.fn(),
      addToSessionImports: vi.fn(),
      pushUndo,
      markMutated: vi.fn(),
      toast,
    }),
  )
  return { setContacts, refetchContacts, pushUndo, toast, result }
}

/** Fold every setContacts updater (in call order) over a seed list. */
function finalState(
  setContacts: ReturnType<typeof vi.fn>,
  seed: FormationContactResponse[],
): FormationContactResponse[] {
  let state = seed
  for (const call of setContacts.mock.calls) {
    const updater = call[0] as (
      prev: FormationContactResponse[],
    ) => FormationContactResponse[]
    state = updater(state)
  }
  return state
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('cross-merge prune (installer #20 dogfeed)', () => {
  it('XM1: a drag-down that absorbs the dragger drops the dragger AND the named peers at once, no error', async () => {
    const dragger = makeContact({ id: 'C-dragger', depth_top_m: 1 })
    const peerA = makeContact({ id: 'C-peerA', formation_id: 'F2', depth_top_m: 5.5 })
    const peerB = makeContact({ id: 'C-peerB', formation_id: 'F3', depth_top_m: 6.5 })
    // Drag-down absorbed: contact = null, and the BE names the crossed peers.
    updateContactSpy.mockResolvedValue({
      contact: null,
      deletedContactIds: ['C-peerA', 'C-peerB'],
    })
    const h = renderHarness([dragger, peerA, peerB])

    await act(async () => {
      await h.result.current.handleUpdateContactDepth('C-dragger', 7.5, false)
    })

    // None of the three linger on the section.
    const state = finalState(h.setContacts, [dragger, peerA, peerB])
    expect(state.map(c => c.id)).toEqual([])
    // Reconciling refetch fired; no error toast (absorption is not a failure).
    expect(h.refetchContacts).toHaveBeenCalled()
    expect(h.toast).not.toHaveBeenCalledWith('error', expect.anything())
  })

  it('XM2: a drag-up that crosses peers drops those peers at once; the dragger stays', async () => {
    const dragger = makeContact({ id: 'C-dragger', depth_top_m: 10 })
    const peerA = makeContact({ id: 'C-peerA', formation_id: 'F2', depth_top_m: 5 })
    // Drag-up survivor: the dragger comes back, and the crossed peer is named.
    updateContactSpy.mockResolvedValue({
      contact: makeContact({ id: 'C-dragger', depth_top_m: 2 }),
      deletedContactIds: ['C-peerA'],
    })
    const h = renderHarness([dragger, peerA])

    await act(async () => {
      await h.result.current.handleUpdateContactDepth('C-dragger', 2, false)
    })

    const state = finalState(h.setContacts, [dragger, peerA])
    // The crossed peer is gone; the dragger survives.
    expect(state.some(c => c.id === 'C-peerA')).toBe(false)
    expect(state.some(c => c.id === 'C-dragger')).toBe(true)
    expect(h.refetchContacts).toHaveBeenCalled()
  })

  it('XM3: a COPY whose 409-move crosses same-batch peers leaves no phantom rows and refetches', async () => {
    // Four picks land on the target column: three distinct formations, plus a
    // fourth whose formation duplicates the first — the 409 "stamp on target"
    // move drags the first pick DOWN past the two middle ones, and the BE
    // absorbs it while deleting those two peers. None of the three may survive
    // in local state (the phantom-delete-404 bug), while the fourth pick does.
    const ee55 = makeContact({ id: 'ee55', formation_id: 'F-a', depth_top_m: 1 })
    const ee62 = makeContact({ id: 'ee62', formation_id: 'F-b', depth_top_m: 6.5 })
    const ee8c = makeContact({ id: 'ee8c', formation_id: 'F-c', depth_top_m: 5.5 })
    const ee99 = makeContact({ id: 'ee99', formation_id: 'F-d', depth_top_m: 8 })
    createSpy
      .mockResolvedValueOnce(ee55)
      .mockResolvedValueOnce(ee62)
      .mockResolvedValueOnce(ee8c)
      .mockResolvedValueOnce(ee99)
      .mockRejectedValueOnce(new DuplicateContactError('ee55'))
    // The 409-move of ee55 absorbs it and deletes ee62 + ee8c.
    updateContactSpy.mockResolvedValue({
      contact: null,
      deletedContactIds: ['ee62', 'ee8c'],
    })

    const h = renderHarness()
    const payload = (formation_id: string): ContactCopyPayload => ({
      formation_id,
      depth_top_m: 7.5,
      borehole_id: 'BH1',
      cpt_id: null,
      source: 'manual_pick',
      confidence: 'medium',
    })

    await act(async () => {
      await h.result.current.handleBatchCreateContacts([
        payload('F-a'),
        payload('F-b'),
        payload('F-c'),
        payload('F-d'),
        payload('F-a'), // collides with ee55 → 409 → cross-merge move
      ])
    })

    // Fold the optimistic setContacts updaters — the three cross-merged rows
    // must NOT be present; only the surviving fourth pick remains.
    const state = finalState(h.setContacts, [])
    const ids = state.map(c => c.id)
    expect(ids).not.toContain('ee55')
    expect(ids).not.toContain('ee62')
    expect(ids).not.toContain('ee8c')
    expect(ids).toContain('ee99')
    // The batch reconciles with DB truth after a cross-merge deletion.
    expect(h.refetchContacts).toHaveBeenCalled()
  })
})
