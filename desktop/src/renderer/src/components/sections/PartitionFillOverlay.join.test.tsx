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

// Two columns 100 m apart. An upper unit (body-up) 0–10 m correlated across both,
// a lower unit (body-lo) 10–15 m correlated too — two DISTINCT bodies. The
// packing class is supplied via classByLayerId (the join guard's authority),
// independent of formation, so the same fixture drives the commit and the
// cross-class pins.
const LITHO_LAYERS: LithoLayerResponse[] = [
  layer({ id: 'a1', investigationId: 'L', formationId: 'formation-up', depthTopM: 0, depthBaseM: 10, bodyId: 'body-up' }),
  layer({ id: 'b1', investigationId: 'R', formationId: 'formation-up', depthTopM: 0, depthBaseM: 10, bodyId: 'body-up' }),
  layer({ id: 'a2', investigationId: 'L', formationId: 'formation-lo', depthTopM: 10, depthBaseM: 15, bodyId: 'body-lo' }),
  layer({ id: 'b2', investigationId: 'R', formationId: 'formation-lo', depthTopM: 10, depthBaseM: 15, bodyId: 'body-lo' }),
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
    placedColumns: [column({ investigationId: 'L', along: 0, elevationM: 10 }), column({ investigationId: 'R', along: 100, elevationM: 10 })],
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
    // No soilByLayerId supplied here, so the advisory falls to the lithology copy
    // (the broader statement) — the packing-vs-litho split is pinned in
    // joinPick.test.ts JP6a/JP6b, which drive soil equality directly.
    expect(onJoinPick.mock.calls[0][0]).toEqual({
      kind: 'cross-class',
      differ: 'litho',
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
