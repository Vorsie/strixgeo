// "Build model" must refuse rather than build from a partial input set.
//
// Audit 2026-08-02, Class 1 ("the app reports success it did not verify"): a
// per-section correlation fetch that rejected was swallowed into an EMPTY edge
// list for that section — indistinguishable downstream from "this section has
// no correlations" — and the only trace was a console.debug. The build then
// ran to completion, persisted a generation, and toasted a green
// "Built N bodies", while every body tied on that section had fragmented in
// the 3-D model. Same for the body-boundary fetch: one failing body dropped
// ALL hand-drawn overrides.
//
// The rule, in the rule's own words: if the inputs the build needs did not all
// load, the build does not run and the engineer is told which sections failed.

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

// VB2 pins the failure semantics of the boundary FETCH, which only happens
// while freedraw editing is enabled (off = the build skips the fetch — see
// makeVoxelRequestBuilder.freedrawGate.test.ts). Pin the flag ON so these
// rules keep guarding the freedraw-on world regardless of the flag's current
// shipping value.
vi.mock('../../../utils/freedrawEditFlag', () => ({ FREEDRAW_EDIT_ENABLED: true }))

import { makeVoxelRequestBuilder } from './makeVoxelRequestBuilder'
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

const SECTIONS = [section('sec-1', 'Cross-section 1'), section('sec-2', 'Tie-section 12')]

function builder(): () => Promise<unknown> {
  return makeVoxelRequestBuilder({
    projectId: 'proj-1',
    modelId: 'model-1',
    visibleSections: SECTIONS,
    investigations: [],
    layers: [],
    viewState: null,
    logLabel: 'litho-voxel',
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  listLenses.mockResolvedValue([])
  getBodyBoundary.mockResolvedValue({ nodes: [] })
})

describe('makeVoxelRequestBuilder — VB1: a failed correlation fetch cancels the build', () => {
  it('rejects, naming the section whose correlations did not load', async () => {
    listContactCorrelations.mockImplementation((_p: string, _m: string, sectionId: string) =>
      sectionId === 'sec-2'
        ? Promise.reject(new Error('500'))
        : Promise.resolve([]),
    )

    await expect(builder()()).rejects.toThrow(/Tie-section 12/)
  })

  it('does not reject when every section loads', async () => {
    listContactCorrelations.mockResolvedValue([])

    await expect(builder()()).resolves.not.toThrow()
  })
})

describe('makeVoxelRequestBuilder — VB2: a failed body-boundary fetch cancels the build', () => {
  it('rejects instead of building without the hand-drawn overrides', async () => {
    listContactCorrelations.mockResolvedValue([])
    listLenses.mockResolvedValue([{ id: 'body-1' }])
    getBodyBoundary.mockRejectedValue(new Error('500'))

    await expect(builder()()).rejects.toThrow(/boundar/i)
  })
})
