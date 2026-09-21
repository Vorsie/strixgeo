// Warp-transform render tests for PartitionFillOverlay.
//
// The recurring "floats off its column at non-100% spacing" bug class is caused by
// using raw xToScreen instead of warpedXToScreen. These two tests FAIL if the
// overlay regresses:
//
//   WARP-1  Region polygon x-coords come from PACKED nudgedX (col.nudgedX ± halfW),
//           NOT from along * scale.  Catches any regression inside the region
//           polygon emitter (``leftX + fraction * (rightX - leftX)``).
//
//   WARP-2  Boundary-node handle cx comes from packed ``alongToScreenX(n.along_m)``,
//           NOT from linear along * scaleH.  Catches any regression to bare
//           ``xToScreen`` in the handle placement path.
//
// Scenario: three columns at true along=0/50/100 m, packed to screen-x 300/340/500.
// The MIDDLE column (along=50) sits at nudgedX=340 — only 40 px to the right of the
// left column, while a UNIFORM 2 px/m scale would place it at x=400 (+60 px).
//
//   Gap L-M: leftX = 310, rightX = 330  (packed)
//            linear 2 px/m:  leftX=310, rightX=390 — mismatch is >50 px
//
// Both tests assert screen-x values near the PACKED 310-330 range, making any
// regression to linear or identity immediately visible as a ±60 px offset.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  BodyBoundaryResponse,
  LithoContactCorrelationEdge,
  LithoLayerResponse,
} from '../../api/client'
import PartitionFillOverlay from './PartitionFillOverlay'
import type { Props } from './PartitionFillOverlay'
import type { PlacedColumn } from './utils'
import { layer } from './__fixtures__/partitionFillScene'

afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// Warp helpers
// ---------------------------------------------------------------------------

const HALF_W = 10 // halfWidth of each column (width=20 px)

function warpedColumn(inv: string, along: number, nudgedX: number, elev: number): PlacedColumn {
  return {
    kind: 'borehole',
    nudgedX,
    trueX: nudgedX,
    width: HALF_W * 2,
    displaced: false,
    proj: { along, offset: 0, item: { id: inv, elevation_m: elev } },
  } as unknown as PlacedColumn
}

/**
 * Forward piecewise-linear warp (mirrors ``warpedXToScreen`` in SectionPanel).
 *
 * Anchors (along → effX):
 *   0 m  → 300 px
 *  50 m  → 340 px   ← PACKED: only 40 px from L; linear 2 px/m would give 400 px
 * 100 m  → 500 px
 */
function fwdWarp(along: number): number {
  const anchors = [
    { along: 0, effX: 300 },
    { along: 50, effX: 340 },
    { along: 100, effX: 500 },
  ] as const
  let i = 0
  while (i < anchors.length - 1 && anchors[i + 1].along < along) i += 1
  if (i >= anchors.length - 1) {
    const last = anchors[anchors.length - 1]
    const prev = anchors[anchors.length - 2]
    const rate = (last.effX - prev.effX) / (last.along - prev.along)
    return last.effX + (along - last.along) * rate
  }
  const a = anchors[i]
  const b = anchors[i + 1]
  return a.effX + ((along - a.along) / (b.along - a.along)) * (b.effX - a.effX)
}
// Spot-check: fwdWarp(25) = 300 + (25/50)*40 = 320  →  inside gap L-M [310,330] ✓

function edge(
  id: string,
  layerAId: string,
  layerBId: string,
): LithoContactCorrelationEdge {
  return {
    id,
    layer_a_id: layerAId,
    layer_b_id: layerBId,
    layer_a_side: 'top',
    layer_b_side: 'top',
    model_id: 'm1',
    section_id: 's1',
    source: 'manual',
    user_approved: true,
    created_at: '2026-01-01T00:00:00Z',
  } as LithoContactCorrelationEdge
}

const colors = new Map([
  ['fSand', '#fbbf24'],
  ['fClay', '#6b7280'],
])

// Minimal matched stack: sand(0-5m) + clay(5-10m) on all three columns.
// layer ids are used as layer_a_id / layer_b_id in the edges.
const warpLayers: LithoLayerResponse[] = [
  layer({ id: 'L-sa', investigationId: 'L', bodyId: 'sand', formationId: 'fSand', depthTopM: 0, depthBaseM: 5 }),
  layer({ id: 'L-cl', investigationId: 'L', bodyId: 'clay', formationId: 'fClay', depthTopM: 5, depthBaseM: 10 }),
  layer({ id: 'M-sa', investigationId: 'M', bodyId: 'sand', formationId: 'fSand', depthTopM: 0, depthBaseM: 5 }),
  layer({ id: 'M-cl', investigationId: 'M', bodyId: 'clay', formationId: 'fClay', depthTopM: 5, depthBaseM: 10 }),
  layer({ id: 'R-sa', investigationId: 'R', bodyId: 'sand', formationId: 'fSand', depthTopM: 0, depthBaseM: 5 }),
  layer({ id: 'R-cl', investigationId: 'R', bodyId: 'clay', formationId: 'fClay', depthTopM: 5, depthBaseM: 10 }),
]

