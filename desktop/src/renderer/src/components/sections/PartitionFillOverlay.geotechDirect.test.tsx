// Behavioural net for the GEOTECH-AXIS render path.
//
// Owner ruling 2026-08-13, in his words: "we don't need to invent the fill bands
// engine, it is built for the litho stage — we only have more classes." The
// geotech axis therefore runs the ordinary partition over the GEOTECH model's
// own columns and packing ties (what the props carry there) instead of
// subdividing the litho partition after the fact, and the LITHO geometry is
// layered back on top through the ``lithoFrame`` prop. This replaces the
// fraction-space refinement net (``PartitionFillOverlay.refinement.test.tsx``,
// retired with the same ruling).
//
// Pinned claims:
//   GD1  On the geotech axis the fill paints in NAD colours, straight from the
//        geotech layers the partition was built on.
//   GD2  The litho region envelopes draw over it as dark outlines — "litho
//        boundaries persist".
//   GD3  A litho interval the packing model has no bands for keeps its
//        LITHOLOGY colour instead of vanishing.
//   GD4  A fully-packed section emits NO fallback fill (nothing is unpacked).
//   GD5  The axis is VIEW-ONLY: no body hit targets, no per-body labels, no
//        lens / boundary handles.
//   GD6  The litho axis is untouched — no outline layer, no fallback layer, and
//        its interactive region paths keep their pointer events.
//   GD7  The packing fills inherit the litho render path's self-colour seam
//        stroke (the S61/S60b hairline closure), because they ARE that path.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { nadClassColor } from '../../utils/nadClasses'
import PartitionFillOverlay, { type GeotechLithoFrame, type Props } from './PartitionFillOverlay'
import { inScreenPoly, parseSubpaths } from './partitionFillSampling.testutil'
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
    model_id: 'model-1',
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

