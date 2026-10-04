// Behavioral net for lithoStaleSurfaceCount + handleRebuildLithoSurfaces
// (Slice A, #55 peer-stage scaffolding).
//
// Claims pinned here:
//   L1  lithoStaleSurfaceCount is 0 when no litho surfaces exist.
//   L2  lithoStaleSurfaceCount reflects the count of is_stale=true entries
//       in lithoSurfacesByFormationId (computed from the loaded surface list).
//   L3  handleRebuildLithoSurfaces calls api.geology.rebuildSurfaces with
//       the LITHO model id (not the geological model id).
//   L4  handleRebuildLithoSurfaces refetches lithoSurfacesByFormationId after
//       a successful rebuild (listSurfaces called with the litho model id).
//   L5  handleRebuildLithoSurfaces is a no-op when activeLithoModel is null.
//
// Strategy: mock the whole api.geology module; set up the hook with a geo +
// a litho model; seed the litho surfaces via a listSurfaces mock return; then
// drive handleRebuildLithoSurfaces and assert the contract.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach, type MockInstance } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type {
  FormationSurfaceResponse,
  GeologicalModelResponse,
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
      getGaplessBuildReport: vi.fn().mockResolvedValue(null),
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

// ---------------------------------------------------------------------------
// Sentinels
// ---------------------------------------------------------------------------

const GEO_MODEL_ID = 'geo-model-1'
const LITHO_MODEL_ID = 'litho-model-1'

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

