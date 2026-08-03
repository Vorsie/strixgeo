// The DOV import summary must not read green when a sub-phase failed.
//
// Audit 2026-08-02, Class 1: `import_borehole_dov` records a dead
// `interpretaties` WFS as `ImportInterpretationsDovResult(failed=N)` and keeps
// going. Those counters reached the renderer and the summary toast ignored
// them: 40 boreholes imported with every driller's log missing produced the
// same green toast as a clean run.
//
// The rule, in the rule's own words: the toast's severity comes from what
// FAILED, not from what was imported — an import with a failed sub-phase is
// not a success.

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BoreholeImportDonePayload, DovImportState } from './useDovImportStream'

// Mutable so each test can set the stream's terminal state before rendering.
let streamState: DovImportState = { status: 'idle' }
// Stable identities — a fresh function per render would re-fire every consumer
// callback that lists them as a dep and spin the render loop.
const streamStart = vi.fn()
const streamReset = vi.fn()

// No `importActual` here: useInvestigationData consumes only the hook from
// this module (everything else it takes is a type, which is erased), and
// pulling in the real module drags the SSE plumbing into a jsdom run.
vi.mock('./useDovImportStream', () => ({
  useDovImportStream: () => ({
    state: streamState,
    start: streamStart,
    reset: streamReset,
  }),
}))

vi.mock('../api/client', () => ({
  api: {
    review: { list: vi.fn().mockResolvedValue([]), upsert: vi.fn().mockResolvedValue(undefined) },
    cpt: { list: vi.fn().mockResolvedValue([]), get: vi.fn(), plot: vi.fn() },
    borehole: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
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

function boreholeResult(
  over: Partial<BoreholeImportDonePayload> = {},
): BoreholeImportDonePayload {
  return {
    imported: 40,
    duplicates: 0,
    failed: 0,
    borehole_ids: [],
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
    ...over,
  }
}

// Module-level so its identity is stable across renders: a fresh object per
// render re-fires every effect that lists ``project`` as a dep.
const PROJECT = { id: 'P1', name: 'Test' }

async function renderWithStream(state: DovImportState): Promise<ReturnType<typeof vi.fn>> {
  streamState = state
  const toast = vi.fn()
  renderHook(() =>
    useInvestigationData({
      project: PROJECT,
      ready: false,
      toast,
      pushUndo: vi.fn(),
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
  return toast
}

beforeEach(() => {
  vi.clearAllMocks()
  streamState = { status: 'idle' }
})

describe('useInvestigationData — DOVT1: a failed sub-phase is not a success', () => {
  it('warns, and says what did not arrive, when every interpretation failed', async () => {
    const toast = await renderWithStream({
      status: 'done',
      kind: 'borehole',
      result: boreholeResult({ interpretations_failed: 40 }),
    })

    expect(toast).toHaveBeenCalledTimes(1)
    const [severity, message] = toast.mock.calls[0]
    expect(severity).not.toBe('success')
    expect(message).toMatch(/40/)
    expect(message.toLowerCase()).toContain('observations')
  })

  it('stays a success toast when nothing failed', async () => {
    const toast = await renderWithStream({
      status: 'done',
      kind: 'borehole',
      result: boreholeResult({ interpretations_attached: 12 }),
    })

    expect(toast.mock.calls[0][0]).toBe('success')
  })
})
