/**
 * buildBodyRecomputePayload.test.ts — geotech body identity from the picture the
 * render shows (owner ruling R6, debt #278).
 *
 * "which masses count as one body is decided from the picture the owner looks
 * at" — the hierarchical geotech fill on the LITHO FRAME's columns, not the litho
 * v2 engine on the geotech band columns. These pins are written in that
 * vocabulary:
 *
 *   * a GEOTECH payload built WITH a litho frame posts the hierarchical fill's
 *     regions computed on the FRAME's column axis, and never posts the fill's
 *     ``lithoFallback`` ("correlate me") cover;
 *   * its ``layer_groups`` are the class-keyed groups the frame's hierarchical
 *     regions weld into — GEOTECH band layer ids, in layer-id space;
 *   * a region welded across a gap names bands from BOTH its columns (the
 *     answering-column attribution the fill does in fillGap — guarded here so a
 *     future fill refactor cannot silently drop it);
 *   * a LITHO payload (no frame) is byte-identical to the identity engine's own
 *     output — adding the optional frame never disturbs the litho path;
 *   * a geotech section with no usable frame falls back to the v2-identity path,
 *     and the server's exact-coverage rule still holds (empty sections re-added).
 *
 * Expectations are derived from the SAME public engine the builder calls (the
 * pattern buildVoxelRequest.test.ts uses), so a pin measures the contract, not a
 * hand-copied number.
 */
import { describe, expect, it } from 'vitest'

import {
  assembleSectionPartitionFrames,
  toRegionInputs,
  type SectionPartitionInput,
} from './buildVoxelRequest'
import { buildBodyRecomputePayload } from './buildBodyRecomputePayload'
import type { FenceSectionInput } from './buildProjectFence'
import { frameAlignedColumns } from './frameAlignedPartition'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { computeSectionFillActive, computeSectionFillActiveWithIdentity } from './partitionEngineSelect'
import { mergeTouchingBodiesWithGroups } from './partitionFillV2/mergeTouchingBodies'
import type { CorrelationEdge } from './sectionPartition'
import type { FenceLayerInput, FenceProjectedColumn } from './sectionFenceData'

// ---------------------------------------------------------------------------
// Fixture helpers — flat collars, horizontal sections, depths in metres.
// ---------------------------------------------------------------------------

const col = (id: string, alongM: number): FenceProjectedColumn => ({
  investigationId: id,
  alongM,
  surfaceElevM: 10,
})

const layer = (
  inv: string,
  layerId: string,
  formationId: string,
  top: number,
  base: number,
): FenceLayerInput => ({
  investigationId: inv,
  layerId,
  formationId,
  bodyId: null,
  topDepthM: top,
  baseDepthM: base,
  accepted: true,
})

const tie = (a: string, b: string): CorrelationEdge => ({ a, b })

const CLASS_OF = new Map([
  ['g-clay-stiff', 'KLEI|10'],
  ['g-sand-dense', 'ZAND|8'],
])

const ENDPOINTS = { start_x: 0, start_y: 0, end_x: 100, end_y: 0 }

/** The hierarchical fill the framed geotech payload MUST mirror, computed the
 *  same way the builder does (single-section scenes only). */
function framedFill(frameSections: FenceSectionInput[], geotechSections: FenceSectionInput[]) {
  const frame = assembleSectionPartitionFrames(frameSections, undefined)[0]
  const geoCols = assembleSectionPartitionFrames(geotechSections, undefined)[0].columns
  const lithoRegions = computeSectionFillActive(
    frame.columns,
    frame.input.edges,
    frame.apexOverrides,
    frame.alongM,
  )
  const hierarchical = computeHierarchicalGeotechFill({
    lithoColumns: frame.columns,
    lithoEdges: frame.input.edges,
    lithoRegions,
    geotechColumns: frameAlignedColumns(
      frame.columns,
      new Map(geoCols.map((c) => [c.investigationId, c])),
    ),
    geotechEdges: geotechSections[0].edges,
    alongM: frame.alongM,
    packingClassOf: CLASS_OF,
  })
  return { frame, hierarchical }
}

// ---------------------------------------------------------------------------
// SCENE A (tests 1): a middle test the packing model has NOT divided at all.
// The litho FRAME carries it (sand under it, no clay); the geotech bands do
// not, so it is dropped from the geotech's own column axis but stays on the
// frame's. Clay is divided on A and C; sand is not divided anywhere.
// ---------------------------------------------------------------------------