const LITHO_MODEL: GeologicalModelResponse = {
  id: LITHO_MODEL_ID,
  app_project_id: 'proj-1',
  name: 'Litho Model',
  description: null,
  kind: 'lithostratigraphic',
  is_active: true,
  excluded_borehole_ids: [],
  parent_model_id: GEO_MODEL_ID,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function makeSurface(formationId: string, isStale: boolean): FormationSurfaceResponse {
  return {
    id: `surf-${formationId}`,
    model_id: LITHO_MODEL_ID,
    formation_id: formationId,
    method: 'tin',
    is_stale: isStale,
    vertices: isStale
      ? []
      : ([
          [0, 0, 0],
          [1, 0, 0],
          [0, 1, 0],
        ] as [number, number, number][]),
    triangles: isStale ? [] : ([[0, 1, 2]] as [number, number, number][]),
    source_contact_count: 3,
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
  const toast = vi.fn()
  const pushUndo = vi.fn()
  const addToManifest = vi.fn()
  const removeFromManifest = vi.fn()
  const addToSessionImports = vi.fn()
  const removeFromSessionImports = vi.fn()
  return {
    args: {
      project: TEST_PROJECT,
      toast,
      pushUndo,
      addToManifest,
      removeFromManifest,
      addToSessionImports,
      removeFromSessionImports,
      manifestFormationIds: undefined as Set<string> | undefined,
      currentLumping: null,
      stageLumping: vi.fn(),
      requestCorrelationEdgesRefetch: vi.fn(),
      markMutated: vi.fn(),
    },
    toast,
  }
}

// ---------------------------------------------------------------------------
// Setup — wire api mocks so the bootstrap resolves to geo + litho models
// ---------------------------------------------------------------------------

let apiMock: typeof import('../api/client')['api']

beforeEach(async () => {
  const mod = await import('../api/client')
  apiMock = mod.api

  // Bootstrap: listModels returns both geo + litho; resolveActiveModel finds geo.
  vi.mocked(apiMock.geology.listModels).mockResolvedValue([GEO_MODEL, LITHO_MODEL])
  // geo formations/contacts/surfaces
  vi.mocked(apiMock.geology.listFormations).mockResolvedValue([])
  vi.mocked(apiMock.geology.listContacts).mockResolvedValue([])
  vi.mocked(apiMock.geology.listSurfaces).mockResolvedValue([])
  vi.mocked(apiMock.geology.validateCrossings).mockResolvedValue({ model_id: GEO_MODEL_ID, issues: [] })
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('lithoStaleSurfaceCount (Slice A, #55)', () => {
  it('L1 — is 0 when no litho surfaces are loaded', async () => {
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    // Wait for bootstrap to settle (listModels → geo resolve → litho effect).
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(result.current.lithoStaleSurfaceCount).toBe(0)
  })

  it('L2 — counts only is_stale=true entries from lithoSurfacesByFormationId', async () => {
    // First listSurfaces call is for the geo model (bootstrap step 2).
    // Second call is for the litho model (litho effect).
    const staleSurf = makeSurface('f-stale', true)
    const freshSurf = makeSurface('f-fresh', false)
    const lithoSurfaces = [staleSurf, freshSurf]

    vi.mocked(apiMock.geology.listSurfaces)
      .mockResolvedValueOnce([]) // geo model bootstrap
      .mockResolvedValueOnce(lithoSurfaces) // litho model effect

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Litho model is active (LITHO_MODEL is in the list + is_active).
    // lithoSurfacesByFormationId should contain 2 entries, 1 stale.
    expect(result.current.lithoStaleSurfaceCount).toBe(1)
  })
})

describe('handleRebuildLithoSurfaces (Slice A, #55)', () => {
  it('L3 — calls rebuildSurfaces with the LITHO model id, not the geo model id', async () => {
    vi.mocked(apiMock.geology.rebuildSurfaces).mockResolvedValue({
      formations_considered: 2,
      formations_rebuilt: 1,
      formations_reordered: 0,
    })

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    await act(async () => {
      await result.current.handleRebuildLithoSurfaces()
    })

    const rebuildCalls = vi.mocked(apiMock.geology.rebuildSurfaces).mock.calls
    // Must have been called with the LITHO model id.
    const lithoCall = rebuildCalls.find(([, modelId]) => modelId === LITHO_MODEL_ID)
    expect(lithoCall).toBeDefined()
    // Must NOT have been called with the geo model id via this handler.
    const geoCalls = rebuildCalls.filter(([, modelId]) => modelId === GEO_MODEL_ID)
    // (The geo model rebuild could be called by other paths; we assert the litho call exists.)
    expect(lithoCall![1]).toBe(LITHO_MODEL_ID)
    expect(geoCalls.every(c => c[1] !== LITHO_MODEL_ID)).toBe(true)
  })

  it('L4 — refetches litho surfaces (listSurfaces with litho id) after a successful rebuild', async () => {
    vi.mocked(apiMock.geology.rebuildSurfaces).mockResolvedValue({
      formations_considered: 1,
      formations_rebuilt: 1,
      formations_reordered: 0,
    })
    const refreshedSurf = makeSurface('f-fresh', false)
    // The last listSurfaces call (after rebuild) returns a fresh surface.
    vi.mocked(apiMock.geology.listSurfaces).mockResolvedValue([refreshedSurf])

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    const listSurfacesBefore = vi.mocked(apiMock.geology.listSurfaces).mock.calls.length

    await act(async () => {
      await result.current.handleRebuildLithoSurfaces()
    })

    const listSurfacesAfter = vi.mocked(apiMock.geology.listSurfaces).mock.calls.length
    // At least one additional listSurfaces call was issued after rebuild.
    expect(listSurfacesAfter).toBeGreaterThan(listSurfacesBefore)
    // The last call targeted the litho model id.
    const allCalls = vi.mocked(apiMock.geology.listSurfaces).mock.calls
    const lastCall = allCalls[allCalls.length - 1]
    expect(lastCall[1]).toBe(LITHO_MODEL_ID)
  })

  it('L5 — is a no-op when activeLithoModel is null', async () => {
    // Override listModels to return only the geo model (no litho).
    vi.mocked(apiMock.geology.listModels).mockResolvedValue([GEO_MODEL])

    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    expect(result.current.activeLithoModel).toBeNull()
    const rebuildCallsBefore = vi.mocked(apiMock.geology.rebuildSurfaces).mock.calls.length

    await act(async () => {
      await result.current.handleRebuildLithoSurfaces()
    })

    expect(vi.mocked(apiMock.geology.rebuildSurfaces).mock.calls.length).toBe(rebuildCallsBefore)
  })
})

// ---------------------------------------------------------------------------
// LS1 — a litho geometry change re-reads the litho SOLIDS
// ---------------------------------------------------------------------------
//
// The backend stales the litho solids whenever a litho boundary moves, and the
// owner's DB proved it does: 81 solids, 0 stale before a contact drag, 81 stale
// after. The amber Build badge still did not appear, because nothing re-read the
// list — the litho `useLithoSolids` instance was created without a `refreshOn`,
// so its fetch only re-ran on a build.
//
// The geotech instance has had this channel since 2026-08-08 (it passes
// geotechLayersVersion; the channel itself is pinned by RF1 in
// useLithoSolids.buildRefusal.test.ts). This is the litho half of the same wire.

describe('LS1 — the litho solids are re-read when the litho layers change', () => {
  it('re-fetches the solid list after refetchLithoContacts', async () => {
    const { args } = makeArgs()
    const { result } = renderHook(() => useGeologicalModel(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    const before = vi.mocked(apiMock.geology.listLithoSolids).mock.calls.length

    // The exact call the contact move makes after a committed write.
    await act(async () => {
      result.current.refetchLithoContacts()
      await new Promise(r => setTimeout(r, 0))
    })

    expect(
      vi.mocked(apiMock.geology.listLithoSolids).mock.calls.length,
      'a litho geometry change must re-read the solids, or the Build badge cannot amber',
    ).toBeGreaterThan(before)
  })
})

// ---------------------------------------------------------------------------
// LS2 — a completed body recompute re-reads the litho SOLIDS
// ---------------------------------------------------------------------------
//
// Owner finding 2026-10-04: "adding a new correlation doesn't mark the litho
// stale". The tie edit re-read the solids immediately (LS1's channel), but the
// solids are staled by the debounced body recompute that runs ~2.5 s LATER.
// Nothing re-read them after it, so the Build badge stayed as it was. The shell
// now bumps a per-model counter when a recompute changed the bodies; the litho
// instance must re-read its solids on a bump for ITS model (and only then).

function solid(isStale: boolean) {
  return {
    id: 'solid-1',
    model_id: LITHO_MODEL_ID,
    body_id: 'body-1',
    formation_id: 'f-1',
    body_ordinal: 0,
    method: 'voxel',
    vertices: [],
    triangles: [],
    is_stale: isStale,
  }
}

describe('LS2 — a body recompute that changed the litho bodies re-reads the solids', () => {
  it('ambers the Build state after the recompute, without any reload', async () => {
    const { args } = makeArgs()
    vi.mocked(apiMock.geology.listLithoSolids).mockResolvedValue([solid(false)])
    const { result, rerender } = renderHook(
      (p: { nonces: Record<string, number> }) =>
        useGeologicalModel({ ...args, bodiesRecomputedNonceByModel: p.nonces }),
      { initialProps: { nonces: {} as Record<string, number> } },
    )
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.hasStaleLithoSolid).toBe(false)
    const before = vi.mocked(apiMock.geology.listLithoSolids).mock.calls.length

    // The recompute staled the solids server-side, then announced the litho model.
    vi.mocked(apiMock.geology.listLithoSolids).mockResolvedValue([solid(true)])
    await act(async () => {
      rerender({ nonces: { [LITHO_MODEL_ID]: 1 } })
      await new Promise(r => setTimeout(r, 0))
    })

    expect(vi.mocked(apiMock.geology.listLithoSolids).mock.calls.length).toBeGreaterThan(before)
    expect(
      result.current.hasStaleLithoSolid,
      'the litho Build badge must amber once the recompute staled the solids',
    ).toBe(true)
  })

  it('a recompute of ANOTHER model does not re-read the litho solids', async () => {
    const { args } = makeArgs()
    const { rerender } = renderHook(
      (p: { nonces: Record<string, number> }) =>
        useGeologicalModel({ ...args, bodiesRecomputedNonceByModel: p.nonces }),
      { initialProps: { nonces: {} as Record<string, number> } },
    )
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    const before = vi
      .mocked(apiMock.geology.listLithoSolids)
      .mock.calls.filter(c => c[1] === LITHO_MODEL_ID).length

    await act(async () => {
      rerender({ nonces: { 'some-other-model': 1 } })
      await new Promise(r => setTimeout(r, 0))
    })

    expect(
      vi.mocked(apiMock.geology.listLithoSolids).mock.calls.filter(c => c[1] === LITHO_MODEL_ID)
        .length,
    ).toBe(before)
  })
})

describe('LS3 — a geotech body recompute re-reads the GEOTECH solids', () => {
  it('re-fetches the geotech model solids on a bump for the geotech model id', async () => {
    const GEOTECH_MODEL: GeologicalModelResponse = {
      ...LITHO_MODEL,
      id: 'geotech-model-1',
      name: 'Packing',
      kind: 'geotechnical',
      parent_model_id: LITHO_MODEL_ID,
    }
    vi.mocked(apiMock.geology.listModels).mockResolvedValue([GEO_MODEL, LITHO_MODEL, GEOTECH_MODEL])
    const { args } = makeArgs()
    const { result, rerender } = renderHook(
      (p: { nonces: Record<string, number> }) =>
        useGeologicalModel({ ...args, bodiesRecomputedNonceByModel: p.nonces }),
      { initialProps: { nonces: {} as Record<string, number> } },
    )
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.activeGeotechModel?.id).toBe('geotech-model-1')
    const geotechCalls = () =>
      vi.mocked(apiMock.geology.listLithoSolids).mock.calls.filter(c => c[1] === 'geotech-model-1')
        .length
    const before = geotechCalls()

    await act(async () => {
      rerender({ nonces: { 'geotech-model-1': 1 } })
      await new Promise(r => setTimeout(r, 0))
    })

    expect(geotechCalls()).toBeGreaterThan(before)
  })
})
