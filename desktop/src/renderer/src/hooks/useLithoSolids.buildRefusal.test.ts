// A cancelled build must tell the engineer WHY, not "check the connection".
//
// Audit 2026-08-02, Class 1: the build swallowed missing inputs and toasted
// "Built N bodies". Now the request builder refuses with a
// ``VoxelBuildInputsError`` whose message is written for the engineer — this
// pins that the handler surfaces that message verbatim and never POSTs a
// build, so no generation is persisted from a partial input set.
//
// WHY THIS FILE MOCKS ``fetch`` AND NOT ``api/client`` (rewrite 2026-08-02):
// the previous version mocked the api client and handed the hook error objects
// it built by hand. Those shapes were not the shapes ``request()`` produces, so
// the suite stayed green through a live failure where a 422 refusal reached the
// user as "ApiError: [object Object]". Driving the real client against a mocked
// ``Response`` means these tests exercise the same body-parsing the app does —
// a divergence between test and product can no longer hide here.

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { useLithoSolids } from './useLithoSolids'
import { setBaseUrl } from '../api/clients/shared'
import { VoxelBuildInputsError } from '../utils/voxelBuildInputsError'

const BASE = 'http://127.0.0.1:8765'

/** Body + status the POST .../litho-solids/build-voxel route replies with. */
let buildReply: { status: number; body: unknown }

/** Every POST the mocked transport saw — BR1 asserts the build never happened. */
let posted: string[] = []

beforeEach(() => {
  vi.clearAllMocks()
  setBaseUrl(BASE)
  posted = []
  buildReply = { status: 200, body: { bodies_built: 3, bodies_flagged: 0, solids: [] } }

  // Route by verb: the mount-time GET lists solids, the POST is the build.
  vi.spyOn(globalThis, 'fetch').mockImplementation(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') {
        posted.push(String(input))
        return new Response(JSON.stringify(buildReply.body), {
          status: buildReply.status,
          headers: { 'Content-Type': 'application/json' },
        })
      }
      return new Response('[]', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    },
  )
})

/** A minimal non-empty voxel request — enough to pass the "nothing to build" gate. */
const builder = (): Promise<unknown> => Promise.resolve({ sections: [{}] })

describe('useLithoSolids — BR1: a refused build reaches the user', () => {
  it('toasts the refusal message and does not POST a build', async () => {
    const toast = vi.fn()
    const refusal = new VoxelBuildInputsError(
      'Could not build — correlations failed to load for 1 of 14 cross-section(s): ' +
        'Tie-section 12. Nothing was changed; retry the build.',
    )

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(() => Promise.reject(refusal))
    })

    expect(posted).toHaveLength(0)
    expect(toast).toHaveBeenCalledWith('error', refusal.message)
  })

  it('still shows the generic connection copy for an unrelated failure', async () => {
    const toast = vi.fn()

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(() => Promise.reject(new Error('socket hang up')))
    })

    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('Check the connection'))
  })
})

// BR3 — the failure observed live on 2026-08-02. The backend refuses an
// over-large grid with a 422 whose detail carries the reason AND the spacing to
// retry at; the engineer saw "ApiError: [object Object]" and no way to act.
describe('useLithoSolids — BR3: an over-large voxel grid is refused in words', () => {
  const REFUSAL_MESSAGE =
    'The requested spacing needs 1,412,000,000 voxels; a single build may allocate 200,000,000.'

  beforeEach(() => {
    buildReply = {
      status: 422,
      body: {
        detail: {
          code: 'voxel_grid_too_large',
          message: REFUSAL_MESSAGE,
          suggested_horizontal_m: 0.99,
        },
      },
    }
  })

  it('toasts the server reason instead of a stringified object', async () => {
    const toast = vi.fn()

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    const [severity, message] = toast.mock.calls.at(-1) as [string, string]
    expect(severity).toBe('error')
    expect(message).toContain(REFUSAL_MESSAGE)
    expect(message).not.toContain('[object Object]')
  })

  it('names the spacing to retry at, because the refusal carries it as a number', async () => {
    const toast = vi.fn()

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    const [, message] = toast.mock.calls.at(-1) as [string, string]
    expect(message).toContain('0.99')
    // The generic copy would send the engineer to check a connection that is fine.
    expect(message).not.toContain('Check the connection')
  })

  it('keeps the generic copy for a 422 that is not a grid-budget refusal', async () => {
    buildReply = { status: 422, body: { detail: { code: 'something_else' } } }
    const toast = vi.fn()

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    const [severity, message] = toast.mock.calls.at(-1) as [string, string]
    expect(severity).toBe('error')
    expect(message).toContain('Check the connection')
  })
})

