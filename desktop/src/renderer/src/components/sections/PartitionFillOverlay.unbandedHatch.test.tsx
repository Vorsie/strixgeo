// The geotech axis's un-banded ground must read as "correlate me", not as a
// second shade of the same soil.
//
// THE CASE (owner's model, measured on CS1/CS2/CS3): a column carries a
// classified packing band — KLEI NAD 23 — while the area beside it has no
// packing region at that elevation, because no accepted tie reaches across. The
// litho frame paints that area in plain lithology colour, so the same clay meets
// itself in two tones at the card edge and the tone difference lies about the
// lithology.
//
// OWNER RULING, verbatim: "sure read as correlate me on the extra ruling is
// fine" — keep both truths, and stop the un-banded area from IMPERSONATING a
// class. It reads as unfinished, and it disappears as he correlates.
//
// Pinned claims:
//   UH1  On the geotech axis ONLY the un-banded area carries the texture; the
//        classified packing fills carry none of it.
//   UH2  The lithology hue stays recognisable underneath — the texture is drawn
//        OVER the same geometry, it does not replace the colour.
//   UH3  The litho axis is untouched — no texture anywhere.
//   UH4  "Show litho fill" is a deliberate lithology view — no texture there
//        either (SectionPanel withholds the frame and swaps the partition's
//        source model, exactly as reproduced here).
//   UH5  It clears ITSELF: extend the packing model over the clay and tie it,
//        change nothing else, and both the un-banded area and its texture are
//        gone. No separate invalidation exists or is needed.
//   UH6  It cannot be confused with the 45° "not committed yet" ghost hatch, and
//        its label says what is true without ever saying "fallback".

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { nadClassColor } from '../../utils/nadClasses'
import {
  UNBANDED_HATCH_LABEL,
  UNBANDED_HATCH_PATTERN_ID,
} from '../../utils/unbandedGeotechHatch'
import PartitionFillOverlay, { type GeotechLithoFrame, type Props } from './PartitionFillOverlay'
import type { LithoContactCorrelationEdge, LithoLayerResponse } from '../../api/client'
import { layer, column } from './__fixtures__/partitionFillScene'

afterEach(() => cleanup())

function edge(a: string, b: string, side: 'top' | 'base' = 'top'): LithoContactCorrelationEdge {
  return {
    id: `e-${a}-${b}-${side}`,
    model_id: 'model-1',
    section_id: 'sec-1',
    layer_a_id: a,
    layer_b_id: b,
    layer_a_side: side,
    layer_b_side: side,
    source: 'manual',
    user_approved: true,
  } as unknown as LithoContactCorrelationEdge
}

// ---------------------------------------------------------------------------
// The scene, in the shape of the owner's case: two columns 100 m apart. The
// litho model has SAND 0-10 m over CLAY 10-15 m, both correlated. The packing
// pipeline has reached the sand only, so the CLAY is the un-banded ground the
// ruling is about, sitting right beside classified sand.
// ---------------------------------------------------------------------------
const LITHO_LAYERS: LithoLayerResponse[] = [
  layer({ id: 'a1', investigationId: 'L', formationId: 'formation-sand', depthTopM: 0, depthBaseM: 10, bodyId: 'body-sand' }),
  layer({ id: 'b1', investigationId: 'R', formationId: 'formation-sand', depthTopM: 0, depthBaseM: 10, bodyId: 'body-sand' }),
  layer({ id: 'a2', investigationId: 'L', formationId: 'formation-clay', depthTopM: 10, depthBaseM: 15, bodyId: 'body-clay' }),
  layer({ id: 'b2', investigationId: 'R', formationId: 'formation-clay', depthTopM: 10, depthBaseM: 15, bodyId: 'body-clay' }),
]
const LITHO_EDGES: LithoContactCorrelationEdge[] = [
  edge('a1', 'b1'),
  edge('a2', 'b2'),
  edge('a2', 'b2', 'base'),
]

