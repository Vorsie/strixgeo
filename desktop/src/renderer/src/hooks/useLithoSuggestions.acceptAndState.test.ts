// Behavioural net for useLithoSuggestions — the accept lifecycle + the pure
// suggestion-state helpers. These pin invariants tied to REAL dogfeed bugs,
// phrased in the bug's own vocabulary (not the implementation's):
//
//   AC1  (#57 explicit-content invariant) Accepting a suggestion forwards the
//        server's `updated_section` to the caller's onSectionUpdated. Without
//        this, the newly-seeded contact is hidden by the section's
//        explicit-content filter and "nothing appears" after accept.
//   AC2  (#57 negative) When the server returns updated_section=null there is
//        nothing to re-seed, so onSectionUpdated is NOT called.
//   AC3  (#144 dirty-flag) A create-bearing accept records its created
//        formation + contact ids in the session-imports manifest (so the amber
//        dirty flag lights and the .gmproj is not silently stale on close).
//   AC3b (#144) A found-only accept (nothing created) records nothing.
//   AC4  (accept = verbatim copy — feedback_litho_accept_verbatim_copy) The
//        body POSTed carries exactly the ONE focused suggestion, never a
//        merged/split set.
//   AC5  The user's depth edit is honoured at accept time — the committed
//        contact lands at the edited depth, not the segmenter's original.
//   AC6  A server/API failure surfaces an error toast and returns null (no
//        partial "success" reported to the caller).
//   EF1/EF2/EF3  effectiveLithoSuggestionAt: no-edit passthrough, edit-overlay,
//        out-of-range → null.
//   RJ1/RJ2  reject adds the index to the focused anchor's rejected set;
//        unreject removes it and is a no-op on a non-rejected index (#80).
//
// Strategy: useLithoSuggestions takes every dependency as a param, so we render
// it directly with vi.fn() spies + a mocked api.geology, drive the returned
// handlers, and assert on the calls + on the state updater functions passed to
// the setGhostsByAnchor spy. The real lithoAccept / lithoSegmenterPrefs
// utils are NOT mocked, so the real body-building and dirty-flag recording
// run end-to-end.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useLithoSuggestions } from './useLithoSuggestions'
import type { UseLithoSuggestionsParams } from './useLithoSuggestions'
import type { BulkAnchorGhost, LithoSuggestionEdit } from './useGeologicalModel'
import type {
  AcceptLithoSuggestionsResponse,
  CrossSectionResponse,
  FormationContactResponse,
  GeologicalModelResponse,
  LithoLayerSuggestion,
  ProjectResponse,
} from '../api/client'

// ---------------------------------------------------------------------------
// Module mocks — api.geology + log
// ---------------------------------------------------------------------------

