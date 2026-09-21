// The body context menu comes to the GEOTECH axis (owner ruling 2026-08-31,
// piece B): "right click a body give me statistics, name unit, separate from,
// dissolve body … shouldn't we be able to do this in the geotech stage" — RULED
// yes.
//
// The geotech axis stays VIEW-ONLY for contact editing; only the body MENU is
// now allowed. So:
//   GBM1 — with the geotech body roster + the handler + a landed roster gate, a
//          right-click on a fill region opens the BODY menu path, and the body
//          it reports is resolved from the region's OWN layers (region.bodyId is
//          frame-minted on this axis and is not the authority — regionBodyId.ts).
//   GBM2 — while the roster gate is CLOSED (bodiesLoaded=false), the body menu
//          does NOT arm; the "Unit statistics…" region menu is the deliberate
//          answer (#279, per-axis arming gate).
//   GBM3 — the contact-editing surfaces stay gated on viewOnly: no per-body
//          labels, no boundary / lens shaping handles, even with the body menu on.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PartitionFillOverlay, { type GeotechLithoFrame, type Props } from './PartitionFillOverlay'
import { nadClassColor } from '../../utils/nadClasses'
import type { BodyListItem, LithoContactCorrelationEdge, LithoLayerResponse } from '../../api/client'
import { layer, column } from './__fixtures__/partitionFillScene'

afterEach(() => cleanup())

function edge(a: string, b: string, side: 'top' | 'base' = 'top'): LithoContactCorrelationEdge {
  return {
    id: `e-${a}-${b}-${side}`,
    model_id: 'geo-model-1',
    section_id: 'sec-1',
    layer_a_id: a,
    layer_b_id: b,
    layer_a_side: side,
    layer_b_side: side,
    source: 'manual',
    user_approved: true,
  } as unknown as LithoContactCorrelationEdge
}

// Two boreholes 100 m apart, collars +10 m. The geotech model subdivides the
// sand into n5 over n7 on both columns, both pairs tied — the n5 regions are all
// body gb-0, the n7 regions body gb-1.
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

const LITHO_FRAME: GeotechLithoFrame = {
  lithoLayers: [
    layer({ id: 'a1', investigationId: 'L', formationId: 'formation-sand', depthTopM: 0, depthBaseM: 10, bodyId: 'body-sand' }),
    layer({ id: 'b1', investigationId: 'R', formationId: 'formation-sand', depthTopM: 0, depthBaseM: 10, bodyId: 'body-sand' }),
  ],
  lithoEdges: [edge('a1', 'b1')],
  lithoFormationColorById: new Map([['formation-sand', '#fbbf24']]),
  lithoSoilByFormationId: new Map([['formation-sand', 'ZAND']]),
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

/** The GEOTECH body roster the resolver returns for this model. */
const GEOTECH_BODIES: BodyListItem[] = [
  { id: 'gb-0', formation_id: 'nad-zand-5', name: null } as unknown as BodyListItem,
  { id: 'gb-1', formation_id: 'nad-zand-7', name: null } as unknown as BodyListItem,
]

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

/** The region HIT paths (not their seam strokes). */
function regionHitPaths(container: HTMLElement): SVGElement[] {
  return Array.from(
    container.querySelectorAll<SVGElement>('[data-testid^="partition-region-"]'),
  ).filter(el => !(el.getAttribute('data-testid') ?? '').includes('-stroke-'))
}

describe('PartitionFillOverlay — the body menu comes to the geotech axis (piece B)', () => {
  it('GBM1 — right-click a geotech region opens the body menu, body resolved from its layers', () => {
    const onBodyContextMenu = vi.fn()
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...geotechProps}
          bodies={GEOTECH_BODIES}
          onBodyContextMenu={onBodyContextMenu}
          bodiesLoaded
        />
      </svg>,
    )
    const hits = regionHitPaths(container)
    expect(hits.length).toBeGreaterThan(0)
    // The body menu arms the region — it is a right-click target on this axis now.
    const armed = hits.find(el => el.style.pointerEvents !== 'none')
    expect(armed).toBeDefined()
    fireEvent.contextMenu(armed as SVGElement, { clientX: 60, clientY: 80 })
    expect(onBodyContextMenu).toHaveBeenCalledTimes(1)
    // The reported body is resolved from the region's OWN layers (gb-0 for n5,
    // gb-1 for n7) — never the frame-minted region label.
    const reported = onBodyContextMenu.mock.calls[0][0] as BodyListItem
    expect(['gb-0', 'gb-1']).toContain(reported.id)
  })

  it('GBM2 — while the roster gate is closed the stats menu answers, not the body menu', () => {
    const onBodyContextMenu = vi.fn()
    const onShowGeotechUnitStatistics = vi.fn()
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...geotechProps}
          bodies={GEOTECH_BODIES}
          onBodyContextMenu={onBodyContextMenu}
          onShowGeotechUnitStatistics={onShowGeotechUnitStatistics}
          bodiesLoaded={false}
        />
      </svg>,
    )
    fireEvent.contextMenu(regionHitPaths(container)[0], { clientX: 60, clientY: 80 })
    // The body menu did NOT arm — the deliberate #279 answer is the stats menu.
    expect(onBodyContextMenu).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('partition-region-menu-unit-statistics'))
    expect(onShowGeotechUnitStatistics).toHaveBeenCalledTimes(1)
  })

  it('GBM3 — contact-editing surfaces stay view-only even with the body menu on', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...geotechProps}
          bodies={GEOTECH_BODIES}
          onBodyContextMenu={() => undefined}
          onSaveBoundary={() => undefined}
          bodiesLoaded
          formationLabelById={new Map([['nad-zand-5', 'n5'], ['nad-zand-7', 'n7']])}
        />
      </svg>,
    )
    // No per-body labels, no boundary / lens shaping handles: viewOnly still
    // gates every contact-editing surface (only the body menu was ungated).
    expect(container.querySelectorAll('[data-testid^="partition-label-"]').length).toBe(0)
    expect(
      container.querySelectorAll('[data-testid^="partition-boundary-addstrip-"]').length,
    ).toBe(0)
    expect(container.querySelectorAll('[data-testid^="partition-lens-addstrip-"]').length).toBe(0)
  })
})
