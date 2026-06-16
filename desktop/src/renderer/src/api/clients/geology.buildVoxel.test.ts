// Client-call-shape net for api.geology.buildVoxelLithoModel.
//
// Pins that the new voxel-build client method POSTs to the
// .../litho-solids/build-voxel endpoint with the assembled VoxelBuildRequest
// as the JSON body and returns the parsed RebuildLithoSolidsResponse.

import { afterEach, describe, expect, it, vi } from 'vitest'

import { geologyClient } from './geology'
import { setBaseUrl } from './shared'
import type { VoxelBuildRequest } from '../../utils/buildVoxelRequest'

const BASE = 'http://127.0.0.1:8765'

afterEach(() => {
  vi.restoreAllMocks()
  setBaseUrl(BASE)
})

function makeRequest(): VoxelBuildRequest {
  return {
    sections: [],
    grid_spacing_m: 2.0,
    horizontal_spacing_m: 2.0,
    vertical_spacing_m: 1.0,
  }
}

describe('api.geology.buildVoxelLithoModel', () => {
  it('POSTs the request body to the build-voxel endpoint and returns the parsed response', async () => {
    const responseBody = {
      method: 'voxel',
      bodies_built: 3,
      bodies_flagged: 0,
      solids: [],
    }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify(responseBody), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )

    const req = makeRequest()
    const result = await geologyClient.buildVoxelLithoModel('proj-1', 'model-1', req)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      `${BASE}/projects/proj-1/geology/models/model-1/litho-solids/build-voxel`,
    )
    expect(init?.method).toBe('POST')
    expect(JSON.parse(init?.body as string)).toEqual(req)
    expect(result).toEqual(responseBody)
  })
})
