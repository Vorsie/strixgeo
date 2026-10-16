// The D-Series exports must send the partition the SELECTED section draws.
//
// The rule, in the rule's own words: what is exported is what the section
// draws — and only the section the engineer has open. A cross-section the
// engineer can also see on the Sections stage is not part of this export, so
// none of its ground may travel in the body.
//
// WHY a dedicated module rather than the canvas voxel refs: on the Sections
// stage neither ``LithologyCanvas`` nor ``GeotechnicalCanvas`` is mounted
// (``StageCanvas`` renders exactly one stage's ``CanvasComponent``), and both
// canvases assign their ``*VoxelRequestCallback`` ref in the render body with
// no unmount cleanup. So on this stage the ref is either null (the engineer
// never opened that stage) or a STALE closure over the last render's sections
// and layers — which would export ground the section does not draw, silently.
// This module reuses ``makeVoxelRequestBuilder`` — the very assembly the 3-D
// build posts — scoped to one section, so the two cannot disagree.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildSectionExportPartition } from './buildSectionExportPartition'
import { makeLithoLayer } from './__fixtures__/lithoLayer'
import {
  ProjectClosedError,
  reportOpenProject,
  resetOpenProjectGuard,
} from '../../../utils/openProjectGuard'

const listContactCorrelations = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    geology: {
      listContactCorrelations: (...args: unknown[]) => listContactCorrelations(...args),
    },
  },
}))

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

/** The section the engineer has open. */
const OPEN_SECTION = {
  id: 'sec-open',
  name: 'Section A-A',
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 50,
  excluded_borehole_ids: [] as string[],
  excluded_cpt_ids: [] as string[],
}

/** A second section that is visible on the stage but NOT selected. */
const OTHER_SECTION = {
  id: 'sec-other',
  name: 'Section B-B',
  start_x: 500,
  start_y: 500,
  end_x: 600,
  end_y: 500,
  projection_buffer_m: 50,
  excluded_borehole_ids: [] as string[],
  excluded_cpt_ids: [] as string[],
}

/** Two columns on the open section, two more on the other one. */
const INVESTIGATIONS = [
  { id: 'cpt-1', location_x: 25, location_y: 0, elevation_m: 0 },
  { id: 'cpt-2', location_x: 75, location_y: 0, elevation_m: 0 },
  { id: 'cpt-3', location_x: 525, location_y: 500, elevation_m: 0 },
  { id: 'cpt-4', location_x: 575, location_y: 500, elevation_m: 0 },
]

const LAYERS = [
  makeLithoLayer({ id: 'l1', cpt_id: 'cpt-1', formation_id: 'f-a', depth_top_m: 0, depth_base_m: 5 }),
  makeLithoLayer({ id: 'l2', cpt_id: 'cpt-2', formation_id: 'f-a', depth_top_m: 0, depth_base_m: 5 }),
  makeLithoLayer({ id: 'l3', cpt_id: 'cpt-3', formation_id: 'f-a', depth_top_m: 0, depth_base_m: 5 }),
  makeLithoLayer({ id: 'l4', cpt_id: 'cpt-4', formation_id: 'f-a', depth_top_m: 0, depth_base_m: 5 }),
]

/** The happy-path parameter bundle; each case overrides what it is about. */
function params(overrides: Record<string, unknown> = {}) {
  return {
    projectId: 'proj-1',
    modelId: 'litho-model-1',
    section: OPEN_SECTION,
    investigations: INVESTIGATIONS,
    layers: LAYERS,
    viewState: {},
    logLabel: 'section-export',
    ...overrides,
  }
}

beforeEach(() => {
  listContactCorrelations.mockReset()
  listContactCorrelations.mockResolvedValue([])
})

describe('buildSectionExportPartition — SEP1: the payload is the open section', () => {
  it('returns a partition whose endpoints are the selected section\'s endpoints', async () => {
    const partition = await buildSectionExportPartition(params())

    expect(partition).not.toBeNull()
    expect(partition?.start_x).toBe(OPEN_SECTION.start_x)
    expect(partition?.start_y).toBe(OPEN_SECTION.start_y)
    expect(partition?.end_x).toBe(OPEN_SECTION.end_x)
    expect(partition?.end_y).toBe(OPEN_SECTION.end_y)
  })

  it('carries the open section\'s own columns', async () => {
    const partition = await buildSectionExportPartition(params())

    expect(partition?.columns.map(c => c.investigation_id).sort()).toEqual(['cpt-1', 'cpt-2'])
  })
})

