// Unit tests for BodyExtentOverlay (#163f Slice 6 — per-side extent dispatch).
//
//   BE1  to_target kind renders a fill + two boundary paths (wedge).
//   BE2  NULL extent_kind → nothing rendered for that body.
//   BE3  pinch_out_halfway kind renders a fill + two boundary paths.
//   BE4  extrapolated kind renders fill + dip-arrow glyph.
//   BE5  open kind renders fill (parallel-sided band, no taper).
//   BE6  mixed body (to_target left + open right) renders both sides.
//   BE7  body not on section (source_investigation_id missing) is skipped.
//   BE8  right-click the fill dissolves the lens via onDeleteLens.
//   BE9  fill is inert when onDeleteLens is absent.
//   BE10 source endpoint is anchored at the source column EDGE, not centre.
//   BE11 node drag commits via onSaveLensShape on mouseup.
//   BE12 mousedown on boundary hit-band adds a node, committed on mouseup.
//   BE13 legacy content_key path (no extent fields) still renders a wedge.
//   BE14 bilateral closure renders secondary wedge to the other target.
//
// Ghost candidate rendering (Task 7.4):
//   BE-GHOST-RENDER ghost candidate for a source on this section renders as a
//                   dashed amber pinch-halfway wedge.
//   BE-GHOST-CLICK  clicking the ghost fill calls onClaimGhostCandidate with
//                   the exact PinchOutCandidate object.

import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  BodyBoundaryResponse,
  BodyListItem,
  FormationContactResponse,
  LithoContactCorrelationEdge,
  PinchOutCandidate,
} from '../../api/client'
import type { PlacedColumn } from './utils'
import BodyExtentOverlay, { type Props } from './BodyExtentOverlay'

afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// Test fixture builders
// ---------------------------------------------------------------------------

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

/**
 * Build a BodyListItem with extent fields for a body at ``inv-source`` (along=50)
 * with target on ``inv-T`` (along=0).
 */
