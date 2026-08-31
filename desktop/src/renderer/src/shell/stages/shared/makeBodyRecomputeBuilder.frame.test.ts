/**
 * makeBodyRecomputeBuilder.frame.test.ts — a GEOTECH recompute framed on the
 * litho model (owner ruling R6, debt #278).
 *
 * Body identity must be decided from the picture the render shows — the
 * hierarchical fill on the LITHO FRAME's columns. The assembler's job here is
 * the orchestration around that:
 *
 *   * with ``frameModelId`` / ``frameLayers`` the geotech payload is built on the
 *     litho frame's column axis — including a test the packing model has not
 *     divided, which the geotech's own axis drops;
 *   * the frame's approved edges are fetched PLAIN (no dropSuspendedReviewEdges):
 *     the litho frame is geometry scaffolding and the suspension reasons are
 *     GEOTECH tie reasons, so they must not silence a litho tie;
 *   * a partial / failed frame fetch REFUSES the whole assembly (null + warning):
 *     a payload from a partial frame would state the wrong families.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../../api/client'
import type { LithoContactCorrelationEdge } from '../../../api/clients/geology.types'
import type { LithoLayerLike, SectionLike } from '../../../utils/assembleLithoSectionInputs'
import { log } from '../../../utils/log'
import { assembleBodyRecomputePayload } from './makeBodyRecomputeBuilder'

vi.mock('../../../api/client', () => ({
  api: {
    geology: {
      listContactCorrelations: vi.fn(),
      listLenses: vi.fn(),
      getBodyBoundary: vi.fn(),
    },
  },
}))

const listContactCorrelations = vi.mocked(api.geology.listContactCorrelations)

const GEOTECH_MODEL = 'mGeo'
const LITHO_MODEL = 'mLitho'

const SECTION: SectionLike = {
  id: 's1',
  name: 'Section 1',
  start_x: 0,
  start_y: 0,
  end_x: 100,
  end_y: 0,
  projection_buffer_m: 10,
  excluded_cpt_ids: null,
  excluded_borehole_ids: null,
}

// Three tests along the line; the middle one (M) is divided by the litho model
// but NOT the packing model — so it lives on the frame's axis, not the geotech's.
const INVESTIGATIONS = [
  { id: 'A', location_x: 0, location_y: 0, elevation_m: 10 },
  { id: 'M', location_x: 50, location_y: 0, elevation_m: 10 },
  { id: 'C', location_x: 100, location_y: 0, elevation_m: 10 },
]

const CLASS_OF = new Map([['g-clay-stiff', 'KLEI|10']])

function layerRow(
  id: string,
  cptId: string,
  formation: string,
  top: number,
  base: number,
): LithoLayerLike {
  return {
    id,
    cpt_id: cptId,
    borehole_id: null,
    formation_id: formation,
    body_id: null,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
  }
}

// Geotech model: only A and C carry the clay-stiff band — M is un-divided.
const GEOTECH_LAYERS: LithoLayerLike[] = [
  layerRow('GA-clay', 'A', 'g-clay-stiff', 0, 4),
  layerRow('GC-clay', 'C', 'g-clay-stiff', 0, 4),
]

// Litho frame: A/C carry clay over sand, M carries sand only (no clay).
const LITHO_LAYERS: LithoLayerLike[] = [
  layerRow('LA-clay', 'A', 'f-clay', 0, 4),
  layerRow('LA-sand', 'A', 'f-sand', 4, 14),
  layerRow('LM-sand', 'M', 'f-sand', 0, 14),
  layerRow('LC-clay', 'C', 'f-clay', 0, 4),
  layerRow('LC-sand', 'C', 'f-sand', 4, 14),
]

function edge(
  id: string,
  a: string,
  b: string,
  aSide: 'top' | 'base',
  bSide: 'top' | 'base',
  reviewReason: string | null = null,
): LithoContactCorrelationEdge {
  return {
    id,
    model_id: 'x',
    section_id: 's1',
    source: 'manual',
    user_approved: true,
    review_reason: reviewReason,
    created_at: '2026-08-31T00:00:00Z',
    layer_a_id: a,
    layer_b_id: b,
    layer_a_side: aSide,
    layer_b_side: bSide,
  }
}

const GEOTECH_EDGES = [edge('ge1', 'GA-clay', 'GC-clay', 'top', 'top')]
const LITHO_EDGES = [
  edge('le1', 'LA-clay', 'LC-clay', 'top', 'top'),
  edge('le2', 'LA-sand', 'LM-sand', 'top', 'top'),
  edge('le3', 'LM-sand', 'LC-sand', 'top', 'top'),
]

/** Params for a framed geotech recompute. */
function framedParams(): Parameters<typeof assembleBodyRecomputePayload>[0] {
  return {
    projectId: 'p1',
    modelId: GEOTECH_MODEL,
    visibleSections: [SECTION],
    investigations: INVESTIGATIONS,
    layers: GEOTECH_LAYERS,
    logLabel: 'geotech-recompute',
    packingClassOf: CLASS_OF,
    frameModelId: LITHO_MODEL,
    frameLayers: LITHO_LAYERS,
  }
}

