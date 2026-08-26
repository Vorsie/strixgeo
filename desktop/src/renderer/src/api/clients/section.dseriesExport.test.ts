// Client-call-shape net for the two D-Series section exports.
//
// These are the only section exports that POST: D-Stability's geometry IS the
// section's closed polygons and D-Sheet samples a column through them, and the
// fill that produces both is computed in the renderer. So the drawn partition
// has to travel in the body, and these tests pin that it does — plus that the
// backend's refusal message reaches the caller intact, because that message is
// the toast an engineer reads when a section has no fill yet.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { sectionClient } from './section'
import { setBaseUrl } from './shared'
import type { SectionPartitionInput } from '../../utils/buildVoxelRequest'

const BASE = 'http://127.0.0.1:8765'
const PROJECT = 'proj-1'
const SECTION = 'sec-1'
const MODEL = 'model-1'

afterEach(() => {
  vi.restoreAllMocks()
  setBaseUrl(BASE)
})

function makePartition(): SectionPartitionInput {
  return {
    start_x: 0,
    start_y: 0,
    end_x: 100,
    end_y: 0,
    columns: [
      { investigation_id: 'c0', along_m: 10, world_x: 10, world_y: 0 },
      { investigation_id: 'c1', along_m: 90, world_x: 90, world_y: 0 },
    ],
    regions: [
      {
        formation_id: 'f0',
        body_id: null,
        polygon: [
          [0, 5],
          [1, 5],
          [1, 0],
          [0, 0],
        ],
        gap_index: 0,
      },
    ],
  }
}

function mockBytes(payload: number[]): ReturnType<typeof vi.spyOn> {
  return vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(
      new Response(new Uint8Array(payload).buffer as ArrayBuffer, {
        status: 200,
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
    )
}

describe('api.section.exportDstability', () => {
  it('POSTs the drawn partition and returns the .stix bytes', async () => {
    const fetchMock = mockBytes([0x50, 0x4b, 0x03, 0x04])

    const bytes = await sectionClient.exportDstability(
      PROJECT,
      SECTION,
      MODEL,
      makePartition(),
    )

    expect(new Uint8Array(bytes)).toEqual(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `${BASE}/projects/${PROJECT}/sections/${SECTION}/export/dstability?model_id=${MODEL}`,
    )
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ partition: makePartition() })
  })

  it("surfaces the backend's refusal message verbatim, so the toast is readable", async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          detail: {
            code: 'dstability_export_refused',
            message: "Cross-section 'A-A' has no closed geometry to export.",
          },
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    await expect(
      sectionClient.exportDstability(PROJECT, SECTION, MODEL, makePartition()),
    ).rejects.toThrow('has no closed geometry to export')
  })
})

describe('api.section.exportDsheetPiling', () => {
  it('omits the fraction so the backend takes its mid-section default', async () => {
    const fetchMock = mockBytes([0x49, 0x4e])

    await sectionClient.exportDsheetPiling(PROJECT, SECTION, MODEL, makePartition())

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(
      `${BASE}/projects/${PROJECT}/sections/${SECTION}/export/dsheetpiling?model_id=${MODEL}`,
    )
  })

  it('sends an explicit sample fraction when the caller picks a position', async () => {
    const fetchMock = mockBytes([0x49, 0x4e])

    await sectionClient.exportDsheetPiling(PROJECT, SECTION, MODEL, makePartition(), 0.25)

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('fraction=0.25')
  })
})
