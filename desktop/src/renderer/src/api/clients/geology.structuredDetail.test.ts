// Audit follow-on 2026-08-02: the bare-`fetch` endpoints in the geology client
// bypass `request()` and built their own error message with
// `detail.detail ?? <fallback>`. That is the SAME defect the shared core just
// shed — an object `detail` stringifies to "[object Object]" — and these routes
// are exactly the ones FastAPI answers with an object.
//
// `litho_layer_overlap` (routers/_helpers.py, routers/geology/litho_layers.py)
// is the everyday case: the engineer drags a boundary past its neighbour and
// the server explains which column and why. That explanation is the point.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { geologyClient } from './geology'
import { setBaseUrl } from './shared'

const BASE = 'http://127.0.0.1:8765'

beforeEach(() => setBaseUrl(BASE))
afterEach(() => {
  vi.restoreAllMocks()
  setBaseUrl(BASE)
})

/** Reply to the next fetch with `body` serialised as JSON at `status`. */
function mockJsonResponse(status: number, body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

const OVERLAP_MESSAGE =
  'This layer would overlap the layer below it on GEO-22/115-S10 — move the boundary above 15.10 m.'

describe('geology client — structured details on the bare-fetch endpoints', () => {
  // GD1: PATCH layers → the exclusion-constraint 409.
  it('updateLayer surfaces the litho_layer_overlap message', async () => {
    mockJsonResponse(409, {
      detail: { code: 'litho_layer_overlap', message: OVERLAP_MESSAGE },
    })

    const err = (await geologyClient
      .updateLayer('p', 'm', 'l', { depth_base_m: 15.4 })
      .catch((e: unknown) => e)) as Error

    expect(err.message).toBe(OVERLAP_MESSAGE)
    expect(err.message).not.toContain('[object Object]')
  })

  // GD2: PATCH contacts → the same constraint, reached by the boundary drag.
  it('updateContact surfaces the litho_layer_overlap message', async () => {
    mockJsonResponse(409, {
      detail: { code: 'litho_layer_overlap', message: OVERLAP_MESSAGE },
    })

    const err = (await geologyClient
      .updateContact('p', 'm', 'c', { depth_top_m: 15.4 })
      .catch((e: unknown) => e)) as Error

    expect(err.message).toBe(OVERLAP_MESSAGE)
    expect(err.message).not.toContain('[object Object]')
  })

  // GD3: the string-detail majority must read exactly as before.
  it('passes a plain string detail through verbatim', async () => {
    mockJsonResponse(409, { detail: 'Delete the dependent model first.' })

    const err = (await geologyClient
      .deleteLayer('p', 'm', 'l')
      .catch((e: unknown) => e)) as Error

    expect(err.message).toBe('Delete the dependent model first.')
  })

  // GD4: no detail at all still falls back to each endpoint's historical copy.
  it('falls back to the endpoint label when the server sends no detail', async () => {
    mockJsonResponse(500, {})

    const err = (await geologyClient
      .updateLayer('p', 'm', 'l', { depth_base_m: 1 })
      .catch((e: unknown) => e)) as Error

    expect(err.message).toBe('updateLayer failed (500)')
  })
})