const GEOTECH_LAYERS: LithoLayerResponse[] = [
  layer({ id: 'ga-L-0', investigationId: 'L', formationId: 'nad-zand-5', depthTopM: 0, depthBaseM: 6, bodyId: 'gb-0' }),
  layer({ id: 'ga-L-1', investigationId: 'L', formationId: 'nad-zand-7', depthTopM: 6, depthBaseM: 10, bodyId: 'gb-1' }),
  layer({ id: 'ga-R-0', investigationId: 'R', formationId: 'nad-zand-5', depthTopM: 0, depthBaseM: 5, bodyId: 'gb-0' }),
  layer({ id: 'ga-R-1', investigationId: 'R', formationId: 'nad-zand-7', depthTopM: 5, depthBaseM: 10, bodyId: 'gb-1' }),
]
const GEOTECH_EDGES: LithoContactCorrelationEdge[] = [
  edge('ga-L-0', 'ga-R-0'),
  edge('ga-L-1', 'ga-R-1'),
  edge('ga-L-1', 'ga-R-1', 'base'),
]

const CLAY_COLOR = '#0ea5e9'
const LITHO_COLOURS = new Map<string, string>([
  ['formation-sand', '#fbbf24'],
  ['formation-clay', CLAY_COLOR],
])

const LITHO_FRAME: GeotechLithoFrame = {
  lithoLayers: LITHO_LAYERS,
  lithoEdges: LITHO_EDGES,
  lithoFormationColorById: LITHO_COLOURS,
  lithoSoilByFormationId: new Map([
    ['formation-sand', 'ZAND'],
    ['formation-clay', 'KLEI'],
  ]),
  geotechSoilByFormationId: new Map([
    ['nad-zand-5', 'ZAND'],
    ['nad-zand-7', 'ZAND'],
  ]),
  packingClassByFormationId: new Map([
    ['nad-zand-5', 'ZAND|5'],
    ['nad-zand-7', 'ZAND|7'],
  ]),
}

const NAD_COLOURS = new Map<string, string>([
  ['nad-zand-5', nadClassColor(5)],
  ['nad-zand-7', nadClassColor(7)],
])

