// Client-call-shape net for the body-separation verb (debt #278 R5).
//
// Pins that the three "Separate" / "Rejoin" client methods hit the
// .../models/{mid}/body-separations endpoints with the exact verbs, paths and
// request bodies the backend schema declares, and return the parsed response.
//
//   BS1  createBodySeparation POSTs {layer_a_id, layer_b_id} and returns the row.
//   BS2  listBodySeparations GETs the collection and returns the list.
//   BS3  deleteBodySeparation DELETEs one separation and returns the rejoin diff.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { geologyClient } from './geology'
import { setBaseUrl } from './shared'

const BASE = 'http://127.0.0.1:8765'

afterEach(() => {
  vi.restoreAllMocks()
  setBaseUrl(BASE)
})

describe('api.geology body separations', () => {
  it('BS1 — createBodySeparation POSTs the anchor pair and returns the row', async () => {
    const responseBody = {
      separation_id: 'sep-1',
      model_id: 'model-1',
      layer_a_id: 'layer-a',
      layer_b_id: 'layer-b',
      was_created: true,
      bodies_changed: 2,
      renamed: [],
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await geologyClient.createBodySeparation('proj-1', 'model-1', 'layer-a', 'layer-b')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/projects/proj-1/geology/models/model-1/body-separations`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      layer_a_id: 'layer-a',
      layer_b_id: 'layer-b',
    })
    expect(result).toEqual(responseBody)
  })

  it('BS2 — listBodySeparations GETs the collection and returns the list', async () => {
    const responseBody = [
      {
        id: 'sep-1',
        model_id: 'model-1',
        layer_a_id: 'layer-a',
        layer_b_id: 'layer-b',
        anchor_a: { layer_id: 'layer-a', body_id: 'body-a', body_name: null, body_ordinal: 0, formation_id: 'f1' },
        anchor_b: { layer_id: 'layer-b', body_id: 'body-b', body_name: 'Named', body_ordinal: 1, formation_id: 'f1' },
        created_at: '2026-01-01T00:00:00Z',
      },
    ]
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await geologyClient.listBodySeparations('proj-1', 'model-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/projects/proj-1/geology/models/model-1/body-separations`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result).toEqual(responseBody)
  })

  it('BS3 — deleteBodySeparation DELETEs one separation and returns the rejoin diff', async () => {
    const responseBody = { bodies_changed: 1, renamed: ['SILT #3'] }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await geologyClient.deleteBodySeparation('proj-1', 'model-1', 'sep-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/projects/proj-1/geology/models/model-1/body-separations/sep-1`)
    expect(init?.method).toBe('DELETE')
    expect(result).toEqual(responseBody)
  })
})
