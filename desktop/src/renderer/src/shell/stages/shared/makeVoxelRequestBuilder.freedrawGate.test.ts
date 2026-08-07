// FREEDRAW OFF = OFF END TO END (owner ruling 2026-08-07) — the build side.
//
// The 2-D fill withholds stored boundary points while freedraw editing is
// disabled (SectionPanel.freedrawGate.test.tsx). The voxel build loads the
// same shapes "to keep the two in step" (owner 2026-07-30: build applies
// shapes iff the render does) — so while the flag is off, the build must
// not load or apply them either, or the 3-D model would carry reshaped
// contacts the section view no longer shows.
//
// VB3a — flag OFF: the boundary endpoints are never called and the build
//        proceeds (a broken boundary endpoint cannot block a build that
//        does not need it).
// VB3b — flag ON: the boundary shapes are fetched again (the loudness
//        rules VB2 covers the failure semantics of that fetch).

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listContactCorrelations = vi.fn()
const listLenses = vi.fn()
const getBodyBoundary = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    geology: {
      listContactCorrelations: (...args: unknown[]) => listContactCorrelations(...args),
      listLenses: (...args: unknown[]) => listLenses(...args),
      getBodyBoundary: (...args: unknown[]) => getBodyBoundary(...args),
    },
  },
}))

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import type { SectionLike } from '../../../utils/assembleLithoSectionInputs'

function section(id: string, name: string): SectionLike {
  return {
    id,
    name,
    start_x: 0,
    start_y: 0,
    end_x: 100,
    end_y: 0,
    projection_buffer_m: 50,
  }
}

async function runBuilder(flagEnabled: boolean): Promise<void> {
  vi.doMock('../../../utils/freedrawEditFlag', () => ({
    FREEDRAW_EDIT_ENABLED: flagEnabled,
  }))
  const { makeVoxelRequestBuilder } = await import('./makeVoxelRequestBuilder')
  await makeVoxelRequestBuilder({
    projectId: 'proj-1',
    modelId: 'model-1',
    visibleSections: [section('sec-1', 'Cross-section 1')],
    investigations: [],
    layers: [],
    viewState: null,
    logLabel: 'litho-voxel',
  })()
}

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
  listContactCorrelations.mockResolvedValue([])
  listLenses.mockResolvedValue([{ id: 'body-1' }])
  getBodyBoundary.mockResolvedValue({
    body_id: 'body-1',
    content_key: null,
    render_style: 'straight',
    primary_section_id: null,
    upper_nodes: [],
    lower_nodes: [{ along_m: 203.2, elevation_m: 5.47 }],
  })
})

// Generous timeouts: the per-case ``vi.doMock`` + dynamic import re-transforms
// the builder's module graph, which exceeds the 5 s default under the
// pre-commit hook's fully parallel suite run (passes in ~2 s standalone).
describe('makeVoxelRequestBuilder — freedraw flag gates stored shapes out of the build', () => {
  it('VB3a — freedraw OFF: boundary shapes are neither fetched nor applied', {
    timeout: 60_000,
  }, async () => {
    // Even a REJECTING boundary endpoint must not matter — off means the
    // build never asks for shapes it is forbidden to apply.
    getBodyBoundary.mockRejectedValue(new Error('500'))

    await expect(runBuilder(false)).resolves.not.toThrow()
    expect(listLenses).not.toHaveBeenCalled()
    expect(getBodyBoundary).not.toHaveBeenCalled()
  })

  it('VB3b — freedraw ON: the stored shapes are fetched for the build again', {
    timeout: 60_000,
  }, async () => {
    await expect(runBuilder(true)).resolves.not.toThrow()
    expect(listLenses).toHaveBeenCalledWith('proj-1', 'model-1')
    expect(getBodyBoundary).toHaveBeenCalledWith('proj-1', 'model-1', 'body-1')
  })
})
