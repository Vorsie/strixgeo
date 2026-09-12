/**
 * useProjectBodyRecompute.test.ts — the shell-level PROJECT-OPEN recompute trigger
 * + nonce watch (owner ruling 2026-08-12: the initial body recompute fires on
 * project open, stage-independent, once per model per open).
 *
 * Behavior-shaped cases in the rule's vocabulary:
 *
 *   * data loaded at open → ONE background recompute for the litho model and ONE
 *     for the geotech model, and no repeat while the project stays open;
 *   * data loading LATE → the trigger fires when the gate OPENS; it is never
 *     consumed early (the 2026-08-12 defect: the stage-entry trigger could be
 *     marked done before its data-loaded gate opened, so the litho model never
 *     recomputed);
 *   * project switch → fires again for the new project's models; REOPENING the
 *     same project fires again (the once-markers reset on switch/close);
 *   * a project with no litho model never fires a litho recompute;
 *   * a coordinator nonce bump schedules a recompute even after the open trigger
 *     consumed its marker (the edit-time channel stays live).
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../api/client'
import { assembleBodyRecomputePayload } from '../shell/stages/shared/makeBodyRecomputeBuilder'
import type { LithoLayerLike } from '../utils/assembleLithoSectionInputs'
import { BODY_RECOMPUTE_DEBOUNCE_MS, BODY_RECOMPUTE_MAX_LATENCY_MS } from './useBodyRecompute'
import {
  useProjectBodyRecompute,
  sectionsDividePartitionCallback,
  type UseProjectBodyRecomputeArgs,
} from './useProjectBodyRecompute'

vi.mock('../api/client', () => ({
  api: { geology: { recomputeBodies: vi.fn() } },
}))
vi.mock('../shell/stages/shared/makeBodyRecomputeBuilder', () => ({
  assembleBodyRecomputePayload: vi.fn(),
}))

const recomputeBodies = vi.mocked(api.geology.recomputeBodies)
const assemble = vi.mocked(assembleBodyRecomputePayload)

const SECTION = {
  id: 's1',
  start_x: 0,
  start_y: 0,
  end_x: 40,
  end_y: 0,
  projection_buffer_m: 10,
}

function layer(id: string): LithoLayerLike {
  return {
    id,
    cpt_id: 'C1',
    borehole_id: null,
    formation_id: 'sand',
    body_id: null,
    depth_top_m: 0,
    depth_base_m: 5,
    status: 'accepted',
  }
}

const LITHO_LAYERS = [layer('ll-1')]
const GEOTECH_LAYERS = [layer('gl-1')]

/** Default args: project open, both models present, all data loaded. */
function args(over: Partial<UseProjectBodyRecomputeArgs> = {}): UseProjectBodyRecomputeArgs {
  return {
    projectId: 'p1',
    visibleSections: [SECTION],
    visibleCpts: [{ id: 'C1', location_x: 0, location_y: 0, elevation_m: 10 }],
    visibleBoreholes: [],
    lithoModelId: 'L1',
    lithoLayers: LITHO_LAYERS,
    geotechModelId: 'G1',
    geotechLayers: GEOTECH_LAYERS,
    geotechLayersLoaded: true,
    geotechFormations: [],
    bodyRecomputeLithoNonce: 0,
    bodyRecomputeGeotechNonce: 0,
    toast: vi.fn(),
    ...over,
  }
}

/** The model ids recomputeBodies was POSTed for, in call order. */
function postedModels(): string[] {
  return recomputeBodies.mock.calls.map(c => c[1] as string)
}

