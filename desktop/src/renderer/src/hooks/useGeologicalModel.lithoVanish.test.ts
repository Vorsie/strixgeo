// Behavioural net for the owner's installer-#21 PROD BLOCKER (2026-09-06):
// "When I correlated, all accepted lithos disappeared … the lithos disappeared
// from the columns, we can't have that in prod."
//
// The saved .strix still held every accepted layer, so the loss was the
// renderer's view, not the data. The ONLY place ``lithoLayers`` is emptied is
// the litho bootstrap effect (three ``setLithoLayers([])`` sites); it re-runs
// on any ``project`` / ``activeLithoModel`` IDENTITY churn — and a
// ``refreshModels`` returns a new-but-same litho-model object, so the effect
// re-runs, clears to ``[]`` up front, and — if its refetch then fails or is
// cancelled under the correlate / delete-storm concurrency — leaves the section
// permanently empty. The geotech twin does NOT have this bug: it clears only on
// a real model-id change and keeps the last-good rows across a same-model
// refetch. These tests pin that the litho effect now behaves the same way.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type {
  GeologicalModelResponse,
  LithoLayerResponse,
  ProjectResponse,
} from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    geology: {
      listModels: vi.fn(),
      listFormations: vi.fn(),
      listContacts: vi.fn(),
      listLayers: vi.fn().mockResolvedValue([]),
      listSurfaces: vi.fn(),
      validateCrossings: vi.fn(),
      createModel: vi.fn(),
      activateModel: vi.fn(),
      createFormation: vi.fn(),
      createContact: vi.fn(),
      suggestLitho: vi.fn(),
      updateFormation: vi.fn(),
      deleteFormation: vi.fn(),
      updateModel: vi.fn(),
      deleteModel: vi.fn(),
      updateContact: vi.fn(),
      deleteContact: vi.fn(),
      updateContactsBatch: vi.fn(),
      autoPopulateFromStratigraphy: vi.fn(),
      dedupeContacts: vi.fn(),
      rebuildSurfaces: vi.fn(),
      exportPlaxis3d: vi.fn(),
      discoverFromStratigraphy: vi.fn(),
      applyBoreholeFormationSelection: vi.fn(),
      suggestBoreholeFormations: vi.fn(),
      buildGroundSurface: vi.fn(),
      exportSectionPlaxis2d: vi.fn(),
      listLithoSolids: vi.fn().mockResolvedValue([]),
      getGaplessBuildReport: vi.fn().mockResolvedValue(null),
      geotechLithoStaleness: vi.fn().mockResolvedValue({
        geotech_model_id: '',
        litho_model_id: null,
        stale_columns: [],
        stale_column_count: 0,
        banded_column_count: 0,
        unstamped_column_count: 0,
      }),
      setBodyColor: vi.fn().mockResolvedValue({}),
      hideMarkers: false,
      setHideMarkers: vi.fn(),
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

const GEO_MODEL: GeologicalModelResponse = {
  id: 'geo-model-1',
  app_project_id: 'proj-1',
  name: 'Default',
  description: null,
  kind: 'geological',
  is_active: true,
  excluded_borehole_ids: [],
  parent_model_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

// listModels must hand back FRESH objects every call — the real client
// deserialises new objects per request, and the identity churn that re-runs the
// litho effect is exactly what these tests exercise.
function models(): GeologicalModelResponse[] {
  return [
    { ...GEO_MODEL },
    {
      id: 'litho-model-1',
      app_project_id: 'proj-1',
      name: 'Litho',
      description: null,
      kind: 'lithostratigraphic',
      is_active: true,
      excluded_borehole_ids: [],
      parent_model_id: 'geo-model-1',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    },
  ]
}

const TEST_PROJECT: ProjectResponse = {
  id: 'proj-1',
  name: 'Test',
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

function acceptedLayer(id: string, top: number, base: number): LithoLayerResponse {
  return {
    id,
    model_id: 'litho-model-1',
    formation_id: 'form-silt',
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
    source: 'segmenter',
    confidence: 'high',
    borehole_id: null,
    cpt_id: 'cpt-1',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    parent_litho_layer_id: null,
    body_id: 'body-1',
    instance_ordinal: 1,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as unknown as LithoLayerResponse
}

const LAYERS: LithoLayerResponse[] = [
  acceptedLayer('layer-silt', 10.41, 16.72),
  acceptedLayer('layer-sand', 16.72, 16.94),
]

function makeArgs(toast = vi.fn()) {
  return {
    project: TEST_PROJECT,
    toast,
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

let apiMock: (typeof import('../api/client'))['api']

beforeEach(async () => {
  const mod = await import('../api/client')
  apiMock = mod.api
  vi.mocked(apiMock.geology.listModels).mockImplementation(async () => models())
  vi.mocked(apiMock.geology.listFormations).mockResolvedValue([])
  vi.mocked(apiMock.geology.listContacts).mockResolvedValue([])
  vi.mocked(apiMock.geology.listSurfaces).mockResolvedValue([])
  vi.mocked(apiMock.geology.listLayers).mockResolvedValue(LAYERS)
  vi.mocked(apiMock.geology.validateCrossings).mockResolvedValue({
    model_id: GEO_MODEL.id,
    issues: [],
  })
})

async function settle(ticks = 6): Promise<void> {
  for (let i = 0; i < ticks; i += 1) {
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
  }
}

// A view-state autosave (``applyViewStatePatch``) replaces the ``project``
// object with a fresh ``{...prev}`` spread on the SAME id — the churn that
// re-runs the litho bootstrap effect during a correlate / delete-storm burst.
// Handing renderHook a new project object of the same id reproduces it.
function churnedProject(): ProjectResponse {
  return { ...TEST_PROJECT }
}

describe('accepted litho layers never vanish from the section', () => {
  it('after correlating two layers, every accepted layer is still on the section', async () => {
    const { result, rerender } = renderHook(props => useGeologicalModel(props), {
      initialProps: makeArgs(),
    })
    await settle()
    // The section starts with both accepted layers loaded.
    expect(result.current.lithoLayers).toHaveLength(2)

    // A correlate fires a view-state autosave, re-running the litho effect on a
    // new-but-same project object — and, under the concurrent delete-storm, the
    // layer refetch that re-run issues fails. On the old effect this cleared the
    // section to [] and the failed fetch left it there. The layers must survive.
    vi.mocked(apiMock.geology.listLayers).mockRejectedValue(new Error('storm'))
    await act(async () => {
      rerender({ ...makeArgs(), project: churnedProject() })
      await new Promise(r => setTimeout(r, 0))
    })
    await settle()

    expect(result.current.lithoLayers).toHaveLength(2)
    expect(result.current.lithoLayers.map(l => l.id)).toEqual(['layer-silt', 'layer-sand'])
  })

  it('a superseded (never-resolved) refetch does not blank the accepted layers', async () => {
    const { result, rerender } = renderHook(props => useGeologicalModel(props), {
      initialProps: makeArgs(),
    })
    await settle()
    expect(result.current.lithoLayers).toHaveLength(2)

    // The refetch the re-run issues never resolves within the frame (a slow GET
    // under lock contention, superseded by the next churn). The last-good rows
    // must stay on screen rather than blink to empty.
    vi.mocked(apiMock.geology.listLayers).mockImplementation(
      () => new Promise<LithoLayerResponse[]>(() => {}),
    )
    await act(async () => {
      rerender({ ...makeArgs(), project: churnedProject() })
      await new Promise(r => setTimeout(r, 0))
    })
    await settle()

    expect(result.current.lithoLayers).toHaveLength(2)
  })

  it('still clears the section when the active litho model actually changes (debt #147 guard)', async () => {
    const { result, rerender } = renderHook(props => useGeologicalModel(props), {
      initialProps: makeArgs(),
    })
    await settle()
    expect(result.current.lithoLayers).toHaveLength(2)

    // A genuine model switch: the picker refresh now returns a DIFFERENT active
    // litho model whose column carries no layers. The stale model's layers must
    // NOT linger under the new model's header — the same-id guard must fire only
    // when the id is unchanged.
    vi.mocked(apiMock.geology.listModels).mockImplementation(async () => [
      { ...GEO_MODEL },
      {
        id: 'litho-model-2',
        app_project_id: 'proj-1',
        name: 'Litho 2',
        description: null,
        kind: 'lithostratigraphic',
        is_active: true,
        excluded_borehole_ids: [],
        parent_model_id: 'geo-model-1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      } as GeologicalModelResponse,
    ])
    vi.mocked(apiMock.geology.listLayers).mockResolvedValue([])
    await act(async () => {
      rerender({ ...makeArgs(), project: churnedProject() })
      await new Promise(r => setTimeout(r, 0))
    })
    await settle()

    expect(result.current.lithoLayers).toHaveLength(0)
  })
})
