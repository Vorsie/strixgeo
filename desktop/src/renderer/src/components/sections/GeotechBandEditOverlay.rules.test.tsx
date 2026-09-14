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
import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LithoLayerResponse } from '../../api/client'
import GeotechBandEditOverlay from './GeotechBandEditOverlay'
import { nadCompactLabel } from '../../utils/nadClasses'
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
  anchorId = 'cpt-1',
  anchorKind: 'cpt' | 'borehole' = 'cpt',
): LithoLayerResponse {
  return {
    id,
    model_id: 'm-1',
    formation_id: formationId,
    // The anchor is an XOR in the database (`litho_layer_anchor_xor`) and it is the only
    // thing that says which kind of investigation a band hangs off — so the fixture models
    // it as one, rather than inferring the kind from the column it is drawn on.
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

/** A borehole standing next to the CPT, with the same litho stack and two packing bands. */
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

    expect(onRequestMerge).toHaveBeenCalledWith('band-2', 'band-3', 6)
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

// A borehole records no cone resistance, so the qc-driven CPT gestures are not on
// offer there: the CPT-style split HIT RECT (which arms a re-deriving placement)
// and the MERGE STRIP (which re-derives the union) both key on the BAND's anchor,
// never the column's neighbourhood — a borehole beside a CPT is still a borehole.
// Owner #35 (2026-09-13) later gave a borehole its OWN "Split band here" verb,
// which keeps the class and lives on the ``geotech-borehole-band-*`` rect — that
// is covered above; these cases pin only that the CPT affordances stay off it.
describe('a borehole column is not offered the CPT split/merge affordances', () => {
  const boreholeOnly = {
    geotechLayers: BOREHOLE_GEOTECH_LAYERS,
    lithoLayers: BOREHOLE_LITHO_LAYERS,
    placedColumns: [BOREHOLE_COLUMN],
  }

  it('GS13 — no CPT-style split hit rect is drawn on a band that hangs off a borehole', () => {
    renderOverlay(boreholeOnly)

    expect(screen.queryByTestId('geotech-band-hit-bh-band-1')).toBeNull()
  })

  it('GS14 — nor a merge strip on the boundary between two of its bands', () => {
    renderOverlay(boreholeOnly)

    // 5 m is a packing boundary inside one litho body, so the only reason for the handle
    // to be missing is the anchor.
    expect(screen.queryByTestId('geotech-band-boundary-bh-band-1')).toBeNull()
  })

  it('GS15 — while the CPT standing beside it keeps both verbs', () => {
    renderOverlay({
      geotechLayers: [...GEOTECH_LAYERS, ...BOREHOLE_GEOTECH_LAYERS],
      lithoLayers: [...LITHO_LAYERS, ...BOREHOLE_LITHO_LAYERS],
      placedColumns: [COLUMN, BOREHOLE_COLUMN],
    })

    expect(screen.queryByTestId('geotech-band-hit-band-2')).not.toBeNull()
    expect(screen.queryByTestId('geotech-band-boundary-band-2')).not.toBeNull()
    expect(screen.queryByTestId('geotech-band-hit-bh-band-1')).toBeNull()
    expect(screen.queryByTestId('geotech-band-boundary-bh-band-1')).toBeNull()
  })
})


// ---------------------------------------------------------------------------
// GS16+ — the DRAG verb (owner 2026-08-07: "tried dragging, get pan hand")
// ---------------------------------------------------------------------------
//
// The pan-hand conflict is solved litho-style: the press target is ONLY the
// thin boundary strip. Band-interior presses keep panning (GS11 stays green);
// a strip press starts a boundary drag that is clamped to its pair every
// frame and, squeezed past the absorb threshold, becomes a merge on release.

function renderDraggable(
  overrides: Partial<React.ComponentProps<typeof GeotechBandEditOverlay>> = {},
): {
  onRequestSplit: ReturnType<typeof vi.fn>
  onRequestMerge: ReturnType<typeof vi.fn>
  onRequestMoveBoundary: ReturnType<typeof vi.fn>
  svgMouseDown: ReturnType<typeof vi.fn>
  rerender: (
    next: Partial<React.ComponentProps<typeof GeotechBandEditOverlay>>,
  ) => void
} {
  const onRequestSplit = vi.fn()
  const onRequestMerge = vi.fn()
  const onRequestMoveBoundary = vi.fn()
  const svgMouseDown = vi.fn()
  const base = {
    geotechLayers: GEOTECH_LAYERS,
    lithoLayers: LITHO_LAYERS,
    placedColumns: [COLUMN],
    levelToScreen,
    plotTop: 0,
    plotBottom: 2000,
    onRequestSplit,
    onRequestMerge,
    onRequestMoveBoundary,
  }
  const view = render(
    <svg onMouseDown={svgMouseDown}>
      <GeotechBandEditOverlay {...base} {...overrides} />
    </svg>,
  )
  return {
    onRequestSplit,
    onRequestMerge,
    onRequestMoveBoundary,
    svgMouseDown,
    rerender: next =>
      view.rerender(
        <svg onMouseDown={svgMouseDown}>
          <GeotechBandEditOverlay {...base} {...next} />
        </svg>,
      ),
  }
}

/** Press the 4 m boundary strip (band-1 over band-2) to start a drag. */
function pressBoundary(): void {
  fireEvent.mouseDown(screen.getByTestId('geotech-band-boundary-band-1'), {
    button: 0,
    clientY: yAtDepth(4),
  })
}

describe('the boundary strip is the drag handle, and only the strip', () => {
  it('GS16 — a press on the strip is swallowed, so the drag does not also pan', () => {
    const { svgMouseDown } = renderDraggable()
    pressBoundary()
    expect(svgMouseDown).not.toHaveBeenCalled()
  })

  it('GS17 — without the move handler the strip owns no press, so panning still starts', () => {
    const { svgMouseDown } = renderDraggable({ onRequestMoveBoundary: undefined })
    fireEvent.mouseDown(screen.getByTestId('geotech-band-boundary-band-1'), {
      button: 0,
      clientY: yAtDepth(4),
    })
    expect(svgMouseDown).toHaveBeenCalled()
  })

  it('GS18 — the dragged boundary follows the cursor', () => {
    renderDraggable()
    pressBoundary()
    fireEvent.mouseMove(window, { buttons: 1, clientY: yAtDepth(4.8) })
    const line = screen.getByTestId('geotech-drag-preview-line')
    expect(Number(line.getAttribute('y1'))).toBeCloseTo(yAtDepth(4.8), 5)
  })

  it('GS19 — it stops at the pair edge and never leaves it', () => {
    renderDraggable()
    pressBoundary()
    fireEvent.mouseMove(window, { buttons: 1, clientY: yAtDepth(0.5) }) // above band-1's top (2 m)
    const line = screen.getByTestId('geotech-drag-preview-line')
    const clampedY = Number(line.getAttribute('y1'))
    expect(clampedY).toBeGreaterThanOrEqual(yAtDepth(2))
    expect(clampedY).toBeLessThan(yAtDepth(2.1))
  })

  it('GS20 — releasing inside the pair asks for the move, and writes nothing itself', () => {
    const { onRequestMoveBoundary, onRequestMerge } = renderDraggable()
    pressBoundary()
    fireEvent.mouseMove(window, { buttons: 1, clientY: yAtDepth(4.8) })
    fireEvent.mouseUp(window, { clientY: yAtDepth(4.8) })
    expect(onRequestMoveBoundary).toHaveBeenCalledTimes(1)
    const [upper, lower, newDepth, preDrag] = onRequestMoveBoundary.mock.calls[0]
    expect(upper).toBe('band-1')
    expect(lower).toBe('band-2')
    expect(newDepth).toBeCloseTo(4.8, 5)
    expect(preDrag).toBeCloseTo(4, 5)
    expect(onRequestMerge).not.toHaveBeenCalled()
  })

  it('GS21 — releasing unmoved fires nothing', () => {
    const { onRequestMoveBoundary, onRequestMerge } = renderDraggable()
    pressBoundary()
    fireEvent.mouseUp(window, { clientY: yAtDepth(4) })
    expect(onRequestMoveBoundary).not.toHaveBeenCalled()
    expect(onRequestMerge).not.toHaveBeenCalled()
  })

  it('GS22 — squeezing a band into the absorb zone shows the merge hint over it', () => {
    renderDraggable()
    pressBoundary()
    // band-1 is 2 m thick -> threshold 0.3 m remaining; 2.2 m leaves 0.2 m.
    fireEvent.mouseMove(window, { buttons: 1, clientY: yAtDepth(2.2) })
    expect(screen.getByTestId('geotech-drag-absorb-hint')).toBeTruthy()
  })

  it('GS23 — releasing in the absorb zone asks for the MERGE, at the pre-drag boundary', () => {
    const { onRequestMoveBoundary, onRequestMerge } = renderDraggable()
    pressBoundary()
    fireEvent.mouseMove(window, { buttons: 1, clientY: yAtDepth(2.2) })
    fireEvent.mouseUp(window, { clientY: yAtDepth(2.2) })
    expect(onRequestMerge).toHaveBeenCalledWith('band-1', 'band-2', 4)
    expect(onRequestMoveBoundary).not.toHaveBeenCalled()
  })

  it('GS24 — Escape abandons the drag; the release then does nothing', () => {
    const { onRequestMoveBoundary } = renderDraggable()
    pressBoundary()
    fireEvent.mouseMove(window, { buttons: 1, clientY: yAtDepth(4.8) })
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.mouseUp(window, { clientY: yAtDepth(4.8) })
    expect(onRequestMoveBoundary).not.toHaveBeenCalled()
    expect(screen.queryByTestId('geotech-drag-preview-line')).toBeNull()
  })

  it('GS25 — suspension mid-drag cancels it (correlate mode owns the canvas)', () => {
    const { onRequestMoveBoundary, rerender } = renderDraggable()
    pressBoundary()
    fireEvent.mouseMove(window, { buttons: 1, clientY: yAtDepth(4.8) })
    rerender({ suspended: true })
    fireEvent.mouseUp(window, { clientY: yAtDepth(4.8) })
    expect(onRequestMoveBoundary).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// GS28+ — remove a band = merge it into a neighbour (delete is an absorb)
// ---------------------------------------------------------------------------

describe('removing a band absorbs it into the neighbour the owner names', () => {
  it('GS28 — "merge into band above" fires the upper pair at their boundary', () => {
    const { onRequestMerge } = renderDraggable()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(5),
    })
    fireEvent.click(screen.getByTestId('geotech-band-menu-remove-up'))
    expect(onRequestMerge).toHaveBeenCalledWith('band-1', 'band-2', 4)
  })

  it('GS29 — "merge into band below" fires the lower pair symmetrically', () => {
    const { onRequestMerge } = renderDraggable()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(5),
    })
    fireEvent.click(screen.getByTestId('geotech-band-menu-remove-down'))
    expect(onRequestMerge).toHaveBeenCalledWith('band-2', 'band-3', 6)
  })

  it('GS30 — the only band in its litho body offers no remove at all', () => {
    renderDraggable()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-4'), {
      clientY: yAtDepth(10),
    })
    expect(screen.queryByTestId('geotech-band-menu-remove-up')).toBeNull()
    expect(screen.queryByTestId('geotech-band-menu-remove-down')).toBeNull()
  })

  it('GS31 — the topmost band of a body offers only the downward absorb', () => {
    renderDraggable()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-1'), {
      clientY: yAtDepth(3),
    })
    expect(screen.queryByTestId('geotech-band-menu-remove-up')).toBeNull()
    expect(screen.getByTestId('geotech-band-menu-remove-down')).toBeTruthy()
  })
})

