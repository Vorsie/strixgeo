// Behavioural net for the geology bootstrap's failure isolation.
//
// Owner dogfeed 2026-08-03: opening a project sometimes came up with "the
// units are gone and the model is gone too" — the right-hand geology pane
// empty — healed only by closing and reopening the file. Root cause: the
// bootstrap effect resolved the active model and loaded formations/contacts/
// surfaces successfully, then awaited the model-PICKER refresh inside the
// same try; when that one auxiliary fetch rejected, the outer catch wiped
// every piece of already-loaded geological state. The comment above the call
// claimed the picker "just stays empty on failure" — this file pins that the
// claim is now true.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type { GeologicalModelResponse, ProjectResponse } from '../api/client'

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
      // Debt #266 — the geotech axis reads which columns stand on edited litho.
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

const FORMATION = {
  id: 'form-1',
  app_project_id: 'proj-1',
  name: 'Antropogeen',
  color: '#888888',
  code: null,
  display_order: 0,
  pinned_order: false,
  regional_ref: null,
  description: null,
  lithology: null,
  nad_class: null,
  parent_formation_id: null,
  source_litho_formation_id: null,
  source_geo_formation_id: null,
  litho_main_soil_code: null,
  litho_admixtures: null,
  instance_ordinal: null,
  instance_ordinal_locked: false,
  parent_formation_name: null,
  parent_extrapolated: false,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

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

let apiMock: typeof import('../api/client')['api']

beforeEach(async () => {
  const mod = await import('../api/client')
  apiMock = mod.api
  vi.mocked(apiMock.geology.listFormations).mockResolvedValue([FORMATION])
  vi.mocked(apiMock.geology.listContacts).mockResolvedValue([])
  vi.mocked(apiMock.geology.listSurfaces).mockResolvedValue([])
  vi.mocked(apiMock.geology.validateCrossings).mockResolvedValue({
    model_id: GEO_MODEL.id,
    issues: [],
  })
})

describe('geology bootstrap failure isolation', () => {
  it('keeps the resolved model and formations when only the picker refresh fails', async () => {
    // listModels serves two callers in sequence: resolveActiveModel (the
    // bootstrap) and refreshModels (the picker). Succeed for the first,
    // reject for the second — the exact shape the owner hit.
    vi.mocked(apiMock.geology.listModels)
      .mockResolvedValueOnce([GEO_MODEL])
      .mockRejectedValueOnce(new Error('flaky picker fetch'))
    const toast = vi.fn()
    const { result } = renderHook(() => useGeologicalModel(makeArgs(toast)))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // The geological flow keeps everything it already loaded — the units and
    // the model must NOT vanish from the geology pane.
    expect(result.current.activeGeologicalModel?.id).toBe(GEO_MODEL.id)
    expect(result.current.formations).toHaveLength(1)
    // And the wipe's error toast must not fire for a picker-only failure.
    expect(toast).not.toHaveBeenCalledWith('error', expect.stringMatching(/could not load/i))
  })

  it('still wipes and toasts when the bootstrap itself fails', async () => {
    // The catch's wipe is correct when nothing usable was resolved — a dead
    // backend must not leave half-initialised state behind.
    vi.mocked(apiMock.geology.listModels).mockRejectedValue(new Error('backend down'))
    const toast = vi.fn()
    const { result } = renderHook(() => useGeologicalModel(makeArgs(toast)))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(result.current.activeGeologicalModel).toBeNull()
    expect(toast).toHaveBeenCalledWith('error', expect.stringMatching(/could not load/i))
  })
})
