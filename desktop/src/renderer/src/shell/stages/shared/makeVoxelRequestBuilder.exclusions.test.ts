/**
 * "Build without them should produce the model that was there before the added
 * tests, so just plain ignore them." — owner ruling 2026-08-26.
 *
 * The claim is byte-identity, so that is what is asserted: the payload built
 * while EXCLUDING a test equals, character for character, the payload built
 * from inputs the test was never in. Anything weaker (a column count, a region
 * count) would pass on a payload whose gap fractions had silently moved.
 *
 * EX1  excluding a test == that test never having been imported (geotech arm,
 *      litho frame + packing bands).
 * EX2  the exclusion reaches the LITHO FRAME too — the frame is what names the
 *      payload's columns, so dropping it from the geotech columns alone would
 *      leave the hole the ruling exists to close.
 * EX3  it is not a vacuous comparison: including the test really does change
 *      the payload.
 * EX4  no exclusions == today's payload, on the plain litho arm.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const listContactCorrelations = vi.fn()
const listLenses = vi.fn()
const getBodyBoundary = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    geology: {
      listContactCorrelations: (...args: unknown[]) => listContactCorrelations(...args),
      listLenses: (...args: unknown[]) => listLenses(...args),
      getBodyBoundary: (...args: unknown[]) => getBodyBoundary(...args),
    },
  },
}))

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

import { makeVoxelRequestBuilder } from './makeVoxelRequestBuilder'
import type {
  InvestigationLocation,
  LithoLayerLike,
  SectionLike,
} from '../../../utils/assembleLithoSectionInputs'

const SECTION: SectionLike = {
  id: 'sec-1',
  name: 'Cross-section 1',
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 50,
}

function investigation(id: string, x: number): InvestigationLocation {
  return { id, location_x: x, location_y: 0, elevation_m: 10 }
}

const S1 = investigation('S1', 0)
const S2 = investigation('S2', 50)
const B12 = investigation('B12', 100)

function layer(investigationId: string, formationId: string): LithoLayerLike {
  return {
    id: `${investigationId}-${formationId}`,
    cpt_id: investigationId,
    borehole_id: null,
    formation_id: formationId,
    body_id: `body-${formationId}`,
    depth_top_m: 0,
    depth_base_m: 8,
    status: 'accepted',
  }
}

const LITHO_WITH_B12 = [layer('S1', 'f-litho'), layer('S2', 'f-litho'), layer('B12', 'f-litho')]
const LITHO_WITHOUT_B12 = [layer('S1', 'f-litho'), layer('S2', 'f-litho')]
// B12 was imported after the subdivision, so it carries no packing band at all.
const GEOTECH_BANDS = [layer('S1', 'f-nad'), layer('S2', 'f-nad')]

/** The geotech build: packing bands framed on the litho model. */
function geotechBuilder(investigations: InvestigationLocation[], lithoLayers: LithoLayerLike[]) {
  return makeVoxelRequestBuilder({
    projectId: 'proj-1',
    modelId: 'geotech-1',
    visibleSections: [SECTION],
    investigations,
    layers: GEOTECH_BANDS,
    viewState: null,
    logLabel: 'geotech-voxel',
    frameModelId: 'litho-1',
    frameLayers: lithoLayers,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  listContactCorrelations.mockResolvedValue([])
  listLenses.mockResolvedValue([])
  getBodyBoundary.mockResolvedValue(null)
})

describe('makeVoxelRequestBuilder — "just plain ignore them"', () => {
  it('EX1 — excluding a test yields the payload the model had before that test existed', async () => {
    const excluded = await geotechBuilder([S1, S2, B12], LITHO_WITH_B12)(new Set(['B12']))
    const neverImported = await geotechBuilder([S1, S2], LITHO_WITHOUT_B12)()
    expect(JSON.stringify(excluded)).toBe(JSON.stringify(neverImported))
  })

  it('EX2 — the excluded test names no column in the payload, so the litho frame dropped it too', async () => {
    const excluded = await geotechBuilder([S1, S2, B12], LITHO_WITH_B12)(new Set(['B12']))
    const ids = excluded?.sections.flatMap(s => s.columns.map(c => c.investigation_id)) ?? []
    expect(ids).toEqual(['S1', 'S2'])
  })

  it('EX3 — the comparison is not vacuous: keeping the test changes the payload', async () => {
    const kept = await geotechBuilder([S1, S2, B12], LITHO_WITH_B12)()
    const neverImported = await geotechBuilder([S1, S2], LITHO_WITHOUT_B12)()
    expect(JSON.stringify(kept)).not.toBe(JSON.stringify(neverImported))
    expect(kept?.sections[0].columns.map(c => c.investigation_id)).toEqual(['S1', 'S2', 'B12'])
  })

  it('EX5 — a section left with one banded column really does leave the payload', async () => {
    // This is the claim ``geotechBuildPreflight`` makes about section drops
    // (SD1), asserted against the BUILDER rather than against a reading of it:
    // TIE4 carries S2 + B12, and with B12 unbanded only S2 is subdivided there.
    const TIE4: SectionLike = {
      id: 'tie-4',
      name: 'Tie-section 4',
      start_x: 50,
      start_y: 0,
      end_x: 100,
      end_y: 0,
      projection_buffer_m: 5,
    }
    const payload = await makeVoxelRequestBuilder({
      projectId: 'proj-1',
      modelId: 'geotech-1',
      visibleSections: [SECTION, TIE4],
      investigations: [S1, S2, B12],
      layers: GEOTECH_BANDS,
      viewState: null,
      logLabel: 'geotech-voxel',
      frameModelId: 'litho-1',
      frameLayers: LITHO_WITH_B12,
    })()

    // Cross-section 1 still fills between S1 and S2; Tie-section 4 contributes
    // nothing and is absent entirely.
    expect(payload?.sections).toHaveLength(1)
    expect(payload?.sections[0].end_x).toBe(100)
    expect(payload?.sections[0].start_x).toBe(0)
  })

  it('EX4 — no exclusions leaves the plain litho build exactly as it is today', async () => {
    const litho = (): ReturnType<typeof makeVoxelRequestBuilder> =>
      makeVoxelRequestBuilder({
        projectId: 'proj-1',
        modelId: 'litho-1',
        visibleSections: [SECTION],
        investigations: [S1, S2, B12],
        layers: LITHO_WITH_B12,
        viewState: null,
        logLabel: 'litho-voxel',
      })
    const withUndefined = await litho()(undefined)
    const withEmptySet = await litho()(new Set())
    const withNoArgument = await litho()()
    expect(JSON.stringify(withUndefined)).toBe(JSON.stringify(withNoArgument))
    expect(JSON.stringify(withEmptySet)).toBe(JSON.stringify(withNoArgument))
    expect(withNoArgument?.sections[0].columns.map(c => c.investigation_id)).toEqual([
      'S1',
      'S2',
      'B12',
    ])
  })
})
