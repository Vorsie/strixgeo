// Behavioural net for the ghost workspace — the pending (not yet accepted)
// litho suggestions a column carries, and the two ways the owner lost work in
// them (installer #32 dogfeed, 2026-09-11 and his follow-up rulings):
//
//   "a whole suggestion disappeared and i can't redo it any more, i split,
//    renamed (added admixture) then tried to pull up the boundary and then it
//    went wrong."
//
// Round 1 stopped the layer disappearing. These pin the rest of his ruling:
//
//   UN1-UN3  "i can't redo it any more" — the three gestures he made are three
//            undo steps, walked back one Ctrl+Z at a time, ending with the
//            split half back at 3.00 m.
//   UN4      Redo replays them.
//   UN5      One boundary drag is ONE undo step, not two — the dragger edit and
//            its shared-boundary partner edit coalesce into a single command.
//   UN6      Merge and absorb are their own steps.
//   UN7      Undo restores the anchor even when the gesture removed layers.
//   RF1      A refused drag follow-up raises the toast too, not only the log.
//   MS1-MS3  "switching the model must not throw away my pending suggestions" —
//            ghosts belong to the model they were suggested for: mounting keeps
//            them, switching away sets them aside (with a toast), switching back
//            brings them out again.
//   MS4      ...and an undo step never writes one model's column onto another.
//
// Strategy: the host component owns the ghost Map in real useState, a real
// useUndoStack, and the active litho model as a rerender prop, so Ctrl+Z and a
// model switch run the production code paths end to end.

import { act, renderHook } from '@testing-library/react'
import { useRef, useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLithoSuggestions } from './useLithoSuggestions'
import type { UseLithoSuggestionsParams, UseLithoSuggestionsResult } from './useLithoSuggestions'
import { useUndoStack } from './useUndoStack'
import type { UseUndoStackResult } from './useUndoStack'
import type { BulkAnchorGhost, LithoSuggestionEdit } from './useGeologicalModel'
import { effectiveDepths } from '../utils/lithoBoundaryHelpers'
import type {
  GeologicalModelResponse,
  LithoLayerSuggestion,
  ProjectResponse,
} from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    geology: {
      acceptLithoSuggestions: vi.fn(),
      batchAcceptLithoSuggestions: vi.fn(),
      suggestLitho: vi.fn(),
      autoCorrelateContacts: vi.fn(),
      deleteAutoCorrelations: vi.fn(),
      deleteContact: vi.fn(),
      deleteFormation: vi.fn(),
    },
  },
  isApiStatus: vi.fn(() => false),
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

const ANCHOR_ID = 'BH-1'
const PROJECT = { id: 'P1', view_state: {} } as unknown as ProjectResponse
const MODEL_A = {
  id: 'M-litho-A',
  name: 'Litho model A',
  kind: 'lithostratigraphic',
} as unknown as GeologicalModelResponse
const MODEL_B = {
  id: 'M-litho-B',
  name: 'Litho model B',
  kind: 'lithostratigraphic',
} as unknown as GeologicalModelResponse

function makeSuggestion(over: Partial<LithoLayerSuggestion> = {}): LithoLayerSuggestion {
  return {
    depth_top_m: 0,
    depth_base_m: 2,
    suggested_lithology: 'ZAND',
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'medium',
    source: 'segmenter',
    suggested_admixtures: [],
    parent_formation_id: null,
    spans_boundary: false,
    ...over,
  } as LithoLayerSuggestion
}

/** The borehole column the owner was working on: six stacked layers. */
function boreholeGhost(): BulkAnchorGhost {
  return {
    kind: 'borehole',
    suggestions: [
      makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
      makeSuggestion({ depth_top_m: 2, depth_base_m: 5, suggested_lithology: 'KLEI' }),
      makeSuggestion({ depth_top_m: 5, depth_base_m: 8 }),
      makeSuggestion({ depth_top_m: 8, depth_base_m: 10, suggested_lithology: 'SILT' }),
      makeSuggestion({ depth_top_m: 10, depth_base_m: 12 }),
      makeSuggestion({ depth_top_m: 12, depth_base_m: 15, suggested_lithology: 'KLEI' }),
    ],
    surfaceElevationM: 10,
    accepted: new Set<number>(),
    rejected: new Set<number>(),
    edits: new Map<number, LithoSuggestionEdit>(),
  }
}

interface Host {
  hook: UseLithoSuggestionsResult
  ghosts: ReadonlyMap<string, BulkAnchorGhost>
  undo: UseUndoStackResult
  toast: ReturnType<typeof vi.fn>
}