beforeEach(() => {
  listContactCorrelations.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('assembleBodyRecomputePayload — framed on the litho model', () => {
  it('builds the geotech payload on the litho frame axis (the un-divided middle stays)', async () => {
    listContactCorrelations.mockImplementation((_p, modelId) =>
      Promise.resolve(modelId === LITHO_MODEL ? LITHO_EDGES : GEOTECH_EDGES),
    )
    const payload = await assembleBodyRecomputePayload(framedParams())
    expect(payload).not.toBeNull()
    // The frame owns the axis, so its un-divided middle test is named — the
    // geotech model's own columns would be just A and C.
    expect(payload!.sections[0].columns.map((c) => c.investigation_id)).toEqual(['A', 'M', 'C'])
  })

  it('fetches the litho frame edges PLAIN — a suspended reason does not silence a litho tie', async () => {
    // The frame's CLAY tie carries a class_changed flag. That reason suspends a
    // GEOTECH tie from unioning; on the litho frame it is not a geotech reason
    // at all, so the frame must KEEP it. Kept, the clay is one litho body across
    // A→C and the two clay-stiff bands weld into one mass; dropped, the frame's
    // clay splits per test and they never weld.
    const flaggedLithoEdges = [
      edge('le1', 'LA-clay', 'LC-clay', 'top', 'top', 'class_changed'),
      edge('le2', 'LA-sand', 'LM-sand', 'top', 'top'),
      edge('le3', 'LM-sand', 'LC-sand', 'top', 'top'),
    ]
    listContactCorrelations.mockImplementation((_p, modelId) =>
      Promise.resolve(modelId === LITHO_MODEL ? flaggedLithoEdges : GEOTECH_EDGES),
    )
    const payload = await assembleBodyRecomputePayload(framedParams())
    expect(payload).not.toBeNull()
    // The kept litho clay tie makes A→C one body on the frame, so the evidence
    // welds both clay-stiff bands. A dropped frame tie would split them.
    const weldsClay = payload!.layer_groups[0].some(
      (g) => g.includes('GA-clay') && g.includes('GC-clay'),
    )
    expect(weldsClay, 'the framed clay weld was lost — the frame tie was dropped').toBe(true)
  })

  it('refuses (null + warning) when the litho frame edges fail to load', async () => {
    const warnSpy = vi.spyOn(log, 'warn')
    listContactCorrelations.mockImplementation((_p, modelId) =>
      modelId === LITHO_MODEL
        ? Promise.reject(new Error('frame edges down'))
        : Promise.resolve(GEOTECH_EDGES),
    )
    const payload = await assembleBodyRecomputePayload(framedParams())
    expect(payload).toBeNull()
    expect(warnSpy).toHaveBeenCalled()
  })
})
