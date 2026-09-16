// Behavioral net for LithoSuggestionGhostColumns (Phase 1 litho accept flow).
//
// Claims pinned here:
//   G1  Normal pending layer renders with the lithology fill colour and no
//       amber stroke (spans_boundary = false).
//   G2  A straddle layer (spans_boundary = true) renders with an amber stroke
//       and a dashed strokeDasharray so the engineer sees a visual warning
//       before accepting.
//   G3  The tooltip for a straddle layer contains the straddle warning text.
//   G4  The tooltip shows the parent formation name when formations are
//       provided and parent_formation_id is set.
//   G5  The confidence appears in the tooltip for every layer.
//   G6  Renders null when surfaceElevationM is null (cannot place layers).
//   G7  Renders null when suggestions array is empty.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GeologicalFormationResponse, LithoLayerSuggestion } from '../../api/client'
import type { PlacedColumn } from './utils'
import LithoSuggestionGhostColumns from './LithoSuggestionGhostColumns'

// ---------------------------------------------------------------------------
// Factories
// ---------------------------------------------------------------------------

function makeSuggestion(overrides: Partial<LithoLayerSuggestion> = {}): LithoLayerSuggestion {
  return {
    depth_top_m: 0,
    depth_base_m: 2,
    suggested_lithology: 'ZAND',
    suggested_nad_class: null,
    mean_qc_mpa: null,
    dr_pct: null,
    confidence: 'high',
    source: 'robertson2015',
    suggested_admixtures: [],
    parent_formation_id: null,
    spans_boundary: false,
    ...overrides,
  }
}

/** A minimal PlacedColumn that puts the investigation at x=200. */
function makeColumn(id: string): PlacedColumn {
  // ``kind`` lives on the column, not on proj.item — needed for the
  // drag readout's "is this a CPT?" gate (V5).
  return {
    kind: 'cpt',
    nudgedX: 200,
    width: 40,
    proj: {
      along: 200,
      distance: 0,
      item: { id, kind: 'cpt', name: 'CPT-1' } as unknown as PlacedColumn['proj']['item'],
    },
  } as unknown as PlacedColumn
}

function makeFormation(id: string, name: string): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    color: '#aabbcc',
    code: null,
    display_order: 0,
    lithology: 'ZAND',
    nad_class: null,
    regional_ref: null,
    description: null,
    pinned_order: false,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/**
 * A simple linear levelToScreen: at elevation 0 → y=500, at elevation 5 → y=0.
 * So depth 0–2m with surface=5m → mTAW 5–3 → y=0–200 (well within plotTop=0/plotBottom=600).
 */
const levelToScreen = (level: number): number => 500 - level * 100

function renderGhost(
  suggestions: readonly LithoLayerSuggestion[],
  opts: {
    surfaceElevationM?: number | null
    formations?: readonly GeologicalFormationResponse[]
    investigationId?: string
    acceptedIndices?: ReadonlySet<number>
    rejectedIndices?: ReadonlySet<number>
    edits?: ReadonlyMap<
      number,
      {
        depth_top_m?: number
        depth_base_m?: number
        suggested_lithology?: string
        suggested_admixtures?: readonly { soil_code: string; amount: string; locally: boolean }[]
      }
    >
    onEdit?: (
      idx: number,
      edit: {
        depth_top_m?: number
        depth_base_m?: number
        suggested_lithology?: string
        suggested_admixtures?: readonly { soil_code: string; amount: string; locally: boolean }[]
      },
    ) => void
    onReject?: (idx: number) => void
    onAccept?: (idx: number) => void
    onCrossColumnPaste?: (
      targetAnchorId: string,
      idx: number,
      edit: {
        suggested_lithology: string
        suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
      },
    ) => void
    onInsertLayer?: (
      afterIdx: number,
      composition: {
        suggested_lithology: string
        suggested_admixtures: readonly { soil_code: string; amount: string; locally: boolean }[]
      },
    ) => void
    onSplitLayer?: (idx: number) => void
    onMergeLayers?: (upperIdx: number) => void
    cptPlotByAnchorId?: ReadonlyMap<
      string,
      {
        depths_m: readonly number[]
        qc_mpa: readonly number[]
        rf_pct: readonly (number | null)[] | null
      }
    >
  } = {},
) {
  const id = opts.investigationId ?? 'cpt-1'
  // Explicit check for undefined so null is passed through as-is (not coalesced to 5).
  const elevation = opts.surfaceElevationM !== undefined ? opts.surfaceElevationM : 5
  return render(
    <svg>
      <LithoSuggestionGhostColumns
        columns={[makeColumn(id)]}
        investigationId={id}
        suggestions={suggestions}
        levelToScreen={levelToScreen}
        surfaceElevationM={elevation}
        plotTop={0}
        plotBottom={600}
        bandHalfWidth={20}
        acceptedIndices={opts.acceptedIndices ?? new Set()}
        rejectedIndices={opts.rejectedIndices ?? new Set()}
        onAccept={opts.onAccept ?? vi.fn()}
        onReject={opts.onReject ?? vi.fn()}
        formations={opts.formations}
        edits={opts.edits}
        onEdit={opts.onEdit}
        onCrossColumnPaste={opts.onCrossColumnPaste}
        onInsertLayer={opts.onInsertLayer}
        onSplitLayer={opts.onSplitLayer}
        onMergeLayers={opts.onMergeLayers}
        cptPlotByAnchorId={opts.cptPlotByAnchorId}
      />
    </svg>,
  )
}

afterEach(() => {
  cleanup()
})

