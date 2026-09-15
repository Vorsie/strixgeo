// One right-click on a test gives one menu — the geotech axis (owner installer
// #39: "i get 2 different menus when i right click once or right click twice on
// a test, why not merge them?").
//
// Before this, the geotech axis had two independent menus: the band overlay's
// own menu on a packing band, and the section's ColumnContextMenu on the collar
// gap. Which one appeared depended on where the click landed, and a second
// right-click while one was open behaved differently again. The litho axis was
// unified on 2026-09-11 (ContactsLayer: header = test name, column verbs, a
// rule, then the unit verbs, with a backdrop that re-resolves). This pins the
// SAME shape on the geotech axis.
//
// The rule, in the owner's words, is the describe name: "one right-click on a
// test gives one menu". The column verbs head every menu (via ``columnMenuVerbs``,
// exactly as ContactsLayer receives them); the band verbs follow when the click
// sits on a packing band; the collar gap gives the column verbs only; and a
// second right-click closes the open menu and opens the one for the new spot —
// never two menus, never a different KIND of menu for the second click.

import { act, fireEvent, render, screen, cleanup } from '@testing-library/react'
import React, { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LithoLayerResponse } from '../../api/client'
import GeotechBandEditOverlay, {
  type GeotechBandEditOverlayHandle,
} from './GeotechBandEditOverlay'
import { buildColumnMenuVerbs } from './columnMenuVerbs'
import type { Translator } from '../../i18n/translate'
import type { PlacedColumn } from './utils'

/** 10 px per metre down, surface elevation 10 m → surface at y = 900. */
const levelToScreen = (level: number): number => (100 - level) * 10
const SURFACE_Y = levelToScreen(10)
const yAtDepth = (depthM: number): number => SURFACE_Y + depthM * 10

/** English-key-passthrough translator so the ``column-menu-*`` testids stay real. */
const fakeT = ((key: string) => key) as unknown as Translator

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

/** Two litho bodies 2–8 m / 8–14 m; three packing bands in the upper one. */
const LITHO_LAYERS = [layer('litho-a', 2, 8), layer('litho-b', 8, 14)]
const GEOTECH_LAYERS = [
  layer('band-1', 2, 4),
  layer('band-2', 4, 6),
  layer('band-3', 6, 8),
  layer('band-4', 8, 14),
]

const COLUMN = {
  kind: 'cpt',
  trueX: 200,
  nudgedX: 200,
  width: 40,
  displaced: false,
  proj: { item: { id: 'cpt-1', name: 'CPT-1', elevation_m: 10 } },
} as unknown as PlacedColumn

/** The per-test column verbs, built exactly the way SectionPanel builds them. */
function columnMenuVerbs(anchor: { kind: 'cpt' | 'borehole'; id: string; name: string }) {
  return buildColumnMenuVerbs(fakeT, {
    onFocus: vi.fn(),
    onOpenDetail: vi.fn(),
    onClearSubdivision: vi.fn(),
    onRemoveFromSection: vi.fn(),
  })
}

function renderOverlay(
  overrides: Partial<React.ComponentProps<typeof GeotechBandEditOverlay>> = {},
): React.RefObject<GeotechBandEditOverlayHandle> {
  const ref = createRef<GeotechBandEditOverlayHandle>()
  render(
    <svg onMouseDown={vi.fn()}>
      <GeotechBandEditOverlay
        ref={ref}
        geotechLayers={GEOTECH_LAYERS}
        lithoLayers={LITHO_LAYERS}
        placedColumns={[COLUMN]}
        levelToScreen={levelToScreen}
        plotTop={0}
        plotBottom={2000}
        onRequestSplit={vi.fn()}
        onRequestMerge={vi.fn()}
        columnMenuVerbs={columnMenuVerbs}
        {...overrides}
      />
    </svg>,
  )
  return ref
}

afterEach(() => cleanup())

