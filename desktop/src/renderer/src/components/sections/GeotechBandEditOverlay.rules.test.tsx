// The gesture surface for hand editing packing sub-bands, and the wall it stops at.
//
// Two things are pinned here that the pure arithmetic in `geotechBandEdit.rules.test.ts`
// cannot pin on its own: that the overlay actually CONSULTS the clamp while the owner is
// dragging (ruling 2's "clamps at the edge" has to be felt in the gesture, not discovered
// on release), and that the merge verb is not even offered across a litho contact.
//
// Gesture shape is mirrored from the litho axis rather than invented: right-click a band →
// "Split band…", right-click the boundary between two bands → "Merge bands", exactly as
// `LithoSuggestionGhostColumns` does with `litho-context-split` / `litho-boundary-merge`.
// Choosing to split ARMS a placement instead of committing one, because left-drag on this
// canvas already pans the section — a band-wide press target would either swallow the pan
// or fight it. So the last case here is the one that keeps the rest of the axis working.
//
// jsdom reports every getBoundingClientRect as zeroes, so `levelToScreen` here is a real
// linear transform and clientY is read as SVG Y directly — the same arithmetic the
// placement does in the browser, with the offset pinned at zero.

import { fireEvent, render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LithoLayerResponse } from '../../api/client'
import GeotechBandEditOverlay from './GeotechBandEditOverlay'
import type { PlacedColumn } from './utils'

/** 10 px per metre down, surface elevation 10 m → surface at y = 900. */
const levelToScreen = (level: number): number => (100 - level) * 10
const SURFACE_Y = levelToScreen(10)

/** Screen Y for a depth below the collar of the single fixture column. */
const yAtDepth = (depthM: number): number => SURFACE_Y + depthM * 10

function layer(
  id: string,
  topM: number,
  baseM: number,
  formationId = `f-${id}`,
): LithoLayerResponse {
  return {
    id,
    model_id: 'm-1',
    formation_id: formationId,
    borehole_id: null,
    cpt_id: 'cpt-1',
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

/** Two litho bodies: 2–8 m and 8–14 m. The contact at 8 m is the hard wall. */
const LITHO_LAYERS = [layer('litho-a', 2, 8), layer('litho-b', 8, 14)]

/** Three packing bands inside the upper body, one inside the lower one. */
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

function renderOverlay(
  overrides: Partial<React.ComponentProps<typeof GeotechBandEditOverlay>> = {},
): {
  onRequestSplit: ReturnType<typeof vi.fn>
  onRequestMerge: ReturnType<typeof vi.fn>
  svgMouseDown: ReturnType<typeof vi.fn>
} {
  const onRequestSplit = vi.fn()
  const onRequestMerge = vi.fn()
  // SectionPanel starts its pan from a mousedown handler on the SVG ROOT, so anything this
  // overlay swallows is a pan the owner can no longer start.
  const svgMouseDown = vi.fn()
  render(
    <svg onMouseDown={svgMouseDown}>
      <GeotechBandEditOverlay
        geotechLayers={GEOTECH_LAYERS}
        lithoLayers={LITHO_LAYERS}
        placedColumns={[COLUMN]}
        levelToScreen={levelToScreen}
        plotTop={0}
        plotBottom={2000}
        onRequestSplit={onRequestSplit}
        onRequestMerge={onRequestMerge}
        {...overrides}
      />
    </svg>,
  )
  return { onRequestSplit, onRequestMerge, svgMouseDown }
}

afterEach(() => cleanup())

/** Right-click a band and choose "Split band…", leaving a placement armed at that depth. */
function armSplitAt(depthM: number, bandTestId = 'geotech-band-hit-band-2'): void {
  fireEvent.contextMenu(screen.getByTestId(bandTestId), { clientY: yAtDepth(depthM) })
  fireEvent.click(screen.getByTestId('geotech-band-menu-split'))
}

describe('the split gesture starts the way the litho axis starts one', () => {
  it('GS5 — right-clicking a band offers the split, and choosing it writes nothing yet', () => {
    const { onRequestSplit } = renderOverlay()

    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(4.75),
    })
    expect(screen.getByTestId('geotech-band-menu-split').textContent).toContain('Split band')

    fireEvent.click(screen.getByTestId('geotech-band-menu-split'))

    // Armed, not committed: the boundary is on screen at the clicked depth, waiting.
    expect(Number(screen.getByTestId('geotech-split-preview-line').getAttribute('y1'))).toBeCloseTo(
      yAtDepth(4.75),
      4,
    )
    expect(onRequestSplit).not.toHaveBeenCalled()
  })
})