describe('the small enclosed lens gets a suggestion, never a gesture of its own', () => {
  // The system POINTS, the engineer ACTS (assisted-manual, the litho philosophy):
  // a passive badge marks a thin band whose neighbours share a class, and the
  // band menu offers "Merge into surrounding band" — one absorb over the run.
  // f-band-1 / f-band-3 read class 8 around f-band-2's class 5, so band-2
  // (4-6 m, 2 m thick) is the enclosed lens of this fixture.
  const NAD_CLASSES = new Map<string, number | null>([
    ['f-band-1', 8],
    ['f-band-2', 5],
    ['f-band-3', 8],
    ['f-band-4', 7],
  ])

  function renderWithLens(smallLensThicknessM: number): ReturnType<typeof vi.fn> {
    const onRequestAbsorbLens = vi.fn()
    renderOverlay({
      nadClassByFormationId: NAD_CLASSES,
      smallLensThicknessM,
      onRequestAbsorbLens,
    })
    return onRequestAbsorbLens
  }

  it('GS32 - a qualifying lens shows a badge that can swallow no pointer event', () => {
    renderWithLens(2.0) // band-2 is exactly 2 m: at the pref, small enough
    const badge = screen.getByTestId('geotech-lens-badge-band-2')
    expect(badge.getAttribute('pointer-events')).toBe('none')
  })

  it('GS33 - a lens thicker than the model pref gets no badge; nor does any band without class data', () => {
    renderWithLens(0.35)
    expect(screen.queryByTestId('geotech-lens-badge-band-2')).toBeNull()
    cleanup()
    // No class map wired at all: the affordance simply does not exist.
    const onRequestAbsorbLens = vi.fn()
    renderOverlay({ smallLensThicknessM: 2.0, onRequestAbsorbLens })
    expect(screen.queryByTestId('geotech-lens-badge-band-2')).toBeNull()
  })

  it('GS34 - the band menu offers the absorb regardless of the size gate, and fires the run', () => {
    // 0.35 m pref: no badge - but the enclosure is still real, so the menu names it.
    const onRequestAbsorbLens = renderWithLens(0.35)
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(5),
    })
    fireEvent.click(screen.getByTestId('geotech-band-menu-absorb-lens'))
    expect(onRequestAbsorbLens).toHaveBeenCalledWith('band-1', 'band-2', 'band-3', 4, 6)
  })

  it('GS35 - a band that is not an enclosed lens gets no absorb item', () => {
    renderWithLens(2.0)
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-1'), {
      clientY: yAtDepth(3),
    })
    expect(screen.queryByTestId('geotech-band-menu-absorb-lens')).toBeNull()
  })
})

