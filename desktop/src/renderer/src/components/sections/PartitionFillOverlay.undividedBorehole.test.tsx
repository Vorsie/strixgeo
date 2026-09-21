// The geotech axis BEFORE the boreholes are divided — the owner's dogfeed of
// 2026-08-15, three complaints in one screenshot:
//
//   "clearly the litho model isn't the base of the geotech fill because it
//    mismatches a ton"
//   "what are those weird polygons between the boreholes?"   (thin radiating
//    wedges spanning the borehole positions)
//   "i don't see the hashed fallback nowhere"
//
// All three are one cause. An undivided borehole carries litho layers and NO
// packing bands, so the geotech assembly DROPS that column: the packing engine
// sees one wide test-to-test gap straight over the borehole and fills it with
// terminations that answer to no column (the wedges), the two partitions no
// longer share a gap axis so the litho-frame clip is skipped (the mismatch),
// and with the clip skipped there are no per-face un-banded areas, so the
// "correlate me" texture has nothing to draw over (no hatch).
//
// KEPT through the 2026-08-18 HIERARCHICAL rewrite (owner: "it's the same basic
// rules only with densities on top of lithos"). The fill is now computed per
// LITHO FAMILY, which made the meaning of a bandless column a real question, and
// this ruling is the answer to it:
//
//   a column that CARRIES the family's litho unit and has not been divided
//   BLOCKS the family's constructs — the mass is there and nobody classified it,
//   so both gaps it flanks read "correlate me". (A column carrying no unit of
//   the family at all is a different case: the family genuinely is not there, so
//   the engine's bridge machinery spans it. See H7/H8 in the module's own pins.)
//
// The borehole below carries BOTH litho units and no bands, so it blocks both
// families and every claim here is the 2026-08-15 one, unchanged:
//   UB1  No packing fill is painted across an un-banded column.
//   UB2  The ground flanking the un-banded column reads as "correlate me" —
//        lithology colour under the texture, in BOTH gaps that touch it.
//   UB3  A gap between two banded columns keeps its packing fill; the fix is
//        not "stop filling".
//   UB4  The litho frame governs: every packing fill sits inside it.
//   UB6  A litho unit NO test subdivided reads "correlate me" too — the second
//        way ground goes un-classed, so UB2's texture pin cannot pass merely
//        because a borehole happens to be un-divided.

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { nadClassColor } from '../../utils/nadClasses'
import PartitionFillOverlay, { type GeotechLithoFrame, type Props } from './PartitionFillOverlay'
import { coverageDefects, paintedElements } from './partitionFillSampling.testutil'
import type { LithoContactCorrelationEdge, LithoLayerResponse } from '../../api/client'
import { layer, column } from './__fixtures__/partitionFillScene'

afterEach(() => cleanup())

function edge(a: string, b: string, side: 'top' | 'base' = 'top'): LithoContactCorrelationEdge {
  return {
    id: `e-${a}-${b}-${side}`,
    model_id: 'model-1',
    section_id: 'sec-1',
    layer_a_id: a,
    layer_b_id: b,
    layer_a_side: side,
    layer_b_side: side,
    source: 'manual',
    user_approved: true,
  } as unknown as LithoContactCorrelationEdge
}

// ---------------------------------------------------------------------------
// The scene, in the shape of the owner's CS1: four columns 100 m apart. Every
// one carries the same litho stack (SAND 0-10 over CLAY 10-15), all correlated
// left to right. The packing pipeline has run over the TESTS (L, M, R) but not
// over the BOREHOLE (B) — pipeline step 4 has not been pressed.
//
// Column x (nudgedX ± width/2 = ±20):  L 0 | M 100 | B 200 | R 300
// Gaps:   0 = L..M  x 20..80     (both banded)
//         1 = M..B  x 120..180   (touches the un-banded borehole)
//         2 = B..R  x 220..280   (touches the un-banded borehole)
// ---------------------------------------------------------------------------
const COLUMNS = ['L', 'M', 'B', 'R'] as const
const GAP_X: Record<number, [number, number]> = {
  0: [20, 80],
  1: [120, 180],
  2: [220, 280],
}

