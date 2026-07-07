// Behavioural net for the geotech fraction-space REFINEMENT render path
// (owner-locked 2026-07-06). When PartitionFillOverlay is given a `refinement`
// bundle (the geotech axis), it renders the LITHO partition REFINED by NAD
// packing class instead of the raw region fills — and suppresses the
// interactive litho handles + per-body labels (view-only).
//
// Pinned claims:
//   RF1  With a refinement bundle, the refined group (`partition-refined`)
//        renders and the normal region paths (`partition-region-*`) do NOT.
//   RF2  Refined fill paths (`partition-refined-fill`) carry the NAD colour
//        from formationColorById keyed by the GEOTECH sub-band's formation id.
//   RF3  Without a refinement bundle (litho axis), the normal region paths
//        render and NO refined group appears (the gate is off by default).
//   RF4  A litho region envelope outline (`partition-refined-outline`) renders
//        on top so litho boundaries stay visible.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { nadClassColor } from '../../utils/nadClasses'
import PartitionFillOverlay, { type GeotechRefinement, type Props } from './PartitionFillOverlay'
import type { LithoContactCorrelationEdge, LithoLayerResponse } from '../../api/client'
import type { PlacedColumn } from './utils'

afterEach(() => cleanup())

function layer(
  id: string,
  inv: string,
  formationId: string,
  top: number,
  base: number,
  bodyId: string,
): LithoLayerResponse {
  return {
    id,
    model_id: 'litho-model-1',
    formation_id: formationId,
    borehole_id: inv,
    cpt_id: null,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: bodyId,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as LithoLayerResponse
}

function column(inv: string, along: number, elev: number): PlacedColumn {
  return {
    kind: 'borehole',
    nudgedX: along,
    trueX: along,
    width: 40,
    displaced: false,
    proj: { along, offset: 0, item: { id: inv, elevation_m: elev } },
  } as unknown as PlacedColumn
}

function edge(a: string, b: string): LithoContactCorrelationEdge {
  return {
    id: `e-${a}-${b}`,
    model_id: 'litho-model-1',
    section_id: 'sec-1',
    contact_a_id: a,
    contact_b_id: b,
    contact_a_side: 'top',
    contact_b_side: 'top',
    source: 'manual',
    user_approved: true,
  } as unknown as LithoContactCorrelationEdge
}

// One SAND litho region correlated across both columns (edge a1↔b1), each
// column subdivided into two NAD sand classes (n5 over n7).
const LITHO_LAYERS: LithoLayerResponse[] = [
  layer('a1', 'L', 'formation-sand', 0, 10, 'body-sand'),
  layer('b1', 'R', 'formation-sand', 0, 10, 'body-sand'),
]
const EDGES: LithoContactCorrelationEdge[] = [edge('a1', 'b1')]

const REFINEMENT: GeotechRefinement = {
  geotechLayers: [
    layer('ga-L-0', 'L', 'nad-zand-5', 0, 6, 'gb-0'),
    layer('ga-L-1', 'L', 'nad-zand-7', 6, 10, 'gb-1'),
    layer('ga-R-0', 'R', 'nad-zand-5', 0, 5, 'gb-0'),
    layer('ga-R-1', 'R', 'nad-zand-7', 5, 10, 'gb-1'),
  ],
  nadMeta: new Map([
    ['nad-zand-5', { nadClass: 5, soilCode: 'ZAND' }],
    ['nad-zand-7', { nadClass: 7, soilCode: 'ZAND' }],
  ]),
  lithoSoilByFormationId: new Map([['formation-sand', 'ZAND']]),
  lithoFormationColorById: new Map([['formation-sand', '#fbbf24']]),
}

// formationColorById maps GEOTECH formation ids → NAD colour (what SectionPanel
// builds on the geotech axis from geotechFormations).
const nadColorMap = new Map<string, string>([
  ['nad-zand-5', nadClassColor(5)],
  ['nad-zand-7', nadClassColor(7)],
])

const baseProps: Props = {
  lithoLayers: LITHO_LAYERS,
  contactEdges: EDGES,
  placedColumns: [column('L', 0, 10), column('R', 100, 10)],
  formationColorById: nadColorMap,
  showBands: true,
  levelToScreen: (l: number) => 200 - l * 10,
  plotTop: 0,
  plotBottom: 400,
  plotLeft: 0,
  plotRight: 200,
  alongToScreenX: (a: number) => a,
  screenXToAlong: (x: number) => x,
  screenToLevel: (y: number) => (200 - y) / 10,
}

describe('PartitionFillOverlay geotech refinement render', () => {
  it('RF1 — refinement renders the refined group and suppresses the raw region paths', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...baseProps} refinement={REFINEMENT} />
      </svg>,
    )
    expect(container.querySelector('[data-testid="partition-refined"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="partition-refined-fill"]').length).toBeGreaterThan(0)
    // The raw litho region paths must NOT render in refined mode.
    expect(
      container.querySelectorAll('[data-testid^="partition-region-"]').length,
    ).toBe(0)
  })

  it('RF2 — refined fills carry the NAD colour of the geotech sub-band', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...baseProps} refinement={REFINEMENT} />
      </svg>,
    )
    const fills = Array.from(
      container.querySelectorAll('[data-testid="partition-refined-fill"]'),
    )
    const colours = new Set(fills.map((f) => f.getAttribute('fill')))
    // Both NAD sand classes appear, coloured by nadClassColor (not a fallback).
    expect(colours.has(nadClassColor(5))).toBe(true)
    expect(colours.has(nadClassColor(7))).toBe(true)
    expect(colours.has('#888888')).toBe(false) // no fallback colour
  })

  it('RF3 — without a refinement bundle, the raw region paths render and no refined group appears', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...baseProps}
          formationColorById={new Map([['formation-sand', '#fbbf24']])}
        />
      </svg>,
    )
    expect(container.querySelector('[data-testid="partition-refined"]')).toBeNull()
    expect(
      container.querySelectorAll('[data-testid^="partition-region-"]').length,
    ).toBeGreaterThan(0)
  })

  it('RF4 — a litho region envelope outline renders on top (boundaries stay visible)', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...baseProps} refinement={REFINEMENT} />
      </svg>,
    )
    expect(
      container.querySelectorAll('[data-testid="partition-refined-outline"]').length,
    ).toBeGreaterThan(0)
  })
})