describe('the release asks for exactly one preview, however React re-runs it', () => {
  // React re-runs state updaters (StrictMode does it deliberately, twice) on
  // the promise that they are pure. A network call fired from inside one is
  // therefore not fired once — it is fired once per invocation. Two previews
  // for one release is the visible symptom; the rule the codebase keeps is
  // that an updater computes state and nothing else.
  it('GS36 — a drag release under StrictMode previews the move once, not twice', () => {
    const onRequestMoveBoundary = vi.fn()
    render(
      <React.StrictMode>
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
            onRequestMoveBoundary={onRequestMoveBoundary}
          />
        </svg>
      </React.StrictMode>,
    )
    const strip = screen.getByTestId('geotech-band-boundary-band-1')
    fireEvent.mouseDown(strip, { button: 0, clientY: yAtDepth(4) })
    fireEvent.mouseMove(window, { clientY: yAtDepth(4.9), buttons: 1 })
    fireEvent.mouseUp(window)
    expect(onRequestMoveBoundary).toHaveBeenCalledTimes(1)
  })
})

describe('the menu closes the ways a menu is expected to close', () => {
  // The litho band menu already learned this the hard way: the owner reported
  // "sometimes i get this random add new suggestion here box when zooming or
  // so", so ContactsLayer dismisses on wheel as well as Escape. A menu pinned
  // to stale screen coordinates while the section scrolls underneath is the
  // same bug, and Escape is baseline muscle memory from every CAD tool this
  // engineer uses.
  it('GS37 - Escape closes the band menu', () => {
    renderOverlay()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(4.75),
    })
    expect(screen.getByTestId('geotech-band-edit-menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('geotech-band-edit-menu')).toBeNull()
  })

  it('GS38 - zooming the section closes the band menu instead of stranding it', () => {
    renderOverlay()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-hit-band-2'), {
      clientY: yAtDepth(4.75),
    })
    fireEvent.wheel(document, { deltaY: -120 })
    expect(screen.queryByTestId('geotech-band-edit-menu')).toBeNull()
  })

  it('GS39 - Escape closes the boundary menu too', () => {
    renderOverlay()
    fireEvent.contextMenu(screen.getByTestId('geotech-band-boundary-band-1'))
    expect(screen.getByTestId('geotech-band-edit-menu')).toBeTruthy()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByTestId('geotech-band-edit-menu')).toBeNull()
  })
})