async function drainDebounce(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_MAX_LATENCY_MS)
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  recomputeBodies.mockReset()
  recomputeBodies.mockResolvedValue({
    facts_written: 0,
    facts_dropped_stale: 0,
    bodies_merged: 0,
    bodies_split: 0,
    renamed: [],
  })
  assemble.mockReset()
  // A minimal non-empty payload; the assembly itself is pinned elsewhere
  // (makeBodyRecomputeBuilder.test.ts).
  assemble.mockResolvedValue({
    sections: [{ start_x: 0, start_y: 0, end_x: 1, end_y: 0, columns: [], regions: [] }],
    section_ids: ['s-1'],
    layer_groups: [[]],
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useProjectBodyRecompute — project-open trigger', () => {
  it('data loaded at open → exactly one recompute per model, no repeat while open', async () => {
    const { rerender } = renderHook((p: UseProjectBodyRecomputeArgs) => useProjectBodyRecompute(p), {
      initialProps: args(),
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(postedModels().sort()).toEqual(['G1', 'L1'])
    // The litho fire assembled from the LITHO snapshot, the geotech from the geotech one.
    const byModel = new Map(assemble.mock.calls.map(c => [c[0].modelId, c[0].layers]))
    expect(byModel.get('L1')).toBe(LITHO_LAYERS)
    expect(byModel.get('G1')).toBe(GEOTECH_LAYERS)
    // Re-render + time: once per project-open means ONCE.
    rerender(args())
    await drainDebounce()
    expect(recomputeBodies).toHaveBeenCalledTimes(2)
  })

  it('data loading LATE → the trigger fires when the gate opens, never consumed early', async () => {
    // Gate closed at mount: no sections projected yet, no layers loaded.
    const closed = args({
      visibleSections: [],
      lithoLayers: [],
      geotechLayers: [],
      geotechLayersLoaded: false,
    })
    const { rerender } = renderHook((p: UseProjectBodyRecomputeArgs) => useProjectBodyRecompute(p), {
      initialProps: closed,
    })
    await drainDebounce()
    expect(recomputeBodies).not.toHaveBeenCalled()
    // The gate OPENS (project data finished loading) → BOTH models recompute, once each.
    rerender(args())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(postedModels().sort()).toEqual(['G1', 'L1'])
    rerender(args())
    await drainDebounce()
    expect(recomputeBodies).toHaveBeenCalledTimes(2)
  })

  it('project switch fires for the new project; reopening the same project fires again', async () => {
    const { rerender } = renderHook((p: UseProjectBodyRecomputeArgs) => useProjectBodyRecompute(p), {
      initialProps: args(),
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(recomputeBodies).toHaveBeenCalledTimes(2)
    // Switch to another project (its own models).
    rerender(args({ projectId: 'p2', lithoModelId: 'L2', geotechModelId: 'G2' }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(postedModels().slice(2).sort()).toEqual(['G2', 'L2'])
    // Close (null) then REOPEN p1: the once-markers were reset, so it fires again.
    rerender(args({ projectId: null, visibleSections: [], lithoLayers: [], geotechLayers: [] }))
    rerender(args())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(postedModels().slice(4).sort()).toEqual(['G1', 'L1'])
  })

  it('a project with no litho model never fires a litho recompute', async () => {
    renderHook((p: UseProjectBodyRecomputeArgs) => useProjectBodyRecompute(p), {
      initialProps: args({ lithoModelId: null, lithoLayers: [] }),
    })
    await drainDebounce()
    expect(postedModels()).toEqual(['G1'])
  })

  it('the geotech recompute defers until the litho frame layers load (R6, #278)', async () => {
    // The geotech identity is the framed picture, so it NEEDS the litho frame.
    // Geotech data ready, a litho model present but its layers not loaded yet →
    // the geotech recompute waits rather than framing on an empty litho model.
    const lithoPending = args({ lithoLayers: [] })
    const { rerender } = renderHook(
      (p: UseProjectBodyRecomputeArgs) => useProjectBodyRecompute(p),
      { initialProps: lithoPending },
    )
    await drainDebounce()
    // Litho has no layers yet (so it cannot fire) and geotech waits for the frame.
    expect(postedModels()).toEqual([])
    // The frame loads → both models recompute, once each.
    rerender(args())
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(postedModels().sort()).toEqual(['G1', 'L1'])
  })

  it('a coordinator nonce bump schedules a recompute after the open trigger already ran', async () => {
    const { rerender } = renderHook((p: UseProjectBodyRecomputeArgs) => useProjectBodyRecompute(p), {
      initialProps: args(),
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(recomputeBodies).toHaveBeenCalledTimes(2)
    // An edit-time mutation bumps the litho nonce → one more litho recompute.
    rerender(args({ bodyRecomputeLithoNonce: 1 }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(recomputeBodies).toHaveBeenCalledTimes(3)
    expect(postedModels()[2]).toBe('L1')
  })
})

// ---------------------------------------------------------------------------
// Module-ref cleanup on unmount (debt #276)
//
// The toolbar-bridge refs (Recompute / Divide) are written every render while
// the shell hook is mounted. Debt #276: they were never nulled on unmount, so
// "a toolbar click that fires after the [shell] unmounted [ran] against a
// destroyed view". They must be nulled on unmount, GUARDED so an older hook
// instance cannot wipe a ref a newer instance already claimed.
// ---------------------------------------------------------------------------

describe('useProjectBodyRecompute module-ref cleanup on unmount (#276)', () => {
  // R1 — the Divide ref is null after the hook unmounts. (The Recompute bridge
  // was removed with the manual verb — owner ruling 6, 2026-09-12 — so only the
  // Divide-partition bridge remains.)
  it('R1 — the Divide ref is null after the hook unmounts', () => {
    const { unmount } = renderHook(
      (p: UseProjectBodyRecomputeArgs) => useProjectBodyRecompute(p),
      { initialProps: args() },
    )
    expect(sectionsDividePartitionCallback.current).not.toBeNull()
    unmount()
    expect(sectionsDividePartitionCallback.current).toBeNull()
  })

  // R2 — the mount-order guard. Mount A, mount B, unmount A → the ref must
  // still hold B's callback (a different projectId gives B a distinct
  // useCallback identity).
  it('R2 — an older hook unmount does not wipe a ref the newer hook claimed', () => {
    const a = renderHook(
      (p: UseProjectBodyRecomputeArgs) => useProjectBodyRecompute(p),
      { initialProps: args() },
    )
    const aDivide = sectionsDividePartitionCallback.current
    const b = renderHook(
      (p: UseProjectBodyRecomputeArgs) => useProjectBodyRecompute(p),
      { initialProps: args({ projectId: 'p2' }) },
    )
    const bDivide = sectionsDividePartitionCallback.current
    expect(bDivide).not.toBe(aDivide)
    a.unmount()
    expect(sectionsDividePartitionCallback.current).toBe(bDivide)
    b.unmount()
    expect(sectionsDividePartitionCallback.current).toBeNull()
  })
})