vi.mock('../api/client', () => ({
  api: {
    geology: {
      acceptLithoSuggestions: vi.fn(),
      // Every method the hook can reach through a driven handler — stubbed so a
      // future test targeting suggest / batch-accept / auto-correlate fails at
      // its assertion, not with "api.geology.X is not a function".
      batchAcceptLithoSuggestions: vi.fn(),
      suggestLitho: vi.fn(),
      autoCorrelateContacts: vi.fn(),
      deleteAutoCorrelations: vi.fn(),
      deleteContact: vi.fn(),
      deleteFormation: vi.fn(),
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

// Pull the mocked api in after the mock is registered.
import { api } from '../api/client'

const MODEL_ID = 'M-litho-1'
const ANCHOR_ID = 'CPT-1'

const PROJECT = { id: 'P1', view_state: {} } as unknown as ProjectResponse
const MODEL = { id: MODEL_ID, kind: 'lithostratigraphic' } as unknown as GeologicalModelResponse

// A minimal section the server would echo back on accept.
const SECTION = { id: 'S1', name: 'CS1' } as unknown as CrossSectionResponse

/** Build a segmenter suggestion with defaults for the fields the accept /
 * effective paths read. */
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
    ...over,
  } as LithoLayerSuggestion
}

/** Build an accept response. Defaults are the create-bearing happy path with a
 * seeded section echoed back. */
function makeAcceptResponse(
  over: Partial<AcceptLithoSuggestionsResponse> = {},
): AcceptLithoSuggestionsResponse {
  return {
    created_formation_ids: ['F-new-1'],
    found_formation_ids: [],
    created_contact_ids: ['C-new-1'],
    found_contact_ids: [],
    updated_section: SECTION,
    ...over,
  }
}

/** One BulkAnchorGhost with sensible empty sets. */
function makeGhost(over: Partial<BulkAnchorGhost> = {}): BulkAnchorGhost {
  return {
    kind: 'cpt',
    suggestions: [makeSuggestion()],
    surfaceElevationM: null,
    accepted: new Set<number>(),
    rejected: new Set<number>(),
    edits: new Map<number, LithoSuggestionEdit>(),
    ...over,
  }
}

/** Full params factory. Every dependency is a spy so the handlers can run. */
function makeParams(over: Partial<UseLithoSuggestionsParams> = {}): UseLithoSuggestionsParams {
  const suggestions = over.lithoSuggestions ?? [makeSuggestion()]
  return {
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
    toast: vi.fn(),
    setGhostsByAnchor: vi.fn(),
    setFocusedSuggestAnchorId: vi.fn(),
    setLithoSuggesting: vi.fn(),
    setBulkLithoSuggesting: vi.fn(),
    setLithoCrossingPinchOuts: vi.fn(),
    ghostsByAnchor: new Map(),
    focusedSuggestAnchorId: ANCHOR_ID,
    focusedSuggestAnchorIdRef: { current: ANCHOR_ID },
    lithoSuggestions: suggestions,
    lithoSuggestionEdits: new Map(),
    lithoSuggestionRejected: new Set(),
    lithoSuggestionAnchorKind: 'cpt',
    lithoSuggestionInvestigationId: ANCHOR_ID,
    bulkGhostsByAnchor: new Map(),
    ...over,
  } as UseLithoSuggestionsParams
}

const acceptSpy = api.geology.acceptLithoSuggestions as unknown as ReturnType<typeof vi.fn>
const suggestSpy = api.geology.suggestLitho as unknown as ReturnType<typeof vi.fn>

/** A committed litho contact anchored to one investigation — proves the column
 *  already carries accepted layers in the model. */
function makeLithoContact(anchor: { cpt_id?: string; borehole_id?: string }): FormationContactResponse {
  return {
    id: `lc-${anchor.cpt_id ?? anchor.borehole_id}`,
    cpt_id: anchor.cpt_id ?? null,
    borehole_id: anchor.borehole_id ?? null,
  } as unknown as FormationContactResponse
}

beforeEach(() => {
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// Accept path
// ---------------------------------------------------------------------------

describe('handleAcceptLithoSuggestion — #57 explicit-content invariant', () => {
  it('AC1: forwards the server updated_section to onSectionUpdated', async () => {
    acceptSpy.mockResolvedValue(makeAcceptResponse())
    const params = makeParams()
    const { result } = renderHook(() => useLithoSuggestions(params))

    const onSectionUpdated = vi.fn()
    let ret: AcceptLithoSuggestionsResponse | null = null
    await act(async () => {
      ret = await result.current.handleAcceptLithoSuggestion(0, 'S1', onSectionUpdated)
    })

    // The seeded section MUST be handed back so the explicit-content filter
    // includes the freshly-committed contact — else "nothing appears".
    expect(onSectionUpdated).toHaveBeenCalledTimes(1)
    expect(onSectionUpdated).toHaveBeenCalledWith(SECTION)
    // The handler returns the raw result for the caller's post-accept snap check.
    expect(ret).toEqual(makeAcceptResponse())
  })

  it('AC2: does NOT call onSectionUpdated when updated_section is null', async () => {
    acceptSpy.mockResolvedValue(makeAcceptResponse({ updated_section: null }))
    const params = makeParams()
    const { result } = renderHook(() => useLithoSuggestions(params))

    const onSectionUpdated = vi.fn()
    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0, 'S1', onSectionUpdated)
    })

    expect(onSectionUpdated).not.toHaveBeenCalled()
  })
})

describe('handleAcceptLithoSuggestion — #144 dirty-flag manifest', () => {
  it('AC3: records created formation + contact ids in the session-imports manifest', async () => {
    acceptSpy.mockResolvedValue(
      makeAcceptResponse({
        created_formation_ids: ['F-a', 'F-b'],
        created_contact_ids: ['C-a'],
      }),
    )
    const params = makeParams()
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0, 'S1', vi.fn())
    })

    const add = params.addToSessionImports as ReturnType<typeof vi.fn>
    expect(add).toHaveBeenCalledWith('formation', ['F-a', 'F-b'])
    expect(add).toHaveBeenCalledWith('contact', ['C-a'])
  })

  it('AC3b: a found-only accept records nothing (stays clean)', async () => {
    acceptSpy.mockResolvedValue(
      makeAcceptResponse({
        created_formation_ids: [],
        created_contact_ids: [],
        found_formation_ids: ['F-existing'],
        found_contact_ids: ['C-existing'],
      }),
    )
    const params = makeParams()
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0, 'S1', vi.fn())
    })

    expect(params.addToSessionImports as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })
})

