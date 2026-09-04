// Render tests for PartitionFillOverlay — the partition (no overlaps / no gaps)
// litho section fill.
//
//   PFO1 a matched two-body stack renders one region path per body + labels.
//   PFO2 showBands=false → no fill rendered.
//   PFO3 right-click a region opens the body context menu.
//   PFO4 an interrupted body (clay below silt on the left, clay at surface +
//        below silt on the right) renders as TWO clay regions, not one.
//
// --- Legacy single-node tests (still valid: N=1 is the base case of N≥1) ---
//   PFO5 an enclosed lens carries at least one draggable handle when a node
//        is stored.
//   PFO6 a stored apex override (single node) repositions the lens pinch.
//   PFO7 dragging a lens node persists the shape via onSaveBoundary.
//
//   MB1  a matched boundary renders a draggable handle when a node is stored.
//   MB2  a stored lower_nodes node on the upper body bends both polygons.
//   MB3  dragging the boundary calls onSaveBoundary with lower_nodes on the
//        upper body.
//   MB4  lens-apex and matched-boundary handles coexist.
//
// --- Multi-node freedraw (new) --------------------------------------------
//   FD1  a matched boundary with TWO stored lower_nodes renders two handles and
//        both the upper and lower region polygons each gain TWO interior vertices.
//   FD2  clicking the matched-boundary add-strip calls onSaveBoundary with the
//        new node appended to lower_nodes.
//   FD3  right-clicking a control-point handle calls onSaveBoundary with that
//        node removed.
//   FD4  a lens with stored upper_nodes and lower_nodes renders a multi-point
//        wedge (polygon vertex count > 3) and still excludes itself from the
//        partition tiling.
//
// --- Performance regression (debt #209) -----------------------------------
//   TEST-04  computeSectionFill is NOT called again when only the screen-
//            transform props change (levelToScreen / plotTop / plotBottom) while
//            contact/edge data stays identical. A pan or zoom that only moves
//            the elevation-to-pixel mapping must not re-run the expensive LCS
//            + polygon engine.
//
// --- Zoom-adaptive label model (owner dogfeed 2026-06-24) -----------------
//   ZAL1  A tall body renders its <text> label (fit gate passes).
//   ZAL2  A very short body (< MIN_FONT + margin px) renders NO label.
//   ZAL3  One label per body — a body spanning two gap segments renders ONE
//         <text>, not two.
//   ZAL4  Label x,y is inside the region bounding box — regression guard for
//         the bbox-centre "sand label on clay" placement bug.

import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  BodyBoundaryResponse,
  BodyListItem,
  LithoContactCorrelationEdge,
  LithoLayerResponse,
} from '../../api/client'
import type { PartitionRegion } from '../../utils/sectionPartition'
import * as partitionEngineSelect from '../../utils/partitionEngineSelect'
import PartitionFillOverlay from './PartitionFillOverlay'
import { isApexShapeable } from './partitionFillOverlayHelpers'
import type { Props } from './PartitionFillOverlay'
import type { PlacedColumn } from './utils'

afterEach(() => cleanup())