// Both bounding contacts correlated → BAND in each gap.
// Sand top: L-sa↔M-sa, M-sa↔R-sa.
// Clay top (= sand base): L-cl↔M-cl, M-cl↔R-cl.
const warpEdges: LithoContactCorrelationEdge[] = [
  edge('e1', 'L-sa', 'M-sa'),
  edge('e2', 'M-sa', 'R-sa'),
  edge('e3', 'L-cl', 'M-cl'),
  edge('e4', 'M-cl', 'R-cl'),
]

// elev=10 m: levelToScreen(10)=0, levelToScreen(5)=50, levelToScreen(0)=100.
const warpBase: Props = {
  lithoLayers: warpLayers,
  contactEdges: warpEdges,
  placedColumns: [
    warpedColumn('L', 0, 300, 10),
    warpedColumn('M', 50, 340, 10),
    warpedColumn('R', 100, 500, 10),
  ],
  formationColorById: colors,
  showBands: true,
  levelToScreen: (l: number) => (10 - l) * 10,
  plotTop: 0,
  plotBottom: 400,
  // Plot edges extend to column outer edges so open-end stubs don't clamp.
  plotLeft: 290,
  plotRight: 510,
  alongToScreenX: fwdWarp,
  screenXToAlong: (x: number) => (x - 300) / 2,
  screenToLevel: (y: number) => 10 - y / 10,
}

// Extract all M/L x-values from a path `d` attribute ("M x,y L x,y ... Z").
function pathXs(el: Element): number[] {
  const d = el.getAttribute('d') ?? ''
  return [...d.matchAll(/[ML]\s*([\d.]+),([\d.]+)/g)].map((m) => parseFloat(m[1]))
}

describe('PartitionFillOverlay — warp-transform render', () => {
  it('WARP-1 — region polygon x comes from packed nudgedX, not linear along*scale', () => {
    // Column L: nudgedX=300, M: nudgedX=340 (PACKED to 40 px right of L).
    // Gap L-M screen bounds: leftX = 300+10 = 310, rightX = 340-10 = 330.
    // Any x > 335 in the L-M gap would indicate the overlay switched to a
    // linear along*scale transform (which puts M at ~400, gap rightX ~390).
    const { queryAllByTestId } = render(
      <svg>
        <PartitionFillOverlay {...warpBase} />
      </svg>,
    )

    const sandRegions = queryAllByTestId('partition-region-sand')
    expect(sandRegions.length).toBeGreaterThanOrEqual(1)

    // At least one sand region must sit entirely inside the packed L-M gap [310,330].
    const lmRegion = sandRegions.find((el) => {
      const xs = pathXs(el)
      return xs.length > 0 && xs.some((x) => x >= 309 && x <= 331)
    })
    expect(lmRegion).toBeTruthy()

    // All x-coords in the found region: packed range [310,330], ±1 px rounding.
    const xs = pathXs(lmRegion!)
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(309)
      expect(x).toBeLessThanOrEqual(331)
    }
  })

  it('WARP-2 — boundary-node handle cx comes from packed alongToScreenX, not linear scale', () => {
    // Node at along_m=25 → fwdWarp(25) = 300 + (25/50)*40 = 320.
    // 320 is inside gap L-M [310,330] so the gap-filter (nx >= leftX && nx <= rightX)
    // passes and the handle renders.
    //
    // Regression paths that would break this:
    //   - raw xToScreen(25) = 25         → far outside the gap → handle not rendered → getByTestId throws
    //   - linear 2px/m: 300+25*2 = 350   → outside gap [310,330] → handle not rendered → throws
    //   - clamped linear: min(329, 350) = 329  → cx=329 ≠ 320 → the toBeCloseTo assertion fails
    const { getByTestId } = render(
      <svg>
        <PartitionFillOverlay
          {...warpBase}
          onSaveBoundary={vi.fn()}
          boundariesByBodyId={
            new Map([
              [
                'sand',
                {
                  upper_nodes: [],
                  lower_nodes: [{ along_m: 25, elevation_m: 5.0 }],
                } as unknown as BodyBoundaryResponse,
              ],
            ])
          }
        />
      </svg>,
    )

    // Handle must exist — proves the node's cx was inside gap L-M [310,330].
    const handle = getByTestId('partition-boundary-handle-sand-clay-0')
    expect(handle).toBeTruthy()

    // cx must equal fwdWarp(25) = 320, not a linear or identity value.
    const cx = parseFloat(handle.getAttribute('cx') ?? 'NaN')
    expect(cx).toBeCloseTo(320, 0)
  })
})