describe('the live gesture chrome survives the dark theme', () => {
  // SVG attributes cannot use Tailwind dark: variants, which is why the
  // --section-* token family exists (index.css). Painting the drag line and
  // its readout in slate-900 put them on slate-800 in dark mode: the same
  // ~1:1 invisibility the ColumnGlyph tokens were introduced to fix. The
  // colours must come from themed tokens, not literals.
  it('GS40 - the drag preview line and readout are themed, not hardcoded slate-900', () => {
    renderOverlay({ onRequestMoveBoundary: vi.fn() })
    const strip = screen.getByTestId('geotech-band-boundary-band-1')
    fireEvent.mouseDown(strip, { button: 0, clientY: yAtDepth(4) })
    fireEvent.mouseMove(window, { clientY: yAtDepth(4.5), buttons: 1 })

    const line = screen.getByTestId('geotech-drag-preview-line')
    expect(line.getAttribute('stroke')).toContain('var(--section-edit')
    const readout = screen.getByTestId('geotech-drag-depth-readout')
    expect(readout.getAttribute('fill')).toContain('var(--section-edit')
  })

  it('GS41 - the split placement chrome is themed the same way', () => {
    renderOverlay()
    armSplitAt(4.75)
    const line = screen.getByTestId('geotech-split-preview-line')
    expect(line.getAttribute('stroke')).toContain('var(--section-edit')
    const readout = screen.getByTestId('geotech-split-depth-readout')
    expect(readout.getAttribute('fill')).toContain('var(--section-edit')
  })
})

