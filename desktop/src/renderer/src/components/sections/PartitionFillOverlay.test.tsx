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

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type {
  BodyBoundaryResponse,
  BodyListItem,
  LithoContactCorrelationEdge,
  LithoLayerResponse,
} from '../../api/client'
import * as partitionFillModule from '../../utils/partitionFill'
import type { PartitionRegion } from '../../utils/partitionFill'
import { setPartitionEngineV2 } from '../../utils/partitionEngineSelect'
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
  // FD1: Two stored nodes → two handles, both polygons gain two vertices
  // --------------------------------------------------------------------------
  it('FD1 — a matched boundary with TWO stored lower_nodes renders two handles and both polygons gain TWO interior vertices', () => {
    // Two control points at x=40 and x=60 (both inside gap 20..80).
    const { getByTestId, queryAllByTestId } = renderOverlay({
      ...transforms,
      onSaveBoundary: vi.fn(),
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
    // Both handles rendered.
    expect(getByTestId('partition-boundary-handle-sand-clay-0')).toBeTruthy()
    expect(getByTestId('partition-boundary-handle-sand-clay-1')).toBeTruthy()

    // Sand polygon should have ≥6 vertex commands (4 natural + 2 inserted).
    const sandPaths = queryAllByTestId('partition-region-sand')
    const sandD = sandPaths[0].getAttribute('d') ?? ''
    const sandVertexCount = (sandD.match(/[ML]/g) ?? []).length
    expect(sandVertexCount).toBeGreaterThanOrEqual(6)

    // Clay polygon should also have ≥6 vertex commands.
    const clayPaths = queryAllByTestId('partition-region-clay')
    const clayD = clayPaths[0].getAttribute('d') ?? ''
    const clayVertexCount = (clayD.match(/[ML]/g) ?? []).length
    expect(clayVertexCount).toBeGreaterThanOrEqual(6)
  })

  // --------------------------------------------------------------------------
  // FD2: Clicking the add-strip inserts a new node
  // --------------------------------------------------------------------------
  it('FD2 — clicking the matched-boundary add-strip calls onSaveBoundary with a new node appended', () => {
    const onSaveBoundary = vi.fn()
    const { getByTestId } = renderOverlay({
      ...transforms,
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
    // Click the add-strip at an arbitrary client position.
    fireEvent.click(getByTestId('partition-boundary-addstrip-sand-clay'), {
      clientX: 60,
      clientY: 55,
    })
    expect(onSaveBoundary).toHaveBeenCalledTimes(1)
    expect(onSaveBoundary.mock.calls[0][0]).toBe('sand')
    // lower_nodes should now have 2 entries (1 existing + 1 new).
    const lowerNodes = onSaveBoundary.mock.calls[0][2] as { along_m: number; elevation_m: number }[]
    expect(lowerNodes).toHaveLength(2)
    expect(onSaveBoundary.mock.calls[0][3]).toBe('straight')
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
  // HP1-HP2: Add-strip hover preview dot (owner directive 2026-06-05)
  //
  //   HP1 — mouseMove over a matched-boundary add-strip → preview dot appears.
  //   HP2 — mouseLeave the add-strip → preview dot disappears.
  // --------------------------------------------------------------------------

  it('HP1 — mouseMove over a matched-boundary add-strip renders a partition-addnode-preview circle', () => {
    // No nodes stored — the strip is always rendered when onSaveBoundary is wired.
    const { getByTestId, queryByTestId } = renderOverlay({ ...transforms, onSaveBoundary: vi.fn() })
    // Preview absent before hover.
    expect(queryByTestId('partition-addnode-preview')).toBeNull()
    // Move the pointer over the add-strip.
    fireEvent.mouseMove(getByTestId('partition-boundary-addstrip-sand-clay'), {
      clientX: 55,
      clientY: 60,
    })
    // Preview dot now present.
    expect(getByTestId('partition-addnode-preview')).toBeTruthy()
  })

  it('HP2 — mouseLeave the matched-boundary add-strip removes the preview dot', () => {
    const { getByTestId, queryByTestId } = renderOverlay({ ...transforms, onSaveBoundary: vi.fn() })
    // Hover in.
    fireEvent.mouseMove(getByTestId('partition-boundary-addstrip-sand-clay'), {
      clientX: 55,
      clientY: 60,
    })
    expect(getByTestId('partition-addnode-preview')).toBeTruthy()
    // Hover out.
    fireEvent.mouseLeave(getByTestId('partition-boundary-addstrip-sand-clay'))
    expect(queryByTestId('partition-addnode-preview')).toBeNull()
  })

  it('HP3 — mouseMove over a lens add-strip renders a partition-addnode-preview circle', () => {
    const { getByTestId, queryByTestId } = renderOverlay({
      lithoLayers: lensLayers,
      ...transforms,
      onSaveBoundary: vi.fn(),
    })
    // No preview before hover.
    expect(queryByTestId('partition-addnode-preview')).toBeNull()
    // Move over the upper-edge lens strip.
    fireEvent.mouseMove(getByTestId('partition-lens-addstrip-silt-upper'), {
      clientX: 50,
      clientY: 65,
    })
    expect(getByTestId('partition-addnode-preview')).toBeTruthy()
    // Leave → gone.
    fireEvent.mouseLeave(getByTestId('partition-lens-addstrip-silt-upper'))
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
    // Spy on computeSectionFill through its module binding. Vitest makes ES
    // module exports mutable so spyOn wraps the real implementation while
    // counting calls. We call through (no mockImplementation) so the overlay
    // still renders correctly and the test only asserts call-count behaviour.
    const spy = vi.spyOn(partitionFillModule, 'computeSectionFill')

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
  //   SEAM1  every region-fill polygon carries stroke === its fill colour,
  //          strokeWidth 0.75, strokeLinejoin round, and strokeOpacity equal to
  //          the polygon's fillOpacity (the S1-fade variable, not the 0.45
  //          STROKE_OPACITY that would read as a darker outline).
  //   SEAM2  the open-end stub rects (which tile the section's open ends) carry
  //          the same self-colour seam stroke at the fill opacity.
  // --------------------------------------------------------------------------
  it('SEAM1 — every region fill carries a self-colour seam stroke at the fill opacity', () => {
    const { queryAllByTestId } = renderOverlay()
    const regions = [
      ...queryAllByTestId('partition-region-sand'),
      ...queryAllByTestId('partition-region-clay'),
    ]
    expect(regions.length).toBeGreaterThanOrEqual(2)
    for (const el of regions) {
      const fill = el.getAttribute('fill')
      // Stroke must equal the region's own fill colour so the seam closes without
      // painting a foreign colour across the boundary.
      expect(el.getAttribute('stroke')).toBe(fill)
      expect(el.getAttribute('stroke-width')).toBe('0.75')
      expect(el.getAttribute('stroke-linejoin')).toBe('round')
      // strokeOpacity must match fillOpacity exactly — a stroke ABOVE the 0.62
      // fill opacity would read as a darker outline (wrong).
      expect(el.getAttribute('stroke-opacity')).toBe(el.getAttribute('fill-opacity'))
    }
  })

  it('SEAM1-fade — a demoted (S1-faded) region strokes at its FADED opacity, not the natural one', () => {
    // With a body selected, non-matching regions fade to 0.25. The seam stroke
    // must track that faded fillOpacity (the same variable), else the outline
    // stays bright while the fill dims.
    const { queryAllByTestId } = renderOverlay({ selectedBodyId: 'sand' })
    const clay = queryAllByTestId('partition-region-clay')
    expect(clay.length).toBeGreaterThanOrEqual(1)
    for (const el of clay) {
      expect(el.getAttribute('fill-opacity')).toBe('0.25')
      expect(el.getAttribute('stroke-opacity')).toBe('0.25')
      expect(el.getAttribute('stroke')).toBe(el.getAttribute('fill'))
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
  // Force the v2 engine for this block only; restore v1 afterward so the rest of
  // the suite (which pins on v1 shapes) is unaffected.
  beforeEach(() => setPartitionEngineV2(true))
  afterEach(() => {
    setPartitionEngineV2(false)
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
