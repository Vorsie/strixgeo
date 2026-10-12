// Behavioural net for useDovImportStream — the DOV import SSE state machine.
// Pins the error/abort paths (a failed import MUST surface an error state, not
// hang in "running") + the happy done transition, driven through a mocked
// fetch: the two-step spawn(POST 202 {job_id}) → connect(GET SSE stream) flow.
//
//   DS1  start() immediately enters the running state.
//   DS2  a failed spawn POST → error state carrying the server detail.
//   DS3  a failed stream-connect GET → error state.
//   DS4  a 200 stream with no body → error "No response body".
//   DS5  a server-side `error` SSE event → error state carrying its message.
//   DS6  a `done` SSE event → done state carrying the result payload.
//   DS7  reset() aborts any in-flight import and returns to idle.

import { renderHook, waitFor, act } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useDovImportStream } from './useDovImportStream'
import { DEFAULT_API_BASE_URL, setBaseUrl } from '../api/clients/shared'

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

const CPT_START = {
  kind: 'cpt' as const,
  bbox: { west: 3.0, south: 51.0, east: 3.1, north: 51.1 },
  projectId: 'P1',
}

/** A minimal JSON Response stand-in. */
function jsonResponse(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body } as unknown as Response
}

/** A 200 SSE Response whose body is a ReadableStream emitting the given frames.
 *  Each frame should already be a full `data: <json>\n\n` block. */
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

describe('useDovImportStream', () => {
  it('DS1: start() immediately enters the running state', () => {
    // Never-resolving fetch so we observe the synchronous running transition.
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useDovImportStream())

    act(() => {
      result.current.start(CPT_START)
    })

    expect(result.current.state.status).toBe('running')
    if (result.current.state.status === 'running') {
      expect(result.current.state.kind).toBe('cpt')
    }
  })

  it('DS2: a failed spawn POST surfaces the server detail as an error', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(false, 422, { detail: 'bbox too large' }))
    const { result } = renderHook(() => useDovImportStream())

    act(() => {
      result.current.start(CPT_START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('error'))
    if (result.current.state.status === 'error') {
      expect(result.current.state.message).toBe('bbox too large')
    }
  })

  it('DS3: a failed stream-connect GET surfaces an error', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-1' })) // spawn ok
      .mockResolvedValueOnce(jsonResponse(false, 500, { detail: 'stream gone' })) // connect fails
    const { result } = renderHook(() => useDovImportStream())

    act(() => {
      result.current.start(CPT_START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('error'))
    if (result.current.state.status === 'error') {
      expect(result.current.state.message).toBe('stream gone')
    }
  })

  it('DS4: a 200 stream with no body → error "No response body"', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-1' }))
      .mockResolvedValueOnce({ ok: true, status: 200, body: null } as unknown as Response)
    const { result } = renderHook(() => useDovImportStream())

    act(() => {
      result.current.start(CPT_START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('error'))
    if (result.current.state.status === 'error') {
      expect(result.current.state.message).toMatch(/No response body/i)
    }
  })

  it('DS5: a server-side `error` SSE event → error state with its message', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-1' }))
      .mockResolvedValueOnce(sseResponse([frame({ type: 'error', message: 'DOV unreachable' })]))
    const { result } = renderHook(() => useDovImportStream())

    act(() => {
      result.current.start(CPT_START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('error'))
    if (result.current.state.status === 'error') {
      expect(result.current.state.message).toBe('DOV unreachable')
    }
  })

  it('DS6: a `done` SSE event → done state carrying the result payload', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(true, 202, { job_id: 'job-1' }))
      .mockResolvedValueOnce(
        sseResponse([
          frame({ type: 'done', imported: 3, duplicates: 1, failed: 0, cpt_ids: ['a', 'b', 'c'] }),
        ]),
      )
    const { result } = renderHook(() => useDovImportStream())

    act(() => {
      result.current.start(CPT_START)
    })

    await waitFor(() => expect(result.current.state.status).toBe('done'))
    if (result.current.state.status === 'done') {
      expect(result.current.state.kind).toBe('cpt')
      expect((result.current.state.result as { imported: number }).imported).toBe(3)
    }
  })

  it('DS7: reset() aborts an in-flight import and returns to idle', () => {
    fetchMock.mockReturnValue(new Promise(() => {})) // hang forever
    const { result } = renderHook(() => useDovImportStream())

    act(() => {
      result.current.start(CPT_START)
    })
    expect(result.current.state.status).toBe('running')

    act(() => {
      result.current.reset()
    })
    expect(result.current.state.status).toBe('idle')
  })
})

// Tester finding 2026-10-12: a packaged engine may listen on a port other than
// 8765. The DOV import stream must target the API base the app learned from main,
// never a hard-coded :8765.
describe('useDovImportStream - the engine port the app learned', () => {
  afterEach(() => setBaseUrl(DEFAULT_API_BASE_URL))

  it('DS8: spawns against the configured API base, not :8765', () => {
    setBaseUrl('http://127.0.0.1:8767')
    fetchMock.mockReturnValue(new Promise(() => {}))
    const { result } = renderHook(() => useDovImportStream())
    act(() => {
      result.current.start(CPT_START)
    })
    expect(String(fetchMock.mock.calls[0][0])).toMatch(/^http:\/\/127\.0\.0\.1:8767\//)
  })
})