function undividedMiddleScene(): { frameSections: FenceSectionInput[]; geotechSections: FenceSectionInput[] } {
  const frameSections: FenceSectionInput[] = [
    {
      sectionId: 's1',
      section: ENDPOINTS,
      projectedColumns: [col('A', 0), col('M', 50), col('C', 100)],
      layers: [
        layer('A', 'LA-clay', 'f-clay', 0, 4),
        layer('A', 'LA-sand', 'f-sand', 4, 14),
        layer('M', 'LM-sand', 'f-sand', 0, 14),
        layer('C', 'LC-clay', 'f-clay', 0, 4),
        layer('C', 'LC-sand', 'f-sand', 4, 14),
      ],
      edges: [tie('LA-clay', 'LC-clay'), tie('LA-sand', 'LM-sand'), tie('LM-sand', 'LC-sand')],
    },
  ]
  const geotechSections: FenceSectionInput[] = [
    {
      sectionId: 's1',
      section: ENDPOINTS,
      projectedColumns: [col('A', 0), col('M', 50), col('C', 100)],
      layers: [layer('A', 'GA-clay', 'g-clay-stiff', 0, 4), layer('C', 'GC-clay', 'g-clay-stiff', 0, 4)],
      edges: [tie('GA-clay', 'GC-clay')],
    },
  ]
  return { frameSections, geotechSections }
}

// ---------------------------------------------------------------------------
// SCENE B (test 2): the middle test carries the litho CLAY but was never
// DIVIDED for it (only its sand is classed). On the frame that un-divided clay
// BLOCKS the clay family — the two clay bands are NOT one body (they read
// "correlate me" over the middle). The geotech's own column axis has no litho
// frame to tell it the clay is un-divided there, so the explicit A→C clay tie
// welds them anyway. The two representations DISAGREE on body identity, and the
// framed one is the picture the render shows.
// ---------------------------------------------------------------------------

function blockedMiddleClayScene(): { frameSections: FenceSectionInput[]; geotechSections: FenceSectionInput[] } {
  const frameSections: FenceSectionInput[] = [
    {
      sectionId: 's1',
      section: ENDPOINTS,
      projectedColumns: [col('A', 0), col('M', 50), col('C', 100)],
      layers: [
        layer('A', 'LA-clay', 'f-clay', 0, 4),
        layer('A', 'LA-sand', 'f-sand', 4, 14),
        layer('M', 'LM-clay', 'f-clay', 0, 4),
        layer('M', 'LM-sand', 'f-sand', 4, 14),
        layer('C', 'LC-clay', 'f-clay', 0, 4),
        layer('C', 'LC-sand', 'f-sand', 4, 14),
      ],
      edges: [
        tie('LA-clay', 'LM-clay'),
        tie('LM-clay', 'LC-clay'),
        tie('LA-sand', 'LM-sand'),
        tie('LM-sand', 'LC-sand'),
      ],
    },
  ]
  const geotechSections: FenceSectionInput[] = [
    {
      sectionId: 's1',
      section: ENDPOINTS,
      projectedColumns: [col('A', 0), col('M', 50), col('C', 100)],
      layers: [
        layer('A', 'GA-clay', 'g-clay-stiff', 0, 4),
        layer('A', 'GA-sand', 'g-sand-dense', 4, 14),
        // Divided for the SAND only — the clay band was never derived on M.
        layer('M', 'GM-sand', 'g-sand-dense', 4, 14),
        layer('C', 'GC-clay', 'g-clay-stiff', 0, 4),
        layer('C', 'GC-sand', 'g-sand-dense', 4, 14),
      ],
      edges: [tie('GA-clay', 'GC-clay'), tie('GA-sand', 'GM-sand'), tie('GM-sand', 'GC-sand')],
    },
  ]
  return { frameSections, geotechSections }
}

// ---------------------------------------------------------------------------
// SCENE C (tests 3, 5): two tests, clay over sand, both bands tied — a clean
// spanning weld the fill credits to both columns.
// ---------------------------------------------------------------------------

function spanningWeldScene(): { frameSections: FenceSectionInput[]; geotechSections: FenceSectionInput[] } {
  const frameSections: FenceSectionInput[] = [
    {
      sectionId: 's1',
      section: ENDPOINTS,
      projectedColumns: [col('A', 0), col('B', 100)],
      layers: [
        layer('A', 'LA-clay', 'f-clay', 0, 6),
        layer('A', 'LA-sand', 'f-sand', 6, 14),
        layer('B', 'LB-clay', 'f-clay', 0, 6),
        layer('B', 'LB-sand', 'f-sand', 6, 14),
      ],
      edges: [tie('LA-clay', 'LB-clay'), tie('LA-sand', 'LB-sand')],
    },
  ]
  const geotechSections: FenceSectionInput[] = [
    {
      sectionId: 's1',
      section: ENDPOINTS,
      projectedColumns: [col('A', 0), col('B', 100)],
      layers: [
        layer('A', 'GA-clay', 'g-clay-stiff', 0, 6),
        layer('A', 'GA-sand', 'g-sand-dense', 6, 14),
        layer('B', 'GB-clay', 'g-clay-stiff', 0, 6),
        layer('B', 'GB-sand', 'g-sand-dense', 6, 14),
      ],
      edges: [tie('GA-clay', 'GB-clay'), tie('GA-sand', 'GB-sand')],
    },
  ]
  return { frameSections, geotechSections }
}