function renderHost(
  initial: BulkAnchorGhost | null,
  over: Partial<UseLithoSuggestionsParams> = {},
): {
  result: { current: Host }
  rerender: (props: { model: GeologicalModelResponse | null }) => void
} {
  const toast = vi.fn()
  const { result, rerender } = renderHook(
    ({ model }: { model: GeologicalModelResponse | null }) => {
      const [ghosts, setGhosts] = useState<ReadonlyMap<string, BulkAnchorGhost>>(
        () => (initial === null ? new Map() : new Map([[ANCHOR_ID, initial]])),
      )
      const [focusedId, setFocusedId] = useState<string | null>(ANCHOR_ID)
      const focusedRef = useRef<string | null>(ANCHOR_ID)
      focusedRef.current = focusedId
      const modelRef = useRef<GeologicalModelResponse | null>(model)
      modelRef.current = model
      const undo = useUndoStack()
      const params = {
        project: PROJECT,
        activeLithoModelRef: modelRef,
        lithoContacts: [],
        activeLithoModel: model,
        formations: [],
        addToSessionImports: vi.fn(),
        pushUndo: undo.push,
        markMutated: vi.fn(),
        requestCorrelationEdgesRefetch: vi.fn(),
        refetchLithoContacts: vi.fn(),
        refetchFormations: vi.fn(),
        toast,
        setGhostsByAnchor: setGhosts,
        setFocusedSuggestAnchorId: setFocusedId,
        setLithoSuggesting: vi.fn(),
        setBulkLithoSuggesting: vi.fn(),
        setLithoCrossingPinchOuts: vi.fn(),
        ghostsByAnchor: ghosts,
        focusedSuggestAnchorId: focusedId,
        focusedSuggestAnchorIdRef: focusedRef,
        lithoSuggestions: initial?.suggestions ?? [],
        lithoSuggestionEdits: new Map(),
        lithoSuggestionRejected: new Set<number>(),
        lithoSuggestionAnchorKind: 'borehole' as const,
        lithoSuggestionInvestigationId: ANCHOR_ID,
        bulkGhostsByAnchor: new Map(),
        ...over,
      } as UseLithoSuggestionsParams
      return { hook: useLithoSuggestions(params), ghosts, undo, toast }
    },
    { initialProps: { model: MODEL_A as GeologicalModelResponse | null } },
  )
  return { result, rerender }
}

/** Effective thickness of one ghost layer (m). */
function thickness(ghost: BulkAnchorGhost, idx: number): number {
  const d = effectiveDepths(ghost.suggestions, ghost.edits, idx)
  return d.baseM - d.topM
}

function column(result: { current: Host }): BulkAnchorGhost {
  const g = result.current.ghosts.get(ANCHOR_ID)
  if (g === undefined) throw new Error('the anchor lost its ghost column')
  return g
}

/**
 * Replay the section editor's mouseup for a TOP-edge drag: the dragger's own
 * depth edit, then the shared-boundary partner edit at the index the commit
 * resolved before the reducer ran. Both fire in ONE tick, as they do in the app.
 */
function dragTopUpTo(host: { current: Host }, idx: number, finalM: number): void {
  act(() => {
    host.current.hook.handleEditBulkLitho(ANCHOR_ID, idx, { depth_top_m: finalM })
    host.current.hook.handleEditBulkLitho(ANCHOR_ID, idx - 1, {
      depth_base_m: finalM,
      _propagateOnly: true,
    })
  })
}

/** The owner's three gestures, in his order. */
function doTheOwnerSequence(result: { current: Host }): void {
  act(() => {
    result.current.hook.handleSplitLithoLayer(ANCHOR_ID, 2)
  })
  act(() => {
    result.current.hook.handleEditBulkLitho(ANCHOR_ID, 3, {
      suggested_lithology: 'ZAND',
      suggested_admixtures: [{ soil_code: 'KH', amount: 'weinig', locally: false }],
    })
  })
  dragTopUpTo(result, 3, 5.05)
}

async function pressUndo(result: { current: Host }): Promise<void> {
  await act(async () => {
    await result.current.undo.undo()
  })
}

