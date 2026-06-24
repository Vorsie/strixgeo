// Behavioral net for the F3 geotechnical axis extension in SectionPanel.
//
// These tests verify the NAD recolour logic and the PartitionFillOverlay
// gating, WITHOUT mounting the full SectionPanel (which is a god-component
// requiring heavy mocking of hooks and DOM APIs).  Instead we:
//
//   a) test the formationColorById / formationLabelById derivation logic
//      directly (the branching logic that was added to SectionPanel's useMemos),
//   b) test PartitionFillOverlay renders + picks up NAD colours when called
//      with the geotech-derived maps,
//   c) test the F-feature geotechClipByInvId path: litho shapes clipped by NAD
//      subdivision depths and coloured by NAD class.
//
// Pinned claims:
//   GN1  nadClassColor(8) returns a valid hex string (not neutral grey, not amber).
//   GN2  nadClassColor(null) returns the neutral grey '#9ca3af' — degenerate state.
//   GN3  nadClassName(8) returns a non-empty string (the NAD class name).
//   GN4  nadClassName(null) returns '' (empty — degenerate; no label renders).
//   GN5  PartitionFillOverlay renders a path element when given a NAD-class
//        formationColorById and geotech-shaped lithoLayers.
//   GN6  The rendered path's fill attribute equals the NAD colour for the
//        formation (nadClassColor(8)), not a lithology colour.
//   GN7  A formation with nad_class === null gets the neutral-grey fill
//        (nadClassColor(null)) — distinct from amber.
//   GN8  Two bodies with the same NAD class label each render their own <text>
//        (fit-based per-body model — dedupeLabelsByText removed 2026-06-24).
//   GN8b A body whose region is too short (< MIN_FONT + margin) renders NO label
//        (zoom-adaptive fit gate).
//   GC1  Without geotechClipByInvId, partition-region-* paths render with litho
//        formation colours (the plain litho axis path is unaffected).
//   GC2  With geotechClipByInvId, a <defs> element containing <clipPath> elements
//        is emitted (one per NAD band per gap).
//   GC3  With geotechClipByInvId, partition-region-* paths carry the NAD colour
//        from the geotech formation — not the litho formation colour.
//   GC4  Two NAD cuts in a single gap produce two <clipPath> definitions (top,
//        middle, bottom → 3 bands, or 2 bands for 1 cut, etc.).
//   GC5  With geotechClipByInvId present, partition-region-* paths still render
//        (geotech clip does not suppress the fill entirely).

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { nadClassColor, nadClassName } from '../utils/nadClasses'
import PartitionFillOverlay from './sections/PartitionFillOverlay'
import type { Props } from './sections/PartitionFillOverlay'
import type { LithoLayerResponse } from '../api/client'
import type { PlacedColumn } from './sections/utils'

afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function geotechLayer(
  id: string,
  inv: string,
  bodyId: string,
  formationId: string,
  top: number,
  base: number,
): LithoLayerResponse {
  return {
    id,
    model_id: 'geotech-model-1',
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

// NAD-class colour map that SectionPanel builds when axisMode='geotechnical'.
// Formation f8 has nad_class=8 (Dicht); formation fNull has nad_class=null.
const nadColorMap = new Map<string, string>([
  ['f8', nadClassColor(8)],
  ['fNull', nadClassColor(null)],
])

const nadLabelMap = new Map<string, string>([
  ['f8', nadClassName(8)],
  ['fNull', nadClassName(null)],
])

const baseProps: Props = {
  lithoLayers: [
    geotechLayer('a1', 'L', 'body8', 'f8', 0, 5),
    geotechLayer('b1', 'R', 'body8', 'f8', 0, 6),
  ],
  placedColumns: [column('L', 0, 10), column('R', 100, 10)],
  formationColorById: nadColorMap,
  formationLabelById: nadLabelMap,
  showBands: true,
  levelToScreen: (l: number) => 100 - l * 10,
  plotTop: 0,
  plotBottom: 400,
  plotLeft: 0,
  plotRight: 200,
}

// ---------------------------------------------------------------------------
// GN1-GN4  NAD palette unit-level checks (no rendering needed)
// ---------------------------------------------------------------------------

describe('NAD colour / label helpers (formationColorById derivation)', () => {
  it('GN1 — nadClassColor(8) is a valid hex string, not neutral grey, not amber', () => {
    const colour = nadClassColor(8)
    expect(colour).toMatch(/^#[0-9a-f]{6}$/i)
    expect(colour).not.toBe('#9ca3af') // neutral grey (no-qc)
    expect(colour).not.toBe('#d97706') // amber-600 (must never be used)
  })

  it('GN2 — nadClassColor(null) returns neutral grey — degenerate-band state', () => {
    expect(nadClassColor(null)).toBe('#9ca3af')
  })

  it('GN3 — nadClassName(8) returns a non-empty name string', () => {
    const name = nadClassName(8)
    expect(typeof name).toBe('string')
    expect(name.length).toBeGreaterThan(0)
    expect(name).not.toBe('')
  })

  it('GN4 — nadClassName(null) returns empty string (degenerate — no label renders)', () => {
    expect(nadClassName(null)).toBe('')
  })
})

// ---------------------------------------------------------------------------
// GN5-GN7  PartitionFillOverlay renders with NAD colours
// ---------------------------------------------------------------------------

describe('PartitionFillOverlay with geotechnical axis colours', () => {
  it('GN5 — renders at least one path element when given NAD colour maps', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...baseProps} />
      </svg>,
    )
    const paths = container.querySelectorAll('[data-testid^="partition-region-"]')
    expect(paths.length).toBeGreaterThan(0)
  })

  it('GN6 — rendered region fill equals nadClassColor(8) for a class-8 formation', () => {
    const expected = nadClassColor(8)
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...baseProps} />
      </svg>,
    )
    const paths = Array.from(
      container.querySelectorAll<SVGPathElement>('[data-testid="partition-region-body8"]'),
    )
    expect(paths.length).toBeGreaterThan(0)
    // Every body8 path must be filled with the NAD class-8 colour.
    for (const path of paths) {
      expect(path.getAttribute('fill')).toBe(expected)
    }
  })

  it('GN7 — a no-qc formation (nad_class null) renders in neutral grey, not amber', () => {
    const neutralGrey = nadClassColor(null) // '#9ca3af'
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...baseProps}
          lithoLayers={[
            geotechLayer('c1', 'L', 'bodyNull', 'fNull', 0, 5),
            geotechLayer('d1', 'R', 'bodyNull', 'fNull', 0, 6),
          ]}
        />
      </svg>,
    )
    const paths = Array.from(
      container.querySelectorAll<SVGPathElement>('[data-testid="partition-region-bodyNull"]'),
    )
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      const fill = path.getAttribute('fill') ?? ''
      expect(fill).toBe(neutralGrey)
      expect(fill).not.toBe('#d97706') // amber — must never appear on geotech no-qc
    }
  })

  it('GN8 — two bodies with the same NAD class label each render their own <text> (fit-based, one per body)', () => {
    // The old dedupeLabelsByText cross-body collapse is removed (owner directive
    // 2026-06-24: zoom in → see ALL bands' labels). The per-body rule still
    // applies: each bodyId gets at most one <text> element.
    //
    // Wide columns (0 and 400) give a 380 px gap — enough for the long NAD label
    // "ZAND, zeer dicht gp" (20 chars × 8 px × 0.55 ≈ 88 px < 380 px).
    // Heights: bodyA = 3 m × 10 = 30 px, bodyB = 5 m × 10 = 50 px — both
    // pass the vertical fit gate (h >= MIN_FONT + margin = 10 px).
    const wideColumns = [column('L', 0, 10), column('R', 400, 10)]
    const sameTextLayers = [
      // bodyA: shallower (0–3 m) on both columns
      geotechLayer('e1', 'L', 'bodyA', 'f8', 0, 3),
      geotechLayer('f1', 'R', 'bodyA', 'f8', 0, 3),
      // bodyB: deeper (3–8 m) on both columns
      geotechLayer('g1', 'L', 'bodyB', 'f8', 3, 8),
      geotechLayer('h1', 'R', 'bodyB', 'f8', 3, 8),
    ]
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...baseProps}
          placedColumns={wideColumns}
          plotRight={500}
          lithoLayers={sameTextLayers}
        />
      </svg>,
    )
    // Two distinct bodies → two <text> elements (fit-based, no text-dedup).
    const labelTexts = Array.from(container.querySelectorAll('text')).filter(
      (t) => t.textContent === nadClassName(8),
    )
    expect(labelTexts.length).toBe(2)
  })

  it('GN8b — a body whose region is too short (< MIN_FONT + margin) renders NO label', () => {
    // Fit gate: a very thin body (0.1 m = 1 px tall with levelToScreen 10px/m)
    // cannot fit its label at any reasonable font size → no <text> element.
    const thinLayers = [
      // thinBody: only 0.1 m tall on both columns → 1 px screen height
      geotechLayer('i1', 'L', 'thinBody', 'f8', 0, 0.1),
      geotechLayer('j1', 'R', 'thinBody', 'f8', 0, 0.1),
    ]
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...baseProps} lithoLayers={thinLayers} />
      </svg>,
    )
    const labelTexts = Array.from(container.querySelectorAll('text')).filter(
      (t) => t.textContent === nadClassName(8),
    )
    expect(labelTexts.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// GC1-GC5  geotechClipByInvId — litho shapes clipped + coloured by NAD class
// ---------------------------------------------------------------------------
//
// Fixture setup:
//   - Two columns L (x=0, elev=10) and R (x=100, elev=10).
//   - One litho body 'bodyLitho' spanning both columns, formation 'lithoF' (0–8 m).
//   - lithoF colour = '#aabbcc' (a distinguishable litho colour, NOT an NAD colour).
//   - Two geotech NAD formations: nadFTop (nad_class=8, 0–3 m) + nadFBot (nad_class=3, 3–8 m).
//   - geotechClipByInvId: both L and R get two cuts at depthM 0 and 3 (the
//     boundary between the two NAD units).
//   - formationColorById maps nadFTop → nadClassColor(8) and nadFBot → nadClassColor(3).
//     It does NOT map 'lithoF' → anything (so the litho formation colour never appears).

describe('PartitionFillOverlay with geotechClipByInvId (F-feature: litho shape clipped by NAD packing)', () => {
  // Litho layer spanning both columns, one body, litho formation 'lithoF'.
  const lithoLayers = [
    geotechLayer('k1', 'L', 'bodyLitho', 'lithoF', 0, 8),
    geotechLayer('k2', 'R', 'bodyLitho', 'lithoF', 0, 8),
  ]

  const cols = [column('L', 0, 10), column('R', 100, 10)]

  // Geotech formations: nadFTop (class 8) and nadFBot (class 3).
  const nadColorFTop = nadClassColor(8)
  const nadColorFBot = nadClassColor(3)
  const lithoColor = '#aabbcc'

  // formationColorById: only geotech formation ids (NOT lithoF).
  const geoFormationColors = new Map<string, string>([
    ['nadFTop', nadColorFTop],
    ['nadFBot', nadColorFBot],
  ])

  // Two cuts per column: first cut at depth 0 m (top of NAD unit nadFTop),
  // second cut at depth 3 m (boundary between nadFTop and nadFBot).
  // Slice 0 (above cut 0 = plotTop → cut 0 screen y) → no formation id → skipped
  // if the first cut is at depth 0 (surface), because topCutY = levelToScreen(10-0) = 0
  // and plotTop = 0, so the "above-first-cut" band has zero height → degenerate → skipped.
  // Actually cut 0 at depth 0 → elevationM = 10 - 0 = 10 → screenY = 100 - 10*10 = 0 → same as plotTop.
  // So slice ci=0 (plotTop → cut[0].y) has topLeftY = plotTop = 0, botLeftY = 0 → degenerate → skipped.
  // Slice ci=1 (cut[0].y=0 → cut[1].y=70): formationId = cut[0].formationId = 'nadFTop'.
  // Slice ci=2 (cut[1].y=70 → plotBottom=400): formationId = cut[1].formationId = 'nadFBot'.
  // So we expect exactly 2 active clip bands.
  const geotechClipByInvId = new Map<string, Array<{ depthM: number; formationId: string }>>(
    [
      ['L', [{ depthM: 0, formationId: 'nadFTop' }, { depthM: 3, formationId: 'nadFBot' }]],
      ['R', [{ depthM: 0, formationId: 'nadFTop' }, { depthM: 3, formationId: 'nadFBot' }]],
    ],
  )

  const clipProps: Props = {
    lithoLayers,
    placedColumns: cols,
    formationColorById: geoFormationColors,
    showBands: true,
    levelToScreen: (l: number) => 100 - l * 10,
    plotTop: 0,
    plotBottom: 400,
    plotLeft: 0,
    plotRight: 200,
    geotechClipByInvId,
  }

  it('GC1 — without geotechClipByInvId, partition-region-* paths render with the litho formation colour', () => {
    // Plain litho axis: formationColorById maps 'lithoF' → lithoColor.
    const lithoAxisColors = new Map([['lithoF', lithoColor]])
    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...clipProps}
          formationColorById={lithoAxisColors}
          geotechClipByInvId={undefined}
        />
      </svg>,
    )
    // Regions render (not clipped).
    const paths = container.querySelectorAll<SVGPathElement>('[data-testid^="partition-region-"]')
    expect(paths.length).toBeGreaterThan(0)
    // All filled with the litho colour.
    for (const path of paths) {
      expect(path.getAttribute('fill')).toBe(lithoColor)
    }
    // No <defs> with clipPath (litho axis never uses clip bands).
    const clipPaths = container.querySelectorAll('clipPath')
    expect(clipPaths.length).toBe(0)
  })

  it('GC2 — with geotechClipByInvId, a <defs> element with <clipPath> elements is emitted', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...clipProps} />
      </svg>,
    )
    // At least one clipPath defined for the NAD bands.
    const clipPaths = container.querySelectorAll('clipPath')
    expect(clipPaths.length).toBeGreaterThan(0)
  })

  it('GC3 — with geotechClipByInvId, partition-region-* fill is a NAD colour, not the litho colour', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...clipProps} />
      </svg>,
    )
    const paths = Array.from(
      container.querySelectorAll<SVGPathElement>('[data-testid^="partition-region-"]'),
    )
    expect(paths.length).toBeGreaterThan(0)
    for (const path of paths) {
      const fill = path.getAttribute('fill') ?? ''
      // Must be one of the NAD colours, never the litho colour.
      expect([nadColorFTop, nadColorFBot]).toContain(fill)
      expect(fill).not.toBe(lithoColor)
    }
  })

  it('GC4 — one NAD cut at depth 3 m produces two clip bands (top slice + bottom slice)', () => {
    // A single cut at depth 3 m (formationId: 'nadFTop') → two slices:
    //   slice 0 (ci=0): plotTop → cut[0].y, formationId = first cut's id (nadFTop)
    //   slice 1 (ci=1): cut[0].y → plotBottom, formationId = cut[0].formationId (nadFTop again
    //                    since ci=1 → leftCutYs[ci-1].formationId = 'nadFTop')
    // Wait — that gives both slices the same formationId. Let's use a cut at 0
    // + a cut at 3 as in clipProps above (from GC setup), which gives 3 slices
    // total but slice ci=0 is degenerate (zero height → skipped).
    // Active: ci=1 (nadFTop) + ci=2 (nadFBot) = 2 bands.
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...clipProps} />
      </svg>,
    )
    const clipPaths = container.querySelectorAll('clipPath')
    // 2 active slices → 2 clipPath elements.
    expect(clipPaths.length).toBe(2)
  })

  it('GC5 — with geotechClipByInvId present, partition-region-* paths still render', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...clipProps} />
      </svg>,
    )
    const paths = container.querySelectorAll('[data-testid^="partition-region-"]')
    expect(paths.length).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// GC6-GC9  Per-region cut scoping (regression: the old per-gap global-index