// A build that built NOTHING also DELETED the stored 3-D model. It must never
// read as a build that happened.
describe('useLithoSolids — BR2: an empty build is never a green success', () => {
  it('warns, names the cause, and says the stored model was cleared', async () => {
    const toast = vi.fn()
    buildReply = {
      status: 200,
      body: {
        bodies_built: 0,
        bodies_flagged: 0,
        solids: [],
        empty_reason:
          'the investigations do not frame an area — a footprint needs at least 3 that do not sit on one line',
      },
    }

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    const [severity, message] = toast.mock.calls.at(-1) as [string, string]
    expect(severity).toBe('warning')
    expect(message).toContain('one line')
    expect(message).toMatch(/cleared|removed|gone/i)
  })

  it('leaves a build that produced bodies on the plain success copy', async () => {
    const toast = vi.fn()
    buildReply = {
      status: 200,
      body: { bodies_built: 4, bodies_flagged: 0, solids: [], empty_reason: null },
    }

    const { result } = renderHook(() => useLithoSolids('proj-1', 'model-1', toast))

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('Built 4 bodies'))
  })
})

describe('useLithoSolids — RF1: a band edit re-fetches the solids', () => {
  // Backend band edits stamp is_stale on the solids, but the amber Build badge
  // only reflects it after a LIST re-fetch — and until 2026-08-08 the fetch
  // re-ran solely on a build. ``refreshOn`` is the channel: the geotech
  // instance passes geotechLayersVersion, so every committed band edit
  // re-fetches and the badge ambers without a manual reload.
  it('re-runs the list fetch when refreshOn changes', async () => {
    const toast = vi.fn()
    // Counts the SOLID-LIST fetch specifically, not every GET the effect
    // makes. The effect also reads the last build's gapless verdict from its
    // own endpoint, and a counter that cannot tell the two apart would fail
    // this test for a reason that has nothing to do with what it claims.
    const countGets = (): number =>
      (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter(call => {
        const init = call[1] as RequestInit | undefined
        return (init?.method ?? 'GET') === 'GET' && String(call[0]).endsWith('/litho-solids')
      }).length

    const { rerender } = renderHook(
      ({ nonce }: { nonce: number }) => useLithoSolids('proj-1', 'model-1', toast, nonce),
      { initialProps: { nonce: 0 } },
    )
    await act(async () => {})
    const getsAfterMount = countGets()

    rerender({ nonce: 1 })
    await act(async () => {})
    expect(countGets()).toBe(getsAfterMount + 1)

    // Same value again — no spurious re-fetch.
    rerender({ nonce: 1 })
    await act(async () => {})
    expect(countGets()).toBe(getsAfterMount + 1)
  })
})

// ---------------------------------------------------------------------------
// BD — a build is an unsaved change like any other
// ---------------------------------------------------------------------------
//
// Owner, 2026-08-10: "i build the litho model, i clicked the x on top right, i
// didn't even get a discard all changes. when i reopen the model is still there".
//
// He is right that this breaks the rule the rest of the app follows. The close
// prompt gates on ``projectDirty`` (useProjectLifecycle.attemptClose), and building
// never set it — so a build slipped out of the save story entirely: no prompt on
// close, and nothing to discard against. It is not a derived cache that can be
// shrugged off either; ``litho_solids`` is carried in the .strix bundle, so a build
// genuinely changes what a save would write.

describe('useLithoSolids — BD1: a completed build marks the project dirty', () => {
  it('calls onMutated after the build lands', async () => {
    const toast = vi.fn()
    const onMutated = vi.fn()

    const { result } = renderHook(() =>
      useLithoSolids('proj-1', 'model-1', toast, undefined, onMutated),
    )

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    expect(onMutated).toHaveBeenCalledTimes(1)
  })

  it('BD2 — but a REFUSED build changes nothing, so it marks nothing', async () => {
    // The negative control. Without it, calling onMutated unconditionally at the top
    // of the function would pass BD1 and make every failed attempt look like an edit.
    buildReply = { status: 422, body: { detail: 'refused' } }
    const toast = vi.fn()
    const onMutated = vi.fn()

    const { result } = renderHook(() =>
      useLithoSolids('proj-1', 'model-1', toast, undefined, onMutated),
    )

    await act(async () => {
      await result.current.buildLithoSolids(builder as never)
    })

    expect(onMutated).not.toHaveBeenCalled()
  })
})
