// Client-call-shape net for ``api.borehole.importFile`` — a local DOV borehole
// XML file posted to ``POST /borehole/import``.
//
// The rules it pins, in the contract's words: the file travels as multipart
// with the project id; ``confirm_refresh`` is sent ONLY when the engineer
// agreed to replace; a 409 ``borehole_refresh_confirmation_required`` is the
// backend ASKING (typed error carrying one diff per boring, nothing written),
// and any other refusal surfaces the backend's own message.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BoreholeRefreshConfirmationRequiredError, boreholeClient } from './borehole'
import { setBaseUrl } from './shared'

const BASE = 'http://127.0.0.1:8765'

beforeEach(() => {
  ;(globalThis as unknown as { window: Record<string, unknown> }).window.electron = {
    readFile: vi.fn().mockResolvedValue(new Uint8Array([60, 97, 47, 62])),
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  setBaseUrl(BASE)
})

function respond(status: number, body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  )
}

describe('boreholeClient.importFile', () => {
  it('posts the file by its own name, with the project, and no consent by default', async () => {
    respond(201, { boreholes: [], file_issues: [] })
    await boreholeClient.importFile('C:\\data\\GEO-25-110-B1.xml', 'P1')

    const [url, init] = vi.mocked(fetch).mock.calls[0]
    expect(url).toBe(`${BASE}/borehole/import`)
    const form = (init as RequestInit).body as FormData
    expect((form.get('file') as File).name).toBe('GEO-25-110-B1.xml')
    expect(form.get('project_id')).toBe('P1')
    expect(form.has('confirm_refresh')).toBe(false)
  })

  it('sends confirm_refresh only when the engineer agreed', async () => {
    respond(200, { boreholes: [], file_issues: [] })
    await boreholeClient.importFile('B1.xml', 'P1', true)
    const form = (vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as FormData
    expect(form.get('confirm_refresh')).toBe('true')
  })

  it('turns the 409 ask into a typed error carrying every boring diff', async () => {
    respond(409, {
      detail: {
        code: 'borehole_refresh_confirmation_required',
        message: 'already there',
        diffs: [
          {
            borehole_id: 'B-1',
            name: 'GEO-25/110-B1',
            test_id: 'X-B1',
            old_total_depth_m: 30,
            new_total_depth_m: 35,
            old_n_litho_layers: 60,
            new_n_litho_layers: 70,
            n_errors: 0,
            n_warnings: 2,
          },
        ],
      },
    })
    const error = await boreholeClient.importFile('B1.xml', 'P1').catch(e => e)
    expect(error).toBeInstanceOf(BoreholeRefreshConfirmationRequiredError)
    expect(error.diffs).toEqual([
      {
        boreholeId: 'B-1',
        name: 'GEO-25/110-B1',
        testId: 'X-B1',
        oldTotalDepthM: 30,
        newTotalDepthM: 35,
        oldNLithoLayers: 60,
        newNLithoLayers: 70,
        nErrors: 0,
        nWarnings: 2,
      },
    ])
  })

  it("surfaces the backend's own message on any other refusal", async () => {
    respond(400, { detail: "'bad.xml' is not a readable XML file" })
    await expect(boreholeClient.importFile('bad.xml', 'P1')).rejects.toThrow(
      "'bad.xml' is not a readable XML file",
    )
  })
})
