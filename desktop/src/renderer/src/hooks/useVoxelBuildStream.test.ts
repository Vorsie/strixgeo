// Behavioural net for useVoxelBuildStream — the voxel-build SSE state machine
// (debt #282). Driven through a mocked fetch: the two-step spawn(POST 202
// {job_id}) → connect(GET SSE stream) flow, plus the cancel POST.
//
//   VB1  start() immediately enters the running state.
//   VB2  a failed spawn POST → error state carrying the server detail.
//   VB3  a failed stream-connect GET → error state.
//   VB4  a `progress` SSE event → running state carrying the latest tick.
//   VB5  a `done` SSE event → done state carrying the result payload.
//   VB6  a `build_cancelled` error SSE event → CANCELLED state, not error.
//   VB7  any other `error` SSE event → error state carrying its message.
//   VB8  reset() aborts the stream and returns to idle.
//   VB9  cancel() POSTs to the cancel endpoint and flips cancelRequested on.
//   VB10 a `voxel_grid_too_large` error SSE event → error state carrying the
//        SAME actionable copy the synchronous build shows (the suggested spacing
//        + "model unchanged"), NOT the raw server sentence (debt #282 parity).

import { renderHook, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useVoxelBuildStream } from './useVoxelBuildStream'
import { DEFAULT_API_BASE_URL, setBaseUrl } from '../api/clients/shared'
import type { VoxelBuildRequest } from '../utils/buildVoxelRequest'

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

const START = {
  projectId: 'P1',
  modelId: 'M1',
  request: { sections: [], grid_spacing_m: 2.0 } as unknown as VoxelBuildRequest,
}

/** A minimal JSON Response stand-in. */
function jsonResponse(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

/** A 200 SSE Response whose body emits the frames then CLOSES. */
function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
  return { ok: true, status: 200, body } as unknown as Response
}

/** A 200 SSE Response that emits the frames then STAYS OPEN (never closes),
 *  so an intermediate progress state can be observed. */
function sseResponseOpen(frames: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      // Deliberately no controller.close() — the stream stays open.
    },
  })
  return { ok: true, status: 200, body } as unknown as Response
}

function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('useVoxelBuildStream', () => {
  it('VB1: start() immediately enters the running state', () => {
    fetchMock.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
    })

    expect(result.current.state.status).toBe('running')
  })

  it('VB11: a second Build click while the first build is still running is ignored, one job only', () => {
    // The walker (installer #41 chain) double-clicked Build: the second click
    // landed before the first click's render, re-entered start(), ABORTED the
    // first spawn and POSTed again, and the server's "a 3-D build for this
    // model is already running" answer became a red error toast while the
    // build actually ran. One click, one job: the second start() is a no-op.
    fetchMock.mockReturnValue(new Promise(() => {})) // never resolves
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
      result.current.start(START)
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.state.status).toBe('running')
  })

  it('VB2: a failed spawn POST surfaces the server detail as an error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 422, { detail: 'model not found' }))
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('error'))
    if (result.current.state.status === 'error') {
      expect(result.current.state.message).toBe('model not found')
    }
  })

  it('VB3: a failed stream-connect GET surfaces an error', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-1' }))
      .mockResolvedValueOnce(jsonResponse(false, 404, { detail: 'stream gone' }))
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('error'))
    if (result.current.state.status === 'error') {
      expect(result.current.state.message).toBe('stream gone')
    }
  })

  it('VB4: a `progress` SSE event carries the latest tick in the running state', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-1' }))
      .mockResolvedValueOnce(
        sseResponseOpen([frame({ type: 'progress', phase: 'label', done: 3, total: 12 })]),
      )
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
    })

    await waitFor(() => {
      const s = result.current.state
      expect(s.status).toBe('running')
      if (s.status === 'running') expect(s.latest?.phase).toBe('label')
    })
    if (result.current.state.status === 'running') {
      expect(result.current.state.latest).toEqual({ phase: 'label', done: 3, total: 12 })
    }
  })

  it('VB5: a `done` SSE event → done state carrying the result payload', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-1' }))
      .mockResolvedValueOnce(
        sseResponse([frame({ type: 'done', bodies_built: 4, solids: [] })]),
      )
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('done'))
    if (result.current.state.status === 'done') {
      expect((result.current.state.result as { bodies_built: number }).bodies_built).toBe(4)
    }
  })

  it('VB6: a `build_cancelled` error event → cancelled state, not error', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-1' }))
      .mockResolvedValueOnce(
        sseResponse([
          frame({ type: 'error', code: 'build_cancelled', message: 'Build cancelled' }),
        ]),
      )
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('cancelled'))
  })

  it('VB7: any other error event → error state carrying its message', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-1' }))
      .mockResolvedValueOnce(
        sseResponse([frame({ type: 'error', code: 'build_failed', message: 'It broke' })]),
      )
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('error'))
  })

  it('VB10: a grid-too-large stream error shows the suggested spacing, not the raw text', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-1' }))
      .mockResolvedValueOnce(
        sseResponse([
          frame({
            type: 'error',
            code: 'voxel_grid_too_large',
            message: 'The requested grid is too large to build.',
            suggested_horizontal_m: 5,
          }),
        ]),
      )
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('error'))
    if (result.current.state.status === 'error') {
      // The stream path must produce the SAME actionable copy the synchronous
      // build shows: the retry spacing the backend computed, plus "the stored
      // model was not changed" — never the raw one-line server sentence.
      expect(result.current.state.message).toMatch(/at least 5 m/)
      expect(result.current.state.message).toMatch(/not changed/i)
    }
  })

  it('VB8: reset() aborts an in-flight build and returns to idle', () => {
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
    })
    expect(result.current.state.status).toBe('running')

    act(() => {
      result.current.reset()
    })
    expect(result.current.state.status).toBe('idle')
  })

  it('VB9: cancel() POSTs the cancel endpoint and flips cancelRequested on', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-9' })) // spawn
      .mockReturnValueOnce(new Promise(() => {})) // stream never resolves → stays running
      .mockResolvedValueOnce(jsonResponse(true, 202, { cancelling: true })) // cancel POST
    const { result } = renderHook(() => useVoxelBuildStream())

    act(() => {
      result.current.start(START)
    })
    // Wait until the spawn resolved (job id captured) and the stream fetch fired.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))

    act(() => {
      result.current.cancel()
    })

    const cancelCall = fetchMock.mock.calls.find(c =>
      String(c[0]).endsWith('/litho-solids/build-voxel/jobs/job-9/cancel'),
    )
    expect(cancelCall).toBeTruthy()
    expect((cancelCall?.[1] as { method?: string }).method).toBe('POST')
    if (result.current.state.status === 'running') {
      expect(result.current.state.cancelRequested).toBe(true)
    }
  })
})

// Tester finding 2026-10-12: a packaged engine may listen on a port other than
// 8765. The voxel build stream must target the API base the app learned from
// main, never a hard-coded :8765.
describe('useVoxelBuildStream - the engine port the app learned', () => {
  afterEach(() => setBaseUrl(DEFAULT_API_BASE_URL))

  it('VB12: spawns against the configured API base, not :8765', () => {
    setBaseUrl('http://127.0.0.1:8767')
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useVoxelBuildStream())
    act(() => {
      result.current.start(START)
    })
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/127\.0\.0\.1:8767\//)
  })
})
