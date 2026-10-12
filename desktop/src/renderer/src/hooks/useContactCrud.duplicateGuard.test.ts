// Walker finding 2026-10-12 (seed 2586200527). A backend 409 always prints
// Chromium's "Failed to load resource: ... 409" console line, so the fix is to
// NOT send a POST the model already refuses. The rule (backend
// CreateFormationContact): one contact per formation per test.
//
//   DG1  A copy-drop onto a test that ALREADY carries the formation sends no
//        create request; the existing contact is stamped to the dropped depth
//        (the "stamp on target" semantic the 409 path already had).
//   DG2  A copy-drop onto a test WITHOUT the formation sends the create request.
//   DG3  A click-place of a formation the test already carries sends no create
//        request; the existing contact moves to the clicked depth.
//   DG4  Redo of "Copy 0 and move 1 contacts" re-creates nothing: the moved
//        contact is moved again, it is never re-posted (step 258).
//   DG5  Redo of a copy whose contact the test already carries again ("the
//        state moved on") sends no request and refuses as an expected
//        conflict (UndoConflictError), so the engine warns instead of erroring.
//   DG6  Redo of a single create whose formation the test carries again: same
//        expected conflict, no request.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useContactCrud } from './useContactCrud'
import { UndoConflictError } from './undoConflictError'
import type { UndoCommand } from './useUndoStack'
import type { ContactCopyPayload } from '../components/sections/ContactsLayer'
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
      deleteContact: vi.fn(),
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
const updateSpy = api.geology.updateContact as unknown as ReturnType<typeof vi.fn>
const deleteSpy = api.geology.deleteContact as unknown as ReturnType<typeof vi.fn>

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

function copyPayload(over: Partial<ContactCopyPayload> = {}): ContactCopyPayload {
  return {
    formation_id: 'F1',
    depth_top_m: 4,
    borehole_id: 'BH2',
    cpt_id: null,
    source: 'manual_pick',
    confidence: 'medium',
    ...over,
  }
}

function renderHarness(initial: FormationContactResponse[]) {
  const pushUndo = vi.fn()
  const toast = vi.fn()
  const hook = renderHook(
    ({ contacts }: { contacts: FormationContactResponse[] }) =>
      useContactCrud({
        project: PROJECT,
        activeGeologicalModel: GEO_MODEL,
        contacts,
        setContacts: vi.fn(),
        lithoContacts: [],
        lithoLayers: [] as LithoLayerResponse[],
        refetchContacts: vi.fn(),
        refetchLithoContacts: vi.fn(),
        addToSessionImports: vi.fn(),
        pushUndo,
        markMutated: vi.fn(),
        toast,
      }),
    { initialProps: { contacts: initial } },
  )
  return { ...hook, pushUndo, toast }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Reset (not just clear): an unconsumed mockRejectedValueOnce must not
  // leak into the next case.
  createSpy.mockReset()
  updateSpy.mockReset()
  deleteSpy.mockReset()
})