const LITHO_LAYERS: LithoLayerResponse[] = COLUMNS.flatMap((inv) => [
  layer({ id: `l-${inv}-sand`, investigationId: inv, formationId: 'formation-sand', depthTopM: 0, depthBaseM: 10, bodyId: 'body-sand' }),
  layer({ id: `l-${inv}-clay`, investigationId: inv, formationId: 'formation-clay', depthTopM: 10, depthBaseM: 15, bodyId: 'body-clay' }),
])
const LITHO_EDGES: LithoContactCorrelationEdge[] = COLUMNS.slice(0, -1).flatMap((inv, i) => {
  const next = COLUMNS[i + 1]
  return [
    edge(`l-${inv}-sand`, `l-${next}-sand`),
    edge(`l-${inv}-clay`, `l-${next}-clay`),
    edge(`l-${inv}-clay`, `l-${next}-clay`, 'base'),
  ]
})

// The packing model: L, M and R subdivided; B has NOTHING.
const BANDED = ['L', 'M', 'R'] as const
const GEOTECH_LAYERS: LithoLayerResponse[] = BANDED.flatMap((inv) => [
  layer({ id: `g-${inv}-0`, investigationId: inv, formationId: 'nad-zand-5', depthTopM: 0, depthBaseM: 6, bodyId: 'gb-0' }),
  layer({ id: `g-${inv}-1`, investigationId: inv, formationId: 'nad-zand-7', depthTopM: 6, depthBaseM: 10, bodyId: 'gb-1' }),
  layer({ id: `g-${inv}-2`, investigationId: inv, formationId: 'nad-klei-23', depthTopM: 10, depthBaseM: 15, bodyId: 'gb-2' }),
])
// The ties the engineer drew, INCLUDING the jump tie M..R that bridges the
// undivided borehole — the tie exists, but the ground it crosses is not
// classified anywhere, and the fill must say so.
const GEOTECH_EDGES: LithoContactCorrelationEdge[] = [
  ...(['L', 'M'] as const).flatMap((inv, i) => {
    const next = (['M', 'R'] as const)[i]
    return [
      edge(`g-${inv}-0`, `g-${next}-0`),
      edge(`g-${inv}-1`, `g-${next}-1`),
      edge(`g-${inv}-2`, `g-${next}-2`),
      edge(`g-${inv}-2`, `g-${next}-2`, 'base'),
    ]
  }),
]

const CLAY_COLOR = '#0ea5e9'
const SAND_COLOR = '#fbbf24'
const LITHO_COLOURS = new Map<string, string>([
  ['formation-sand', SAND_COLOR],
  ['formation-clay', CLAY_COLOR],
])

const LITHO_FRAME: GeotechLithoFrame = {
  lithoLayers: LITHO_LAYERS,
  lithoEdges: LITHO_EDGES,
  lithoFormationColorById: LITHO_COLOURS,
  lithoSoilByFormationId: new Map([
    ['formation-sand', 'ZAND'],
    ['formation-clay', 'KLEI'],
  ]),
  geotechSoilByFormationId: new Map([
    ['nad-zand-5', 'ZAND'],
    ['nad-zand-7', 'ZAND'],
    ['nad-klei-23', 'KLEI'],
  ]),
  packingClassByFormationId: new Map([
    ['nad-zand-5', 'ZAND|5'],
    ['nad-zand-7', 'ZAND|7'],
    ['nad-klei-23', 'KLEI|23'],
  ]),
}

const NAD_COLOURS = new Map<string, string>([
  ['nad-zand-5', nadClassColor(5)],
  ['nad-zand-7', nadClassColor(7)],
  ['nad-klei-23', nadClassColor(23)],
])

const geotechProps: Props = {
  lithoLayers: GEOTECH_LAYERS,
  contactEdges: GEOTECH_EDGES,
  lithoFrame: LITHO_FRAME,
  axisMode: 'geotechnical',
  bodies: [],
  placedColumns: COLUMNS.map((inv, i) => column({ investigationId: inv, along: i * 100, elevationM: 10 })),
  formationColorById: NAD_COLOURS,
  showBands: true,
  levelToScreen: (l: number) => 200 - l * 10,
  plotTop: 0,
  plotBottom: 400,
  plotLeft: 0,
  plotRight: 400,
  alongToScreenX: (a: number) => a,
  screenXToAlong: (x: number) => x,
  screenToLevel: (y: number) => (200 - y) / 10,
}

/**
 * The same scene with the CLAY never subdivided — the "correlate me" case.
 * Kept as its own props object so UB2's non-vacuous fallback pin does not
 * depend on a borehole staying un-banded, which is no longer what withholds a
 * class (UB1).
 */
const unsubdividedClayProps: Props = {
  ...geotechProps,
  lithoLayers: GEOTECH_LAYERS.filter((l) => l.formation_id !== 'nad-klei-23'),
  contactEdges: GEOTECH_EDGES.filter(
    (e) => !e.layer_a_id.endsWith('-2') && !e.layer_b_id.endsWith('-2'),
  ),
}

