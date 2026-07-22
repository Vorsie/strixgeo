// Client-call-shape net for api.geology.resetManualBoundaries.
//
// Pins that the "Reset manual points" client method DELETEs the
// .../models/{mid}/boundaries endpoint and returns the parsed
// ClearBoundariesResponse (the deleted-shape count).

import { afterEach, describe, expect, it, vi } from 'vitest'

import { geologyClient } from './geology'
import { setBaseUrl } from './shared'

const BASE = 'http://127.0.0.1:8765'

afterEach(() => {
  vi.restoreAllMocks()
  setBaseUrl(BASE)
})

describe('api.geology.resetManualBoundaries', () => {
  it('DELETEs the model boundaries endpoint and returns the parsed response', async () => {
    const responseBody = { shapes_deleted: 7 }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await geologyClient.resetManualBoundaries('proj-1', 'model-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/projects/proj-1/geology/models/model-1/boundaries`)
    expect(init?.method).toBe('DELETE')
    expect(result).toEqual(responseBody)
  })
})