describe('LithoSuggestionGhostColumns', () => {
  // G1: normal (non-straddle) layer — no amber stroke.
  it('G1 — normal pending layer has no amber stroke', () => {
    const { container } = renderGhost([makeSuggestion({ spans_boundary: false })])
    const rect = container.querySelector('rect')
    expect(rect).not.toBeNull()
    // Amber-600 is #d97706; a non-straddle layer must not have it.
    expect(rect!.getAttribute('stroke')).not.toBe('#d97706')
    // No dashed stroke on a normal layer.
    expect(rect!.getAttribute('strokeDasharray')).toBeNull()
  })

  // G2: straddle layer (spans_boundary=true) has amber stroke + dasharray.
  it('G2 — straddle layer has amber dashed stroke', () => {
    const { container } = renderGhost([makeSuggestion({ spans_boundary: true })])
    const rect = container.querySelector('rect')
    expect(rect).not.toBeNull()
    expect(rect!.getAttribute('stroke')).toBe('#d97706')
    expect(rect!.getAttribute('stroke-dasharray')).toBeTruthy()
  })

  // G3: straddle tooltip contains the warning text.
  it('G3 — straddle tooltip contains straddle warning', () => {
    const { container } = renderGhost([makeSuggestion({ spans_boundary: true })])
    const title = container.querySelector('title')
    expect(title).not.toBeNull()
    expect(title!.textContent).toMatch(/straddles formation boundary/i)
  })

  // G4: tooltip shows parent formation name when formations are provided.
  it('G4 — tooltip shows parent formation name', () => {
    const formations = [makeFormation('f-1', 'Boom Klei')]
    const suggestion = makeSuggestion({ parent_formation_id: 'f-1' })
    const { container } = renderGhost([suggestion], { formations })
    // The first <title> is on the <rect> element.
    const rects = container.querySelectorAll('rect')
    const titles = Array.from(rects).map(r => r.querySelector('title')?.textContent ?? '')
    expect(titles.some(t => t.includes('Boom Klei'))).toBe(true)
  })

  // G5: tooltip includes the confidence value.
  it('G5 — tooltip contains the confidence level', () => {
    const { container } = renderGhost([makeSuggestion({ confidence: 'medium' })])
    const title = container.querySelector('title')
    expect(title!.textContent).toContain('medium')
  })

  // G6: returns null when surfaceElevationM is null.
  it('G6 — renders nothing when surfaceElevationM is null', () => {
    const { container } = renderGhost([makeSuggestion()], { surfaceElevationM: null })
    expect(container.querySelector('[data-testid="litho-suggestion-ghosts"]')).toBeNull()
  })

  // G7: returns null when suggestions is empty.
  it('G7 — renders nothing when suggestions is empty', () => {
    const { container } = renderGhost([])
    expect(container.querySelector('[data-testid="litho-suggestion-ghosts"]')).toBeNull()
  })

  // G8: overlay positioning (2026-05-20 owner directive). The ghost
  // column overlays the focused investigation's data band — never sits
  // to the left or right of it — so it can't overlap a neighbouring
  // test at dense column spacing. With nudgedX=200, bandHalfWidth=20,
  // every layer rect must start at x=180 and span width=40.
  it('G8 — overlay starts at nudgedX - bandHalfWidth and spans the full band', () => {
    const { container } = renderGhost([makeSuggestion()])
    const rect = container.querySelector('rect')
    expect(rect).not.toBeNull()
    expect(rect!.getAttribute('x')).toBe('180')
    expect(rect!.getAttribute('width')).toBe('40')
  })

  // G9: drag-edge handles render only when onEdit is wired AND the
  // layer is still pending. The hit zones are testid'd so we can
  // assert their presence without inspecting layout.
  it('G9 — drag handles render for pending layers when onEdit is wired', () => {
    const { container } = renderGhost([makeSuggestion()], { onEdit: vi.fn() })
    expect(container.querySelector('[data-testid="litho-drag-top-0"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="litho-drag-base-0"]')).not.toBeNull()
  })

  it('G10 — drag handles are omitted when onEdit is missing (read-only ghosts)', () => {
    const { container } = renderGhost([makeSuggestion()]) // onEdit undefined
    expect(container.querySelector('[data-testid="litho-drag-top-0"]')).toBeNull()
    expect(container.querySelector('[data-testid="litho-drag-base-0"]')).toBeNull()
  })

  it('G11 — drag handles are omitted for accepted layers', () => {
    const { container } = renderGhost([makeSuggestion()], {
      onEdit: vi.fn(),
      acceptedIndices: new Set([0]),
    })
    expect(container.querySelector('[data-testid="litho-drag-top-0"]')).toBeNull()
  })

  it('G12 — mousedown→mouseup on top handle fires onEdit with depth_top_m', () => {
    // Test levelToScreen has pxPerM = 100 (slope of the linear
    // transform). Drag 100 px down → depth delta = 1.0 m.
    // Layer top starts at depth 0 → after drag, depth_top_m = 1.0.
    // (Pre-#83 this test dragged past own base = 2 m to assert
    // depth_top_m = 2.5; the new hard clamp correctly prevents the
    // inverted layer that would create. 1.0 m stays within bounds
    // and still exercises the top-edge depth-commit contract.)
    const onEdit = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')
    expect(topHandle).not.toBeNull()
    fireEvent.mouseDown(topHandle!, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 200 })
    fireEvent.mouseUp(document)
    expect(onEdit).toHaveBeenCalledTimes(1)
    const [idx, edit] = onEdit.mock.calls[0]
    expect(idx).toBe(0)
    expect(edit.depth_top_m).toBeCloseTo(1.0, 5)
    expect(edit.depth_base_m).toBeUndefined()
  })

  it('G14 — accepted ghost layer is not rendered (debt #142)', () => {
    // Pins the dogfeed 2026-05-27 follow-up to the earlier 2026-05-20
    // pointer-events fix.  Once accepted, the committed FormationContact
    // takes over as the source of truth; the ghost rect previously
    // stayed at the raw suggestion depth and read as a phantom contact
    // after the committed one was dragged.  Hiding the layer entirely
    // makes the committed contact stand alone AND preserves the
    // original click-through property (no rect = nothing to intercept
    // clicks aimed at the underlying ContactPickBar).
    const { container } = renderGhost([makeSuggestion()], {
      acceptedIndices: new Set([0]),
    })
    // The accepted layer's rect, drag handles, and tick are all gone.
    // The pattern <defs> remains (cheap) and the column header text
    // also renders.  Use the anchor-id stamp to detect the layer rect.
    expect(
      container.querySelector('rect[data-litho-anchor-id]'),
    ).toBeNull()
    expect(container.querySelector('[data-testid="litho-pending-hatch-0"]')).toBeNull()
  })

  it('G14b — pending ghost layer wears the hatching overlay (debt #142)', () => {
    const { container } = renderGhost([makeSuggestion()], {
      // No acceptedIndices / rejectedIndices → pending.
    })
    expect(container.querySelector('[data-testid="litho-pending-hatch-0"]')).not.toBeNull()
  })

  it('G14c — rejected ghost layer renders NOTHING (dogfeed 2026-05-31 cleanup)', () => {
    // Earlier iteration kept the rejected rect on screen with hatching
    // suppressed + a ↻ undo icon. Owner directive 2026-05-31: hide the
    // rejected band entirely — no band, no cross-out, no undo icon.
    // Re-insertion is via right-click → Insert layer if needed.  The
    // rejected state stays in memory (drag clamps + bound walkers
    // consult it), only the rendering is hidden.
    const { container } = renderGhost([makeSuggestion()], {
      rejectedIndices: new Set([0]),
    })
    // No rect for the rejected layer.
    expect(container.querySelector('[data-testid="litho-band-group-0"] rect')).toBeNull()
    // No pending hatch, no reject (×) icon.
    expect(container.querySelector('[data-testid="litho-pending-hatch-0"]')).toBeNull()
    expect(container.querySelector('[data-testid="litho-reject-0"]')).toBeNull()
  })

  it('G16 — shared boundary: dragging interior layer top fires onEdit on BOTH dragged + above', () => {
    // Owner directive 2026-05-20 (reversal of the earlier independent-
    // edges design). Dragging layer 1's TOP edge = the boundary between
    // layer 0 and layer 1. Both layers' touching edges must move
    // together so the join stays one boundary (no whitespace, no
    // overlap). The drag commit fires onEdit twice: depth_top_m on
    // layer 1 + depth_base_m on layer 0, both at the same depth.
    const onEdit = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-1"]')
    expect(topHandle).not.toBeNull()
    fireEvent.mouseDown(topHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 250 })
    fireEvent.mouseUp(document)
    expect(onEdit).toHaveBeenCalledTimes(2)
    // First call moves layer 1's top.
    expect(onEdit.mock.calls[0][0]).toBe(1)
    expect(onEdit.mock.calls[0][1].depth_top_m).toBeCloseTo(2.5, 5)
    // Second call moves layer 0's base to match.
    expect(onEdit.mock.calls[1][0]).toBe(0)
    expect(onEdit.mock.calls[1][1].depth_base_m).toBeCloseTo(2.5, 5)
  })

  it('G17 — shared boundary: dragging interior layer base fires onEdit on BOTH dragged + below', () => {
    // Pending-adjacent base-drag DOWN moves the shared boundary
    // deeper — layer 0 grows, layer 1 shrinks from above. This is
    // the standard resize gesture; the #83 v1.2 fix (regime split)
    // preserves it for pending-adjacent while clamping at NEAR edge
    // for the rejected-gap-fill case (G34) and accepted barriers (G30).
    const onEdit = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 250 })
    fireEvent.mouseUp(document)
    expect(onEdit).toHaveBeenCalledTimes(2)
    expect(onEdit.mock.calls[0][0]).toBe(0)
    expect(onEdit.mock.calls[0][1].depth_base_m).toBeCloseTo(2.5, 5)
    expect(onEdit.mock.calls[1][0]).toBe(1)
    expect(onEdit.mock.calls[1][1].depth_top_m).toBeCloseTo(2.5, 5)
  })

  it('G18 — outer edges (idx=0 top, last idx base) fire only ONE onEdit (no adjacent)', () => {
    // The suggestion list's outer boundary has no adjacent layer to
    // share — only the dragged edge updates. Top edge of layer 0:
    // no layer above. Base edge of last layer: no layer below.
    const onEdit = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit },
    )
    // Drag layer 0's top (outer edge, no above-neighbour).
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')
    fireEvent.mouseDown(topHandle!, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 110 })
    fireEvent.mouseUp(document)
    expect(onEdit).toHaveBeenCalledTimes(1)
    expect(onEdit.mock.calls[0][0]).toBe(0)
  })

  it('G19 — dbl-click on a pending layer accepts the suggestion', () => {
    // Owner directive 2026-05-22: accept is the dbl-click gesture (off
    // the single click, which used to accept and was a misclick risk).
    const onAccept = vi.fn()
    const { container } = renderGhost([makeSuggestion()], { onAccept })
    const rect = container.querySelector('rect') as SVGRectElement
    fireEvent.doubleClick(rect)
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onAccept.mock.calls[0][0]).toBe(0)
  })

  it('G20 — single-click on a pending layer does not accept', () => {
    // The single click is intentionally inert now — only dbl-click
    // (or the context-menu item) commits a contact.
    const onAccept = vi.fn()
    const { container } = renderGhost([makeSuggestion()], { onAccept })
    const rect = container.querySelector('rect') as SVGRectElement
    fireEvent.click(rect)
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('G21 — right-click on pending layer opens context menu, not direct reject', () => {
    // Dogfeed 2026-05-20: users expect right-click to open a menu of
    // options (edit composition / reject), not destroy the suggestion
    // outright. Pin the new gesture: right-click opens the menu;
    // onReject is NOT called unless the user picks "Reject layer".
    const onReject = vi.fn()
    const { container } = renderGhost([makeSuggestion()], {
      onReject,
      onEdit: vi.fn(), // wire onEdit so the Edit composition menu item renders
    })
    const rect = container.querySelector('rect') as SVGRectElement
    fireEvent.contextMenu(rect, { clientX: 100, clientY: 50 })
    // Menu rendered (via portal at document.body).
    expect(screen.getByRole('menu', { name: /ghost layer actions/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /edit composition/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /reject layer/i })).toBeInTheDocument()
    // onReject must NOT fire yet — only when the user picks the menu item.
    expect(onReject).not.toHaveBeenCalled()
  })

  it('G22 — context menu "Reject layer" item fires onReject and closes the menu', () => {
    const onReject = vi.fn()
    const { container } = renderGhost([makeSuggestion()], {
      onReject,
      onEdit: vi.fn(),
    })
    const rect = container.querySelector('rect') as SVGRectElement
    fireEvent.contextMenu(rect, { clientX: 100, clientY: 50 })
    fireEvent.click(screen.getByRole('button', { name: /reject layer/i }))
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject.mock.calls[0][0]).toBe(0)
    // Menu must have closed after the click.
    expect(screen.queryByRole('menu', { name: /ghost layer actions/i })).toBeNull()
  })

  it('G23 — context menu "Accept layer" item fires onAccept and closes the menu', () => {
    const onAccept = vi.fn()
    const { container } = renderGhost([makeSuggestion()], {
      onAccept,
      onEdit: vi.fn(),
    })
    const rect = container.querySelector('rect') as SVGRectElement
    fireEvent.contextMenu(rect, { clientX: 100, clientY: 50 })
    fireEvent.click(screen.getByRole('button', { name: /accept layer/i }))
    expect(onAccept).toHaveBeenCalledTimes(1)
    expect(onAccept.mock.calls[0][0]).toBe(0)
    // Menu must have closed after the click.
    expect(screen.queryByRole('menu', { name: /ghost layer actions/i })).toBeNull()
  })

  // T1: right-click a pending layer → "Split layer" item present;
  // clicking it fires onSplitLayer(idx) and closes the menu. Debt #98
  // — owner directive 2026-05-22: "do the right click split option".
  it('T1 — context menu "Split layer" item fires onSplitLayer and closes the menu', () => {
    const onSplitLayer = vi.fn()
    const { container } = renderGhost([makeSuggestion(), makeSuggestion()], {
      onSplitLayer,
      onEdit: vi.fn(),
    })
    // Right-click layer idx=1.
    const rect = container.querySelector('[data-litho-idx="1"]') as SVGRectElement
    fireEvent.contextMenu(rect, { clientX: 100, clientY: 50 })
    expect(screen.getByRole('button', { name: /split layer/i })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /split layer/i }))
    expect(onSplitLayer).toHaveBeenCalledTimes(1)
    expect(onSplitLayer.mock.calls[0][0]).toBe(1)
    expect(screen.queryByRole('menu', { name: /ghost layer actions/i })).toBeNull()
  })

  // T2: when the parent does not wire onSplitLayer, the menu item is
  // not rendered — zero regression for callers that haven't opted in.
  it('T2 — "Split layer" item is not rendered when onSplitLayer is absent', () => {
    const { container } = renderGhost([makeSuggestion()], {
      onEdit: vi.fn(),
    })
    const rect = container.querySelector('rect') as SVGRectElement
    fireEvent.contextMenu(rect, { clientX: 100, clientY: 50 })
    expect(screen.queryByRole('button', { name: /split layer/i })).toBeNull()
  })

  it('G15 — pending layer rect keeps pointer cursor', () => {
    const { container } = renderGhost([makeSuggestion()])
    const rect = container.querySelector('rect')
    expect((rect as SVGRectElement).style.cursor).toBe('pointer')
    // pointerEvents not explicitly set on the inline style for pending
    // layers — it falls back to the SVG default (auto), so clicks
    // still register.
    expect((rect as SVGRectElement).style.pointerEvents).toBe('')
  })

  it('G13 — base handle fires onEdit with depth_base_m only', () => {
    // Layer 0 base starts at depth 2 → drag 50 px down → delta 0.5 m
    // → new depth_base_m = 2.5. Two-layer fixture is required after
    // the kill-multi-cascade refactor (2026-05-23): the LAST layer's
    // base now clamps at the segmenter's deepest output (= itself)
    // so a single-layer drag-down has nowhere to go. Layer 1 below
    // gives the bound room — its FAR edge is at 4 m, drag to 2.5
    // is within bound.
    const onEdit = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 250 })
    fireEvent.mouseUp(document)
    // Shared-boundary commit: layer 0 base + layer 1 top both move to 2.5.
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    const layer1Edit = onEdit.mock.calls.find(([idx]) => idx === 1)
    expect(layer0Edit?.[1].depth_base_m).toBeCloseTo(2.5, 5)
    expect(layer0Edit?.[1].depth_top_m).toBeUndefined()
    expect(layer1Edit?.[1].depth_top_m).toBeCloseTo(2.5, 5)
  })

  // G23-G25 — DELETED 2026-05-31. The ↻ undo icon used to render on
  // rejected layers (debt #80) but the owner removed it as visual
  // clutter; rejected layers now render nothing at all (see G14c
  // above). Restoring a rejected layer is via right-click → Insert
  // layer.

  // -----------------------------------------------------------------
  // Snap-to-collapse (debt #81) — dragging an edge onto the opposite
  // edge snaps and auto-rejects the layer on mouseup.
  // -----------------------------------------------------------------

  // G26: drag layer top down past own base → snap → auto-reject(0).
  // 2026-05-23 dogfeed: snap now requires deliberate overshoot (cursor
  // PAST the bound by more than the snap threshold, not just AT it).
  // Move 210 px (= 2.10 m): 0.10 m past the 2 m base → safely past
  // the 4 px (~0.04 m) overshoot threshold.
  // 2026-05-30 dogfeed (fix A): commit-side zero-thickness auto-reject
  // now short-circuits the onEdit emission — a layer being rejected
  // doesn't need a depth commit since the rect doesn't render. Test
  // pins the cleaner contract: onReject fires, onEdit does not.
  it('G26 — drag top down past own base snaps and auto-rejects the layer', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit, onReject },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')
    fireEvent.mouseDown(topHandle!, { clientY: 0 })
    fireEvent.mouseMove(document, { clientY: 210 })
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).not.toBeNull()
    fireEvent.mouseUp(document)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith(0)
    expect(onEdit).not.toHaveBeenCalled()
  })

  // G27: drag top down only ~100 px (midway) → NOT snapped → no
  // reject, no indicator, depth edit fires at the moved position.
  it('G27 — drag top within layer (not near base) does not snap or reject', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit, onReject },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')
    fireEvent.mouseDown(topHandle!, { clientY: 0 })
    fireEvent.mouseMove(document, { clientY: 100 }) // 1 m down — midway
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).toBeNull()
    fireEvent.mouseUp(document)
    expect(onReject).not.toHaveBeenCalled()
    expect(onEdit).toHaveBeenCalledWith(0, { depth_top_m: 1 })
  })

  // -----------------------------------------------------------------
  // Snap-to-collide on neighbour's far edge (debt #83 v1) — dogfeed
  // 2026-05-20: "i can still drag a layer over other layers, if it
  // collides it should just snap and attach to the boundary it
  // collides with". The hard clamp prevents overlap; the snap at
  // the neighbour's far edge auto-rejects the now-collapsed neighbour.
  // -----------------------------------------------------------------

  // G32: drag layer 0's BASE down far enough to hit layer 1's BASE
  // (the next-pending-below's far edge). The clamp stops the drag
  // at layer 1's base; the snap fires; on release, the shared-
  // boundary commit collapses layer 1 to zero thickness and onReject
  // fires with idx=1 (the NEIGHBOUR, not self).
  // G32 / G33 — single-step cascade with auto-reject (dogfeed
  // 2026-05-23 second pass). Drag-to-far-edge of the immediate
  // pending neighbour + release AT the snap → shared-boundary commit
  // PLUS auto-reject the neighbour. Restores the "drag a bottom
  // layer up to merge into the upper one" gesture that the initial
  // kill-multi-cascade pass left as a zero-thickness zombie. The
  // merge-confirm dialog stays gone — the auto-reject is silent but
  // the snap indicator's "release to merge" amber text gives the
  // user the affordance. Multi-layer cascade (3+ same-parent)
  // is still gone — exactly one neighbour absorbed per gesture.

  it('G32 — base-drag past pending neighbour: primary onEdit commits at far edge, secondary + chain skipped', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const onMergeLayers = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit, onReject, onMergeLayers },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    // Cursor 700 px = +5 m from initial (200 px / 2 m base) → raw 7 m,
    // 3 m past the layer-1 base (4 m) → safely overshoots threshold.
    fireEvent.mouseMove(document, { clientY: 700 })
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).not.toBeNull()
    fireEvent.mouseUp(document)
    // No dialog (merge-confirm is gone).
    expect(screen.queryByTestId('merge-confirm-title')).toBeNull()
    // Primary commit extends layer 0's base to layer 1's FAR edge (depth 4)
    // — the helper's absorb condition. Parent's applyCrossMergeOnDrag
    // reducer handles the actual absorb atomically.
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    const layer1Edit = onEdit.mock.calls.find(([idx]) => idx === 1)
    expect(layer0Edit?.[1].depth_base_m).toBeCloseTo(4, 5)
    // Secondary onEdit on layer 1 is SKIPPED — its index would be stale
    // post-absorb. Chain emissions (onReject / onMergeLayers) are SKIPPED
    // for the same reason. The parent's helper is the single source of
    // truth for the absorb (dogfeed 2026-05-26).
    expect(layer1Edit).toBeUndefined()
    expect(onReject).not.toHaveBeenCalled()
    expect(onMergeLayers).not.toHaveBeenCalled()
  })

  it('G33 — top-drag past pending neighbour: primary onEdit commits at far edge, secondary + chain skipped', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const onMergeLayers = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit, onReject, onMergeLayers },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-1"]')
    fireEvent.mouseDown(topHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: -300 })
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).not.toBeNull()
    fireEvent.mouseUp(document)
    expect(screen.queryByTestId('merge-confirm-title')).toBeNull()
    // Primary commit extends layer 1's top to layer 0's FAR edge
    // (depth 0 = ground) — the helper's absorb condition.
    const layer1Edit = onEdit.mock.calls.find(([idx]) => idx === 1)
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    expect(layer1Edit?.[1].depth_top_m).toBeCloseTo(0, 5)
    // Secondary + chain skipped — parent's helper handles absorb.
    expect(layer0Edit).toBeUndefined()
    expect(onReject).not.toHaveBeenCalled()
    expect(onMergeLayers).not.toHaveBeenCalled()
  })

  // G33b — dogfeed 2026-05-23: dragging a boundary AT (not past) the
  // neighbour bound does NOT trigger snap/merge. User reported the prior
  // "snap when within threshold of bound" was too sticky — moving to a
  // bound to size the layer tight against it accidentally absorbed the
  // neighbour. Fix: snap requires the cursor to OVERSHOOT the bound by
  // more than the snap threshold (the merge gesture is now explicit).
  it('G33b — dragging top edge exactly to neighbour bound does NOT trigger merge', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit, onReject },
    )
    // Top of layer 1 sits at depth 2 (clientY = 200). Move UP by exactly
    // 200 px → cursor depth = 0 m = layer 0's TOP (= boundsAboveM).
    // Pre-fix this would snap and auto-reject layer 0; new behaviour
    // requires deliberate overshoot past the bound.
    const topHandle = container.querySelector('[data-testid="litho-drag-top-1"]')
    fireEvent.mouseDown(topHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 0 })
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).toBeNull()
    fireEvent.mouseUp(document)
    expect(onReject).not.toHaveBeenCalled()
    // Shared-boundary commit still fires: layer 1 top → 0, layer 0 base → 0.
    expect(onEdit).toHaveBeenCalledWith(1, { depth_top_m: 0 })
  })

  // G33c — dogfeed 2026-05-26: dragging the top of a layer UP past the
  // partner-above's FAR edge must absorb the partner above ONLY. The layer
  // BELOW the dragger must remain completely untouched.
  //
  // User's exact words: "the bottom clay layer i don't touch when i drag
  // up still getting a reassignment of lithology". Repro: 4-layer stack,
  // drag the third layer's top up past the second's far edge — the fourth
  // (bottom) layer gets merged into the third because:
  //   - The parent reducer's applyCrossMergeOnDrag runs first and absorbs
  //     the partner above (correct), shifting all indices down by 1.
  //   - The component THEN emits onMergeLayers(min(drag.idx, chain[0]))
  //     from the snap-overshoot chain. The chain entry was computed
  //     PRE-absorb so the now-stale index points at the layer below the
  //     dragger in the post-absorb state — merging it into the dragger.
  //
  // Behaviour rule: when the cross-merge helper will absorb the partner
  // (final depth crosses the partner's far edge), the component MUST NOT
  // also emit onMergeLayers — the absorb is already handled atomically
  // inside the parent reducer.
  it('G33c — drag top UP past partner far edge does NOT emit onMergeLayers (layer below stays untouched)', () => {
    const onEdit = vi.fn()
    const onMergeLayers = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),  // A
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),  // B = partner above dragger
        makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),  // C = dragger
        makeSuggestion({ depth_top_m: 6, depth_base_m: 8 }),  // D = layer below (must not be touched)
      ],
      { onEdit, onMergeLayers, onReject },
    )
    // Top of layer C (idx=2) sits at depth 4 → clientY = 400 (100 px/m).
    // Drag UP to clientY = 100 → cursor at depth 1, well past B's far
    // edge (B.depth_top_m = 2). Hard clamp + snap pull ``final`` back to
    // B's far edge (= boundsAboveM = 2), the deliberate-overshoot
    // signal. partnerWillBeAbsorbed predicate sees ``final 2 <= B.top 2``
    // → helper will absorb B; chain + secondary skipped.
    const topHandle = container.querySelector('[data-testid="litho-drag-top-2"]')
    fireEvent.mouseDown(topHandle!, { clientY: 400 })
    fireEvent.mouseMove(document, { clientY: 100 })
    fireEvent.mouseUp(document)
    // Primary onEdit fires on the dragger with the snapped new top depth.
    const draggerEdit = onEdit.mock.calls.find(([idx]) => idx === 2)
    expect(draggerEdit).toBeDefined()
    expect(draggerEdit![1].depth_top_m).toBeCloseTo(2, 5)
    // onMergeLayers must NOT fire — the parent reducer's
    // applyCrossMergeOnDrag handles the absorb atomically.
    expect(onMergeLayers).not.toHaveBeenCalled()
    // Sanity: layer D (idx=3) MUST NOT receive any edit.
    const layerDEdit = onEdit.mock.calls.find(([idx]) => idx === 3)
    expect(layerDEdit).toBeUndefined()
  })

  // G39 — dogfeed 2026-05-25: snap indicator must vanish after mouseUp
  // completes a merge. Pre-fix the indicator stayed on-screen because
  // collapseChainOnRelease=[] (outer-edge snap) kept the condition true
  // even though nothing was actually merged — the next downward drag on
  // the expanded layer immediately re-showed "release to merge" giving
  // the "stuck in merge mode" appearance.
  // Regression anchor: assert the snap indicator is gone after mouseUp
  // in the neighbour-merge path (G32 scenario).
  it('G39 — snap indicator is absent after merge-commit mouseUp (dogfeed 2026-05-25)', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit, onReject },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    // Overshoot layer-1 base (4 m) — snap fires, indicator appears.
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 700 })
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).not.toBeNull()
    // Release — merge commit fires, indicator MUST be gone.
    fireEvent.mouseUp(document)
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).toBeNull()
  })

  // G40 — dogfeed 2026-05-25: outer-edge snap (cursor hits test bottom
  // while collapseChainOnRelease=[]) must NOT show the snap indicator.
  // This was the core of the "stuck" symptom: after merging the only
  // neighbour, the expanded layer's base handle was already AT the test
  // bottom so any downward drag triggered snappedAtBelow with an empty
  // chain, and the indicator showed "release to merge" when nothing
  // would merge on release.
  it('G40 — outer-edge snap (empty chain) does not show snap indicator (dogfeed 2026-05-25)', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    // Single layer — no neighbour below, so the collapse chain is always
    // [] (the last layer can only shrink to zero via self-collapse when
    // dragged from the top). Drag the BASE far down → outer-edge snap
    // (boundsBelowM=Infinity, no pending neighbour). No indicator.
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit, onReject },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    // Drag far down — no neighbour, collapseChainBelow=[] → outer edge.
    fireEvent.mouseMove(document, { clientY: 900 })
    // Snap indicator must NOT appear for an empty collapse chain.
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).toBeNull()
    fireEvent.mouseUp(document)
    expect(onReject).not.toHaveBeenCalled()
  })

  // G34b — mirror of G34 for the OPPOSITE direction. Owner dogfeed
  // 2026-05-22: "rejected a layer, tried to pull the sand boundary
  // below it up, but couldn't pull onto the layer above the rejected
  // layer." With layer 1 (silt) rejected, dragging layer 2's TOP UP
  // must extend through the rejected region and clamp at layer 0's
  // BASE (the next-visible-above's NEAR edge). Pins debt #99 — covers
  // the direction G34 missed.
  it('G34b — with rejected between, top-drag UP passes through to the layer-above FAR edge', () => {
    // Owner directive 2026-05-31: rejected layers are visually gone,
    // so a drag through them passes through to the visible neighbour's
    // FAR edge (not its near edge). The partner-will-be-absorbed
    // cross-merge prediction in useBoundaryDrag suppresses the
    // partner-side propagate-only edit + the chain entry — the
    // parent's applyCrossMergeOnDrag handles the actual absorb.  In
    // this test (no cross-merge wiring) the net is just an onEdit on
    // the dragger.
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
        makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
      ],
      { onEdit, onReject, rejectedIndices: new Set([1]) },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-2"]')
    fireEvent.mouseDown(topHandle!, { clientY: 400 })
    // Drag way up → snaps at layer 0's TOP (= 0 m, the FAR edge).
    fireEvent.mouseMove(document, { clientY: -500 })
    fireEvent.mouseUp(document)
    const layer2Edit = onEdit.mock.calls.find(([idx]) => idx === 2)
    expect(layer2Edit?.[1].depth_top_m).toBeCloseTo(0, 5)
    // Cross-merge prediction suppresses the layer-0 propagation +
    // chain reject. Parent's applyCrossMergeOnDrag handles the
    // actual absorb.
    expect(onReject).not.toHaveBeenCalled()
    expect(onEdit.mock.calls.find(([idx]) => idx === 0)).toBeUndefined()
    expect(onEdit.mock.calls.find(([idx]) => idx === 1)).toBeUndefined()
  })

  // G34c — dogfeed 2026-05-31. After N consecutive self-collapse
  // drags absorb layers into a single neighbour, a drag-up from
  // BELOW the absorbed region must keep going through the rejected
  // gap and (if dragged far enough) eat the visible neighbour itself
  // — the same contract the immediate-neighbour branch applies. The
  // earlier "stop at original suggestion's near edge" variant locked
  // the drag the moment the absorbed boundary had been propagated
  // back, which contradicted the owner's mental model that rejected
  // = visually gone = transparent to subsequent drags.
  it('G34c — drag-up passes through rejected gap to the visible neighbour FAR edge', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    // Three pending layers: 0=[10,11], 1=[11,12], 2=[12,13].
    // Layers 1 and 2 are pre-rejected.
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 10, depth_base_m: 11 }),
        makeSuggestion({ depth_top_m: 11, depth_base_m: 12 }),
        makeSuggestion({ depth_top_m: 12, depth_base_m: 13 }),
        makeSuggestion({ depth_top_m: 13, depth_base_m: 14 }),
      ],
      {
        onEdit,
        onReject,
        rejectedIndices: new Set([1, 2]),
      },
    )
    // Dragger = layer 3's TOP at 13. Drag way up → snaps at layer 0's
    // TOP (= 10, the visible neighbour's FAR edge). The cross-merge
    // prediction suppresses the chain reject + propagate; parent's
    // applyCrossMergeOnDrag handles the actual absorb.
    const topHandle = container.querySelector('[data-testid="litho-drag-top-3"]')
    fireEvent.mouseDown(topHandle!, { clientY: 400 })
    fireEvent.mouseMove(document, { clientY: -500 })
    fireEvent.mouseUp(document)
    const layer3Edit = onEdit.mock.calls.find(([idx]) => idx === 3)
    expect(layer3Edit?.[1].depth_top_m).toBeCloseTo(10, 5)
  })

  // G37 deleted 2026-05-23 — the MergeConfirmDialog is gone (kill-
  // multi-cascade refactor). No dialog ⇒ no cancel path to net.

  // G34 — updated 2026-05-31 to the FAR-edge semantic. Rejected
  // layers are visually gone, so a drag through them treats the
  // visible neighbour with the same auto-reject contract as if it
  // were immediately adjacent. Dragging layer 0's BASE down past
  // rejected layer 1 reaches layer 2's BASE (= 6, the FAR edge) on
  // snap and auto-rejects layer 2.
  it('G34 — drag through rejected reaches visible neighbour FAR edge', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
        makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
      ],
      { onEdit, onReject, rejectedIndices: new Set([1]) },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 1500 })
    fireEvent.mouseUp(document)
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    // Dragged layer 0's base extended to layer 2's BASE (= 6 m).
    expect(layer0Edit?.[1].depth_base_m).toBeCloseTo(6, 5)
    // Cross-merge prediction suppresses the partner-side propagation
    // + chain reject. Parent's applyCrossMergeOnDrag handles the
    // actual absorb.
    expect(onReject).not.toHaveBeenCalled()
    expect(onEdit.mock.calls.find(([idx]) => idx === 1)).toBeUndefined()
    expect(onEdit.mock.calls.find(([idx]) => idx === 2)).toBeUndefined()
  })

  // -----------------------------------------------------------------
  // Topology — shared-boundary propagation skips rejected + accepted
  // layers (dogfeed bug 2026-05-20: rejecting a middle layer let the
  // two surrounding pending layers be dragged independently into
  // overlap because the commit was hardwired to idx ± 1).
  // -----------------------------------------------------------------

  // G29: with a rejected layer between A (idx=0) and C (idx=2),
  // dragging A's base fires the shared-boundary commit on C (idx=2),
  // NOT on the rejected B (idx=1). Pre-fix: the propagation landed
  // on idx=1 (rejected → invisible) so C.top never moved, leaving
  // A.base and C.top out of sync.
  it('G29 — drag with rejected layer between propagates to next pending', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    // Three contiguous pending layers; idx=1 is then rejected.
    const layers = [
      makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
      makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
    ]
    const { container } = renderGhost(layers, {
      onEdit,
      onReject,
      rejectedIndices: new Set([1]),
    })
    // Drag layer 0's BASE down 100 px (1 m) — not enough to snap.
    // levelToScreen's pxPerM = 100 so 100 px = 1 m.
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 300 })
    fireEvent.mouseUp(document)
    // onEdit fired on the dragged layer (0) and on the NEXT pending
    // layer below (idx=2, skipping the rejected idx=1).
    const calls = onEdit.mock.calls.map(([idx, edit]) => ({ idx, edit }))
    const idxs = calls.map(c => c.idx).sort()
    expect(idxs).toEqual([0, 2])
    const onZero = calls.find(c => c.idx === 0)!
    const onTwo = calls.find(c => c.idx === 2)!
    expect(onZero.edit.depth_base_m).toBeCloseTo(3, 5)
    expect(onTwo.edit.depth_top_m).toBeCloseTo(3, 5)
    // The rejected layer (1) is NEVER touched — its stored depths
    // stay where they were so un-rejecting restores it cleanly.
    expect(calls.find(c => c.idx === 1)).toBeUndefined()
  })

  // G30 (rewritten 2026-05-30, Slice 2 of unified-boundary-drag):
  // accepted neighbours are NO LONGER a hard barrier at their near
  // edge. The drag passes through their territory just like a pending
  // neighbour — bound = accepted's FAR edge. The propagate-to-partner
  // still skips when the partner is accepted (Slice 3 will route this
  // to the contact PATCH instead), so only the dragger's edit fires
  // — but the dragger's edit can now reach into accepted territory,
  // which was the user-facing lock the spec aimed at.
  //
  // See docs/superpowers/specs/2026-05-30-unified-boundary-drag-design.md.
  it('G30 — accepted neighbour bound = its FAR edge (drag passes through accepted)', () => {
    const onEdit = vi.fn()
    const layers = [
      makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
      makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
    ]
    const { container } = renderGhost(layers, {
      onEdit,
      acceptedIndices: new Set([1]),
    })
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    // Drag base from y=200 (depth 2) down to y=300 (depth 3) — 1 m
    // into the accepted layer's territory. Pre-Slice-2 this clamped
    // at depth 2 (the accepted's near edge); post-Slice-2 the bound
    // is the accepted's far edge (depth 4), so depth 3 is reached.
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 300 })
    fireEvent.mouseUp(document)
    const calls = onEdit.mock.calls.map(([idx, edit]) => ({ idx, edit }))
    // Only the dragger's edit fires — the accepted partner still
    // doesn't receive a pending edit (Slice 3 fires its contact PATCH
    // instead). depth_base_m reaches depth 3.
    expect(calls.map(c => c.idx)).toEqual([0])
    expect(calls[0].edit.depth_base_m).toBeCloseTo(3, 5)
  })

  // G30b (new, Slice 2): drag base DOWN past the accepted's near edge
  // all the way to its FAR edge — the bound should let the drag reach
  // the accepted's far edge, not clamp at the near edge.
  it('G30b — base drag clamps at accepted neighbour FAR edge (Slice 2)', () => {
    const onEdit = vi.fn()
    const layers = [
      makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
      makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
    ]
    const { container } = renderGhost(layers, {
      onEdit,
      acceptedIndices: new Set([1]),
    })
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    // Drag well past depth 4 (overshoot). Clamp = accepted's far edge
    // = depth 4. Commit fires depth_base_m = 4 (or close, depending
    // on snap-vs-clamp).
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 500 }) // depth 5, past depth 4
    fireEvent.mouseUp(document)
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    expect(layer0Edit).toBeDefined()
    expect(layer0Edit![1].depth_base_m).toBeCloseTo(4, 5)
  })

  // G31: when the only neighbour below is rejected, there is no
  // pending visible below — boundsBelowM is +Infinity, so the drag
  // can extend deeper than any other layer. Only the dragged layer's
  // edit fires (no propagation).
  it('G31 — drag with no pending neighbour below fires only own edit', () => {
    const onEdit = vi.fn()
    const layers = [
      makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
      makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
    ]
    const { container } = renderGhost(layers, {
      onEdit,
      rejectedIndices: new Set([1]),
    })
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 250 })
    fireEvent.mouseUp(document)
    const calls = onEdit.mock.calls.map(([idx, edit]) => ({ idx, edit }))
    expect(calls.map(c => c.idx)).toEqual([0])
    expect(calls[0].edit.depth_base_m).toBeCloseTo(2.5, 5)
  })

  // G28: drag base up onto top → snap from the opposite direction.
  // 2026-05-30 dogfeed (fix A): commit-side zero-thickness auto-reject
  // short-circuits the onEdit emission for the same reason as G26.
  it('G28 — drag base up onto top snaps and auto-rejects the layer', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit, onReject },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    // base sits at depth 2 → clientY = 200 (per levelToScreen).
    // Dogfeed 2026-05-23: snap now requires overshooting the bound by
    // more than the 4 px threshold. -10 px = 0.10 m past the layer's
    // top (depth 0) — clearly past the overshoot floor.
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: -10 })
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).not.toBeNull()
    fireEvent.mouseUp(document)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith(0)
    expect(onEdit).not.toHaveBeenCalled()
  })

  // -----------------------------------------------------------------
  // Composition edits flow into the rendered layer (dogfeed bug
  // 2026-05-20: user changed composition to "silty sand" via the
  // LithoGhostCompositionEditor but the plot kept rendering plain
  // "Sand". The dialog's onSave stashed the edit in the edits Map
  // but the render only read depth fields from `committed`.)
  // -----------------------------------------------------------------

  // G35: an edits-Map entry with suggested_lithology overrides the
  // raw segmenter value — fill colour + label update accordingly.
  it('G35 — committed suggested_lithology overrides raw in the rendered fill', () => {
    const edits = new Map([
      [0, { suggested_lithology: 'KLEI' }],
    ])
    const { container } = renderGhost(
      [makeSuggestion({ suggested_lithology: 'ZAND', depth_top_m: 0, depth_base_m: 2 })],
      { edits },
    )
    const rect = container.querySelector('rect')!
    // Klei in LITHOLOGY_COLORS is the project's clay grey (not the
    // sand yellow). Asserts the fill changed because of the edit,
    // not the raw value.
    const fill = rect.getAttribute('fill') ?? ''
    expect(fill.toLowerCase()).not.toBe('#deb887')  // not the sand fill
    // The tooltip text starts with the rich English label of the
    // edited composition — base is "Clay" not "Sand".
    const title = container.querySelector('title')!.textContent ?? ''
    expect(title).toMatch(/^Clay/i)
  })

  // G36: an edits-Map entry with suggested_admixtures changes the
  // rendered LABEL to the rich English form (e.g. "weakly silty
  // Sand" instead of plain "Sand"). The label appears in the
  // tooltip <title> the layer rect carries.
  it('G36 — committed suggested_admixtures change the rendered label', () => {
    const edits = new Map([
      [
        0,
        {
          suggested_admixtures: [
            { soil_code: 'SL', amount: 'Z', locally: false },
          ],
        },
      ],
    ])
    const { container } = renderGhost(
      [
        makeSuggestion({
          suggested_lithology: 'ZAND',
          suggested_admixtures: [],
          depth_top_m: 0,
          depth_base_m: 2,
        }),
      ],
      { edits },
    )
    const title = container.querySelector('title')!.textContent ?? ''
    // "weakly silty Sand" — base "Sand" with admixture "weakly silty".
    expect(title.toLowerCase()).toMatch(/silty/)
  })

  // G38: an accepted layer suppresses its inline label — the committed
  // contact band underneath carries the real label, so a leftover ghost
  // label reads as a faint "double" behind it (dogfeed 2026-05-22).
  it('G38 — accepted layer suppresses its inline label; pending keeps it', () => {
    const { container } = renderGhost(
      [
        makeSuggestion({
          suggested_lithology: 'ZAND',
          depth_top_m: 0,
          depth_base_m: 3,
        }),
        makeSuggestion({
          suggested_lithology: 'KLEI',
          depth_top_m: 3,
          depth_base_m: 6,
        }),
      ],
      { acceptedIndices: new Set([0]) },
    )
    const tspans = Array.from(container.querySelectorAll('tspan')).map(
      t => t.textContent,
    )
    // idx 1 (pending KLEI) keeps its label; idx 0 (accepted ZAND) does not.
    expect(tspans).toContain('CLAY')
    expect(tspans).not.toContain('SAND')
  })

  // -----------------------------------------------------------------
  // Debt #86 — Alt-drag copy-composition gesture
  // -----------------------------------------------------------------

  // Q1: Alt+mousedown on the body rect arms copy mode → preview chip
  // renders, no onAccept fires.
  it('Q1 — Alt+mousedown arms copy-composition + renders preview chip', () => {
    const onAccept = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({
          suggested_lithology: 'ZAND',
          suggested_admixtures: [{ soil_code: 'KL', amount: 'M', locally: false }],
        }),
      ],
      { onAccept, onEdit: vi.fn() },
    )
    const bodyRect = container.querySelector('[data-litho-anchor-id]')
    expect(bodyRect).not.toBeNull()
    fireEvent.mouseDown(bodyRect!, { clientX: 200, clientY: 200, altKey: true })
    expect(screen.getByTestId('copy-composition-preview-chip')).toBeInTheDocument()
    fireEvent.mouseUp(document)
    expect(onAccept).not.toHaveBeenCalled()
  })

  // Q2: drop on a same-column pending sibling fires onEdit with the
  // dragged layer's composition. No dialog because target has no edit.
  it('Q2 — Alt-drag drop on same-column sibling fires onEdit with composition', () => {
    const onEdit = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({
          depth_top_m: 0,
          depth_base_m: 2,
          suggested_lithology: 'KLEI',
          suggested_admixtures: [{ soil_code: 'Z', amount: 'M', locally: false }],
        }),
        makeSuggestion({
          depth_top_m: 2,
          depth_base_m: 4,
          suggested_lithology: 'ZAND',
        }),
      ],
      { onEdit },
    )
    // Source: layer 0 body. Find by data-litho-idx attribute.
    const sourceRect = container.querySelector('[data-litho-idx="0"]')
    const targetRect = container.querySelector('[data-litho-idx="1"]')
    expect(sourceRect).not.toBeNull()
    expect(targetRect).not.toBeNull()
    fireEvent.mouseDown(sourceRect!, { clientX: 200, clientY: 100, altKey: true })
    // Mock elementsFromPoint to return the target rect under the cursor.
    const original = document.elementsFromPoint
    document.elementsFromPoint = (() => [targetRect as Element]) as typeof document.elementsFromPoint
    try {
      fireEvent.mouseUp(document, { clientX: 200, clientY: 300 })
    } finally {
      document.elementsFromPoint = original
    }
    // onEdit was called with the source composition on target idx=1.
    expect(onEdit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        suggested_lithology: 'KLEI',
        suggested_admixtures: expect.arrayContaining([
          expect.objectContaining({ soil_code: 'Z', amount: 'M' }),
        ]),
      }),
    )
  })

  // Q3: drop on a layer that already has a composition edit opens the
  // confirm dialog; Confirm fires onEdit.
  it('Q3 — drop on already-edited target opens overwrite dialog; Confirm commits', () => {
    const onEdit = vi.fn()
    const existingEdit = new Map([
      [
        1,
        {
          suggested_lithology: 'VEEN',
          suggested_admixtures: [],
        },
      ],
    ])
    const { container } = renderGhost(
      [
        makeSuggestion({ suggested_lithology: 'KLEI', depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ suggested_lithology: 'ZAND', depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit, edits: existingEdit },
    )
    const sourceRect = container.querySelector('[data-litho-idx="0"]')
    const targetRect = container.querySelector('[data-litho-idx="1"]')
    fireEvent.mouseDown(sourceRect!, { clientX: 200, clientY: 100, altKey: true })
    const original = document.elementsFromPoint
    document.elementsFromPoint = (() => [targetRect as Element]) as typeof document.elementsFromPoint
    try {
      fireEvent.mouseUp(document, { clientX: 200, clientY: 300 })
    } finally {
      document.elementsFromPoint = original
    }
    // Dialog open, no edit yet.
    expect(screen.getByTestId('copy-composition-title')).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
    // Confirm → edit fires.
    fireEvent.click(screen.getByTestId('copy-composition-submit'))
    expect(onEdit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ suggested_lithology: 'KLEI' }),
    )
  })

  // Q4: Cancel in the overwrite dialog drops the gesture.
  it('Q4 — overwrite dialog Cancel = no-op', () => {
    const onEdit = vi.fn()
    const existingEdit = new Map([[1, { suggested_lithology: 'VEEN' }]])
    const { container } = renderGhost(
      [makeSuggestion({ suggested_lithology: 'KLEI' }), makeSuggestion({ suggested_lithology: 'ZAND' })],
      { onEdit, edits: existingEdit },
    )
    const sourceRect = container.querySelector('[data-litho-idx="0"]')
    const targetRect = container.querySelector('[data-litho-idx="1"]')
    fireEvent.mouseDown(sourceRect!, { clientX: 200, clientY: 100, altKey: true })
    const original = document.elementsFromPoint
    document.elementsFromPoint = (() => [targetRect as Element]) as typeof document.elementsFromPoint
    try {
      fireEvent.mouseUp(document, { clientX: 200, clientY: 300 })
    } finally {
      document.elementsFromPoint = original
    }
    expect(screen.getByTestId('copy-composition-title')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('copy-composition-cancel'))
    expect(onEdit).not.toHaveBeenCalled()
  })

  // Q5: Non-Alt mousedown does NOT arm copy mode (sanity — regular
  // accept clicks still work, no preview chip).
  it('Q5 — plain mousedown (no Alt) does not arm copy mode', () => {
    const { container } = renderGhost(
      [makeSuggestion({ suggested_lithology: 'ZAND' })],
      { onEdit: vi.fn() },
    )
    const bodyRect = container.querySelector('[data-litho-anchor-id]')
    fireEvent.mouseDown(bodyRect!, { clientX: 200, clientY: 200, altKey: false })
    expect(screen.queryByTestId('copy-composition-preview-chip')).not.toBeInTheDocument()
  })

  // Q6: drop on a target whose anchor differs from the source's fires
  // onCrossColumnPaste instead of onEdit. Tested via a single component
  // instance with a fake target rect whose data-litho-anchor-id points
  // to a different anchor — the hit-test path is what matters.
  it('Q6 — drop on different-anchor target fires onCrossColumnPaste', () => {
    const onEdit = vi.fn()
    const onCrossColumnPaste = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ suggested_lithology: 'KLEI' })],
      { onEdit, onCrossColumnPaste, investigationId: 'cpt-source' },
    )
    const sourceRect = container.querySelector('[data-litho-anchor-id="cpt-source"]')
    fireEvent.mouseDown(sourceRect!, { clientX: 200, clientY: 100, altKey: true })
    // Build a fake foreign target element.
    const foreignTarget = document.createElement('div')
    foreignTarget.setAttribute('data-litho-anchor-id', 'cpt-target')
    foreignTarget.setAttribute('data-litho-idx', '0')
    const original = document.elementsFromPoint
    document.elementsFromPoint = (() => [foreignTarget]) as typeof document.elementsFromPoint
    try {
      fireEvent.mouseUp(document, { clientX: 400, clientY: 300 })
    } finally {
      document.elementsFromPoint = original
    }
    expect(onEdit).not.toHaveBeenCalled()
    expect(onCrossColumnPaste).toHaveBeenCalledWith(
      'cpt-target',
      0,
      expect.objectContaining({ suggested_lithology: 'KLEI' }),
    )
  })

  // Q7: the copy must carry the source layer's EFFECTIVE composition
  // (raw merged with edits) — not raw. Regression: stripping admixtures
  // is an edit; the copy was reading raw, so stripped admixtures came
  // back through the paste (dogfeed 2026-05-22).
  it('Q7 — copy carries the source layer edited (stripped) composition, not raw', () => {
    const onEdit = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({
          depth_top_m: 0,
          depth_base_m: 2,
          suggested_lithology: 'KLEI',
          suggested_admixtures: [{ soil_code: 'Z', amount: 'M', locally: false }],
        }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4, suggested_lithology: 'ZAND' }),
      ],
      {
        onEdit,
        // Source layer 0 has had its admixtures stripped (an edit).
        edits: new Map([[0, { suggested_admixtures: [] }]]),
      },
    )
    const sourceRect = container.querySelector('[data-litho-idx="0"]')
    const targetRect = container.querySelector('[data-litho-idx="1"]')
    fireEvent.mouseDown(sourceRect!, { clientX: 200, clientY: 100, altKey: true })
    const original = document.elementsFromPoint
    document.elementsFromPoint = (() =>
      [targetRect as Element]) as typeof document.elementsFromPoint
    try {
      fireEvent.mouseUp(document, { clientX: 200, clientY: 300 })
    } finally {
      document.elementsFromPoint = original
    }
    // The copy carried the stripped (empty) admixtures, not raw [{Z,M}].
    expect(onEdit).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        suggested_lithology: 'KLEI',
        suggested_admixtures: [],
      }),
    )
  })

  // -----------------------------------------------------------------
  // Debt #85 — right-click shared boundary to insert a layer
  // -----------------------------------------------------------------

  // R1: boundary hit-strip rendered between two pending layers when
  // onInsertLayer is wired.
  it('R1 — boundary strip rendered between two adjacent pendings when onInsertLayer wired', () => {
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit: vi.fn(), onInsertLayer: vi.fn() },
    )
    expect(container.querySelector('[data-testid="litho-boundary-strip-0"]')).not.toBeNull()
  })

  // R2: no boundary strip when onInsertLayer is absent (opt-in only).
  it('R2 — boundary strip not rendered when onInsertLayer is undefined', () => {
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit: vi.fn() },
    )
    expect(container.querySelector('[data-testid="litho-boundary-strip-0"]')).toBeNull()
  })

  // R3: no strip between pending and accepted neighbour (the accepted
  // layer's depths are committed contacts, mutating via the edits map
  // would distort the green-tick rect without changing the DB).
  it('R3 — no boundary strip between pending and accepted neighbour', () => {
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      {
        onEdit: vi.fn(),
        onInsertLayer: vi.fn(),
        acceptedIndices: new Set([1]),
      },
    )
    expect(container.querySelector('[data-testid="litho-boundary-strip-0"]')).toBeNull()
  })

  // R4: right-click on the boundary strip opens the boundary menu.
  it('R4 — right-click on boundary strip opens the boundary menu', () => {
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit: vi.fn(), onInsertLayer: vi.fn() },
    )
    const strip = container.querySelector('[data-testid="litho-boundary-strip-0"]')
    expect(strip).not.toBeNull()
    fireEvent.contextMenu(strip!, { clientX: 300, clientY: 200 })
    expect(screen.getByTestId('litho-boundary-menu')).toBeInTheDocument()
    expect(screen.getByTestId('litho-boundary-insert')).toBeInTheDocument()
  })

  // R5: clicking "Insert layer here…" opens the composition picker; on
  // Save, onInsertLayer fires with afterIdx + the chosen composition.
  it('R5 — Insert action opens picker; Save fires onInsertLayer with afterIdx', () => {
    const onInsertLayer = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit: vi.fn(), onInsertLayer },
    )
    const strip = container.querySelector('[data-testid="litho-boundary-strip-0"]')
    fireEvent.contextMenu(strip!, { clientX: 300, clientY: 200 })
    fireEvent.click(screen.getByTestId('litho-boundary-insert'))
    // Picker opens — find the Save button (composition editor uses
    // a "Save" button via the shared Modal/Button primitive).
    const save = screen.getByRole('button', { name: /save/i })
    fireEvent.click(save)
    // onInsertLayer fires with afterIdx=0 + the picker's defaults
    // (ZAND main soil, empty admixtures per the picker's normalisation).
    expect(onInsertLayer).toHaveBeenCalledTimes(1)
    const [afterIdx, composition] = onInsertLayer.mock.calls[0]
    expect(afterIdx).toBe(0)
    expect(composition.suggested_lithology).toBe('ZAND')
  })

  // -----------------------------------------------------------------
  // Debt #102 — user-initiated merge on a same-lithology boundary
  // -----------------------------------------------------------------

  // U1: right-click on a boundary whose two layers share lithology →
  // menu shows "Merge layers"; clicking it fires onMergeLayers(upperIdx).
  it('U1 — same-lithology boundary shows Merge layers; clicking it fires onMergeLayers', () => {
    const onMergeLayers = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2, suggested_lithology: 'ZAND' }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4, suggested_lithology: 'ZAND' }),
      ],
      { onEdit: vi.fn(), onInsertLayer: vi.fn(), onMergeLayers },
    )
    const strip = container.querySelector('[data-testid="litho-boundary-strip-0"]')
    fireEvent.contextMenu(strip!, { clientX: 300, clientY: 200 })
    const mergeBtn = screen.getByTestId('litho-boundary-merge')
    expect(mergeBtn).toBeInTheDocument()
    fireEvent.click(mergeBtn)
    expect(onMergeLayers).toHaveBeenCalledTimes(1)
    expect(onMergeLayers.mock.calls[0][0]).toBe(0)
  })

  // U2: a boundary whose two layers DIFFER in lithology must not offer
  // Merge — the same-lithology gate is the whole point.
  it('U2 — different-lithology boundary does NOT show the Merge layers item', () => {
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2, suggested_lithology: 'ZAND' }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4, suggested_lithology: 'KLEI' }),
      ],
      { onEdit: vi.fn(), onInsertLayer: vi.fn(), onMergeLayers: vi.fn() },
    )
    const strip = container.querySelector('[data-testid="litho-boundary-strip-0"]')
    fireEvent.contextMenu(strip!, { clientX: 300, clientY: 200 })
    // Insert is offered (the strip is there); Merge is not.
    expect(screen.getByTestId('litho-boundary-insert')).toBeInTheDocument()
    expect(screen.queryByTestId('litho-boundary-merge')).toBeNull()
  })

  // ---------------------------------------------------------------------------
  // V — debt #103: live drag depth readout on the litho ghost boundary.
  //
  // The readout box mirrors the borehole-anchored contact drag readout
  // (ContactsLayer) — two lines: depth-down-the-test + absolute mTAW
  // elevation — so the litho drag surfaces the same depth values the
  // engineer already sees on the other drag surfaces.
  // ---------------------------------------------------------------------------

  // V1: no drag in progress → readout box is not rendered. Initial-render
  // gate so the card doesn't appear over a static ghost overlay.
  it('V1 — readout is absent before any drag begins', () => {
    const { container } = renderGhost([makeSuggestion()], { onEdit: vi.fn() })
    expect(container.querySelector('[data-testid="litho-drag-readout"]')).toBeNull()
  })

  // V2: mousedown on the top handle → readout renders with depth + mTAW
  // for the dragged boundary's CURRENT position (not the initial one).
  // Test transform: levelToScreen(level) = 500 - level * 100 → pxPerM=100.
  // Surface = 5 m TAW, layer top starts at depth 0. Drag 50 px down →
  // currentDepth = 0.5 m → elevation = 5 - 0.5 = +4.50 m TAW.
  it('V2 — readout shows live depth + mTAW during top-edge drag', () => {
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit: vi.fn() },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')
    expect(topHandle).not.toBeNull()
    fireEvent.mouseDown(topHandle!, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 150 })
    const readout = container.querySelector('[data-testid="litho-drag-readout"]')
    expect(readout).not.toBeNull()
    const texts = Array.from(readout!.querySelectorAll('text')).map(t => t.textContent)
    expect(texts).toContain('depth 0.50 m')
    expect(texts).toContain('+4.50 m TAW')
  })

  // V3: mouseup ends the drag → readout disappears. Confirms the gate
  // is on the live drag state, not a lingering ref.
  it('V3 — readout disappears after mouseup', () => {
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit: vi.fn() },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')!
    fireEvent.mouseDown(topHandle, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 150 })
    expect(container.querySelector('[data-testid="litho-drag-readout"]')).not.toBeNull()
    fireEvent.mouseUp(document)
    expect(container.querySelector('[data-testid="litho-drag-readout"]')).toBeNull()
  })

  // V4: base-edge drag works too — and a depth that lands ABOVE the
  // surface (negative depth is impossible, but a deep base produces a
  // negative-or-zero elevation when surface is shallow). Use surface=1,
  // base of layer 0 starts at depth 2, drag down 50 px → depth 2.5 →
  // elevation -1.5. Verifies sign formatting (no leading '+' when
  // elevation < 0). Two-layer fixture required (the kill-multi-cascade
  // refactor 2026-05-23 caps the LAST layer's base at its own depth).
  // V5 — dogfeed 2026-05-23: the readout for a CPT-anchored drag also
  // shows qc + Rf at the current drag depth when cptPlotByAnchorId
  // carries an entry for the investigation. Without the entry, the
  // readout falls back to depth + mTAW only (boreholes path).
  it('V5 — readout includes qc + Rf when cpt plot is supplied', () => {
    const cptPlotByAnchorId = new Map<
      string,
      {
        depths_m: readonly number[]
        qc_mpa: readonly number[]
        rf_pct: readonly (number | null)[] | null
      }
    >([
      [
        'cpt-1',
        {
          depths_m: [0, 0.5, 1, 1.5, 2, 2.5, 3],
          qc_mpa: [1.2, 1.5, 2.0, 2.5, 3.1, 4.0, 5.0],
          rf_pct: [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1],
        },
      ],
    ])
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 3 })],
      { onEdit: vi.fn(), surfaceElevationM: 5, cptPlotByAnchorId },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')!
    fireEvent.mouseDown(topHandle, { clientY: 0 })
    // 200 px = 2 m down → drag depth = 2.0 m → bin idx 4 → qc=3.1, Rf=0.9
    fireEvent.mouseMove(document, { clientY: 200 })
    const readout = container.querySelector('[data-testid="litho-drag-readout"]')!
    const texts = Array.from(readout.querySelectorAll('text')).map(t => t.textContent)
    expect(texts.some(t => t?.startsWith('depth'))).toBe(true)
    expect(texts.some(t => t?.includes('TAW'))).toBe(true)
    expect(texts.some(t => t?.startsWith('qc'))).toBe(true)
    expect(texts.some(t => t?.startsWith('Rf'))).toBe(true)
    // Value sanity — qc at depth 2.0 m (idx 4) is 3.10.
    expect(texts).toContain('qc 3.10 MPa')
  })

  it('V4 — base drag readout reflects depth + signed mTAW (negative elevation case)', () => {
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit: vi.fn(), surfaceElevationM: 1 },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')!
    fireEvent.mouseDown(baseHandle, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 150 })
    const readout = container.querySelector('[data-testid="litho-drag-readout"]')
    expect(readout).not.toBeNull()
    const texts = Array.from(readout!.querySelectorAll('text')).map(t => t.textContent)
    expect(texts).toContain('depth 2.50 m')
    expect(texts).toContain('-1.50 m TAW')
  })

  // -------------------------------------------------------------------
  // W — debt #103-followup (2026-05-23): kill-multi-cascade + × click-
  // delete + test-bottom clamp. Pin each contract with a dedicated test.
  // -------------------------------------------------------------------

  // W1: × icon renders on PENDING layers when onReject is wired.
  it('W1 — × reject icon renders on pending layers', () => {
    const { container } = renderGhost([makeSuggestion()])
    expect(container.querySelector('[data-testid="litho-reject-0"]')).not.toBeNull()
  })

  // W2: clicking the × fires onReject(idx) with the layer index.
  it('W2 — clicking × fires onReject with the layer index', () => {
    const onReject = vi.fn()
    const { container } = renderGhost([makeSuggestion()], { onReject })
    const icon = container.querySelector('[data-testid="litho-reject-0"]')!
    fireEvent.click(icon)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith(0)
  })

  // W3: × is absent on ACCEPTED layers (parent renders nothing) and
  // on REJECTED layers (rejected layers render nothing).
  it('W3 — × is absent on accepted and rejected layers', () => {
    const accepted = renderGhost([makeSuggestion()], {
      acceptedIndices: new Set([0]),
    })
    expect(accepted.container.querySelector('[data-testid="litho-reject-0"]')).toBeNull()
    cleanup()
    const rejected = renderGhost([makeSuggestion()], {
      rejectedIndices: new Set([0]),
    })
    expect(rejected.container.querySelector('[data-testid="litho-reject-0"]')).toBeNull()
  })

  // W4: drag of the LAST layer's BASE downward clamps at its own base
  // (the segmenter's deepest output = test's effective bottom).
  // Replaces the prior POSITIVE_INFINITY bound that let drags run off
  // the bottom of the plot (dogfeed 2026-05-23).
  it('W4 — base drag of the last layer clamps at the segmenter\'s deepest output', () => {
    const onEdit = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit },
    )
    // Drag layer 1's BASE (the LAST layer) way down 1000 px.
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-1"]')!
    fireEvent.mouseDown(baseHandle, { clientY: 400 })
    fireEvent.mouseMove(document, { clientY: 1400 })
    fireEvent.mouseUp(document)
    // Bound = layer 1's own base = 4. Drag stuck at 4 (no movement).
    const layer1Edit = onEdit.mock.calls.find(([idx]) => idx === 1)
    expect(layer1Edit?.[1].depth_base_m).toBeCloseTo(4, 5)
  })

  // AB section removed by owner directive 2026-06-04 — Shift+drag absorb
  // gesture deleted. Plain drag-to-collapse is the only absorb surface.

  // -----------------------------------------------------------------
  // DR — drag handles are functional after any merge (dogfeed 2026-05-25)
  // -----------------------------------------------------------------

  // -----------------------------------------------------------------
  // DR — drag handles are functional after any merge (dogfeed 2026-05-25)
  //
  // After a merge the surviving layer's boundary must remain draggable.
  // Pre-fix: the drag-to-collapse snap path left a zero-thickness rejected
  // layer between the merged layer and the one below. The crossedRejected
  // clamp logic set boundsBelowM == currentBase, freezing the base handle.
  // Fix: when a NEIGHBOUR (not self) is in the collapse chain, call
  // onMergeLayers to remove the absorbed layer from suggestions entirely.
  // -----------------------------------------------------------------

  // DR1: drag-to-collapse merge (base-drag snap) — after the merge via
  // onMergeLayers, re-render the component with the resulting shorter
  // suggestions array and verify the surviving layer's base handle fires
  // onEdit when the user drags it.
  it('DR1 — base handle responds after drag-to-collapse merge (dogfeed 2026-05-25)', () => {
    const onMergeLayers = vi.fn()
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container, rerender } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
        makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
      ],
      { onEdit, onReject, onMergeLayers },
    )
    // Step 1: drag layer 0's base to layer 1's far edge (snap + helper absorb).
    const baseHandle0 = container.querySelector('[data-testid="litho-drag-base-0"]')!
    fireEvent.mouseDown(baseHandle0, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 700 }) // overshoot layer-1 base (4 m)
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).not.toBeNull()
    fireEvent.mouseUp(document)
    // Primary onEdit emits the depth at layer-1's FAR edge; the parent's
    // applyCrossMergeOnDrag reducer handles the absorb. Chain emissions
    // are SKIPPED so the parent isn't told to double-merge (dogfeed
    // 2026-05-26 — they were operating on stale indices).
    const baseEdit = onEdit.mock.calls.find(([idx]) => idx === 0)
    expect(baseEdit?.[1].depth_base_m).toBeCloseTo(4, 5)
    expect(onMergeLayers).not.toHaveBeenCalled()
    expect(onReject).not.toHaveBeenCalled()
    // Step 2: simulate parent applying the merge — shrink suggestions by
    // removing layer 1, extend layer 0's base to 4.
    const id = 'cpt-1'
    rerender(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn(id)]}
          investigationId={id}
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }), // S0 raw (edit carries the new base)
            makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }), // old S2, now idx 1
          ]}
          levelToScreen={levelToScreen}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set()}
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={onReject}
          onEdit={onEdit}
          onMergeLayers={onMergeLayers}
        />
      </svg>,
    )
    // Step 3: drag the merged layer's base handle — must move.
    onEdit.mockClear()
    const baseHandlePost = container.querySelector('[data-testid="litho-drag-base-0"]')!
    expect(baseHandlePost).not.toBeNull()
    // The merged layer's effective base is in edits (passed via prop); in
    // this re-render the suggestions[0].depth_base_m is still 2 but edits
    // would carry 4. For this test we pass no edits, so the handle starts
    // at the raw base = 2. Drag 50 px down → 0.5 m → depth_base_m = 2.5.
    fireEvent.mouseDown(baseHandlePost, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 250 })
    fireEvent.mouseUp(document)
    // Shared-boundary commit: layer 0 base + layer 1 top both fire.
    expect(onEdit).toHaveBeenCalled()
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    expect(layer0Edit).toBeDefined()
    expect(layer0Edit![1].depth_base_m).toBeCloseTo(2.5, 5)
  })

  // DR2: right-click "Merge layers" path — after onMergeLayers is
  // called by the menu, the parent re-renders with shorter suggestions.
  // Verify the merged layer's boundary handles fire onEdit normally.
  it('DR2 — base handle responds after right-click Merge (dogfeed 2026-05-25)', () => {
    const onEdit = vi.fn()
    const id = 'cpt-1'
    // Render post-merge state directly: two-layer ghost where layer 0
    // was merged from [0,2) + [2,4) → edits carry depth_base_m=4; the
    // component is given the merged suggestions + a non-empty edits Map.
    const postMergeEdits = new Map([[0, { depth_base_m: 4 }]])
    const { container } = render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn(id)]}
          investigationId={id}
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }), // raw; edit carries merged base
            makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }), // next pending layer
          ]}
          levelToScreen={levelToScreen}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set()}
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={onEdit}
          edits={postMergeEdits}
        />
      </svg>,
    )
    // Base handle of the merged layer sits at the edit's depth (4 m).
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')!
    expect(baseHandle).not.toBeNull()
    // Drag UP 50 px (shallower): depth_base_m = 4 - 0.5 = 3.5.
    fireEvent.mouseDown(baseHandle, { clientY: 100 }) // clientY=100 → initial depth=4? No.
    // levelToScreen(5 - 4) = levelToScreen(1) = 500 - 100 = 400. So baseY=400.
    // mousedown at clientY=400 (current base Y). Move to clientY=350 → +50px UP → depth 3.5.
    fireEvent.mouseDown(baseHandle, { clientY: 400 })
    fireEvent.mouseMove(document, { clientY: 350 })
    fireEvent.mouseUp(document)
    expect(onEdit).toHaveBeenCalled()
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    expect(layer0Edit).toBeDefined()
    expect(layer0Edit![1].depth_base_m).toBeCloseTo(3.5, 5)
  })

  // DR3 removed — it tested the Shift+drag absorb gesture (deleted by
  // owner directive 2026-06-04). The plain drag-to-collapse path (DR1/DR2)
  // is the surviving absorb mechanism.

  // DR4: after a plain drag-to-collapse merge + a subsequent resize-drag,
  // the drag state is fully clean (no leftover snapTarget etc.).
  it('DR4 — drag state is fully clean after merge + subsequent resize (dogfeed 2026-05-25)', () => {
    const onEdit = vi.fn()
    const id = 'cpt-1'
    // Post-merge state: one surviving layer spanning 0–4 m (edit carries base=4),
    // plus a layer below. Verify a complete drag cycle leaves no indicator.
    const { container } = render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn(id)]}
          investigationId={id}
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
            makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
          ]}
          levelToScreen={levelToScreen}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set()}
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={onEdit}
          edits={new Map([[0, { depth_base_m: 4 }]])}
        />
      </svg>,
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')!
    fireEvent.mouseDown(baseHandle, { clientY: 400 })
    fireEvent.mouseMove(document, { clientY: 350 })
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).toBeNull()
    expect(container.querySelector('[data-testid="litho-absorb-indicator"]')).toBeNull()
    fireEvent.mouseUp(document)
    // After mouseUp, indicators gone and drag readout gone — clean state.
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).toBeNull()
    expect(container.querySelector('[data-testid="litho-absorb-indicator"]')).toBeNull()
    expect(container.querySelector('[data-testid="litho-drag-readout"]')).toBeNull()
    expect(onEdit).toHaveBeenCalled()
  })

  // W5: multi-layer cascade is killed — drag past TWO same-parent
  // neighbours stops at the FIRST neighbour's far edge, not the
  // farthest chain entry's far edge. Pins the user's exact 2026-05-23
  // complaint: "drag it over other boundaries" (plural).
  it('W5 — drag through multiple same-parent neighbours stops at the FIRST neighbour\'s far edge', () => {
    const onEdit = vi.fn()
    // Three same-parent (parent_formation_id=null shared) pending layers.
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2, parent_formation_id: 'p1' }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4, parent_formation_id: 'p1' }),
        makeSuggestion({ depth_top_m: 4, depth_base_m: 6, parent_formation_id: 'p1' }),
      ],
      { onEdit },
    )
    // Drag layer 0's BASE down 2000 px (way past layer 1 AND layer 2).
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')!
    fireEvent.mouseDown(baseHandle, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 2200 })
    fireEvent.mouseUp(document)
    // Pre-fix: cascade chain absorbed layers 1+2, bound at layer 2's
    // base = 6, both rejected on snap-and-merge. Now: drag stops at
    // layer 1's FAR edge (= 4). Layer 2 untouched. Secondary onEdit on
    // layer 1 is SKIPPED because absorb is predicted (dogfeed 2026-05-26).
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    const layer1Edit = onEdit.mock.calls.find(([idx]) => idx === 1)
    const layer2Edit = onEdit.mock.calls.find(([idx]) => idx === 2)
    expect(layer0Edit?.[1].depth_base_m).toBeCloseTo(4, 5)
    expect(layer1Edit).toBeUndefined()
    expect(layer2Edit).toBeUndefined()
  })

  // G-SENTINEL-1: a near-zero-thickness ghost (< 6 px rendered height) must
  // render WITHOUT a fill (transparent interior) and WITH a dashed stroke.
  // This is Bug 3: a 0.01 m sentinel ghost at typical zoom was rendering as a
  // coloured sliver indistinguishable from a real layer band.
  //
  // levelToScreen maps level → 500 - level * 100, so 100 px/m.
  // depth_top = 0.0 m → level 5.0 → y = 0; depth_base = 0.01 m → level 4.99 → y = 1.
  // height = 1 px < 6 px threshold → sentinel branch.
  it('G-SENTINEL-1 — zero-thickness ghost renders with no fill and dashed outline', () => {
    const { container } = renderGhost([
      makeSuggestion({ depth_top_m: 0, depth_base_m: 0.01, suggested_lithology: 'ZAND' }),
    ])
    const rect = container.querySelector('rect')
    expect(rect).not.toBeNull()
    // Sentinel: fill must be transparent (no solid color).
    expect(rect!.getAttribute('fill')).toBe('transparent')
    // Sentinel: must have a dashed stroke so it reads as a "marker" not a "layer".
    expect(rect!.getAttribute('stroke-dasharray')).toBeTruthy()
    // Sentinel: fillOpacity must be 0.
    expect(Number(rect!.getAttribute('fill-opacity'))).toBe(0)
  })

  // G-SENTINEL-2: a normal-thickness ghost (>= 6 px rendered height) must
  // render WITH a solid fill — confirming the sentinel path is gated correctly.
  it('G-SENTINEL-2 — normal-thickness ghost renders with solid fill', () => {
    // depth_base - depth_top = 1 m → 100 px > 6 px threshold.
    const { container } = renderGhost([
      makeSuggestion({ depth_top_m: 0, depth_base_m: 1, suggested_lithology: 'KLEI' }),
    ])
    const rect = container.querySelector('rect')
    expect(rect).not.toBeNull()
    // Normal layer: fill must NOT be transparent.
    expect(rect!.getAttribute('fill')).not.toBe('transparent')
    const fillOpacity = Number(rect!.getAttribute('fill-opacity'))
    expect(fillOpacity).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// LOCK1 — drag UP locks after absorb-down (dogfeed 2026-05-30)
//
// Owner report: "upward drag seems to lock exactly after i pull a higher
// layer down to a lower layer to collapse them into one layer."
//
// DR2 / DR3 already cover "drag merged BASE up after collapse" using an
// explicit re-render. Both pass. The lock has to come from a divergence
// with the real flow — most likely the z-order overlap at the shared
// boundary: after absorb the merged BASE and the next layer's TOP both
// sit at the same y. SVG paints the next layer's top LATER, so a click at
// the boundary y grabs the next layer's TOP, not the merged BASE.
//
// This describe block walks the FULL flow via the same applyCrossMergeOnDrag
// reducer the parent hook uses, then probes UP-drag on both candidate
// hit-targets (merged BASE + next layer's TOP) to pin which one locks.
// ---------------------------------------------------------------------------

import { applyCrossMergeOnDrag as applyCrossMergeOnDragHelper } from '../../utils/lithoLayerMerge'
import type { BulkAnchorGhost, LithoSuggestionEdit } from '../../hooks/useGeologicalModel'

describe('LOCK1 — UP-drag after absorb-down (dogfeed 2026-05-30)', () => {
  /**
   * Stateful harness — mirrors useGeologicalModel.handleEditBulkLitho: every
   * onEdit fires the same applyCrossMergeOnDrag reducer the production code
   * uses, then re-renders with the new ghost state.
   */
  function renderStatefulGhost(initial: LithoLayerSuggestion[]): {
    container: HTMLElement
    snapshot: () => BulkAnchorGhost
  } {
    const id = 'cpt-1'
    let ghost: BulkAnchorGhost = {
      kind: 'cpt',
      surfaceElevationM: 5,
      suggestions: initial,
      accepted: new Set(),
      rejected: new Set(),
      edits: new Map(),
    }
    const renderShell = (): JSX.Element => (
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn(id)]}
          investigationId={id}
          suggestions={ghost.suggestions}
          levelToScreen={levelToScreen}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={ghost.accepted}
          rejectedIndices={ghost.rejected}
          edits={ghost.edits}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={(idx, edit) => {
            ghost = applyCrossMergeOnDragHelper(ghost, idx, edit as LithoSuggestionEdit)
            rerender(renderShell())
          }}
          // Real SectionPanel wires this — the debt #85 boundary insert
          // hit-strip only renders when present, so the test must wire it
          // too or the real-life z-order isn't reproduced.
          onInsertLayer={vi.fn()}
        />
      </svg>
    )
    const { container, rerender } = render(renderShell())
    return { container, snapshot: () => ghost }
  }

  // Helper — depth → clientY using the test transform (surface=5, pxPerM=100).
  const yOfDepth = (depth: number): number => 500 - (5 - depth) * 100

  it('LOCK1 — drag MERGED LAYER base UP after absorb-down should fire onEdit', () => {
    const { container, snapshot } = renderStatefulGhost([
      makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
      makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
    ])
    // Step 1 — drag layer 0's base DOWN past layer 1's far edge (depth 4)
    // to trigger absorb-down. baseY starts at yOfDepth(2)=300; drag to
    // yOfDepth(5)=600 (well past depth 4 + snap threshold).
    const baseHandle0 = container.querySelector('[data-testid="litho-drag-base-0"]')!
    fireEvent.mouseDown(baseHandle0, { clientY: yOfDepth(2) })
    fireEvent.mouseMove(document, { clientY: yOfDepth(5) })
    fireEvent.mouseUp(document)

    // Post-collapse state: layer 1 gone, layer 0 extended to depth 4,
    // original layer 2 now at idx 1.
    const post = snapshot()
    expect(post.suggestions).toHaveLength(2)
    expect(post.edits.get(0)?.depth_base_m).toBeCloseTo(4, 5)

    // Step 2 — drag the MERGED layer's base UP from depth 4 to depth 3.
    // baseY is at yOfDepth(4)=400; drag UP 100 px to yOfDepth(3)=300.
    const baseHandleMerged = container.querySelector('[data-testid="litho-drag-base-0"]')!
    expect(baseHandleMerged).not.toBeNull()
    fireEvent.mouseDown(baseHandleMerged, { clientY: yOfDepth(4) })
    fireEvent.mouseMove(document, { clientY: yOfDepth(3) })
    fireEvent.mouseUp(document)

    // Expectation: the merged layer's base committed to 3 m.
    const after = snapshot()
    expect(after.edits.get(0)?.depth_base_m).toBeCloseTo(3, 5)
  })

  // LOCK1b — Grab the NEXT pending layer's TOP at the shared boundary
  // (SVG z-order makes this the actual hit-target when the user clicks
  // at the boundary y), drag UP. Shared-boundary commit MUST propagate
  // the merged layer's base up by the same delta.
  it('LOCK1b — grabbing the NEXT layer top at the shared boundary then dragging UP moves both edges', () => {
    const { container, snapshot } = renderStatefulGhost([
      makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
      makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
    ])
    // Absorb-down: layer 0 swallows layer 1.
    const baseHandle0 = container.querySelector('[data-testid="litho-drag-base-0"]')!
    fireEvent.mouseDown(baseHandle0, { clientY: yOfDepth(2) })
    fireEvent.mouseMove(document, { clientY: yOfDepth(5) })
    fireEvent.mouseUp(document)

    // Post-merge: 2 layers. The NEXT pending below the merged sits at
    // the shared boundary depth 4 — its TOP handle wins z-order at y=400.
    const nextTopHandle = container.querySelector('[data-testid="litho-drag-top-1"]')!
    expect(nextTopHandle).not.toBeNull()
    fireEvent.mouseDown(nextTopHandle, { clientY: yOfDepth(4) })
    fireEvent.mouseMove(document, { clientY: yOfDepth(3) })
    fireEvent.mouseUp(document)

    const after = snapshot()
    // Shared-boundary commit must move BOTH: the next layer's top to 3
    // AND the merged layer's base to 3 (the partner _propagateOnly edit).
    expect(after.edits.get(1)?.depth_top_m).toBeCloseTo(3, 5)
    expect(after.edits.get(0)?.depth_base_m).toBeCloseTo(3, 5)
  })

  // ZT1 — fix A: collapsing a layer's top onto its own base with NO snap
  // (cursor lands exactly at the base, not past + threshold) must STILL
  // auto-reject the layer instead of leaving a zero-thickness pending
  // entry. Pre-fix this was the dogfeed bug 2026-05-30: user dragged
  // top down to base, layer "disappeared" visually but lived on in
  // state, blocking the next layer's upward drag.
  it('ZT1 — drag top to own base without snap still auto-rejects (no zero-thickness zombie)', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit, onReject },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')!
    // Drag top from y=0 (depth 0) down to y=200 (depth 2.0) — exactly at
    // the layer's own base, no overshoot, no snap indicator. Pre-fix
    // this would have emitted onEdit(0, {depth_top_m: 2}) and left the
    // layer alive as zero-thickness pending. Post-fix it auto-rejects.
    fireEvent.mouseDown(topHandle, { clientY: 0 })
    fireEvent.mouseMove(document, { clientY: 200 })
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).toBeNull()
    fireEvent.mouseUp(document)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith(0)
    expect(onEdit).not.toHaveBeenCalled()
  })

  // ZT2 — mirror of ZT1: drag base UP to own top, no snap, must reject.
  it('ZT2 — drag base to own top without snap still auto-rejects', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit, onReject },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')!
    fireEvent.mouseDown(baseHandle, { clientY: 200 }) // depth 2 (own base)
    fireEvent.mouseMove(document, { clientY: 0 })     // depth 0 (own top)
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).toBeNull()
    fireEvent.mouseUp(document)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith(0)
    expect(onEdit).not.toHaveBeenCalled()
  })

  // ZT3 — fix B: an existing zero-thickness pending layer in state (e.g.
  // loaded from a save written before fix A landed) must NOT block the
  // next layer's UP drag. The effectivelyRejectedIndices safety net
  // skips it so the bound walker reaches the next non-collapsed layer.
  it('ZT3 — zero-thickness pending layer in state does not lock next layer\'s UP drag', () => {
    const onEdit = vi.fn()
    // Three stacked layers; layer 0 starts pre-collapsed via edits
    // (depth_top_m == depth_base_m == 2) — simulates the legacy zombie
    // state. Layer 1 is the user's draggable pending. Layer 2 below
    // gives layer 1's base a clamp partner so we can verify both bounds.
    const { container } = render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn('cpt-1')]}
          investigationId="cpt-1"
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
            makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
            makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
          ]}
          levelToScreen={(level: number) => 500 - level * 100}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set()}
          rejectedIndices={new Set()}
          edits={new Map([[0, { depth_top_m: 2, depth_base_m: 2 }]])}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={onEdit}
        />
      </svg>,
    )
    // Layer 1's top sits at depth 2. Drag it UP to 1.
    const top1 = container.querySelector('[data-testid="litho-drag-top-1"]')!
    fireEvent.mouseDown(top1, { clientY: 300 }) // levelToScreen(5-2) = 300
    fireEvent.mouseMove(document, { clientY: 200 }) // depth 1
    fireEvent.mouseUp(document)
    // The drag MUST fire onEdit (not be locked). Pre-fix, layer 0's
    // effective top (2) would have been returned by boundFromNeighbour
    // as the FAR edge clamp → boundsAbove = 2 = layer 1's start → lock.
    const layer1Edit = onEdit.mock.calls.find(([idx]) => idx === 1)
    expect(layer1Edit).toBeDefined()
    expect(layer1Edit![1].depth_top_m).toBeCloseTo(1, 5)
  })

  // CS1 — Slice 3 cross-store commit dispatch. When a pending drag
  // moves a shared boundary with an ACCEPTED neighbour AND a committed
  // contact exists at the pre-drag boundary depth, the hook fires
  // onUpdateContactDepth so the contact follows the pending edit.
  // CS1 — Slice 3 cross-store commit dispatch. The pending layer drags its
  // TOP up, crossing into the accepted layer ABOVE. The accepted layer
  // above must have its stored BASE (depth_base_m) extended upward —
  // NOT its top. The 4th arg 'base' signals this to handleUpdateContactDepth.
  it('CS1 — drag past accepted neighbour above fires onUpdateContactDepth with field=base', () => {
    const onEdit = vi.fn()
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    // Layer 0 (accepted) at [0, 2]; layer 1 (pending) at [2, 4]; layer 2 (pending) at [4, 6].
    // A committed contact exists at depth_top_m=2 — the shared boundary
    // between layer 0 (accepted) and layer 1 (pending).
    const contact = {
      id: 'contact-at-2m',
      model_id: 'litho-1',
      formation_id: 'f-1',
      borehole_id: null,
      cpt_id: 'cpt-1',
      depth_top_m: 2,
      source: 'manual_pick' as const,
      confidence: 'medium' as const,
      observation_id: null,
      observation_layer_id: null,
      notes: null,
      synthetic_x: null,
      synthetic_y: null,
      synthetic_elevation_m: null,
      parent_geo_contact_id: null,
      created_at: '2026-05-30T00:00:00Z',
      updated_at: '2026-05-30T00:00:00Z',
    }
    const { container } = render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn('cpt-1')]}
          investigationId="cpt-1"
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
            makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
            makeSuggestion({ depth_top_m: 4, depth_base_m: 6 }),
          ]}
          levelToScreen={(level: number) => 500 - level * 100}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set([0])}
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={onEdit}
          committedContactsForAnchor={[contact]}
          onUpdateContactDepth={onUpdateContactDepth}
        />
      </svg>,
    )
    // Layer 1's top sits at depth 2 (= the committed contact's depth).
    // Drag it UP to depth 1 (= 100 px up). After Slice 2 this drag is
    // not locked; after Slice 3 the contact at depth 2 follows.
    const top1 = container.querySelector('[data-testid="litho-drag-top-1"]')!
    fireEvent.mouseDown(top1, { clientY: 300 }) // depth 2
    fireEvent.mouseMove(document, { clientY: 200 }) // depth 1
    fireEvent.mouseUp(document)
    // Pending edit fires for layer 1.
    const layer1Edit = onEdit.mock.calls.find(([idx]) => idx === 1)
    expect(layer1Edit).toBeDefined()
    expect(layer1Edit![1].depth_top_m).toBeCloseTo(1, 5)
    // Cross-store PATCH fires with field='base' — the layer ABOVE must have
    // its BASE extended upward (not its TOP moved, which would be wrong).
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    expect(onUpdateContactDepth).toHaveBeenCalledWith('contact-at-2m', 1, false, 'base')
  })

  // CS1b — mirror: drag layer 0's BASE down, crossing into accepted layer
  // BELOW. The layer below must have its stored TOP (depth_top_m) moved
  // downward. The 4th arg 'top' signals this.
  it('CS1b — drag base past accepted neighbour below fires onUpdateContactDepth with field=top', () => {
    const onEdit = vi.fn()
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    // Layer 0 (pending) at [0, 2]; layer 1 (accepted) at [2, 4].
    // Committed contact for layer 1 at depth_top_m=2.
    const contact = {
      id: 'contact-at-2m',
      model_id: 'litho-1',
      formation_id: 'f-1',
      borehole_id: null,
      cpt_id: 'cpt-1',
      depth_top_m: 2,
      source: 'manual_pick' as const,
      confidence: 'medium' as const,
      observation_id: null,
      observation_layer_id: null,
      notes: null,
      synthetic_x: null,
      synthetic_y: null,
      synthetic_elevation_m: null,
      parent_geo_contact_id: null,
      created_at: '2026-05-30T00:00:00Z',
      updated_at: '2026-05-30T00:00:00Z',
    }
    const { container } = render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn('cpt-1')]}
          investigationId="cpt-1"
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
            makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
          ]}
          levelToScreen={(level: number) => 500 - level * 100}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set([1])}
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={onEdit}
          committedContactsForAnchor={[contact]}
          onUpdateContactDepth={onUpdateContactDepth}
        />
      </svg>,
    )
    // Drag layer 0's base DOWN from depth 2 (clientY=300) to depth 3 (clientY=400).
    const base0 = container.querySelector('[data-testid="litho-drag-base-0"]')!
    fireEvent.mouseDown(base0, { clientY: 300 }) // depth 2
    fireEvent.mouseMove(document, { clientY: 400 }) // depth 3
    fireEvent.mouseUp(document)
    // The layer below (accepted, idx 1) must have its TOP moved — field='top'.
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    expect(onUpdateContactDepth).toHaveBeenCalledWith('contact-at-2m', 3, false, 'top')
  })

  // CS2 — no cross-store PATCH fires when the neighbour is PENDING
  // (the existing onEdit shared-boundary propagation handles it).
  it('CS2 — pending-only drag does not fire onUpdateContactDepth', () => {
    const onUpdateContactDepth = vi.fn()
    const { container } = render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn('cpt-1')]}
          investigationId="cpt-1"
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
            makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
          ]}
          levelToScreen={(level: number) => 500 - level * 100}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set()}
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={vi.fn()}
          committedContactsForAnchor={[]}
          onUpdateContactDepth={onUpdateContactDepth}
        />
      </svg>,
    )
    const top1 = container.querySelector('[data-testid="litho-drag-top-1"]')!
    fireEvent.mouseDown(top1, { clientY: 300 })
    fireEvent.mouseMove(document, { clientY: 250 })
    fireEvent.mouseUp(document)
    expect(onUpdateContactDepth).not.toHaveBeenCalled()
  })

  // ZT-FILL1 — P1a (dogfeed 2026-05-30): collapsing a layer's top to
  // its own base auto-rejects the layer AND extends the layer above
  // down to fill the rejected territory. Pending-neighbour case.
  it('ZT-FILL1 — collapse-top auto-fills the pending layer above', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }), // A (pending) — should grow
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }), // B (pending) — being collapsed
      ],
      { onEdit, onReject },
    )
    const top1 = container.querySelector('[data-testid="litho-drag-top-1"]')!
    // Drag layer B's top from depth 2 (clientY=200) down to depth 4
    // (clientY=400) — collapse onto its own base.
    fireEvent.mouseDown(top1, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 400 })
    fireEvent.mouseUp(document)
    // Layer B rejected.
    expect(onReject).toHaveBeenCalledWith(1)
    // Layer A's base extended to layer B's base (depth 4).
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    expect(layer0Edit).toBeDefined()
    expect(layer0Edit![1].depth_base_m).toBeCloseTo(4, 5)
  })

  // ZT-FILL2 — P1a: mirror. Collapsing a layer's base to its own top
  // auto-rejects the layer AND extends the layer below up to fill.
  it('ZT-FILL2 — collapse-base auto-fills the pending layer below', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }), // A — being collapsed
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }), // B — should grow
      ],
      { onEdit, onReject },
    )
    const base0 = container.querySelector('[data-testid="litho-drag-base-0"]')!
    // Drag layer A's base from depth 2 (clientY=200) up to depth 0
    // (clientY=0) — collapse onto its own top.
    fireEvent.mouseDown(base0, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 0 })
    fireEvent.mouseUp(document)
    expect(onReject).toHaveBeenCalledWith(0)
    const layer1Edit = onEdit.mock.calls.find(([idx]) => idx === 1)
    expect(layer1Edit).toBeDefined()
    expect(layer1Edit![1].depth_top_m).toBeCloseTo(0, 5)
  })

  // ZT-FILL3 — P1a: when the fill neighbour is ACCEPTED and ABOVE, the
  // committed contact is PATCHed with field='base' to extend its BASE down
  // to the rejected layer's own base. 'top' would be wrong — it would move
  // the above layer's top boundary instead of its base.
  it('ZT-FILL3 — collapse-top with accepted fill-neighbour above fires onUpdateContactDepth field=base', () => {
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    const contact = {
      id: 'contact-at-2',
      model_id: 'm',
      formation_id: 'f',
      borehole_id: null,
      cpt_id: 'cpt-1',
      depth_top_m: 2,
      source: 'manual_pick' as const,
      confidence: 'medium' as const,
      observation_id: null,
      observation_layer_id: null,
      notes: null,
      synthetic_x: null,
      synthetic_y: null,
      synthetic_elevation_m: null,
      parent_geo_contact_id: null,
      created_at: '2026-05-30T00:00:00Z',
      updated_at: '2026-05-30T00:00:00Z',
    }
    const { container } = render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn('cpt-1')]}
          investigationId="cpt-1"
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
            makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
          ]}
          levelToScreen={(level: number) => 500 - level * 100}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set([0])} // layer 0 (A) is accepted, above B
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={vi.fn()}
          committedContactsForAnchor={[contact]}
          onUpdateContactDepth={onUpdateContactDepth}
        />
      </svg>,
    )
    // Drag layer B's TOP from depth 2 (clientY=200) down to depth 4 (clientY=400) — collapse B.
    // Fill direction: TOP drag collapse → extend layer ABOVE (= A, accepted) BASE to B's base (4).
    const top1 = container.querySelector('[data-testid="litho-drag-top-1"]')!
    fireEvent.mouseDown(top1, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 400 })
    fireEvent.mouseUp(document)
    // Must fire with field='base' — the above layer's BASE moves to 4, not its TOP.
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    expect(onUpdateContactDepth).toHaveBeenCalledWith('contact-at-2', 4, false, 'base')
  })

  // ZT-FILL4 — P1a mirror: collapse-BASE with accepted fill-neighbour BELOW.
  // The layer below must have its TOP (depth_top_m) moved upward — field='top'.
  it('ZT-FILL4 — collapse-base with accepted fill-neighbour below fires onUpdateContactDepth field=top', () => {
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    // Layer 0 (pending) at [0, 2]; layer 1 (accepted) at [2, 4].
    const contact = {
      id: 'contact-below',
      model_id: 'm',
      formation_id: 'f',
      borehole_id: null,
      cpt_id: 'cpt-1',
      depth_top_m: 2,
      source: 'manual_pick' as const,
      confidence: 'medium' as const,
      observation_id: null,
      observation_layer_id: null,
      notes: null,
      synthetic_x: null,
      synthetic_y: null,
      synthetic_elevation_m: null,
      parent_geo_contact_id: null,
      created_at: '2026-05-30T00:00:00Z',
      updated_at: '2026-05-30T00:00:00Z',
    }
    const { container } = render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn('cpt-1')]}
          investigationId="cpt-1"
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
            makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
          ]}
          levelToScreen={(level: number) => 500 - level * 100}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set([1])} // layer 1 is accepted, below layer 0
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={vi.fn()}
          committedContactsForAnchor={[contact]}
          onUpdateContactDepth={onUpdateContactDepth}
        />
      </svg>,
    )
    // Drag layer 0's BASE from depth 2 (clientY=300) up to depth 0 (clientY=100) — collapse layer 0.
    // Fill direction: BASE drag collapse → extend layer BELOW (= layer 1, accepted) TOP to layer 0's top (0).
    const base0 = container.querySelector('[data-testid="litho-drag-base-0"]')!
    fireEvent.mouseDown(base0, { clientY: 300 }) // depth 2 → levelToScreen(5-2)=300
    fireEvent.mouseMove(document, { clientY: 100 }) // depth 0 → collapse onto layer 0's top
    fireEvent.mouseUp(document)
    // Must fire with field='top' — the layer below has its TOP moved upward.
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    expect(onUpdateContactDepth).toHaveBeenCalledWith('contact-below', 0, false, 'top')
  })

  // CS4 — robust-fix follow-up (dogfeed 2026-05-30). When
  // ``contactIdsByAcceptedIdx`` is populated, the cross-store
  // dispatch picks the contact by IDENTITY (id match) instead of
  // by depth tolerance. Survives contact-drift drag sequences where
  // the committed contact's depth_top_m no longer matches the
  // pending's pre-drag boundary depth (because the user moved the
  // contact via ContactsLayer drag after accept).
  it('CS4 — identity match survives contact-drift (depth differs by >1 cm)', () => {
    const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
    // Layer 0 accepted; layer 1 pending. The committed contact for
    // the boundary between them sits at depth 2.45 — DRIFTED from
    // the pre-drag boundary depth (which is 2.0, layer 1's TOP).
    // Pre-fix (depth tolerance 1 cm) the match would FAIL because
    // |2.45 - 2.0| > 0.01. With the identity map, the contact is
    // found by id and the PATCH fires.
    const driftedContact = {
      id: 'contact-drifted',
      model_id: 'm',
      formation_id: 'f',
      borehole_id: null,
      cpt_id: 'cpt-1',
      depth_top_m: 2.45, // drifted from the pre-drag boundary at 2.0
      source: 'manual_pick' as const,
      confidence: 'medium' as const,
      observation_id: null,
      observation_layer_id: null,
      notes: null,
      synthetic_x: null,
      synthetic_y: null,
      synthetic_elevation_m: null,
      parent_geo_contact_id: null,
      created_at: '2026-05-30T00:00:00Z',
      updated_at: '2026-05-30T00:00:00Z',
    }
    const { container } = render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn('cpt-1')]}
          investigationId="cpt-1"
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
            makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
          ]}
          levelToScreen={(level: number) => 500 - level * 100}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set([0])}
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={vi.fn()}
          committedContactsForAnchor={[driftedContact]}
          contactIdsByAcceptedIdx={new Map([[0, ['contact-drifted']]])}
          onUpdateContactDepth={onUpdateContactDepth}
        />
      </svg>,
    )
    // Drag layer 1's top UP from depth 2 (clientY=300) to depth 1
    // (clientY=200). The pre-drag boundary depth is 2.0; the
    // contact's CURRENT depth_top_m is 2.45 — doesn't match the
    // 1-cm tolerance. Pre-fix the PATCH would NOT fire. Post-fix
    // the identity map ensures it does.
    const top1 = container.querySelector('[data-testid="litho-drag-top-1"]')!
    fireEvent.mouseDown(top1, { clientY: 300 })
    fireEvent.mouseMove(document, { clientY: 200 })
    fireEvent.mouseUp(document)
    expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
    // Identity-resolved contact for the ABOVE accepted layer → field='base'.
    expect(onUpdateContactDepth).toHaveBeenCalledWith('contact-drifted', 1, false, 'base')
  })

  // CS3 — no PATCH fires when the drag didn't actually move the
  // boundary (defensive — protects against an accidental PATCH on a
  // mousedown-mouseup with no movement).
  it('CS3 — drag with no movement does not fire onUpdateContactDepth', () => {
    const onUpdateContactDepth = vi.fn()
    const contact = {
      id: 'c',
      model_id: 'm',
      formation_id: 'f',
      borehole_id: null,
      cpt_id: 'cpt-1',
      depth_top_m: 2,
      source: 'manual_pick' as const,
      confidence: 'medium' as const,
      observation_id: null,
      observation_layer_id: null,
      notes: null,
      synthetic_x: null,
      synthetic_y: null,
      synthetic_elevation_m: null,
      parent_geo_contact_id: null,
      created_at: '2026-05-30T00:00:00Z',
      updated_at: '2026-05-30T00:00:00Z',
    }
    const { container } = render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[makeColumn('cpt-1')]}
          investigationId="cpt-1"
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
            makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
          ]}
          levelToScreen={(level: number) => 500 - level * 100}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set([0])}
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={vi.fn()}
          committedContactsForAnchor={[contact]}
          onUpdateContactDepth={onUpdateContactDepth}
        />
      </svg>,
    )
    const top1 = container.querySelector('[data-testid="litho-drag-top-1"]')!
    fireEvent.mouseDown(top1, { clientY: 300 })
    // No mousemove — release at the same position.
    fireEvent.mouseUp(document)
    expect(onUpdateContactDepth).not.toHaveBeenCalled()
  })

  // Installer #42: Shift-drag a ghost boundary onto another test copies the whole
  // pending column there. The whole-column copy needs a second column as target.
  function renderTwoColumnGhost(onCopyGhostContactToColumn: (p: {
    sourceInvestigationId: string
    targetInvestigationId: string
    targetKind: 'cpt' | 'borehole'
  }) => void) {
    const source = makeColumn('cpt-a')
    const target = { ...makeColumn('cpt-b'), nudgedX: 400 } as unknown as PlacedColumn
    return render(
      <svg>
        <LithoSuggestionGhostColumns
          columns={[source, target]}
          investigationId="cpt-a"
          suggestions={[
            makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
            makeSuggestion({ depth_top_m: 2, depth_base_m: 4, suggested_lithology: 'KLEI' }),
          ]}
          levelToScreen={levelToScreen}
          surfaceElevationM={5}
          plotTop={0}
          plotBottom={600}
          bandHalfWidth={20}
          acceptedIndices={new Set()}
          rejectedIndices={new Set()}
          onAccept={vi.fn()}
          onReject={vi.fn()}
          onEdit={vi.fn()}
          onCopyGhostContactToColumn={onCopyGhostContactToColumn}
        />
      </svg>,
    )
  }

  it('GC1 — Shift-drag a ghost boundary onto another test fires the whole-column copy', () => {
    const onCopy = vi.fn()
    const { container } = renderTwoColumnGhost(onCopy)
    // Arm the copy: Shift-mousedown on a ghost boundary edge handle.
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')!
    fireEvent.mouseDown(topHandle, { clientX: 200, clientY: 100, shiftKey: true })
    // Drop targets render during the drag; the target column's rect is the hit target.
    const dropRect = container.querySelector('[data-testid="ghost-copy-drop-cpt-b"]')
    expect(dropRect).not.toBeNull()
    // jsdom has no elementsFromPoint — assign a stub that returns the target rect.
    const docAny = document as unknown as { elementsFromPoint?: unknown }
    const orig = docAny.elementsFromPoint
    docAny.elementsFromPoint = vi.fn().mockReturnValue([dropRect as Element])
    fireEvent.mouseMove(document, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(document, { clientX: 400, clientY: 300 })
    docAny.elementsFromPoint = orig
    expect(onCopy).toHaveBeenCalledWith({
      sourceInvestigationId: 'cpt-a',
      targetInvestigationId: 'cpt-b',
      targetKind: 'cpt',
    })
  })

  it('GC2 — a plain (no-Shift) boundary drag does not fire the ghost copy', () => {
    const onCopy = vi.fn()
    const { container } = renderTwoColumnGhost(onCopy)
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')!
    // No Shift → the normal edge-resize gesture; no drop targets are armed.
    fireEvent.mouseDown(topHandle, { clientX: 200, clientY: 100 })
    expect(container.querySelector('[data-testid="ghost-copy-drop-cpt-b"]')).toBeNull()
    fireEvent.mouseMove(document, { clientX: 400, clientY: 300 })
    fireEvent.mouseUp(document, { clientX: 400, clientY: 300 })
    expect(onCopy).not.toHaveBeenCalled()
  })

  it('GC3 — a Shift-drop back on the source column is a no-op', () => {
    const onCopy = vi.fn()
    const { container } = renderTwoColumnGhost(onCopy)
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')!
    fireEvent.mouseDown(topHandle, { clientX: 200, clientY: 100, shiftKey: true })
    // The source column is not a drop target (it has no ghost-copy-drop rect).
    expect(container.querySelector('[data-testid="ghost-copy-drop-cpt-a"]')).toBeNull()
    // Hit-test resolves to an element with no drop attributes → no target.
    const docAny = document as unknown as { elementsFromPoint?: unknown }
    const orig = docAny.elementsFromPoint
    docAny.elementsFromPoint = vi.fn().mockReturnValue([document.body as Element])
    fireEvent.mouseUp(document, { clientX: 200, clientY: 100 })
    docAny.elementsFromPoint = orig
    expect(onCopy).not.toHaveBeenCalled()
  })
})
