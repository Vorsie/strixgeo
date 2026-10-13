// Project switch — no model of the PREVIOUS project is ever "active" for the
// new one (owner dogfeed 2026-10-13: opening worked_example from
// testproject_dev fired every model-scoped request with the NEW project id and
// the OLD project's model ids for about a second — 404 "Model not found" on
// layers, surfaces, litho-solids, build-report, geotech/litho-staleness — and
// "keeping last-good rows" kept the old project's layers on screen meanwhile).
//
// Rules pinned here, in the ruling's words:
//   PS1  a model is only active when it belongs to the open project: right
//        after a switch, while the new project's model list is still loading,
//        there is NO active litho / geotech / geological model and the model
//        list is empty;
//   PS2  no model-scoped request is sent with a model of another project
//        (layers, surfaces, contacts, solids, build report, geotech staleness);
//   PS3  the old project's litho and geotech rows leave the screen at once —
//        "keeping last-good rows" is for a same-project refetch only;
//   PS4  once the new list arrives, the new project's models load normally;
//   PS5  nothing is logged as an error or a failed load during the switch.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type {
  GeologicalModelResponse,
  LithoLayerResponse,
  ProjectResponse,
} from '../api/client'
import { log } from '../utils/log'

vi.mock('../api/client', () => ({
  api: {
    geology: {
      listModels: vi.fn(),
      listFormations: vi.fn(),
      listContacts: vi.fn(),
      listLayers: vi.fn(),
      listSurfaces: vi.fn(),
      validateCrossings: vi.fn(),
      createModel: vi.fn(),
      activateModel: vi.fn(),
      listLithoSolids: vi.fn(),
      getGaplessBuildReport: vi.fn(),
      geotechLithoStaleness: vi.fn(),
      setBodyColor: vi.fn(),
    },
    cpt: { list: vi.fn(), get: vi.fn() },
    borehole: { list: vi.fn(), get: vi.fn() },
    section: { list: vi.fn() },
    project: { get: vi.fn(), update: vi.fn() },
  },
  DuplicateContactError: class DuplicateContactError extends Error {
    existingContactId: string
    constructor(existingContactId: string) {
      super('duplicate')
      this.existingContactId = existingContactId
    }
  },
}))

