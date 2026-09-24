// Behavioural net for useBoundaryDrag — the mousedown→mousemove→mouseup
// commit lifecycle. Pins invariants tied to real dogfeed fixes, phrased in
// the fix's own vocabulary:
//
//   BD1  A plain drag of a layer's BASE edge commits onEdit({depth_base_m})
//        at the released depth; symmetric BD6 for the TOP edge.
//   BD2  (zero-thickness auto-reject — fix A, dogfeed 2026-05-30) A drag that
//        collapses the layer onto its own opposite edge REJECTS the layer
//        (onReject) instead of committing a zero-thickness depth edit — the
//        stale-zombie-that-freezes-the-next-drag bug.
//   BD3  mouseup always clears the live drag state (drag → null).
//   BD4  startDrag seeds the live drag state at the initial depth, un-snapped.
//   BD5  Dragging past a bound clamps/snaps the live depth to that bound (the
//        dragged edge physically cannot cross a neighbour's boundary).
//
// Strategy: useBoundaryDrag attaches its move/up handlers to `document` via a
// useEffect keyed on the drag state. We render it, call startDrag (which sets
// the state → the effect attaches the listeners), then dispatch real
// document MouseEvents — each in its own act() so React re-renders and the
// re-attached handler closes over the updated drag before mouseup fires.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBoundaryDrag } from './useBoundaryDrag'
import type { UseBoundaryDragParams, BoundaryDragStart } from './useBoundaryDrag'
import type { LithoLayerSuggestion } from '../api/client'

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

const PX_PER_M = 100 // 100 screen px per metre → 1 m = 100 px of clientY delta
const INITIAL_CLIENT_Y = 500

/** A segmenter suggestion with the depth fields the drag math reads. */
function makeSuggestion(over: Partial<LithoLayerSuggestion> = {}): LithoLayerSuggestion {
  return {
    depth_top_m: 0,
    depth_base_m: 4,
    suggested_lithology: 'ZAND',
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'medium',
    source: 'segmenter',
    suggested_admixtures: [],
    parent_formation_id: null,
    ...over,
  } as LithoLayerSuggestion
}

interface Harness {
  onEdit: ReturnType<typeof vi.fn>
  onReject: ReturnType<typeof vi.fn>
  onMergeLayers: ReturnType<typeof vi.fn>
  result: { current: ReturnType<typeof useBoundaryDrag> }
}

function renderHarness(over: Partial<UseBoundaryDragParams> = {}): Harness {
  const onEdit = vi.fn()
  const onReject = vi.fn()
  const onMergeLayers = vi.fn()
  const { result } = renderHook(() =>
    useBoundaryDrag({
      pxPerM: PX_PER_M,
      suggestions: [makeSuggestion()],
      edits: undefined,
      acceptedIndices: new Set<number>(),
      effectivelyRejectedIndices: new Set<number>(),
      onEdit,
      onReject,
      onMergeLayers,
      ...over,
    }),
  )
  return { onEdit, onReject, onMergeLayers, result }
}

/** Begin a drag; the effect attaches the document listeners on the re-render. */
function startDrag(h: Harness, start: Partial<BoundaryDragStart> & Pick<BoundaryDragStart, 'idx' | 'edge' | 'initialDepthM'>): void {
  act(() => {
    h.result.current.startDrag({
      initialClientY: INITIAL_CLIENT_Y,
      boundsAboveM: 0,
      boundsBelowM: 10,
      collapseChainAbove: [],
      collapseChainBelow: [],
      ...start,
    })
  })
}

/** Move the cursor to the depth that maps to `depthM` given PX_PER_M. */
function moveToDepth(depthM: number, initialDepthM: number): void {
  const clientY = INITIAL_CLIENT_Y + (depthM - initialDepthM) * PX_PER_M
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { clientY, bubbles: true }))
  })
}

