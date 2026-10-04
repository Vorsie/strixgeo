// Owner ruling 2026-09-30: "just make a generic importer and if file format is
// not found throw error and tell to contact strixgeo devteam to have the format
// added". The backend answers 400 with code ``lab_file_format_not_recognised``;
// the client turns exactly that answer into its own error class so the dialog
// can say it in the user's language (translate at the presentation boundary),
// while any other 400 stays a plain error carrying the server's message.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { LabFileFormatNotRecognisedError, labSeriesClient } from './labSeries'
import { setBaseUrl } from './shared'

afterEach(() => {
  vi.restoreAllMocks()
  setBaseUrl('http://127.0.0.1:8765')
})

function answer(status: number, body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
  )
}

// fileForm reads the file through the preload bridge.
;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
  readFile: async () => new Uint8Array([104, 105]),
}

describe('labSeries client — an unknown file format', () => {
  it('the preview throws LabFileFormatNotRecognisedError for the code', async () => {
    answer(400, {
      detail: {
        code: 'lab_file_format_not_recognised',
        message: 'This file format is not recognised. Contact the StrixGeo dev team to have it added.',
        file_name: 'results.txt',
      },
    })
    const err = await labSeriesClient.preview('C:/lab/results.txt', 'p').catch(e => e)
    expect(err).toBeInstanceOf(LabFileFormatNotRecognisedError)
    expect((err as LabFileFormatNotRecognisedError).fileName).toBe('results.txt')
  })

  it('the import throws it too', async () => {
    answer(400, { detail: { code: 'lab_file_format_not_recognised', message: 'x' } })
    const err = await labSeriesClient
      .import('C:/lab/results.csv', 'p', { boreholeId: 'b', createSample: true })
      .catch(e => e)
    expect(err).toBeInstanceOf(LabFileFormatNotRecognisedError)
    expect((err as LabFileFormatNotRecognisedError).fileName).toBe('results.csv')
  })

  it('any other 400 stays a plain error with the server message', async () => {
    answer(400, { detail: 'results.txt: no stage block in the listing' })
    const err = await labSeriesClient.preview('C:/lab/results.txt', 'p').catch(e => e)
    expect(err).not.toBeInstanceOf(LabFileFormatNotRecognisedError)
    expect(String((err as Error).message)).toContain('no stage block')
  })
})

describe('labSeries client — the 409 borehole conflict', () => {
  it('the preview error carries the translated copy, not the server sentence', async () => {
    answer(409, {
      detail: {
        code: 'lab_borehole_conflict',
        borehole_name: 'GEO-19/122-B7A',
        message: 'Borehole GEO-19/122-B7A was stored in this project by another request at the same moment.',
      },
    })
    const err = await labSeriesClient.preview('C:/lab/200568B7.txt', 'p').catch(e => e)
    expect(String((err as Error).message)).toContain('GEO-19/122-B7A')
    expect(String((err as Error).message)).not.toMatch(/another request/)
  })
})
