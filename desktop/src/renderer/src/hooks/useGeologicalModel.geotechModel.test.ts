// Behavioral net for the geotech parallel data-layer additions to
// useGeologicalModel (F2 — geotech data layer).
//
// Claims pinned here:
//   G1  When refreshModels returns a list containing an active
//       kind='geotechnical' model, activeGeotechModel is set to it.
//   G2  When refreshModels returns a list with NO active geotechnical model,
//       activeGeotechModel is null.
//   G3  When activeGeotechModel is set, api.geology.listLayers is called
//       with the geotech model id and geotechLayers is populated.
//   G4  When no geotech model is active, geotechLayers stays empty.
//   G5  geotechContacts is the lithoLayersToContacts projection of
//       geotechLayers (mirrors lithoContacts derivation).
//   G6  geotechFormations filters the global formations list to rows
//       where nad_class !== null (mirrors lithoFormations / isGeotechUnit).
//
// Strategy: mock the whole api.geology module; drive refreshModels by
// setting up listModels to return geo + geotech models; assert the
// derived state after the bootstrap effect settles.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type {
  GeologicalFormationResponse,
  GeologicalModelResponse,
  LithoLayerResponse,
  ProjectResponse,
} from '../api/client'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

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
      seedLithoFromParent: vi.fn(),
      listLithoSolids: vi.fn().mockResolvedValue([]),
      rebuildLithoSolids: vi.fn().mockResolvedValue({
        bodies_built: 0,
        bodies_flagged: 0,
        bodies_considered: 0,
        bodies_skipped_checksum: 0,
        orphans_deleted: 0,
        solids: [],
      }),
      setBodyColor: vi.fn().mockResolvedValue({}),
      hideMarkers: false,
      setHideMarkers: vi.fn(),
    },
    cpt: { list: vi.fn(), get: vi.fn() },
    borehole: { list: vi.fn(), get: vi.fn() },
    section: { list: vi.fn() },
    project: { get: vi.fn(), update: vi.fn() },
    geotechnicalUnit: { list: vi.fn(), create: vi.fn() },
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

// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------

const GEO_MODEL_ID = 'geo-model-1'
const GEOTECH_MODEL_ID = 'geotech-model-1'

