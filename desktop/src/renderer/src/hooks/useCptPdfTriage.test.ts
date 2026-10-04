// Behavioural net for useCptPdfTriage: the PDF report triage job + SSE stream.
//
// Owner's dogfeed 2026-10-04: the dialog opened and showed "an import for this
// area is already running" at once. Two POSTs left 29 ms apart; the first
// stream was aborted by the client, the second POST was refused 409 with the
// running job's id, and the UI showed nothing while the job ran to the end.
//
//   PT1  the same report started twice while its triage runs is ONE upload.
//   PT2  a 409 "already running" that names the job ATTACHES to that job's
//        stream and reaches the digest, instead of failing.
//   PT3  a DIFFERENT report aborts the old stream and uploads the new one.
//   PT4  a StrictMode mount (effect, cleanup, effect) uploads once and reaches
//        the digest.
//   PT5  reset() forgets the report, so starting it again uploads again.
//   PT6  an unmount and a remount for the same report in the same tick share
//        the running triage: ONE upload, and the remount reaches the digest.
//   PT7  an unmount with no remount aborts the stream after the tick.
//   PT8  reset() aborts the stream at once, and a following start uploads again.

import { act, renderHook, waitFor } from '@testing-library/react'
import { createElement, StrictMode, useEffect, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cptPdfClient } from '../api/clients/cptPdf'
import { _clearCptPdfTriageRegistry, useCptPdfTriage } from './useCptPdfTriage'

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

const DIGEST = {
  file_sha: 'abc',
  page_count: 3,
  class_counts: {},
  campaign: [],
  unknown: [],
  dropped: [],
  desk_study_ids: [],
  report_code: null,
  campaign_codes: [],
  project_numbers: [],
  ocr_available: false,
  raster_pages_unread: 0,
  profiles: [],
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status < 400, status, json: async () => body } as unknown as Response
}

function frame(obj: unknown): string {
  return `data: ${JSON.stringify(obj)}\n\n`
}

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

/** A stream GET that never answers until its signal aborts. */
function hangingUntilAbort(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () =>
      reject(new DOMException('aborted', 'AbortError')),
    )
  })
}

/** The finished stream; like a real fetch, it rejects when the caller already aborted. */
async function done(init?: RequestInit): Promise<Response> {
  if (init?.signal?.aborted) throw new DOMException('aborted', 'AbortError')
  return sseResponse([frame({ phase: 'classify', done: 1, total: 3 }), frame({ type: 'done', result: DIGEST })])
}

let fetchMock: ReturnType<typeof vi.fn>
const originalElectron = (window as unknown as { electron?: unknown }).electron

/** POST calls to the triage endpoint. */
function triagePosts(): unknown[][] {
  return fetchMock.mock.calls.filter(
    ([url, init]) => String(url).endsWith('/cpt/pdf/triage') && (init as RequestInit)?.method === 'POST',
  )
}

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  ;(window as unknown as { electron: unknown }).electron = {
    readFile: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  }
})

afterEach(() => {
  _clearCptPdfTriageRegistry()
  vi.unstubAllGlobals()
  ;(window as unknown as { electron?: unknown }).electron = originalElectron
})

