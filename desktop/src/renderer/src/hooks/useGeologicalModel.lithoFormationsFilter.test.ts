// Regression net for the litho-builder discriminator (debt #88,
// 2026-05-21). The prior bootstrap filter — ``f.lithology != null`` —
// dropped every formation created by the AcceptLithoSuggestions path
// because that path sets ``litho_main_soil_code`` only and never
// populates ``lithology`` (the 3-level-model column). Tests below
// pin the new behaviour:
//
//   LF1  Bootstrap captures a litho-builder formation
//        (lithology=null, litho_main_soil_code='ZAND',
//        parent_formation_id set) into ``lithoFormations``.
//   LF2  Orphan litho-builder formation (parent_formation_id=null)
//        also passes the filter — debt #87 leaves orphans in the
//        bus; the inspector / picker handle them via the
//        "Unassigned" bucket.
//   LF3  Pure geological formation (lithology=null,
//        litho_main_soil_code=null) is excluded.
//   LF4  Picker-style formation that DOES set ``lithology`` (the
//        explicit POST /formations path) is also included — the new
//        filter is a superset of the old, so backwards-compat with
//        picker-created units is preserved.

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type {
  GeologicalFormationResponse,
  GeologicalModelResponse,
  ProjectResponse,
} from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    geology: {
      listModels: vi.fn(),
      listFormations: vi.fn(),
      listContacts: vi.fn(),
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
      acceptLithoSuggestions: vi.fn(),
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

const GEO_MODEL_ID = 'geo-1'
const LITHO_MODEL_ID = 'litho-1'

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

const LITHO_MODEL: GeologicalModelResponse = {
  id: LITHO_MODEL_ID,
  app_project_id: 'proj-1',
  name: 'Litho',
  description: null,
  kind: 'lithostratigraphic',
  is_active: true,
  excluded_borehole_ids: [],
  parent_geological_model_id: GEO_MODEL_ID,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const PROJECT: ProjectResponse = {
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

function makeFormation(
  overrides: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id: 'f',
    app_project_id: 'proj-1',
    name: 'F',
    color: '#aaaaaa',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    // Realistic litho-builder defaults: lithology stays null (the column
    // is only set by POST /formations with lithology=...; the accept
    // path does not populate it).
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

function makeArgs() {
  return {
    project: PROJECT,
    toast: vi.fn(),
    pushUndo: vi.fn(),
    addToManifest: vi.fn(),
    removeFromManifest: vi.fn(),
    addToSessionImports: vi.fn(),
    removeFromSessionImports: vi.fn(),
    manifestFormationIds: undefined as Set<string> | undefined,
    currentLumping: null,
    stageLumping: vi.fn(),
  }
}

let apiMock: typeof import('../api/client')['api']

beforeEach(async () => {
  const mod = await import('../api/client')
  apiMock = mod.api

  vi.mocked(apiMock.geology.listModels).mockResolvedValue([GEO_MODEL, LITHO_MODEL])
  vi.mocked(apiMock.geology.listContacts).mockResolvedValue([])
  vi.mocked(apiMock.geology.listSurfaces).mockResolvedValue([])
  vi.mocked(apiMock.geology.validateCrossings).mockResolvedValue({
    model_id: GEO_MODEL_ID,
    issues: [],
  })
})

describe('lithoFormations bootstrap filter (debt #88)', () => {
  // LF1 — the regression case: builder-created litho units that DO
  // NOT set the legacy `lithology` column must still land in
  // lithoFormations.
  it('LF1 — litho-builder formation (lithology=null, litho_main_soil_code set) is captured', async () => {
    const builderUnit = makeFormation({
      id: 'lf-1',
      name: 'ZAND',
      litho_main_soil_code: 'ZAND',
      parent_formation_id: 'geo-parent',
    })
    vi.mocked(apiMock.geology.listFormations).mockResolvedValue([builderUnit])

    const { result } = renderHook(() => useGeologicalModel(makeArgs()))

    await waitFor(() => {
      expect(result.current.lithoFormations).toHaveLength(1)
    })
    expect(result.current.lithoFormations[0].id).toBe('lf-1')
  })

  // LF2 — orphan builder unit (no parent) also passes — orphans are
  // intentionally left visible by the bus so the LithologyInspector
  // can show them in its "Unassigned" group. The cleanup of orphan
  // creation is tracked separately as debt #87.
  it('LF2 — orphan litho-builder formation (parent_formation_id=null) is captured', async () => {
    const orphan = makeFormation({
      id: 'lf-orphan',
      name: 'SILT',
      litho_main_soil_code: 'SILT',
      parent_formation_id: null,
    })
    vi.mocked(apiMock.geology.listFormations).mockResolvedValue([orphan])

    const { result } = renderHook(() => useGeologicalModel(makeArgs()))

    await waitFor(() => {
      expect(result.current.lithoFormations).toHaveLength(1)
    })
    expect(result.current.lithoFormations[0].id).toBe('lf-orphan')
  })

  // LF3 — pure geological formation must not leak into the litho list.
  it('LF3 — pure geological formation is excluded', async () => {
    const geo = makeFormation({
      id: 'geo-1',
      name: 'Quartair Holoceen',
      // No litho_main_soil_code, no nad_class — pure geological.
    })
    vi.mocked(apiMock.geology.listFormations).mockResolvedValue([geo])

    const { result } = renderHook(() => useGeologicalModel(makeArgs()))

    // Wait for bootstrap to settle, then assert empty.
    await waitFor(() => {
      expect(vi.mocked(apiMock.geology.listFormations)).toHaveBeenCalled()
    })
    // A second tick to let setLithoFormations resolve.
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.lithoFormations).toHaveLength(0)
  })

  // LF4 — backwards-compat: picker-created units that DO set the
  // legacy `lithology` column are also captured (a litho unit by
  // either signal). Without this, the discriminator change would
  // regress existing projects.
  it('LF4 — picker-style formation (lithology set, litho_main_soil_code set) is captured', async () => {
    const pickerUnit = makeFormation({
      id: 'lf-picker',
      name: 'KLEI',
      lithology: 'KLEI',  // legacy column the picker sets
      litho_main_soil_code: 'KLEI',  // builder column also set
      parent_formation_id: 'geo-parent',
    })
    vi.mocked(apiMock.geology.listFormations).mockResolvedValue([pickerUnit])

    const { result } = renderHook(() => useGeologicalModel(makeArgs()))

    await waitFor(() => {
      expect(result.current.lithoFormations).toHaveLength(1)
    })
    expect(result.current.lithoFormations[0].id).toBe('lf-picker')
  })
})