vi.mock('../utils/log', () => ({
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

function model(
  id: string,
  projectId: string,
  kind: GeologicalModelResponse['kind'],
): GeologicalModelResponse {
  return {
    id,
    app_project_id: projectId,
    name: id,
    description: null,
    kind,
    is_active: true,
    excluded_borehole_ids: [],
    parent_model_id: kind === 'geological' ? null : 'parent',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

// Project A = the one open first (testproject_dev); project B = the one opened
// next (worked_example).
const A_GEO = model('a-geo', 'proj-a', 'geological')
const A_LITHO = model('a-litho', 'proj-a', 'lithostratigraphic')
const A_GEOTECH = model('a-geotech', 'proj-a', 'geotechnical')
const B_GEO = model('b-geo', 'proj-b', 'geological')
const B_LITHO = model('b-litho', 'proj-b', 'lithostratigraphic')
const B_GEOTECH = model('b-geotech', 'proj-b', 'geotechnical')
const OLD_MODEL_IDS = new Set([A_GEO.id, A_LITHO.id, A_GEOTECH.id])

function layer(id: string, modelId: string): LithoLayerResponse {
  return {
    id,
    model_id: modelId,
    formation_id: 'f-1',
    borehole_id: 'bh-1',
    cpt_id: null,
    depth_top_m: 0,
    depth_base_m: 2,
    status: 'accepted',
    source: 'manual',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function project(id: string): ProjectResponse {
  return {
    id,
    name: id,
    default_horizontal_epsg: 31370,
    default_vertical_epsg: null,
    project_number: null,
    client: null,
    site_label: null,
    description: null,
    tags: [],
    phase: null,
    status: 'active',
    view_state: {},
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    archived_at: null,
  }
}

function makeArgs(p: ProjectResponse) {
  return {
    project: p,
    toast: vi.fn(),
    pushUndo: vi.fn(),
    addToManifest: vi.fn(),
    removeFromManifest: vi.fn(),
    addToSessionImports: vi.fn(),
    removeFromSessionImports: vi.fn(),
    manifestFormationIds: undefined as Set<string> | undefined,
    currentLumping: null,
    stageLumping: vi.fn(),
    requestCorrelationEdgesRefetch: vi.fn(),
    markMutated: vi.fn(),
  }
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 4; i++) await new Promise(r => setTimeout(r, 0))
  })
}

let apiMock: typeof import('../api/client')['api']
/** Resolves project B's model list when the test says so. */
let releaseB: (ms: GeologicalModelResponse[]) => void = () => {}

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../api/client')
  apiMock = mod.api
  // Project B's list is ONE deferred answer shared by every caller (the
  // bootstrap resolve and the picker refresh both list the models).
  const bList = new Promise<GeologicalModelResponse[]>(resolve => {
    releaseB = resolve
  })
  vi.mocked(apiMock.geology.listModels).mockImplementation(async (pid: string) =>
    pid === 'proj-a' ? [A_GEO, A_LITHO, A_GEOTECH] : bList,
  )
  vi.mocked(apiMock.geology.listFormations).mockResolvedValue([])
  vi.mocked(apiMock.geology.listContacts).mockResolvedValue([])
  vi.mocked(apiMock.geology.listSurfaces).mockResolvedValue([])
  vi.mocked(apiMock.geology.validateCrossings).mockResolvedValue({ model_id: '', issues: [] })
  vi.mocked(apiMock.geology.listLayers).mockImplementation(async (_p: string, m: string) => [
    layer(`${m}-layer`, m),
  ])
  vi.mocked(apiMock.geology.listLithoSolids).mockResolvedValue([])
  vi.mocked(apiMock.geology.getGaplessBuildReport).mockResolvedValue(null)
  vi.mocked(apiMock.geology.geotechLithoStaleness).mockResolvedValue({
    geotech_model_id: '',
    litho_model_id: null,
    stale_columns: [],
    stale_column_count: 0,
    banded_column_count: 0,
    unstamped_column_count: 0,
  })
})

/** Every model-scoped call as [method, projectId, modelId]. */
function modelScopedCalls(): Array<[string, string, string]> {
  const g = apiMock.geology
  const methods: Record<string, { mock: { calls: unknown[][] } }> = {
    listLayers: vi.mocked(g.listLayers),
    listSurfaces: vi.mocked(g.listSurfaces),
    listContacts: vi.mocked(g.listContacts),
    listLithoSolids: vi.mocked(g.listLithoSolids),
    getGaplessBuildReport: vi.mocked(g.getGaplessBuildReport),
    geotechLithoStaleness: vi.mocked(g.geotechLithoStaleness),
  }
  const out: Array<[string, string, string]> = []
  for (const [name, fn] of Object.entries(methods)) {
    for (const call of fn.mock.calls) out.push([name, call[0] as string, call[1] as string])
  }
  return out
}

function foreignCalls(): Array<[string, string, string]> {
  return modelScopedCalls().filter(([, pid, mid]) => pid === 'proj-b' && OLD_MODEL_IDS.has(mid))
}

describe('project switch — a model is only active for the project it belongs to', () => {
  it("PS1-PS5 — switching A→B never pairs B with a model of A, and A's rows leave at once", async () => {
    const { result, rerender } = renderHook(
      (props: { args: ReturnType<typeof makeArgs> }) => useGeologicalModel(props.args),
      { initialProps: { args: makeArgs(project('proj-a')) } },
    )
    await flush()
    // Sanity: project A is fully loaded.
    expect(result.current.activeLithoModel?.id).toBe(A_LITHO.id)
    expect(result.current.activeGeotechModel?.id).toBe(A_GEOTECH.id)
    expect(result.current.lithoLayers.map(l => l.id)).toEqual(['a-litho-layer'])
    expect(result.current.geotechLayers.map(l => l.id)).toEqual(['a-geotech-layer'])
    vi.mocked(log.error).mockClear()
    vi.mocked(log.warn).mockClear()

    // Open project B. Its model list has NOT arrived yet.
    rerender({ args: makeArgs(project('proj-b')) })

    // PS1 — in the very render of the switch, no model of A is active for B.
    expect(result.current.activeLithoModel).toBeNull()
    expect(result.current.activeGeotechModel).toBeNull()
    expect(result.current.activeGeologicalModel).toBeNull()
    expect(result.current.models).toEqual([])

    await flush()

    // PS2 — no model-scoped request went out with project B + a model of A.
    expect(foreignCalls()).toEqual([])

    // PS3 — A's rows left the screen; nothing of A is kept "last-good" under B.
    expect(result.current.lithoLayers).toEqual([])
    expect(result.current.geotechLayers).toEqual([])
    expect(result.current.activeLithoModel).toBeNull()
    expect(result.current.models).toEqual([])

    // PS4 — B's list arrives; B's own models load.
    await act(async () => {
      releaseB([B_GEO, B_LITHO, B_GEOTECH])
    })
    await flush()
    expect(result.current.activeLithoModel?.id).toBe(B_LITHO.id)
    expect(result.current.activeGeotechModel?.id).toBe(B_GEOTECH.id)
    expect(result.current.lithoLayers.map(l => l.id)).toEqual(['b-litho-layer'])
    expect(result.current.geotechLayers.map(l => l.id)).toEqual(['b-geotech-layer'])
    expect(foreignCalls()).toEqual([])

    // PS5 — the switch logged no error and no failed load.
    expect(log.error).not.toHaveBeenCalled()
    expect(log.warn).not.toHaveBeenCalled()
  })
})