function edge(
  a: string,
  b: string,
  side: 'top' | 'base' = 'top',
): LithoContactCorrelationEdge {
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
// The scene: two boreholes 100 m apart, collars at +10 m.
//
// LITHO — one SAND unit 0–10 m correlated across both columns, then a CLAY unit
// 10–15 m, also correlated. The packing pipeline has only reached the sand.
// GEOTECH — the sand is subdivided into n5 over n7 on both columns, both pairs
// tied. Nothing exists below 10 m, so the clay is the unpacked interval GD3
// asks about.
// ---------------------------------------------------------------------------
const LITHO_LAYERS: LithoLayerResponse[] = [
  layer('a1', 'L', 'formation-sand', 0, 10, 'body-sand'),
  layer('b1', 'R', 'formation-sand', 0, 10, 'body-sand'),
  layer('a2', 'L', 'formation-clay', 10, 15, 'body-clay'),
  layer('b2', 'R', 'formation-clay', 10, 15, 'body-clay'),
]
const LITHO_EDGES: LithoContactCorrelationEdge[] = [
  edge('a1', 'b1'),
  edge('a2', 'b2'),
  edge('a2', 'b2', 'base'),
]

const GEOTECH_LAYERS: LithoLayerResponse[] = [
  layer('ga-L-0', 'L', 'nad-zand-5', 0, 6, 'gb-0'),
  layer('ga-L-1', 'L', 'nad-zand-7', 6, 10, 'gb-1'),
  layer('ga-R-0', 'R', 'nad-zand-5', 0, 5, 'gb-0'),
  layer('ga-R-1', 'R', 'nad-zand-7', 5, 10, 'gb-1'),
]
const GEOTECH_EDGES: LithoContactCorrelationEdge[] = [
  edge('ga-L-0', 'ga-R-0'),
  edge('ga-L-1', 'ga-R-1'),
  edge('ga-L-1', 'ga-R-1', 'base'),
]

const LITHO_COLOURS = new Map<string, string>([
  ['formation-sand', '#fbbf24'],
  ['formation-clay', '#0ea5e9'],
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

// formationColorById maps GEOTECH formation ids → NAD colour on this axis
// (exactly what SectionPanel builds from geotechFormations).
const NAD_COLOURS = new Map<string, string>([
  ['nad-zand-5', nadClassColor(5)],
  ['nad-zand-7', nadClassColor(7)],
])

/** Props as SectionPanel wires them on the GEOTECH axis. */
const geotechProps: Props = {
  // The partition's own model: geotech rows, geotech ties.
  lithoLayers: GEOTECH_LAYERS,
  contactEdges: GEOTECH_EDGES,
  lithoFrame: LITHO_FRAME,
  axisMode: 'geotechnical',
  // Geotech resolves bodies server-side; the axis carries no body entities.
  bodies: [],
  placedColumns: [column('L', 0, 10), column('R', 100, 10)],
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

/** Props as SectionPanel wires them on the LITHO axis (the control). */
const lithoProps: Props = {
  ...geotechProps,
  lithoLayers: LITHO_LAYERS,
  contactEdges: LITHO_EDGES,
  lithoFrame: undefined,
  axisMode: 'lithostratigraphic',
  formationColorById: LITHO_COLOURS,
}

function fillColours(container: HTMLElement): Set<string> {
  return new Set(
    Array.from(container.querySelectorAll('[data-testid^="partition-fill-group-"]')).map(
      (el) => el.getAttribute('fill') ?? '',
    ),
  )
}

describe('PartitionFillOverlay — the geotech axis partitions the geotech model', () => {
  it('GD1 — the fill paints the packing classes, in NAD colours', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    const colours = fillColours(container)
    expect(colours.has(nadClassColor(5))).toBe(true)
    expect(colours.has(nadClassColor(7))).toBe(true)
    // Never the neutral FALLBACK_COLOR: every painted region resolved a class.
    expect(colours.has('#888888')).toBe(false)
  })

  it('GD2 — the litho envelopes draw over the packing fill as dark outlines', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    const outlines = Array.from(
      container.querySelectorAll('[data-testid="partition-litho-outline"]'),
    )
    expect(outlines.length).toBeGreaterThan(0)
    for (const el of outlines) {
      expect(el.getAttribute('fill')).toBe('none')
      expect(el.getAttribute('stroke')).toBe('#0d1117')
      expect(el.getAttribute('stroke-opacity')).toBe('0.85')
      expect(el.getAttribute('stroke-width')).toBe('0.8')
    }
  })

  it('GD3 — the clay the packing model never reached keeps its lithology colour', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    const fallbacks = Array.from(
      container.querySelectorAll('[data-testid="partition-litho-fallback"]'),
    )
    expect(fallbacks.length).toBeGreaterThan(0)
    const colours = new Set(fallbacks.map((el) => el.getAttribute('fill')))
    // The CLAY colour, and only it: the sand IS packed on both columns.
    expect(colours).toEqual(new Set(['#0ea5e9']))
  })

  it('GD4 — a section packed end to end emits no fallback at all', () => {
    // Same scene with the clay dropped from the litho model, so every litho
    // region has packing on both sides.
    const packedFrame: GeotechLithoFrame = {
      ...LITHO_FRAME,
      lithoLayers: LITHO_LAYERS.filter((l) => l.formation_id === 'formation-sand'),
      lithoEdges: [edge('a1', 'b1')],
    }
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} lithoFrame={packedFrame} />
      </svg>,
    )
    expect(
      container.querySelectorAll('[data-testid="partition-litho-fallback"]').length,
    ).toBe(0)
    // The outlines still draw — the frame is not all-or-nothing.
    expect(
      container.querySelectorAll('[data-testid="partition-litho-outline"]').length,
    ).toBeGreaterThan(0)
  })

  it('GD5 — the axis is view-only: no body targets, labels, or shaping handles', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...geotechProps}
          formationLabelById={new Map([['nad-zand-5', 'n5'], ['nad-zand-7', 'n7']])}
          onBodyContextMenu={() => undefined}
          onSaveBoundary={() => undefined}
        />
      </svg>,
    )
    // The region paths exist (they carry the seam stroke) but cannot be hit.
    for (const el of Array.from(
      container.querySelectorAll('[data-testid^="partition-region-"]'),
    )) {
      expect((el as SVGElement).style.pointerEvents).toBe('none')
    }
    expect(container.querySelectorAll('[data-testid^="partition-label-"]').length).toBe(0)
    expect(
      container.querySelectorAll('[data-testid^="partition-boundary-addstrip-"]').length,
    ).toBe(0)
    expect(
      container.querySelectorAll('[data-testid^="partition-lens-addstrip-"]').length,
    ).toBe(0)
  })

  it('GD6 — the litho axis is untouched by any of this', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...lithoProps} onBodyContextMenu={() => undefined} />
      </svg>,
    )
    expect(container.querySelectorAll('[data-testid="partition-litho-outline"]').length).toBe(0)
    expect(container.querySelectorAll('[data-testid="partition-litho-fallback"]').length).toBe(0)
    const regions = Array.from(
      container.querySelectorAll('[data-testid^="partition-region-"]'),
    )
    expect(regions.length).toBeGreaterThan(0)
    // Litho fill paints in lithology colours, not NAD ones.
    const colours = fillColours(container)
    expect(colours.has('#fbbf24')).toBe(true)
    expect(colours.has(nadClassColor(5))).toBe(false)
  })

  it('GD7 — packing fills carry the litho path’s self-colour seam stroke', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    const strokes = Array.from(
      container.querySelectorAll('[data-testid^="partition-region-stroke-"]'),
    )
    expect(strokes.length).toBeGreaterThan(0)
    for (const el of strokes) {
      expect(el.getAttribute('fill')).toBe('none')
      expect(el.getAttribute('stroke-width')).toBe('0.75')
    }
  })

  it('— every point on the geotech axis carries exactly ONE packing colour', () => {
    // The old refinement drew its pinch-out lenses OVER the fills they pinched
    // out of, and both painted at 0.62, so the thin side read as a blend of two
    // classes (review F1, 2026-08-04). The direct partition is a true partition
    // by construction; this reads that at the RENDER, on the geometry actually
    // emitted, with an UNTIED deep pair — the branch F1 was found in.
    const untiedProps: Props = {
      ...geotechProps,
      lithoLayers: [
        layer('ga-L-0', 'L', 'nad-zand-5', 0, 4, 'gb-0'),
        layer('ga-L-1', 'L', 'nad-zand-7', 4, 10, 'gb-1'),
        layer('ga-R-0', 'R', 'nad-zand-5', 0, 6, 'gb-0'),
        layer('ga-R-1', 'R', 'nad-zand-8', 6, 10, 'gb-2'),
      ],
      // No ties at all on this section — every span is untied.
      contactEdges: [],
      formationColorById: new Map([...NAD_COLOURS, ['nad-zand-8', nadClassColor(8)]]),
      lithoFrame: undefined,
    }
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...untiedProps} />
      </svg>,
    )
    const painted = Array.from(
      container.querySelectorAll('[data-testid^="partition-fill-group-"]'),
    ).map((el) => ({
      color: el.getAttribute('fill') ?? '',
      subpaths: parseSubpaths(el.getAttribute('d') ?? ''),
    }))
    expect(painted.length).toBeGreaterThan(1)
    // "Exactly one" needs BOTH arms (audit P1-5): >1 is a blend, but 0 inside
    // the banded envelope is a VOID — and the old loop only recorded blends, so
    // a render that painted nothing at all passed. The banded envelope here is
    // the full rectangle between the columns (both banded 0–10 m, collars
    // +10 m): screen x ∈ [0,100], y ∈ [100,200]. The fractional offsets keep
    // the sample points off the fills' shared seams, where even-odd
    // point-in-polygon is undefined.
    const defects: string[] = []
    for (let i = 1; i < 39; i++) {
      for (let j = 1; j < 39; j++) {
        const x = (i / 40) * 100 + 0.137
        const y = 100 + (j / 40) * 100 + 0.171
        const hit = new Set<string>()
        for (const p of painted) {
          if (p.subpaths.some((pts) => inScreenPoly(x, y, pts))) hit.add(p.color)
        }
        if (hit.size !== 1) {
          defects.push(
            `(${x.toFixed(1)},${y.toFixed(1)}) → ${hit.size === 0 ? 'VOID' : [...hit].join('+')}`,
          )
        }
      }
    }
    expect(defects).toEqual([])
  })
})

