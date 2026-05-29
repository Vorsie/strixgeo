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
    name: null,
    primary_section_id: 's1',
    content_key: contentKey,
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
})