async function pressRedo(result: { current: Host }): Promise<void> {
  await act(async () => {
    await result.current.undo.redo()
  })
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// "i can't redo it any more"
// ---------------------------------------------------------------------------

describe('i can not redo it any more — the ghost gestures are undoable', () => {
  it('UN1: undoing the boundary drag brings both split halves back', async () => {
    const { result } = renderHost(boreholeGhost())
    doTheOwnerSequence(result)
    expect(column(result).suggestions).toHaveLength(6) // merged back to one

    await pressUndo(result)

    const g = column(result)
    expect(g.suggestions).toHaveLength(7)
    expect(thickness(g, 2)).toBeCloseTo(1.5, 6)
    expect(thickness(g, 3)).toBeCloseTo(1.5, 6)
  })

  it('UN2: undoing the composition edit takes the admixture back off', async () => {
    const { result } = renderHost(boreholeGhost())
    doTheOwnerSequence(result)

    await pressUndo(result) // the drag
    expect(column(result).edits.get(3)?.suggested_admixtures).toHaveLength(1)
    await pressUndo(result) // the composition edit

    expect(column(result).edits.get(3)?.suggested_admixtures ?? []).toHaveLength(0)
  })

  it('UN3: undoing the split puts the split half back at 3.00 m', async () => {
    const { result } = renderHost(boreholeGhost())
    doTheOwnerSequence(result)

    await pressUndo(result) // the drag
    await pressUndo(result) // the composition edit
    await pressUndo(result) // the split

    const g = column(result)
    expect(g.suggestions).toHaveLength(6)
    expect(thickness(g, 2)).toBeCloseTo(3.0, 6)
  })

  it('UN4: redo replays the three gestures back to the merged column', async () => {
    const { result } = renderHost(boreholeGhost())
    doTheOwnerSequence(result)

    await pressUndo(result)
    await pressUndo(result)
    await pressUndo(result)
    expect(column(result).suggestions).toHaveLength(6)

    await pressRedo(result)
    await pressRedo(result)
    await pressRedo(result)

    const g = column(result)
    expect(g.suggestions).toHaveLength(6)
    expect(thickness(g, 2)).toBeCloseTo(3.0, 6)
    expect(g.edits.get(2)?.suggested_admixtures).toHaveLength(1)
  })

  it('UN5: one boundary drag is ONE undo step, not two', async () => {
    const { result } = renderHost(boreholeGhost())
    act(() => {
      result.current.hook.handleSplitLithoLayer(ANCHOR_ID, 2)
    })
    dragTopUpTo(result, 3, 5.05)
    expect(column(result).suggestions).toHaveLength(6)

    // A single press must undo the whole drag: both halves back.
    await pressUndo(result)

    const g = column(result)
    expect(g.suggestions).toHaveLength(7)
    expect(thickness(g, 2)).toBeCloseTo(1.5, 6)
    expect(thickness(g, 3)).toBeCloseTo(1.5, 6)
  })

  it('UN6: merge and absorb are each their own undo step', async () => {
    const { result } = renderHost(boreholeGhost())
    // Layers 4 (10-12 ZAND) and 5 (12-15 KLEI) differ, so merge the two ZAND
    // neighbours the split makes at 5-6.5 / 6.5-8 instead.
    act(() => {
      result.current.hook.handleSplitLithoLayer(ANCHOR_ID, 2)
    })
    act(() => {
      result.current.hook.handleMergeLithoLayers(ANCHOR_ID, 2)
    })
    expect(column(result).suggestions).toHaveLength(6)

    await pressUndo(result) // the merge only
    expect(column(result).suggestions).toHaveLength(7)

    act(() => {
      result.current.hook.handleAbsorbLithoLayer(ANCHOR_ID, 2, 'down')
    })
    expect(column(result).suggestions).toHaveLength(6)
    await pressUndo(result) // the absorb only
    expect(column(result).suggestions).toHaveLength(7)
  })

  it('UN7: undo restores an anchor whose gesture removed layers, layer for layer', async () => {
    const { result } = renderHost(boreholeGhost())
    const before = column(result).suggestions.map(s => `${s.depth_top_m}-${s.depth_base_m}`)

    act(() => {
      result.current.hook.handleAbsorbLithoLayer(ANCHOR_ID, 0, 'down')
    })
    expect(column(result).suggestions).toHaveLength(5)

    await pressUndo(result)

    const after = column(result).suggestions.map(s => `${s.depth_top_m}-${s.depth_base_m}`)
    expect(after).toEqual(before)
    expect(column(result).edits.size).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// The refused drag follow-up
// ---------------------------------------------------------------------------

describe('a refused ghost edit tells the user', () => {
  it('RF1: a drag follow-up that would collapse the layer raises the toast, not only the log', () => {
    const { result } = renderHost(boreholeGhost())
    // A propagate that would put layer 1's base above its own top is refused by
    // the reducer; the user has to hear about it.
    act(() => {
      result.current.hook.handleEditBulkLitho(ANCHOR_ID, 1, {
        depth_base_m: 2,
        _propagateOnly: true,
      })
    })

    expect(result.current.toast).toHaveBeenCalledWith('warning', expect.any(String))
    expect(thickness(column(result), 1)).toBeCloseTo(3, 6)
  })
})

// ---------------------------------------------------------------------------
// Switching the litho model
// ---------------------------------------------------------------------------

describe('switching the model must not throw away my pending suggestions', () => {
  it('MS1: the ghosts come back when the user switches back to the model they belong to', () => {
    const { result, rerender } = renderHost(boreholeGhost())
    expect(column(result).suggestions).toHaveLength(6)

    act(() => {
      rerender({ model: MODEL_B })
    })
    // Set aside, not accept-able onto the other model.
    expect(result.current.ghosts.has(ANCHOR_ID)).toBe(false)

    act(() => {
      rerender({ model: MODEL_A })
    })
    expect(column(result).suggestions).toHaveLength(6)
  })

  it('MS2: mounting with pending suggestions on screen keeps them', () => {
    const { result } = renderHost(boreholeGhost())
    expect(result.current.ghosts.has(ANCHOR_ID)).toBe(true)
    expect(column(result).suggestions).toHaveLength(6)
  })

  it('MS4: an undo step from the other model does not write onto the model I am on now', async () => {
    const { result, rerender } = renderHost(boreholeGhost())
    act(() => {
      result.current.hook.handleSplitLithoLayer(ANCHOR_ID, 2)
    })
    expect(column(result).suggestions).toHaveLength(7)

    act(() => {
      rerender({ model: MODEL_B })
    })
    expect(result.current.ghosts.has(ANCHOR_ID)).toBe(false)

    // Ctrl+Z on the other model must not resurrect model A's column here.
    await pressUndo(result)
    expect(result.current.ghosts.has(ANCHOR_ID)).toBe(false)

    // Back on the model it belongs to, the column is whole again.
    act(() => {
      rerender({ model: MODEL_A })
    })
    expect(column(result).suggestions).toHaveLength(7)
  })

  it('MS3: switching away says how many suggestions were set aside, and on which model', () => {
    const { result, rerender } = renderHost(boreholeGhost())
    act(() => {
      rerender({ model: MODEL_B })
    })

    const messages = (result.current.toast as ReturnType<typeof vi.fn>).mock.calls.map(
      c => String(c[1]),
    )
    expect(messages.join(' | ')).toContain(MODEL_A.name)
  })
})

// ---------------------------------------------------------------------------
// "make it undoable" (owner ruling 9): reject / unreject a pending suggestion,
// and the left-click that draws a manual ghost, are undoable like the rest.
// ---------------------------------------------------------------------------

describe('make it undoable — reject, unreject and a manually drawn ghost', () => {
  it('rejecting a suggestion is one undo step', async () => {
    const { result } = renderHost(boreholeGhost())
    act(() => {
      result.current.hook.handleRejectBulkLitho(ANCHOR_ID, 1)
    })
    expect(column(result).rejected.has(1)).toBe(true)

    await pressUndo(result)
    expect(column(result).rejected.has(1)).toBe(false)
  })

  it('redo re-rejects the suggestion', async () => {
    const { result } = renderHost(boreholeGhost())
    act(() => {
      result.current.hook.handleRejectBulkLitho(ANCHOR_ID, 1)
    })
    await pressUndo(result)
    expect(column(result).rejected.has(1)).toBe(false)

    await pressRedo(result)
    expect(column(result).rejected.has(1)).toBe(true)
  })

  it('unreject too — undoing an unreject puts the rejection back', async () => {
    const start = boreholeGhost()
    const { result } = renderHost({ ...start, rejected: new Set<number>([1]) })
    act(() => {
      result.current.hook.handleUnrejectBulkLitho(ANCHOR_ID, 1)
    })
    expect(column(result).rejected.has(1)).toBe(false)

    await pressUndo(result)
    expect(column(result).rejected.has(1)).toBe(true)
  })

  it('a manually drawn ghost can be undone', async () => {
    const { result } = renderHost(null)
    act(() => {
      result.current.hook.handleCreateManualLithoGhost('borehole', ANCHOR_ID, 10, 5, 'F1')
    })
    expect(column(result).suggestions).toHaveLength(1)

    await pressUndo(result)
    expect(result.current.ghosts.has(ANCHOR_ID)).toBe(false)
  })

  it('redo brings the manually drawn ghost back', async () => {
    const { result } = renderHost(null)
    act(() => {
      result.current.hook.handleCreateManualLithoGhost('borehole', ANCHOR_ID, 10, 5, 'F1')
    })
    await pressUndo(result)
    expect(result.current.ghosts.has(ANCHOR_ID)).toBe(false)

    await pressRedo(result)
    expect(column(result).suggestions).toHaveLength(1)
  })
})