describe('handleAcceptLithoSuggestion — verbatim copy + edits (feedback_litho_accept_verbatim_copy)', () => {
  it('AC4: POSTs exactly the one focused suggestion, never a merged/split set', async () => {
    acceptSpy.mockResolvedValue(makeAcceptResponse())
    // Two adjacent same-lithology suggestions — accept must NOT merge them.
    const suggestions = [
      makeSuggestion({ depth_top_m: 0, depth_base_m: 2, suggested_lithology: 'ZAND' }),
      makeSuggestion({ depth_top_m: 2, depth_base_m: 4, suggested_lithology: 'ZAND' }),
    ]
    const params = makeParams({ lithoSuggestions: suggestions })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0, 'S1', vi.fn())
    })

    expect(acceptSpy).toHaveBeenCalledTimes(1)
    const [projectId, modelId, body] = acceptSpy.mock.calls[0]
    expect(projectId).toBe('P1')
    expect(modelId).toBe(MODEL_ID)
    // Exactly one suggestion — the focused idx 0 — not a merge of both sands.
    expect(body.suggestions).toHaveLength(1)
    expect(body.suggestions[0].depth_top_m).toBe(0)
    expect(body.suggestions[0].depth_base_m).toBe(2)
    expect(body.cpt_id).toBe(ANCHOR_ID)
    expect(body.section_id).toBe('S1')
  })

  it('AC4b: a borehole anchor writes borehole_id (not cpt_id) — wrong-investigation guard', async () => {
    acceptSpy.mockResolvedValue(makeAcceptResponse())
    const params = makeParams({
      lithoSuggestionAnchorKind: 'borehole',
      lithoSuggestionInvestigationId: 'BH-7',
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0, 'S1', vi.fn())
    })

    const body = acceptSpy.mock.calls[0][2]
    expect(body.borehole_id).toBe('BH-7')
    expect(body.cpt_id).toBeUndefined()
  })

  it('AC5: honours a user depth edit — the accepted body carries the edited depth', async () => {
    acceptSpy.mockResolvedValue(makeAcceptResponse())
    const params = makeParams({
      lithoSuggestions: [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      // The user dragged the base down to 3.5 m.
      lithoSuggestionEdits: new Map([[0, { depth_base_m: 3.5 }]]),
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0, 'S1', vi.fn())
    })

    const body = acceptSpy.mock.calls[0][2]
    expect(body.suggestions[0].depth_base_m).toBe(3.5)
  })

  it('AC6: an API failure surfaces an error toast and returns null', async () => {
    acceptSpy.mockRejectedValue(new Error('boom'))
    const params = makeParams()
    const { result } = renderHook(() => useLithoSuggestions(params))

    let ret: AcceptLithoSuggestionsResponse | null = makeAcceptResponse()
    await act(async () => {
      ret = await result.current.handleAcceptLithoSuggestion(0, 'S1', vi.fn())
    })

    expect(ret).toBeNull()
    expect(params.toast as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'error',
      expect.any(String),
    )
    // No dirty-flag pollution on a failed accept.
    expect(params.addToSessionImports as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })
})