// pairing shredded body envelopes by connecting cuts from different litho bodies)
// ---------------------------------------------------------------------------
//
// Fixture: two litho bodies in a single gap — sand (0–5 m) above clay (5–10 m).
// Each body has its OWN NAD cuts at different depths:
//   sand: cut at depth 0 m (nadSand1) + cut at depth 2 m (nadSand2)
//   clay: cut at depth 5 m (nadClay1) + cut at depth 7 m (nadClay2)
//
// The regression would connect sandCut[i] with clayCut[i] across the two bodies,
// creating cross-body parallelograms.  The fix scopes each cut list to the region's
// own vertical extent so sand cuts never appear inside the clay region and vice versa.
//
// levelToScreen: (l) => 100 - l * 10  (10 m → 100 px tall)
// surface elev = 10, so:
//   depth 0 → y = 0   (sand top / surface)
//   depth 2 → y = 20  (sand NAD boundary, strictly inside sand region [0, 50])
//   depth 5 → y = 50  (sand/clay boundary)
//   depth 7 → y = 70  (clay NAD boundary, strictly inside clay region [50, 100])
//   depth 10 → y = 100 (clay base)
//
//   GC6  Sand region paths are ONLY coloured with sand NAD colours (nadSand1 /
//        nadSand2) — no clay colour.
//   GC7  Clay region paths are ONLY coloured with clay NAD colours (nadClay1 /
//        nadClay2) — no sand colour.
//   GC8  Total clipPaths = 4 (2 sand bands × 1 sand region + 2 clay bands ×
//        1 clay region) — pins the per-region band count.
//   GC9  A body whose geotech cuts fall entirely ABOVE or BELOW it (no cuts
//        strictly inside) renders as exactly ONE slice (the entire region = one
//        NAD band), coloured by the covering formation.
describe('GC6-GC9 — per-region cut scoping (regression: global-index cross-body pairing)', () => {
  const levelToScreen = (l: number) => 100 - l * 10

  // Two bodies in the same gap: sand (0–5 m) and clay (5–10 m).
  const twoBodyLayers = [
    geotechLayer('s1', 'L', 'bSand', 'fSandLitho', 0, 5),
    geotechLayer('s2', 'R', 'bSand', 'fSandLitho', 0, 5),
    geotechLayer('c1', 'L', 'bClay', 'fClayLitho', 5, 10),
    geotechLayer('c2', 'R', 'bClay', 'fClayLitho', 5, 10),
  ]

  const cols = [column('L', 0, 10), column('R', 100, 10)]

  // NAD colours: two for sand, two for clay.
  const nadSand1Color = '#ffcc00'
  const nadSand2Color = '#ff9900'
  const nadClay1Color = '#0077cc'
  const nadClay2Color = '#004499'

  const nadColors = new Map([
    ['nadSand1', nadSand1Color],
    ['nadSand2', nadSand2Color],
    ['nadClay1', nadClay1Color],
    ['nadClay2', nadClay2Color],
  ])

  // geotechClipByInvId: both L and R columns have 4 cuts — 2 for the sand body
  // and 2 for the clay body.  Depth 0 marks the start of nadSand1, depth 2 the
  // start of nadSand2 (sand NAD boundary), depth 5 the start of nadClay1,
  // depth 7 the start of nadClay2 (clay NAD boundary).
  const geotechClip = new Map<string, Array<{ depthM: number; formationId: string }>>([
    [
      'L',
      [
        { depthM: 0, formationId: 'nadSand1' },
        { depthM: 2, formationId: 'nadSand2' },
        { depthM: 5, formationId: 'nadClay1' },
        { depthM: 7, formationId: 'nadClay2' },
      ],
    ],
    [
      'R',
      [
        { depthM: 0, formationId: 'nadSand1' },
        { depthM: 2, formationId: 'nadSand2' },
        { depthM: 5, formationId: 'nadClay1' },
        { depthM: 7, formationId: 'nadClay2' },
      ],
    ],
  ])

  const twoBodyProps: Props = {
    lithoLayers: twoBodyLayers,
    placedColumns: cols,
    formationColorById: nadColors,
    showBands: true,
    levelToScreen,
    plotTop: 0,
    plotBottom: 200,
    plotLeft: 0,
    plotRight: 200,
    geotechClipByInvId: geotechClip,
  }

  it('GC6 — sand region paths are coloured only with sand NAD colours, never clay colours', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...twoBodyProps} />
      </svg>,
    )
    const sandPaths = Array.from(
      container.querySelectorAll<SVGPathElement>('[data-testid="partition-region-bSand"]'),
    )
    expect(sandPaths.length).toBeGreaterThan(0)
    for (const path of sandPaths) {
      const fill = path.getAttribute('fill') ?? ''
      expect([nadSand1Color, nadSand2Color]).toContain(fill)
      // Regression: old global-index pairing would put clay colours on sand regions.
      expect(fill).not.toBe(nadClay1Color)
      expect(fill).not.toBe(nadClay2Color)
    }
  })

  it('GC7 — clay region paths are coloured only with clay NAD colours, never sand colours', () => {
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...twoBodyProps} />
      </svg>,
    )
    const clayPaths = Array.from(
      container.querySelectorAll<SVGPathElement>('[data-testid="partition-region-bClay"]'),
    )
    expect(clayPaths.length).toBeGreaterThan(0)
    for (const path of clayPaths) {
      const fill = path.getAttribute('fill') ?? ''
      expect([nadClay1Color, nadClay2Color]).toContain(fill)
      // Regression: old global-index pairing would put sand colours on clay regions.
      expect(fill).not.toBe(nadSand1Color)
      expect(fill).not.toBe(nadSand2Color)
    }
  })

  it('GC8 — two bodies with 2 NAD bands each produce 4 clipPaths total', () => {
    // 2 sand bands (cut at depth 2 is inside sand region [0,50]) × 1 sand region
    // + 2 clay bands (cut at depth 7 is inside clay region [50,100]) × 1 clay region
    // = 4 clipPath elements.
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...twoBodyProps} />
      </svg>,
    )
    const clipPaths = container.querySelectorAll('clipPath')
    expect(clipPaths.length).toBe(4)
  })

  it('GC9 — a body with no NAD cuts strictly inside it renders as exactly one slice', () => {
    // A new fixture with a THIRD body (peat, 10–12 m) whose only relevant geotech
    // cuts (at depths 0, 2, 5, 7) all fall ABOVE the peat body's top (y=100).
    // The peat region has no scoped cuts → one band coloured by the covering
    // formation (the last cut at or above depth 10 → depthM=7 → nadClay2).
    const withPeatLayers = [
      ...twoBodyLayers,
      geotechLayer('p1', 'L', 'bPeat', 'fPeatLitho', 10, 12),
      geotechLayer('p2', 'R', 'bPeat', 'fPeatLitho', 10, 12),
    ]
    const nadPeatColor = '#663300'
    const geotechClipWithPeat = new Map<string, Array<{ depthM: number; formationId: string }>>([
      [
        'L',
        [
          { depthM: 0, formationId: 'nadSand1' },
          { depthM: 2, formationId: 'nadSand2' },
          { depthM: 5, formationId: 'nadClay1' },
          { depthM: 7, formationId: 'nadClay2' },
          // nadPeat starts at depth 10 (peat top) — the cut exactly at the
          // peat region's minY is filtered out (not strictly inside); the peat
          // region is covered by the nadClay2 band (the last cut above it) ...
          // unless we add a cut at depth 10 for the peat.
          { depthM: 10, formationId: 'nadPeat' },
        ],
      ],
      [
        'R',
        [
          { depthM: 0, formationId: 'nadSand1' },
          { depthM: 2, formationId: 'nadSand2' },
          { depthM: 5, formationId: 'nadClay1' },
          { depthM: 7, formationId: 'nadClay2' },
          { depthM: 10, formationId: 'nadPeat' },
        ],
      ],
    ])

    const nadColorsWithPeat = new Map([
      ...nadColors,
      ['nadPeat', nadPeatColor],
    ])

    const { container } = render(
      <svg>
        <PartitionFillOverlay
          {...twoBodyProps}
          lithoLayers={withPeatLayers}
          plotBottom={400}
          formationColorById={nadColorsWithPeat}
          geotechClipByInvId={geotechClipWithPeat}
        />
      </svg>,
    )

    // The peat region: minY = levelToScreen(10-10)=100, maxY = levelToScreen(10-12)=120.
    // Cuts: depth 10 → y = levelToScreen(10-10) = 100 (equals minY, NOT strictly inside).
    // Scoped cuts = [] → nCuts=0 → ONE slice.
    // Covering formation: last cut with y ≤ 100 → depth=10 cut → nadPeat.
    const peatPaths = Array.from(
      container.querySelectorAll<SVGPathElement>('[data-testid="partition-region-bPeat"]'),
    )
    // Exactly one slice → one partition-region-bPeat path rendered.
    expect(peatPaths.length).toBe(1)
    expect(peatPaths[0].getAttribute('fill')).toBe(nadPeatColor)
  })
})