/**
 * Split a path's ``d`` into its sub-polygons (fill groups merge many regions
 * into one element) and return each one's x-extent.
 */
function subPathExtents(d: string): Array<[number, number]> {
  const out: Array<[number, number]> = []
  for (const sub of d.split('M').slice(1)) {
    const xs = [...`M${sub}`.matchAll(/[ML]\s(-?[\d.]+),/g)].map((m) => Number(m[1]))
    if (xs.length > 0) out.push([Math.min(...xs), Math.max(...xs)])
  }
  return out
}

/**
 * True when any sub-polygon of the path COVERS ground inside the gap. Extent
 * overlap, not vertex containment: a wedge spanning a whole gap has no vertex
 * inside it, and spanning is exactly what is being judged.
 */
function touchesGap(d: string, gap: number): boolean {
  const [lo, hi] = GAP_X[gap]
  return subPathExtents(d).some(([a, b]) => b > lo + 0.5 && a < hi - 0.5)
}

function paths(container: HTMLElement, testid: string): string[] {
  return Array.from(container.querySelectorAll(`[data-testid="${testid}"]`)).map(
    (el) => el.getAttribute('d') ?? '',
  )
}

function fillPaths(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-testid^="partition-fill-group-"]')).map(
    (el) => el.getAttribute('d') ?? '',
  )
}