describe('a contact the test already carries is never re-posted', () => {
  it('DG1: copy onto a test that already carries the formation stamps the existing one, no create request', async () => {
    const existing = makeContact({ id: 'C-target', borehole_id: 'BH2', depth_top_m: 2 })
    updateSpy.mockResolvedValue({
      contact: { ...existing, depth_top_m: 4 },
      deletedContactIds: [],
    })
    // Pre-fix the POST went out and the backend refused it with 409.
    createSpy.mockRejectedValueOnce(new DuplicateContactError('C-target'))
    const h = renderHarness([existing])

    await act(async () => {
      await h.result.current.handleBatchCreateContacts([copyPayload()])
    })

    expect(createSpy).not.toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledWith('P1', MODEL_ID, 'C-target', {
      depth_top_m: 4,
      source: 'manual_pick',
      confidence: 'medium',
    })
    expect(h.toast).not.toHaveBeenCalledWith('error', expect.anything())
  })

  it('DG2: copy onto a test without the formation sends the create request', async () => {
    const other = makeContact({ id: 'C-src', borehole_id: 'BH1' })
    createSpy.mockResolvedValue(makeContact({ id: 'C-new', borehole_id: 'BH2', depth_top_m: 4 }))
    const h = renderHarness([other])

    await act(async () => {
      await h.result.current.handleBatchCreateContacts([copyPayload()])
    })

    expect(createSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('DG3: click-place of a formation the test already carries moves it, no create request', async () => {
    const existing = makeContact({ id: 'C-target', borehole_id: 'BH2', depth_top_m: 2 })
    updateSpy.mockResolvedValue({
      contact: { ...existing, depth_top_m: 5 },
      deletedContactIds: [],
    })
    createSpy.mockRejectedValueOnce(new DuplicateContactError('C-target'))
    const h = renderHarness([existing])

    await act(async () => {
      await h.result.current.handleCreateContact('borehole', 'BH2', 5, 'F1', false)
    })

    expect(createSpy).not.toHaveBeenCalled()
    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.mock.calls[0][2]).toBe('C-target')
  })

  it('DG4: redo of "copy 0 and move 1" moves the contact again and re-posts nothing', async () => {
    const existing = makeContact({ id: 'C-target', borehole_id: 'BH2', depth_top_m: 2 })
    updateSpy.mockImplementation(
      async (_p: string, _m: string, id: string, body: { depth_top_m: number }) => ({
        contact: { ...existing, id, depth_top_m: body.depth_top_m },
        deletedContactIds: [],
      }),
    )
    // Should a POST still go out (a stale local list), the backend answers
    // 409 and the batch stamps the existing contact: DG4 pins the redo, not
    // how the first drop found the target.
    createSpy.mockRejectedValueOnce(new DuplicateContactError('C-target'))
    const h = renderHarness([existing])
    await act(async () => {
      await h.result.current.handleBatchCreateContacts([copyPayload()])
    })
    const cmd = h.pushUndo.mock.calls[0][0] as UndoCommand
    expect(cmd.descriptionKey).toBe('undo.copyMoveContacts')

    await act(async () => {
      await cmd.revert()
    })
    // Still carries the formation (the revert moved it back, it did not delete it).
    h.rerender({ contacts: [existing] })
    createSpy.mockClear()
    await act(async () => {
      await cmd.reapply()
    })

    expect(createSpy).not.toHaveBeenCalled()
    expect(updateSpy).toHaveBeenLastCalledWith('P1', MODEL_ID, 'C-target', {
      depth_top_m: 4,
      source: 'manual_pick',
      confidence: 'medium',
    })
  })

  it('DG5: redo of a copy whose contact the test carries again refuses as an expected conflict, no request', async () => {
    const created = makeContact({ id: 'C-new', borehole_id: 'BH2', depth_top_m: 4 })
    createSpy.mockResolvedValue(created)
    deleteSpy.mockResolvedValue(undefined)
    const h = renderHarness([])
    await act(async () => {
      await h.result.current.handleBatchCreateContacts([copyPayload()])
    })
    const cmd = h.pushUndo.mock.calls[0][0] as UndoCommand
    await act(async () => {
      await cmd.revert()
    })
    // The state moved on: something else put F1 on BH2 again.
    h.rerender({ contacts: [makeContact({ id: 'C-other', borehole_id: 'BH2' })] })
    createSpy.mockClear()

    await expect(cmd.reapply()).rejects.toBeInstanceOf(UndoConflictError)
    expect(createSpy).not.toHaveBeenCalled()
  })

  it('DG6: redo of a single create whose formation the test carries again refuses, no request', async () => {
    createSpy.mockResolvedValue(makeContact({ id: 'C-new', borehole_id: 'BH2', depth_top_m: 5 }))
    deleteSpy.mockResolvedValue(undefined)
    const h = renderHarness([])
    await act(async () => {
      await h.result.current.handleCreateContact('borehole', 'BH2', 5, 'F1', false)
    })
    const cmd = h.pushUndo.mock.calls[0][0] as UndoCommand
    await act(async () => {
      await cmd.revert()
    })
    h.rerender({ contacts: [makeContact({ id: 'C-other', borehole_id: 'BH2' })] })
    createSpy.mockClear()

    await expect(cmd.reapply()).rejects.toBeInstanceOf(UndoConflictError)
    expect(createSpy).not.toHaveBeenCalled()
  })
})
