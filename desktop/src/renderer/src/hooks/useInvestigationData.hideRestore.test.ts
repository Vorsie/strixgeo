// Behavioural net for useInvestigationData's hide/restore + lazy-load paths.
// Pins invariants tied to documented product rules + dogfeed memory:
//
//   REM1  (project_no_db_delete_on_rollback / sidebar_ux) "Remove" is a
//         PROJECT-LOCAL HIDE — it flips the review is_hidden flag via
//         api.review.upsert, it NEVER deletes the investigation from the DB.
//         (A DB delete would force a re-fetch on re-import and lose the cache.)
//   REM2  Removing the currently-selected investigation deselects it and
//         navigates back to the map (nothing left to show in the chart pane).
//   REM3  Removing a non-selected investigation leaves selection + view alone.
//   REM4  Removing an empty list is a no-op (no upserts, no navigation).
//   RES1  "Restore all" un-hides every removed id (is_hidden=false upserts).
//   Load  loadChart fetches once per id (cache-dedup), stays inside the active
//         project scope, and an error is non-fatal (toast, no throw).
//
// Strategy: useInvestigationData takes selection + navigation as injected
// params; the hide-set is internal useState observed through its api.review
// side-effects. Render with vi.fn() spies + a mocked api, drive the handlers,
// assert on the review-upsert calls (the hide mechanism) and the selection /
// view setters.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useInvestigationData } from './useInvestigationData'

// ---------------------------------------------------------------------------
// Module mocks — api + log
// ---------------------------------------------------------------------------

vi.mock('../api/client', () => ({
  api: {
    review: {
      list: vi.fn().mockResolvedValue([]),
      upsert: vi.fn().mockResolvedValue(undefined),
    },
    cpt: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: 'c', depth_top_m: 0 }),
      plot: vi.fn().mockResolvedValue({ id: 'c', series: [] }),
    },
    borehole: {
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn().mockResolvedValue({ id: 'b' }),
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

import { api } from '../api/client'

const PROJECT = { id: 'P1', name: 'Test' }

const reviewUpsert = api.review.upsert as unknown as ReturnType<typeof vi.fn>
const cptPlot = api.cpt.plot as unknown as ReturnType<typeof vi.fn>

interface Harness {
  setSelectedId: ReturnType<typeof vi.fn>
  setSelectedBoreholeId: ReturnType<typeof vi.fn>
  setView: ReturnType<typeof vi.fn>
  toast: ReturnType<typeof vi.fn>
  result: { current: ReturnType<typeof useInvestigationData> }
}

function renderHarness(
  over: {
    project?: { id: string; name: string } | null
    selectedId?: string | null
    selectedBoreholeId?: string | null
  } = {},
): Harness {
  const setSelectedId = vi.fn()
  const setSelectedBoreholeId = vi.fn()
  const setView = vi.fn()
  const toast = vi.fn()
  const { result } = renderHook(() =>
    useInvestigationData({
      // `ready: false` suppresses the auto-load list effect — we drive the
      // handlers under test directly.
      project: 'project' in over ? over.project! : PROJECT,
      ready: false,
      toast,
      pushUndo: vi.fn(),
      addToManifest: vi.fn(),
      setSessionImportCptIds: vi.fn(),
      setSessionImportBoreholeIds: vi.fn(),
      selectedId: over.selectedId ?? null,
      setSelectedId,
      selectedBoreholeId: over.selectedBoreholeId ?? null,
      setSelectedBoreholeId,
      setView,
    }),
  )
  return { setSelectedId, setSelectedBoreholeId, setView, toast, result }
}

/** Flush the mount-time hidden-set reload microtask so no act() warning fires. */
async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  // Restore default resolved values cleared by clearAllMocks.
  ;(api.review.list as ReturnType<typeof vi.fn>).mockResolvedValue([])
  reviewUpsert.mockResolvedValue(undefined)
  cptPlot.mockResolvedValue({ id: 'c', series: [] })
})

// ---------------------------------------------------------------------------
// Hide (remove) — the project-local hide invariant
// ---------------------------------------------------------------------------