function layer(
  id: string,
  inv: string,
  bodyId: string,
  formationId: string,
  top: number,
  base: number,
): LithoLayerResponse {
  return {
    id,
    model_id: 'm1',
    formation_id: formationId,
    borehole_id: inv,
    cpt_id: null,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: bodyId,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as LithoLayerResponse
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

const colors = new Map([
  ['fSand', '#fbbf24'],
  ['fClay', '#6b7280'],
  ['fSilt', '#84cc16'],
])
const labels = new Map([
  ['fSand', 'Sa'],
  ['fClay', 'C'],
  ['fSilt', 'Si'],
])

// Base fixture: two-body matched stack, L at x=0 (leftX=-20, rightX=20),
// R at x=100 (leftX=80, rightX=120).  Gap: leftX=20, rightX=80.
const base: Props = {
  lithoLayers: [
    layer('a1', 'L', 'sand', 'fSand', 0, 5),
    layer('a2', 'L', 'clay', 'fClay', 5, 10),
    layer('b1', 'R', 'sand', 'fSand', 0, 6),
    layer('b2', 'R', 'clay', 'fClay', 6, 10),
  ],
  placedColumns: [column('L', 0, 10), column('R', 100, 10)],
  formationColorById: colors,
  formationLabelById: labels,
  showBands: true,
  levelToScreen: (l: number) => 100 - l * 10, // 10 m ⇒ 100 px tall
  plotTop: 0,
  plotBottom: 400,
  plotLeft: 0,
  plotRight: 200,
}

function renderOverlay(props: Partial<Props> = {}): ReturnType<typeof render> {
  return render(
    <svg>
      <PartitionFillOverlay {...base} {...props} />
    </svg>,
  )
}

// Shared transform props used across boundary + lens tests.
const transforms = {
  alongToScreenX: (a: number) => a,
  screenXToAlong: (x: number) => x,
  screenToLevel: (y: number) => (100 - y) / 10, // inverse of levelToScreen
}

/**
 * An approved contact tie between the BASE of ``a`` and the BASE of ``b`` — the
 * correlation an engineer draws to say "this contact is the same surface on both
 * columns".
 *
 * Why the matched-boundary tests need one. The ``contactEdges`` prop contract is
 * explicit: the fill bands two units IFF an approved edge connects them, because
 * ``body_id`` is the resolver's over-lumped signal and not a correlation. The base
 * fixture gives both columns the same body ids but no edge. The v1 engine banded that
 * untied pair anyway; the v2 closed-loop engine honours the contract and lets both
 * clay units terminate mid-gap, so the gap holds TWO sand/clay adjacencies instead of
 * one matched contact. Every test below whose subject is the MATCHED boundary states
 * the tie that makes the boundary matched — the fixture then means on v2 what its name
 * has always claimed, and the assertions are untouched.
 */
function contactTie(a: string, b: string): LithoContactCorrelationEdge {
  return {
    id: `e-${a}-${b}-base`,
    layer_a_id: a,
    layer_b_id: b,
    layer_a_side: 'base',
    layer_b_side: 'base',
    model_id: 'm1',
    section_id: 's1',
    source: 'manual',
    user_approved: true,
    created_at: '2026-01-01T00:00:00Z',
  }
}

/** The base fixture's sand/clay contact, tied across both columns → one matched band pair. */
const baseMatchedEdges: LithoContactCorrelationEdge[] = [contactTie('a1', 'b1')]

/**
 * S86 press-to-grab gesture: an add-strip press CREATES and GRABS the node in one
 * mousedown, and the drag mouseup persists it. ``moveTo`` optionally sets the release
 * position; when omitted the release lands at ``at``.
 *
 * S105 CLICK-VS-DRAG: a press-release with ZERO travel is now a CLICK (a no-op — no
 * persist, no correlate) — a boundary/lens node persists ONLY on a deliberate drag past
 * ``DRAG_THRESHOLD``. So the default (no ``moveTo``) path presses at a small offset from
 * ``at`` and MOVES to ``at`` before release: the gesture crosses the threshold and lands
 * the node exactly at ``at`` (the position every existing add-node caller asserts). An
 * explicit ``moveTo`` presses at ``at`` and drags to ``moveTo`` as before.
 */
function pressGrabRelease(
  strip: HTMLElement,
  at: { clientX: number; clientY: number },
  moveTo?: { clientX: number; clientY: number },
): void {
  if (moveTo) {
    fireEvent.mouseDown(strip, at)
    fireEvent.mouseMove(window, moveTo)
    fireEvent.mouseUp(window)
    return
  }
  // Default add-node gesture: press AT ``at`` (identical grab/routing), nudge past the S105
  // threshold and back to ``at`` (a deliberate drag — the sticky ``crossedThreshold`` records
  // the excursion), then release AT ``at`` so the persisted node position is exactly ``at``.
  fireEvent.mouseDown(strip, at)
  fireEvent.mouseMove(window, { clientX: at.clientX + 12, clientY: at.clientY })
  fireEvent.mouseMove(window, at)
  fireEvent.mouseUp(window)
}

/**
 * The first + last endpoints of a rendered add-strip. Lens strips are ``<line>``
 * (x1/y1/x2/y2); the boundary strip is a ``<polyline>`` (S104, ``points`` — it rides
 * the bent base contact) — read either shape uniformly. Module-level so every
 * describe block shares it.
 */
function stripEnds(strip: Element): { x1: number; y1: number; x2: number; y2: number } {
  const pts = strip.getAttribute('points')
  if (pts) {
    const parsed = pts.trim().split(/\s+/).map((pair) => pair.split(',').map(Number))
    const [x1, y1] = parsed[0]
    const [x2, y2] = parsed[parsed.length - 1]
    return { x1, y1, x2, y2 }
  }
  return {
    x1: Number(strip.getAttribute('x1')),
    y1: Number(strip.getAttribute('y1')),
    x2: Number(strip.getAttribute('x2')),
    y2: Number(strip.getAttribute('y2')),
  }
}

/** All consecutive segments of a rendered add-strip (polyline vertices or line ends). */
function stripSegments(strip: Element): { a: { x: number; y: number }; b: { x: number; y: number } }[] {
  const pts = strip.getAttribute('points')
  if (pts) {
    const parsed = pts.trim().split(/\s+/).map((pair) => {
      const [x, y] = pair.split(',').map(Number)
      return { x, y }
    })
    const segs: { a: { x: number; y: number }; b: { x: number; y: number } }[] = []
    for (let i = 0; i < parsed.length - 1; i += 1) segs.push({ a: parsed[i], b: parsed[i + 1] })
    return segs
  }
  const { x1, y1, x2, y2 } = stripEnds(strip)
  return [{ a: { x: x1, y: y1 }, b: { x: x2, y: y2 } }]
}

/** Squared distance from a point to a segment (clamped) — for the edge-proximity test. */
function distSqPointToSeg(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  const c = Math.max(0, Math.min(1, t))
  const ex = p.x - (a.x + c * dx)
  const ey = p.y - (a.y + c * dy)
  return ex * ex + ey * ey
}

// Enclosed silt lens in a sand matrix on L; continuous sand on R.
// Column L: nudgedX=0, width=40 → gap leftX=20, rightX=80.
const lensLayers = [
  layer('l1', 'L', 'sand', 'fSand', 0, 4),
  layer('l2', 'L', 'silt', 'fSilt', 4, 5),
  layer('l3', 'L', 'sand', 'fSand', 5, 10),
  layer('r1', 'R', 'sand', 'fSand', 0, 10),
]

describe('PartitionFillOverlay', () => {
  it('PFO1 — a matched two-body stack renders one region per body + labels', () => {
    const { queryAllByTestId, getByText } = renderOverlay()
    expect(queryAllByTestId('partition-region-sand').length).toBeGreaterThanOrEqual(1)
    expect(queryAllByTestId('partition-region-clay').length).toBeGreaterThanOrEqual(1)
    expect(getByText('Sa')).toBeTruthy()
    expect(getByText('C')).toBeTruthy()
  })

  it('PFO2 — showBands=false renders no fill', () => {
    const { queryAllByTestId } = renderOverlay({ showBands: false })
    expect(queryAllByTestId('partition-region-sand')).toHaveLength(0)
    expect(queryAllByTestId('partition-region-clay')).toHaveLength(0)
  })

  it('PFO3 — right-click a region opens the body context menu', () => {
    const onBodyContextMenu = vi.fn()
    const { getAllByTestId } = renderOverlay({
      bodies: [{ id: 'sand' } as BodyListItem, { id: 'clay' } as BodyListItem],
      onBodyContextMenu,
    })
    fireEvent.contextMenu(getAllByTestId('partition-region-sand')[0])
    expect(onBodyContextMenu).toHaveBeenCalledTimes(1)
    expect(onBodyContextMenu.mock.calls[0][0]).toMatchObject({ id: 'sand' })
  })

  it('PFO-CORR — correlate mode drops interactive elements to pointer-events:none (dogfeed 2026-06-19)', () => {
    // Default: an interactive region is clickable (pointer-events:auto).
    const r1 = renderOverlay({
      bodies: [{ id: 'sand' } as BodyListItem],
      onBodyContextMenu: vi.fn(),
    })
    expect(r1.getAllByTestId('partition-region-sand')[0].style.pointerEvents).toBe('auto')
    r1.unmount()
    // Correlate mode: the SAME interactive region drops to pointer-events:none
    // so clicks fall through to the bottom-of-test handles beneath (which render
    // in CorrelationEdgesOverlay, earlier → lower z).
    const r2 = renderOverlay({
      bodies: [{ id: 'sand' } as BodyListItem],
      onBodyContextMenu: vi.fn(),
      correlateMode: true,
    })
    expect(r2.getAllByTestId('partition-region-sand')[0].style.pointerEvents).toBe('none')
  })

  it('PFO4 — an interrupted body renders as TWO pieces, not one swept band', () => {
    const { queryAllByTestId } = renderOverlay({
      lithoLayers: [
        layer('l1', 'L', 'sandtop', 'fSand', 0, 2),
        layer('l2', 'L', 'silt', 'fSilt', 2, 4),
        layer('l3', 'L', 'clay', 'fClay', 4, 10),
        layer('r1', 'R', 'clay', 'fClay', 0, 2),
        layer('r2', 'R', 'silt', 'fSilt', 2, 4),
        layer('r3', 'R', 'clay', 'fClay', 4, 10),
      ],
    })
    expect(queryAllByTestId('partition-region-clay').length).toBeGreaterThanOrEqual(2)
  })

  // --------------------------------------------------------------------------
  // PFO5-7: Single-node lens drag (legacy path — N=1 base case of freedraw)
  // --------------------------------------------------------------------------

  it('PFO5 — a stored lens upper_node exposes a draggable handle', () => {
    // With the new multi-node model the old single-apex handle (partition-lens-apex-*)
    // is replaced by partition-lens-handle-<bodyId>-upper-0 when a node is stored.
    const { getByTestId } = renderOverlay({
      lithoLayers: lensLayers,
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map([
        [
          'silt',
          {
            upper_nodes: [{ along_m: 50, elevation_m: 5 }],
            lower_nodes: [],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    expect(getByTestId('partition-lens-handle-silt-upper-0')).toBeTruthy()
  })

  it('PFO6 — a stored upper_node (single) repositions the lens pinch point', () => {
    // along_m=68 → screen x=68 (identity transform); gap leftX=20, rightX=80.
    // The handle should appear at x=68.
    const { getByTestId } = renderOverlay({
      lithoLayers: lensLayers,
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map([
        [
          'silt',
          {
            upper_nodes: [{ along_m: 68, elevation_m: 5 }],
            lower_nodes: [],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    const cx = Number(getByTestId('partition-lens-handle-silt-upper-0').getAttribute('cx'))
    expect(cx).toBeCloseTo(68, 0)
  })

  it('PFO7 — dragging a lens node handle persists via onSaveBoundary', () => {
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      lithoLayers: lensLayers,
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map([
        [
          'silt',
          {
            upper_nodes: [{ along_m: 50, elevation_m: 5 }],
            lower_nodes: [],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    fireEvent.mouseDown(getByTestId('partition-lens-hit-silt-upper-0'))
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    expect(onSaveBoundary.mock.calls[0][0]).toBe('silt')
    // upper_nodes updated (arg 1), lower_nodes preserved (arg 2).
    expect(onSaveBoundary.mock.calls[0][1]).toHaveLength(1)
    expect(onSaveBoundary.mock.calls[0][2]).toHaveLength(0)
    expect(onSaveBoundary.mock.calls[0][3]).toBe('straight')
  })

  // LB-GAP — a lens body on the MIDDLE column pinches into BOTH gaps. Its two
  // apex nodes (one per gap, by along-position) are INDEPENDENT: each gap renders
  // + edits only the node it owns, and dragging one apex preserves the other.
  const threeColLens: Partial<Props> = {
    // L sand, M sand/silt/sand (enclosed lens), R sand → silt pinches BOTH ways.
    lithoLayers: [
      layer('L1', 'L', 'sandL', 'fSand', 0, 10),
      layer('M1', 'M', 'sandM', 'fSand', 0, 4),
      layer('M2', 'M', 'silt', 'fSilt', 4, 5),
      layer('M3', 'M', 'sandMlo', 'fSand', 5, 10),
      layer('R1', 'R', 'sandR', 'fSand', 0, 10),
    ],
    // L@0, M@100, R@200 (width 40) → gap0 [20,80], gap1 [120,180].
    placedColumns: [column('L', 0, 10), column('M', 100, 10), column('R', 200, 10)],
  }

  it('LB-GAP — a two-gap lens renders each apex node only in its owning gap', () => {
    const { queryAllByTestId } = renderOverlay({
      ...threeColLens,
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map([
        [
          'silt',
          {
            // node 0 lives in the LEFT gap (along 60 ∈ [20,80]); node 1 in the
            // RIGHT gap (along 140 ∈ [120,180]).
            upper_nodes: [
              { along_m: 60, elevation_m: 5 },
              { along_m: 140, elevation_m: 5 },
            ],
            lower_nodes: [],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    // Each node renders exactly ONCE — in its owning gap only, not cloned + clamped
    // into the neighbour gap (the old "other ball").
    expect(queryAllByTestId('partition-lens-handle-silt-upper-0')).toHaveLength(1)
    expect(queryAllByTestId('partition-lens-handle-silt-upper-1')).toHaveLength(1)
  })

  it('LB-GAP — dragging one gap apex preserves the other gap apex on release', () => {
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      ...threeColLens,
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map([
        [
          'silt',
          {
            upper_nodes: [
              { along_m: 60, elevation_m: 5 },
              { along_m: 140, elevation_m: 5 },
            ],
            lower_nodes: [],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    // Drag the LEFT-gap apex (node 0) within its gap and release.
    fireEvent.mouseDown(getByTestId('partition-lens-hit-silt-upper-0'))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 60 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    const savedUpper = onSaveBoundary.mock.calls[0][1] as { along_m: number }[]
    // Node 0 moved; node 1 (the RIGHT apex) is preserved verbatim.
    expect(savedUpper).toHaveLength(2)
    expect(savedUpper[0].along_m).toBeCloseTo(40, 0)
    expect(savedUpper[1].along_m).toBeCloseTo(140, 0)
  })

  // --------------------------------------------------------------------------
  // MB1-MB4: Matched-boundary drag (updated for N-node model)
  // --------------------------------------------------------------------------

  it('MB1 — a matched boundary with one stored node renders a draggable handle', () => {
    const { getByTestId } = renderOverlay({
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map([
        [
          'sand',
          {
            upper_nodes: [],
            lower_nodes: [{ along_m: 60, elevation_m: 4.0 }],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    // Node index 0: testid partition-boundary-handle-sand-clay-0
    expect(getByTestId('partition-boundary-handle-sand-clay-0')).toBeTruthy()
  })

  it('MB2 — a stored lower_nodes node on the upper body bends both polygons at the control point', () => {
    const { queryAllByTestId } = renderOverlay({
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map([
        [
          'sand',
          {
            upper_nodes: [],
            lower_nodes: [{ along_m: 60, elevation_m: 4.0 }],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    expect(queryAllByTestId('partition-region-sand').length).toBeGreaterThanOrEqual(1)
    expect(queryAllByTestId('partition-region-clay').length).toBeGreaterThanOrEqual(1)
    // Sand region's path should have >4 vertex commands (natural quad = 4; bent = 5).
    const sandPaths = queryAllByTestId('partition-region-sand')
    const dAttr = sandPaths[0].getAttribute('d') ?? ''
    const vertexCount = (dAttr.match(/[ML]/g) ?? []).length
    expect(vertexCount).toBeGreaterThanOrEqual(5)
  })

  it('MB3 — dragging the boundary hit halo calls onSaveBoundary with lower_nodes on the upper body', () => {
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map([
        [
          'sand',
          {
            upper_nodes: [],
            lower_nodes: [{ along_m: 60, elevation_m: 4.0 }],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    fireEvent.mouseDown(getByTestId('partition-boundary-hit-sand-clay-0'))
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    expect(onSaveBoundary.mock.calls[0][0]).toBe('sand')
    expect(onSaveBoundary.mock.calls[0][1]).toEqual([]) // upper_nodes preserved
    expect(onSaveBoundary.mock.calls[0][2]).toHaveLength(1) // lower_nodes: 1 node
    expect(onSaveBoundary.mock.calls[0][3]).toBe('straight')
  })

  it('MB4 — lens add-strips and matched-boundary add-strip coexist', () => {
    // L: sand 0-4, silt-lens 4-5, sand 5-8, clay 8-10.
    // R: sand 0-7, clay 7-10.
    // The partition extracts silt as a lens; sand + clay are matched quads.
    // Both a boundary add-strip AND lens add-strips should exist.
    const mixedLayers = [
      layer('m1', 'L', 'sand', 'fSand', 0, 4),
      layer('m2', 'L', 'silt', 'fSilt', 4, 5),
      layer('m3', 'L', 'sand', 'fSand', 5, 8),
      layer('m4', 'L', 'clay', 'fClay', 8, 10),
      layer('m5', 'R', 'sand', 'fSand', 0, 7),
      layer('m6', 'R', 'clay', 'fClay', 7, 10),
    ]
    const { getByTestId } = renderOverlay({
      lithoLayers: mixedLayers,
      // The sand/clay contact is tied across both columns, so it IS a matched
      // boundary and the gap holds exactly one sand/clay adjacency (see contactTie).
      contactEdges: [contactTie('m3', 'm5')],
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map(),
    })
    // Matched-boundary add-strip.
    expect(getByTestId('partition-boundary-addstrip-sand-clay')).toBeTruthy()
    // Lens upper-edge add-strip.
    expect(getByTestId('partition-lens-addstrip-silt-upper')).toBeTruthy()
    // Lens lower-edge add-strip.
    expect(getByTestId('partition-lens-addstrip-silt-lower')).toBeTruthy()
  })

  it('MB5 — dragging a boundary node past a column clamps it to the gap, not under the column', () => {
    // Gap is x∈[20,80]; the R column strip is [80,120]. Dragging the node to
    // x=120 (under/past the R column) must clamp to the gap edge (80) — otherwise
    // the node lands under the column strip (in neither gap) and the fraction
    // clamp pins it to BOTH sides of the column (the dogfeed "clamps at both
    // sides of test" bug).
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map([
        [
          'sand',
          {
            upper_nodes: [],
            lower_nodes: [{ along_m: 60, elevation_m: 4.0 }],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    fireEvent.mouseDown(getByTestId('partition-boundary-hit-sand-clay-0'))
    // Two acts: the move's setState must flush (re-rendering the mouseup closure
    // with the updated drag x) before mouseup reads it — else mouseup fires on
    // the stale closure with the original x.
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 60 }))
    })
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    const savedLower = onSaveBoundary.mock.calls[0][2]
    expect(savedLower).toHaveLength(1)
    // Clamped to the gap's right edge (x=80 → along 80, identity transform),
    // NOT 120 (under the R column strip).
    expect(savedLower[0].along_m).toBeCloseTo(80, 5)
  })


  // --------------------------------------------------------------------------
  // FD2: Clicking the add-strip inserts a new node
  // --------------------------------------------------------------------------
  it('FD2 — press-to-grab on the matched-boundary add-strip calls onSaveBoundary with a new node appended', () => {
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      ...transforms,
      contactEdges: baseMatchedEdges,
      onSaveBoundary,
      boundariesByBodyId: new Map([
        [
          'sand',
          {
            upper_nodes: [],
            lower_nodes: [{ along_m: 40, elevation_m: 4.5 }],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    // S86 press-to-grab + S99 edge-only: press ON the contact edge (read the strip's
    // own endpoints and interpolate the on-edge y at x=60) so the grab lands, then
    // release persists. Persists at the projected mousedown x (≈60).
    const strip = getByTestId('partition-boundary-addstrip-sand-clay')
    const { x1: ex1, y1: ey1, x2: ex2, y2: ey2 } = stripEnds(strip)
    const onEdgeY = ey1 + ((60 - ex1) / (ex2 - ex1)) * (ey2 - ey1)
    pressGrabRelease(strip, { clientX: 60, clientY: onEdgeY })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    expect(onSaveBoundary.mock.calls[0][0]).toBe('sand')
    // lower_nodes should now have 2 entries (1 existing + 1 new).
    const lowerNodes = onSaveBoundary.mock.calls[0][2] as { along_m: number; elevation_m: number }[]
    expect(lowerNodes).toHaveLength(2)
    expect(onSaveBoundary.mock.calls[0][3]).toBe('straight')
  })

  // --------------------------------------------------------------------------
  // S105: a pure CLICK (mousedown + mouseup with ZERO movement) on a boundary
  // add-strip is a NO-OP — it must NOT persist a node or correlate. Owner dogfeed
  // 2026-07-24: "i click on the position of the marker and this weird clay quad
  // appears out of nowhere." RED on pre-S105 code (the press-to-grab persisted on a
  // bare press-release); GREEN after the DRAG_THRESHOLD gate.
  // --------------------------------------------------------------------------
  it('S105 — a bare click (no drag) on a boundary add-strip does NOT persist a node (no clay quad)', () => {
    const onSaveBoundary = vi.fn()
    const onCorrelateBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      ...transforms,
      contactEdges: baseMatchedEdges,
      onSaveBoundary,
      onCorrelateBoundary,
      boundariesByBodyId: new Map([
        [
          'sand',
          {
            upper_nodes: [],
            lower_nodes: [{ along_m: 40, elevation_m: 4.5 }],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    const strip = getByTestId('partition-boundary-addstrip-sand-clay')
    const { x1: ex1, y1: ey1, x2: ex2, y2: ey2 } = stripEnds(strip)
    const onEdgeY = ey1 + ((60 - ex1) / (ex2 - ex1)) * (ey2 - ey1)
    // A pure click: mousedown + mouseup at the SAME point, no mousemove between.
    fireEvent.mouseDown(strip, { clientX: 60, clientY: onEdgeY })
    fireEvent.mouseUp(window)
    // Nothing persisted, nothing correlated — the boundary stays exactly as it was.
    expect(onSaveBoundary).not.toHaveBeenCalled()
    expect(onCorrelateBoundary).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // FD3: Right-clicking a handle removes that node
  // --------------------------------------------------------------------------
  it('FD3 — right-clicking a control-point handle calls onSaveBoundary with that node removed', () => {
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map([
        [
          'sand',
          {
            upper_nodes: [],
            lower_nodes: [
              { along_m: 40, elevation_m: 4.5 },
              { along_m: 60, elevation_m: 3.5 },
            ],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    // Right-click the first handle (nodeIndex=0, along_m=40) to remove it.
    fireEvent.contextMenu(getByTestId('partition-boundary-hit-sand-clay-0'))
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    expect(onSaveBoundary.mock.calls[0][0]).toBe('sand')
    const lowerNodes = onSaveBoundary.mock.calls[0][2] as { along_m: number }[]
    // After removal: only the node at along_m=60 remains.
    expect(lowerNodes).toHaveLength(1)
    expect(lowerNodes[0].along_m).toBeCloseTo(60, 0)
    expect(onSaveBoundary.mock.calls[0][3]).toBe('straight')
  })

  // --------------------------------------------------------------------------
  // FD4: Lens with stored upper/lower nodes → multi-point polygon
  // --------------------------------------------------------------------------
  it('FD4 — a lens with stored upper_nodes and lower_nodes renders a multi-point wedge (vertex count > 3)', () => {
    // Store one node on the upper edge and one on the lower edge of the silt lens.
    // With the default triangle: [sourceTop, apex, sourceBase] = 3 points.
    // With 1 upper + 1 lower node: [sourceTop, upperNode, lowerNode, sourceBase] = 4 points → > 3.
    const { queryAllByTestId } = renderOverlay({
      lithoLayers: lensLayers,
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map([
        [
          'silt',
          {
            upper_nodes: [{ along_m: 55, elevation_m: 5.5 }],
            lower_nodes: [{ along_m: 65, elevation_m: 4.5 }],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    // The silt region should still render (no crash).
    const siltPaths = queryAllByTestId('partition-region-silt')
    expect(siltPaths.length).toBeGreaterThanOrEqual(1)
    // Polygon vertex count > 3 (multi-point wedge).
    const d = siltPaths[0].getAttribute('d') ?? ''
    const vertexCount = (d.match(/[ML]/g) ?? []).length
    expect(vertexCount).toBeGreaterThan(3)

    // The main (non-lens) partition must still tile without overlaps/gaps
    // — verified by checking that sand regions still exist without error.
    expect(queryAllByTestId('partition-region-sand').length).toBeGreaterThanOrEqual(1)
  })

  // --------------------------------------------------------------------------
  // HP1-HP4: Add-strip hover preview dot — EDGE-ONLY (S99, owner dogfeed 2026-07-24)
  //
  //   HP1 — mouseMove ON a matched-boundary edge (within tolerance) → preview dot.
  //   HP2 — mouseLeave the add-strip → preview dot disappears.
  //   HP3 — mouseMove ON a lens edge → preview dot appears.
  //   HP4 — mouseMove in the OPEN band interior (far from every edge) → NO dot.
  // The preview now tracks the litho line and hides in the interior, telegraphing
  // exactly where a click would grab. The hover point is read from the strip's OWN
  // endpoints (its midpoint is guaranteed ON the edge), not a hand-picked cursor.
  // --------------------------------------------------------------------------

  /** The midpoint of a rendered add-strip — a point guaranteed ON its edge. */
  function stripMidpoint(strip: Element): { clientX: number; clientY: number } {
    const { x1, y1, x2, y2 } = stripEnds(strip)
    return { clientX: (x1 + x2) / 2, clientY: (y1 + y2) / 2 }
  }

  it('HP1 — mouseMove ON a matched-boundary edge renders a partition-addnode-preview circle', () => {
    // No nodes stored — the strip is always rendered when onSaveBoundary is wired.
    const { getByTestId, queryByTestId } = renderOverlay({
      ...transforms,
      contactEdges: baseMatchedEdges,
      onSaveBoundary: vi.fn(),
    })
    // Preview absent before hover.
    expect(queryByTestId('partition-addnode-preview')).toBeNull()
    // Move the pointer ONTO the edge (the strip's midpoint lies on the contact line).
    const strip = getByTestId('partition-boundary-addstrip-sand-clay')
    fireEvent.mouseMove(strip, stripMidpoint(strip))
    // Preview dot now present.
    expect(getByTestId('partition-addnode-preview')).toBeTruthy()
  })

  it('HP2 — mouseLeave the matched-boundary add-strip removes the preview dot', () => {
    const { getByTestId, queryByTestId } = renderOverlay({
      ...transforms,
      contactEdges: baseMatchedEdges,
      onSaveBoundary: vi.fn(),
    })
    // Hover in (on the edge).
    const strip = getByTestId('partition-boundary-addstrip-sand-clay')
    fireEvent.mouseMove(strip, stripMidpoint(strip))
    expect(getByTestId('partition-addnode-preview')).toBeTruthy()
    // Hover out.
    fireEvent.mouseLeave(strip)
    expect(queryByTestId('partition-addnode-preview')).toBeNull()
  })

  it('HP3 — mouseMove ON a lens edge renders a partition-addnode-preview circle', () => {
    const { getByTestId, queryByTestId } = renderOverlay({
      lithoLayers: lensLayers,
      ...transforms,
      onSaveBoundary: vi.fn(),
    })
    // No preview before hover.
    expect(queryByTestId('partition-addnode-preview')).toBeNull()
    // Move ONTO the upper-edge lens strip (its midpoint lies on the lens edge).
    const strip = getByTestId('partition-lens-addstrip-silt-upper')
    fireEvent.mouseMove(strip, stripMidpoint(strip))
    expect(getByTestId('partition-addnode-preview')).toBeTruthy()
    // Leave → gone.
    fireEvent.mouseLeave(strip)
    expect(queryByTestId('partition-addnode-preview')).toBeNull()
  })

  it('HP4 — mouseMove in the OPEN band interior (far from every edge) shows NO preview dot', () => {
    // The edge-only rule: the dot rides the litho line only. A hover deep in the
    // band interior — far below the sand/clay contact — must NOT spawn a dot (the
    // owner's "teal dot in the middle of a band" was the containment-era symptom).
    const { getByTestId, queryByTestId } = renderOverlay({
      ...transforms,
      contactEdges: baseMatchedEdges,
      onSaveBoundary: vi.fn(),
    })
    // The contact runs el5→el6 (y=50→40 across the gap). y=90 is ~40px below it —
    // deep in the clay interior, far beyond the 7px hit tolerance.
    fireEvent.mouseMove(getByTestId('partition-boundary-addstrip-sand-clay'), {
      clientX: 50,
      clientY: 90,
    })
    expect(queryByTestId('partition-addnode-preview')).toBeNull()
  })

  // --------------------------------------------------------------------------
  // KEY1: unique React keys across gaps (debt #2 — duplicate-key flood)
  //
  // The same (upper, lower) body-pair boundary recurs in every gap a body
  // spans, and an enclosed lens on a middle column is extracted into BOTH its
  // flanking gaps. Keying boundary groups by `${upper}-${lower}` and lens
  // groups by `${bodyId}` therefore collides across gaps → React's
  // "Encountered two children with the same key" warning floods the console.
  // Keys must be per-gap unique.
  // --------------------------------------------------------------------------
  it('KEY1 — a recurring body-pair boundary + enclosed lens across 3 columns render with no duplicate-key warning', () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    // L: sand/clay.  M: sand/silt-lens/sand/clay.  R: sand/clay.
    // Both gaps (L,M) and (M,R) carry the (sand,clay) boundary, and M's silt
    // lens is enclosed in sand (present on L and R) so it is extracted into
    // BOTH flanking gaps — the exact collision the old keying produced.
    const threeCol = [
      layer('l1', 'L', 'sand', 'fSand', 0, 5),
      layer('l2', 'L', 'clay', 'fClay', 5, 10),
      layer('m1', 'M', 'sand', 'fSand', 0, 2),
      layer('m2', 'M', 'silt', 'fSilt', 2, 3),
      layer('m3', 'M', 'sand', 'fSand', 3, 5),
      layer('m4', 'M', 'clay', 'fClay', 5, 10),
      layer('r1', 'R', 'sand', 'fSand', 0, 5),
      layer('r2', 'R', 'clay', 'fClay', 5, 10),
    ]
    renderOverlay({
      lithoLayers: threeCol,
      placedColumns: [column('L', 0, 10), column('M', 100, 10), column('R', 200, 10)],
      ...transforms,
      onSaveBoundary: vi.fn(),
      plotRight: 300,
    })
    const dupKeyWarning = errSpy.mock.calls.some(
      (args) => typeof args[0] === 'string' && args[0].includes('same key'),
    )
    errSpy.mockRestore()
    expect(dupKeyWarning).toBe(false)
  })

  // FS1 (mismatched-matrix wavy facies seam) was removed 2026-06-09: the owner's
  // contact-correlation model has NO auto-facies wriggle — a facies/disturbed
  // contact is an explicit engineer call, not a geometric inference. A
  // mismatched matrix now renders a straight midpoint seam (see partitionFill
  // MISMATCH test). The dead wavyPath render path is removed in the cleanup pass.

  // --------------------------------------------------------------------------
  // TEST-04: computeSectionFill must NOT re-run on transform-only re-renders.
  //
  // The bug (debt #209): the single screenRegions useMemo keys on levelToScreen,
  // plotTop, and plotBottom — all recreated on every pan/zoom frame — so the
  // expensive LCS + polygon engine runs on every scroll tick on a real section.
  // The fix splits the memo into data-keyed (calls computeSectionFill) and
  // transform-keyed (projects to pixels) halves, so a pan/zoom that only changes
  // levelToScreen/plotTop/plotBottom skips computeSectionFill entirely.
  // --------------------------------------------------------------------------
  it('TEST-04 — computeSectionFill is NOT called again when only screen-transform props change', () => {
    // Spy on the ACTIVE-ENGINE entry point the overlay actually calls, through its
    // module binding. Vitest makes ES module exports mutable so spyOn wraps the real
    // implementation while counting calls. We call through (no mockImplementation) so
    // the overlay still renders correctly and the test only asserts call-count
    // behaviour.
    //
    // The spy used to sit on ``partitionFill.computeSectionFill`` — the v1 engine
    // itself — which counted nothing once v2 became the default engine. The property
    // under test is the overlay's, not any one engine's: a pan/zoom must not re-enter
    // the partition engine. Counting the selector keeps that guard on whichever engine
    // is actually shipping.
    const spy = vi.spyOn(partitionEngineSelect, 'computeSectionFillActiveWithDiagnostics')

    const { rerender } = render(
      <svg>
        <PartitionFillOverlay {...base} />
      </svg>,
    )

    // Exactly one call on initial render (the data memo runs once).
    expect(spy).toHaveBeenCalledTimes(1)

    // Re-render with ONLY screen-transform props changed.
    // levelToScreen shifts up 5 px, plotTop/plotBottom widen by 10 px.
    // Contact data (lithoLayers, contactEdges, placedColumns) is identical.
    rerender(
      <svg>
        <PartitionFillOverlay
          {...base}
          levelToScreen={(l: number) => 95 - l * 10}
          plotTop={10}
          plotBottom={410}
        />
      </svg>,
    )

    // computeSectionFill must still be at exactly 1 — the transform-only
    // re-render must not have triggered the data memo again.
    expect(spy).toHaveBeenCalledTimes(1)

    spy.mockRestore()
  })

  // --------------------------------------------------------------------------
  // ZAL1-ZAL4: Zoom-adaptive label model (owner dogfeed 2026-06-24)
  //
  //   ZAL1  A tall body (50 px region) renders a <text> label.
  //   ZAL2  A very short body (1 px region, below MIN_FONT + margin) renders
  //         NO <text> label (fit gate).
  //   ZAL3  One label per body — a body spanning two gap segments renders
  //         exactly ONE <text>, not two.
  //   ZAL4  Label placement: the <text> x,y for the base fixture is within the
  //         region's bounding box — not the naive bbox-centre when the polygon is
  //         pinched (regression guard for the "sand label on clay" bug).
  // --------------------------------------------------------------------------

  it('ZAL1 — a tall body (50 px region) renders its <text> label', () => {
    // Sand: 0–5 m on L, 0–5 m on R → levelToScreen gives 50 px height.
    // 50 * 0.15 = 7.5 → clamp to 8 (MIN_FONT). height (50) >= 8 + 2 = 10 ✓.
    // availW ≈ 60 px; 'Sa'.length * 8 * 0.55 = 8.8 px — fits ✓.
    const { getAllByTestId } = renderOverlay()
    // At least one sand label renders.
    expect(getAllByTestId('partition-label-sand').length).toBeGreaterThanOrEqual(1)
  })

  it('ZAL2 — a body whose region is too short (1 px) renders NO <text> label', () => {
    // Create a thin body: 0.1 m depth → levelToScreen(10px/m) = 1 px tall.
    // 1 * 0.15 = 0.15 < MIN_FONT (8); fit gate: height(1) < 8+2 → no label.
    const { queryAllByTestId } = renderOverlay({
      lithoLayers: [
        layer('t1', 'L', 'thin', 'fSand', 0, 0.1),
        layer('t2', 'R', 'thin', 'fSand', 0, 0.1),
      ],
    })
    expect(queryAllByTestId('partition-label-thin')).toHaveLength(0)
  })

  it('ZAL3 — a body spanning two gaps renders exactly ONE <text> label (per-body rule)', () => {
    // Three columns: L, M, R. Sand body spans both (L,M) and (M,R) gaps.
    // The per-body rule ensures we emit only ONE <text> for the sand body.
    const threeCols = [
      layer('s1', 'L', 'sand', 'fSand', 0, 10),
      layer('s2', 'M', 'sand', 'fSand', 0, 10),
      layer('s3', 'R', 'sand', 'fSand', 0, 10),
    ]
    const { getAllByTestId, queryAllByTestId } = renderOverlay({
      lithoLayers: threeCols,
      placedColumns: [column('L', 0, 10), column('M', 100, 10), column('R', 200, 10)],
      plotRight: 300,
    })
    // At least one sand region renders (sanity).
    expect(getAllByTestId('partition-region-sand').length).toBeGreaterThanOrEqual(1)
    // Exactly one label for the sand body (despite spanning 2 gaps).
    expect(queryAllByTestId('partition-label-sand')).toHaveLength(1)
  })

  it('ZAL4 — label x,y is within the region bounding box (placement inside the polygon)', () => {
    // Regression guard for the "sand label on clay" bbox-centre bug.
    // For the base fixture the sand body has minX=20, maxX=80, minY=0, maxY=50.
    // The label anchor (centroid or scanline fallback) must be inside those bounds.
    const { getAllByTestId } = renderOverlay()
    const sandLabels = getAllByTestId('partition-label-sand')
    expect(sandLabels.length).toBeGreaterThanOrEqual(1)
    const lbl = sandLabels[0]
    const x = parseFloat(lbl.getAttribute('x') ?? 'NaN')
    const y = parseFloat(lbl.getAttribute('y') ?? 'NaN')
    // The gap spans x=[20,80], and sand occupies the full depth range (0–50 px).
    // The centroid must fall inside [20,80] × [0,50].
    expect(x).toBeGreaterThanOrEqual(20)
    expect(x).toBeLessThanOrEqual(80)
    expect(y).toBeGreaterThanOrEqual(0)
    expect(y).toBeLessThanOrEqual(50)
  })

  // --------------------------------------------------------------------------
  // SEAM1-SEAM2: hairline-seam close (2026-07-13)
  //
  // The visible dark hairlines between adjacent translucent fills are the classic
  // SVG antialiasing seam: at a shared edge neither polygon covers the boundary
  // pixels fully, so the dark app background bleeds through. The fix gives every
  // FILL a stroke of ITS OWN fill colour at the SAME opacity as the fill (so the
  // stroke reads no darker than the fill it hems) — adjacent fills then visually
  // close the seam. strokeWidth is a small 0.75; strokeLinejoin="round" avoids
  // miter spikes on sharp pinch tips.
  //
  //   SEAM1  the seam stroke lives on a sibling stroke path (S60 Stage B —
  //          owner clause 5: a line renders ONLY where the two sides differ in
  //          lithology or border unfilled space). The fill polygon itself
  //          carries NO stroke; the stroke path uses the region's own fill
  //          colour, strokeWidth 0.75, strokeLinejoin round, and strokeOpacity
  //          equal to the fill's fillOpacity (the S1-fade variable — a stroke
  //          above the fill opacity would read as a darker outline).
  //   SEAM2  the open-end stub rects (which tile the section's open ends) carry
  //          the same self-colour seam stroke at the fill opacity.
  // --------------------------------------------------------------------------
  it('SEAM1 — the visible fill is a dissolved merged-body group; per-region hit paths are transparent; strokes hem cross-litho/outer seams at the fill opacity', () => {
    // S61 (owner clause 5, app-render half): the visible litho fill is now ONE
    // translucent <path> per merged same-litho body (partition-fill-group-*), so
    // adjacent same-litho regions no longer stack a darker seam / show an
    // antialiasing hairline. The per-body partition-region-* path stays as the
    // interactive HIT target only (fillOpacity 0 — no visible paint, so no
    // per-region stacking). The seam-aware stroke path is unchanged.
    const { queryAllByTestId, container } = renderOverlay()

    // The dissolved fill groups carry the visible paint at the 0.62 fill opacity
    // and NO stroke (the group is painted once — a stroke would re-introduce a
    // line). Both lithologies (sand, clay) produce a group.
    const groups = Array.from(
      container.querySelectorAll('[data-testid^="partition-fill-group-"]'),
    )
    expect(groups.length).toBeGreaterThanOrEqual(2)
    const groupColors = new Set(groups.map((g) => g.getAttribute('fill')))
    expect(groupColors.has('#fbbf24')).toBe(true) // sand colour
    expect(groupColors.has('#6b7280')).toBe(true) // clay colour
    for (const g of groups) {
      expect(g.getAttribute('fill-opacity')).toBe('0.62')
      expect(g.getAttribute('stroke')).toBeNull()
    }

    for (const bodyId of ['sand', 'clay']) {
      const hits = queryAllByTestId(`partition-region-${bodyId}`)
      const strokes = queryAllByTestId(`partition-region-stroke-${bodyId}`)
      expect(hits.length).toBeGreaterThanOrEqual(1)
      expect(strokes.length).toBeGreaterThanOrEqual(1)
      // The per-region hit path paints nothing (fillOpacity 0) and never strokes
      // itself — the visible paint is the dissolved group above.
      for (const el of hits) {
        expect(el.getAttribute('stroke')).toBeNull()
        expect(el.getAttribute('fill-opacity')).toBe('0')
      }
      const hitColor = hits[0].getAttribute('fill')
      for (const el of strokes) {
        // Stroke equals the region's own fill colour so the seam closes without
        // painting a foreign colour across the boundary; at the natural (0.62)
        // fill opacity so it never reads as a darker outline.
        expect(el.getAttribute('stroke')).toBe(hitColor)
        expect(el.getAttribute('stroke-width')).toBe('0.75')
        expect(el.getAttribute('stroke-linejoin')).toBe('round')
        expect(el.getAttribute('stroke-opacity')).toBe('0.62')
      }
    }
  })

  it('SEAM1-fade — an S1-selected body splits its litho into natural + faded groups; the demoted stroke fades too', () => {
    // With a body selected, non-matching regions fade to 0.25. The dissolved fill
    // now splits on the opacity bucket: the clay group paints at 0.25 (demoted),
    // and the clay seam stroke tracks that faded opacity — the outline must not
    // stay bright while the fill dims.
    const { queryAllByTestId, container } = renderOverlay({ selectedBodyId: 'sand' })
    const groups = Array.from(
      container.querySelectorAll('[data-testid^="partition-fill-group-"]'),
    )
    // The clay group (non-selected litho) paints at the demoted 0.25 opacity.
    const clayGroups = groups.filter((g) => g.getAttribute('fill') === '#6b7280')
    expect(clayGroups.length).toBeGreaterThanOrEqual(1)
    for (const g of clayGroups) expect(g.getAttribute('fill-opacity')).toBe('0.25')

    const clayStrokes = queryAllByTestId('partition-region-stroke-clay')
    expect(clayStrokes.length).toBeGreaterThanOrEqual(1)
    for (const el of clayStrokes) {
      expect(el.getAttribute('stroke-opacity')).toBe('0.25')
      expect(el.getAttribute('stroke')).toBe('#6b7280')
    }
  })

  it('SEAM3 — an interior same-litho boundary carries no stroke; a cross-litho one does (S60 Stage B)', () => {
    // Two clay bodies abut mid-gap (interrupted-body fixture shape): the clay↔clay
    // shared edge is interior to ONE merged clay mass → no stroke segment on it.
    // The clay↔silt boundaries keep their strokes. Assert at the path-data level:
    // no stroke segment midpoint may lie ON a shared same-litho edge.
    const { container } = renderOverlay({
      lithoLayers: [
        layer('l1', 'L', 'clayA', 'fClay', 0, 4),
        layer('l2', 'L', 'silt', 'fSilt', 4, 6),
        layer('l3', 'L', 'clayB', 'fClay', 6, 10),
        layer('r1', 'R', 'clayA', 'fClay', 0, 10),
      ],
    })
    // The right column is ALL clay: where the silt pinches out mid-gap, clayA
    // (above) and clayB (below) meet along the silt termination — a same-litho
    // interior seam. Collect every clay stroke segment and every clay↔clay
    // shared edge from the fill polygons, then assert no stroke rides one.
    const clayFills = Array.from(
      container.querySelectorAll('[data-testid^="partition-region-clay"]'),
    ).filter((el) => el.getAttribute('d'))
    const strokePaths = Array.from(
      container.querySelectorAll('[data-testid^="partition-region-stroke-clay"]'),
    )
    // Sanity: the fixture produced at least two clay regions + some strokes.
    expect(clayFills.length).toBeGreaterThanOrEqual(2)
    expect(strokePaths.length).toBeGreaterThanOrEqual(1)
    // Every clay stroke segment's midpoint must NOT be covered by ANOTHER clay
    // fill polygon (i.e. no stroke interior to the merged clay mass).
    const rings = clayFills.map((el) =>
      Array.from((el.getAttribute('d') ?? '').matchAll(/([ML]) ([\d.-]+),([\d.-]+)/g)).map((m) => ({
        x: Number(m[2]),
        y: Number(m[3]),
      })),
    )
    const inRing = (ring: { x: number; y: number }[], x: number, y: number): boolean => {
      let inside = false
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i].x
        const yi = ring[i].y
        const xj = ring[j].x
        const yj = ring[j].y
        const hit = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
        if (hit) inside = !inside
      }
      return inside
    }
    for (const sp of strokePaths) {
      const d = sp.getAttribute('d') ?? ''
      for (const m of d.matchAll(/M ([\d.-]+),([\d.-]+) L ([\d.-]+),([\d.-]+)/g)) {
        const mx = (Number(m[1]) + Number(m[3])) / 2
        const my = (Number(m[2]) + Number(m[4])) / 2
        // Sample both sides of the segment; if BOTH sides land in clay fills,
        // the stroke is interior to the merged clay mass — forbidden.
        const dx = Number(m[3]) - Number(m[1])
        const dy = Number(m[4]) - Number(m[2])
        const len = Math.hypot(dx, dy)
        if (len < 0.05) continue
        const nx = (-dy / len) * 0.6
        const ny = (dx / len) * 0.6
        const side1Clay = rings.some((r) => inRing(r, mx + nx, my + ny))
        const side2Clay = rings.some((r) => inRing(r, mx - nx, my - ny))
        expect(side1Clay && side2Clay).toBe(false)
      }
    }
  })

  it('SEAM2 — open-end stub rects carry the self-colour seam stroke at the fill opacity', () => {
    const { queryAllByTestId } = renderOverlay()
    // The base fixture emits open-end stubs at both section ends (testid
    // partition-edge-<edgeIdx>-<inv>-<unitIdx>).
    const stubs = Array.from(
      document.querySelectorAll('[data-testid^="partition-edge-"]'),
    ) as SVGRectElement[]
    expect(stubs.length).toBeGreaterThanOrEqual(1)
    for (const el of stubs) {
      const fill = el.getAttribute('fill')
      expect(el.getAttribute('stroke')).toBe(fill)
      expect(el.getAttribute('stroke-width')).toBe('0.75')
      expect(el.getAttribute('stroke-linejoin')).toBe('round')
      expect(el.getAttribute('stroke-opacity')).toBe(el.getAttribute('fill-opacity'))
    }
  })

  // --------------------------------------------------------------------------
  // EDGELENS — owner ruling 2026-09-04 ("zero ties = lens"). A unit on the
  // section's OUTER column with zero ties pinches out toward the edge as a
  // lens (a closed triangle), never an open band to the boundary. A unit that
  // DOES have a tie inward (here the top sand, top-band tied) keeps extending
  // outward to the boundary as a full rect stub.
  //
  // Base fixture: L = sand(0-5)/clay(5-10), R = sand(0-6)/clay(6-10), NO edges.
  // Both bottom clays are corr-0 (zero ties); both top sands are corr-1 (top
  // band). So each outer column pinches its clay and rects its sand.
  // --------------------------------------------------------------------------
  it('EDGELENS — a zero-tie outer-column unit pinches out as a lens; a tied unit stays a full rect stub', () => {
    renderOverlay()
    // The bottom clay (ui=1) on the FIRST column (edgeIdx 0, inv L) is zero-tie:
    // it must render as a CLOSED pinch triangle, NOT a rect to the boundary.
    const clayPinch = document.querySelector(
      '[data-testid="partition-edge-lens-0-L-1"]',
    ) as SVGPolygonElement | null
    expect(clayPinch, 'zero-tie clay renders an outer lens pinch').toBeTruthy()
    expect(clayPinch?.tagName.toLowerCase()).toBe('polygon')
    // A closed pinch is a triangle: two points on the column edge + one apex.
    const pts = (clayPinch?.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((p) => p.split(',').map(Number))
    expect(pts.length, 'the pinch is a 3-vertex triangle').toBe(3)
    // The apex is the single vertex OFF the column edge (leftX = -20). It sits
    // strictly inside the open-end margin — past the edge, short of the far end
    // (edgeX -20, outerX -84) — so the unit closes rather than reaching the edge.
    const edgeX = -20
    const outerX = -84
    const apexes = pts.filter(([x]) => Math.abs(x - edgeX) > 0.5)
    expect(apexes.length, 'exactly one apex off the column edge').toBe(1)
    const apexX = apexes[0][0]
    expect(apexX).toBeLessThan(edgeX)
    expect(apexX).toBeGreaterThan(outerX)

    // The clay must NOT also render the old full rect stub (no open band).
    expect(
      document.querySelector('[data-testid="partition-edge-0-L-1"]'),
      'the zero-tie clay no longer draws an open band rect',
    ).toBeNull()

    // The top sand (ui=0) HAS a tie (top band) → it keeps its full rect stub.
    const sandStub = document.querySelector('[data-testid="partition-edge-0-L-0"]')
    expect(sandStub, 'tied sand keeps its full rect stub').toBeTruthy()
    expect(sandStub?.tagName.toLowerCase()).toBe('rect')
  })

  // --------------------------------------------------------------------------
  // FG-OVERLAY — the dissolved fill wired end-to-end (S61, owner clause 5).
  //
  //   FG-O1  an interrupted body (two clay regions abutting mid-gap along the
  //          silt termination) renders ONE clay fill GROUP — the merged body is
  //          a single paint op, so no antialiasing hairline between the two clay
  //          pieces. The silt (different litho) stays its own group.
  // --------------------------------------------------------------------------
  it('FG-O1 — an interrupted same-litho body renders ONE dissolved fill group; the different litho stays separate', () => {
    // Right column ALL clay; left column clay / silt / clay. The silt pinches out
    // mid-gap, so clayA (above) and clayB (below) meet along the silt termination
    // — a same-litho interior seam that must dissolve into ONE clay paint op.
    const { container } = renderOverlay({
      lithoLayers: [
        layer('l1', 'L', 'clayA', 'fClay', 0, 4),
        layer('l2', 'L', 'silt', 'fSilt', 4, 6),
        layer('l3', 'L', 'clayB', 'fClay', 6, 10),
        layer('r1', 'R', 'clayA', 'fClay', 0, 10),
      ],
    })
    const groups = Array.from(
      container.querySelectorAll('[data-testid^="partition-fill-group-"]'),
    )
    // Exactly ONE clay group (both clay pieces dissolved) and ONE silt group.
    const clayGroups = groups.filter((g) => g.getAttribute('fill') === '#6b7280')
    const siltGroups = groups.filter((g) => g.getAttribute('fill') === '#84cc16')
    expect(clayGroups).toHaveLength(1)
    expect(siltGroups.length).toBeGreaterThanOrEqual(1)
    // The single clay group carries BOTH clay rings as subpaths (≥2 Z commands).
    const clayZ = (clayGroups[0].getAttribute('d') ?? '').match(/Z/g)?.length ?? 0
    expect(clayZ).toBeGreaterThanOrEqual(2)
    // The dissolved fill group never strokes itself (a stroke would re-add a line).
    for (const g of groups) expect(g.getAttribute('stroke')).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// V2P — the apex/alt-click freedraw gesture on partition ENGINE v2 output.
//
// Owner dogfeed (Cross-section 1, engine v2 active): "the alt click gesture is
// gone". Root cause: v2 emits a lone interior ONLAP tip as ``kind:'pinch'``
// where v1 emitted it as ``kind:'lens'`` (slice.ts: BAND->'quad', ONLAP->'pinch',
// LENS->'lens'). The overlay gated the apex handles / add-strips on
// ``kind==='lens'`` — so every v2 pinch tip lost its shaping gesture. These
// tests paraphrase the fix in the owner's terms: a shapeable termination (a
// lens OR a lone pinch that tapers to a mid-gap tip) must expose the apex
// freedraw gesture on EITHER engine.
// ---------------------------------------------------------------------------
describe('PartitionFillOverlay — apex gesture on engine v2 (V2P)', () => {
  afterEach(() => {
    cleanup()
  })

  function onlapEdge(aLayerId: string, bLayerId: string): LithoContactCorrelationEdge {
    // A single TOP-side tie: L-silt top <-> R-sand top. v2 classifies the
    // one-contact-tied silt as an ONLAP that laps up the tie and pinches before
    // the right column — emitted as kind:'pinch' anchored at fraction 0.
    return {
      id: `e-${aLayerId}-${bLayerId}`,
      layer_a_id: aLayerId,
      layer_b_id: bLayerId,
      layer_a_side: 'top',
      layer_b_side: 'top',
      model_id: 'm1',
      section_id: 's1',
      source: 'manual',
      user_approved: true,
      created_at: '2026-01-01T00:00:00Z',
    }
  }

  // L: clay / silt / sand ; R: clay / sand. Silt is present on L only and its TOP
  // is tied to R's sand top -> v2 onlap pinch tip (kind:'pinch', frac 0..<1).
  const onlapLayers = [
    layer('l-clay', 'L', 'clay', 'fClay', 0, 3),
    layer('l-silt', 'L', 'silt', 'fSilt', 3, 4),
    layer('l-sand', 'L', 'sand', 'fSand', 4, 8),
    layer('r-clay', 'R', 'clay', 'fClay', 0, 3),
    layer('r-sand', 'R', 'sand', 'fSand', 3, 8),
  ]

  it('V2P1 — a lone v2 pinch tip (onlap) exposes the apex freedraw add-strips', () => {
    const { getByTestId } = renderOverlay({
      lithoLayers: onlapLayers,
      contactEdges: [onlapEdge('l-silt', 'r-sand')],
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map(),
    })
    // The silt onlap tip must offer BOTH edge add-strips so the engineer can add
    // an apex node — the gesture that was "gone" under v2.
    expect(getByTestId('partition-lens-addstrip-silt-upper')).toBeTruthy()
    expect(getByTestId('partition-lens-addstrip-silt-lower')).toBeTruthy()
  })

  it('V2P2 — a stored node on the v2 pinch tip renders a draggable apex handle', () => {
    const { getByTestId } = renderOverlay({
      lithoLayers: onlapLayers,
      contactEdges: [onlapEdge('l-silt', 'r-sand')],
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map([
        [
          'silt',
          {
            // Node in the gap (along 50 ∈ [20,80]) at the silt's elevation band.
            upper_nodes: [{ along_m: 50, elevation_m: 6 }],
            lower_nodes: [],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    expect(getByTestId('partition-lens-handle-silt-upper-0')).toBeTruthy()
  })

  it('V2P3 — dragging the v2 pinch-tip handle persists via onSaveBoundary', () => {
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      lithoLayers: onlapLayers,
      contactEdges: [onlapEdge('l-silt', 'r-sand')],
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map([
        [
          'silt',
          {
            upper_nodes: [{ along_m: 50, elevation_m: 6 }],
            lower_nodes: [],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    fireEvent.mouseDown(getByTestId('partition-lens-hit-silt-upper-0'))
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    expect(onSaveBoundary.mock.calls[0][0]).toBe('silt')
  })

  // V2P4 — the DRAG actually RESHAPES the engine-produced fill (not merely calls
  // onSaveBoundary) AND the rendered partition stays valid at every drag position
  // — the owner's rule in test form ("drag the point anywhere; the body reshapes,
  // neighbours follow, never a gap or overlap").
  //
  // Fixture: an ENCLOSED silt lens in a sand matrix on L, continuous sand on R —
  // the S64-wired shapeable face whose apex the v2 engine consumes via emitLenses.
  // The live preview drives the SAME partition path (the sectionFillData memo
  // re-runs on lensDrag, injecting the live cursor into the apex override before
  // re-partitioning), so the on-screen fill during a drag == the engine result.
  //
  // Gap x-extent: L col x=0 w40 → right edge 20; R col x=100 w40 → left edge 80.
  // So the gap is [20, 80]; a valid partition never places a fill vertex OUTSIDE
  // that band (a vertex past 80 would spill into the right column — the overlap
  // the owner forbids).
  const v2LensLayers = [
    layer('vl1', 'L', 'sand', 'fSand', 0, 4),
    layer('vl2', 'L', 'silt', 'fSilt', 4, 6),
    layer('vl3', 'L', 'sand2', 'fSand', 6, 10),
    layer('vr1', 'R', 'sand', 'fSand', 0, 10),
  ]
  const GAP_LEFT_X = 20
  const GAP_RIGHT_X = 80

  function siltApexX(getByTestId: (id: string) => HTMLElement): number {
    // The silt lens fill polygon's max x = the apex reach (the taper tip).
    const d = getByTestId('partition-region-silt').getAttribute('d') ?? ''
    let maxX = -Infinity
    for (const m of d.matchAll(/[ML]\s*(-?[\d.]+),(-?[\d.]+)/g)) {
      const x = parseFloat(m[1])
      if (x > maxX) maxX = x
    }
    return maxX
  }

  /** Assert EVERY rendered partition-region fill stays inside the gap band —
   *  the never-overlap-past-the-neighbour envelope. */
  function assertNoSpill(container: HTMLElement): void {
    const paths = container.querySelectorAll('[data-testid^="partition-region-"]')
    for (const p of Array.from(paths)) {
      const d = p.getAttribute('d') ?? ''
      for (const m of d.matchAll(/[ML]\s*(-?[\d.]+),(-?[\d.]+)/g)) {
        const x = parseFloat(m[1])
        // 0.5 px slack for the fraction→pixel round-trip; a genuine spill is metres wide.
        expect(x).toBeGreaterThanOrEqual(GAP_LEFT_X - 0.5)
        expect(x).toBeLessThanOrEqual(GAP_RIGHT_X + 0.5)
      }
    }
  }

  it('V2P4 — dragging the lens apex RESHAPES the fill + keeps a valid partition at every position', () => {
    const onSaveBoundary = vi.fn()
    const { getByTestId, container } = renderOverlay({
      lithoLayers: v2LensLayers,
      ...transforms,
      onSaveBoundary,
      // A stored apex node at along 40 (x=40) → an override the engine consumes.
      boundariesByBodyId: new Map([
        [
          'silt',
          {
            upper_nodes: [{ along_m: 40, elevation_m: 5 }],
            lower_nodes: [],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })

    // At rest: the apex reach is at the stored node (x≈40) and nothing spills.
    const restX = siltApexX(getByTestId)
    expect(restX).toBeCloseTo(40, 0)
    assertNoSpill(container as HTMLElement)

    // Start the drag and move the apex DEEP into the gap (x=75). jsdom's svg
    // getBoundingClientRect is 0,0, so clientX maps 1:1 to the svg x.
    fireEvent.mouseDown(getByTestId('partition-lens-hit-silt-upper-0'))
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 75, clientY: 55 }))
    })
    // The fill FOLLOWED the cursor — a real engine re-partition, not a no-op.
    const midX = siltApexX(getByTestId)
    expect(midX).toBeGreaterThan(restX + 20)
    assertNoSpill(container as HTMLElement)

    // Now drag WAY past the far column (clientX=200). The move handler clamps x to
    // the gap and the engine clamps the apex fraction to the [0.02, 0.98] interior
    // envelope — the fill must NEVER cross into the right column.
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 200, clientY: 55 }))
    })
    assertNoSpill(container as HTMLElement)

    // Release persists the shaped node.
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(onSaveBoundary).toHaveBeenCalled()
    expect(onSaveBoundary.mock.calls[onSaveBoundary.mock.calls.length - 1][0]).toBe('silt')
  })

  // PP — GRAB-RADIUS FLOOR (S76). The owner's dogfeed: "the pan handler is fighting the
  // gesture." Root: at a low column spacing the lens handle's HIT halo shrank with
  // ``handleScale`` to ~5.5 px, so a near-miss click slipped past the handle and the SVG-root
  // pan handler fired instead. The fix floors the hit radius at ``LENS_HIT_MIN_PX`` (9 px). The
  // ``transforms`` fixture uses ``alongToScreenX = a => a`` (1 px/m → handleScale at its 0.5
  // min), the exact compressed case — so the rendered hit radius must equal the floor, not the
  // scaled-down 5.5.
  it('PP1 — the lens grab HIT radius floors at a grabbable size on a compressed section', () => {
    const { getByTestId } = renderOverlay({
      lithoLayers: onlapLayers,
      contactEdges: [onlapEdge('l-silt', 'r-sand')],
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map([
        ['silt', { upper_nodes: [{ along_m: 50, elevation_m: 6 }], lower_nodes: [] } as unknown as BodyBoundaryResponse],
      ]),
    })
    const hit = getByTestId('partition-lens-hit-silt-upper-0')
    const r = Number(hit.getAttribute('r'))
    // 11 × handleScale(0.5) = 5.5 without the floor; the floor lifts it to 9.
    expect(r).toBeGreaterThanOrEqual(9)
  })

  // PP2 — a grab on the handle does NOT reach the SVG-root pan handler (its mousedown stops
  // propagation), so the pan never starts on a precise grab. The behavioural contract behind
  // "pan doesn't fight the gesture": the handle owns the mousedown.
  it('PP2 — a mousedown on the lens handle stops propagation (no pan on a grab)', () => {
    const { getByTestId } = renderOverlay({
      lithoLayers: onlapLayers,
      contactEdges: [onlapEdge('l-silt', 'r-sand')],
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map([
        ['silt', { upper_nodes: [{ along_m: 50, elevation_m: 6 }], lower_nodes: [] } as unknown as BodyBoundaryResponse],
      ]),
    })
    const hit = getByTestId('partition-lens-hit-silt-upper-0')
    const ev = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    const stop = vi.spyOn(ev, 'stopPropagation')
    hit.dispatchEvent(ev)
    expect(stop).toHaveBeenCalled()
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
  })
})

// CW — the CONTACT-WIRING gesture on engine v2: shaping a horizontal contact
// between two full-width bands must re-partition BOTH bands through the engine
// (the shared edge moves together, never a gap). Owner dogfeed (CS1, v2):
// "clicking targets the top and creates a gap." Root (S66/§71): the app routed
// the contact node to an OFF-ENGINE single-body reshape that grew the upper band's
// base while the lower band's top stayed put → a gap at the contact. The fix
// (S67 engine consumer + S68 app wiring): feed the engine a
// ``contact:U|L@g`` override so both incident bands re-derive from the ONE bent
// shared boundary.
//
// Fixture: the ``base`` two-band matched stack (L sand 0-5 / clay 5-10; R sand
// 0-6 / clay 6-10). Both sand and clay span the gap; their shared contact is the
// matched two-band boundary. A stored ``lower_nodes`` node on the UPPER (sand)
// body is the shaped contact control point.
describe('PartitionFillOverlay — contact wiring on engine v2 (CW)', () => {
  afterEach(() => {
    cleanup()
  })

  // Matched TWO-BAND fixture: sand top-tied + clay top-tied so BOTH bands span
  // the gap full-width (the base fixture has no edges, so v2 floods sand + pinches
  // clay — not a two-band contact). Their shared contact is sand-base == clay-top.
  function cwEdge(a: string, b: string): LithoContactCorrelationEdge {
    return {
      id: `e-${a}-${b}`,
      layer_a_id: a,
      layer_b_id: b,
      layer_a_side: 'top',
      layer_b_side: 'top',
      model_id: 'm1',
      section_id: 's1',
      source: 'manual',
      user_approved: true,
      created_at: '2026-01-01T00:00:00Z',
    } as LithoContactCorrelationEdge
  }
  const cwLayers = [
    layer('a1', 'L', 'sand', 'fSand', 0, 5),
    layer('a2', 'L', 'clay', 'fClay', 5, 10),
    layer('b1', 'R', 'sand', 'fSand', 0, 5),
    layer('b2', 'R', 'clay', 'fClay', 5, 10),
  ]
  const cwProps = { lithoLayers: cwLayers, contactEdges: [cwEdge('a1', 'b1'), cwEdge('a2', 'b2')] }

  // Coverage span (min/max y) of a region path at a given screen x, from the
  // rendered SVG ``d`` attribute (M/L commands). Returns null if x is outside.
  function spanAtX(d: string, x: number): { top: number; base: number } | null {
    const pts: { x: number; y: number }[] = []
    for (const m of d.matchAll(/[ML]\s*(-?[\d.]+),(-?[\d.]+)/g)) {
      pts.push({ x: parseFloat(m[1]), y: parseFloat(m[2]) })
    }
    if (pts.length < 3) return null
    const ys: number[] = []
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]
      const b = pts[(i + 1) % pts.length]
      if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
        const t = (x - a.x) / (b.x - a.x)
        ys.push(a.y + t * (b.y - a.y))
      }
    }
    if (ys.length < 2) return null
    return { top: Math.min(...ys), base: Math.max(...ys) }
  }

  // The covering span at x among ALL region paths for a body (v2 may emit more
  // than one region per body — pick the one whose polygon covers x).
  function bodySpanAtX(
    paths: HTMLElement[],
    x: number,
  ): { top: number; base: number } | null {
    for (const p of paths) {
      const span = spanAtX(p.getAttribute('d') ?? '', x)
      if (span) return span
    }
    return null
  }

  it('CW1 — a stored contact node bends BOTH bands together (shared edge coincident, no gap)', () => {
    // Node at along 50 (mid-gap x=50), elevation 3 (well below the natural
    // contact ~5-6 mTAW, i.e. dragged DOWN into the clay).
    const { queryAllByTestId } = renderOverlay({
      ...cwProps,
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map([
        [
          'sand',
          {
            upper_nodes: [],
            lower_nodes: [{ along_m: 50, elevation_m: 3 }],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    // levelToScreen: y = 100 - elev*10, so elev 3 → y=70.
    const sandSpan = bodySpanAtX(queryAllByTestId('partition-region-sand'), 50)
    const claySpan = bodySpanAtX(queryAllByTestId('partition-region-clay'), 50)
    expect(sandSpan).toBeTruthy()
    expect(claySpan).toBeTruthy()
    // The owner's rule: the shared boundary (sand BASE == clay TOP) is coincident.
    // No gap → sand's base y == clay's top y at the node x.
    expect(Math.abs(sandSpan!.base - claySpan!.top)).toBeLessThan(1.0)
    // And the boundary actually MOVED toward the node (y=70 for elev 3), not the
    // natural ~y=45-50 contact — proving the engine consumed the override.
    expect(sandSpan!.base).toBeGreaterThan(60)
  })

  it('CW2 — with NO stored contact node the two bands still share a coincident edge (no regression)', () => {
    const { queryAllByTestId } = renderOverlay({
      ...cwProps,
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map(),
    })
    const sandSpan = bodySpanAtX(queryAllByTestId('partition-region-sand'), 50)
    const claySpan = bodySpanAtX(queryAllByTestId('partition-region-clay'), 50)
    expect(sandSpan).toBeTruthy()
    expect(claySpan).toBeTruthy()
    expect(Math.abs(sandSpan!.base - claySpan!.top)).toBeLessThan(1.0)
  })

  it('CW3 — targets-top fix: the add-strip pairs the GEOMETRIC upper (sand) over the lower (clay)', () => {
    // §71 "targets the top": v2 does not emit regions strictly top→bottom, so the
    // shared boundary was keyed by emission order — clay (the LOWER band) became
    // ``upper``. The add-strip testid encodes [upper]-[lower]; after the geometry
    // fix it MUST be ``sand-clay`` (sand is higher on screen), never ``clay-sand``.
    const { queryByTestId } = renderOverlay({
      ...cwProps,
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map(),
    })
    expect(queryByTestId('partition-boundary-addstrip-sand-clay')).toBeTruthy()
    expect(queryByTestId('partition-boundary-addstrip-clay-sand')).toBeNull()
  })

  it('CW4 — dragging the shared contact re-partitions BOTH bands live (follows cursor, no gap)', () => {
    // The owner's rule in drag form: grab the contact handle, drag it DOWN; both
    // bands follow together, never a gap. The live preview re-partitions through
    // the engine (sectionFillData re-runs on boundaryDrag → the contact override
    // carries the live cursor), so the on-screen fill == the engine result.
    const onSaveBoundary = vi.fn()
    const { getByTestId, queryAllByTestId } = renderOverlay({
      ...cwProps,
      ...transforms,
      onSaveBoundary,
      // A stored contact node at along 50, elev 5 (the natural contact) so a handle
      // renders; the drag then moves it.
      boundariesByBodyId: new Map([
        [
          'sand',
          {
            upper_nodes: [],
            lower_nodes: [{ along_m: 50, elevation_m: 5 }],
          } as unknown as BodyBoundaryResponse,
        ],
      ]),
    })
    // Start the drag on the (geometry-correct) sand-over-clay boundary handle.
    fireEvent.mouseDown(getByTestId('partition-boundary-hit-sand-clay-0'))
    // Drag DOWN to y=75 (elev 2.5). jsdom svg rect is 0,0 → clientY maps 1:1.
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 50, clientY: 75 }))
    })
    const sandSpan = bodySpanAtX(queryAllByTestId('partition-region-sand'), 50)
    const claySpan = bodySpanAtX(queryAllByTestId('partition-region-clay'), 50)
    expect(sandSpan).toBeTruthy()
    expect(claySpan).toBeTruthy()
    // The fill FOLLOWED the cursor (sand base near y=75, moved from natural y=50).
    expect(sandSpan!.base).toBeGreaterThan(65)
    // BOTH bands share the moved edge — no gap between sand base and clay top.
    expect(Math.abs(sandSpan!.base - claySpan!.top)).toBeLessThan(1.0)
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(onSaveBoundary).toHaveBeenCalled()
    expect(onSaveBoundary.mock.calls[onSaveBoundary.mock.calls.length - 1][0]).toBe('sand')
  })
})

// ST — the STACKED-LENS TARGETING gesture on engine v2. Owner dogfeed
// (GEO-10/170-S7, CS1, v2, 2026-07-22): "i click the sand silt interface at
// around 4.7 mTAW and it seems to grab the silt lens above the sand" — then
// moving that wrong body opens a gap. Root (S70): where thin stacked pinch
// lenses converge, several bodies' 14px add-strips overlap at one click point;
// each strip fires its OWN onClick, so the winner is SVG paint order (the
// last-painted lens strip), NOT the boundary the engineer visually aimed at.
// ``nearerLensEdge`` only arbitrates ONE lens's two edges, never across bodies.
// The fix: a GLOBAL nearest-boundary router — every add-strip click picks the
// candidate whose segment is physically nearest the cursor across ALL bodies.
describe('PartitionFillOverlay — stacked-lens targeting on engine v2 (ST)', () => {
  afterEach(() => {
    cleanup()
  })

  // Three thin silt lenses stacked in a sand matrix, each separated by a thin
  // sand layer, so all three extract as enclosed lenses (the gap5 shape). Stored
  // apex nodes push each lens's edges to mid-gap so their strips SPAN the gap the
  // way the real wide pinch tips do (a column-hugging synthetic lens never
  // overlaps the click). L = the stack; R = full sand.
  const stackLayers = [
    layer('s0', 'L', 'sand', 'fSand', 0, 3.5),
    layer('u2', 'L', 'silt2', 'fSilt', 3.5, 4.1), // upper silt lens
    layer('sa', 'L', 'sand', 'fSand', 4.1, 4.3),
    layer('u3', 'L', 'silt3', 'fSilt', 4.3, 4.9), // middle silt lens
    layer('sb', 'L', 'sand', 'fSand', 4.9, 5.1),
    layer('u4', 'L', 'silt4', 'fSilt', 5.1, 6.2), // lower silt lens
    layer('s5', 'L', 'sand', 'fSand', 6.2, 10),
    layer('r1', 'R', 'sand', 'fSand', 0, 10),
  ]
  // Give each lens a mid-gap apex so its add-strips span the gap (overlapping
  // region near the click). levelToScreen: y = 100 - elev*10.
  const stackBoundaries = new Map<string, BodyBoundaryResponse>([
    ['silt2', { upper_nodes: [{ along_m: 55, elevation_m: 6.3 }], lower_nodes: [{ along_m: 55, elevation_m: 5.85 }] } as unknown as BodyBoundaryResponse],
    ['silt3', { upper_nodes: [{ along_m: 55, elevation_m: 5.6 }], lower_nodes: [{ along_m: 55, elevation_m: 5.15 }] } as unknown as BodyBoundaryResponse],
    ['silt4', { upper_nodes: [{ along_m: 55, elevation_m: 4.85 }], lower_nodes: [{ along_m: 55, elevation_m: 3.9 }] } as unknown as BodyBoundaryResponse],
  ])

  it('ST1 — a click on a distant lens strip routes to the NEAREST boundary, not the lens under the cursor by z-order', () => {
    // The owner's rule: click the sand/silt interface → grab THAT interface, even
    // if a farther silt lens strip is painted on top of the click point. We fire
    // the click on the u2 (upper) silt lens strip — the element SVG z-order would
    // deliver the event to — but at cursor coords (x=50, y=53) that sit NEAREST
    // the u3/u4 sand interface (y≈48-49), ~1 m BELOW the u2 lens (y≈41). After the
    // global-nearest router, onSaveBoundary must fire for the NEAREST body
    // (sand / silt3 / silt4 region at that y), NOT silt2 (the lens above).
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      lithoLayers: stackLayers,
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: stackBoundaries,
    })
    // Fire on the u2 (silt2) lens strip — the "grabbed the lens above" element —
    // at coords nearest the interface below it. jsdom svg rect is 0,0 → client 1:1.
    const wrongStrip = getByTestId('partition-lens-addstrip-silt2-lower')
    pressGrabRelease(wrongStrip, { clientX: 50, clientY: 53 })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    // The nearest boundary at (50,53) is NOT silt2 (the lens ~1 m above). The bug:
    // the click routed to silt2. The fix: it routes to whatever body's edge is
    // nearest — anything but silt2.
    const grabbedBody = onSaveBoundary.mock.calls[0][0]
    expect(grabbedBody).not.toBe('silt2')
  })

  it('ST2 — a click clearly nearest the u2 lens still routes to u2 (no over-correction)', () => {
    // Symmetry guard: when the cursor IS nearest the u2 lens edge, the router must
    // still grab u2 — the fix routes to nearest, it does not blanket-suppress lenses.
    // u2 lower edge ~y=41 (base 5.9). Click at y=41, mid-gap x=50.
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      lithoLayers: stackLayers,
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: stackBoundaries,
    })
    const strip = getByTestId('partition-lens-addstrip-silt2-lower')
    pressGrabRelease(strip, { clientX: 50, clientY: 41 })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    expect(onSaveBoundary.mock.calls[0][0]).toBe('silt2')
  })
})

// ===========================================================================
// THE INVARIANT (§77): region-containment targeting + gap-impossible-by-
// construction. A click grabs the body whose PARTITION REGION contains the
// cursor — the owner's "this needs to work ALWAYS, no gapwise bug fixing".
// Asserted across the WHOLE set of shapeable boundaries, read from the ACTUAL
// rendered geometry, so the test paraphrases the owner's rule ("grabs the body
// under the cursor"), not the impl's nearest-segment math.
// ===========================================================================
describe('PartitionFillOverlay — region-containment targeting invariant (RC, engine v2)', () => {
  afterEach(() => {
    cleanup()
  })

  // The gap5 shape: thin stacked silt lenses in a sand matrix, each pushed to a
  // mid-gap apex so their edges span the gap (as the real wide pinch tips do).
  const stackLayers = [
    layer('s0', 'L', 'sand', 'fSand', 0, 3.5),
    layer('u2', 'L', 'silt2', 'fSilt', 3.5, 4.1),
    layer('sa', 'L', 'sand', 'fSand', 4.1, 4.3),
    layer('u3', 'L', 'silt3', 'fSilt', 4.3, 4.9),
    layer('sb', 'L', 'sand', 'fSand', 4.9, 5.1),
    layer('u4', 'L', 'silt4', 'fSilt', 5.1, 6.2),
    layer('s5', 'L', 'sand', 'fSand', 6.2, 10),
    layer('r1', 'R', 'sand', 'fSand', 0, 10),
  ]
  const stackBoundaries = new Map<string, BodyBoundaryResponse>([
    ['silt2', { upper_nodes: [{ along_m: 55, elevation_m: 6.3 }], lower_nodes: [{ along_m: 55, elevation_m: 5.85 }] } as unknown as BodyBoundaryResponse],
    ['silt3', { upper_nodes: [{ along_m: 55, elevation_m: 5.6 }], lower_nodes: [{ along_m: 55, elevation_m: 5.15 }] } as unknown as BodyBoundaryResponse],
    ['silt4', { upper_nodes: [{ along_m: 55, elevation_m: 4.85 }], lower_nodes: [{ along_m: 55, elevation_m: 3.9 }] } as unknown as BodyBoundaryResponse],
  ])

  /** Parse a region path's ``d`` (``M x,y L x,y ... Z``) to a screen polygon. */
  function ringOf(d: string): { x: number; y: number }[] {
    return d
      .replace(/[MLZ]/g, ' ')
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((pair) => {
        const [x, y] = pair.split(',').map(Number)
        return { x, y }
      })
  }

  /** Even-odd point-in-polygon (mirrors the router; used only to CHOOSE test clicks). */
  function inside(p: { x: number; y: number }, ring: { x: number; y: number }[]): boolean {
    let hit = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const a = ring[i]
      const b = ring[j]
      if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x)
        hit = !hit
    }
    return hit
  }

  /**
   * A point provably INSIDE a (possibly concave) ring: scan the bbox on a fine
   * grid and return the first interior sample. Robust where a vertex centroid
   * falls outside a concave polygon. Returns null if none found (degenerate ring).
   */
  function interiorPoint(ring: { x: number; y: number }[]): { x: number; y: number } | null {
    const xs = ring.map((p) => p.x)
    const ys = ring.map((p) => p.y)
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const minY = Math.min(...ys)
    const maxY = Math.max(...ys)
    const N = 12
    for (let iy = 1; iy < N; iy += 1) {
      for (let ix = 1; ix < N; ix += 1) {
        const p = { x: minX + ((maxX - minX) * ix) / N, y: minY + ((maxY - minY) * iy) / N }
        if (inside(p, ring)) return p
      }
    }
    return null
  }

  it('RC1 — RED-repro: a click INSIDE the sand lens no longer grabs the silt band above it', () => {
    // The owner's exact 2026-07-22 report: "i clicked the sand lens on top" but it
    // grabbed the silt band above (a long diagonal silt flank was nearer in
    // perpendicular distance). We locate a click point that is INSIDE a sand
    // region and fire the click on the SILT lens strip (the element z-order would
    // deliver the event to). Containment must route to the sand body under the
    // cursor, NEVER the silt lens whose diagonal edge merely passes nearby.
    const onSaveBoundary = vi.fn()
    const { getByTestId, queryAllByTestId } = renderOverlay({
      lithoLayers: stackLayers,
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: stackBoundaries,
    })
    // Find a rendered SAND region and a point provably inside it.
    const sandRings = queryAllByTestId(/partition-region-sand/)
      .map((el) => ringOf(el.getAttribute('d') ?? ''))
      .filter((r) => r.length >= 3)
    expect(sandRings.length).toBeGreaterThan(0)
    // Choose the sand ring whose interior point sits NEAR a silt lens edge (so the
    // old nearest-segment metric would have been fooled). Prefer the widest ring.
    const ring = sandRings.reduce((a, b) => (b.length > a.length ? b : a))
    const pt = interiorPoint(ring)
    expect(pt).not.toBeNull()
    const { x: cx, y: cy } = pt!
    expect(inside({ x: cx, y: cy }, ring)).toBe(true)
    // Press-to-grab on a SILT lens strip (the "on top" element) at the sand-interior coords.
    pressGrabRelease(getByTestId('partition-lens-addstrip-silt4-lower'), { clientX: cx, clientY: cy })
    // The click landed inside sand → it must NOT have grabbed any silt lens.
    if (onSaveBoundary.mock.calls.length > 0) {
      const grabbed = onSaveBoundary.mock.calls[0][0] as string
      expect(grabbed.startsWith('silt')).toBe(false)
    }
  })

  it('RC2 — EDGE-ONLY: an interior click grabs NOTHING; only an on-edge click grabs (whole set)', () => {
    // The owner's S99 model, inverting the retired S71 containment rule: it does NOT
    // matter that the cursor is INSIDE a band — an interior click (far from every
    // litho line) must be a NO-OP. Only a click ON the visible line between two
    // fills grabs. Asserted across the whole rendered set, not one spot.
    const onSaveBoundary = vi.fn()
    const { queryAllByTestId } = renderOverlay({
      lithoLayers: stackLayers,
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: stackBoundaries,
    })
    // Map every rendered region: bodyId → its ring(s).
    const regionEls = queryAllByTestId(/partition-region-/)
    const ringsByBody = new Map<string, { x: number; y: number }[][]>()
    for (const el of regionEls) {
      const tid = el.getAttribute('data-testid') ?? ''
      const body = tid.replace('partition-region-', '')
      const ring = ringOf(el.getAttribute('d') ?? '')
      if (ring.length < 3) continue
      const list = ringsByBody.get(body) ?? []
      list.push(ring)
      ringsByBody.set(body, list)
    }
    expect(ringsByBody.size).toBeGreaterThanOrEqual(3) // several bodies present

    // Every add-strip's edge segment (its endpoints) — the ONLY grabbable lines.
    const stripEls = [
      ...queryAllByTestId(/partition-lens-addstrip-/),
      ...queryAllByTestId(/partition-boundary-addstrip-/),
    ]
    const edgeMids = stripEls.map((el) => {
      const { x1, y1, x2, y2 } = stripEnds(el)
      return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }
    })
    // The boundary add-strip is a bent POLYLINE (S104): its true hit line is the run of
    // consecutive segments, not the chord between its endpoints. Build the real segment
    // list so ``nearAnyEdge`` measures perpendicular distance to the actual grab line —
    // otherwise an interior point sitting ON a bend is wrongly deemed "far from any edge"
    // and the no-op assertion fires on a point that legitimately grabs.
    const stripSegs = stripEls.flatMap((el) => stripSegments(el))
    const nearAnyEdge = (p: { x: number; y: number }): boolean =>
      stripSegs.some((s) => distSqPointToSeg(p, s.a, s.b) <= 7 * 7)

    const anyStrip = stripEls[0]
    expect(anyStrip).toBeTruthy()

    // (a) INTERIOR clicks (deep inside a band, far from every edge) grab NOTHING.
    let interiorChecked = 0
    for (const [, rings] of ringsByBody) {
      for (const ring of rings) {
        const pt = interiorPoint(ring)
        if (!pt || nearAnyEdge(pt)) continue // skip points that happen to sit on an edge
        onSaveBoundary.mockClear()
        pressGrabRelease(anyStrip, { clientX: pt.x, clientY: pt.y })
        expect(
          onSaveBoundary.mock.calls.length,
          `interior click at (${pt.x.toFixed(1)},${pt.y.toFixed(1)}) must be a NO-OP but grabbed a body`,
        ).toBe(0)
        interiorChecked += 1
      }
    }
    expect(interiorChecked, 'no interior-only points found to exercise the no-op rule').toBeGreaterThanOrEqual(2)

    // (b) an ON-EDGE click (the strip's own midpoint) DOES grab a body — the line
    // you click is grabbable. Fire on each strip's own midpoint.
    let edgeGrabbed = 0
    for (let i = 0; i < stripEls.length; i += 1) {
      onSaveBoundary.mockClear()
      pressGrabRelease(stripEls[i], { clientX: edgeMids[i].x, clientY: edgeMids[i].y })
      if (onSaveBoundary.mock.calls.length > 0) edgeGrabbed += 1
    }
    expect(edgeGrabbed, 'no on-edge click grabbed a body — the line must be grabbable').toBeGreaterThanOrEqual(1)
  })

})

// ===========================================================================
// S77 / §83 — GHOST-CONTACT handle suppression. The owner ruling (2026-07-22):
// "hide them, if they were merged into one body and deleted afterwards then they
// are GHOST CONTACTS, modelling artefacts with no real meaning." A shapeable tip
// whose single-body override the engine does NOT consume (byte-static footprint —
// the interior convergence seam of a CONTINUOUS same-litho band, ruling-8m-
// suppressed) must render NO grab handle. Every handle the tool shows reshapes.
// ===========================================================================
describe('PartitionFillOverlay — ghost-contact handle suppression (GH, engine v2)', () => {
  afterEach(() => {
    cleanup()
  })

  // A continuous SAND matrix (s0/sa/sb/s5 + R's sand) with three enclosed SILT
  // lenses. The sand's shapeable convergence tip is a GHOST (a same-litho band
  // interior seam the engine floods back); each silt lens is a LIVE enclosed lens
  // the engine consumes. So: sand handle SUPPRESSED, silt handles PRESENT.
  const ghostStack = [
    layer('s0', 'L', 'sand', 'fSand', 0, 3.5),
    layer('u2', 'L', 'silt2', 'fSilt', 3.5, 4.1),
    layer('sa', 'L', 'sand', 'fSand', 4.1, 4.3),
    layer('u3', 'L', 'silt3', 'fSilt', 4.3, 4.9),
    layer('sb', 'L', 'sand', 'fSand', 4.9, 5.1),
    layer('u4', 'L', 'silt4', 'fSilt', 5.1, 6.2),
    layer('s5', 'L', 'sand', 'fSand', 6.2, 10),
    layer('r1', 'R', 'sand', 'fSand', 0, 10),
  ]

  it('GH1 — a ghost same-litho convergence tip renders NO grab handle, a live lens keeps its handle', async () => {
    // RED-first behaviour: the sand matrix's ghost convergence tip must NOT offer an
    // add-strip (a dead grab), while at least one enclosed silt lens MUST — the owner
    // ruling in test form: no handle on a modelling artefact, a handle where reshape
    // is real. Reading the rendered add-strip testids is behaviour-shaped.
    const { queryAllByTestId } = renderOverlay({
      lithoLayers: ghostStack,
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map(),
    })
    // S78: the ghost probe is now DEFERRED off the paint path (it re-partitions the
    // section per shapeable region — a 2.6 s stall on a real CS1 that used to block
    // paint and re-fire on every pan). The handles render live for the first beat,
    // then the ghosts drop once the idle-chunked probe resolves. So the suppression
    // is asserted after the deferred set lands — this WAITS for it (jsdom has no
    // requestIdleCallback, so the hook's setTimeout(0) chunks resolve here).
    await waitFor(() => {
      // The continuous sand band is a ghost → NO grab handle (upper or lower add-strip).
      expect(queryAllByTestId('partition-lens-addstrip-sand-upper')).toHaveLength(0)
      expect(queryAllByTestId('partition-lens-addstrip-sand-lower')).toHaveLength(0)
    })
    // At least one enclosed silt lens keeps its handle — a live, reshapeable tip.
    const liveHandles = ['silt2', 'silt3', 'silt4'].flatMap((b) => [
      ...queryAllByTestId(`partition-lens-addstrip-${b}-upper`),
      ...queryAllByTestId(`partition-lens-addstrip-${b}-lower`),
    ])
    expect(liveHandles.length).toBeGreaterThan(0)
  })

  it('GH2 — a click inside the ghost band is a NO-OP (no dead grab of a distant lens)', async () => {
    // With the sand handle suppressed, a click inside the sand region must grab
    // NOTHING — never fall back to a distant silt lens (that was the S71 "grabbed a
    // body the cursor is not inside" bug, which suppression would otherwise re-expose).
    const onSaveBoundary = vi.fn()
    const { queryAllByTestId } = renderOverlay({
      lithoLayers: ghostStack,
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map(),
    })
    // S78: the ghost barrier is DEFERRED (see GH1) — wait for the sand handle to be
    // suppressed before clicking, otherwise the barrier region set is still empty and
    // the router has nothing to absorb the click against.
    await waitFor(() => {
      expect(queryAllByTestId('partition-lens-addstrip-sand-upper')).toHaveLength(0)
    })
    // A sand region ring + a point provably inside it.
    const sandRing = queryAllByTestId(/partition-region-sand/)
      .map((el) => (el.getAttribute('d') ?? '').replace(/[MLZ]/g, ' ').trim().split(/\s+/).filter(Boolean).map((pr) => {
        const [x, y] = pr.split(',').map(Number)
        return { x, y }
      }))
      .filter((r) => r.length >= 3)
      .reduce((a, b) => (b.length > a.length ? b : a), [] as { x: number; y: number }[])
    expect(sandRing.length).toBeGreaterThanOrEqual(3)
    const xs = sandRing.map((p) => p.x)
    const ys = sandRing.map((p) => p.y)
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2
    const cy = (Math.min(...ys) + Math.max(...ys)) / 2
    // Fire on an arbitrary (silt) add-strip at the sand-interior coords: the router
    // must NOT grab a distant silt lens — the ghost region absorbs the click.
    const anyStrip = queryAllByTestId(/partition-lens-addstrip-/)[0]
    expect(anyStrip).toBeTruthy()
    fireEvent.click(anyStrip, { clientX: cx, clientY: cy })
    if (onSaveBoundary.mock.calls.length > 0) {
      // If anything was grabbed, it must be sand (containment) — never a distant silt.
      expect((onSaveBoundary.mock.calls[0][0] as string).startsWith('silt')).toBe(false)
    }
  })
})

// ===========================================================================
// S72 — the three dogfeed regressions from S71's containment (owner 2026-07-22,
// GEO-23/125-S10): a stored node must sit ON its boundary (no floating dots /
// free-space points), an apex click must not pinch the lens to nothing, and a
// tie-bounded base contact must be grabbable. Behaviour-shaped: read the ACTUAL
// stored node / rendered add-strip, paraphrasing the owner's words.
// ===========================================================================
describe('PartitionFillOverlay — S72 node-on-boundary + apex-floor (engine v2)', () => {
  afterEach(() => {
    cleanup()
  })

  // A CORRELATED three-band stack (top-tied → every band spans the gap full-width):
  // a clean sand/silt/clay column with matched contacts, the GEO-23/125-S10 shape.
  function nEdge(a: string, b: string): LithoContactCorrelationEdge {
    return {
      id: `e-${a}-${b}`,
      layer_a_id: a,
      layer_b_id: b,
      layer_a_side: 'top',
      layer_b_side: 'top',
      model_id: 'm1',
      section_id: 's1',
      source: 'manual',
      user_approved: true,
      created_at: '2026-01-01T00:00:00Z',
    } as LithoContactCorrelationEdge
  }
  const matchedStackN = [
    layer('a1', 'L', 'sand', 'fSand', 0, 3),
    layer('a2', 'L', 'silt', 'fSilt', 3, 5),
    layer('a3', 'L', 'clay', 'fClay', 5, 10),
    layer('b1', 'R', 'sand', 'fSand', 0, 3),
    layer('b2', 'R', 'silt', 'fSilt', 3, 5),
    layer('b3', 'R', 'clay', 'fClay', 5, 10),
  ]
  const matchedEdgesN = [nEdge('a1', 'b1'), nEdge('a2', 'b2'), nEdge('a3', 'b3')]

  /** The interior-gap add-strip (its left endpoint sits at the gap-left x≈20),
   *  never the x=80 open-end stub that shares the same testid. */
  function interiorStrip(strips: HTMLElement[]): HTMLElement | undefined {
    return strips.find((el) => stripEnds(el).x1 < 40)
  }

  it('N1 — a press ON the contact edge stores the node ON the contact, not at the stray cursor y', () => {
    // S99 edge-only: the click must land ON the litho line (within the hit tolerance),
    // but WITHIN that tolerance the cursor can be a few px off the exact line — the
    // stored node must still SNAP onto the contact (never float at the raw cursor y).
    // The silt/clay matched contact is at 5 m (y=50). A press 2 px BELOW it (y=52 →
    // el4.8) is within tolerance; the node must ride the ~5 m contact, not store el4.8.
    const onSaveBoundary = vi.fn()
    const { queryAllByTestId } = renderOverlay({
      lithoLayers: matchedStackN,
      contactEdges: matchedEdgesN,
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map(),
    })
    const strip = interiorStrip(queryAllByTestId('partition-boundary-addstrip-silt-clay'))
    expect(strip).toBeTruthy()
    // S86 press-to-grab: press projects the node onto the contact + starts the drag;
    // release persists it. No mousemove → persists at the projected mousedown position.
    pressGrabRelease(strip!, { clientX: 50, clientY: 52 })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    const lower = onSaveBoundary.mock.calls[0][2] as { along_m: number; elevation_m: number }[]
    expect(lower).toHaveLength(1)
    // The node rides the contact (~5 m), NOT the raw cursor elevation (4.8 m).
    expect(lower[0].along_m).toBeCloseTo(50, 0)
    expect(lower[0].elevation_m).toBeGreaterThan(4.7)
    expect(lower[0].elevation_m).toBeLessThan(5.3)
  })

  it('N2 — a press ON a lens edge stores the node ON that edge, not floating in the lens interior', () => {
    // S99 edge-only: a press ON the silt lens's upper edge (its rendered strip's own
    // midpoint is guaranteed on that edge) must land the node on the picked lens edge,
    // never floating in the lens interior. The silt lens (depth 4..5 → elevation 5..6)
    // extent is [5,6] m; the projected node must sit within it.
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      lithoLayers: lensLayers, // silt lens (elevation 5..6) in sand on L; sand on R
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map(),
    })
    // Press ON the upper lens edge (the strip midpoint lies on it); projection must
    // land the node on the silt lens edge, within the lens elevation extent.
    const strip = getByTestId('partition-lens-addstrip-silt-upper')
    const mx = (Number(strip.getAttribute('x1')) + Number(strip.getAttribute('x2'))) / 2
    const my = (Number(strip.getAttribute('y1')) + Number(strip.getAttribute('y2'))) / 2
    pressGrabRelease(strip, { clientX: mx, clientY: my })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    // The click was inside the silt lens → it grabbed silt (not the sand matrix).
    expect(onSaveBoundary.mock.calls[0][0]).toBe('silt')
    const upper = onSaveBoundary.mock.calls[0][1] as { along_m: number; elevation_m: number }[]
    const lowerN = onSaveBoundary.mock.calls[0][2] as { along_m: number; elevation_m: number }[]
    const stored = [...upper, ...lowerN]
    expect(stored.length).toBeGreaterThanOrEqual(1)
    for (const n of stored) {
      // On a lens edge → within the lens elevation extent [5,6] m, NOT floating.
      expect(n.elevation_m).toBeGreaterThanOrEqual(4.9)
      expect(n.elevation_m).toBeLessThanOrEqual(6.1)
    }
  })

  it('A1 — a click near the lens source column cannot collapse the lens (visible-reach floor)', () => {
    // The owner's "i clicked the apex of the silt lens and it disappeared": the engine
    // emits the lens with its apex AT the stored node, so a click that drops a node
    // near the anchored column face pinches the lens to a hairline. The add gesture
    // must FLOOR the node's reach to a visible fraction of the gap. Fire a lens click
    // at the column-face side (x≈22, just inside the 20..80 gap) and assert the stored
    // node's along sits at least the visible floor (8% of 60px = 4.8 → x≥24.8) from
    // the source column — never collapsed onto it.
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      lithoLayers: lensLayers, // silt lens anchored on the LEFT column (x=20)
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map(),
    })
    // A press-to-grab hugging the left column face at x=22 (fraction ≈ 0.03) — the collapse
    // trigger. The mousedown PROJECTS + FLOORS the created node's reach (S72
    // ``applyReachFloorOnSegment``). Under S105 the node persists only on a DELIBERATE drag
    // (a click near the face is now an inert no-op — it cannot collapse the lens at all).
    // Drag from the face just past the visible-reach floor and release; the persisted node
    // sits at least the floor (≥ 8% of the 60px gap → x ≥ ~24.8) from the source column.
    pressGrabRelease(
      getByTestId('partition-lens-addstrip-silt-upper'),
      { clientX: 22, clientY: 47 },
      { clientX: 30, clientY: 47 },
    )
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    const upper = onSaveBoundary.mock.calls[0][1] as { along_m: number; elevation_m: number }[]
    const lowerN = onSaveBoundary.mock.calls[0][2] as { along_m: number; elevation_m: number }[]
    const stored = [...upper, ...lowerN]
    expect(stored.length).toBeGreaterThanOrEqual(1)
    // Every stored node sits at least the visible floor away from the left column
    // face (x=20) — reach ≥ 8% of the 60px gap → along ≥ ~24.8 (identity transform).
    for (const n of stored) {
      expect(n.along_m).toBeGreaterThanOrEqual(24.5)
    }
  })
})

// ===========================================================================
// S72 — a tie-bounded base contact is grabbable (fill-shape / contact-bend path,
// S67/S68). The owner's "can't resize units bounded by a base tie": the base of
// a stacked full-width band renders a boundary add-strip, and clicking it stores
// a contact node that the engine re-partitions (both bands follow, 0/0). This is
// a FILL-SHAPE edit, NOT a correlation-tie move — see the S72 report note.
// ===========================================================================
describe('PartitionFillOverlay — S72 tie-bounded base grab (engine v2)', () => {
  afterEach(() => {
    cleanup()
  })

  // A CORRELATED three-band stack (top-tied → every band spans the gap full-width),
  // the GEO-23/125-S10 shape: a full stratigraphic column where each contact is a
  // matched tie. The SILT band's base is a tie-bounded contact directly above CLAY.
  // Reshaping it is a FILL-SHAPE edit (S67/S68 contact-bend) — the base add-strip is
  // grabbable and both bands re-partition together, gap-free.
  function tEdge(a: string, b: string): LithoContactCorrelationEdge {
    return {
      id: `e-${a}-${b}`,
      layer_a_id: a,
      layer_b_id: b,
      layer_a_side: 'top',
      layer_b_side: 'top',
      model_id: 'm1',
      section_id: 's1',
      source: 'manual',
      user_approved: true,
      created_at: '2026-01-01T00:00:00Z',
    } as LithoContactCorrelationEdge
  }
  const matchedStack = [
    layer('a1', 'L', 'sand', 'fSand', 0, 3),
    layer('a2', 'L', 'silt', 'fSilt', 3, 5),
    layer('a3', 'L', 'clay', 'fClay', 5, 10),
    layer('b1', 'R', 'sand', 'fSand', 0, 3),
    layer('b2', 'R', 'silt', 'fSilt', 3, 5),
    layer('b3', 'R', 'clay', 'fClay', 5, 10),
  ]
  const matchedEdges = [tEdge('a1', 'b1'), tEdge('a2', 'b2'), tEdge('a3', 'b3')]

  /** The interior-gap add-strip (left endpoint at gap-left x≈20), not the open-end. */
  function interiorStrip(strips: HTMLElement[]): HTMLElement | undefined {
    return strips.find((el) => stripEnds(el).x1 < 40)
  }

  it('T1 — a stacked band whose base is a two-band contact renders a grabbable boundary add-strip', () => {
    const { queryAllByTestId } = renderOverlay({
      lithoLayers: matchedStack,
      contactEdges: matchedEdges,
      ...transforms,
      onSaveBoundary: vi.fn(),
      boundariesByBodyId: new Map(),
    })
    // The SILT band's base contact (silt over clay) is a grabbable add-strip that
    // runs HORIZONTALLY along the base (x1≈20, x2≈80), not a vertical column stub.
    const strip = interiorStrip(queryAllByTestId('partition-boundary-addstrip-silt-clay'))
    expect(strip).toBeTruthy()
    const { x1: t1x1, x2: t1x2 } = stripEnds(strip!)
    expect(t1x1).toBeLessThan(40) // gap-left
    expect(t1x2).toBeGreaterThan(60) // gap-right span
  })

  it('T2 — clicking a tie-bounded base add-strip stores a contact node on the upper band (contact-bend, both bands follow)', () => {
    const onSaveBoundary = vi.fn()
    const { queryAllByTestId } = renderOverlay({
      lithoLayers: matchedStack,
      contactEdges: matchedEdges,
      ...transforms,
      onSaveBoundary,
      boundariesByBodyId: new Map(),
    })
    // S99 edge-only: press ON the SILT base contact (y=50, el5), 2 px off at y=52
    // (within the hit tolerance); the node must SNAP onto the ~5 m contact, never
    // store the stray cursor el4.8.
    const strip = interiorStrip(queryAllByTestId('partition-boundary-addstrip-silt-clay'))
    expect(strip).toBeTruthy()
    pressGrabRelease(strip!, { clientX: 50, clientY: 52 })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    // The node is stored on the UPPER band (silt) lower_nodes (S68 contact-bend),
    // ON the base contact (~5 m), NOT the stray cursor elevation.
    expect(onSaveBoundary.mock.calls[0][0]).toBe('silt')
    const lower = onSaveBoundary.mock.calls[0][2] as { along_m: number; elevation_m: number }[]
    expect(lower).toHaveLength(1)
    expect(lower[0].elevation_m).toBeGreaterThan(4.7) // rides the ~5 m contact
    expect(lower[0].elevation_m).toBeLessThan(5.3)
  })
})

// Direct predicate contract: the shape signal that decides whether a region
// exposes the apex freedraw gesture, independent of either engine.
describe('isApexShapeable — the engine-agnostic tip predicate', () => {
  const region = (
    kind: 'quad' | 'pinch' | 'lens',
    fracs: number[],
  ): PartitionRegion => ({
    formationId: 'f',
    bodyId: 'b',
    kind,
    // Minimal ring: give each vertex a distinct elevation so it is non-degenerate.
    polygon: fracs.map((fraction, i) => ({ fraction, elevation: 10 - i })),
  })

  it('a lens is ALWAYS shapeable', () => {
    expect(isApexShapeable(region('lens', [0, 0.45, 0]))).toBe(true)
  })

  it('a lone pinch tip (anchored at 0, tapering to a mid-gap apex) is shapeable', () => {
    // v2 onlap tip, e.g. verts 0.00>0.00>0.50 or 0.50>1.00>1.00.
    expect(isApexShapeable(region('pinch', [0, 0, 0.5]))).toBe(true)
    expect(isApexShapeable(region('pinch', [0.5, 1, 1]))).toBe(true)
  })

  it('a full-width pinch (reaches BOTH columns) is NOT shapeable', () => {
    // v2 mixed-tie rising triangle spans f[0..1] — no free tip.
    expect(isApexShapeable(region('pinch', [1, 0, 1, 1, 0.55]))).toBe(false)
  })

  it('a full-width quad band is NOT shapeable', () => {
    expect(isApexShapeable(region('quad', [0, 1, 1, 0]))).toBe(false)
  })
})

// SC — SINGLE-SURFACE PER STORED NODE (engine v2). Owner dogfeed (2026-07-22,
// GEO-23/125-S10): "why do three points appear when i click? why can't i drag and
// drop reshape anymore?" ROOT (S73, measured): a body whose fill region is a
// shapeable pinch tip in one place but a full-width band elsewhere is claimed by
// BOTH the ``sharedBoundaries`` (contact-bend) pass AND the ``screenLenses``
// (lens-edge) pass — and by MULTIPLE boundary pairs where it is the upper body.
// So ONE stored ``lower_nodes`` node renders 3-4 handle dots (each clamped to a
// different band's y-range → dots scattered across the gap), and the drag can't be
// initiated on the intended body because the wrong surface owns the click. The
// rule the owner expects: a stored node belongs to EXACTLY ONE gesture surface —
// a lens/tip body's node is a LENS-edge node (screenLenses owns it); a full-width
// band's node is a CONTACT-bend node (sharedBoundaries owns it). Never both.
describe('PartitionFillOverlay — single-surface per stored node (SC, engine v2)', () => {
  afterEach(() => {
    cleanup()
  })

  function onlapEdge(a: string, b: string): LithoContactCorrelationEdge {
    return {
      id: `e-${a}-${b}`,
      layer_a_id: a,
      layer_b_id: b,
      layer_a_side: 'top',
      layer_b_side: 'top',
      model_id: 'm1',
      section_id: 's1',
      source: 'manual',
      user_approved: true,
      created_at: '2026-01-01T00:00:00Z',
    } as LithoContactCorrelationEdge
  }
  // L: clay / silt / sand ; R: clay / sand. Silt (L only) top-tied to R sand → a v2
  // ONLAP tip. The onlap carves SAND into a shapeable pinch in the gap while sand is
  // also a full-width band elsewhere — the exact SC1 collision.
  const onlapLayers = [
    layer('l-clay', 'L', 'clay', 'fClay', 0, 3),
    layer('l-silt', 'L', 'silt', 'fSilt', 3, 4),
    layer('l-sand', 'L', 'sand', 'fSand', 4, 8),
    layer('r-clay', 'R', 'clay', 'fClay', 0, 3),
    layer('r-sand', 'R', 'sand', 'fSand', 3, 8),
  ]

  function allHandleDots(container: HTMLElement): Element[] {
    return Array.from(
      container.querySelectorAll(
        '[data-testid^="partition-lens-handle-"],[data-testid^="partition-boundary-handle-"]',
      ),
    )
  }

  it('SC1 — ONE stored node on a body renders EXACTLY ONE draggable handle dot, not three', () => {
    // The owner's "why do three points appear when i click?": a single stored node
    // must render as a single control dot. Store ONE node on sand's lower_nodes (the
    // shape a click produces) and count the visible handle dots for ALL bodies.
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...base}
          lithoLayers={onlapLayers}
          contactEdges={[onlapEdge('l-silt', 'r-sand')]}
          {...transforms}
          onSaveBoundary={vi.fn()}
          boundariesByBodyId={
            new Map([
              [
                'sand',
                {
                  upper_nodes: [],
                  lower_nodes: [{ along_m: 50, elevation_m: 2 }],
                } as unknown as BodyBoundaryResponse,
              ],
            ])
          }
        />
      </svg>,
    )
    // Before the fix this was 4 (sand-sand, sand-silt boundary handles + sand-lower
    // lens handle ×2), scattered across the gap. Exactly one node → exactly one dot.
    expect(allHandleDots(container as HTMLElement)).toHaveLength(1)
  })

  it('SC2 — a shapeable-tip body node is a LENS handle, not ALSO a contact-bend handle', () => {
    // Store the node on silt (the onlap tip itself) — its handle must live on the
    // lens surface only, never duplicated onto a boundary pair.
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...base}
          lithoLayers={onlapLayers}
          contactEdges={[onlapEdge('l-silt', 'r-sand')]}
          {...transforms}
          onSaveBoundary={vi.fn()}
          boundariesByBodyId={
            new Map([
              [
                'silt',
                {
                  upper_nodes: [{ along_m: 40, elevation_m: 5 }],
                  lower_nodes: [],
                } as unknown as BodyBoundaryResponse,
              ],
            ])
          }
        />
      </svg>,
    )
    const dots = allHandleDots(container as HTMLElement)
    expect(dots).toHaveLength(1)
    // The one dot is a LENS handle (silt is a shapeable tip), never a boundary handle.
    expect(dots[0].getAttribute('data-testid')).toMatch(/^partition-lens-handle-silt-/)
  })

  it('SC3 — a full-width band contact node stays a boundary handle (no regression)', () => {
    // The matched two-band stack (base fixture): sand + clay both span the gap →
    // full-width bands. A stored contact node on sand is a CONTACT-bend node and must
    // still render exactly one boundary handle (the S68 contact-bend path unbroken).
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...base}
          {...transforms}
          onSaveBoundary={vi.fn()}
          boundariesByBodyId={
            new Map([
              [
                'sand',
                {
                  upper_nodes: [],
                  lower_nodes: [{ along_m: 50, elevation_m: 5 }],
                } as unknown as BodyBoundaryResponse,
              ],
            ])
          }
        />
      </svg>,
    )
    const dots = allHandleDots(container as HTMLElement)
    expect(dots).toHaveLength(1)
    expect(dots[0].getAttribute('data-testid')).toMatch(/^partition-boundary-handle-sand-/)
  })

  // An ENCLOSED silt lens in a sand matrix on L; continuous sand on R — the engine-
  // consumed shapeable face (S64). Gap [20,80].
  const enclosedLensLayers = [
    layer('vl1', 'L', 'sand', 'fSand', 0, 4),
    layer('vl2', 'L', 'silt', 'fSilt', 4, 6),
    layer('vl3', 'L', 'sand2', 'fSand', 6, 10),
    layer('vr1', 'R', 'sand', 'fSand', 0, 10),
  ]

  function siltApexReach(el: HTMLElement): number {
    const d = el.getAttribute('d') ?? ''
    let maxX = -Infinity
    for (const m of d.matchAll(/[ML]\s*(-?[\d.]+),(-?[\d.]+)/g)) {
      const x = parseFloat(m[1])
      if (x > maxX) maxX = x
    }
    return maxX
  }

  it('SC4 — press-to-grab reshape: ONE gesture — press the add-strip creates AND grabs the node, the drag reshapes the fill LIVE, release persists', () => {
    // The owner's S86 "i just want to click down and drag": the OLD flow was two-step
    // (press dropped a node, then a SEPARATE press-drag on its handle reshaped). This
    // asserts the unified gesture: a single mousedown on the add-strip creates and grabs
    // the new node; dragging deep into the gap reshapes the engine fill LIVE (no re-render
    // between add and grab); release persists the shaped node. Full round-trip through the
    // real press → live-inject → drag → persist path (not a pre-seeded node).
    const onSaveBoundary = vi.fn<(id: string, u: unknown[], l: unknown[], k: string) => void>()
    const stored = new Map<string, BodyBoundaryResponse>()
    const r1 = render(
      <svg>
        <PartitionFillOverlay
          {...base}
          lithoLayers={enclosedLensLayers}
          {...transforms}
          onSaveBoundary={onSaveBoundary}
          boundariesByBodyId={stored}
        />
      </svg>,
    )
    // The silt apex reach at rest (no stored node), before any interaction.
    const restReach = siltApexReach(r1.getByTestId('partition-region-silt'))
    // 1. PRESS ON the silt lens upper edge (S99 edge-only — the strip's own midpoint
    //    lies on the edge). This SAME mousedown creates the node AND starts the drag —
    //    no persist yet, no separate handle grab.
    const upStrip = r1.getByTestId('partition-lens-addstrip-silt-upper')
    fireEvent.mouseDown(upStrip, {
      clientX: (Number(upStrip.getAttribute('x1')) + Number(upStrip.getAttribute('x2'))) / 2,
      clientY: (Number(upStrip.getAttribute('y1')) + Number(upStrip.getAttribute('y2'))) / 2,
    })
    // No persist on press — the drag is in flight (Approach B, single save on release).
    expect(onSaveBoundary).toHaveBeenCalledTimes(0)
    // 2. DRAG deep into the gap → the fill FOLLOWS the cursor LIVE (the new node is
    //    injected into the override even though it is not yet stored).
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: 72, clientY: 50 }))
    })
    const draggedReach = siltApexReach(r1.getByTestId('partition-region-silt'))
    expect(draggedReach, 'the new node did not reshape the fill live on press-drag').toBeGreaterThan(
      restReach + 10,
    )
    // 3. RELEASE persists the shaped node (exactly one save, on silt, routed as a lens).
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'))
    })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    expect(onSaveBoundary.mock.calls[0][0]).toBe('silt')
    r1.unmount()
  })
  it('CSF-OVL — the dissolved fill reaches the column cards’ outer edges', () => {
    // Owner dogfeed 2026-08-14: "Litho fill still only present between
    // columns" — the fill must paint THROUGH the cards, not stop at their
    // edges. In the base scene the L card spans x -20..20 and the R card
    // x 80..120; the gap regions alone would only ever cover 20..80.
    const { container } = renderOverlay({ contactEdges: baseMatchedEdges })
    const ds = Array.from(
      container.querySelectorAll('[data-testid^="partition-fill-group-"]'),
    ).map(el => el.getAttribute('d') ?? '')
    expect(ds.length).toBeGreaterThan(0)
    const xs = ds.flatMap(d =>
      Array.from(d.matchAll(/(-?[\d.]+)[ ,](-?[\d.]+)/g)).map(m => Number(m[1])),
    )
    expect(Math.min(...xs), 'fill reaches the left card’s outer edge').toBeLessThanOrEqual(-20)
    expect(Math.max(...xs), 'fill reaches the right card’s outer edge').toBeGreaterThanOrEqual(120)
  })
})
