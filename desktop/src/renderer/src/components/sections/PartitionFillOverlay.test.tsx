// Render tests for PartitionFillOverlay — the partition (no overlaps / no gaps)
// litho section fill.
//
//   PFO1 a matched two-body stack renders one region path per body + labels.
//   PFO2 showBands=false → no fill rendered.
//   PFO3 right-click a region opens the body context menu.
//   PFO4 an interrupted body (clay below silt on the left, clay at surface +
//        below silt on the right) renders as TWO clay regions, not one.

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BodyListItem, LithoLayerResponse } from '../../api/client'
import PartitionFillOverlay from './PartitionFillOverlay'
import type { Props } from './MorphFillOverlay'
import type { PlacedColumn } from './utils'

afterEach(() => cleanup())

function layer(
  id: string,
  inv: string,
  bodyId: string,
  formationId: string,
  top: number,
  base: number,
): LithoLayerResponse {
  return {
    id,
    model_id: 'm1',
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

const colors = new Map([
  ['fSand', '#fbbf24'],
  ['fClay', '#6b7280'],
  ['fSilt', '#84cc16'],
])
const labels = new Map([
  ['fSand', 'Sa'],
  ['fClay', 'C'],
  ['fSilt', 'Si'],
])

const base: Props = {
  lithoLayers: [
    layer('a1', 'L', 'sand', 'fSand', 0, 5),
    layer('a2', 'L', 'clay', 'fClay', 5, 10),
    layer('b1', 'R', 'sand', 'fSand', 0, 6),
    layer('b2', 'R', 'clay', 'fClay', 6, 10),
  ],
  placedColumns: [column('L', 0, 10), column('R', 100, 10)],
  formationColorById: colors,
  formationLabelById: labels,
  showBands: true,
  levelToScreen: (l: number) => 100 - l * 10, // 10 m ⇒ 100 px tall
  plotTop: 0,
  plotBottom: 400,
  plotLeft: 0,
  plotRight: 200,
}

function renderOverlay(props: Partial<Props> = {}): ReturnType<typeof render> {
  return render(
    <svg>
      <PartitionFillOverlay {...base} {...props} />
    </svg>,
  )
}

describe('PartitionFillOverlay', () => {
  it('PFO1 — a matched two-body stack renders one region per body + labels', () => {
    const { queryAllByTestId, getByText } = renderOverlay()
    expect(queryAllByTestId('partition-region-sand').length).toBeGreaterThanOrEqual(1)
    expect(queryAllByTestId('partition-region-clay').length).toBeGreaterThanOrEqual(1)
    // One label per body (tall enough bands).
    expect(getByText('Sa')).toBeTruthy()
    expect(getByText('C')).toBeTruthy()
  })

  it('PFO2 — showBands=false renders no fill', () => {
    const { queryAllByTestId } = renderOverlay({ showBands: false })
    expect(queryAllByTestId('partition-region-sand')).toHaveLength(0)
    expect(queryAllByTestId('partition-region-clay')).toHaveLength(0)
  })

  it('PFO3 — right-click a region opens the body context menu', () => {
    const onBodyContextMenu = vi.fn()
    const { getAllByTestId } = renderOverlay({
      bodies: [{ id: 'sand' } as BodyListItem, { id: 'clay' } as BodyListItem],
      onBodyContextMenu,
    })
    fireEvent.contextMenu(getAllByTestId('partition-region-sand')[0])
    expect(onBodyContextMenu).toHaveBeenCalledTimes(1)
    expect(onBodyContextMenu.mock.calls[0][0]).toMatchObject({ id: 'sand' })
  })

  it('PFO4 — an interrupted body renders as TWO pieces, not one swept band', () => {
    // Clay below the silt on L; clay at surface AND below the silt on R. The
    // monotonic alignment anchors on the shared silt, so the surface clay can't
    // fuse with the lower clay → two clay regions (a quad + a pinch).
    const { queryAllByTestId } = renderOverlay({
      lithoLayers: [
        layer('l1', 'L', 'sandtop', 'fSand', 0, 2),
        layer('l2', 'L', 'silt', 'fSilt', 2, 4),
        layer('l3', 'L', 'clay', 'fClay', 4, 10),
        layer('r1', 'R', 'clay', 'fClay', 0, 2),
        layer('r2', 'R', 'silt', 'fSilt', 2, 4),
        layer('r3', 'R', 'clay', 'fClay', 4, 10),
      ],
    })
    // The clay body appears in TWO regions (the matched lower quad + the
    // surface pinch), never collapsed into a single swept band.
    expect(queryAllByTestId('partition-region-clay').length).toBeGreaterThanOrEqual(2)
  })
})