describe('PartitionFillOverlay — geotech axis with an undivided borehole', () => {
  it('UB1 — no packing fill is painted across the un-banded column', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    const fills = fillPaths(container)
    expect(fills.length).toBeGreaterThan(0)
    // "what are those weird polygons between the boreholes?" — nothing the
    // packing model produced may sit in a gap flanking a column it never
    // classified. The jump tie M..R crosses this borehole and STILL does not
    // license a class over it: accepting that interpretation is what pressing
    // "4 · Divide boreholes" means.
    expect(fills.filter((d) => touchesGap(d, 1))).toEqual([])
    expect(fills.filter((d) => touchesGap(d, 2))).toEqual([])
  })

  it('UB2 — the ground flanking the un-banded column reads as "correlate me"', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    // "i don't see the hashed fallback nowhere" — it is exactly here that it
    // belongs, on BOTH sides of the borehole.
    const hatch = paths(container, 'partition-unbanded-hatch')
    expect(hatch.some((d) => touchesGap(d, 1))).toBe(true)
    expect(hatch.some((d) => touchesGap(d, 2))).toBe(true)
    // ... and it is drawn over lithology colour, not over a class. The
    // non-empty pin comes first: ``every()`` on an empty set is vacuously
    // true, so without it a render that emitted NO fallback at all passed
    // (audit P2-8).
    const unbanded = Array.from(
      container.querySelectorAll('[data-testid="partition-litho-fallback"]'),
    )
    expect(unbanded.length).toBeGreaterThan(0)
    const bareFills = new Set(unbanded.map((el) => el.getAttribute('fill') ?? ''))
    expect([...bareFills].every((c) => c === SAND_COLOR || c === CLAY_COLOR)).toBe(true)
  })

  it('UB3 — a gap between two banded columns keeps its packing fill', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    const fills = fillPaths(container)
    expect(fills.some((d) => touchesGap(d, 0))).toBe(true)
    // The classified gap carries NAD colour, never lithology colour.
    const colours = new Set(
      Array.from(container.querySelectorAll('[data-testid^="partition-fill-group-"]'))
        .filter((el) => touchesGap(el.getAttribute('d') ?? '', 0))
        .map((el) => el.getAttribute('fill') ?? ''),
    )
    expect(colours.has(SAND_COLOR)).toBe(false)
    expect(colours.has(CLAY_COLOR)).toBe(false)
  })

  // -------------------------------------------------------------------------
  // The SECOND defect in the same screenshot set: "do however see a gap
  // between two left tests on cs1" — a wedge-shaped void mid-gap, lithology on
  // both sides. Measured on the owner's model (CS1 gap 0): a void 0 m thick at
  // fraction 0.05 growing to 0.66 m at fraction 0.48 and gone by 0.53, centred
  // at +2.4 mTAW. It is not an engine hole: the packing model simply stops at a
  // different depth on each flanking test, and the whole-region fallback
  // heuristic then refused to call that ground bare, because "one packed side
  // is enough to disqualify it" — true when the packing partition reaches
  // across the gap, false when it terminates inside it. The clip answers per
  // FACE, so the terminated remainder is bare ground like any other.
  //
  // It is the SAME defect, not a second one: the clip is what tiles the frame
  // face by face, and the undivided borehole switched the clip off for the
  // WHOLE section — including gaps nowhere near it. Reproduced here in the
  // small: the section still carries the un-banded borehole B, and in gap 0
  // (two banded tests) only the LEFT test has a clay band, stopping half-way
  // down the clay, so the packing partition terminates inside the gap.
  // -------------------------------------------------------------------------
  const terminatingProps: Props = {
    ...geotechProps,
    lithoLayers: [
      layer({ id: 'g-L-0', investigationId: 'L', formationId: 'nad-zand-5', depthTopM: 0, depthBaseM: 10, bodyId: 'gb-0' }),
      layer({ id: 'g-L-2', investigationId: 'L', formationId: 'nad-klei-23', depthTopM: 10, depthBaseM: 12, bodyId: 'gb-2' }),
      layer({ id: 'g-M-0', investigationId: 'M', formationId: 'nad-zand-5', depthTopM: 0, depthBaseM: 10, bodyId: 'gb-0' }),
      layer({ id: 'g-R-0', investigationId: 'R', formationId: 'nad-zand-5', depthTopM: 0, depthBaseM: 10, bodyId: 'gb-0' }),
    ],
    contactEdges: [edge('g-L-0', 'g-M-0'), edge('g-L-0', 'g-M-0', 'base')],
  }

  /**
   * The painted plane a viewer sees: classified fills plus bare fallback.
   * The hatch is texture drawn OVER the fallback, so it stays out of the
   * exactly-one-colour count.
   */
  function paintedPlane(container: HTMLElement) {
    return [
      ...paintedElements(container, '[data-testid^="partition-fill-group-"]'),
      ...paintedElements(container, '[data-testid="partition-litho-fallback"]'),
    ]
  }

  /** Sample window for a gap: its x-range, collar (y=100) to clay base (y=250). */
  function gapWindow(gap: number) {
    const [x0, x1] = GAP_X[gap]
    return { x0, x1, y0: 100, y1: 250 }
  }

  it('UB5 — ground the packing model stops short of inside a gap is still painted', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...terminatingProps} />
      </svg>,
    )
    // The litho clay runs 10-15 m below a 10 mTAW collar, so the frame reaches
    // screen y 250 across the gap. The OLD oracle read one scalar — the deepest
    // vertex — which a mis-placed deep polygon satisfies while the owner's
    // mid-gap wedge void stands (audit P1-5). Point-sampling the whole window
    // fails on the void itself, wherever it sits, and on any overlap too.
    expect(coverageDefects(paintedPlane(container), gapWindow(0))).toEqual([])
  })

  it('UB4 — the litho frame governs the whole plane: fills plus bare ground tile it', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...geotechProps} />
      </svg>,
    )
    // "clearly the litho model isn't the base of the geotech fill" — with the
    // frame as the base, every point of every gap is accounted for: classified
    // where the packing model reaches, bare where it does not, and never both.
    // The OLD oracle asked only whether SOME path touched each gap, which one
    // sliver satisfies (audit P1-5); this samples the plane point by point.
    const plane = paintedPlane(container)
    for (const gap of [0, 1, 2]) {
      expect(coverageDefects(plane, gapWindow(gap)), `gap ${gap}`).toEqual([])
    }
  })

  it('UB6 — a litho unit NO test subdivided reads as "correlate me" as well', () => {
    // The second way ground goes un-classed, pinned separately so UB2 cannot
    // pass merely because a borehole happens to be un-divided: here the CLAY is
    // stripped of its packing bands on EVERY test, so no family classifies it
    // anywhere and its whole cover carries the texture over lithology colour.
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...unsubdividedClayProps} />
      </svg>,
    )
    const hatch = paths(container, 'partition-unbanded-hatch')
    expect(hatch.some((d) => touchesGap(d, 0))).toBe(true)
    const unbanded = Array.from(
      container.querySelectorAll('[data-testid="partition-litho-fallback"]'),
    )
    expect(unbanded.length).toBeGreaterThan(0)
    const bareFills = new Set(unbanded.map((el) => el.getAttribute('fill') ?? ''))
    expect([...bareFills].every((c) => c === SAND_COLOR || c === CLAY_COLOR)).toBe(true)
    // ... and the SAND, which every test IS subdivided for, keeps its class in
    // the gap between two banded columns.
    expect(fillPaths(container).some((d) => touchesGap(d, 0))).toBe(true)
  })
})
