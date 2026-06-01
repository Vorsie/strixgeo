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
  FormationContactResponse,
  LithoContactCorrelationEdge,
  PinchOutCandidate,
} from '../../api/client'
import type { PlacedColumn } from './utils'
import BodyExtentOverlay, { halfwayFarPoint, type Props } from './BodyExtentOverlay'
import { makeBody } from './__tests__/bodyTestFixtures'

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

  it('BE15 — multi-formation source frames the wedge to the body’s own layer, not the whole column', () => {
    // Regression for the section-filling-triangle bug (dogfeed 2026-06-01):
    // source ``inv-src2`` carries THREE formations — fA (1 m), fMID (4 m),
    // fC (8 m). The body is formation ``fMID``. Its wedge TOP must sit at the
    // fMID contact (4 m → elev 6 → screen y 94), NOT at the column top fA
    // (1 m → elev 9 → screen y 91) which the old shallowest+deepest fallback
    // produced.
    const srcContacts = [
      { ...contact('c-fa', 'inv-src2', 1), formation_id: 'fA' },
      { ...contact('c-fmid', 'inv-src2', 4), formation_id: 'fMID' },
      { ...contact('c-fc', 'inv-src2', 8), formation_id: 'fC' },
      { ...contact('ct2', 'inv-T2', 5), formation_id: 'fMID' },
    ] as FormationContactResponse[]
    const cols = [column('inv-src2', 50, 10), column('inv-T2', 0, 10)]
    const { getByTestId } = renderOverlay({
      bodies: [
        makeBody({
          formation_id: 'fMID',
          content_key: null,
          source_investigation_id: 'inv-src2',
          extent_left_kind: 'to_target',
          extent_left_target_contact_id: 'ct2',
        }),
      ],
      contacts: srcContacts,
      placedColumns: cols,
      contactEdges: [],
    })
    const d = getByTestId('body-boundary-upper-B1').getAttribute('d') ?? ''
    const pts = Array.from(d.matchAll(/[ML]\s*([-\d.]+),([-\d.]+)/g)).map(m => ({
      x: parseFloat(m[1]),
      y: parseFloat(m[2]),
    }))
    // The source-edge endpoint is the max-x point (source column at along=50,
    // target at along=0). Its y must be the fMID top (94), not the column top (91).
    const sourceEdge = pts.reduce((a, b) => (b.x > a.x ? b : a))
    expect(sourceEdge.y).toBeCloseTo(94, 1)
    expect(sourceEdge.y).not.toBeCloseTo(91, 1)
  })

  it('BE16 — stacked formation: wedge frames the occurrence its target correlates to, not the shallowest', () => {
    // Regression (dogfeed 2026-06-01, screenshot): formation ``fX`` appears at
    // TWO depths on the source — 2 m (upper) and 8 m (lower). The body's target
    // contact correlates to the LOWER occurrence (8 m). The wedge must frame at
    // 8 m (elev 2 → screen y 98), NOT the shallowest fX at 2 m (elev 8 → y 92)
    // which the formation_id-only proxy picked.
    const srcContacts = [
      { ...contact('s-fx-hi', 'inv-s3', 2), formation_id: 'fX' },
      { ...contact('s-other', 'inv-s3', 3), formation_id: 'fOther' },
      { ...contact('s-fx-lo', 'inv-s3', 8), formation_id: 'fX' },
      { ...contact('s-fy', 'inv-s3', 10), formation_id: 'fY' },
      { ...contact('ct3', 'inv-T3', 9), formation_id: 'fX' },
    ] as FormationContactResponse[]
    const cols = [column('inv-s3', 50, 10), column('inv-T3', 0, 10)]
    // Target ct3 correlates to the LOWER fX pair (8 m top + 10 m base).
    const edges3 = [edge('ct3', 's-fx-lo'), edge('ct3', 's-fy')]
    const { getByTestId } = renderOverlay({
      bodies: [
        makeBody({
          formation_id: 'fX',
          content_key: null,
          source_investigation_id: 'inv-s3',
          extent_left_kind: 'to_target',
          extent_left_target_contact_id: 'ct3',
        }),
      ],
      contacts: srcContacts,
      placedColumns: cols,
      contactEdges: edges3,
    })
    const d = getByTestId('body-boundary-upper-B1').getAttribute('d') ?? ''
    const pts = Array.from(d.matchAll(/[ML]\s*([-\d.]+),([-\d.]+)/g)).map(m => ({
      x: parseFloat(m[1]),
      y: parseFloat(m[2]),
    }))
    const sourceEdge = pts.reduce((a, b) => (b.x > a.x ? b : a))
    expect(sourceEdge.y).toBeCloseTo(98, 1) // lower fX at 8 m
    expect(sourceEdge.y).not.toBeCloseTo(92, 1) // NOT the shallow fX at 2 m
  })

  it('BE17 — unnamed body shows the auto-label (base + depth rank, no space)', () => {
    const { getByTestId } = renderOverlay({
      formationLabelById: new Map([['f1', 'QPSa']]),
    })
    // Default makeBody has name=null, formation_id='f1', body_ordinal=0.
    expect(getByTestId('body-label-B1').textContent).toBe('QPSa1')
  })

  it('BE18 — explicit name overrides the auto-label', () => {
    const { getByTestId } = renderOverlay({
      bodies: [
        makeBody({
          name: 'Channel sand',
          content_key: LEGACY_KEY,
          extent_left_kind: 'to_target',
          extent_left_target_contact_id: CT,
        }),
      ],
      formationLabelById: new Map([['f1', 'ZAND']]),
    })
    expect(getByTestId('body-label-B1').textContent).toBe('Channel sand')
  })

  it('BE19 — depth rank: shallower lens is 1, deeper is 2 within a formation', () => {
    // Two ``fSand`` lenses on the same source at different depths; each closes
    // to its own target. The shallow one (3 m) must label "QPSa1", the deep
    // one (9 m) "QPSa2" — dynamic depth rank, not the stored body_ordinal.
    const srcContacts = [
      { ...contact('a-top', 'inv-s4', 3), formation_id: 'fSand' },
      { ...contact('a-base', 'inv-s4', 4), formation_id: 'fOther' },
      { ...contact('b-top', 'inv-s4', 9), formation_id: 'fSand' },
      { ...contact('b-base', 'inv-s4', 10), formation_id: 'fOther2' },
      { ...contact('tA', 'inv-T4', 3), formation_id: 'fSand' },
      { ...contact('tB', 'inv-T4', 9), formation_id: 'fSand' },
    ] as FormationContactResponse[]
    const cols = [column('inv-s4', 50, 12), column('inv-T4', 0, 12)]
    const edges4 = [
      edge('tA', 'a-top'),
      edge('tA', 'a-base'),
      edge('tB', 'b-top'),
      edge('tB', 'b-base'),
    ]
    const { getByTestId } = renderOverlay({
      bodies: [
        makeBody({
          id: 'BA',
          formation_id: 'fSand',
          body_ordinal: 0,
          source_investigation_id: 'inv-s4',
          content_key: null,
          extent_left_kind: 'to_target',
          extent_left_target_contact_id: 'tA',
        }),
        makeBody({
          id: 'BB',
          formation_id: 'fSand',
          body_ordinal: 1,
          source_investigation_id: 'inv-s4',
          content_key: null,
          extent_left_kind: 'to_target',
          extent_left_target_contact_id: 'tB',
        }),
      ],
      contacts: srcContacts,
      placedColumns: cols,
      contactEdges: edges4,
      formationLabelById: new Map([['fSand', 'QPSa']]),
    })
    expect(getByTestId('body-label-BA').textContent).toBe('QPSa1')
    expect(getByTestId('body-label-BB').textContent).toBe('QPSa2')
  })
})

