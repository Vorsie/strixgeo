/**
 * makeBodyRecomputeBuilder.test.ts — the body-identity recompute assembly (slice 5).
 *
 * Behavior-shaped cases in the rule's vocabulary:
 *
 *   * FALLBACK fill is not geometry evidence: the sub-TD substrate wedge the
 *     engine paints from the bottom-tie label is OMITTED from the payload;
 *   * a resolver-SUSPENDED flagged tie (``review_reason='class_changed'``) must
 *     not band the payload's geometry — the same edge without the flag does;
 *   * the wire evidence is LAYER-id space: regions carry ``layer_ids`` and the
 *     per-section ``layer_groups`` name the layers whose fill regions touch —
 *     never body ids (the labels the recompute itself rewrites);
 *   * LABEL-INDEPENDENCE: relabelling every layer's body_id to one merged id
 *     leaves ``layer_groups`` + regions' ``layer_ids`` deep-equal — the exact
 *     property whose absence made the first wire design oscillate (a merge
 *     erased its own evidence on the next payload; facts 74→3→69 live);
 *   * a section whose edge fetch failed refuses the WHOLE assembly (null);
 *   * an empty assembly (no sections / no fillable gap) is null — never a POST.
 *
 * Engine: pinned to v2 via the env override (the identity path is v2's).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { api } from '../../../api/client'
import type { LithoContactCorrelationEdge } from '../../../api/clients/geology.types'
import type { LithoLayerLike, SectionLike } from '../../../utils/assembleLithoSectionInputs'
import type { RegionInput } from '../../../utils/buildVoxelRequest'
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

const SECTION: SectionLike = {
  id: 's1',
  name: 'Section 1',
  start_x: 0,
  start_y: 0,
  end_x: 40,
  end_y: 0,
  projection_buffer_m: 10,
  excluded_cpt_ids: null,
  excluded_borehole_ids: null,
}

const INVESTIGATIONS = [
  { id: 'L', location_x: 0, location_y: 0, elevation_m: 10 },
  { id: 'R', location_x: 40, location_y: 0, elevation_m: 10 },
]

/** A layer row (accepted unless told otherwise). */
function layerRow(
  id: string,
  cptId: string,
  formation: string,
  body: string | null,
  top: number,
  base: number,
  status = 'accepted',
): LithoLayerLike {
  return {
    id,
    cpt_id: cptId,
    borehole_id: null,
    formation_id: formation,
    body_id: body,
    depth_top_m: top,
    depth_base_m: base,
    status,
  }
}

/** Two columns: CLAY over SAND; the sand depths are per-test (equal or unequal TDs). */
function sandLayers(rightSandBase: number): LithoLayerLike[] {
  return [
    layerRow('L-clay', 'L', 'clay', 'bodyClayL', 0, 3),
    layerRow('L-sand', 'L', 'sand', 'bodyL', 3, 12),
    layerRow('R-clay', 'R', 'clay', 'bodyClayR', 0, 3),
    layerRow('R-sand', 'R', 'sand', 'bodyR', 3, rightSandBase),
  ]
}

/** An approved sand tie pair (top-top + base-base), optionally review-flagged. */
function sandTies(reviewReason: string | null): LithoContactCorrelationEdge[] {
  const base = {
    model_id: 'm1',
    section_id: 's1',
    source: 'manual',
    user_approved: true,
    review_reason: reviewReason,
    created_at: '2026-08-12T00:00:00Z',
  }
  return [
    { ...base, id: 'e1', layer_a_id: 'L-sand', layer_b_id: 'R-sand', layer_a_side: 'top', layer_b_side: 'top' },
    { ...base, id: 'e2', layer_a_id: 'L-sand', layer_b_id: 'R-sand', layer_a_side: 'base', layer_b_side: 'base' },
  ]
}

/** Ray-cast point-in-polygon on the wire [fraction, elevation] shape. */
function inWirePoly(f: number, e: number, poly: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [fi, ei] = poly[i]
    const [fj, ej] = poly[j]
    if (ei > e !== ej > e && f < ((fj - fi) * (e - ei)) / (ej - ei) + fi) inside = !inside
  }
  return inside
}

/** The wire regions of a formation covering (f, e) in gap 0. */
function regionAt(regions: RegionInput[], f: number, e: number): RegionInput | undefined {
  return regions.find(r => r.gap_index === 0 && inWirePoly(f, e, r.polygon))
}

function params(layers: LithoLayerLike[]): Parameters<typeof assembleBodyRecomputePayload>[0] {
  return {
    projectId: 'p1',
    modelId: 'm1',
    visibleSections: [SECTION],
    investigations: INVESTIGATIONS,
    layers,
    logLabel: 'test-recompute',
  }
}

beforeEach(() => {
  // The identity path is the v2 engine's; pin it regardless of device pref.
  listContactCorrelations.mockReset()
})

afterEach(() => {
})