describe('handleRemoveCpts — remove is a hide, never a DB delete', () => {
  it('REM1: flips is_hidden=true via review.upsert for every id (no delete)', async () => {
    const h = renderHarness()
    await flush()
    reviewUpsert.mockClear()

    act(() => {
      h.result.current.handleRemoveCpts(['a', 'b'])
    })
    await flush()

    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'cpt', 'a', { is_hidden: true })
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'cpt', 'b', { is_hidden: true })
    expect(reviewUpsert).toHaveBeenCalledTimes(2)
    // The no-delete invariant: the hide mechanism is the review flag, NOT row
    // removal — a DB delete would break re-import cache warmth (memory:
    // project_no_db_delete_on_rollback).
    // Local removed-set updated too (not just the API side-effect).
    expect(h.result.current.removedCptIds.has('a')).toBe(true)
    expect(h.result.current.removedCptIds.has('b')).toBe(true)
  })

  it('REM2: removing the SELECTED cpt deselects it and returns to the map', async () => {
    const h = renderHarness({ selectedId: 'a' })
    await flush()

    act(() => {
      h.result.current.handleRemoveCpts(['a', 'b'])
    })

    expect(h.setSelectedId).toHaveBeenCalledWith(null)
    expect(h.setView).toHaveBeenCalledWith('map')
  })

  it('REM3: removing a NON-selected cpt leaves selection + view untouched', async () => {
    const h = renderHarness({ selectedId: 'z' })
    await flush()

    act(() => {
      h.result.current.handleRemoveCpts(['a', 'b'])
    })

    expect(h.setSelectedId).not.toHaveBeenCalled()
    expect(h.setView).not.toHaveBeenCalled()
  })

  it('REM4: removing an empty list is a no-op', async () => {
    const h = renderHarness({ selectedId: 'a' })
    await flush()
    reviewUpsert.mockClear()

    act(() => {
      h.result.current.handleRemoveCpts([])
    })
    await flush()

    expect(reviewUpsert).not.toHaveBeenCalled()
    expect(h.setSelectedId).not.toHaveBeenCalled()
  })
})

