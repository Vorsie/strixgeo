// Structured-`detail` handling in the shared request core.
//
// Observed live (owner dogfeed 2026-08-02): a voxel build refused with a 422
// whose `detail` is an OBJECT — `{code, message, suggested_horizontal_m}` —
// and the renderer showed "ApiError: [object Object]". The refusal, the retry
// spacing and the reason were all present on the wire and all destroyed by
// `super(detailObject)` stringifying an object into an Error message.
//
// FastAPI sends `detail` as an object from ~20 routes (voxel_grid_too_large,
// litho_layer_overlap, duplicate_contact, body_not_found, ...), so this is not
// one endpoint's problem. Pinned here at the ONE place every client funnels
// through, driving the real `request()` against a mocked `fetch` Response —
// hand-built error shapes are what let this ship green in the first place.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ApiError, apiErrorDetail, request, setBaseUrl } from './shared'

const BASE = 'http://127.0.0.1:8765'

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

describe('request() — a structured `detail` survives the throw', () => {
  // SD1: the exact body the build-voxel route sends on refusal.
  it('uses detail.message as the error message, not "[object Object]"', async () => {
    mockJsonResponse(422, {
      detail: {
        code: 'voxel_grid_too_large',
        message:
          'The requested spacing needs 1.4 billion voxels; one build may allocate 200 million.',
        suggested_horizontal_m: 0.99,
      },
    })

    const err = await request('POST', '/projects/p/build').catch((e: unknown) => e)

    expect(err).toBeInstanceOf(ApiError)
    expect((err as ApiError).message).toContain('one build may allocate')
    expect((err as ApiError).message).not.toContain('[object Object]')
  })

  // SD2: the whole point of a structured detail is the machine-readable fields.
  it('keeps the parsed detail object on the error so callers can read its fields', async () => {
    mockJsonResponse(422, {
      detail: {
        code: 'voxel_grid_too_large',
        message: 'too many voxels',
        suggested_horizontal_m: 0.99,
      },
    })

    const err = (await request('POST', '/projects/p/build').catch(
      (e: unknown) => e,
    )) as ApiError

    const detail = apiErrorDetail(err)
    expect(detail?.code).toBe('voxel_grid_too_large')
    expect(detail?.suggested_horizontal_m).toBe(0.99)
  })

  // SD3: an object detail with no `message` must still be readable prose —
  // silently losing the body is the failure this closes, so the fallback
  // serialises it rather than dropping to the generic status text.
  it('stringifies an object detail that carries no message field', async () => {
    mockJsonResponse(409, { detail: { code: 'litho_layer_overlap', layer_id: 'abc' } })

    const err = (await request('PATCH', '/layers/abc', {}).catch(
      (e: unknown) => e,
    )) as ApiError

    expect(err.message).toContain('litho_layer_overlap')
    expect(err.message).not.toContain('[object Object]')
  })
})

describe('request() — the string-detail and no-detail paths are unchanged', () => {
  // SD4: the overwhelming majority of routes send a plain string; their toast
  // copy must read exactly as before.
  it('passes a string detail through verbatim', async () => {
    mockJsonResponse(409, { detail: 'Delete the dependent model first.' })

    const err = (await request('DELETE', '/models/m').catch((e: unknown) => e)) as ApiError

    expect(err.message).toBe('Delete the dependent model first.')
    expect(err.status).toBe(409)
    expect(apiErrorDetail(err)).toBeNull()
  })

  // SD5: no detail at all still falls back to the historical label / verb text.
  it('falls back to the errorLabel when the server sends no detail', async () => {
    mockJsonResponse(500, {})

    const err = (await request('GET', '/x', undefined, 'Export failed').catch(
      (e: unknown) => e,
    )) as ApiError

    expect(err.message).toBe('Export failed (500)')
  })
})

describe('apiErrorDetail', () => {
  // SD6: guards for the shapes callers will actually hand it.
  it('returns null for non-ApiError rejections and for non-object details', async () => {
    expect(apiErrorDetail(new Error('socket hang up'))).toBeNull()
    expect(apiErrorDetail(new ApiError('x', 500, { detail: 'plain' }))).toBeNull()
    expect(apiErrorDetail(new ApiError('x', 500, { detail: ['a'] }))).toBeNull()
    expect(apiErrorDetail(new ApiError('x', 500, {}))).toBeNull()
  })
})