describe('two boundaries close together each keep their own press', () => {
  it('GS42 — two boundaries closer than the strip height do not overlap', () => {
    // Bands 4.0–4.2 and 4.2–4.4 at 10 px/m are 2 px apart. Two 10 px strips
    // centred on them would overlap almost entirely, and the deeper one would
    // win every press — the engineer aims at one boundary and drags the other.
    const layers = [
      layer('b1', 2, 4), layer('b2', 4, 4.2), layer('b3', 4.2, 4.4), layer('b4', 4.4, 8),
    ]
    render(
      <svg>
        <GeotechBandEditOverlay
          geotechLayers={layers}
          lithoLayers={LITHO_LAYERS}
          placedColumns={[COLUMN]}
          levelToScreen={levelToScreen}
          plotTop={0}
          plotBottom={2000}
          onRequestSplit={vi.fn()}
          onRequestMerge={vi.fn()}
          onRequestMoveBoundary={vi.fn()}
        />
      </svg>,
    )
    // A strip is keyed on the UPPER band of its pair, so b2's strip sits on 4.2 m
    // and b3's on 4.4 m.
    const rects = [
      { id: 'b2', boundaryDepthM: 4.2 },
      { id: 'b3', boundaryDepthM: 4.4 },
    ].map(({ id, boundaryDepthM }) => {
      const el = screen.getByTestId(`geotech-band-boundary-${id}`)
      const y = Number(el.getAttribute('y'))
      return {
        top: y,
        bottom: y + Number(el.getAttribute('height')),
        boundaryY: yAtDepth(boundaryDepthM),
      }
    })
    expect(rects[0].bottom).toBeLessThanOrEqual(rects[1].top)
    // …and each strip must still STRADDLE its own boundary. Non-overlap alone is
    // satisfied by giving every strip no height at all, which trades the wrong
    // boundary being dragged for no boundary being draggable — so the press has to
    // be catchable from both sides of the line the engineer is aiming at.
    for (const rect of rects) {
      expect(rect.top).toBeLessThan(rect.boundaryY)
      expect(rect.bottom).toBeGreaterThan(rect.boundaryY)
    }
  })
})

// ---------------------------------------------------------------------------
// GS43+ — the two boundary kinds must not look the same
// ---------------------------------------------------------------------------
//
// The owner dogfed this axis and reported "sometimes after merging, i can't grab
// the contact handles anymore". There was no bug: on his data one CPT column
// carries 17 internal boundaries of which only 3 are packing boundaries — the
// other 14 are lithostratigraphic contacts, which correctly refuse the drag.
// Rendered identically, "you may not drag this" is indistinguishable from "the
// drag is broken", so the difference has to be visible without trying it.

// GS43 / GS44 / GS48 / GS50 pinned a GRIP GLYPH beside every draggable boundary. The
// glyph is gone — the owner rejected it on dogfeed ("i thought we locked in solid and
// dashed lines, not these ugly marks on the right side"), and it was only carrying this
// job because the half of the design meant to carry it had not been built. The claim
// itself did not go away: it moved to the LINE, where the design put it, and is pinned
// by GS56-GS58 in ``GeotechBandEditOverlay.contactReach.test.tsx`` — the packing
// boundary is dashed and thinner, the restated contact solid and heavier. Those run
// against the real ContactsLayer, so they test what is actually drawn.

describe('a boundary says which kind it is before it is touched', () => {
  // GS45 / GS48 / GS49 pinned the padlock HERE, and all three passed while the padlock
  // was unreachable in the real app: they fired the hover on the glyph itself, which was
  // the one thing a user could not do — it rendered at opacity 0 and raised itself from
  // its own onMouseEnter. The owner found it in one minute of dogfeeding.
  //
  // The padlock now lives in ContactsLayer, raised by the grab strip the cursor is really
  // over. Its claims moved with it, to GS62-GS64 in the real-stack harness, where the
  // hover is fired on the strip and not on the thing being tested.

  it('GS50 — a right-click-only boundary still draws its strip, and no drag mark', () => {
    // With only the merge handler wired the strip is right-click-only: it owns no press
    // at all (GS17). Nothing beside it may advertise a drag. The grip that used to be
    // asserted here is gone entirely, so what is left to pin is that removing it did not
    // take the strip — and the boundary's own right-click — with it.
    renderOverlay() // onRequestMerge wired, onRequestMoveBoundary absent
    expect(screen.getByTestId('geotech-band-boundary-band-1')).toBeTruthy()
    expect(screen.queryByTestId('geotech-boundary-grip-band-1')).toBeNull()
  })
})

