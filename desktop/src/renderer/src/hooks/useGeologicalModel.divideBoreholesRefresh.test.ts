// What the view must reload after "4 · Divide boreholes" commits.
//
// Owner dogfeed 2026-08-15, on the press whose own log line read
// ``ties_superseded=13``: *"ties still run cpt to cpt and no hops are visible?
// only see accepted ties"*.  The server had done its work — it deleted 13
// superseded jump ties and wrote the borehole-mediated chain — but the section
// on screen kept drawing the edge list it had fetched BEFORE the press.  So the
// deleted ties were still painted and the new hops were nowhere, which reads
// exactly like a divide that did nothing.
//
// Divide rewrites the same two server-side things a re-subdivide does — the
// packing bands AND the correlation edges — under an UNCHANGED geotech model
// id, so neither the canvas's edge fetch (keyed on that id) nor the body
// identity refresh re-fires on its own.  ``handleSubdivideCpts`` already bumps
// both signals for this reason; this file pins that divide does too.
//
// Claims pinned here:
//   DBR1  A successful divide bumps requestCorrelationEdgesRefetch — the
//         canvas refetches, so superseded ties disappear and chain hops appear.
//   DBR2  A successful divide schedules the GEOTECH body recompute — new
//         borehole bands plus new ties move body identity.
//   DBR3  A FAILED divide bumps neither: nothing changed server-side, so a
//         refetch would only churn.
//
// Strategy mirrors useGeologicalModel.parentFit.test.ts — mock the whole
// api.geology module, boot geo + litho + geotech models, then invoke the verb.

import { act, renderHook, waitFor } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import {
  clearBoreholesStale,
  getBoreholesStale,
  markBoreholesStale,
} from '../utils/boreholesStaleStore'
import type {
  DivideBoreholeResponse,
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
      divideBoreholes: vi.fn(),
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
  // The failure branch narrows on this to decide between the server's own
  // sentence and the house one, so the mock has to export the class itself.
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

/** The owner's own press: chain hops written, 13 jump ties superseded. */
const DIVIDE_RESULT: DivideBoreholeResponse = {
  geotech_model_id: GEOTECH_MODEL_ID,
  divided_borehole_count: 15,
  single_band_borehole_count: 20,
  layer_count: 55,
  created_formation_ids: [],
  reanchored_tie_count: 0,
  review_tie_reasons: {},
  lost_tie_count: 0,
  lost_tie_reasons: {},
  superseded_jump_tie_count: 13,
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let apiMock: (typeof import('../api/client'))['api']

beforeEach(async () => {
  const mod = await import('../api/client')
  apiMock = mod.api

  vi.mocked(apiMock.geology.listModels).mockResolvedValue([
    GEO_MODEL,
    LITHO_MODEL,
    GEOTECH_MODEL,
  ])
  vi.mocked(apiMock.geology.listFormations).mockResolvedValue([])
  vi.mocked(apiMock.geology.listContacts).mockResolvedValue([])
  vi.mocked(apiMock.geology.listSurfaces).mockResolvedValue([])
  vi.mocked(apiMock.geology.validateCrossings).mockResolvedValue({
    model_id: GEO_MODEL_ID,
    issues: [],
  })
  vi.mocked(apiMock.geology.listLayers).mockResolvedValue([])
  vi.mocked(apiMock.geology.divideBoreholes).mockResolvedValue(DIVIDE_RESULT)
})

/** Hook args with fresh spies for the two coordinator signals under test. */
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
 * Boot the hook and press "Divide boreholes".
 *
 * @param options - Forwarded to the verb; defaults to the open-section press.
 * @returns The hook args, so the caller can read the spies.
 */
async function divide(
  options: Parameters<
    ReturnType<typeof useGeologicalModel>['handleDivideBoreholes']
  >[0] = { sectionId: 'section-1' },
): Promise<ReturnType<typeof makeArgs>> {
  const args = makeArgs()
  const { result } = renderHook(() => useGeologicalModel(args))

  // The verb refuses until both models are live, so wait for the bootstrap.
  await waitFor(() => expect(result.current.activeGeotechModel).not.toBeNull())

  await act(async () => {
    await result.current.handleDivideBoreholes(options)
  })
  return args
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('divide boreholes — what the view reloads afterwards', () => {
  it('DBR1 — a successful divide asks the section to refetch its ties', async () => {
    // The press deletes superseded jump ties and writes the chain hops. Without
    // this bump the canvas keeps the pre-press edge list, so the deleted ties
    // stay painted and the new hops never appear — the owner's report.
    const args = await divide()

    expect(args.requestCorrelationEdgesRefetch).toHaveBeenCalled()
  })

  it('DBR2 — a successful divide schedules the geotech body recompute', async () => {
    // New borehole bands plus new ties both move body identity; the geotech
    // axis is the one that changed, so only that kind is scheduled.
    const args = await divide()

    expect(args.requestBodyRecompute).toHaveBeenCalledWith('geotech')
  })

  it('DBR3 — a failed divide reloads nothing', async () => {
    // Nothing changed server-side, so a refetch would be churn on a view that
    // is already correct.
    vi.mocked(apiMock.geology.divideBoreholes).mockRejectedValue(new Error('boom'))

    const args = await divide()

    expect(args.requestCorrelationEdgesRefetch).not.toHaveBeenCalled()
    expect(args.requestBodyRecompute).not.toHaveBeenCalled()
  })
})

describe('divide boreholes — the global stale flag (audit P1-4)', () => {
  // The amber "Divide boreholes" button reads ONE global flag. A run that
  // leaves any borehole out of date must not clear it: a scoped press that
  // greys the button tells the engineer the OPPOSITE of the truth about the
  // sections it never touched.

  beforeEach(() => {
    markBoreholesStale()
  })

  it('DBR4 — a section-scoped divide keeps the stale flag', async () => {
    // Dividing the open section says nothing about the other sections'
    // boreholes — they are exactly as stale as before the press.
    await divide({ sectionId: 'section-1' })

    expect(getBoreholesStale()).toBe(true)
  })

  it('DBR5 — a borehole-subset divide keeps the stale flag', async () => {
    // Same reasoning per borehole: the ones left out are still out of date.
    await divide({ boreholeIds: ['bh-1'] })

    expect(getBoreholesStale()).toBe(true)
  })

  it('DBR6 — a full all-sections divide clears the stale flag', async () => {
    // Only the unscoped press brings EVERY borehole up to date.
    await divide({})

    expect(getBoreholesStale()).toBe(false)
  })

  it('DBR7 — a failed full divide keeps the stale flag', async () => {
    // Nothing changed server-side, so the boreholes are as stale as before.
    vi.mocked(apiMock.geology.divideBoreholes).mockRejectedValue(new Error('boom'))

    await divide({})

    expect(getBoreholesStale()).toBe(true)
    clearBoreholesStale()
  })
})