describe('the clamp is visible in the gesture, not only enforced on commit', () => {
  it('GS1 — moving toward the litho edge stops there', () => {
    renderOverlay()
    armSplitAt(5)

    // Move far above the litho body's top at 2 m — all the way past the surface.
    fireEvent.mouseMove(screen.getByTestId('geotech-split-capture'), { clientY: yAtDepth(-3) })

    const line = screen.getByTestId('geotech-split-preview-line')
    // Stopped at the litho contact, not at the cursor: 2 m plus the 1 cm structural inset.
    expect(Number(line.getAttribute('y1'))).toBeCloseTo(yAtDepth(2.01), 4)
  })

  it('GS2 — and says what stopped it, so the refusal is legible', () => {
    renderOverlay()
    armSplitAt(5)

    fireEvent.mouseMove(screen.getByTestId('geotech-split-capture'), { clientY: yAtDepth(-3) })

    expect(screen.getByTestId('geotech-split-clamp-readout').textContent?.toLowerCase()).toContain(
      'litho',
    )
  })

  it('GS3 — inside the litho body the boundary follows the cursor exactly', () => {
    renderOverlay()
    armSplitAt(5)

    // 3.2 m is inside the litho body but inside a DIFFERENT packing band (band-1).
    // Crossing the owner's own subdivision is free; only the litho contact is a wall.
    fireEvent.mouseMove(screen.getByTestId('geotech-split-capture'), { clientY: yAtDepth(3.2) })

    const line = screen.getByTestId('geotech-split-preview-line')
    expect(Number(line.getAttribute('y1'))).toBeCloseTo(yAtDepth(3.2), 4)
    expect(screen.queryByTestId('geotech-split-clamp-readout')).toBeNull()
  })

  it('GS4 — clicking it down asks for the split on the band the cursor ended in', () => {
    const { onRequestSplit } = renderOverlay()
    armSplitAt(5)

    const capture = screen.getByTestId('geotech-split-capture')
    fireEvent.mouseMove(capture, { clientY: yAtDepth(3.2) })
    fireEvent.click(capture)

    expect(onRequestSplit).toHaveBeenCalledTimes(1)
    const [bandId, depthM] = onRequestSplit.mock.calls[0]
    expect(bandId).toBe('band-1')
    expect(depthM).toBeCloseTo(3.2, 4)
  })

  it('GS10 — Escape abandons the placement without writing anything', () => {
    const { onRequestSplit } = renderOverlay()
    armSplitAt(5)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(screen.queryByTestId('geotech-split-preview-line')).toBeNull()
    expect(onRequestSplit).not.toHaveBeenCalled()
  })
})

describe('and the rest of the canvas keeps working', () => {
  it('GS11 — with nothing armed, a press on a band reaches the canvas, so panning still starts', () => {
    const { svgMouseDown } = renderOverlay()

    fireEvent.mouseDown(screen.getByTestId('geotech-band-hit-band-2'), {
      button: 0,
      clientY: yAtDepth(5),
    })

    expect(svgMouseDown).toHaveBeenCalledTimes(1)
  })

  it('GS12 — while a placement is armed the press is swallowed, so placing does not also pan', () => {
    const { svgMouseDown } = renderOverlay()
    armSplitAt(5)

    fireEvent.mouseDown(screen.getByTestId('geotech-split-capture'), {
      button: 0,
      clientY: yAtDepth(5),
    })

    expect(svgMouseDown).not.toHaveBeenCalled()
  })
})

describe('merge is offered inside a litho body and refused across one', () => {
  it('GS6 — the boundary between two bands in one litho body offers the merge', () => {
    const { onRequestMerge } = renderOverlay()

    fireEvent.contextMenu(screen.getByTestId('geotech-band-boundary-band-2'))
    fireEvent.click(screen.getByTestId('geotech-band-menu-merge'))

    expect(onRequestMerge).toHaveBeenCalledWith('band-2', 'band-3')
  })

  it('GS7 — the boundary at 8 m is a litho contact, so no merge handle is drawn there', () => {
    renderOverlay()

    // band-3 ends at 8 m where band-4 begins, but 8 m is where the litho body changes.
    expect(screen.queryByTestId('geotech-band-boundary-band-3')).toBeNull()
  })
})

describe('the overlay yields when another gesture owns the canvas', () => {
  it('GS8 — suspended, it draws no hit targets at all', () => {
    renderOverlay({ suspended: true })

    expect(screen.queryByTestId('geotech-band-hit-band-2')).toBeNull()
    expect(screen.queryByTestId('geotech-band-boundary-band-2')).toBeNull()
  })

  it('GS9 — with no handlers wired it is inert, so the axis stays view-only by default', () => {
    renderOverlay({ onRequestSplit: undefined, onRequestMerge: undefined })

    expect(screen.queryByTestId('geotech-band-hit-band-2')).toBeNull()
    expect(screen.queryByTestId('geotech-band-boundary-band-2')).toBeNull()
  })
})
