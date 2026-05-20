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

import { cleanup, fireEvent, render } from '@testing-library/react'
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
      item: { id, kind: 'cpt', name: 'CPT-1' } as PlacedColumn['proj']['item'],
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
    edits?: ReadonlyMap<number, { depth_top_m?: number; depth_base_m?: number }>
    onEdit?: (idx: number, edit: { depth_top_m?: number; depth_base_m?: number }) => void
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
        onAccept={vi.fn()}
        onReject={vi.fn()}
        formations={opts.formations}
        edits={opts.edits}
        onEdit={opts.onEdit}
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
    // transform). Drag 250 px down → depth delta = 2.5 m.
    // Layer top starts at depth 0 → after drag, depth_top_m = 2.5.
    const onEdit = vi.fn()
    const { container } = renderGhost(
      [makeSuggestion({ depth_top_m: 0, depth_base_m: 2 })],
      { onEdit },
    )
    const topHandle = container.querySelector('[data-testid="litho-drag-top-0"]')
    expect(topHandle).not.toBeNull()
    fireEvent.mouseDown(topHandle!, { clientY: 100 })
    fireEvent.mouseMove(document, { clientY: 350 })
    fireEvent.mouseUp(document)
    expect(onEdit).toHaveBeenCalledTimes(1)
    const [idx, edit] = onEdit.mock.calls[0]
    expect(idx).toBe(0)
    expect(edit.depth_top_m).toBeCloseTo(2.5, 5)
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
    // Mirror of G16 for the BASE edge. Drag layer 0's base → both
    // layer 0's base AND layer 1's top move.
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

  it('G15 — pending layer rect keeps pointer cursor (drives click-to-accept)', () => {
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
})