describe('handleRemoveBoreholes — mirror of the CPT hide path', () => {
  it('REM1-BH: flips is_hidden=true via review.upsert for every borehole id', async () => {
    const h = renderHarness()
    await flush()
    reviewUpsert.mockClear()

    act(() => {
      h.result.current.handleRemoveBoreholes(['bh1'])
    })
    await flush()

    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'borehole', 'bh1', { is_hidden: true })
    expect(h.result.current.removedBoreholeIds.has('bh1')).toBe(true)
  })

  it('REM2-BH: removing the SELECTED borehole deselects it and returns to the map', async () => {
    const h = renderHarness({ selectedBoreholeId: 'bh1' })
    await flush()

    act(() => {
      h.result.current.handleRemoveBoreholes(['bh1'])
    })

    expect(h.setSelectedBoreholeId).toHaveBeenCalledWith(null)
    expect(h.setView).toHaveBeenCalledWith('map')
  })

  it('REM4-BH: removing an empty borehole list is a no-op', async () => {
    const h = renderHarness({ selectedBoreholeId: 'bh1' })
    await flush()
    reviewUpsert.mockClear()

    act(() => {
      h.result.current.handleRemoveBoreholes([])
    })
    await flush()

    expect(reviewUpsert).not.toHaveBeenCalled()
    expect(h.setSelectedBoreholeId).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Server-seeded hidden-set — the .gmproj round-trip invariant
// ---------------------------------------------------------------------------

describe('mount-time hidden-set reload', () => {
  it('RS_SEED: server is_hidden=true rows populate the removed-set (kind-discriminated)', async () => {
    ;(api.review.list as ReturnType<typeof vi.fn>).mockResolvedValue([
      { target_kind: 'cpt', target_id: 'c-hidden', is_hidden: true },
      { target_kind: 'cpt', target_id: 'c-visible', is_hidden: false },
      { target_kind: 'borehole', target_id: 'bh-hidden', is_hidden: true },
    ])
    const h = renderHarness()
    await flush()

    expect(h.result.current.removedCptIds.has('c-hidden')).toBe(true)
    expect(h.result.current.removedCptIds.has('c-visible')).toBe(false)
    expect(h.result.current.removedBoreholeIds.has('bh-hidden')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

describe('handleRestoreAllCpts', () => {
  it('RES1: un-hides every previously-removed id (is_hidden=false upserts)', async () => {
    const h = renderHarness()
    await flush()

    // Hide two, then restore all.
    act(() => {
      h.result.current.handleRemoveCpts(['a', 'b'])
    })
    await flush()
    reviewUpsert.mockClear()

    act(() => {
      h.result.current.handleRestoreAllCpts()
    })
    await flush()

    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'cpt', 'a', { is_hidden: false })
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'cpt', 'b', { is_hidden: false })
  })
})

describe('handleRestoreAllBoreholes', () => {
  it('RES1-BH: un-hides every previously-removed borehole id (is_hidden=false upserts)', async () => {
    const h = renderHarness()
    await flush()

    act(() => {
      h.result.current.handleRemoveBoreholes(['bh1', 'bh2'])
    })
    await flush()
    reviewUpsert.mockClear()

    act(() => {
      h.result.current.handleRestoreAllBoreholes()
    })
    await flush()

    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'borehole', 'bh1', { is_hidden: false })
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'borehole', 'bh2', { is_hidden: false })
    expect(reviewUpsert).toHaveBeenCalledTimes(2)
    expect(h.result.current.removedBoreholeIds.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Un-hide — the 409-re-import re-visibility path
// ---------------------------------------------------------------------------

describe('unhideCpts — 409 re-import visibility', () => {
  it('UNHIDE1: an id in the removed-set is cleared locally and un-hidden via upsert', async () => {
    const h = renderHarness()
    await flush()
    act(() => {
      h.result.current.handleRemoveCpts(['a'])
    })
    await flush()
    reviewUpsert.mockClear()

    act(() => {
      h.result.current.unhideCpts(['a'])
    })
    await flush()

    expect(h.result.current.removedCptIds.has('a')).toBe(false)
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'cpt', 'a', { is_hidden: false })
    expect(reviewUpsert).toHaveBeenCalledTimes(1)
  })

  it('UNHIDE2: an id that was never hidden triggers no upsert (no spurious un-hide)', async () => {
    const h = renderHarness()
    await flush()
    reviewUpsert.mockClear()

    act(() => {
      h.result.current.unhideCpts(['z'])
    })
    await flush()

    expect(reviewUpsert).not.toHaveBeenCalled()
  })

  it('UNHIDE3-BH: unhideBoreholes flips is_hidden=false for a previously-hidden id', async () => {
    // Mirror of UNHIDE1 for the borehole handler — both shared the deferred-
    // updater bug where the server unhide upsert silently never fired.
    const h = renderHarness()
    await flush()
    act(() => {
      h.result.current.handleRemoveBoreholes(['bh1'])
    })
    await flush()
    reviewUpsert.mockClear()

    act(() => {
      h.result.current.unhideBoreholes(['bh1'])
    })
    await flush()

    expect(h.result.current.removedBoreholeIds.has('bh1')).toBe(false)
    expect(reviewUpsert).toHaveBeenCalledWith('P1', 'borehole', 'bh1', { is_hidden: false })
    expect(reviewUpsert).toHaveBeenCalledTimes(1)
  })
})

// ---------------------------------------------------------------------------
// Lazy chart load — cache dedup, scope, non-fatal error
// ---------------------------------------------------------------------------

describe('loadChart', () => {
  it('LC1: fetches the plot for the id within the active project scope', async () => {
    const h = renderHarness()
    await flush()

    await act(async () => {
      await h.result.current.loadChart('c1')
    })

    expect(cptPlot).toHaveBeenCalledWith('c1', 'P1')
  })

  it('LC2: a second load of the same id is served from cache (fetched once)', async () => {
    const h = renderHarness()
    await flush()

    await act(async () => {
      await h.result.current.loadChart('c1')
    })
    // Second call sees the cached plot and short-circuits.
    await act(async () => {
      await h.result.current.loadChart('c1')
    })

    expect(cptPlot).toHaveBeenCalledTimes(1)
  })

  it('LC3: a fetch error is non-fatal — toasts, does not throw', async () => {
    cptPlot.mockRejectedValueOnce(new Error('network'))
    const h = renderHarness()
    await flush()

    await act(async () => {
      await h.result.current.loadChart('c1')
    })

    expect(h.toast).toHaveBeenCalledWith('error', expect.any(String))
  })

  it('LC4: with no active project the load is skipped (no fetch)', async () => {
    const h = renderHarness({ project: null })
    await flush()

    await act(async () => {
      await h.result.current.loadChart('c1')
    })

    expect(cptPlot).not.toHaveBeenCalled()
  })
})