describe('a grab strip never reaches across a litho contact', () => {
  // The strips already share contested pixels with each OTHER (GS42). A litho
  // contact was not in that reckoning, so a packing boundary sitting a few px
  // from one kept its full half-height and lay across it — reaching into a
  // boundary this axis may not edit. A press aimed at the contact would land on
  // the packing boundary instead: the exact collision GS42 exists to prevent,
  // between the two kinds rather than within one.
  //
  // 8 m is where LITHO_LAYERS changes body, so it is a litho contact whichever
  // side the packing boundary is on.

  /** Render one column with a hand-written band stack and return its strip's extent. */
  function stripExtentOf(
    layers: LithoLayerResponse[],
    upperBandId: string,
  ): { top: number; bottom: number } {
    render(
      <svg>
        <GeotechBandEditOverlay
          geotechLayers={layers}
          lithoLayers={LITHO_LAYERS}
          placedColumns={[COLUMN]}
          levelToScreen={levelToScreen}
          plotTop={0}
          plotBottom={2000}
          onRequestSplit={vi.fn()}
          onRequestMerge={vi.fn()}
          onRequestMoveBoundary={vi.fn()}
        />
      </svg>,
    )
    const el = screen.getByTestId(`geotech-band-boundary-${upperBandId}`)
    const top = Number(el.getAttribute('y'))
    return { top, bottom: top + Number(el.getAttribute('height')) }
  }

  it('GS46 — a strip below a contact stops short of it, and stays grabbable', () => {
    // A packing boundary at 8.3 m is 3 px below the contact at this fixture's
    // scale — closer than the strip's own half-height.
    const { top, bottom } = stripExtentOf(
      [layer('c1', 2, 8), layer('c2', 8, 8.3), layer('c3', 8.3, 14)],
      'c2',
    )
    expect(top).toBeGreaterThanOrEqual(yAtDepth(8))
    // Non-overlap alone is satisfied by a strip with no height, which trades the
    // wrong boundary being grabbed for none being grabbable — so it must still
    // straddle the boundary the engineer is aiming at.
    expect(top).toBeLessThan(yAtDepth(8.3))
    expect(bottom).toBeGreaterThan(yAtDepth(8.3))
  })

  it('GS47 — and a strip above a contact stops short of it the same way', () => {
    // The mirror case: a packing boundary at 7.8 m, 2 px above the contact.
    const { top, bottom } = stripExtentOf(
      [layer('d1', 2, 7.8), layer('d2', 7.8, 8), layer('d3', 8, 14)],
      'd1',
    )
    expect(bottom).toBeLessThanOrEqual(yAtDepth(8))
    expect(top).toBeLessThan(yAtDepth(7.8))
    expect(bottom).toBeGreaterThan(yAtDepth(7.8))
  })
})

/** Open the borehole band's menu (the setClass menu, restructured 2026-09-13). */
function openBoreholeMenu(
  bandTestId = 'geotech-borehole-band-bh-band-1',
  clientY?: number,
): void {
  fireEvent.contextMenu(
    screen.getByTestId(bandTestId),
    clientY === undefined ? undefined : { clientY },
  )
}

/** Open the "Packing class ▸" submenu so the class buttons render (owner #35). */
function openPackingClassSubmenu(): void {
  fireEvent.click(screen.getByTestId('geotech-band-menu-packing-class'))
}