/** Props as SectionPanel wires them on the GEOTECH axis. */
const geotechProps: Props = {
  lithoLayers: GEOTECH_LAYERS,
  contactEdges: GEOTECH_EDGES,
  lithoFrame: LITHO_FRAME,
  axisMode: 'geotechnical',
  bodies: [],
  placedColumns: [column({ investigationId: 'L', along: 0, elevationM: 10 }), column({ investigationId: 'R', along: 100, elevationM: 10 })],
  formationColorById: NAD_COLOURS,
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

function attrs(container: HTMLElement, testid: string, attr: string): string[] {
  return Array.from(container.querySelectorAll(`[data-testid="${testid}"]`)).map(
    (el) => el.getAttribute(attr) ?? '',
  )
}

describe('PartitionFillOverlay — un-banded geotech ground reads "correlate me"', () => {
  it('UH1 — only the un-banded area is textured; the classified fills are not', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    const hatches = Array.from(
      container.querySelectorAll('[data-testid="partition-unbanded-hatch"]'),
    )
    expect(hatches.length).toBeGreaterThan(0)
    for (const el of hatches) {
      expect(el.getAttribute('fill')).toBe(`url(#${UNBANDED_HATCH_PATTERN_ID})`)
    }
    // One texture path per un-banded area, over the very same geometry.
    const unbandedGeometry = attrs(container, 'partition-litho-fallback', 'd')
    expect(hatches.map((el) => el.getAttribute('d') ?? '')).toEqual(unbandedGeometry)
    // The packing fills — the ones that DO carry a derived class — are clean.
    const packed = Array.from(
      container.querySelectorAll('[data-testid^="partition-fill-group-"]'),
    )
    expect(packed.length).toBeGreaterThan(0)
    for (const el of packed) {
      expect(el.getAttribute('fill') ?? '').not.toContain(UNBANDED_HATCH_PATTERN_ID)
    }
  })

  it('UH2 — the lithology hue stays underneath; the texture is drawn over it', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    // The clay colour still paints — nothing was swapped out for the texture.
    expect(new Set(attrs(container, 'partition-litho-fallback', 'fill'))).toEqual(
      new Set([CLAY_COLOR]),
    )
    // ... and the texture layer comes AFTER the colour layer in document order,
    // so it composites on top rather than being painted over.
    const layers = Array.from(
      container.querySelectorAll(
        '[data-testid="partition-litho-fallback-layer"], [data-testid="partition-unbanded-hatch-layer"]',
      ),
    ).map((el) => el.getAttribute('data-testid'))
    expect(layers).toEqual([
      'partition-litho-fallback-layer',
      'partition-unbanded-hatch-layer',
    ])
  })

  it('UH3 — the litho axis carries no texture at all', () => {
    const lithoProps: Props = {
      ...geotechProps,
      lithoLayers: LITHO_LAYERS,
      contactEdges: LITHO_EDGES,
      lithoFrame: undefined,
      axisMode: 'lithostratigraphic',
      formationColorById: LITHO_COLOURS,
    }
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...lithoProps} />
      </svg>,
    )
    expect(container.querySelectorAll('[data-testid^="partition-fill-group-"]').length)
      .toBeGreaterThan(0)
    expect(
      container.querySelectorAll('[data-testid="partition-unbanded-hatch"]').length,
    ).toBe(0)
    expect(container.querySelectorAll(`#${UNBANDED_HATCH_PATTERN_ID}`).length).toBe(0)
  })

  it('UH4 — "Show litho fill" is a lithology view: no texture there either', () => {
    // Exactly what SectionPanel does with the toggle on: the partition's source
    // model swaps back to litho and the frame is withheld, on the geotech axis.
    const showLithoFillProps: Props = {
      ...geotechProps,
      lithoLayers: LITHO_LAYERS,
      contactEdges: LITHO_EDGES,
      lithoFrame: undefined,
      formationColorById: LITHO_COLOURS,
    }
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...showLithoFillProps} />
      </svg>,
    )
    expect(container.querySelectorAll('[data-testid^="partition-fill-group-"]').length)
      .toBeGreaterThan(0)
    expect(
      container.querySelectorAll('[data-testid="partition-unbanded-hatch"]').length,
    ).toBe(0)
  })

  it('UH5 — it clears itself when the packing model reaches that ground', () => {
    // The same scene after the clay has been subdivided and tied: the packing
    // partition now covers what was bare. Nothing else changes — no flag, no
    // refresh call — because the texture is derived from the same memo chain as
    // the un-banded areas themselves.
    const packedClayProps: Props = {
      ...geotechProps,
      lithoLayers: [
        ...GEOTECH_LAYERS,
        layer({ id: 'ga-L-2', investigationId: 'L', formationId: 'nad-klei-23', depthTopM: 10, depthBaseM: 15, bodyId: 'gb-2' }),
        layer({ id: 'ga-R-2', investigationId: 'R', formationId: 'nad-klei-23', depthTopM: 10, depthBaseM: 15, bodyId: 'gb-2' }),
      ],
      contactEdges: [
        ...GEOTECH_EDGES,
        edge('ga-L-2', 'ga-R-2'),
        edge('ga-L-2', 'ga-R-2', 'base'),
      ],
      formationColorById: new Map([...NAD_COLOURS, ['nad-klei-23', nadClassColor(23)]]),
      lithoFrame: {
        ...LITHO_FRAME,
        geotechSoilByFormationId: new Map([
          ...LITHO_FRAME.geotechSoilByFormationId,
          ['nad-klei-23', 'KLEI'],
        ]),
      },
    }
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...packedClayProps} />
      </svg>,
    )
    expect(
      container.querySelectorAll('[data-testid="partition-litho-fallback"]').length,
    ).toBe(0)
    expect(
      container.querySelectorAll('[data-testid="partition-unbanded-hatch"]').length,
    ).toBe(0)
  })

  it('UH6 — unmistakable against the ghost hatch, and honest in its wording', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    const pattern = container.querySelector(`#${UNBANDED_HATCH_PATTERN_ID}`)
    expect(pattern).not.toBeNull()
    // The "not committed yet" ghosts (litho suggestions + borehole packing
    // previews) and the DOV clay pattern all run 45° the OTHER way, in black, at
    // 3-6 px with a 1.4 stroke. This one leans the opposite way, wider and
    // lighter, so it reads as unfinished ground without shouting over it.
    expect(pattern?.getAttribute('patternTransform')).toBe('rotate(-45)')
    expect(Number(pattern?.getAttribute('width'))).toBeGreaterThan(6)
    const line = pattern?.querySelector('line')
    expect(Number(line?.getAttribute('stroke-width'))).toBeLessThan(1.4)
    expect(Number(line?.getAttribute('stroke-opacity'))).toBeLessThan(0.28)
    expect(line?.getAttribute('stroke')).not.toBe('#000000')
    // What the engineer reads is the truth: no packing bands there yet.
    const titles = Array.from(container.querySelectorAll('title')).map((t) => t.textContent ?? '')
    expect(titles).toContain(UNBANDED_HATCH_LABEL)
    for (const t of titles) expect(t.toLowerCase()).not.toContain('fallback')
  })
})
