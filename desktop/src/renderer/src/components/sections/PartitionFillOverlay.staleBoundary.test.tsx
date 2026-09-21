/**
 * A stored boundary node must never repaint a body across an accepted tie.
 *
 * Owner dogfeed 2026-08-05 (coworker demo): a July-27 hand-drawn boundary on
 * the SILT body's LOWER boundary — the very contact the engineer had since
 * TIED — rendered a KLEI wedge ABOVE the tie in the S13↔S12 gap on CS1. The
 * v2 engine itself refuses the node (§77 un-routable → silent no-op) and the
 * off-engine post-bend is retired on v2, so whatever paints the wedge is a
 * third path this scene pins shut: with a tied contact and a stored node
 * rising above the seam, NO fill of the lower formation's colour may appear
 * above the tied seam.
 */

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import PartitionFillOverlay from './PartitionFillOverlay'
import type { Props } from './PartitionFillOverlay'
import type {
  BodyBoundaryResponse,
  LithoContactCorrelationEdge,
  LithoLayerResponse,
} from '../../api/client'
import { layer, column } from './__fixtures__/partitionFillScene'

afterEach(cleanup)

function edge(a: string, b: string): LithoContactCorrelationEdge {
  return {
    id: `e-${a}-${b}`,
    model_id: 'litho-model-1',
    section_id: 'sec-1',
    layer_a_id: a,
    layer_b_id: b,
    layer_a_side: 'top',
    layer_b_side: 'top',
    source: 'manual',
    user_approved: true,
  } as unknown as LithoContactCorrelationEdge
}

// SILT over KLEI on both columns; both contacts tied → the KLEI top is a
// correlated BAND seam at elevation 5 (screen y = 150).
const LITHO_LAYERS: LithoLayerResponse[] = [
  layer({ id: 'a-silt', investigationId: 'L', formationId: 'formation-silt', depthTopM: 0, depthBaseM: 5, bodyId: 'body-silt' }),
  layer({ id: 'a-klei', investigationId: 'L', formationId: 'formation-klei', depthTopM: 5, depthBaseM: 10, bodyId: 'body-klei' }),
  layer({ id: 'b-silt', investigationId: 'R', formationId: 'formation-silt', depthTopM: 0, depthBaseM: 5, bodyId: 'body-silt' }),
  layer({ id: 'b-klei', investigationId: 'R', formationId: 'formation-klei', depthTopM: 5, depthBaseM: 10, bodyId: 'body-klei' }),
]
const EDGES = [edge('a-silt', 'b-silt'), edge('a-klei', 'b-klei')]

const SILT_COLOR = '#aac84a'
const KLEI_COLOR = '#7d8da0'

// The stale reshape: the SILT body's LOWER boundary pulled up above the tied
// seam mid-gap — the exact shape of the July-27 node pair (thin at the left,
// apex at half-gap well above the seam).
const BOUNDARIES = new Map<string, BodyBoundaryResponse>([
  [
    'body-silt',
    {
      body_id: 'body-silt',
      content_key: null,
      render_style: 'straight',
      primary_section_id: null,
      upper_nodes: [],
      lower_nodes: [
        { along_m: 20, elevation_m: 5.1 },
        { along_m: 50, elevation_m: 8 },
      ],
    } as unknown as BodyBoundaryResponse,
  ],
])

const baseProps: Props = {
  lithoLayers: LITHO_LAYERS,
  contactEdges: EDGES,
  placedColumns: [column({ investigationId: 'L', along: 0, elevationM: 10 }), column({ investigationId: 'R', along: 100, elevationM: 10 })],
  formationColorById: new Map([
    ['formation-silt', SILT_COLOR],
    ['formation-klei', KLEI_COLOR],
  ]),
  showBands: true,
  levelToScreen: (l: number) => 200 - l * 10,
  plotTop: 0,
  plotBottom: 400,
  plotLeft: 0,
  plotRight: 200,
  alongToScreenX: (a: number) => a,
  screenXToAlong: (x: number) => x,
  screenToLevel: (y: number) => (200 - y) / 10,
  boundariesByBodyId: BOUNDARIES,
}

/** Min screen-y (highest point) of every path filled with the given colour. */
function minYOfFill(container: HTMLElement, color: string): number {
  let minY = Infinity
  for (const el of container.querySelectorAll(`path[fill="${color}"]`)) {
    const d = el.getAttribute('d') ?? ''
    for (const m of d.matchAll(/[ML]\s*[-\d.]+[ ,]([-\d.]+)/g)) {
      const y = Number(m[1])
      if (Number.isFinite(y) && y < minY) minY = y
    }
  }
  return minY
}

// Ran as a describe.each over BOTH engines until v1 was archived (#280) —
// v1 was the engine that actually painted the owner's demo wedge, through its
// off-engine POST-BEND pass. That pass left with v1; the invariant is pinned
// on the one engine that remains.
describe('PartitionFillOverlay — a stale boundary node never repaints across a tie', () => {

  it('SB1 — the KLEI fill stays below the tied seam despite the stored node above it', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...baseProps} />
      </svg>,
    )
    // The tied seam is flat at elevation 5 → screen y 150. The KLEI colour may
    // touch the seam but must not rise meaningfully above it — the stored node
    // (apex at elevation 8 → y 120) must be a no-op on a tie-owned seam.
    const kleiTop = minYOfFill(container, KLEI_COLOR)
    expect(kleiTop).toBeGreaterThanOrEqual(149)
  })

  it('SB2 — control: without the stored node the same scene is band-clean', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...baseProps} boundariesByBodyId={undefined} />
      </svg>,
    )
    expect(minYOfFill(container, KLEI_COLOR)).toBeGreaterThanOrEqual(149)
  })
})
