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
  return {
    nudgedX: 200,
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
    onUnreject?: (idx: number) => void
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
        onUnreject={opts.onUnreject}
        formations={opts.formations}
        edits={opts.edits}
        onEdit={opts.onEdit}
        onCrossColumnPaste={opts.onCrossColumnPaste}
        onInsertLayer={opts.onInsertLayer}
        onSplitLayer={opts.onSplitLayer}
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

  it('G14 — accepted layer rect has pointerEvents=none so clicks pass through', () => {
    // Pins the dogfeed 2026-05-20 bug: existing accepted litho was
    // capturing left-clicks the user intended for the underlying
    // ContactPickBar (place a new contact). Accepted/rejected layers
    // are now click-through to let the underlying bar receive the
    // event. The rect's style.pointerEvents must be 'none' to enable
    // SVG event pass-through.
    const { container } = renderGhost([makeSuggestion()], {
      acceptedIndices: new Set([0]),
    })
    const rect = container.querySelector('rect')
    expect(rect).not.toBeNull()
    expect((rect as SVGRectElement).style.pointerEvents).toBe('none')
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
    // Layer base starts at depth 2 → drag 50 px down → delta 0.5 m
    // → new depth_base_m = 2.5.
    const onEdit = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 250 })
    fireEvent.mouseUp(document)
    expect(onEdit).toHaveBeenCalledTimes(1)
    const [idx, edit] = onEdit.mock.calls[0]
    expect(idx).toBe(0)
    expect(edit.depth_top_m).toBeUndefined()
    expect(edit.depth_base_m).toBeCloseTo(2.5, 5)
  })

  // G23: ↻ undo icon renders on rejected layer when onUnreject wired (debt #80).
  it('G23 — rejected layer shows ↻ undo icon when onUnreject is wired', () => {
    const { container } = renderGhost([makeSuggestion()], {
      rejectedIndices: new Set([0]),
      onUnreject: vi.fn(),
    })
    const icon = container.querySelector('[data-testid="litho-unreject-0"]')
    expect(icon).not.toBeNull()
    // Pointer events must be auto on the icon group so it stays
    // clickable even though the parent rect is pointer-events:none.
    expect((icon as SVGGElement).style.pointerEvents).toBe('auto')
  })

  // G24: clicking the ↻ icon fires onUnreject with the layer index.
  it('G24 — clicking ↻ icon fires onUnreject with the layer idx', () => {
    const onUnreject = vi.fn()
    const { container } = renderGhost([makeSuggestion()], {
      rejectedIndices: new Set([0]),
      onUnreject,
    })
    const icon = container.querySelector('[data-testid="litho-unreject-0"]')
    fireEvent.click(icon!)
    expect(onUnreject).toHaveBeenCalledTimes(1)
    expect(onUnreject).toHaveBeenCalledWith(0)
  })

  // G25: icon is omitted when onUnreject prop is not wired (opt-in).
  it('G25 — rejected layer omits ↻ icon when onUnreject is undefined', () => {
    const { container } = renderGhost([makeSuggestion()], {
      rejectedIndices: new Set([0]),
      // onUnreject omitted
    })
    expect(container.querySelector('[data-testid="litho-unreject-0"]')).toBeNull()
  })

  // -----------------------------------------------------------------
  // Snap-to-collapse (debt #81) — dragging an edge onto the opposite
  // edge snaps and auto-rejects the layer on mouseup.
  // -----------------------------------------------------------------

  // G26: drag layer top down ~200 px (full layer height) → snap onto
  // own base → indicator visible + mouseup fires onReject(0).
  it('G26 — drag top down onto base snaps and auto-rejects the layer', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit, onReject },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')
    fireEvent.mouseDown(topHandle!, { clientY: 0 })
    // Move 200 px = 2 m down → currentDepth lands on base (2 m).
    fireEvent.mouseMove(document, { clientY: 200 })
    // Snap indicator is visible during the drag.
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).not.toBeNull()
    fireEvent.mouseUp(document)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith(0)
    // onEdit still fires the depth commit at the snap point.
    expect(onEdit).toHaveBeenCalledWith(0, { depth_top_m: 2 })
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
  // G32: pending-adjacent base-drag DOWN past neighbour's BASE.
  // The drag clamps at layer 1's FAR edge (its base = 4 m, the
  // total bottom of the dragged + neighbour pair); the snap there
  // auto-collapses layer 1 — the standard "absorb the neighbour
  // by dragging through it" gesture.
  it('G32 — pending-adjacent base-drag past neighbour opens merge dialog; Confirm commits', () => {
    // Debt #83 cascade + #84 merge prompt: snap-to-neighbour now defers
    // the edit + reject to a confirm dialog. The owner directive was
    // "cascade with prompt" — even a single-neighbour collapse asks.
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
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 700 })
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).not.toBeNull()
    fireEvent.mouseUp(document)
    // Before Confirm: dialog opens, NO edit or reject fired yet.
    expect(screen.getByTestId('merge-confirm-title')).toBeInTheDocument()
    expect(onEdit).not.toHaveBeenCalled()
    expect(onReject).not.toHaveBeenCalled()
    // Click Confirm → reject + edit fire as before.
    fireEvent.click(screen.getByTestId('merge-confirm-submit'))
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith(1)
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    const layer1Edit = onEdit.mock.calls.find(([idx]) => idx === 1)
    expect(layer0Edit?.[1].depth_base_m).toBeCloseTo(4, 5)
    expect(layer1Edit?.[1].depth_top_m).toBeCloseTo(4, 5)
  })

  // G33: mirror — drag layer 1's TOP UP past pending layer 0 to
  // layer 0's TOP (=0 m, ground). Auto-collapses layer 0 after Confirm.
  it('G33 — pending-adjacent top-drag past neighbour opens dialog; Confirm collapses neighbour above', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [
        makeSuggestion({ depth_top_m: 0, depth_base_m: 2 }),
        makeSuggestion({ depth_top_m: 2, depth_base_m: 4 }),
      ],
      { onEdit, onReject },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-1"]')
    fireEvent.mouseDown(topHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: -300 })
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).not.toBeNull()
    fireEvent.mouseUp(document)
    expect(screen.getByTestId('merge-confirm-title')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('merge-confirm-submit'))
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith(0)
    const layer1Edit = onEdit.mock.calls.find(([idx]) => idx === 1)
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    expect(layer1Edit?.[1].depth_top_m).toBeCloseTo(0, 5)
    expect(layer0Edit?.[1].depth_base_m).toBeCloseTo(0, 5)
  })

  // G34b — mirror of G34 for the OPPOSITE direction. Owner dogfeed
  // 2026-05-22: "rejected a layer, tried to pull the sand boundary
  // below it up, but couldn't pull onto the layer above the rejected
  // layer." With layer 1 (silt) rejected, dragging layer 2's TOP UP
  // must extend through the rejected region and clamp at layer 0's
  // BASE (the next-visible-above's NEAR edge). Pins debt #99 — covers
  // the direction G34 missed.
  it('G34b — with rejected between, top-drag UP fills the gap and clamps at the layer-above base', () => {
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
    // Drag way up past everything → clamps at layer 0's BASE (depth 2).
    fireEvent.mouseMove(document, { clientY: -500 })
    fireEvent.mouseUp(document)
    expect(onReject).not.toHaveBeenCalled()
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    const layer2Edit = onEdit.mock.calls.find(([idx]) => idx === 2)
    // Dragged layer 2's top extended to layer 0's base (= 2 m).
    expect(layer2Edit?.[1].depth_top_m).toBeCloseTo(2, 5)
    // Shared-boundary propagation: layer 0 gets the same edit (skipping
    // rejected layer 1) — fires even though its base was already at 2.
    expect(layer0Edit?.[1].depth_base_m).toBeCloseTo(2, 5)
    // Layer 1 (rejected) is never touched.
    expect(onEdit.mock.calls.find(([idx]) => idx === 1)).toBeUndefined()
  })

  // G37: Cancel in the merge dialog drops the whole gesture.
  it('G37 — Cancel in merge dialog fires no edit, no reject', () => {
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
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 700 })
    fireEvent.mouseUp(document)
    expect(screen.getByTestId('merge-confirm-title')).toBeInTheDocument()
    fireEvent.click(screen.getByTestId('merge-confirm-cancel'))
    expect(onEdit).not.toHaveBeenCalled()
    expect(onReject).not.toHaveBeenCalled()
  })

  // G34: the user's exact scenario from the 2026-05-20 dogfeed —
  // "if i reject silt between two clay layers, drag down the bottom
  // contact of the top layer to the top contact of the bottom layer".
  // With layer 1 (silt) rejected, dragging layer 0's BASE DOWN can
  // now extend through the rejected region and clamps at layer 2's
  // TOP (the next-visible-below's NEAR edge). The propagation moves
  // layer 2's TOP to the new boundary; layer 1 (rejected) is
  // untouched. NO auto-reject (the rejected silt is already gone).
  it('G34 — with rejected between, drag fills the gap and clamps at next visible near edge', () => {
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
    // Drag way past everything → clamps at layer 2's TOP (depth 4),
    // not layer 2's base (which would be the old #83 v1 behaviour).
    fireEvent.mouseMove(document, { clientY: 1500 })
    fireEvent.mouseUp(document)
    // No auto-reject — the bottom clay stays put.
    expect(onReject).not.toHaveBeenCalled()
    // Dragged layer 0's base extended to layer 2's top (= 4 m).
    const layer0Edit = onEdit.mock.calls.find(([idx]) => idx === 0)
    const layer2Edit = onEdit.mock.calls.find(([idx]) => idx === 2)
    expect(layer0Edit?.[1].depth_base_m).toBeCloseTo(4, 5)
    expect(layer2Edit?.[1].depth_top_m).toBeCloseTo(4, 5)
    // Layer 1 (rejected) is never touched — its stored depths stay
    // where they were so un-rejecting later restores it cleanly.
    expect(onEdit.mock.calls.find(([idx]) => idx === 1)).toBeUndefined()
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

  // G30: with the middle layer ACCEPTED, accepted is a hard visible
  // barrier (its committed contact says "this boundary is real").
  // Drag of layer 0's BASE is clamped at layer 1's TOP (= the
  // current shared boundary). The commit does NOT propagate past
  // the accepted layer — layer 2's stored top stays where it was
  // (otherwise we'd overwrite a pending edit with an irrelevant value
  // and create overlap with the accepted region).
  it('G30 — accepted between is a hard barrier, no propagation past it', () => {
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
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 300 })
    fireEvent.mouseUp(document)
    // Only the dragged layer's edit fires; no propagation past the
    // accepted barrier. Depth stays at the clamped value (2.0,
    // current shared boundary with the accepted neighbour).
    const calls = onEdit.mock.calls.map(([idx, edit]) => ({ idx, edit }))
    expect(calls.map(c => c.idx)).toEqual([0])
    expect(calls[0].edit.depth_base_m).toBeCloseTo(2, 5)
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
  it('G28 — drag base up onto top snaps and auto-rejects the layer', () => {
    const onEdit = vi.fn()
    const onReject = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit, onReject },
    )
    const baseHandle = container.querySelector('[data-testid="litho-drag-base-0"]')
    // base sits at depth 2 → clientY = 200 (per levelToScreen).
    fireEvent.mouseDown(baseHandle!, { clientY: 200 })
    fireEvent.mouseMove(document, { clientY: 0 }) // 2 m up → lands on top
    expect(container.querySelector('[data-testid="litho-snap-indicator"]')).not.toBeNull()
    fireEvent.mouseUp(document)
    expect(onReject).toHaveBeenCalledTimes(1)
    expect(onReject).toHaveBeenCalledWith(0)
    expect(onEdit).toHaveBeenCalledWith(0, { depth_base_m: 0 })
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
})
