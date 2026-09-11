// Behavioural net for the owner's installer-#32 dogfeed (2026-09-11, litho
// stage, PENDING suggestions — the backend log shows no litho mutation at all
// during the incident, so everything here happened in the renderer's ghost
// state):
//
//   "Something went wrong while merging litho suggestions, a whole suggestion
//    disappeared and i can't redo it any more, i split, renamed (added
//    admixture) then tried to pull up the boundary and then it went wrong."
//
// The three steps in his order, driven through the real hook handlers against a
// real ghost Map:
//
//   GS1  "a whole suggestion disappeared" — after split → edit composition →
//        pull the boundary up, the layer he worked on is still on the column at
//        its merged thickness, not a sliver, and the column has no hole in it.
//   GS2  the admixture he typed survives the merge.
//   GS3  no step may leave the anchor with an empty ghost list.
//   GS4  a structural verb that cannot be honoured keeps the layers and reports
//        (toast) instead of dropping them.
//   GS5  "i can't redo it any more" — a column whose ghosts are gone and that
//        carries NO accepted litho layers can be suggested again. (The
//        2026-09-07 "skip columns with accepted layers" guard reads committed
//        contacts only, so it must not stand in the way here.)
//   GS6  the same guard still skips a column that DOES carry accepted layers.
//
// Strategy: useLithoSuggestions takes every dependency as a param, so the host
// component owns the ghost Map in a real useState and hands the hook the value
// + the setter. Driving the handlers then mutates real state, exactly as the
// section editor does.

import { act, renderHook } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLithoSuggestions } from './useLithoSuggestions'
import type { UseLithoSuggestionsParams, UseLithoSuggestionsResult } from './useLithoSuggestions'
import type { BulkAnchorGhost, LithoSuggestionEdit } from './useGeologicalModel'
import { effectiveDepths } from '../utils/lithoBoundaryHelpers'
import type {
  FormationContactResponse,
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
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

import { api } from '../api/client'

const MODEL_ID = 'M-litho-1'
const ANCHOR_ID = 'BH-1'
const PROJECT = { id: 'P1', view_state: {} } as unknown as ProjectResponse
const MODEL = { id: MODEL_ID, kind: 'lithostratigraphic' } as unknown as GeologicalModelResponse

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

/** A borehole column the way the segmenter hands it over: 6 stacked layers. */
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
  toast: ReturnType<typeof vi.fn>
}

/** Render the hook with a REAL ghost Map in state so the handlers mutate it. */
function renderHost(
  initial: BulkAnchorGhost | null,
  over: Partial<UseLithoSuggestionsParams> = {},
): { result: { current: Host } } {
  const toast = vi.fn()
  return renderHook(() => {
    const [ghosts, setGhosts] = useState<ReadonlyMap<string, BulkAnchorGhost>>(
      () => (initial === null ? new Map() : new Map([[ANCHOR_ID, initial]])),
    )
    const params = {
      project: PROJECT,
      activeLithoModelRef: { current: MODEL },
      lithoContacts: [],
      activeLithoModel: MODEL,
      formations: [],
      addToSessionImports: vi.fn(),
      pushUndo: vi.fn(),
      markMutated: vi.fn(),
      requestCorrelationEdgesRefetch: vi.fn(),
      refetchLithoContacts: vi.fn(),
      refetchFormations: vi.fn(),
      toast,
      setGhostsByAnchor: setGhosts,
      setFocusedSuggestAnchorId: vi.fn(),
      setLithoSuggesting: vi.fn(),
      setBulkLithoSuggesting: vi.fn(),
      setLithoCrossingPinchOuts: vi.fn(),
      ghostsByAnchor: ghosts,
      focusedSuggestAnchorId: ANCHOR_ID,
      // Deliberately null: the hook's model-change effect calls
      // clearLithoSuggestions() once on mount, which DELETES the focused
      // anchor's entry from the Map. With the ref null that effect is a no-op,
      // so the fixture's seeded column survives to the first act() — which is
      // the state the section editor is in when the user reaches for the menu.
      focusedSuggestAnchorIdRef: { current: null },
      lithoSuggestions: initial?.suggestions ?? [],
      lithoSuggestionEdits: new Map(),
      lithoSuggestionRejected: new Set<number>(),
      lithoSuggestionAnchorKind: 'borehole' as const,
      lithoSuggestionInvestigationId: ANCHOR_ID,
      bulkGhostsByAnchor: new Map(),
      ...over,
    } as UseLithoSuggestionsParams
    return { hook: useLithoSuggestions(params), ghosts, toast }
  })
}