describe('useCptPdfTriage', () => {
  it('PT1: the same report started twice while it runs is uploaded once', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(202, { job_id: 'J1', file_sha: 'abc' })
      return done(init)
    })
    const { result } = renderHook(() => useCptPdfTriage())

    act(() => {
      result.current.start('C:/r/report.pdf', 'P1')
      result.current.start('C:/r/report.pdf', 'P1')
    })

    await waitFor(() => expect(result.current.state.status).toBe('done'))
    expect(triagePosts()).toHaveLength(1)
  })

  it('PT2: a 409 "already running" naming the job attaches to that job and reaches the digest', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST')
        return jsonResponse(409, {
          detail: { code: 'dov_import_already_running', message: 'already running', job_id: 'J7' },
        })
      if (url === cptPdfClient.streamUrl('J7')) return done(init)
      return jsonResponse(404, { detail: 'no such job' })
    })
    const { result } = renderHook(() => useCptPdfTriage())

    act(() => result.current.start('C:/r/report.pdf', 'P1'))

    await waitFor(() => expect(result.current.state.status).toBe('done'))
    if (result.current.state.status === 'done') expect(result.current.state.digest.file_sha).toBe('abc')
    expect(fetchMock.mock.calls.some(([url]) => url === cptPdfClient.streamUrl('J7'))).toBe(true)
  })

  it('PT3: a different report aborts the old stream and uploads the new one', async () => {
    let firstSignal: AbortSignal | undefined
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        const n = triagePosts().length
        return jsonResponse(202, { job_id: n === 1 ? 'J1' : 'J2', file_sha: 'abc' })
      }
      if (url === cptPdfClient.streamUrl('J1')) {
        firstSignal = init?.signal ?? undefined
        return hangingUntilAbort(init)
      }
      return done(init)
    })
    const { result } = renderHook(() => useCptPdfTriage())

    act(() => result.current.start('C:/r/a.pdf', 'P1'))
    await waitFor(() => expect(firstSignal).toBeDefined())
    act(() => result.current.start('C:/r/b.pdf', 'P1'))

    await waitFor(() => expect(result.current.state.status).toBe('done'))
    expect(triagePosts()).toHaveLength(2)
    expect(firstSignal?.aborted).toBe(true)
  })

  it('PT4: a StrictMode mount (effect, cleanup, effect) uploads once and reaches the digest', async () => {
    let spawned = false
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        if (spawned)
          return jsonResponse(409, {
            detail: { code: 'dov_import_already_running', message: 'already running', job_id: 'J1' },
          })
        spawned = true
        return jsonResponse(202, { job_id: 'J1', file_sha: 'abc' })
      }
      return done(init)
    })
    const wrapper = ({ children }: { children: ReactNode }) => createElement(StrictMode, null, children)
    const { result } = renderHook(
      () => {
        const triage = useCptPdfTriage()
        const { start } = triage
        useEffect(() => {
          start('C:/r/report.pdf', 'P1')
        }, [start])
        return triage
      },
      { wrapper },
    )

    await waitFor(() => expect(result.current.state.status).toBe('done'))
    // The remount joins the triage the first mount started: no second upload,
    // so no 409 in the console.
    expect(triagePosts()).toHaveLength(1)
  })

  it('PT5: reset() forgets the report, so starting it again uploads again', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(202, { job_id: 'J1', file_sha: 'abc' })
      return hangingUntilAbort(init)
    })
    const { result } = renderHook(() => useCptPdfTriage())

    act(() => result.current.start('C:/r/report.pdf', 'P1'))
    await waitFor(() => expect(triagePosts()).toHaveLength(1))
    act(() => result.current.reset())
    expect(result.current.state.status).toBe('idle')
    act(() => result.current.start('C:/r/report.pdf', 'P1'))

    await waitFor(() => expect(triagePosts()).toHaveLength(2))
  })

  it('PT6: an unmount and a remount for the same report in the same tick upload once', async () => {
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(202, { job_id: 'J1', file_sha: 'abc' })
      return done(init)
    })
    // Like the dialog: the hook's owner starts the report from an effect.
    const useDialogTriage = () => {
      const triage = useCptPdfTriage()
      const { start } = triage
      useEffect(() => {
        start('C:/r/report.pdf', 'P1')
      }, [start])
      return triage
    }
    const first = renderHook(useDialogTriage)

    // The same dialog goes away and comes back before the event loop turns.
    let second!: ReturnType<typeof renderHook<ReturnType<typeof useCptPdfTriage>, unknown>>
    act(() => {
      first.unmount()
      second = renderHook(useDialogTriage)
    })

    await waitFor(() => expect(second.result.current.state.status).toBe('done'))
    if (second.result.current.state.status === 'done')
      expect(second.result.current.state.digest.file_sha).toBe('abc')
    expect(triagePosts()).toHaveLength(1)
  })

  it('PT7: an unmount with no remount aborts the stream after the tick', async () => {
    let streamSignal: AbortSignal | undefined
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(202, { job_id: 'J1', file_sha: 'abc' })
      streamSignal = init?.signal ?? undefined
      return hangingUntilAbort(init)
    })
    const { result, unmount } = renderHook(() => useCptPdfTriage())
    act(() => result.current.start('C:/r/report.pdf', 'P1'))
    await waitFor(() => expect(streamSignal).toBeDefined())

    unmount()

    await waitFor(() => expect(streamSignal?.aborted).toBe(true))
  })

  it('PT8: reset() aborts the stream at once, and a following start uploads again', async () => {
    const streamSignals: AbortSignal[] = []
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === 'POST') return jsonResponse(202, { job_id: 'J1', file_sha: 'abc' })
      if (init?.signal) streamSignals.push(init.signal)
      return hangingUntilAbort(init)
    })
    const { result } = renderHook(() => useCptPdfTriage())
    act(() => result.current.start('C:/r/report.pdf', 'P1'))
    await waitFor(() => expect(streamSignals).toHaveLength(1))

    act(() => result.current.reset())
    // An explicit reset does not wait for the tick.
    expect(streamSignals[0].aborted).toBe(true)
    expect(result.current.state.status).toBe('idle')

    act(() => result.current.start('C:/r/report.pdf', 'P1'))
    await waitFor(() => expect(triagePosts()).toHaveLength(2))
  })
})