function releaseMouse(): void {
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------

describe('useBoundaryDrag lifecycle', () => {
  it('BD4: startDrag seeds the live drag state at the initial depth, un-snapped', () => {
    const h = renderHarness()
    startDrag(h, { idx: 0, edge: 'base', initialDepthM: 4 })

    expect(h.result.current.drag).not.toBeNull()
    expect(h.result.current.drag?.idx).toBe(0)
    expect(h.result.current.drag?.edge).toBe('base')
    expect(h.result.current.drag?.currentDepthM).toBe(4)
    expect(h.result.current.drag?.snapped).toBe(false)
  })

  it('BD1: a plain base-edge drag commits onEdit({depth_base_m}) at the released depth', () => {
    // Single layer top=0 base=4. Drag the base up to 3 m (still well inside).
    const h = renderHarness({ suggestions: [makeSuggestion({ depth_top_m: 0, depth_base_m: 4 })] })
    startDrag(h, { idx: 0, edge: 'base', initialDepthM: 4 })
    moveToDepth(3, 4)
    releaseMouse()

    expect(h.onEdit).toHaveBeenCalledWith(0, { depth_base_m: 3 })
    expect(h.onReject).not.toHaveBeenCalled()
  })

  it('BD6: a plain top-edge drag commits onEdit({depth_top_m}) at the released depth', () => {
    const h = renderHarness({ suggestions: [makeSuggestion({ depth_top_m: 2, depth_base_m: 6 })] })
    startDrag(h, { idx: 0, edge: 'top', initialDepthM: 2 })
    moveToDepth(3, 2)
    releaseMouse()

    expect(h.onEdit).toHaveBeenCalledWith(0, { depth_top_m: 3 })
    expect(h.onReject).not.toHaveBeenCalled()
  })

  it('BD2: a drag that collapses the layer onto its opposite edge auto-REJECTS it', () => {
    // top=0 base=4. Drag the BASE up onto the top (≈0) → zero thickness.
    const h = renderHarness({ suggestions: [makeSuggestion({ depth_top_m: 0, depth_base_m: 4 })] })
    startDrag(h, { idx: 0, edge: 'base', initialDepthM: 4 })
    moveToDepth(0, 4)
    releaseMouse()

    // Reject the layer outright — NOT a zero-thickness depth edit (which would
    // leave a stale zombie that freezes the next layer's drag).
    expect(h.onReject).toHaveBeenCalledWith(0)
    // Zero-thickness drag → reject only, no edit of ANY kind (single-suggestion
    // setup: there is no fill-neighbour, so onEdit must not fire at all).
    expect(h.onEdit).not.toHaveBeenCalled()
  })

  it('BD7: a base drag with a pending below-neighbour also fires the partner _propagateOnly edit', () => {
    // Two adjacent pending layers sharing a boundary at 4 m. Dragging s0's base
    // up to 3 m must move BOTH edges of the shared boundary — the dragger's
    // base AND the partner's top — else the partner floats off the seam.
    const h = renderHarness({
      suggestions: [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 4 }),
        makeSuggestion({ depth_top_m: 4, depth_base_m: 8 }),
      ],
    })
    startDrag(h, { idx: 0, edge: 'base', initialDepthM: 4, boundsBelowM: 8 })
    moveToDepth(3, 4)
    releaseMouse()

    expect(h.onEdit).toHaveBeenCalledWith(0, { depth_base_m: 3 })
    expect(h.onEdit).toHaveBeenCalledWith(1, { depth_top_m: 3, _propagateOnly: true })
    expect(h.onEdit).toHaveBeenCalledTimes(2)
  })

  it('BD8: a base drag PAST the partner far edge suppresses the partner _propagateOnly edit', () => {
    // s0 top=0 base=4, s1 top=4 base=6. Dragging s0's base to 7 m fully crosses
    // s1's far edge (6) → the parent reducer's cross-merge absorbs s1 atomically.
    // Firing the propagate-only edit here would target the wrong index post-
    // shift (the double-absorb bug, dogfeed 2026-05-26), so it MUST be
    // suppressed.
    const h = renderHarness({
      suggestions: [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 4 }),
        makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
      ],
    })
    startDrag(h, { idx: 0, edge: 'base', initialDepthM: 4, boundsBelowM: 10 })
    moveToDepth(7, 4)
    releaseMouse()

    expect(h.onEdit).toHaveBeenCalledWith(0, { depth_base_m: 7 })
    expect(h.onEdit).not.toHaveBeenCalledWith(1, expect.anything())
    expect(h.onEdit).toHaveBeenCalledTimes(1)
  })

  // BD9 / BD10 — owner dogfeed 2026-09-11, installer #32: "i split, renamed
  // (added admixture) then tried to pull up the boundary and then it went
  // wrong ... a whole suggestion disappeared".
  //
  // The parent reducer absorbs a neighbour as soon as the released edge has
  // eaten it down to a SLIVER (absorbRemainderThresholdM: 10 cm, or 15 % of the
  // neighbour's thickness). handleUp's own "will the partner be absorbed?"
  // prediction only looked for a FULL cross (released AT or past the far edge).
  // Between those two rules sits a window at least 10 cm wide in which the
  // reducer absorbs the partner AND handleUp still fires the partner's
  // shared-boundary propagate edit — at an index the absorb has just shifted,
  // which is now the merged layer itself. The merged layer's base is set to the
  // released depth, collapsing the suggestion the user just split and renamed
  // down to a sliver: it disappears from the column and leaves a hole.
  //
  // The pin: releasing anywhere the reducer would absorb must suppress the
  // partner edit, exactly as BD8 pins for the full-cross case.

  it('BD9: a top drag that stops a few cm short of the partner far edge still absorbs, so the partner propagate edit is suppressed', () => {
    // s0 top=0 base=2 (the neighbour above), s1 top=2 base=5 (the dragger).
    // Absorb threshold for s0 = max(0.1, 0.15 * 2) = 0.3 m, so releasing the
    // dragged TOP at 0.05 m absorbs s0 in the reducer. The drag is clamped at
    // s0's far edge (0), so 0.05 is a perfectly ordinary release depth.
    const h = renderHarness({
      suggestions: [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 5 }),
      ],
    })
    startDrag(h, { idx: 1, edge: 'top', initialDepthM: 2, boundsAboveM: 0, boundsBelowM: 5 })
    moveToDepth(0.05, 2)
    releaseMouse()

    expect(h.onEdit).toHaveBeenCalledWith(1, { depth_top_m: expect.closeTo(0.05, 6) })
    expect(h.onEdit).not.toHaveBeenCalledWith(0, expect.anything())
    expect(h.onEdit).toHaveBeenCalledTimes(1)
  })

  it('BD10: a base drag that stops a few cm short of the partner far edge also suppresses the partner propagate edit', () => {
    // Mirror of BD9 downward. s0 top=0 base=2 (dragger), s1 top=2 base=4
    // (neighbour below). Threshold for s1 = max(0.1, 0.15 * 2) = 0.3 m, so
    // releasing the dragged BASE at 3.95 m absorbs s1 in the reducer.
    const h = renderHarness({
      suggestions: [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
    })
    startDrag(h, { idx: 0, edge: 'base', initialDepthM: 2, boundsAboveM: 0, boundsBelowM: 4 })
    moveToDepth(3.95, 2)
    releaseMouse()

    expect(h.onEdit).toHaveBeenCalledWith(0, { depth_base_m: expect.closeTo(3.95, 6) })
    expect(h.onEdit).not.toHaveBeenCalledWith(1, expect.anything())
    expect(h.onEdit).toHaveBeenCalledTimes(1)
  })

  it('BD3: mouseup clears the live drag state', () => {
    const h = renderHarness()
    startDrag(h, { idx: 0, edge: 'base', initialDepthM: 4 })
    moveToDepth(3, 4)
    releaseMouse()

    expect(h.result.current.drag).toBeNull()
  })

  it('BD5: dragging past the lower bound clamps/snaps the live depth to the bound', () => {
    // boundsBelowM=5. Drag the base far past it (to 8 m) → clamps to 5 and snaps.
    const h = renderHarness({ suggestions: [makeSuggestion({ depth_top_m: 0, depth_base_m: 4 })] })
    startDrag(h, { idx: 0, edge: 'base', initialDepthM: 4, boundsBelowM: 5 })
    moveToDepth(8, 4)

    // The dragged edge cannot cross the neighbour boundary — the live depth is
    // pinned to the bound, not the raw cursor depth (8).
    expect(h.result.current.drag?.currentDepthM).toBe(5)
    expect(h.result.current.drag?.snapped).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Ctrl+drag absorb-all (owner 2026-09-23/24). The hook commits ONE edit marked
// ``_absorbAll``; the reducer absorbs the passed units and propagates the partner,
// so the hook fires neither the partner edit nor the merge chain.
// ---------------------------------------------------------------------------

describe('useBoundaryDrag — Ctrl+drag absorb-all', () => {
  it('BD11: an absorb-all base drag past two pending units commits one marked edit and nothing else', () => {
    const h = renderHarness({
      suggestions: [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 4 }),
        makeSuggestion({ depth_top_m: 4, depth_base_m: 8 }),
        makeSuggestion({ depth_top_m: 8, depth_base_m: 12 }),
      ],
    })
    startDrag(h, { idx: 0, edge: 'base', initialDepthM: 4, boundsBelowM: 12, absorbAll: true })
    moveToDepth(10, 4)
    releaseMouse()

    expect(h.onEdit).toHaveBeenCalledTimes(1)
    expect(h.onEdit).toHaveBeenCalledWith(0, { depth_base_m: 10, _absorbAll: true })
    expect(h.onMergeLayers).not.toHaveBeenCalled()
    expect(h.onReject).not.toHaveBeenCalled()
  })

  it('BD12: an absorb-all drag that collapses the layer onto its own opposite edge still auto-rejects it', () => {
    const h = renderHarness({
      suggestions: [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 4 }),
        makeSuggestion({ depth_top_m: 4, depth_base_m: 8 }),
      ],
    })
    startDrag(h, { idx: 0, edge: 'base', initialDepthM: 4, boundsBelowM: 8, absorbAll: true })
    moveToDepth(0, 4)
    releaseMouse()

    expect(h.onReject).toHaveBeenCalledWith(0)
  })
})
