// Rule (e2e sweeps 2 and 3, 2026-09-03): the build's terminal ``done`` frame
// carries every solid mesh — megabytes in ONE SSE line. The hook must still
// land in ``status: 'done'`` with that result; three Build specs sat at
// "Extracting body solids… 0%" with Cancel showing while the backend had
// logged SUCCESS and served the stream to its end.
import { describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

import { useVoxelBuildStream } from './useVoxelBuildStream'

function sseResponse(frames: string[]): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const f of frames) controller.enqueue(encoder.encode(f))
      controller.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

describe('useVoxelBuildStream — a multi-megabyte done frame', () => {
  it('lands in done with the result when the terminal frame is several megabytes long', async () => {
    // ~4 MB of mesh-like payload, split into 64 KB chunks the way a real
    // response body arrives.
    const solids = Array.from({ length: 40 }, (_, i) => ({
      id: `solid-${i}`,
      vertices: Array.from({ length: 6000 }, (__, k) => k * 0.25),
    }))
    const done = `data: ${JSON.stringify({ type: 'done', bodies_built: solids.length, solids })}\n\n`
    const chunks: string[] = ['data: {"type":"progress","phase":"extract","done":0,"total":1}\n\n']
    for (let i = 0; i < done.length; i += 65536) chunks.push(done.slice(i, i + 65536))

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ job_id: 'job-1' }), { status: 202 }))
      .mockResolvedValueOnce(sseResponse(chunks))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const { result } = renderHook(() => useVoxelBuildStream())
      await result.current.start({
        projectId: 'p',
        modelId: 'm',
        request: { sections: [], grid_spacing_m: 1 } as never,
      })
      await waitFor(() => expect(result.current.state.status).toBe('done'), { timeout: 10_000 })
      const state = result.current.state as { status: 'done'; result: { bodies_built: number } }
      expect(state.result.bodies_built).toBe(solids.length)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