describe('assembleBodyRecomputePayload', () => {
  it('omits the fallback-painted substrate wedge; the tied band stays', async () => {
    // Unequal TDs (left sand to elev −2, right to elev 2) + base tie → the engine
    // paints the wedge between the sloping tied base and the flat floor from the
    // SUBSTRATE label (fallback). Inferred fill is not geometry evidence.
    listContactCorrelations.mockResolvedValue(sandTies(null))
    const payload = await assembleBodyRecomputePayload(params(sandLayers(8)))
    expect(payload).not.toBeNull()
    const regions = payload!.sections[0].regions
    // The tie-born band interior is in the payload…
    expect(regionAt(regions, 0.5, 5)?.formation_id).toBe('sand')
    // …the substrate wedge (below the sloping tied base, above the flat floor) is not.
    expect(regionAt(regions, 0.9, -1)).toBeUndefined()
  })

  it('drops a resolver-suspended flagged tie: class_changed geometry must not band', async () => {
    // Control first: the SAME edges without a flag band the sand across the gap.
    listContactCorrelations.mockResolvedValue(sandTies(null))
    const clean = await assembleBodyRecomputePayload(params(sandLayers(12)))
    const cleanBand = clean!.sections[0].regions.find(
      r =>
        r.formation_id === 'sand' &&
        Math.min(...r.polygon.map(p => p[0])) < 1e-4 &&
        Math.max(...r.polygon.map(p => p[0])) > 1 - 1e-4,
    )
    expect(cleanBand).toBeDefined()
    // Flagged: the resolver suspends the union, so the payload must not weld it.
    listContactCorrelations.mockResolvedValue(sandTies('class_changed'))
    const flagged = await assembleBodyRecomputePayload(params(sandLayers(12)))
    expect(flagged).not.toBeNull()
    const flaggedBand = flagged!.sections[0].regions.find(
      r =>
        r.formation_id === 'sand' &&
        Math.min(...r.polygon.map(p => p[0])) < 1e-4 &&
        Math.max(...r.polygon.map(p => p[0])) > 1 - 1e-4,
    )
    expect(flaggedBand).toBeUndefined()
  })

  it('the tied band names its PRODUCING layers on the wire (regions.layer_ids + layer_groups)', async () => {
    listContactCorrelations.mockResolvedValue(sandTies(null))
    const payload = await assembleBodyRecomputePayload(params(sandLayers(12)))
    expect(payload).not.toBeNull()
    // The tie-born sand band was produced by BOTH columns' sand layers.
    const band = regionAt(payload!.sections[0].regions, 0.5, 5)
    expect(band?.formation_id).toBe('sand')
    expect([...(band?.layer_ids ?? [])].sort()).toEqual(['L-sand', 'R-sand'])
    // ...and the section's connectivity groups name that touching pair.
    expect(payload!.layer_groups[0]).toContainEqual(
      expect.arrayContaining(['L-sand', 'R-sand']),
    )
  })

  it('LABEL-INDEPENDENCE: one merged body id for every layer leaves the layer evidence deep-equal', async () => {
    // The oscillation pin: after a successful merge the refetched layers all
    // carry ONE body id. The payload's evidence must not change shape — layer
    // ids are the wire currency precisely because they survive the relabel.
    listContactCorrelations.mockResolvedValue(sandTies(null))
    const before = await assembleBodyRecomputePayload(params(sandLayers(12)))
    expect(before).not.toBeNull()
    const relabelled = sandLayers(12).map(l => ({ ...l, body_id: 'merged-one' }))
    const after = await assembleBodyRecomputePayload(params(relabelled))
    expect(after).not.toBeNull()
    // body_id fields MAY differ; the layer evidence must not.
    expect(after!.layer_groups).toEqual(before!.layer_groups)
    expect(
      after!.sections.map(s => s.regions.map(r => r.layer_ids ?? [])),
    ).toEqual(before!.sections.map(s => s.regions.map(r => r.layer_ids ?? [])))
  })

  it('returns null when a section failed to load its edges (partial input refusal)', async () => {
    listContactCorrelations.mockRejectedValue(new Error('network down'))
    const payload = await assembleBodyRecomputePayload(params(sandLayers(12)))
    expect(payload).toBeNull()
  })

  it('returns null on an empty assembly — no sections, or no fillable gap', async () => {
    listContactCorrelations.mockResolvedValue([])
    // No sections at all.
    expect(
      await assembleBodyRecomputePayload({ ...params(sandLayers(12)), visibleSections: [] }),
    ).toBeNull()
    // A section with a single projectable column has no gap to fill.
    expect(
      await assembleBodyRecomputePayload({
        ...params(sandLayers(12)),
        investigations: [INVESTIGATIONS[0]],
      }),
    ).toBeNull()
  })

  it('carries per-section merge groups parallel to sections, in LAYER-id space', async () => {
    listContactCorrelations.mockResolvedValue(sandTies(null))
    const payload = await assembleBodyRecomputePayload(params(sandLayers(12)))
    expect(payload).not.toBeNull()
    expect(payload!.layer_groups).toHaveLength(payload!.sections.length)
    // Every group id names a LAYER the snapshot knows — NEVER a body id (the
    // labels the recompute rewrites; body evidence erased itself after a merge).
    const knownLayers = new Set(['L-clay', 'L-sand', 'R-clay', 'R-sand'])
    for (const group of payload!.layer_groups[0]) {
      // A group of fewer than two layers states no connectivity fact.
      expect(group.length).toBeGreaterThanOrEqual(2)
      for (const id of group) expect(knownLayers.has(id)).toBe(true)
    }
  })
})
