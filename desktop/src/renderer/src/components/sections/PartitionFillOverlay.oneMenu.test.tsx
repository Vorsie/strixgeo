// Debt #279 — two menus share one cursor, so you cannot tell which you will get.
//
// A right-click on a fill region between columns answered with EITHER the body
// menu (Name / Dissolve / Join / Unit statistics) or the unit-statistics-only
// menu, and both wore the same ``cursor: context-menu``, so the engineer could
// not predict which a right-click would open. These pins state the rule the
// owner wants in his own words:
//
//   OM1 — a right-click on a fill region opens EXACTLY ONE menu, never both.
//   OM2 — the menu that opens is the one for what is under the cursor: a fill
//         that is one body mass opens the body menu.
//   OM3 — a fill that belongs to no single body opens the unit-statistics menu,
//         NOT the body menu (there are no body verbs for a pooled region).
//   OM4 — whichever menu opens NAMES its unit in a header, so the two menus read
//         as one consistent family instead of two anonymous look-alikes.
//   OM5 — a fill with no menu at all opens nothing and shows no context-menu
//         cursor (the cursor and the menu never disagree).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import PartitionFillOverlay, { type Props } from './PartitionFillOverlay'
import type { BodyListItem, LithoLayerResponse } from '../../api/client'
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
])
// The unit labels the fill-region menu names its unit with — the same map the
// body menu's header reads.
const labels = new Map([
  ['fSand', 'Sa'],
  ['fClay', 'C'],
])

// Two-body matched stack, L at x=0, R at x=100.
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
  levelToScreen: (l: number) => 100 - l * 10,
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

describe('PartitionFillOverlay — one predictable menu per fill right-click (#279)', () => {
  it('OM1 — a right-click on a body fill opens exactly one menu, never both', () => {
    const onBodyContextMenu = vi.fn()
    const onShowLithoUnitStatistics = vi.fn()
    const { getAllByTestId } = renderOverlay({
      bodies: [{ id: 'sand' } as BodyListItem, { id: 'clay' } as BodyListItem],
      bodiesLoaded: true,
      onBodyContextMenu,
      onShowLithoUnitStatistics,
    })
    fireEvent.contextMenu(getAllByTestId('partition-region-sand')[0])
    // The body menu answered ONCE, and the statistics menu did NOT also open.
    expect(onBodyContextMenu).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('partition-region-menu')).toBeNull()
    expect(onShowLithoUnitStatistics).not.toHaveBeenCalled()
  })

  it('OM2 — the menu that opens is the one under the cursor: a single-body fill opens the body menu', () => {
    const onBodyContextMenu = vi.fn()
    const { getAllByTestId } = renderOverlay({
      bodies: [{ id: 'sand' } as BodyListItem, { id: 'clay' } as BodyListItem],
      bodiesLoaded: true,
      onBodyContextMenu,
    })
    fireEvent.contextMenu(getAllByTestId('partition-region-sand')[0])
    expect(onBodyContextMenu).toHaveBeenCalledTimes(1)
    expect(onBodyContextMenu.mock.calls[0][0]).toMatchObject({ id: 'sand' })
  })

  it('OM3 — a fill that belongs to no single body opens the unit-statistics menu, not the body menu', () => {
    // The roster has landed but carries no body for this region (a pooled /
    // formation-level fill): the body menu cannot answer, so statistics does.
    const onBodyContextMenu = vi.fn()
    const onShowLithoUnitStatistics = vi.fn()
    renderOverlay({
      bodies: [],
      bodiesLoaded: true,
      onBodyContextMenu,
      onShowLithoUnitStatistics,
    })
    fireEvent.contextMenu(screen.getAllByTestId('partition-region-sand')[0], {
      clientX: 60,
      clientY: 40,
    })
    expect(onBodyContextMenu).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('partition-region-menu-unit-statistics'))
    expect(onShowLithoUnitStatistics).toHaveBeenCalledTimes(1)
  })

  it('OM4 — the unit-statistics fallback names its unit, so the two menus read as one family', () => {
    renderOverlay({
      bodies: [],
      bodiesLoaded: true,
      onBodyContextMenu: vi.fn(),
      onShowLithoUnitStatistics: vi.fn(),
    })
    fireEvent.contextMenu(screen.getAllByTestId('partition-region-sand')[0], {
      clientX: 60,
      clientY: 40,
    })
    // The menu names its unit the same way the body menu's header does, so a
    // right-click on a fill always reads "the menu for this unit".
    const header = screen.getByTestId('partition-region-menu-header')
    expect(header.textContent).toContain('Sa')
  })

  it('OM5 — a fill with no menu at all opens nothing and shows no context-menu cursor', () => {
    // No body menu, no statistics handler: the region is inert, so its cursor
    // must not advertise a menu that will never open.
    const { getAllByTestId } = renderOverlay({})
    const region = getAllByTestId('partition-region-sand')[0]
    expect(region.style.pointerEvents).toBe('none')
    expect(region.style.cursor).not.toBe('context-menu')
  })
})