function makeBody(overrides: Partial<BodyListItem> = {}): BodyListItem {
  return {
    id: 'B1',
    app_project_id: 'p1',
    model_id: 'm1',
    formation_id: 'f1',
    body_ordinal: 0,
    source_investigation_id: 'inv-source',
    name: null,
    primary_section_id: 's1',
    content_key: null,
    extent_left_kind: null,
    extent_left_target_contact_id: null,
    extent_left_neighbour_inv_id: null,
    extent_right_kind: null,
    extent_right_target_contact_id: null,
    extent_right_neighbour_inv_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

// Source contacts: top at 3 m, base at 7 m on ``inv-source`` (along=50, elev=10).
const CS_TOP = 'cs-top'
const CS_BASE = 'cs-base'
// Target pinch contact on ``inv-T`` (along=0, elev=10).
const CT = 'ct'
// Neighbour investigation for halfway/extrapolated kinds.
const NEIGHBOUR_INV = 'inv-N'

const baseContacts = [
  contact(CS_TOP, 'inv-source', 3),
  contact(CS_BASE, 'inv-source', 7),
  contact(CT, 'inv-T', 5),
]
const baseColumns = [
  column('inv-source', 50, 10),
  column('inv-T', 0, 10),
  column(NEIGHBOUR_INV, 100, 10),
]
// Edge set for the legacy content_key path.
const baseEdges = [edge(CT, CS_TOP), edge(CT, CS_BASE)]

// Legacy content_key body (mirrors LensWedgeOverlay tests).
const LEGACY_KEY = [CT, CS_TOP, CS_BASE].sort().join('|')

// Identity-ish transforms (screen coords == world coords).
const transforms = {
  alongToScreenX: (a: number) => a,
  levelToScreen: (l: number) => 100 - l,
  screenXToAlong: (x: number) => x,
  screenToLevel: (y: number) => 100 - y,
  plotTop: 0,
  plotBottom: 400,
  sectionStartScreenX: -20,
  sectionEndScreenX: 200,
}

function renderOverlay(props: Partial<Props> = {}): ReturnType<typeof render> {
  return render(
    <svg>
      <BodyExtentOverlay
        bodies={[
          makeBody({
            // Default: to_target left extent pointing at inv-T.
            content_key: LEGACY_KEY,
            extent_left_kind: 'to_target',
            extent_left_target_contact_id: CT,
            extent_left_neighbour_inv_id: null,
          }),
        ]}
        boundariesByBodyId={new Map()}
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

describe('BodyExtentOverlay', () => {
  it('BE1 — to_target kind renders fill + two boundary paths', () => {
    const { queryByTestId } = renderOverlay()
    expect(queryByTestId('body-extent-B1')).not.toBeNull()
    expect(queryByTestId('body-boundary-upper-B1')).not.toBeNull()
    expect(queryByTestId('body-boundary-lower-B1')).not.toBeNull()
    expect(queryByTestId('body-extent-fill-B1')).not.toBeNull()
  })

  it('BE2 — NULL extent kinds → nothing rendered', () => {
    const { queryByTestId } = renderOverlay({
      bodies: [makeBody({ content_key: null, extent_left_kind: null, extent_right_kind: null })],
    })
    expect(queryByTestId('body-extent-B1')).toBeNull()
  })

  it('BE3 — pinch_out_halfway kind renders fill + two boundary paths', () => {
    const { queryByTestId } = renderOverlay({
      bodies: [
        makeBody({
          content_key: null,
          extent_left_kind: 'pinch_out_halfway',
          extent_left_target_contact_id: null,
          extent_left_neighbour_inv_id: NEIGHBOUR_INV,
        }),
      ],
    })
    // The overlay needs the source contacts to find the framing pair.
    // Source has cs-top (3m) and cs-base (7m) on inv-source.
    expect(queryByTestId('body-extent-B1')).not.toBeNull()
    expect(queryByTestId('body-boundary-upper-B1')).not.toBeNull()
    expect(queryByTestId('body-boundary-lower-B1')).not.toBeNull()
  })

  it('BE4 — extrapolated kind renders fill + dip-arrow glyph', () => {
    const { queryByTestId } = renderOverlay({
      bodies: [
        makeBody({
          content_key: null,
          extent_left_kind: 'extrapolated',
          extent_left_target_contact_id: null,
          extent_left_neighbour_inv_id: NEIGHBOUR_INV,
        }),
      ],
    })
    expect(queryByTestId('body-extent-B1')).not.toBeNull()
    expect(queryByTestId('body-dip-arrow-B1')).not.toBeNull()
  })

  it('BE5 — open kind renders fill (parallel-sided band)', () => {
    const { queryByTestId } = renderOverlay({
      bodies: [
        makeBody({
          content_key: null,
          extent_right_kind: 'open',
          extent_right_neighbour_inv_id: null,
        }),
      ],
    })
    expect(queryByTestId('body-extent-B1')).not.toBeNull()
    expect(queryByTestId('body-extent-fill-B1')).not.toBeNull()
    // No dip-arrow for open.
    expect(queryByTestId('body-dip-arrow-B1')).toBeNull()
  })

  it('BE6 — mixed body (to_target left + open right) renders both sides', () => {
    const { queryByTestId } = renderOverlay({
      bodies: [
        makeBody({
          content_key: null,
          extent_left_kind: 'to_target',
          extent_left_target_contact_id: CT,
          extent_right_kind: 'open',
        }),
      ],
    })
    // Left side = primary (body id key), right side = secondary key (B1::right).
    expect(queryByTestId('body-extent-B1')).not.toBeNull()
    expect(queryByTestId('body-extent-B1::right')).not.toBeNull()
  })

  it('BE7 — body whose source is not on section is skipped', () => {
    const { queryByTestId } = renderOverlay({
      bodies: [
        makeBody({
          source_investigation_id: 'missing-inv',
          content_key: null,
          extent_left_kind: 'to_target',
          extent_left_target_contact_id: CT,
        }),
      ],
    })
    expect(queryByTestId('body-extent-B1')).toBeNull()
  })

  it('BE8 — right-click the fill dissolves the lens via onDeleteLens', () => {
    const onDeleteLens = vi.fn()
    const { getByTestId } = renderOverlay({ onDeleteLens })
    fireEvent.contextMenu(getByTestId('body-extent-fill-B1'))
    expect(onDeleteLens).toHaveBeenCalledTimes(1)
  })

  it('BE9 — fill is inert (pointer-events: none) when onDeleteLens is absent', () => {
    const { getByTestId } = renderOverlay({ onSaveLensShape: vi.fn() })
    expect(getByTestId('body-extent-fill-B1').getAttribute('style')).toContain(
      'pointer-events: none',
    )
  })

  it('BE10 — source endpoint is anchored at the source column EDGE, not centre', () => {
    // Source column ``inv-source`` sits at along=50 with width=40 → its left edge
    // facing target ``inv-T`` (at along=0) is at along=30 in screen px (identity
    // transforms). The upper boundary path's min-x must therefore be near 20
    // (pinch edge of inv-T width=40, right edge at 20) and max-x near 30 (source
    // left edge), not 50 (centre).
    const { getByTestId } = renderOverlay()
    const d = getByTestId('body-boundary-upper-B1').getAttribute('d') ?? ''
    const xs = Array.from(d.matchAll(/[ML]\s*([-\d.]+),/g)).map(m => parseFloat(m[1]))
    const maxX = Math.max(...xs)
    const minX = Math.min(...xs)
    expect(maxX).toBeCloseTo(30, 1) // source left edge, not 50 (centre)
    expect(minX).toBeCloseTo(20, 1) // pinch right edge, not 0 (centre)
  })

  it('BE11 — node drag commits via onSaveLensShape on mouseup', () => {
    const onSaveLensShape = vi.fn()
    const boundary: BodyBoundaryResponse = {
      lens_id: 'B1',
      content_key: LEGACY_KEY,
      render_style: 'straight',
      primary_section_id: 's1',
      upper_nodes: [{ along_m: 25, elevation_m: 6 }],
      lower_nodes: [],
    }
    const { getByTestId } = renderOverlay({
      boundariesByBodyId: new Map([['B1', boundary]]),
      onSaveLensShape,
    })
    fireEvent.mouseDown(getByTestId('body-node-B1-upper-0'))
    fireEvent.mouseMove(document, { clientX: 30, clientY: 92 }) // along 30, elev 8
    fireEvent.mouseUp(document)
    expect(onSaveLensShape).toHaveBeenCalledTimes(1)
    const [bodyId, upper, _lower, style] = onSaveLensShape.mock.calls[0]
    expect(bodyId).toBe('B1')
    expect(style).toBe('straight')
    expect(upper).toHaveLength(1)
    expect(upper[0].along_m).toBeCloseTo(30, 5)
    expect(upper[0].elevation_m).toBeCloseTo(8, 5)
  })

  it('BE12 — mousedown on boundary hit-band adds a node, committed on mouseup', () => {
    const onSaveLensShape = vi.fn()
    const { getByTestId } = renderOverlay({ onSaveLensShape })
    fireEvent.mouseDown(getByTestId('body-boundary-hit-B1-upper'), { clientX: 20, clientY: 94 })
    fireEvent.mouseUp(document)
    expect(onSaveLensShape).toHaveBeenCalledTimes(1)
    const [, upper] = onSaveLensShape.mock.calls[0]
    expect(upper).toHaveLength(1) // a node was added
  })

  it('BE13 — legacy content_key path (no extent fields) renders a wedge', () => {
    // A body with only a content_key and no extent_kind fields should still
    // render using the legacy bilateral resolution path.
    const { queryByTestId } = renderOverlay({
      bodies: [
        makeBody({
          content_key: LEGACY_KEY,
          extent_left_kind: null,
          extent_right_kind: null,
        }),
      ],
      contactEdges: baseEdges,
    })
    expect(queryByTestId('body-extent-B1')).not.toBeNull()
    expect(queryByTestId('body-boundary-upper-B1')).not.toBeNull()
    expect(queryByTestId('body-boundary-lower-B1')).not.toBeNull()
  })

  it('BE14 — bilateral closure (legacy path) renders a secondary wedge', () => {
    // Two pinch targets share the source pair: the primary CT on inv-T and
    // a second CT2 on inv-T2. The overlay must render BOTH closures.
    const CT2 = 'ct2'
    const contacts2 = [...baseContacts, contact(CT2, 'inv-T2', 5)]
    const columns2 = [...baseColumns, column('inv-T2', 100, 10)]
    const edges2 = [...baseEdges, edge(CT2, CS_TOP), edge(CT2, CS_BASE)]
    const { queryByTestId } = renderOverlay({
      bodies: [makeBody({ content_key: LEGACY_KEY, extent_left_kind: null, extent_right_kind: null })],
      contacts: contacts2,
      placedColumns: columns2,
      contactEdges: edges2,
    })
    expect(queryByTestId('body-extent-B1')).not.toBeNull()
    expect(queryByTestId(`body-extent-B1::${CT2}`)).not.toBeNull()
  })

  it('BE-GHOST-RENDER — ghost candidate for a source on this section renders dashed amber wedge', () => {
    // A PinchOutCandidate whose source_investigation_id is on this section
    // and whose suggested_neighbour_investigation_id is also on this section
    // should render a dashed amber ghost fill path.
    const candidate: PinchOutCandidate = {
      body_id: null,
      source_investigation_id: 'inv-source',
      above_contact_id: CS_TOP,
      below_contact_id: CS_BASE,
      side: 'left',
      suggested_neighbour_investigation_id: NEIGHBOUR_INV,
    }
    const onClaimGhostCandidate = vi.fn()
    const { queryByTestId } = renderOverlay({
      bodies: [],
      ghostCandidates: [candidate],
      onClaimGhostCandidate,
    })
    // Ghost fill path exists and is testid-accessible.
    expect(queryByTestId('body-ghost-fill-inv-source-left')).not.toBeNull()
  })

  it('BE-GHOST-CLICK — clicking ghost fill calls onClaimGhostCandidate with the candidate', () => {
    // Clicking the ghost wedge fill should invoke onClaimGhostCandidate with
    // the exact PinchOutCandidate object (not a subset — caller needs body_id,
    // source_investigation_id, side, above/below contact ids).
    const candidate: PinchOutCandidate = {
      body_id: null,
      source_investigation_id: 'inv-source',
      above_contact_id: CS_TOP,
      below_contact_id: CS_BASE,
      side: 'left',
      suggested_neighbour_investigation_id: NEIGHBOUR_INV,
    }
    const onClaimGhostCandidate = vi.fn()
    const { getByTestId } = renderOverlay({
      bodies: [],
      ghostCandidates: [candidate],
      onClaimGhostCandidate,
    })
    fireEvent.click(getByTestId('body-ghost-fill-inv-source-left'))
    expect(onClaimGhostCandidate).toHaveBeenCalledTimes(1)
    expect(onClaimGhostCandidate).toHaveBeenCalledWith(candidate)
  })
})