describe('a borehole band splits at the click, and its classes live in a submenu (owner #35)', () => {
  // Installer #35 dogfeed: a borehole band had NO split button ("there seems to
  // be no button in the right click menu"), and every packing class crowded the
  // first menu above the verbs. Now "Split band here" splits at the right-click
  // depth (the class is KEPT — a borehole has no qc to re-derive), and the
  // classes sit behind ONE "Packing class ▸" row so the verbs come first.
  const nadClasses = new Map<string, number | null>([
    ['f-bh-band-1', 6],
    ['f-bh-band-2', 7],
  ])
  const soilCodes = new Map<string, string | null>([
    ['f-bh-band-1', 'ZAND'],
    ['f-bh-band-2', 'ZAND'],
  ])

  it('split band here is offered on a borehole band too, and splits at the clicked depth', () => {
    const onRequestSplitHere = vi.fn()
    renderOverlay({
      geotechLayers: BOREHOLE_GEOTECH_LAYERS,
      lithoLayers: BOREHOLE_LITHO_LAYERS,
      placedColumns: [BOREHOLE_COLUMN],
      onRequestSetClass: vi.fn(),
      onRequestSplitHere,
      nadClassByFormationId: nadClasses,
      soilCodeByFormationId: soilCodes,
    })
    // bh-band-1 spans 2–5 m; right-click at 3.5 m places the split there.
    openBoreholeMenu('geotech-borehole-band-bh-band-1', yAtDepth(3.5))
    fireEvent.click(screen.getByTestId('geotech-band-menu-split-here'))
    expect(onRequestSplitHere).toHaveBeenCalledTimes(1)
    const [bandId, depthM] = onRequestSplitHere.mock.calls[0]
    expect(bandId).toBe('bh-band-1')
    expect(depthM).toBeCloseTo(3.5, 4)
  })

  it('statistieken van deze eenheid is on the borehole band menu and jumps with the unit (owner #37)', () => {
    // Owner installer #37: "i don't see the show in statistics stage anymore."
    // The verb belongs on the borehole band menu (its own setClass menu), not
    // only the CPT split menu.
    const onShowUnitStatistics = vi.fn()
    renderOverlay({
      geotechLayers: BOREHOLE_GEOTECH_LAYERS,
      lithoLayers: BOREHOLE_LITHO_LAYERS,
      placedColumns: [BOREHOLE_COLUMN],
      onRequestSetClass: vi.fn(),
      onRequestSplitHere: vi.fn(),
      nadClassByFormationId: nadClasses,
      soilCodeByFormationId: soilCodes,
      onShowUnitStatistics,
    })
    openBoreholeMenu('geotech-borehole-band-bh-band-1', yAtDepth(3.5))
    fireEvent.click(screen.getByTestId('geotech-band-menu-unit-statistics'))
    expect(onShowUnitStatistics).toHaveBeenCalledWith('f-bh-band-1', null)
  })

  it('the classes live in a submenu, the verbs come first', () => {
    renderOverlay({
      geotechLayers: BOREHOLE_GEOTECH_LAYERS,
      lithoLayers: BOREHOLE_LITHO_LAYERS,
      placedColumns: [BOREHOLE_COLUMN],
      onRequestSetClass: vi.fn(),
      onRequestSplitHere: vi.fn(),
      nadClassByFormationId: nadClasses,
      soilCodeByFormationId: soilCodes,
    })
    openBoreholeMenu()
    // The verb + the packing-class ROW are on the first menu; the class buttons
    // are NOT — they are behind the row until it is opened.
    expect(screen.getByTestId('geotech-band-menu-split-here')).toBeTruthy()
    expect(screen.getByTestId('geotech-band-menu-packing-class')).toBeTruthy()
    expect(screen.queryByTestId('geotech-band-menu-set-class-5')).toBeNull()
    // Opening the submenu reveals the soil family (5..12), never a clay class.
    openPackingClassSubmenu()
    expect(screen.getByTestId('geotech-band-menu-set-class-5')).toBeTruthy()
    expect(screen.getByTestId('geotech-band-menu-set-class-12')).toBeTruthy()
    expect(screen.queryByTestId('geotech-band-menu-set-class-21')).toBeNull()
  })

  it('the packing-class row names the current class, and choosing one still fires setClass', () => {
    const onRequestSetClass = vi.fn()
    renderOverlay({
      geotechLayers: BOREHOLE_GEOTECH_LAYERS,
      lithoLayers: BOREHOLE_LITHO_LAYERS,
      placedColumns: [BOREHOLE_COLUMN],
      onRequestSetClass,
      nadClassByFormationId: nadClasses,
      soilCodeByFormationId: soilCodes,
    })
    openBoreholeMenu()
    expect(screen.getByTestId('geotech-band-menu-packing-class').textContent).toContain(
      nadCompactLabel(6),
    )
    openPackingClassSubmenu()
    const current = screen.getByTestId('geotech-band-menu-set-class-6') as HTMLButtonElement
    expect(current.disabled).toBe(true)
    fireEvent.click(screen.getByTestId('geotech-band-menu-set-class-8'))
    expect(onRequestSetClass).toHaveBeenCalledWith('bh-band-1', 8, 6)
  })

  it('arrow keys open and close the submenu', () => {
    renderOverlay({
      geotechLayers: BOREHOLE_GEOTECH_LAYERS,
      lithoLayers: BOREHOLE_LITHO_LAYERS,
      placedColumns: [BOREHOLE_COLUMN],
      onRequestSetClass: vi.fn(),
      nadClassByFormationId: nadClasses,
      soilCodeByFormationId: soilCodes,
    })
    openBoreholeMenu()
    const row = screen.getByTestId('geotech-band-menu-packing-class')
    fireEvent.keyDown(row, { key: 'ArrowRight' })
    expect(screen.getByTestId('geotech-band-menu-set-class-5')).toBeTruthy()
    fireEvent.keyDown(row, { key: 'ArrowLeft' })
    expect(screen.queryByTestId('geotech-band-menu-set-class-5')).toBeNull()
  })

  it('a CPT band never gets the borehole menu — its class is measured', () => {
    renderOverlay({
      onRequestSetClass: vi.fn(),
      onRequestSplitHere: vi.fn(),
      nadClassByFormationId: new Map([['f-band-1', 6]]),
      soilCodeByFormationId: new Map([['f-band-1', 'ZAND']]),
    })
    expect(screen.queryByTestId('geotech-borehole-band-band-1')).toBeNull()
  })

  it('without any borehole handler the band stays view-only', () => {
    renderOverlay({
      geotechLayers: BOREHOLE_GEOTECH_LAYERS,
      lithoLayers: BOREHOLE_LITHO_LAYERS,
      placedColumns: [BOREHOLE_COLUMN],
      nadClassByFormationId: nadClasses,
      soilCodeByFormationId: soilCodes,
    })
    expect(screen.queryByTestId('geotech-borehole-band-bh-band-1')).toBeNull()
  })
})

