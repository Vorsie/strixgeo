// Which columns the hook reports as needing re-deriving, from the live layers.
//
// The pure rule (utils/geotechParentFit) already knows what an overhang is. What
// is pinned HERE is the wiring: that the hook pairs each packing band with the
// litho unit it subdivides ON ITS OWN COLUMN, and hands the pairs to the rule.
//
// Claims pinned here:
//   PFH1  Every band inside its litho parent → no column needs re-deriving.
//   PFH2  A band whose litho parent's top moved BELOW the band top → exactly
//         that column is reported.
//   PFH3  The parent is looked up per COLUMN: a litho row for the same
//         formation on a DIFFERENT column never judges this column's bands —
//         and a column with NO row of the band's formation left is out of
//         date on its own account (the unit was re-composed or deleted).
//   PFH4  A litho formation that occurs more than once on one column (the norm
//         on the owner's model — 119 of 199 column/formation pairs) is matched
//         occurrence by occurrence: each band is judged against the occurrence
//         it actually overlaps, not against whichever row came last.
//   PFH5  A borehole-anchored band is judged and reported like a CPT's (owner
//         2026-09-10: a re-composed piece under a borehole's band read as up to
//         date); "Divide boreholes" is the verb for it.
//   PFH6  A band whose litho parent cannot be resolved is not reported (the
//         rule's own ruling: a data-integrity problem is not staleness).
//
// Strategy mirrors useGeologicalModel.geotechModel.test.ts — mock the whole
// api.geology module, return litho rows for the litho model id and packing
// bands for the geotech model id, then read the derived field.

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
const GEOTECH_MODEL_ID = 'geotech-model-1'
/** The litho formation every packing band in this file subdivides. */
const LITHO_FORMATION_ID = 'litho-form-1'
/** The geotech (NAD-class) formation the bands belong to. */
const GEOTECH_FORMATION_ID = 'geotech-form-1'

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

/** A litho row: the unit `formationId` occupies on `cptId`. */
function lithoRow(
  id: string,
  cptId: string,
  topDepthM: number,
  baseDepthM: number,
  formationId = LITHO_FORMATION_ID,
): LithoLayerResponse {
  return {
    id,
    model_id: LITHO_MODEL_ID,
    formation_id: formationId,
    borehole_id: null,
    cpt_id: cptId,
    depth_top_m: topDepthM,
    depth_base_m: baseDepthM,
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

/** A packing band on a CPT column. */
function band(
  id: string,
  cptId: string,
  topDepthM: number,
  baseDepthM: number,
  formationId = GEOTECH_FORMATION_ID,
): LithoLayerResponse {
  return {
    ...lithoRow(id, cptId, topDepthM, baseDepthM, formationId),
    model_id: GEOTECH_MODEL_ID,
  }
}

/** A packing band hung off a borehole instead of a CPT. */
function boreholeBand(
  id: string,
  boreholeId: string,
  topDepthM: number,
  baseDepthM: number,
): LithoLayerResponse {
  return {
    ...band(id, 'unused', topDepthM, baseDepthM),
    cpt_id: null,
    borehole_id: boreholeId,
  }
}

/** The geotech unit the bands belong to, pointing at its litho parent. */
const GEOTECH_FORMATION: GeologicalFormationResponse = {
  id: GEOTECH_FORMATION_ID,
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
  parent_formation_id: null,
  source_litho_formation_id: LITHO_FORMATION_ID,
  source_geo_formation_id: 'geo-form-1',
  litho_main_soil_code: 'ZAND',
  litho_admixtures: null,
  instance_ordinal: null,
  instance_ordinal_locked: false,
  parent_formation_name: null,
  parent_extrapolated: false,
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
    markMutated: vi.fn(),
  }
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
  vi.mocked(apiMock.geology.listFormations).mockResolvedValue([GEOTECH_FORMATION])
  vi.mocked(apiMock.geology.listContacts).mockResolvedValue([])
  vi.mocked(apiMock.geology.listSurfaces).mockResolvedValue([])
  vi.mocked(apiMock.geology.validateCrossings).mockResolvedValue({
    model_id: GEO_MODEL_ID,
    issues: [],
  })
  vi.mocked(apiMock.geology.listLayers).mockResolvedValue([])
})

/**
 * Boot the hook with the given litho rows and packing bands loaded.
 *
 * @param litho Rows the litho model returns.
 * @param geotech Rows the geotech model returns.
 * @returns The columns the hook says need re-deriving.
 */
