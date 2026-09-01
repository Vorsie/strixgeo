// Behavioural net for the "Join with…" armed left-click (debt #278, geotech axis).
//
// When a Join is armed, the partition fill regions become LEFT-clickable and a
// click resolves the clicked region's body through its layers, then checks the
// packing class (classByLayerId): a DIFFERENT SAME-class body commits; a
// DIFFERENT-class body is refused with a cross-class advisory; the armed body
// itself stays armed. When nothing is armed the regions behave exactly as before.
// The armed BLOCK is verb-agnostic — it routes to the join resolver because the
// join arm (not the separate arm) is the one set.
//
//   JOIN-OV1  armed + click a DIFFERENT same-class body region → commit(arm anchor, target)
//   JOIN-OV2  armed + click the ARMED body's own region → stays armed ({kind:'same'})
//   JOIN-OV3  armed + click a DIFFERENT-class body region → cross-class(classA, classB)
//   JOIN-OV4  NOT armed → a region left-click fires nothing (byte-identical gating)

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

// Two columns 100 m apart. An upper unit (body-up) 0–10 m correlated across both,
// a lower unit (body-lo) 10–15 m correlated too — two DISTINCT bodies. The
// packing class is supplied via classByLayerId (the join guard's authority),
// independent of formation, so the same fixture drives the commit and the
// cross-class pins.
const LITHO_LAYERS: LithoLayerResponse[] = [
  layer('a1', 'L', 'formation-up', 0, 10, 'body-up'),
  layer('b1', 'R', 'formation-up', 0, 10, 'body-up'),
  layer('a2', 'L', 'formation-lo', 10, 15, 'body-lo'),
  layer('b2', 'R', 'formation-lo', 10, 15, 'body-lo'),
]
const LITHO_EDGES: LithoContactCorrelationEdge[] = [
  edge('a1', 'b1'),
  edge('a2', 'b2'),
  edge('a2', 'b2', 'base'),
]
const COLOURS = new Map<string, string>([
  ['formation-up', '#fbbf24'],
  ['formation-lo', '#0ea5e9'],
])
const BODIES: BodyListItem[] = [
  { id: 'body-up', formation_id: 'formation-up' } as unknown as BodyListItem,
  { id: 'body-lo', formation_id: 'formation-lo' } as unknown as BodyListItem,
]

function baseProps(): Props {
  return {
    lithoLayers: LITHO_LAYERS,
    contactEdges: LITHO_EDGES,
    axisMode: 'geotechnical',
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

const SAME_CLASS = new Map<string, string>([
  ['a1', 'ZAND, dicht'],
  ['b1', 'ZAND, dicht'],
  ['a2', 'ZAND, dicht'],
  ['b2', 'ZAND, dicht'],
])
const CROSS_CLASS = new Map<string, string>([
  ['a1', 'ZAND, dicht'],
  ['b1', 'ZAND, dicht'],
  ['a2', 'KLEI, stevig'],
  ['b2', 'KLEI, stevig'],
])

describe('PartitionFillOverlay — Join arm', () => {
  it('JOIN-OV1 — armed, clicking a DIFFERENT same-class body region commits', () => {
    const onJoinPick = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay
          {...baseProps()}
          joinArm={{ bodyId: 'body-up', anchorLayerId: 'a1' }}
          onJoinPick={onJoinPick}
          classByLayerId={SAME_CLASS}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId('partition-region-body-lo'))
    expect(onJoinPick).toHaveBeenCalledTimes(1)
    expect(onJoinPick.mock.calls[0][0]).toMatchObject({ kind: 'commit', anchorLayerId: 'a1' })
  })

  it('JOIN-OV2 — armed, clicking the ARMED body region stays armed ({kind:"same"})', () => {
    const onJoinPick = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay
          {...baseProps()}
          joinArm={{ bodyId: 'body-up', anchorLayerId: 'a1' }}
          onJoinPick={onJoinPick}
          classByLayerId={SAME_CLASS}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId('partition-region-body-up'))
    expect(onJoinPick).toHaveBeenCalledTimes(1)
    expect(onJoinPick.mock.calls[0][0]).toEqual({ kind: 'same' })
  })

  it('JOIN-OV3 — armed, clicking a DIFFERENT-class body region is cross-class', () => {
    const onJoinPick = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay
          {...baseProps()}
          joinArm={{ bodyId: 'body-up', anchorLayerId: 'a1' }}
          onJoinPick={onJoinPick}
          classByLayerId={CROSS_CLASS}
        />
      </svg>,
    )
    fireEvent.click(screen.getByTestId('partition-region-body-lo'))
    expect(onJoinPick).toHaveBeenCalledTimes(1)
    expect(onJoinPick.mock.calls[0][0]).toEqual({
      kind: 'cross-class',
      classA: 'ZAND, dicht',
      classB: 'KLEI, stevig',
    })
  })

  it('JOIN-OV4 — not armed, a region left-click fires no join pick', () => {
    const onJoinPick = vi.fn()
    render(
      <svg>
        <PartitionFillOverlay {...baseProps()} onJoinPick={onJoinPick} classByLayerId={SAME_CLASS} />
      </svg>,
    )
    fireEvent.click(screen.getByTestId('partition-region-body-lo'))
    expect(onJoinPick).not.toHaveBeenCalled()
  })
})
