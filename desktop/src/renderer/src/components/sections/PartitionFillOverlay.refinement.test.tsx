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
    layer_a_id: a,
    layer_b_id: b,
    layer_a_side: 'top',
    layer_b_side: 'top',
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

  // SEAM-RF (2026-07-13): the refined NAD fills tile the geotech axis, so they
  // suffer the same antialiasing hairline as the litho region fills. Each refined
  // fill must carry a self-colour seam stroke at the FILL opacity (0.62) so
  // adjacent NAD sub-bands close their shared edge. The dark litho OUTLINE
  // (fill="none") is a deliberate boundary line, NOT a fill — it keeps its own
  // stroke and is excluded from this check.
  it('SEAM-RF — refined NAD fills carry a self-colour seam stroke at the fill opacity', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...baseProps} refinement={REFINEMENT} />
      </svg>,
    )
    const fills = Array.from(
      container.querySelectorAll('[data-testid="partition-refined-fill"]'),
    )
    expect(fills.length).toBeGreaterThan(0)
    for (const el of fills) {
      const fill = el.getAttribute('fill')
      expect(el.getAttribute('stroke')).toBe(fill)
      expect(el.getAttribute('stroke-width')).toBe('0.75')
      expect(el.getAttribute('stroke-linejoin')).toBe('round')
      // Fill opacity is FILL_OPACITY (0.62); the seam stroke matches it exactly.
      expect(el.getAttribute('stroke-opacity')).toBe(el.getAttribute('fill-opacity'))
      expect(el.getAttribute('fill-opacity')).toBe('0.62')
    }
  })

  it('F1 — an untied two-sided interval never paints two packing colours at one point', () => {
    // Review F1 (2026-08-04): the pinch-out lens draws OVER the interval fill,
    // and both paint at 0.62, so the thin side reads as a blend of its own
    // class and the fill's. Read at the RENDER, on the geometry actually
    // emitted: no screen point may sit inside two rendered fills of different
    // colour. The carve is what makes this true; without it the lens footprint
    // is double-painted.
    const untied: GeotechRefinement = {
      ...REFINEMENT,
      geotechLayers: [
        layer('ga-L-0', 'L', 'nad-zand-5', 0, 4, 'gb-0'),
        layer('ga-L-1', 'L', 'nad-zand-7', 4, 10, 'gb-1'),
        layer('ga-R-0', 'R', 'nad-zand-5', 0, 6, 'gb-0'),
        layer('ga-R-1', 'R', 'nad-zand-8', 6, 10, 'gb-2'),
      ],
      nadMeta: new Map([
        ['nad-zand-5', { nadClass: 5, soilCode: 'ZAND' }],
        ['nad-zand-7', { nadClass: 7, soilCode: 'ZAND' }],
        ['nad-zand-8', { nadClass: 8, soilCode: 'ZAND' }],
      ]),
      // An EMPTY list says "no packing ties on this section" — every span is
      // untied, which is exactly the branch F1 was found in.
      packingEdges: [],
    }
    const colors = new Map(nadColorMap)
    colors.set('nad-zand-8', nadClassColor(8))
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...baseProps}
          formationColorById={colors}
          refinement={untied}
        />
      </svg>,
    )
    const painted = Array.from(
      container.querySelectorAll('[data-testid="partition-refined-fill"]'),
    ).map((el) => ({
      color: el.getAttribute('fill') ?? '',
      pts: parsePathPoints(el.getAttribute('d') ?? ''),
    }))
    expect(painted.length).toBeGreaterThan(1)
    const blends: string[] = []
    for (let i = 1; i < 40; i++) {
      for (let j = 1; j < 40; j++) {
        const x = (i / 40) * 100
        const y = (j / 40) * 200
        const hit = new Set<string>()
        for (const p of painted) if (inScreenPoly(x, y, p.pts)) hit.add(p.color)
        if (hit.size > 1) blends.push(`(${x.toFixed(1)},${y.toFixed(1)}) → ${[...hit].join('+')}`)
      }
    }
    expect(blends).toEqual([])
  })
})

/** Parse an ``M x,y L x,y … Z`` path into screen points. */
function parsePathPoints(d: string): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = []
  for (const m of d.matchAll(/[ML]\s*(-?[\d.]+),(-?[\d.]+)/g)) {
    out.push({ x: Number(m[1]), y: Number(m[2]) })
  }
  return out
}

/** Even-odd point-in-polygon in screen space. */
function inScreenPoly(px: number, py: number, pts: readonly { x: number; y: number }[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.y > py !== b.y > py && px < a.x + ((py - a.y) / (b.y - a.y)) * (b.x - a.x)) inside = !inside
  }
  return inside
}
