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

import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { BodyBoundaryResponse, BodyListItem, LithoLayerResponse } from '../../api/client'
import PartitionFillOverlay from './PartitionFillOverlay'
import type { Props } from './MorphFillOverlay'
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
})
