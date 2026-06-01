// Unit tests for LensWedgeOverlay (#163f Slice 2 frontend).
//
//   LW1  renders a wedge (fill + two boundary paths) for a lens whose three
//        defining contacts are on the section and form the 1→2 topology.
//   LW2  renders stored boundary nodes as draggable circles.
//   LW3  dragging a node commits the moved node via onSaveLensShape on mouseup.
//   LW4  mousedown on a boundary hit-band adds a node, committed on mouseup.
//   LW5  a lens whose contacts aren't all on the section is skipped.

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  FormationContactResponse,
  LensBoundaryResponse,
  LithoContactCorrelationEdge,
  LithoLensListItem,
} from '../../api/client'
import type { PlacedColumn } from './utils'
import LensWedgeOverlay from './LensWedgeOverlay'

afterEach(() => cleanup())

function contact(id: string, inv: string, depth: number): FormationContactResponse {
  return {
    id,
    model_id: 'm1',
    formation_id: 'f1',
    borehole_id: inv,
    cpt_id: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    depth_top_m: depth,
    source: 'manual_pick',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as FormationContactResponse
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

function lens(id: string, contentKey: string): LithoLensListItem {
  return {
    id,
    app_project_id: 'p1',
    model_id: 'm1',
    formation_id: 'f1',
    body_ordinal: 0,
    source_investigation_id: 'inv-source',
    name: null,
    primary_section_id: 's1',
    content_key: contentKey,
    extent_left_kind: null,
    extent_left_target_contact_id: null,
    extent_left_neighbour_inv_id: null,
    extent_right_kind: null,
    extent_right_target_contact_id: null,
    extent_right_neighbour_inv_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

function edge(a: string, b: string): LithoContactCorrelationEdge {
  return {
    id: `${a}-${b}`,
    contact_a_id: a,
    contact_b_id: b,
    model_id: 'm1',
    source: 'manual',
    user_approved: true,
    created_at: '2026-01-01T00:00:00Z',
  } as LithoContactCorrelationEdge
}

// Pinch target 'ct' at test T (along 0); source top 'cs-top' + base 'cs-base'
// at test S (along 50). ct has edges to both source contacts → it's the pinch.
const CT = 'ct'
const CS_TOP = 'cs-top'
const CS_BASE = 'cs-base'
const KEY = [CT, CS_TOP, CS_BASE].sort().join('|')

const baseContacts = [
  contact(CT, 'inv-T', 5),
  contact(CS_TOP, 'inv-S', 3),
  contact(CS_BASE, 'inv-S', 7),
]
const baseColumns = [column('inv-T', 0, 10), column('inv-S', 50, 10)]
const baseEdges = [edge(CT, CS_TOP), edge(CT, CS_BASE)]

// Identity-ish, invertible transforms.
const transforms = {
  alongToScreenX: (a: number) => a,
  levelToScreen: (l: number) => 100 - l,
  screenXToAlong: (x: number) => x,
  screenToLevel: (y: number) => 100 - y,
  plotTop: 0,
  plotBottom: 400,
}

function renderOverlay(
  props: Partial<Parameters<typeof LensWedgeOverlay>[0]> = {},
): ReturnType<typeof render> {
  return render(
    <svg>
      <LensWedgeOverlay
        lenses={[lens('L1', KEY)]}
        boundariesByLensId={new Map()}
        contacts={baseContacts}
        placedColumns={baseColumns}
        contactEdges={baseEdges}
        {...transforms}
        onSaveLensShape={vi.fn()}
        {...props}
      />
    </svg>,
  )
}

describe('LensWedgeOverlay', () => {
  it('LW1 — renders a wedge with two boundary paths for a 1→2 lens', () => {
    const { queryByTestId } = renderOverlay()
    expect(queryByTestId('lens-wedge-L1')).not.toBeNull()
    expect(queryByTestId('lens-boundary-upper-L1')).not.toBeNull()
    expect(queryByTestId('lens-boundary-lower-L1')).not.toBeNull()
  })

  it('LW2 — renders stored boundary nodes as circles', () => {
    const boundary: LensBoundaryResponse = {
      lens_id: 'L1',
      content_key: KEY,
      render_style: 'straight',
      primary_section_id: 's1',
      upper_nodes: [{ along_m: 25, elevation_m: 6 }],
      lower_nodes: [],
    }
    const { queryByTestId } = renderOverlay({
      boundariesByLensId: new Map([['L1', boundary]]),
    })
    expect(queryByTestId('lens-node-L1-upper-0')).not.toBeNull()
  })

  it('LW3 — dragging a node commits the moved node via onSaveLensShape', () => {
    const onSaveLensShape = vi.fn()
    const boundary: LensBoundaryResponse = {
      lens_id: 'L1',
      content_key: KEY,
      render_style: 'straight',
      primary_section_id: 's1',
      upper_nodes: [{ along_m: 25, elevation_m: 6 }],
      lower_nodes: [],
    }
    const { getByTestId } = renderOverlay({
      boundariesByLensId: new Map([['L1', boundary]]),
      onSaveLensShape,
    })
    fireEvent.mouseDown(getByTestId('lens-node-L1-upper-0'))
    fireEvent.mouseMove(document, { clientX: 30, clientY: 92 }) // along 30, elev 8
    fireEvent.mouseUp(document)
    expect(onSaveLensShape).toHaveBeenCalledTimes(1)
    const [lensId, upper, _lower, style] = onSaveLensShape.mock.calls[0]
    expect(lensId).toBe('L1')
    expect(style).toBe('straight')
    expect(upper).toHaveLength(1)
    expect(upper[0].along_m).toBeCloseTo(30, 5)
    expect(upper[0].elevation_m).toBeCloseTo(8, 5)
  })

  it('LW4 — mousedown on a boundary hit-band adds a node, committed on mouseup', () => {
    const onSaveLensShape = vi.fn()
    const { getByTestId } = renderOverlay({ onSaveLensShape })
    fireEvent.mouseDown(getByTestId('lens-boundary-hit-L1-upper'), { clientX: 20, clientY: 94 })
    fireEvent.mouseUp(document)
    expect(onSaveLensShape).toHaveBeenCalledTimes(1)
    const [, upper] = onSaveLensShape.mock.calls[0]
    expect(upper).toHaveLength(1) // a node was added
  })

  it('LW5 — skips a lens whose contacts are not all on the section', () => {
    const { queryByTestId } = renderOverlay({
      lenses: [lens('L1', ['ct', 'missing-a', 'missing-b'].sort().join('|'))],
    })
    expect(queryByTestId('lens-wedge-L1')).toBeNull()
  })

  it('LW6 — right-click the wedge fill dissolves the lens via onDeleteLens', () => {
    // The fill is the delete affordance; it reports the three defining contact
    // ids (above, below, target) so the caller can delete the two edges that
    // make the body a lens (dogfeed 2026-05-29).
    const onDeleteLens = vi.fn()
    const { getByTestId } = renderOverlay({ onDeleteLens })
    fireEvent.contextMenu(getByTestId('lens-wedge-fill-L1'))
    expect(onDeleteLens).toHaveBeenCalledTimes(1)
    // above = cs-top (3 m), below = cs-base (7 m), target/pinch = ct.
    expect(onDeleteLens).toHaveBeenCalledWith('cs-top', 'cs-base', 'ct')
  })

  it('LW7 — fill is inert (no pointer events) when onDeleteLens is absent', () => {
    const { getByTestId } = renderOverlay()
    // Read-only: the fill must not capture the context menu.
    expect(getByTestId('lens-wedge-fill-L1').getAttribute('style')).toContain(
      'pointer-events: none',
    )
  })

  it('LW8 — source endpoint is anchored at the source column EDGE, not centre', () => {
    // Source column ``inv-S`` sits at along=50 with width=40 → its facing
    // (left) edge toward target ``inv-T`` (at along=0) is at along=30 in
    // screen px (identity transforms in this test). The upper boundary
    // path runs from the pinch on inv-T to the source-top contact on
    // inv-S — its rightmost x must therefore be 30, not 50 (centre).
    //
    // Owner dogfeed 2026-05-31: pre-fix, the wedge started "inside" the
    // column at its centre; now it starts at the facing edge so the
    // wedge taper begins flush with the column glyph.
    const { getByTestId } = renderOverlay()
    const d = getByTestId('lens-boundary-upper-L1').getAttribute('d') ?? ''
    // Path is "M x,y L x,y..." — extract every x coordinate.
    const xs = Array.from(d.matchAll(/[ML]\s*([-\d.]+),/g)).map(m => parseFloat(m[1]))
    // The pinch end (target column ``inv-T`` at along=0, width=40 → right
    // edge at along=20) is the smaller x; the source end is the larger.
    const maxX = Math.max(...xs)
    const minX = Math.min(...xs)
    expect(maxX).toBeCloseTo(30, 1) // source EDGE, not 50 (centre)
    expect(minX).toBeCloseTo(20, 1) // pinch EDGE, not 0 (centre)
  })

  it('LW9 — bilateral closure renders a SECOND wedge to the other target', () => {
    // Two pinch targets share the source pair (cs-top, cs-base): the
    // primary ``ct`` on inv-T and a new ``ct2`` on inv-T2. The detector's
    // bilateral rule guarantees this is exactly when a lens fires; the
    // overlay must render BOTH closures so the body looks closed on
    // both sides (owner dogfeed 2026-05-31, "we're moving that up").
    const CT2 = 'ct2'
    const contacts2 = [...baseContacts, contact(CT2, 'inv-T2', 5)]
    const columns2 = [...baseColumns, column('inv-T2', 100, 10)]
    const edges2 = [...baseEdges, edge(CT2, CS_TOP), edge(CT2, CS_BASE)]
    const { queryByTestId } = renderOverlay({
      contacts: contacts2,
      placedColumns: columns2,
      contactEdges: edges2,
    })
    // Primary wedge keys off the lens id verbatim; secondary keys append
    // the secondary target contact id.
    expect(queryByTestId('lens-wedge-L1')).not.toBeNull()
    expect(queryByTestId(`lens-wedge-L1::${CT2}`)).not.toBeNull()
  })

  it('LW10 — secondary wedge has no draggable shape nodes', () => {
    // Stored boundary nodes apply to the primary wedge only — the data
    // model carries one boundary set per lens until Phase 5 ships
    // two-sided lens authoring. The secondary stays a straight pinch.
    const CT2 = 'ct2'
    const contacts2 = [...baseContacts, contact(CT2, 'inv-T2', 5)]
    const columns2 = [...baseColumns, column('inv-T2', 100, 10)]
    const edges2 = [...baseEdges, edge(CT2, CS_TOP), edge(CT2, CS_BASE)]
    const boundaries = new Map<string, LensBoundaryResponse>([
      [
        'L1',
        {
          lens_id: 'L1',
          content_key: KEY,
          render_style: 'straight',
          primary_section_id: 's1',
          upper_nodes: [{ along_m: 25, elevation_m: 6 }],
          lower_nodes: [{ along_m: 25, elevation_m: 4 }],
        },
      ],
    ])
    const { queryByTestId } = renderOverlay({
      contacts: contacts2,
      placedColumns: columns2,
      contactEdges: edges2,
      boundariesByLensId: boundaries,
    })
    // Primary wedge has the editable node + boundary-hit band.
    expect(queryByTestId('lens-node-L1-upper-0')).not.toBeNull()
    expect(queryByTestId('lens-boundary-hit-L1-upper')).not.toBeNull()
    // Secondary has neither (no node-drag editing on secondary side).
    expect(queryByTestId(`lens-node-L1::${CT2}-upper-0`)).toBeNull()
    expect(queryByTestId(`lens-boundary-hit-L1::${CT2}-upper`)).toBeNull()
  })
})