describe('the class submenu is built from the band\'s SOIL (owner ruling 2026-08-26)', () => {
  // "no a zand body can never carry a silt packing class" — "the nad coupling
  // is absolute". The menu used to be built from the band's CURRENT class, so
  // a sand band that had been stamped with a silt class offered only more silt
  // classes: the one state that needs correcting was the one state the UI
  // could not correct.
  const SAND_SOIL = new Map<string, string | null>([
    ['f-bh-band-1', 'ZAND'],
    ['f-bh-band-2', 'ZAND'],
  ])

  function openMenuOnFirstBand(
    nadClassByFormationId: Map<string, number | null>,
  ): ReturnType<typeof vi.fn> {
    const onRequestSetClass = vi.fn()
    renderOverlay({
      geotechLayers: BOREHOLE_GEOTECH_LAYERS,
      lithoLayers: BOREHOLE_LITHO_LAYERS,
      placedColumns: [BOREHOLE_COLUMN],
      onRequestSetClass,
      nadClassByFormationId,
      soilCodeByFormationId: SAND_SOIL,
    })
    fireEvent.contextMenu(screen.getByTestId('geotech-borehole-band-bh-band-1'))
    // The classes moved into a submenu (owner #35) — open it so the S-cases can
    // assert on the class buttons exactly as they did when the list was flat.
    openPackingClassSubmenu()
    return onRequestSetClass
  }

  it('S1 — a sand band wrongly carrying a SILT class still offers the SAND family', () => {
    // The owner's case: NAD 14 on a ZAND unit. The menu must be the way back.
    openMenuOnFirstBand(new Map([['f-bh-band-1', 14]]))
    expect(screen.getByTestId('geotech-band-menu-set-class-5')).toBeTruthy()
    expect(screen.getByTestId('geotech-band-menu-set-class-12')).toBeTruthy()
    expect(screen.queryByTestId('geotech-band-menu-set-class-21')).toBeNull()
  })

  it('S2 — the stranger class is shown too, flagged, so the state is visible', () => {
    openMenuOnFirstBand(new Map([['f-bh-band-1', 14]]))
    const stranger = screen.getByTestId('geotech-band-menu-set-class-14')
    expect(stranger).toBeTruthy()
    // It names its own (wrong) family, so the engineer reads WHY it is flagged
    // rather than seeing an unexplained mark.
    expect(stranger.textContent).toContain('SILT')
    expect(stranger.getAttribute('data-foreign-class')).toBe('true')
  })

  it('S3 — choosing an own-family class heals the stranger', () => {
    const onRequestSetClass = openMenuOnFirstBand(new Map([['f-bh-band-1', 14]]))
    fireEvent.click(screen.getByTestId('geotech-band-menu-set-class-7'))
    expect(onRequestSetClass).toHaveBeenCalledWith('bh-band-1', 7, 14)
  })

  it('S4 — an UNCLASSIFIED band is hand-settable, because that is now a real state', () => {
    // The soil-family clamp answers "not yet classified" wherever the only
    // evidence belonged to another soil. Those bands are the ones an engineer
    // most needs to set, so they must not be the ones with no menu.
    const onRequestSetClass = openMenuOnFirstBand(new Map([['f-bh-band-1', null]]))
    expect(screen.getByTestId('geotech-band-menu-set-class-6')).toBeTruthy()
    fireEvent.click(screen.getByTestId('geotech-band-menu-set-class-6'))
    expect(onRequestSetClass).toHaveBeenCalledWith('bh-band-1', 6, null)
  })

  it('S5 — an own-family class stays inert and unflagged, exactly as before', () => {
    openMenuOnFirstBand(new Map([['f-bh-band-1', 6]]))
    const current = screen.getByTestId('geotech-band-menu-set-class-6') as HTMLButtonElement
    expect(current.disabled).toBe(true)
    expect(current.getAttribute('data-foreign-class')).toBeNull()
    expect(screen.queryByTestId('geotech-band-menu-set-class-14')).toBeNull()
  })

  it('S6 — a band whose soil the norm table does not know gets no menu, not a guess', () => {
    const onRequestSetClass = vi.fn()
    renderOverlay({
      geotechLayers: BOREHOLE_GEOTECH_LAYERS,
      lithoLayers: BOREHOLE_LITHO_LAYERS,
      placedColumns: [BOREHOLE_COLUMN],
      onRequestSetClass,
      nadClassByFormationId: new Map([['f-bh-band-1', 6]]),
      soilCodeByFormationId: new Map([['f-bh-band-1', 'SCHIST']]),
    })
    expect(screen.queryByTestId('geotech-borehole-band-bh-band-1')).toBeNull()
  })
})