async function stale(
  litho: LithoLayerResponse[],
  geotech: LithoLayerResponse[],
): Promise<string[]> {
  vi.mocked(apiMock.geology.listLayers).mockImplementation(
    async (_projectId: string, modelId: string) => {
      if (modelId === LITHO_MODEL_ID) return litho
      if (modelId === GEOTECH_MODEL_ID) return geotech
      return []
    },
  )
  const { result } = renderHook(() => useGeologicalModel(makeArgs()))
  await act(async () => {
    await new Promise(r => setTimeout(r, 0))
  })
  return result.current.columnsNeedingRederive
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('columnsNeedingRederive (parent fit, derived from the live layers)', () => {
  it('PFH1 — bands that sit inside their litho parent report nothing', async () => {
    // The unit runs 2→8 on cpt-A; the two bands that subdivide it fill it
    // exactly. Nothing has moved, so the engineer is told nothing.
    expect(
      await stale(
        [lithoRow('l1', 'cpt-A', 2, 8)],
        [band('b1', 'cpt-A', 2, 5), band('b2', 'cpt-A', 5, 8)],
      ),
    ).toEqual([])
  })

  it('PFH2 — a band left above its parent after the contact moved down names its column', async () => {
    // The engineer dragged the unit's top from 2 down to 4. The band still
    // starts at 2 — it describes ground the unit no longer covers.
    expect(
      await stale(
        [lithoRow('l1', 'cpt-A', 4, 8)],
        [band('b1', 'cpt-A', 2, 5), band('b2', 'cpt-A', 5, 8)],
      ),
    ).toEqual(['cpt-A'])
  })

  it('PFH3 — the same formation on another column never judges this one; its own unit gone = out of date', async () => {
    // cpt-A carries the band; the only litho row for its formation is on
    // cpt-B, where the unit sits far deeper. The columns are separate holes in
    // the ground and say nothing about each other, so cpt-B's depths never
    // judge cpt-A. But cpt-A has NO row of the band's formation left at all:
    // the unit the band was derived from is gone (re-composed or deleted), and
    // that is exactly "out of date" (owner 2026-09-10) — reported for cpt-A on
    // its own account, never against cpt-B.
    expect(
      await stale([lithoRow('l1', 'cpt-B', 20, 28)], [band('b1', 'cpt-A', 2, 5)]),
    ).toEqual(['cpt-A'])
  })

  it('PFH4 — a formation that recurs on one column is matched occurrence by occurrence', async () => {
    // Two ZAND bodies on cpt-A: 0→2 and 5→8, with one band inside each. Both
    // fit, so nothing is stale — but only if each band is judged against the
    // occurrence it overlaps. Keeping one row per (column, formation) judges
    // one of the two bands against the other body and reports a column the
    // engineer has not touched, whichever row happens to be kept.
    expect(
      await stale(
        [lithoRow('l1', 'cpt-A', 5, 8), lithoRow('l2', 'cpt-A', 0, 2)],
        [band('b1', 'cpt-A', 0.5, 1.5), band('b2', 'cpt-A', 5.5, 7.5)],
      ),
    ).toEqual([])
  })

  it("PFH5 — a borehole band is judged like a CPT's and reported (owner 2026-09-10)", async () => {
    // Boreholes were skipped because "Subdivide CPTs" cannot re-derive one.
    // Then the owner re-composed a piece under a borehole's band and the
    // geotech axis kept reading the old soil with nothing saying the column
    // was out of date. The mark is the point; "Divide boreholes" is the verb.
    // Here bh-1 carries the band and no litho row of its formation: its unit
    // is gone, so bh-1 is out of date.
    expect(
      await stale([lithoRow('l1', 'cpt-A', 2, 8)], [boreholeBand('b1', 'bh-1', 2, 10)]),
    ).toEqual(['bh-1'])
  })

  it('PFH6 — a band whose parent cannot be resolved is not reported', async () => {
    // The band's geotech formation is not in the project's formation list, so
    // no litho parent resolves. Re-deriving cannot repair that, and saying so
    // every time the section opens would be noise.
    expect(
      await stale(
        [lithoRow('l1', 'cpt-A', 2, 8)],
        [band('b1', 'cpt-A', 0, 10, 'geotech-form-unknown')],
      ),
    ).toEqual([])
  })
})
