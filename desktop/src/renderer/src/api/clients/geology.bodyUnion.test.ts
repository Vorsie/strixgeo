// Client-call-shape net for the body-union verb (debt #278 — the "Join with…"
// verb, owner ruling 2026-08-31, geotech axis only).
//
// Pins that the three "Join" / "Disjoin" client methods hit the
// .../models/{mid}/body-unions endpoints with the exact verbs, paths and
// request bodies the backend schema declares, and return the parsed response.
// The response carries the additive `suppressed`/`inert` booleans (create) and
// `suppressed_unions`/`inert_unions` counts (disjoin) verbatim.
//
//   JC1  createBodyUnion POSTs {layer_a_id, layer_b_id} and returns the row.
//   JC2  listBodyUnions GETs the collection and returns the list.
//   JC3  deleteBodyUnion DELETEs one union and returns the disjoin diff.
//
// Structured detail on the two 422 guards (read the object, never the prose):
//   JC4  body_union_cross_class carries both soils + both NAD classes.
//   JC5  body_union_contradicts_separation names the standing separation.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { geologyClient } from './geology'
import { apiErrorDetail, setBaseUrl } from './shared'

const BASE = 'http://127.0.0.1:8765'

afterEach(() => {
  vi.restoreAllMocks()
  setBaseUrl(BASE)
})

describe('api.geology body unions', () => {
  it('JC1 — createBodyUnion POSTs the anchor pair and returns the row', async () => {
    const responseBody = {
      union_id: 'union-1',
      model_id: 'model-1',
      layer_a_id: 'layer-a',
      layer_b_id: 'layer-b',
      was_created: true,
      bodies_changed: 1,
      renamed: [],
      suppressed: false,
      inert: false,
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 201,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await geologyClient.createBodyUnion('proj-1', 'model-1', 'layer-a', 'layer-b')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/projects/proj-1/geology/models/model-1/body-unions`)
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual({
      layer_a_id: 'layer-a',
      layer_b_id: 'layer-b',
    })
    // The additive suppressed/inert booleans round-trip verbatim.
    expect(result).toEqual(responseBody)
  })

  it('JC1b — a re-call that already existed answers 200 with suppressed surfaced', async () => {
    // Reversible verb: a standing-separation-suppressed join reads suppressed:true
    // so the caller can toast "join blocked by a separation" — the response parses
    // whether the status is 201 (new) or 200 (idempotent), so the 200 path is pinned.
    const responseBody = {
      union_id: 'union-1',
      model_id: 'model-1',
      layer_a_id: 'layer-a',
      layer_b_id: 'layer-b',
      was_created: false,
      bodies_changed: 0,
      renamed: [],
      suppressed: true,
      inert: false,
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await geologyClient.createBodyUnion('proj-1', 'model-1', 'layer-a', 'layer-b')
    expect(result).toEqual(responseBody)
    expect(result.suppressed).toBe(true)
  })

  it('JC2 — listBodyUnions GETs the collection and returns the list', async () => {
    const responseBody = [
      {
        id: 'union-1',
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

    const result = await geologyClient.listBodyUnions('proj-1', 'model-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/projects/proj-1/geology/models/model-1/body-unions`)
    expect(init?.method ?? 'GET').toBe('GET')
    expect(result).toEqual(responseBody)
  })

  it('JC3 — deleteBodyUnion DELETEs one union and returns the disjoin diff', async () => {
    const responseBody = {
      bodies_changed: 1,
      renamed: ['ZAND #3'],
      suppressed_unions: 0,
      inert_unions: 0,
    }
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify(responseBody), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const result = await geologyClient.deleteBodyUnion('proj-1', 'model-1', 'union-1')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${BASE}/projects/proj-1/geology/models/model-1/body-unions/union-1`)
    expect(init?.method).toBe('DELETE')
    expect(result).toEqual(responseBody)
  })

  it('JC4 — a body_union_cross_class 422 surfaces both soils + classes as structured detail', async () => {
    // The write guard refuses a mixed body 422; the structured detail names both
    // masses so the advisory can say WHICH classes cannot be one body. The prose
    // reaches err.message; the machine-readable fields reach apiErrorDetail.
    const detail = {
      code: 'body_union_cross_class',
      message:
        'The two bodies are different masses and cannot be joined into one — a body is a single soil and packing class.',
      soil_a: 'ZAND',
      soil_b: 'KLEI',
      nad_class_a: 5,
      nad_class_b: 12,
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const err = (await geologyClient
      .createBodyUnion('proj-1', 'model-1', 'layer-a', 'layer-b')
      .catch((e: unknown) => e)) as Error
    expect(err.message).toBe(detail.message)
    expect(err.message).not.toContain('[object Object]')
    expect(apiErrorDetail(err)).toEqual(detail)
  })

  it('JC5 — a body_union_contradicts_separation 422 names the standing separation', async () => {
    const detail = {
      code: 'body_union_contradicts_separation',
      message:
        'These two bodies are held apart by a standing separation — rejoin them by removing that separation first.',
      separation_id: 'sep-9',
      body_a_label: 'ZAND #2',
      body_b_label: 'ZAND #5',
    }
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ detail }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const err = (await geologyClient
      .createBodyUnion('proj-1', 'model-1', 'layer-a', 'layer-b')
      .catch((e: unknown) => e)) as Error
    expect(err.message).toBe(detail.message)
    expect(apiErrorDetail(err)).toEqual(detail)
  })
})
