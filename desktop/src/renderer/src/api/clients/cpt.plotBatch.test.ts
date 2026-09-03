// M7d — the cross-section plot fetch must chunk to the backend's 500-id cap.
//
// POST /cpt/plot-batch rejects a body with >500 ids (422 —
// CptPlotBatchRequest.ids carries Field(max_length=500)). A dense project
// (up to 5000 CPTs in one section corridor) therefore has to be split into
// ≤500-id requests and merged, or the whole batch fails. These pins state the
// rule in the ruling's own words: "Chunk by 500 and merge, preserving order."

import { afterEach, describe, expect, it, vi } from 'vitest'

const postMock = vi.fn()

// Only ``post`` is exercised by plotBatch; the rest of ``./shared`` is stubbed
// so importing cpt.ts does not drag the real HTTP client into the test.
vi.mock('./shared', () => ({
  _base: 'http://localhost:8765',
  post: (path: string, body: unknown) => postMock(path, body),
  get: vi.fn(),
  patch: vi.fn(),
  del: vi.fn(),
  detailMessage: vi.fn(),
  fetchTracked: vi.fn(),
}))

import { cptClient } from './cpt'

afterEach(() => postMock.mockReset())

/** N synthetic ids ``id-0 … id-(N-1)`` — order is the assertion surface. */
function ids(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `id-${i}`)
}

describe('cptClient.plotBatch chunking (M7d)', () => {
  it('B1 — 1200 ids become three ≤500-id POSTs (500, 500, 200)', async () => {
    postMock.mockResolvedValue([])
    await cptClient.plotBatch(ids(1200), 'proj-1')
    expect(postMock).toHaveBeenCalledTimes(3)
    const sizes = postMock.mock.calls.map(c => (c[1] as { ids: string[] }).ids.length)
    expect(sizes).toEqual([500, 500, 200])
  })

  it('B2 — a batch at or under the cap stays a single POST', async () => {
    postMock.mockResolvedValue([])
    await cptClient.plotBatch(ids(500), 'proj-1')
    expect(postMock).toHaveBeenCalledTimes(1)
  })

  it('B3 — the merged response keeps the input order across chunks', async () => {
    postMock.mockImplementation((_path: string, body: unknown) => {
      const b = body as { ids: string[] }
      return Promise.resolve(b.ids.map(id => ({ cpt_id: id })))
    })
    const res = await cptClient.plotBatch(ids(1200), 'proj-1')
    expect(res).toHaveLength(1200)
    expect((res[0] as unknown as { cpt_id: string }).cpt_id).toBe('id-0')
    expect((res[500] as unknown as { cpt_id: string }).cpt_id).toBe('id-500')
    expect((res[1199] as unknown as { cpt_id: string }).cpt_id).toBe('id-1199')
  })

  it('B4 — every chunk carries the project scope guard', async () => {
    postMock.mockResolvedValue([])
    await cptClient.plotBatch(ids(1100), 'proj-xyz')
    for (const call of postMock.mock.calls) {
      expect((call[1] as { app_project_id: string }).app_project_id).toBe('proj-xyz')
    }
  })

  it('B5 — an empty id list makes no request (min_length=1 would 422)', async () => {
    const res = await cptClient.plotBatch([], 'proj-1')
    expect(postMock).not.toHaveBeenCalled()
    expect(res).toEqual([])
  })
})
