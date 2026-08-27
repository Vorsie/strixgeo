// Pins for the layer → Parameters jump offered on a geotech band's right-click
// menu (owner ballot 2026-08-26 — "the right-click layer → ... jump-to-
// parameters link").
//
// The overlay does not navigate. It names the band's UNIT and hands it up; the
// shell is the only thing that switches stages (the deep-link contract every
// other cross-stage landing already runs on). So what is pinned here is what
// the menu offers and WHICH id it reports — a menu that reported the band's
// layer id instead of its formation id would deep-link to nothing.
//
// UJ1 — a CPT band's menu offers "Unit statistics…" and reports the band's UNIT.
// UJ2 — a borehole band's menu offers it too, reporting the same kind of id.
// UJ3 — with no handler wired the item is absent, not present-and-refusing
//       (the GS7 no-affordance pattern this overlay already follows).

import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LithoLayerResponse } from '../../api/client'
import GeotechBandEditOverlay from './GeotechBandEditOverlay'
import type { PlacedColumn } from './utils'

const levelToScreen = (level: number): number => (100 - level) * 10
const SURFACE_Y = levelToScreen(10)
const yAtDepth = (depthM: number): number => SURFACE_Y + depthM * 10

function layer(
  id: string,
  topM: number,
  baseM: number,
  formationId = `f-${id}`,
  anchorId = 'cpt-1',
  anchorKind: 'cpt' | 'borehole' = 'cpt',
): LithoLayerResponse {
  return {
    id,
    model_id: 'm-1',
    formation_id: formationId,
    borehole_id: anchorKind === 'borehole' ? anchorId : null,
    cpt_id: anchorKind === 'cpt' ? anchorId : null,
    depth_top_m: topM,
    depth_base_m: baseM,
    status: 'accepted',
    source: 'segmenter',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as LithoLayerResponse
}

const LITHO_LAYERS = [layer('litho-a', 2, 8), layer('litho-b', 8, 14)]
const GEOTECH_LAYERS = [layer('band-1', 2, 4), layer('band-2', 4, 6), layer('band-3', 6, 8)]

const COLUMN = {
  kind: 'cpt',
  trueX: 200,
  nudgedX: 200,
  width: 40,
  displaced: false,
  proj: { item: { id: 'cpt-1', name: 'CPT-1', elevation_m: 10 } },
} as unknown as PlacedColumn

const BOREHOLE_LITHO_LAYERS = [
  layer('bh-litho-a', 2, 8, 'f-litho-a', 'bh-1', 'borehole'),
  layer('bh-litho-b', 8, 14, 'f-litho-b', 'bh-1', 'borehole'),
]
const BOREHOLE_GEOTECH_LAYERS = [
  layer('bh-band-1', 2, 5, 'f-bh-band-1', 'bh-1', 'borehole'),
  layer('bh-band-2', 5, 8, 'f-bh-band-2', 'bh-1', 'borehole'),
]
const BOREHOLE_COLUMN = {
  kind: 'borehole',
  trueX: 400,
  nudgedX: 400,
  width: 40,
  displaced: false,
  proj: { item: { id: 'bh-1', name: 'BH-1', elevation_m: 10 } },
} as unknown as PlacedColumn

afterEach(() => cleanup())

function renderOverlay(
  overrides: Partial<React.ComponentProps<typeof GeotechBandEditOverlay>> = {},
): { onShowUnitStatistics: ReturnType<typeof vi.fn> } {
  const onShowUnitStatistics = vi.fn()
  render(
    <svg>
      <GeotechBandEditOverlay
        geotechLayers={GEOTECH_LAYERS}
        lithoLayers={LITHO_LAYERS}
        placedColumns={[COLUMN]}
        levelToScreen={levelToScreen}
        plotTop={0}
        plotBottom={2000}
        onRequestSplit={vi.fn()}
        onRequestMerge={vi.fn()}
        onShowUnitStatistics={onShowUnitStatistics}
        {...overrides}
      />
    </svg>,
  )
  return { onShowUnitStatistics }
}

describe('geotech band → Parameters jump', () => {
  it('UJ1 — a CPT band offers "Unit statistics…" and reports the band\'s UNIT', () => {
    const { onShowUnitStatistics } = renderOverlay()

    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(4.75),
    })
    const item = screen.getByTestId('geotech-band-menu-unit-statistics')
    expect(item.textContent).toContain('Unit statistics')

    fireEvent.click(item)

    // band-2's formation, NOT its layer id — the deep link is scoped to a
    // unit. The second argument is the band's BODY (owner ruling 2026-08-27:
    // "a body is only a body if it is geometrically connected…"); this
    // fixture's bands are unstamped, so it reports null.
    expect(onShowUnitStatistics).toHaveBeenCalledWith('f-band-2', null)
  })

  it('UJ4 — a band the resolver stamped reports ITS body alongside the unit', () => {
    const { onShowUnitStatistics } = renderOverlay({
      geotechLayers: GEOTECH_LAYERS.map(l =>
        l.id === 'band-2' ? { ...l, body_id: 'body-A' } : l,
      ),
    })

    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(4.75),
    })
    fireEvent.click(screen.getByTestId('geotech-band-menu-unit-statistics'))

    expect(onShowUnitStatistics).toHaveBeenCalledWith('f-band-2', 'body-A')
  })

  it('UJ2 — a borehole band offers it too', () => {
    const { onShowUnitStatistics } = renderOverlay({
      geotechLayers: BOREHOLE_GEOTECH_LAYERS,
      lithoLayers: BOREHOLE_LITHO_LAYERS,
      placedColumns: [BOREHOLE_COLUMN],
      // The borehole menu is gated on the SOIL map (the set-class family is
      // built from litho_main_soil_code — family-clamp ruling 2026-08-26);
      // the class map only supplies the undo anchor and may be absent.
      soilCodeByFormationId: new Map([
        ['f-bh-band-1', 'ZAND'],
        ['f-bh-band-2', 'ZAND'],
      ]),
      nadClassByFormationId: new Map([
        ['f-bh-band-1', 6],
        ['f-bh-band-2', 7],
      ]),
      onRequestSetClass: vi.fn(),
    })

    fireEvent.contextMenu(screen.getByTestId('geotech-borehole-band-bh-band-1'), {
      clientY: yAtDepth(3),
    })
    fireEvent.click(screen.getByTestId('geotech-band-menu-unit-statistics'))

    expect(onShowUnitStatistics).toHaveBeenCalledWith('f-bh-band-1', null)
  })

  it('UJ3 — with no handler wired the item is absent, not refusing', () => {
    renderOverlay({ onShowUnitStatistics: undefined })

    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(4.75),
    })

    // The split menu still opened; only the statistics item is missing.
    expect(screen.getByTestId('geotech-band-menu-split')).toBeTruthy()
    expect(screen.queryByTestId('geotech-band-menu-unit-statistics')).toBeNull()
  })
})