describe('PartitionFillOverlay — "Unit statistics…" from the fill (owner ruling R2, 2026-08-27)', () => {
  // Owner, verbatim: "it only works if you press on a column, make it so that
  // i can press a unit in the spaces between too."

  /** The region HIT paths (not their seam strokes). */
  function regionHitPaths(container: HTMLElement): SVGElement[] {
    return Array.from(
      container.querySelectorAll<SVGElement>('[data-testid^="partition-region-"]'),
    ).filter(el => !(el.getAttribute('data-testid') ?? '').includes('-stroke-'))
  }

  it('RS1 — right-click a geotech fill region offers "Unit statistics…" for ITS unit', () => {
    const onShowGeotechUnitStatistics = vi.fn()
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...geotechProps}
          onShowGeotechUnitStatistics={onShowGeotechUnitStatistics}
        />
      </svg>,
    )
    const hits = regionHitPaths(container)
    expect(hits.length).toBeGreaterThan(0)
    // The handler makes the region a right-click target on this axis.
    expect(hits[0].style.pointerEvents).not.toBe('none')
    fireEvent.contextMenu(hits[0], { clientX: 60, clientY: 80 })

    fireEvent.click(screen.getByTestId('partition-region-menu-unit-statistics'))
    expect(onShowGeotechUnitStatistics).toHaveBeenCalledTimes(1)
    // The reported id is the REGION's geotech unit — one of the two NAD
    // formations this scene paints between the columns.
    const reported = onShowGeotechUnitStatistics.mock.calls[0][0] as string
    expect(['nad-zand-5', 'nad-zand-7']).toContain(reported)
    // The jump closes the menu.
    expect(screen.queryByTestId('partition-region-menu')).toBeNull()
  })

  it('RS4 — the jump reports the clicked region\'s BODY, resolved from its own layers', () => {
    // Owner ruling 2026-08-27: "a body is only a body if it is geometrically
    // connected or if the users says, this body is the same as that body."
    // A fill region carries ``layerIds``; the layers carry the resolver's
    // ``body_id``. The scene's n5 bands are all gb-0 and its n7 bands gb-1,
    // so whichever region is hit, the reported (unit, body) pair must match.
    const onShowGeotechUnitStatistics = vi.fn()
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...geotechProps}
          onShowGeotechUnitStatistics={onShowGeotechUnitStatistics}
        />
      </svg>,
    )
    fireEvent.contextMenu(regionHitPaths(container)[0], { clientX: 60, clientY: 80 })
    fireEvent.click(screen.getByTestId('partition-region-menu-unit-statistics'))

    expect(onShowGeotechUnitStatistics).toHaveBeenCalledTimes(1)
    const [unitId, bodyId] = onShowGeotechUnitStatistics.mock.calls[0] as [string, string | null]
    expect(bodyId).toBe(unitId === 'nad-zand-5' ? 'gb-0' : 'gb-1')
  })

  it('RS2 — without the handler the regions stay inert and no menu exists', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    for (const el of regionHitPaths(container)) {
      expect(el.style.pointerEvents).toBe('none')
    }
    fireEvent.contextMenu(regionHitPaths(container)[0], { clientX: 60, clientY: 80 })
    expect(screen.queryByTestId('partition-region-menu')).toBeNull()
  })

  it('RS3 — the litho axis does not use this path (its regions belong to the body menu)', () => {
    const onShowGeotechUnitStatistics = vi.fn()
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...lithoProps}
          onShowGeotechUnitStatistics={onShowGeotechUnitStatistics}
        />
      </svg>,
    )
    const hits = regionHitPaths(container)
    expect(hits.length).toBeGreaterThan(0)
    fireEvent.contextMenu(hits[0], { clientX: 60, clientY: 80 })
    expect(screen.queryByTestId('partition-region-menu')).toBeNull()
    expect(onShowGeotechUnitStatistics).not.toHaveBeenCalled()
  })
})