/** Effective top/base of every rendered (non-zero-thickness) ghost layer. */
function bands(ghost: BulkAnchorGhost): { topM: number; baseM: number }[] {
  return ghost.suggestions.map((_, i) => effectiveDepths(ghost.suggestions, ghost.edits, i))
}

/** The biggest uncovered depth gap between consecutive ghost bands (m). */
function biggestHole(ghost: BulkAnchorGhost): number {
  const bs = bands(ghost)
  let worst = 0
  for (let i = 1; i < bs.length; i++) {
    worst = Math.max(worst, bs[i].topM - bs[i - 1].baseM)
  }
  return worst
}

function makeLithoContact(boreholeId: string): FormationContactResponse {
  return {
    id: `lc-${boreholeId}`,
    cpt_id: null,
    borehole_id: boreholeId,
  } as unknown as FormationContactResponse
}

const suggestSpy = api.geology.suggestLitho as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// The owner's three steps, in his order
// ---------------------------------------------------------------------------

describe('split → edit composition → pull the boundary up (owner dogfeed 2026-09-11)', () => {
  /**
   * Replay the section editor's mouseup for a TOP-edge drag: the dragger's own
   * depth edit first, then the shared-boundary partner edit at the index the
   * commit resolved BEFORE the reducer ran. That second emission is what the
   * incident turned on.
   */
  function dragTopUpTo(host: { current: Host }, idx: number, finalM: number): void {
    act(() => {
      host.current.hook.handleEditBulkLitho(ANCHOR_ID, idx, { depth_top_m: finalM })
    })
    act(() => {
      host.current.hook.handleEditBulkLitho(ANCHOR_ID, idx - 1, {
        depth_base_m: finalM,
        _propagateOnly: true,
      })
    })
  }

  it('GS1: a whole suggestion does not disappear — the merged layer keeps its full extent and leaves no hole', () => {
    const { result } = renderHost(boreholeGhost())

    // (1) Split here on the 5→8 layer: halves 5→6.5 and 6.5→8.
    act(() => {
      result.current.hook.handleSplitLithoLayer(ANCHOR_ID, 2)
    })
    expect(result.current.ghosts.get(ANCHOR_ID)?.suggestions).toHaveLength(7)

    // (2) Edit composition on the lower half (idx 3) — add an admixture.
    act(() => {
      result.current.hook.handleEditBulkLitho(ANCHOR_ID, 3, {
        suggested_lithology: 'ZAND',
        suggested_admixtures: [{ soil_code: 'KH', amount: 'weinig', locally: false }],
      })
    })

    // (3) Pull the boundary between the halves UP past the upper half's top
    // (5 m), releasing 5 cm short of it — inside the absorb sliver window.
    dragTopUpTo(result, 3, 5.05)

    const ghost = result.current.ghosts.get(ANCHOR_ID)!
    // The two halves merged back into one layer — 6 layers again.
    expect(ghost.suggestions).toHaveLength(6)
    const merged = effectiveDepths(ghost.suggestions, ghost.edits, 2)
    // It spans from where the user released down to the original base: the
    // suggestion is still on the column, not a 5 cm sliver.
    expect(merged.baseM - merged.topM).toBeGreaterThan(2)
    // And nothing was left uncovered between the bands.
    expect(biggestHole(ghost)).toBeLessThan(0.01)
  })

  it('GS2: the admixture the user typed survives the merge', () => {
    const { result } = renderHost(boreholeGhost())
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

    const ghost = result.current.ghosts.get(ANCHOR_ID)!
    expect(ghost.edits.get(2)?.suggested_admixtures).toHaveLength(1)
    expect(ghost.edits.get(2)?.suggested_admixtures?.[0].soil_code).toBe('KH')
  })

  it('GS3: no step in the sequence leaves the anchor with an empty ghost list', () => {
    const { result } = renderHost(boreholeGhost())
    const seen: number[] = []
    act(() => {
      result.current.hook.handleSplitLithoLayer(ANCHOR_ID, 2)
    })
    seen.push(result.current.ghosts.get(ANCHOR_ID)!.suggestions.length)
    act(() => {
      result.current.hook.handleEditBulkLitho(ANCHOR_ID, 3, {
        suggested_lithology: 'ZAND',
        suggested_admixtures: [{ soil_code: 'KH', amount: 'weinig', locally: false }],
      })
    })
    seen.push(result.current.ghosts.get(ANCHOR_ID)!.suggestions.length)
    dragTopUpTo(result, 3, 5.05)
    seen.push(result.current.ghosts.get(ANCHOR_ID)!.suggestions.length)

    expect(result.current.ghosts.has(ANCHOR_ID)).toBe(true)
    for (const n of seen) expect(n).toBeGreaterThan(0)
  })
})