describe('handleAcceptLithoSuggestion — undo registration (hasWork guard)', () => {
  it('UN1: a create-bearing accept pushes an undo command', async () => {
    acceptSpy.mockResolvedValue(makeAcceptResponse())
    const params = makeParams()
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0, 'S1', vi.fn())
    })

    const push = params.pushUndo as ReturnType<typeof vi.fn>
    expect(push).toHaveBeenCalledTimes(1)
    // The command description names the lithology so Ctrl+Z is legible.
    expect(push.mock.calls[0][0].description).toContain('ZAND')
  })

  it('UN2: a found-only accept registers NO undo (nothing was created to revert)', async () => {
    acceptSpy.mockResolvedValue(
      makeAcceptResponse({
        created_formation_ids: [],
        created_contact_ids: [],
        found_formation_ids: ['F-existing'],
        found_contact_ids: ['C-existing'],
      }),
    )
    const params = makeParams()
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptLithoSuggestion(0, 'S1', vi.fn())
    })

    expect(params.pushUndo as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// Accept-all — same #57 / #144 invariants, per the common "Accept all" button
// ---------------------------------------------------------------------------

describe('handleAcceptAllLithoSuggestions', () => {
  it('AA1 (#57): forwards updated_section to onSectionUpdated', async () => {
    acceptSpy.mockResolvedValue(makeAcceptResponse())
    const params = makeParams({ lithoSuggestions: [makeSuggestion(), makeSuggestion({ depth_top_m: 2, depth_base_m: 4 })] })
    const { result } = renderHook(() => useLithoSuggestions(params))

    const onSectionUpdated = vi.fn()
    await act(async () => {
      await result.current.handleAcceptAllLithoSuggestions('S1', onSectionUpdated)
    })

    expect(onSectionUpdated).toHaveBeenCalledTimes(1)
    expect(onSectionUpdated).toHaveBeenCalledWith(SECTION)
  })

  it('AA2 (#57 negative): no onSectionUpdated when updated_section is null', async () => {
    acceptSpy.mockResolvedValue(makeAcceptResponse({ updated_section: null }))
    const params = makeParams({ lithoSuggestions: [makeSuggestion(), makeSuggestion()] })
    const { result } = renderHook(() => useLithoSuggestions(params))

    const onSectionUpdated = vi.fn()
    await act(async () => {
      await result.current.handleAcceptAllLithoSuggestions('S1', onSectionUpdated)
    })

    expect(onSectionUpdated).not.toHaveBeenCalled()
  })

  it('AA3 (#144): records created ids in the session-imports manifest', async () => {
    acceptSpy.mockResolvedValue(
      makeAcceptResponse({ created_formation_ids: ['F-a'], created_contact_ids: ['C-a', 'C-b'] }),
    )
    const params = makeParams({ lithoSuggestions: [makeSuggestion(), makeSuggestion()] })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptAllLithoSuggestions('S1', vi.fn())
    })

    const add = params.addToSessionImports as ReturnType<typeof vi.fn>
    expect(add).toHaveBeenCalledWith('formation', ['F-a'])
    expect(add).toHaveBeenCalledWith('contact', ['C-a', 'C-b'])
  })

  it('AA3b (#144): a found-only accept-all records nothing', async () => {
    acceptSpy.mockResolvedValue(
      makeAcceptResponse({
        created_formation_ids: [],
        created_contact_ids: [],
        found_formation_ids: ['F-x'],
        found_contact_ids: ['C-x'],
      }),
    )
    const params = makeParams({ lithoSuggestions: [makeSuggestion(), makeSuggestion()] })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptAllLithoSuggestions('S1', vi.fn())
    })

    expect(params.addToSessionImports as ReturnType<typeof vi.fn>).not.toHaveBeenCalled()
  })

  it('AA4: excludes rejected indices from the POST body (honours the user reject)', async () => {
    acceptSpy.mockResolvedValue(makeAcceptResponse())
    const suggestions = [
      makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
      makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }), // idx 1 — rejected
      makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
    ]
    const params = makeParams({
      lithoSuggestions: suggestions,
      lithoSuggestionRejected: new Set([1]),
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptAllLithoSuggestions('S1', vi.fn())
    })

    const body = acceptSpy.mock.calls[0][2]
    expect(body.suggestions).toHaveLength(2)
    // The rejected layer (top=2) must not be in the committed set.
    expect(body.suggestions.some((s: LithoLayerSuggestion) => s.depth_top_m === 2)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Bulk single-accept — reads the ghost store, same #57 / #144 invariants
// ---------------------------------------------------------------------------

describe('handleAcceptBulkLitho', () => {
  it('BK1 (#57): forwards updated_section to onSectionUpdated', async () => {
    acceptSpy.mockResolvedValue(makeAcceptResponse())
    const params = makeParams({
      ghostsByAnchor: new Map([[ANCHOR_ID, makeGhost()]]),
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    const onSectionUpdated = vi.fn()
    await act(async () => {
      await result.current.handleAcceptBulkLitho(ANCHOR_ID, 0, 'S1', onSectionUpdated)
    })

    expect(onSectionUpdated).toHaveBeenCalledTimes(1)
    expect(onSectionUpdated).toHaveBeenCalledWith(SECTION)
  })

  it('BK2 (#144): records created ids from the ghost-store accept', async () => {
    acceptSpy.mockResolvedValue(
      makeAcceptResponse({ created_formation_ids: ['F-b'], created_contact_ids: ['C-b'] }),
    )
    const params = makeParams({
      ghostsByAnchor: new Map([[ANCHOR_ID, makeGhost()]]),
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleAcceptBulkLitho(ANCHOR_ID, 0, 'S1', vi.fn())
    })

    const add = params.addToSessionImports as ReturnType<typeof vi.fn>
    expect(add).toHaveBeenCalledWith('formation', ['F-b'])
    expect(add).toHaveBeenCalledWith('contact', ['C-b'])
  })
})

// ---------------------------------------------------------------------------
// effectiveLithoSuggestionAt — pure edit overlay
// ---------------------------------------------------------------------------

describe('effectiveLithoSuggestionAt', () => {
  it('EF1: returns the original suggestion unchanged when no edit exists', () => {
    const original = makeSuggestion({ depth_top_m: 1, depth_base_m: 3 })
    const params = makeParams({ lithoSuggestions: [original], lithoSuggestionEdits: new Map() })
    const { result } = renderHook(() => useLithoSuggestions(params))

    expect(result.current.effectiveLithoSuggestionAt(0)).toEqual(original)
  })

  it('EF2: overlays a depth edit; unspecified fields fall through to the original', () => {
    const params = makeParams({
      lithoSuggestions: [makeSuggestion({ depth_top_m: 1, depth_base_m: 3, suggested_lithology: 'KLEI' })],
      lithoSuggestionEdits: new Map([[0, { depth_top_m: 1.5 }]]),
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    const eff = result.current.effectiveLithoSuggestionAt(0)
    expect(eff?.depth_top_m).toBe(1.5)
    expect(eff?.depth_base_m).toBe(3) // untouched
    expect(eff?.suggested_lithology).toBe('KLEI') // untouched
  })

  it('EF3: returns null for an out-of-range index', () => {
    const params = makeParams({ lithoSuggestions: [makeSuggestion()] })
    const { result } = renderHook(() => useLithoSuggestions(params))

    expect(result.current.effectiveLithoSuggestionAt(5)).toBeNull()
    expect(result.current.effectiveLithoSuggestionAt(-1)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// reject / unreject — focused anchor rejected-set (#80)
// ---------------------------------------------------------------------------

/** Apply the last updater fn passed to setGhostsByAnchor against a seed Map. */
function applyLastGhostUpdater(
  setSpy: ReturnType<typeof vi.fn>,
  seed: ReadonlyMap<string, BulkAnchorGhost>,
): ReadonlyMap<string, BulkAnchorGhost> {
  const updater = setSpy.mock.calls.at(-1)?.[0] as (
    prev: ReadonlyMap<string, BulkAnchorGhost>,
  ) => ReadonlyMap<string, BulkAnchorGhost>
  return updater(seed)
}

describe('reject / unreject litho suggestion', () => {
  it('RJ1: reject adds the index to the focused anchor rejected set', () => {
    const params = makeParams()
    const { result } = renderHook(() => useLithoSuggestions(params))
    const setSpy = params.setGhostsByAnchor as ReturnType<typeof vi.fn>
    setSpy.mockClear() // drop the mount-effect clear call

    act(() => {
      result.current.handleRejectLithoSuggestion(2)
    })

    const seed = new Map([[ANCHOR_ID, makeGhost()]])
    const next = applyLastGhostUpdater(setSpy, seed)
    expect(next.get(ANCHOR_ID)?.rejected.has(2)).toBe(true)
  })

  it('RJ2: unreject removes the index; a non-rejected index is a no-op', () => {
    const params = makeParams()
    const { result } = renderHook(() => useLithoSuggestions(params))
    const setSpy = params.setGhostsByAnchor as ReturnType<typeof vi.fn>

    // Unreject an index that IS rejected → removed.
    setSpy.mockClear()
    act(() => {
      result.current.handleUnrejectLithoSuggestion(2)
    })
    const seedRejected = new Map([[ANCHOR_ID, makeGhost({ rejected: new Set([2]) })]])
    const afterRemove = applyLastGhostUpdater(setSpy, seedRejected)
    expect(afterRemove.get(ANCHOR_ID)?.rejected.has(2)).toBe(false)

    // Unreject an index that is NOT rejected → identity preserved (no-op).
    setSpy.mockClear()
    act(() => {
      result.current.handleUnrejectLithoSuggestion(9)
    })
    const seedClean = new Map([[ANCHOR_ID, makeGhost()]])
    const afterNoop = applyLastGhostUpdater(setSpy, seedClean)
    // Unrejecting a layer that was never rejected changes nothing.
    expect(afterNoop.get(ANCHOR_ID)?.rejected.has(9)).toBe(false)
    // ...and preserves Map identity so React skips a needless re-render (#80).
    expect(afterNoop).toBe(seedClean)
  })
})

// ---------------------------------------------------------------------------
// Model-switch effect — B-1 data-integrity: clear stale ghosts on model change
// ---------------------------------------------------------------------------

describe('active-litho-model change clears the ghost overlay', () => {
  it('B5: switching the active model clears the focused anchor ghost', () => {
    const params = makeParams()
    const { rerender } = renderHook((p: UseLithoSuggestionsParams) => useLithoSuggestions(p), {
      initialProps: params,
    })
    const setSpy = params.setGhostsByAnchor as ReturnType<typeof vi.fn>
    // Drop the mount-time clear so we observe only the model-switch effect.
    setSpy.mockClear()

    const model2 = { id: 'M-litho-2', kind: 'lithostratigraphic' } as unknown as GeologicalModelResponse
    rerender({ ...params, activeLithoModel: model2 })

    // The effect fired: the focused anchor's ghost entry is deleted so an
    // accept can never fire against the OLD anchor into the NEW model.
    expect(setSpy).toHaveBeenCalled()
    const seed = new Map([[ANCHOR_ID, makeGhost()]])
    const next = applyLastGhostUpdater(setSpy, seed)
    expect(next.has(ANCHOR_ID)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Skip columns that already carry accepted litho layers (owner ruling
// 2026-09-07, installer #22 dogfeed). "Don't do that" — after accepting a
// test's layers on the first profile, Suggest-all on the second profile
// suggested new ghosts over the accepted layers. The skip is MODEL-WIDE: a
// column counts as accepted regardless of which section it was accepted on.
// ---------------------------------------------------------------------------
describe('handleSuggestAllLitho — skips columns with accepted layers', () => {
  it('SK1: a column with accepted layers gets no new suggestions from suggest-all', async () => {
    suggestSpy.mockResolvedValue({ layers: [makeSuggestion()] })
    // CPT-1 already carries an accepted litho contact in the model; CPT-2 is fresh.
    const params = makeParams({
      lithoContacts: [makeLithoContact({ cpt_id: 'CPT-1' })],
      // No focused single entry, so the start-wipe keeps nothing.
      focusedSuggestAnchorId: null,
      focusedSuggestAnchorIdRef: { current: null },
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleSuggestAllLitho([
        { kind: 'cpt', id: 'CPT-1', surfaceElevationM: 10 },
        { kind: 'cpt', id: 'CPT-2', surfaceElevationM: 10 },
      ])
    })

    // Only the fresh column CPT-2 was segmented; the accepted column CPT-1 was skipped.
    expect(suggestSpy).toHaveBeenCalledTimes(1)
    const body = suggestSpy.mock.calls[0][2]
    expect(body.cpt_id ?? body.borehole_id).toBe('CPT-2')
  })

  it('SK2: the toast says how many columns were skipped for carrying accepted layers', async () => {
    suggestSpy.mockResolvedValue({ layers: [makeSuggestion()] })
    const params = makeParams({
      lithoContacts: [makeLithoContact({ cpt_id: 'CPT-1' })],
      focusedSuggestAnchorId: null,
      focusedSuggestAnchorIdRef: { current: null },
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleSuggestAllLitho([
        { kind: 'cpt', id: 'CPT-1', surfaceElevationM: 10 },
        { kind: 'cpt', id: 'CPT-2', surfaceElevationM: 10 },
      ])
    })

    const toast = params.toast as ReturnType<typeof vi.fn>
    const messages = toast.mock.calls.map(c => String(c[1]))
    expect(messages.some(m => /skip/i.test(m))).toBe(true)
  })

  it('SK4: when every column already has accepted layers, nothing is segmented', async () => {
    suggestSpy.mockResolvedValue({ layers: [makeSuggestion()] })
    const params = makeParams({
      lithoContacts: [
        makeLithoContact({ cpt_id: 'CPT-1' }),
        makeLithoContact({ cpt_id: 'CPT-2' }),
      ],
      focusedSuggestAnchorId: null,
      focusedSuggestAnchorIdRef: { current: null },
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleSuggestAllLitho([
        { kind: 'cpt', id: 'CPT-1', surfaceElevationM: 10 },
        { kind: 'cpt', id: 'CPT-2', surfaceElevationM: 10 },
      ])
    })

    expect(suggestSpy).not.toHaveBeenCalled()
    const toast = params.toast as ReturnType<typeof vi.fn>
    const messages = toast.mock.calls.map(c => String(c[1]))
    expect(messages.some(m => /skip/i.test(m))).toBe(true)
  })
})

describe('handleSuggestLitho — per-column skip when the column has accepted layers', () => {
  it('SK3: a Suggest on a column that already carries accepted layers does not fetch', async () => {
    suggestSpy.mockResolvedValue({ layers: [makeSuggestion()] })
    const params = makeParams({
      lithoContacts: [makeLithoContact({ cpt_id: 'CPT-1' })],
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleSuggestLitho('cpt', 'CPT-1')
    })

    expect(suggestSpy).not.toHaveBeenCalled()
    expect(params.toast as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
      'warning',
      expect.any(String),
    )
  })

  it('SK3b: a Suggest on a fresh column still fetches', async () => {
    suggestSpy.mockResolvedValue({ layers: [makeSuggestion()] })
    const params = makeParams({
      lithoContacts: [makeLithoContact({ cpt_id: 'CPT-1' })],
    })
    const { result } = renderHook(() => useLithoSuggestions(params))

    await act(async () => {
      await result.current.handleSuggestLitho('cpt', 'CPT-2')
    })

    expect(suggestSpy).toHaveBeenCalledTimes(1)
  })
})
