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
//       where source_litho_formation_id !== null — covers BOTH classified
//       (nad_class set) and skeleton / borehole-only (nad_class null)
//       geotech units.  Pure geological and litho rows are excluded.
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
      listLithoSolids: vi.fn().mockResolvedValue([]),
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
  parent_model_id: null,
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
  parent_model_id: GEO_MODEL_ID,
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
    // source_litho_formation_id is the correct discriminator for geotech
    // units (see formationKind.ts).  Classified geotech units have this set
    // AND nad_class set; skeleton/borehole-only units have it set but
    // nad_class null.
    source_litho_formation_id: 'litho-form-1',
    source_geo_formation_id: 'geo-form-1',
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
  it('G6 — geotechFormations includes classified AND skeleton geotech units, excludes geo + litho rows', async () => {
    // G6: geotechFormations is derived from the global formations list via
    // isGeotechUnit (source_litho_formation_id !== null) — covers both a
    // classified geotech unit (nad_class set) and a borehole-only skeleton
    // unit (nad_class null).  Pure geological and litho rows are excluded.
    //
    // The old discriminator (nad_class !== null) silently omitted skeleton
    // units from the roster.
    const classifiedFm = makeGeotechFormation('fm-geotech-classified')
    // Skeleton / borehole-only unit: nad_class still null, but
    // source_litho_formation_id is set (the build wrote this row).
    const skeletonFm: GeologicalFormationResponse = {
      ...classifiedFm,
      id: 'fm-geotech-skeleton',
      name: 'KLEI (geotech skeleton)',
      nad_class: null,
      litho_main_soil_code: 'KLEI',
      source_litho_formation_id: 'litho-form-1',
    }
    // Pure geological formation — must be excluded from geotechFormations.
    const geoFm: GeologicalFormationResponse = {
      ...classifiedFm,
      id: 'fm-geo-1',
      name: 'Quartair',
      nad_class: null,
      litho_main_soil_code: null,
      source_litho_formation_id: null,
      source_geo_formation_id: null,
    }
    vi.mocked(apiMock.geology.listFormations).mockResolvedValue([
      geoFm,
      classifiedFm,
      skeletonFm,
    ])

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Both classified and skeleton geotech rows must appear.
    const ids = result.current.geotechFormations.map(f => f.id).sort()
    expect(ids).toEqual(['fm-geotech-classified', 'fm-geotech-skeleton'].sort())
    // Pure geological row must be excluded.
    expect(ids).not.toContain('fm-geo-1')
  })
})

describe('geotech layers refetch — no blink (#227 slice F)', () => {
  // Every committed band edit calls requestGeotechLayersRefetch. Until
  // 2026-08-08 the load effect cleared geotechLayers BEFORE re-fetching, so
  // the NAD fill's unit-count gate read 0 for a frame and the whole fill
  // blinked off and back on every edit. A SAME-model refetch keeps the last
  // committed rows on screen until the fresh answer lands; only a genuine
  // model switch clears immediately (stale rows under a different model
  // header stay impossible).
  it('G7 — a same-model refetch keeps the last rows visible while in flight', async () => {
    vi.mocked(apiMock.geology.listLayers).mockImplementation(async (_p: string, m: string) =>
      m === GEOTECH_MODEL_ID ? [makeGeotechLayer('layer-old')] : [],
    )
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.geotechLayers.map(l => l.id)).toEqual(['layer-old'])

    // The refetch hangs — the window in which the blink used to happen.
    let release: (rows: ReturnType<typeof makeGeotechLayer>[]) => void = () => {}
    vi.mocked(apiMock.geology.listLayers).mockImplementation(async (_p: string, m: string) => {
      if (m !== GEOTECH_MODEL_ID) return []
      return new Promise(resolve => {
        release = resolve
      })
    })
    act(() => {
      result.current.requestGeotechLayersRefetch()
    })
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.geotechLayers.map(l => l.id)).toEqual(['layer-old'])
    expect(result.current.geotechLayersLoaded).toBe(true)

    await act(async () => {
      release([makeGeotechLayer('layer-new')])
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.geotechLayers.map(l => l.id)).toEqual(['layer-new'])
  })

  it('G8 — switching to a project without a geotech model clears the rows', async () => {
    vi.mocked(apiMock.geology.listLayers).mockImplementation(async (_p: string, m: string) =>
      m === GEOTECH_MODEL_ID ? [makeGeotechLayer('layer-old')] : [],
    )
    const { args } = makeArgs()
    const { result, rerender } = renderHook(
      (props: { args: typeof args }) => useGeologicalModel(props.args),
      { initialProps: { args } },
    )
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.geotechLayers).toHaveLength(1)

    // The next project has no geotech model: the keep-last-rows rule must not
    // leak the old project's bands across the switch.
    vi.mocked(apiMock.geology.listModels).mockResolvedValue([GEO_MODEL])
    rerender({ args: { ...args, project: { ...TEST_PROJECT, id: 'proj-2' } } })
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.geotechLayers).toHaveLength(0)
  })
})