describe('one right-click on a test gives one menu', () => {
  it('UM1 — a right-click on a packing band opens ONE menu carrying BOTH the column verbs and the band verbs', () => {
    renderOverlay()

    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientX: 200,
      clientY: yAtDepth(5),
    })

    // Exactly one menu, not the band menu beside a separate column menu.
    expect(screen.getAllByTestId('geotech-band-edit-menu')).toHaveLength(1)
    // The column verbs head it (the litho-axis shape).
    expect(screen.getByTestId('column-menu-focus-test')).toBeTruthy()
    expect(screen.getByTestId('column-menu-clear-subdivision')).toBeTruthy()
    // The band verbs follow, because the click sits on a band.
    expect(screen.getByTestId('geotech-band-menu-split')).toBeTruthy()
  })

  it('UM2 — the menu is headed by the test name', () => {
    renderOverlay()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientX: 200,
      clientY: yAtDepth(5),
    })
    expect(screen.getByTestId('geotech-menu-header').textContent).toContain('CPT-1')
  })

  it('UM3 — a right-click on the collar gap opens the SAME menu with the column verbs only', () => {
    const ref = renderOverlay()

    // The collar gap (above the shallowest band) carries no band rect: the
    // section catch-all used to open the separate ColumnContextMenu here. Now it
    // asks the overlay to open its unified menu, resolved to the column.
    expect(ref.current).not.toBeNull()
    act(() => ref.current?.openMenuAt(200, yAtDepth(0.5)))

    expect(screen.getAllByTestId('geotech-band-edit-menu')).toHaveLength(1)
    expect(screen.getByTestId('column-menu-focus-test')).toBeTruthy()
    // No band under the pointer → no band verbs.
    expect(screen.queryByTestId('geotech-band-menu-split')).toBeNull()
  })
})

describe('a right-click while a menu is open opens the one for the new spot', () => {
  it('UM4 — a second right-click on the same band re-opens the same single menu (never two)', () => {
    renderOverlay()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientX: 200,
      clientY: yAtDepth(5),
    })

    // The dismiss backdrop covers the canvas, so the browser can no longer
    // hit-test the band — the backdrop re-resolves the point itself and re-opens
    // the same menu, rather than closing and letting a second menu open.
    fireEvent.contextMenu(screen.getByTestId('geotech-band-edit-menu-backdrop'), {
      clientX: 200,
      clientY: yAtDepth(5),
    })

    expect(screen.getAllByTestId('geotech-band-edit-menu')).toHaveLength(1)
    expect(screen.getByTestId('column-menu-focus-test')).toBeTruthy()
    expect(screen.getByTestId('geotech-band-menu-split')).toBeTruthy()
  })

  it('UM5 — a second right-click on the collar gap swaps to the column-only menu, still just one', () => {
    renderOverlay()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientX: 200,
      clientY: yAtDepth(5),
    })

    fireEvent.contextMenu(screen.getByTestId('geotech-band-edit-menu-backdrop'), {
      clientX: 200,
      clientY: yAtDepth(0.5),
    })

    expect(screen.getAllByTestId('geotech-band-edit-menu')).toHaveLength(1)
    expect(screen.getByTestId('column-menu-focus-test')).toBeTruthy()
    expect(screen.queryByTestId('geotech-band-menu-split')).toBeNull()
  })

  it('UM6 — a second right-click off every column closes the menu', () => {
    renderOverlay()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientX: 200,
      clientY: yAtDepth(5),
    })

    // x = 1000 is far outside the single column (x0..x1 = 180..220).
    fireEvent.contextMenu(screen.getByTestId('geotech-band-edit-menu-backdrop'), {
      clientX: 1000,
      clientY: yAtDepth(5),
    })

    expect(screen.queryByTestId('geotech-band-edit-menu')).toBeNull()
  })
})

describe('the column-verb head appears only when the section wires the verbs', () => {
  it('UM7 — with no columnMenuVerbs the band menu opens exactly as before (band verbs, no head)', () => {
    renderOverlay({ columnMenuVerbs: undefined })
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientX: 200,
      clientY: yAtDepth(5),
    })
    expect(screen.getByTestId('geotech-band-menu-split')).toBeTruthy()
    expect(screen.queryByTestId('geotech-menu-header')).toBeNull()
    expect(screen.queryByTestId('column-menu-focus-test')).toBeNull()
  })
})
