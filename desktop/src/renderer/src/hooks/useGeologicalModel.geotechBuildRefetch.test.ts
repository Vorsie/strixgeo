// What the units pane must re-read after a geotech "Build model" press.
//
// Owner dogfeed 2026-09-01: yesterday's backend fix makes the geotech Build heal
// the litho parent links (``litho_layer.parent_litho_layer_id`` +
// ``body.parent_litho_body_id``). The DB comes out correct — every geotech body
// points at a real litho body — but the units-pane tree kept showing everything
// under "Zonder litho-lichaam" until a manual app reload, because the roster the
// pane groups by (``useModelBodies`` for the geotech model) only re-fetched on a
// body-recompute nonce, which the Build never bumps.
//
// The fix: a completed geotech Build bumps a dedicated roster-refetch nonce so the
// pane re-READS the already-correct DB. It is a refetch, NOT a recompute — the
// geotech stage cannot assemble the Sections partition payload a recompute needs,
// and the DB is already right, so a recompute would be both impossible here and
// far heavier than needed.
//
// Claims pinned here:
//   GBR1  A completed geotech build bumps ``geotechBodyRosterRefetchNonce``.
//   GBR2  A geotech build does NOT schedule a body recompute (refetch, not
//         recompute).
//   GBR3  A LITHO build leaves the geotech roster nonce untouched — the litho
//         roster is a different model and must not churn on a geotech-only signal.
//
// Strategy mirrors useGeologicalModel.divideBoreholesRefresh.test.ts — mock the
// whole api.geology module, boot geo + litho + geotech models, then drive the
// build handlers directly.

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type { GeologicalModelResponse, ProjectResponse } from '../api/client'
import type { VoxelBuildRequest } from '../utils/buildVoxelRequest'

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
      // The build POST — never reached here (the builder resolves to null, the
      // documented "nothing to build" no-op), but present so a stray call would
      // not throw an unmocked-fn error and silently pass the wrong thing.
      buildVoxelLithoModel: vi.fn(),
      geotechLithoStaleness: vi.fn().mockResolvedValue({
        geotech_model_id: '',
        litho_model_id: null,
        stale_columns: [],
        stale_column_count: 0,
        banded_column_count: 0,
        unstamped_column_count: 0,
      }),
      setBodyColor: vi.fn().mockResolvedValue({}),
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
  ApiError: class ApiError extends Error {},
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

const LITHO_MODEL: GeologicalModelResponse = {
  ...GEO_MODEL,
  id: LITHO_MODEL_ID,
  name: 'Litho Model',
  kind: 'lithostratigraphic',
  parent_model_id: GEO_MODEL_ID,
}

const GEOTECH_MODEL: GeologicalModelResponse = {
  ...GEO_MODEL,
  id: GEOTECH_MODEL_ID,
  name: 'Geotech Model',
  kind: 'geotechnical',
  parent_model_id: GEO_MODEL_ID,
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
// Setup
// ---------------------------------------------------------------------------

let apiMock: (typeof import('../api/client'))['api']

beforeEach(async () => {
  const mod = await import('../api/client')
  apiMock = mod.api

  vi.mocked(apiMock.geology.listModels).mockResolvedValue([GEO_MODEL, LITHO_MODEL, GEOTECH_MODEL])
  vi.mocked(apiMock.geology.listFormations).mockResolvedValue([])
  vi.mocked(apiMock.geology.listContacts).mockResolvedValue([])
  vi.mocked(apiMock.geology.listSurfaces).mockResolvedValue([])
  vi.mocked(apiMock.geology.validateCrossings).mockResolvedValue({
    model_id: GEO_MODEL_ID,
    issues: [],
  })
  vi.mocked(apiMock.geology.listLayers).mockResolvedValue([])
})

/** Hook args with a fresh recompute spy — GBR2 asserts it is never touched. */
function makeArgs() {
  return {
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
    requestBodyRecompute: vi.fn(),
    markMutated: vi.fn(),
  }
}

/**
 * Boot the hook with all three models live.
 *
 * @returns The renderHook result and the args (so a caller can read the spies).
 */
async function bootHook() {
  const args = makeArgs()
  const { result } = renderHook(() => useGeologicalModel(args))
  // The geotech build handler acts on the geotech model, so wait for the
  // bootstrap to make it live before pressing.
  await waitFor(() => expect(result.current.activeGeotechModel).not.toBeNull())
  return { result, args }
}

// A builder that resolves to null is the documented "nothing to build" no-op —
// buildLithoSolids returns before the POST. It exercises the wrapper's
// build-then-refresh path without depending on the voxel build-response shape:
// the roster re-read fires when the build press COMPLETES, and a no-op build
// harmlessly re-reads unchanged data (owner-blessed finally-style refresh).
const NULL_BUILDER = () => Promise.resolve(null)

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('geotech build — the units-pane roster re-read (debt #278 dogfeed)', () => {
  it('GBR1 — a completed geotech build bumps the roster refetch nonce', async () => {
    const { result } = await bootHook()
    const before = result.current.geotechBodyRosterRefetchNonce ?? 0

    await act(async () => {
      await result.current.buildGeotechSolids(NULL_BUILDER)
    })

    expect(result.current.geotechBodyRosterRefetchNonce ?? 0).toBe(before + 1)
  })

  it('GBR2 — a geotech build re-reads the roster, it does not recompute bodies', async () => {
    const { result, args } = await bootHook()

    await act(async () => {
      await result.current.buildGeotechSolids(NULL_BUILDER)
    })

    // The DB is already correct after the Build; a recompute would need the
    // Sections partition payload this stage cannot assemble. So the roster is
    // re-read, never re-resolved.
    expect(args.requestBodyRecompute).not.toHaveBeenCalled()
  })

  it('GBR3 — a litho build leaves the geotech roster nonce untouched', async () => {
    const { result } = await bootHook()
    const before = result.current.geotechBodyRosterRefetchNonce ?? 0

    await act(async () => {
      await result.current.buildLithoSolids(NULL_BUILDER)
    })

    expect(result.current.geotechBodyRosterRefetchNonce ?? 0).toBe(before)
  })

  // debt #282 parity: the geotech Build now runs as a streaming background job.
  // Its `done` handling must refresh EVERYTHING the synchronous path refreshed —
  // including the units-pane roster re-read (GBR1) — or the healed litho-parent
  // links stay hidden until a manual reload, exactly the bug the sync path fixed.
  it('GBR4 — a completed STREAMING geotech build also bumps the roster nonce', async () => {
    const encoder = new TextEncoder()
    const sseDone = {
      ok: true,
      status: 200,
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: 'done',
                bodies_built: 1,
                bodies_flagged: 0,
                solids: [],
                gapless_report: null,
              })}\n\n`,
            ),
          )
          controller.close()
        },
      }),
    } as unknown as Response
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 202,
        json: async () => ({ job_id: 'job-g1' }),
      } as unknown as Response)
      .mockResolvedValueOnce(sseDone)
    vi.stubGlobal('fetch', fetchMock)
    try {
      const { result } = await bootHook()
      const before = result.current.geotechBodyRosterRefetchNonce ?? 0

      await act(async () => {
        await result.current.startGeotechBuild?.(
          () => Promise.resolve({ sections: [{}], grid_spacing_m: 2 } as unknown as VoxelBuildRequest),
        )
      })

      await waitFor(() =>
        expect(result.current.geotechBodyRosterRefetchNonce ?? 0).toBe(before + 1),
      )
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