// ---------------------------------------------------------------------------
// E2 — memoization correctness across re-renders
// ---------------------------------------------------------------------------
//
//   E2-RERENDER The overlay renders correctly on initial mount, and
//               re-rendering with identical props produces the same output
//               (no stale data, no dropped elements).

describe('BodyExtentOverlay memoization correctness', () => {
  it('E2-RERENDER — renders correctly on initial mount and re-render with same props', () => {
    const { queryByTestId, rerender } = renderOverlay()

    // Initial render: fill + boundaries present.
    expect(queryByTestId('body-extent-B1')).not.toBeNull()
    expect(queryByTestId('body-extent-fill-B1')).not.toBeNull()
    expect(queryByTestId('body-boundary-upper-B1')).not.toBeNull()
    expect(queryByTestId('body-boundary-lower-B1')).not.toBeNull()

    // Re-render with the same props (simulates a parent re-render that doesn't
    // change any of the memo dependencies — e.g. a drag on a sibling component).
    rerender(
      <svg>
        <BodyExtentOverlay
          bodies={[
            makeBody({
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
        />
      </svg>,
    )

    // All elements still present after re-render — memo didn't lose any state.
    expect(queryByTestId('body-extent-B1')).not.toBeNull()
    expect(queryByTestId('body-extent-fill-B1')).not.toBeNull()
    expect(queryByTestId('body-boundary-upper-B1')).not.toBeNull()
    expect(queryByTestId('body-boundary-lower-B1')).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// R1 helper — halfwayFarPoint contract
// ---------------------------------------------------------------------------
//
//   HFP1 returns the midpoint along between source and neighbour columns,
//        and the vertical midpoint between topSource and baseSource elevations.
//   HFP2 handles asymmetric column positions correctly (neighbour left of source).
//   HFP3 equal elevations produce the same elevation as both inputs.

describe('halfwayFarPoint', () => {
  it('HFP1 — midpoint along + elevation between source and neighbour', () => {
    const result = halfwayFarPoint(
      { along: 40 },
      { along: 100 },
      { elevation_m: 8 },
      { elevation_m: 4 },
    )
    expect(result.along_m).toBeCloseTo(70, 10) // (40 + 100) / 2
    expect(result.elevation_m).toBeCloseTo(6, 10) // (8 + 4) / 2
  })

  it('HFP2 — neighbour to the LEFT of source (negative direction)', () => {
    const result = halfwayFarPoint(
      { along: 100 },
      { along: 20 },
      { elevation_m: 10 },
      { elevation_m: 6 },
    )
    expect(result.along_m).toBeCloseTo(60, 10) // (100 + 20) / 2
    expect(result.elevation_m).toBeCloseTo(8, 10) // (10 + 6) / 2
  })

  it('HFP3 — equal top/base elevations produce the same elevation in the result', () => {
    const result = halfwayFarPoint(
      { along: 0 },
      { along: 60 },
      { elevation_m: 5 },
      { elevation_m: 5 },
    )
    expect(result.elevation_m).toBeCloseTo(5, 10)
  })
})
