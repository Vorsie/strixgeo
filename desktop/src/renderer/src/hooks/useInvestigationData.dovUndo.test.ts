// A DOV bbox import is undoable — Ctrl+Z removes the imported tests from the
// project, and it does so without ever deleting the DB rows.
//
// The rule, in the owner's words (dogfeed 2026-09-16): "ctrl z after bbox draw
// isn't working right now. they should be deleted from the project but you can
// keep em in DB." So one undo step is pushed when the import completes; its
// revert removes exactly the tests this box ADDED (the project-local hide the
// "Remove from project" verb uses — never a DELETE, so the import cache stays
// warm), and its reapply unhides the same ids.

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { DovImportState } from './useDovImportStream'
import type { UndoCommand } from './useUndoStack'

// Mutable so each test sets the stream's terminal state before rendering.
let streamState: DovImportState = { status: 'idle' }
const streamStart = vi.fn()
const streamReset = vi.fn()

vi.mock('./useDovImportStream', () => ({
  useDovImportStream: () => ({
    state: streamState,
    start: streamStart,
    reset: streamReset,
  }),
}))

// ``review.upsert`` is the hide / unhide path both revert and reapply drive.
// ``cpt.delete`` / ``borehole.delete`` exist ONLY so the "never deleted" test
// can assert they are never called — the product never references them.
const reviewUpsert = vi.fn().mockResolvedValue(undefined)
const cptDelete = vi.fn()
const boreholeDelete = vi.fn()

vi.mock('../api/client', () => ({
  api: {
    review: { list: vi.fn().mockResolvedValue([]), upsert: (...a: unknown[]) => reviewUpsert(...a) },
    cpt: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: 'C1' }),
      plot: vi.fn().mockResolvedValue({ cpt_id: 'C1', depths_m: [] }),
      delete: (...a: unknown[]) => cptDelete(...a),
    },
    borehole: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: 'B1' }),
      delete: (...a: unknown[]) => boreholeDelete(...a),
    },
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

import { useInvestigationData } from './useInvestigationData'

// Module-level so its identity is stable across renders (a fresh object per
// render re-fires every effect that lists ``project`` as a dep).
const PROJECT = { id: 'P1', name: 'Test' }

/**
 * Render the hook with the stream already at ``state`` and return the undo
 * commands the completion effect pushed (in order).
 */
async function renderWithStream(state: DovImportState): Promise<UndoCommand[]> {
  streamState = state
  const commands: UndoCommand[] = []
  renderHook(() =>
    useInvestigationData({
      project: PROJECT,
      ready: false,
      toast: vi.fn(),
      pushUndo: (cmd: UndoCommand) => commands.push(cmd),
      addToManifest: vi.fn(),
      setSessionImportCptIds: vi.fn(),
      setSessionImportBoreholeIds: vi.fn(),
      selectedId: null,
      setSelectedId: vi.fn(),
      selectedBoreholeId: null,
      setSelectedBoreholeId: vi.fn(),
      setView: vi.fn(),
    }),
  )
  // Flush the mount-time microtasks the same way the sibling suite does.
  await act(async () => {
    await Promise.resolve()
  })
  return commands
}

beforeEach(() => {
  vi.clearAllMocks()
  streamState = { status: 'idle' }
})

describe('useInvestigationData — DOV bbox import undo (installer #42)', () => {
  it('ctrl+z after a bbox import removes the imported tests from the project', async () => {
    const commands = await renderWithStream({
      status: 'done',
      kind: 'cpt',
      result: { imported: 2, duplicates: 0, failed: 0, cpt_ids: ['CPT-A', 'CPT-B'] },
    })

    expect(commands).toHaveLength(1)
    expect(commands[0].descriptionKey).toBe('undo.dovImport')

    reviewUpsert.mockClear()
    await act(async () => {
      await commands[0].revert()
    })

    // Each imported test is hidden from the project (is_hidden = true).
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'cpt', 'CPT-A', { is_hidden: true })
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'cpt', 'CPT-B', { is_hidden: true })
  })

  it('ctrl+y after that puts them back', async () => {
    const commands = await renderWithStream({
      status: 'done',
      kind: 'cpt',
      result: { imported: 2, duplicates: 0, failed: 0, cpt_ids: ['CPT-A', 'CPT-B'] },
    })

    await act(async () => {
      await commands[0].revert()
    })
    reviewUpsert.mockClear()
    await act(async () => {
      await commands[0].reapply()
    })

    // The same ids are unhidden (is_hidden = false).
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'cpt', 'CPT-A', { is_hidden: false })
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'cpt', 'CPT-B', { is_hidden: false })
  })

  it('the DB rows are never deleted', async () => {
    const commands = await renderWithStream({
      status: 'done',
      kind: 'cpt',
      result: { imported: 1, duplicates: 0, failed: 0, cpt_ids: ['CPT-A'] },
    })

    await act(async () => {
      await commands[0].revert()
    })

    // The revert hides through the review path; it never touches the DB rows.
    expect(cptDelete).not.toHaveBeenCalled()
    expect(boreholeDelete).not.toHaveBeenCalled()
    for (const call of reviewUpsert.mock.calls) {
      expect(call[3]).toEqual({ is_hidden: true })
    }
  })

  it('a box that added nothing pushes no undo step', async () => {
    const commands = await renderWithStream({
      status: 'done',
      kind: 'cpt',
      result: { imported: 0, duplicates: 0, failed: 0, cpt_ids: [] },
    })

    expect(commands).toHaveLength(0)
  })

  it('a borehole bbox import is undoable the same way', async () => {
    const commands = await renderWithStream({
      status: 'done',
      kind: 'borehole',
      result: {
        imported: 2,
        duplicates: 0,
        failed: 0,
        borehole_ids: ['BH-A', 'BH-B'],
        interpretations_attached: 0,
        interpretations_failed: 0,
        samples_attached: 0,
        samples_failed: 0,
        grain_sizes_attached: 0,
        grain_sizes_failed: 0,
        atterberg_attached: 0,
        atterberg_failed: 0,
        caco3_attached: 0,
        caco3_failed: 0,
        organic_attached: 0,
        organic_failed: 0,
        water_content_attached: 0,
        water_content_failed: 0,
        scalar_lab_tests_attached: 0,
        scalar_lab_tests_failed: 0,
      },
    })

    expect(commands).toHaveLength(1)
    reviewUpsert.mockClear()
    await act(async () => {
      await commands[0].revert()
    })
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'borehole', 'BH-A', { is_hidden: true })
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'borehole', 'BH-B', { is_hidden: true })
    expect(boreholeDelete).not.toHaveBeenCalled()
  })
})