describe('a structural verb that cannot be honoured keeps the layers', () => {
  it('GS4: merging the bottom layer (no lower neighbour) leaves the column intact and warns', () => {
    const { result } = renderHost(boreholeGhost())
    act(() => {
      result.current.hook.handleMergeLithoLayers(ANCHOR_ID, 5)
    })
    expect(result.current.ghosts.get(ANCHOR_ID)?.suggestions).toHaveLength(6)
    expect(result.current.toast).toHaveBeenCalledWith('warning', expect.any(String))
  })

  it('GS4b: absorbing with no neighbour in that direction leaves the column intact and warns', () => {
    const { result } = renderHost(boreholeGhost())
    act(() => {
      result.current.hook.handleAbsorbLithoLayer(ANCHOR_ID, 0, 'up')
    })
    expect(result.current.ghosts.get(ANCHOR_ID)?.suggestions).toHaveLength(6)
    expect(result.current.toast).toHaveBeenCalledWith('warning', expect.any(String))
  })

  it('GS4c: splitting an index that is not on the column leaves it intact and warns', () => {
    const { result } = renderHost(boreholeGhost())
    act(() => {
      result.current.hook.handleSplitLithoLayer(ANCHOR_ID, 9)
    })
    expect(result.current.ghosts.get(ANCHOR_ID)?.suggestions).toHaveLength(6)
    expect(result.current.toast).toHaveBeenCalledWith('warning', expect.any(String))
  })
})

describe('i can not redo it any more — getting the column back', () => {
  it('GS5: a column with no ghosts and no accepted layers can be suggested again', async () => {
    suggestSpy.mockResolvedValue({ layers: [makeSuggestion()] })
    // No ghost entry at all for the anchor, and no committed litho contacts.
    const { result } = renderHost(null, { lithoContacts: [] })

    await act(async () => {
      await result.current.hook.handleSuggestLitho('borehole', ANCHOR_ID)
    })

    expect(suggestSpy).toHaveBeenCalledTimes(1)
    expect(result.current.ghosts.get(ANCHOR_ID)?.suggestions).toHaveLength(1)
  })

  it('GS6: a column that DOES carry accepted layers is still skipped (owner ruling 2026-09-07)', async () => {
    suggestSpy.mockResolvedValue({ layers: [makeSuggestion()] })
    const { result } = renderHost(null, { lithoContacts: [makeLithoContact(ANCHOR_ID)] })

    await act(async () => {
      await result.current.hook.handleSuggestLitho('borehole', ANCHOR_ID)
    })

    expect(suggestSpy).not.toHaveBeenCalled()
    expect(result.current.toast).toHaveBeenCalledWith('warning', expect.any(String))
  })
})
