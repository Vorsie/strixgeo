// Behavioural net for the "Separate from…" armed left-click (debt #278 R5).
//
// When a Separate is armed, the partition fill regions become LEFT-clickable and
// a click resolves the clicked region's body through its layers. A distinct body
// commits; clicking the armed body itself stays armed. When nothing is armed the
// regions behave exactly as before (no onSeparatePick, no left-click capture).
//
//   SEP-OV1  armed + click a DIFFERENT body's region → commit keep-apart (sameBody false)
//   SEP-OV2  armed + click the ARMED body's own region → commit SPLIT (sameBody true)
//   SEP-OV3  NOT armed → a region left-click fires nothing (byte-identical gating)

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PartitionFillOverlay, { type Props } from './PartitionFillOverlay'
import type { BodyListItem, LithoContactCorrelationEdge, LithoLayerResponse } from '../../api/client'
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

// Two columns 100 m apart, collars +10 m. A SAND unit (body-sand) 0–10 m
// correlated across both, a CLAY unit (body-clay) 10–15 m correlated too.
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
const COLOURS = new Map<string, string>([
  ['formation-sand', '#fbbf24'],
  ['formation-clay', '#0ea5e9'],
])
const BODIES: BodyListItem[] = [
  { id: 'body-sand', formation_id: 'formation-sand' } as unknown as BodyListItem,
  { id: 'body-clay', formation_id: 'formation-clay' } as unknown as BodyListItem,
]

function baseProps(): Props {
  return {
    lithoLayers: LITHO_LAYERS,
    contactEdges: LITHO_EDGES,
    axisMode: 'lithostratigraphic',
    bodies: BODIES,
    placedColumns: [column('L', 0, 10), column('R', 100, 10)],
    formationColorById: COLOURS,
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
}

describe('PartitionFillOverlay — Separate arm', () => {
  it('SEP-OV1 — armed, clicking a DIFFERENT body region commits both anchors', () => {
    const onSeparatePick = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay
          {...baseProps()}
          separateArm={{ bodyId: 'body-sand', anchorLayerId: 'a1' }}
          onSeparatePick={onSeparatePick}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId('partition-region-body-clay'))
    expect(onSeparatePick).toHaveBeenCalledTimes(1)
    expect(onSeparatePick.mock.calls[0][0]).toMatchObject({
      kind: 'commit',
      anchorLayerId: 'a1',
      sameBody: false,
    })
  })

  it('SEP-OV2 — armed on the region’s own anchor, clicking it is a self-anchor no-op', () => {
    // The sand region resolves its target anchor to ``a1``; arming on the SAME
    // ``a1`` and clicking the region would POST anchor == target (a 422). The
    // overlay must report self-anchor so the arm stays live rather than firing a
    // commit that cannot succeed (coordinator should-fix 2026-09-01).
    const onSeparatePick = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay
          {...baseProps()}
          separateArm={{ bodyId: 'body-sand', anchorLayerId: 'a1' }}
          onSeparatePick={onSeparatePick}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId('partition-region-body-sand'))
    expect(onSeparatePick).toHaveBeenCalledTimes(1)
    expect(onSeparatePick.mock.calls[0][0]).toEqual({ kind: 'self-anchor' })
  })

  it('SEP-OV8 — armed on a DIFFERENT part of the same body, clicking it commits a SPLIT', () => {
    // Arm on ``b1`` (the other column's sand layer); the sand region's target
    // anchor is ``a1`` != ``b1``, so the two anchors are distinct — a legitimate
    // split of one body into two (sameBody true).
    const onSeparatePick = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay
          {...baseProps()}
          separateArm={{ bodyId: 'body-sand', anchorLayerId: 'b1' }}
          onSeparatePick={onSeparatePick}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId('partition-region-body-sand'))
    expect(onSeparatePick).toHaveBeenCalledTimes(1)
    expect(onSeparatePick.mock.calls[0][0]).toMatchObject({ kind: 'commit', sameBody: true })
  })

  it('SEP-OV3 — not armed, a region left-click fires no separate pick', () => {
    const onSeparatePick = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay {...baseProps()} onSeparatePick={onSeparatePick} />
      </svg>,
    )
    fireEvent.click(screen.getByTestId('partition-region-body-clay'))
    expect(onSeparatePick).not.toHaveBeenCalled()
  })

  // #279 item-1: the body menu (its right-click, which ARMS Separate) must not
  // open until the body list has landed — before that the stats menu is the
  // deliberate answer, not a race. bodiesLoaded=false withholds the body menu.
  it('SEP-OV4 — bodiesLoaded=false withholds the body-menu right-click', () => {
    const onBodyContextMenu = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay
          {...baseProps()}
          bodiesLoaded={false}
          onBodyContextMenu={onBodyContextMenu}
        />
      </svg>,
    )
    fireEvent.contextMenu(screen.getByTestId('partition-region-body-clay'))
    expect(onBodyContextMenu).not.toHaveBeenCalled()
  })

  // BLOCKER (code review): correlate mode owns the canvas — an armed Separate
  // must YIELD, not steal the click and POST a separation. Asserted at the CSS
  // layer (pointer-events), because fireEvent bypasses pointer-events and a
  // callback-only assertion would pass on a region that is visually inert but
  // still steals real clicks.
  it('SEP-OV6 — correlate mode drops the armed region to pointer-events:none', () => {
    const onSeparatePick = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay
          {...baseProps()}
          separateArm={{ bodyId: 'body-sand', anchorLayerId: 'a1' }}
          onSeparatePick={onSeparatePick}
          correlateMode={true}
        />
      </svg>,
    )
    const region = screen.getByTestId('partition-region-body-clay')
    expect(region.style.pointerEvents).toBe('none')
    // And the click cannot commit — the arm is inert under correlate mode.
    fireEvent.click(region)
    expect(onSeparatePick).not.toHaveBeenCalled()
  })

  it('SEP-OV5 — bodiesLoaded=true opens the body-menu right-click', () => {
    const onBodyContextMenu = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay
          {...baseProps()}
          bodiesLoaded={true}
          onBodyContextMenu={onBodyContextMenu}
        />
      </svg>,
    )
    fireEvent.contextMenu(screen.getByTestId('partition-region-body-clay'))
    expect(onBodyContextMenu).toHaveBeenCalledTimes(1)
  })
})