const GEO_MODEL: GeologicalModelResponse = {
  id: GEO_MODEL_ID,
  app_project_id: 'proj-1',
  name: 'Default',
  description: null,
  kind: 'geological',
  is_active: true,
  excluded_borehole_ids: [],
  parent_geological_model_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const GEOTECH_MODEL: GeologicalModelResponse = {
  id: GEOTECH_MODEL_ID,
  app_project_id: 'proj-1',
  name: 'Geotech Model',
  description: null,
  kind: 'geotechnical',
  is_active: true,
  excluded_borehole_ids: [],
  parent_geological_model_id: GEO_MODEL_ID,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function makeGeotechLayer(id: string): LithoLayerResponse {
  return {
    id,
    model_id: GEOTECH_MODEL_ID,
    formation_id: 'form-g-1',
    borehole_id: 'bh-1',
    cpt_id: null,
    depth_top_m: 0.0,
    depth_base_m: 2.0,
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

function makeGeotechFormation(id: string): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: 'NAD class 15',
    color: '#4a90d9',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: 15,
    parent_formation_id: 'litho-form-1',
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
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

// ---------------------------------------------------------------------------
// Hook args factory
// ---------------------------------------------------------------------------

function makeArgs() {
  return {
    args: {
      project: TEST_PROJECT,
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
    },
  }
}

// ---------------------------------------------------------------------------
// Setup — wire api mocks so the bootstrap resolves to geo + geotech models
// ---------------------------------------------------------------------------

let apiMock: typeof import('../api/client')['api']

beforeEach(async () => {
  const mod = await import('../api/client')
  apiMock = mod.api

  // Default bootstrap: geo + geotech active models; listLayers returns empty.
  vi.mocked(apiMock.geology.listModels).mockResolvedValue([GEO_MODEL, GEOTECH_MODEL])
  vi.mocked(apiMock.geology.listFormations).mockResolvedValue([])
  vi.mocked(apiMock.geology.listContacts).mockResolvedValue([])
  vi.mocked(apiMock.geology.listSurfaces).mockResolvedValue([])
  vi.mocked(apiMock.geology.validateCrossings).mockResolvedValue({
    model_id: GEO_MODEL_ID,
    issues: [],
  })
  vi.mocked(apiMock.geology.listLayers).mockResolvedValue([])
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('activeGeotechModel (F2 geotech data layer)', () => {
  it('G1 — activeGeotechModel is set when models list contains an active geotechnical model', async () => {
    // G1: when refreshModels returns a list with an active 'geotechnical'
    // model, the hook derives activeGeotechModel from it.
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(result.current.activeGeotechModel).not.toBeNull()
    expect(result.current.activeGeotechModel?.id).toBe(GEOTECH_MODEL_ID)
    expect(result.current.activeGeotechModel?.kind).toBe('geotechnical')
  })

  it('G2 — activeGeotechModel is null when no active geotechnical model exists', async () => {
    // G2: a project with only a geological model → activeGeotechModel stays null.
    vi.mocked(apiMock.geology.listModels).mockResolvedValue([GEO_MODEL])

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(result.current.activeGeotechModel).toBeNull()
  })
})

describe('geotechLayers (F2 geotech data layer)', () => {
  it('G3 — listLayers is called with the geotech model id and geotechLayers is populated', async () => {
    // G3: when activeGeotechModel is set, the hook calls listLayers with
    // the geotech model id and stores the result in geotechLayers.
    const layer = makeGeotechLayer('layer-g-1')
    vi.mocked(apiMock.geology.listLayers).mockImplementation(
      (_projectId, modelId) => {
        // Return the geotech layer only for the geotech model; empty for others.
        if (modelId === GEOTECH_MODEL_ID) return Promise.resolve([layer])
        return Promise.resolve([])
      },
    )

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // listLayers must have been called with the geotech model id.
    expect(apiMock.geology.listLayers).toHaveBeenCalledWith('proj-1', GEOTECH_MODEL_ID)

    // geotechLayers must contain the returned layer.
    expect(result.current.geotechLayers).toHaveLength(1)
    expect(result.current.geotechLayers[0].id).toBe('layer-g-1')
  })

  it('G4 — geotechLayers is empty when no geotech model is active', async () => {
    // G4: no active geotechnical model → geotechLayers stays [].
    vi.mocked(apiMock.geology.listModels).mockResolvedValue([GEO_MODEL])

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(result.current.geotechLayers).toHaveLength(0)
  })
})

describe('geotechContacts (F2 geotech data layer)', () => {
  it('G5 — geotechContacts is the lithoLayersToContacts projection of geotechLayers', async () => {
    // G5: geotechContacts derives from geotechLayers via the same
    // lithoLayersToContacts memo used for lithoContacts — the projected
    // rows have the same id as the source layer rows.
    const layer = makeGeotechLayer('layer-g-2')
    vi.mocked(apiMock.geology.listLayers).mockImplementation(
      (_projectId, modelId) => {
        if (modelId === GEOTECH_MODEL_ID) return Promise.resolve([layer])
        return Promise.resolve([])
      },
    )

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // The contact derived from the layer must carry the same id.
    expect(result.current.geotechContacts).toHaveLength(1)
    expect(result.current.geotechContacts[0].id).toBe('layer-g-2')
  })
})

describe('geotechFormations (F2 geotech data layer)', () => {
  it('G6 — geotechFormations filters formations to rows where nad_class is not null', async () => {
    // G6: geotechFormations is derived from the global formations list
    // via isGeotechUnit (nad_class !== null) — the same pattern as
    // lithoFormations filtering by isLithoUnit (litho_main_soil_code !== null).
    const geotechFm = makeGeotechFormation('fm-geotech-1')
    const geoFm: GeologicalFormationResponse = {
      ...geotechFm,
      id: 'fm-geo-1',
      name: 'Quartair',
      nad_class: null,
      litho_main_soil_code: null,
    }
    vi.mocked(apiMock.geology.listFormations).mockResolvedValue([geoFm, geotechFm])

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Only the row with nad_class set must appear in geotechFormations.
    expect(result.current.geotechFormations).toHaveLength(1)
    expect(result.current.geotechFormations[0].id).toBe('fm-geotech-1')
  })
})