describe('PartitionFillOverlay — the litho fill jump + the axis discipline (owner rulings S7a/S7b, 2026-08-27)', () => {
  /** The region HIT paths (not their seam strokes). */
  function regionHitPaths(container: HTMLElement): SVGElement[] {
    return Array.from(
      container.querySelectorAll<SVGElement>('[data-testid^="partition-region-"]'),
    ).filter(el => !(el.getAttribute('data-testid') ?? '').includes('-stroke-'))
  }

  it('LF1 — "in the litho stage i should be able to click the litho fill too"', () => {
    const onShowLithoUnitStatistics = vi.fn()
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...lithoProps}
          onShowLithoUnitStatistics={onShowLithoUnitStatistics}
        />
      </svg>,
    )
    const hits = regionHitPaths(container)
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].style.pointerEvents).not.toBe('none')
    fireEvent.contextMenu(hits[0], { clientX: 60, clientY: 80 })
    fireEvent.click(screen.getByTestId('partition-region-menu-unit-statistics'))
    // The reported id is the clicked region's LITHO unit.
    expect(onShowLithoUnitStatistics).toHaveBeenCalledTimes(1)
    expect(['formation-sand', 'formation-clay']).toContain(
      onShowLithoUnitStatistics.mock.calls[0][0],
    )
  })

  it('LF2 — a region with a body keeps its body menu; only bodiless fill takes the new path', () => {
    const onShowLithoUnitStatistics = vi.fn()
    const onBodyContextMenu = vi.fn()
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...lithoProps}
          bodies={[
            { id: 'body-sand', formation_id: 'formation-sand', name: null } as never,
          ]}
          onBodyContextMenu={onBodyContextMenu}
          onShowLithoUnitStatistics={onShowLithoUnitStatistics}
        />
      </svg>,
    )
    // The sand regions resolve to the known body → the BODY menu answers
    // (it carries its own statistics item), not the fill menu.
    const sandHit = regionHitPaths(container).find(el =>
      (el.getAttribute('data-testid') ?? '').includes('body-sand'),
    )!
    fireEvent.contextMenu(sandHit, { clientX: 60, clientY: 40 })
    expect(onBodyContextMenu).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('partition-region-menu')).toBeNull()
    // A clay region (no body in the list) answers with the fill menu.
    const clayHit = regionHitPaths(container).find(el =>
      (el.getAttribute('data-testid') ?? '').includes('body-clay'),
    )!
    fireEvent.contextMenu(clayHit, { clientX: 60, clientY: 130 })
    fireEvent.click(screen.getByTestId('partition-region-menu-unit-statistics'))
    // "No body in ``bodies``" ≠ "no body": the region's own layers still name
    // one, and the jump reports it (body-scope ruling 2026-08-27).
    expect(onShowLithoUnitStatistics).toHaveBeenCalledWith('formation-clay', 'body-clay')
  })

  it('LF3 — S7a: "Litho fill shouldn\'t be accesible in the geotech stage" — the litho frame is inert there', () => {
    const onShowLithoUnitStatistics = vi.fn()
    const onShowGeotechUnitStatistics = vi.fn()
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...geotechProps}
          onShowGeotechUnitStatistics={onShowGeotechUnitStatistics}
          onShowLithoUnitStatistics={onShowLithoUnitStatistics}
        />
      </svg>,
    )
    // The litho-frame surfaces — fallback fills and outlines — take no
    // pointer events at all: no jump, no menu, nothing.
    const lithoSurfaces = [
      ...Array.from(container.querySelectorAll('[data-testid="partition-litho-fallback"]')),
      ...Array.from(container.querySelectorAll('[data-testid="partition-litho-outline"]')),
    ]
    expect(lithoSurfaces.length).toBeGreaterThan(0)
    for (const el of lithoSurfaces) {
      expect((el as SVGElement).style.pointerEvents).toBe('none')
    }
    fireEvent.contextMenu(lithoSurfaces[0], { clientX: 60, clientY: 160 })
    expect(screen.queryByTestId('partition-region-menu')).toBeNull()
    expect(onShowLithoUnitStatistics).not.toHaveBeenCalled()
  })

  it('LF4 — S7a: on the geotech axis only geotech surfaces jump — as geotech units', () => {
    const onShowLithoUnitStatistics = vi.fn()
    const onShowGeotechUnitStatistics = vi.fn()
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...geotechProps}
          onShowGeotechUnitStatistics={onShowGeotechUnitStatistics}
          onShowLithoUnitStatistics={onShowLithoUnitStatistics}
        />
      </svg>,
    )
    fireEvent.contextMenu(regionHitPaths(container)[0], { clientX: 60, clientY: 80 })
    fireEvent.click(screen.getByTestId('partition-region-menu-unit-statistics'))
    // The geotech handler answers with a geotech unit; the litho handler is
    // never consulted on this axis.
    expect(onShowGeotechUnitStatistics).toHaveBeenCalledTimes(1)
    expect(['nad-zand-5', 'nad-zand-7']).toContain(
      onShowGeotechUnitStatistics.mock.calls[0][0],
    )
    expect(onShowLithoUnitStatistics).not.toHaveBeenCalled()
  })
})