describe('buildBodyRecomputePayload — geotech identity from the framed picture', () => {
  it('D1: posts the hierarchical fill on the FRAME axis; lithoFallback is never posted', () => {
    const { frameSections, geotechSections } = undividedMiddleScene()
    const { hierarchical } = framedFill(frameSections, geotechSections)

    const payload = buildBodyRecomputePayload(
      geotechSections,
      undefined,
      'test-recompute',
      CLASS_OF,
      frameSections,
    )
    expect(payload).not.toBeNull()

    // The payload names the FRAME's columns — including the un-divided middle
    // test the geotech's own axis drops.
    expect(payload!.sections[0].columns.map((c) => c.investigation_id)).toEqual(['A', 'M', 'C'])

    // The posted regions ARE the hierarchical fill's own (fallback-excluded).
    const expected = toRegionInputs(hierarchical.regions.filter((r) => r.fallback !== true))
    expect(payload!.sections[0].regions).toEqual(expected)

    // The un-subdivided sand is the fill's "correlate me" cover — it must NOT
    // reach the payload (inferred cover is not body geometry).
    expect(hierarchical.lithoFallback.some((r) => r.formationId === 'f-sand')).toBe(true)
    expect(payload!.sections[0].regions.some((r) => r.formation_id === 'f-sand')).toBe(false)
  })

  it('D2-groups: layer_groups are the class-keyed groups of the frame regions, in layer-id space', () => {
    const { frameSections, geotechSections } = blockedMiddleClayScene()
    const { frame, hierarchical } = framedFill(frameSections, geotechSections)

    const payload = buildBodyRecomputePayload(
      geotechSections,
      undefined,
      'test-recompute',
      CLASS_OF,
      frameSections,
    )
    expect(payload).not.toBeNull()

    // On the frame the un-divided middle clay BLOCKS the family, so the two
    // clay bands are NOT one body — the geotech's own axis (welding the explicit
    // A→C tie without a frame) would state the opposite.
    const weldsClay = payload!.layer_groups[0].some(
      (g) => g.includes('GA-clay') && g.includes('GC-clay'),
    )
    expect(weldsClay, 'the framed evidence welded a clay blocked by the middle test').toBe(false)

    // Exactly the class-keyed groups of the frame's hierarchical regions.
    const expectedGroups = mergeTouchingBodiesWithGroups(
      hierarchical.regions,
      frame.alongM.map((x) => ({ x })),
      { excludeFallback: true, identityKeyOf: (fid) => CLASS_OF.get(fid) ?? fid },
    ).groups
    expect(payload!.layer_groups[0]).toEqual(expectedGroups)

    // Every id is a GEOTECH BAND layer id — never a body id, never a litho id.
    const geotechBandLayers = new Set(['GA-clay', 'GA-sand', 'GM-sand', 'GC-clay', 'GC-sand'])
    for (const group of payload!.layer_groups[0]) {
      expect(group.length).toBeGreaterThanOrEqual(2)
      for (const id of group) expect(geotechBandLayers.has(id)).toBe(true)
    }
  })

  it('D2-region: a welded band names bands from BOTH its columns (fillGap attribution)', () => {
    // The counterpart of the existing v2 pin ("the tied band names its
    // PRODUCING layers"), for the FRAMED hierarchical path: a sand-dense band
    // tied across the gap carries both columns' band layer ids on one region.
    const { frameSections, geotechSections } = spanningWeldScene()
    const payload = buildBodyRecomputePayload(
      geotechSections,
      undefined,
      'test-recompute',
      CLASS_OF,
      frameSections,
    )
    expect(payload).not.toBeNull()
    const spanning = payload!.sections[0].regions.some((r) => {
      const ids = new Set(r.layer_ids ?? [])
      return ids.has('GA-sand') && ids.has('GB-sand')
    })
    expect(spanning, 'no framed region credits both columns of the tied sand band').toBe(true)
    expect(payload!.layer_groups[0]).toContainEqual(expect.arrayContaining(['GA-sand', 'GB-sand']))
  })

  it('D3: a LITHO payload (no frame) is byte-identical to the identity engine output', () => {
    const lithoSections: FenceSectionInput[] = [
      {
        sectionId: 'sL',
        section: { start_x: 0, start_y: 0, end_x: 80, end_y: 0 },
        projectedColumns: [col('A', 0), col('B', 80)],
        layers: [
          layer('A', 'LA-clay', 'f-clay', 0, 3),
          layer('A', 'LA-sand', 'f-sand', 3, 12),
          layer('B', 'LB-clay', 'f-clay', 0, 3),
          layer('B', 'LB-sand', 'f-sand', 3, 12),
        ],
        edges: [tie('LA-clay', 'LB-clay'), tie('LA-sand', 'LB-sand')],
      },
    ]
    const payload = buildBodyRecomputePayload(lithoSections, undefined, 'litho-recompute')
    expect(payload).not.toBeNull()

    // The litho path is the identity engine's own output, reshaped — no frame,
    // no class regroup. Derive the expectation the same way the path does.
    const frame = assembleSectionPartitionFrames(lithoSections, undefined)[0]
    const { regions, groups } = computeSectionFillActiveWithIdentity(
      frame.columns,
      frame.input.edges,
      frame.apexOverrides,
      frame.alongM,
    )
    const drilled = regions.filter((r) => r.fallback !== true)
    const expectedSection: SectionPartitionInput = {
      start_x: 0,
      start_y: 0,
      end_x: 80,
      end_y: 0,
      columns: frame.payloadColumns,
      regions: toRegionInputs(drilled),
    }
    expect(payload).toEqual({
      sections: [expectedSection],
      section_ids: ['sL'],
      layer_groups: [groups],
    })
  })

  it('D4: a section with no usable frame falls back to v2-identity, coverage stays exact', () => {
    const { geotechSections } = spanningWeldScene()
    // A second section with a single projectable column — no gap, so the frame
    // assembly skips it and it must be re-added empty (server exact coverage).
    const s2single: FenceSectionInput = {
      sectionId: 's2',
      section: { start_x: 0, start_y: 200, end_x: 100, end_y: 200 },
      projectedColumns: [col('A', 0)],
      layers: [layer('A', 'GA-only', 'g-sand-dense', 0, 14)],
      edges: [],
    }
    const sections = [...geotechSections, s2single]

    // A frame whose section id does NOT match s1 — so s1 has no usable frame
    // and must fall back exactly as if no frame were supplied at all.
    const mismatchedFrame: FenceSectionInput[] = [
      {
        sectionId: 'sX-nomatch',
        section: { start_x: 0, start_y: 500, end_x: 100, end_y: 500 },
        projectedColumns: [col('A', 0), col('B', 100)],
        layers: [
          layer('A', 'LX-sand', 'f-sand', 0, 14),
          layer('B', 'LY-sand', 'f-sand', 0, 14),
        ],
        edges: [tie('LX-sand', 'LY-sand')],
      },
    ]

    const fallback = buildBodyRecomputePayload(sections, undefined, 'geo', CLASS_OF, mismatchedFrame)
    const baseline = buildBodyRecomputePayload(sections, undefined, 'geo', CLASS_OF)
    expect(fallback).not.toBeNull()
    expect(fallback).toEqual(baseline)

    // Exact coverage: both sections named, the gapless single-column one empty.
    expect(fallback!.section_ids).toEqual(['s1', 's2'])
    const s2 = fallback!.sections[fallback!.section_ids.indexOf('s2')]
    expect(s2.columns).toEqual([])
    expect(s2.regions).toEqual([])
    expect(fallback!.layer_groups[fallback!.section_ids.indexOf('s2')]).toEqual([])
  })

  it('D5: a frame that assembles to zero frames behaves like omitting the frame', () => {
    // The empty-litho-model safety net (the manual toolbar path relies on it):
    // assembleSectionPartitionInput drops zero-layer columns, so a litho model
    // with no accepted layers yields NO frames, and every geotech section falls
    // back to the v2-identity arm — byte-identical to passing no frame at all.
    const { geotechSections } = spanningWeldScene()
    const emptyFrame: FenceSectionInput[] = [
      {
        sectionId: 's1',
        section: ENDPOINTS,
        projectedColumns: [col('A', 0), col('B', 100)],
        layers: [], // no accepted litho layers → assembles to zero frames
        edges: [],
      },
    ]
    const framed = buildBodyRecomputePayload(geotechSections, undefined, 'geo', CLASS_OF, emptyFrame)
    const noFrame = buildBodyRecomputePayload(geotechSections, undefined, 'geo', CLASS_OF)
    expect(framed).not.toBeNull()
    expect(framed).toEqual(noFrame)
  })
})