describe('buildSectionExportPartition — SEP2: a second visible section is not posted', () => {
  it('never carries the other section\'s endpoints', async () => {
    const partition = await buildSectionExportPartition(params())

    expect(partition?.start_x).not.toBe(OTHER_SECTION.start_x)
    expect(partition?.end_x).not.toBe(OTHER_SECTION.end_x)
  })

  it('never carries a column that belongs to the other section', async () => {
    const partition = await buildSectionExportPartition(params())

    const ids = partition?.columns.map(c => c.investigation_id) ?? []
    expect(ids).not.toContain('cpt-3')
    expect(ids).not.toContain('cpt-4')
  })

  it('fetches correlations for the open section only — one call, its id', async () => {
    await buildSectionExportPartition(params())

    expect(listContactCorrelations).toHaveBeenCalledTimes(1)
    expect(listContactCorrelations).toHaveBeenCalledWith('proj-1', 'litho-model-1', 'sec-open')
  })
})

describe('buildSectionExportPartition — SEP3: refuses rather than inventing ground', () => {
  it('returns null when no section is selected', async () => {
    expect(await buildSectionExportPartition(params({ section: null }))).toBeNull()
  })

  it('returns null when the axis has no active model', async () => {
    expect(await buildSectionExportPartition(params({ modelId: null }))).toBeNull()
  })

  it('returns null when the section has fewer than two columns to fill between', async () => {
    const partition = await buildSectionExportPartition(
      params({ investigations: [INVESTIGATIONS[0]] }),
    )

    expect(partition).toBeNull()
  })
})

describe('buildSectionExportPartition — SEP4: the geotech axis exports the framed fill', () => {
  it('reads the litho frame for the open section too, so the export is the drawn fill', async () => {
    await buildSectionExportPartition(
      params({
        modelId: 'geotech-model-1',
        frameModelId: 'litho-model-1',
        frameLayers: LAYERS,
      }),
    )

    // Both the packing model's ties and the litho frame's ties, each for the
    // OPEN section only — the geotech axis draws the hierarchical fill, so an
    // export that skipped the frame would not be what the engineer sees.
    expect(listContactCorrelations.mock.calls).toEqual([
      ['proj-1', 'geotech-model-1', 'sec-open'],
      ['proj-1', 'litho-model-1', 'sec-open'],
    ])
  })
})

describe('buildSectionExportPartition: SEP5, nothing of a closed project runs', () => {
  // "Once a project is closed, nothing of it runs any more" (owner, PR #90; deep
  // walker 2026-10-16 seed 631210857: the geotech export's LITHO frame
  // correlations were fetched for the closed worked example after the next
  // project was open). The assembly checks its project before every request.
  afterEach(() => {
    resetOpenProjectGuard()
  })

  it("a partition build of A's section sends no further request once B is open", async () => {
    reportOpenProject('proj-1')
    let releaseOwn!: () => void
    listContactCorrelations.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          releaseOwn = () => resolve([])
        }),
    )

    const running = buildSectionExportPartition(
      params({ modelId: 'geotech-model-1', frameModelId: 'litho-model-1', frameLayers: LAYERS }),
    )
    await vi.waitFor(() => expect(listContactCorrelations).toHaveBeenCalledTimes(1))
    reportOpenProject('proj-2')
    releaseOwn()

    await expect(running).rejects.toBeInstanceOf(ProjectClosedError)
    // The frame's correlations are never fetched for the closed project.
    expect(listContactCorrelations.mock.calls).toEqual([
      ['proj-1', 'geotech-model-1', 'sec-open'],
    ])
  })

  it('sends nothing at all when the project is already closed', async () => {
    reportOpenProject('proj-2')
    await expect(buildSectionExportPartition(params())).rejects.toBeInstanceOf(ProjectClosedError)
    expect(listContactCorrelations).not.toHaveBeenCalled()
  })
})
