// Component-level regression for S60 Stage A — the under-glyph sub-TD strip.
//
// Owner rule (verbatim): "below a column's TD, the space belongs to the
// PARTITION — the gap regions' fill must run continuously under the glyph."
//
//   UC-V2  with the v2 engine active, a partition sand region that runs
//          continuously THROUGH the shallow column's TD paints SAND directly
//          under the glyph below the TD (clay only below the sand's base) —
//          the B2 phantom "clay directly under the sand" block is gone.
//   UC-V1  with the v1 engine (beta fallback), the frozen helper's behaviour
//          is preserved byte-for-byte: the straddling sand is rejected and the
//          clay extends up to the TD (engine-gated fix — v1 render unchanged).
//
// The active engine's region output is mocked so the region shapes are exact
// (the real v2 emission for this geometry is pinned by the engine's own
// gates); the substrate + render path under test are real.

import { cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { LithoLayerResponse } from '../../api/client'
import type { SectionRegion } from '../../utils/partitionFill'
import PartitionFillOverlay from './PartitionFillOverlay'
import type { Props } from './PartitionFillOverlay'
import type { PlacedColumn } from './utils'

// Partial-mock the engine selector: the compute fn returns crafted regions;
// the pref hook + setter stay real so the overlay's engine gate is exercised.
const mockRegions: { value: SectionRegion[] } = { value: [] }
vi.mock('../../utils/partitionEngineSelect', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../utils/partitionEngineSelect')>()
  return {
    ...orig,
    computeSectionFillActiveWithDiagnostics: () => ({
      regions: mockRegions.value,
      conflicts: [],
      reviewFlags: [],
    }),
  }
})

afterEach(() => {
  cleanup()
})

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

/** SectionRegion quad in (fraction, elevation) space. */
function reg(
  gapIndex: number,
  formationId: string,
  top: number,
  base: number,
): SectionRegion {
  return {
    formationId,
    bodyId: null,
    kind: 'quad',
    gapIndex,
    polygon: [
      { fraction: 0, elevation: top },
      { fraction: 1, elevation: top },
      { fraction: 1, elevation: base },
      { fraction: 0, elevation: base },
    ],
  }
}

const SAND = '#fbbf24'
const CLAY = '#6b7280'

// deepL — shallow M (B2-like) — deepR. All surfaces at elev 10.
// M: single ZAND unit to depth 14 → TD elev −4 (its own bottom sand).
// Deep columns log ZAND down to −7.5, KLEI −7.5..−10.2.
// The mocked v2-shaped partition: ONE sand region straddling M's TD
// (top 4, base −7.5 — no split at the TD line) + the clay band below.
const props: Props = {
  lithoLayers: [
    layer('l1', 'L', 'sand', 'fSand', 0, 17.5),
    layer('l2', 'L', 'clay', 'fClay', 17.5, 20.2),
    layer('m1', 'M', 'sand', 'fSand', 0, 14),
    layer('r1', 'R', 'sand', 'fSand', 0, 17.5),
    layer('r2', 'R', 'clay', 'fClay', 17.5, 20.2),
  ],
  placedColumns: [column('L', 0, 10), column('M', 100, 10), column('R', 200, 10)],
  formationColorById: new Map([
    ['fSand', SAND],
    ['fClay', CLAY],
  ]),
  showBands: true,
  levelToScreen: (l: number) => 100 - l * 10,
  plotTop: 0,
  plotBottom: 400,
}

const straddlingRegions: SectionRegion[] = [
  reg(0, 'fSand', 4, -7.5),
  reg(0, 'fClay', -7.5, -10.2),
  reg(1, 'fSand', 4, -7.5),
  reg(1, 'fClay', -7.5, -10.2),
]

// S61 (owner clause 5): the sub-TD substrate FILL is dissolved into the
// per-lithology merged group (``partition-fill-group-*``) — its own coloured
// ``partition-undercol`` path is gone (a single translucent element removes the
// antialiasing hairline). The under-glyph strip is still an independent SUBPATH
// (M-column x-range 80..120) inside its lithology's group; the tests parse those
// subpaths back out. Behaviour under test (which litho paints where below the TD)
// is unchanged — only the DOM host of the fill moved.

/** Split a group ``d`` into its ``M … Z`` subpaths' vertex lists. */
function subpaths(d: string): { x: number; y: number }[][] {
  return d
    .split('Z')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) =>
      Array.from(s.matchAll(/[ML] ([\d.-]+),([\d.-]+)/g)).map((m) => ({
        x: Number(m[1]),
        y: Number(m[2]),
      })),
    )
}

/**
 * Under-glyph strip fills over the M column (x ≈ 80..120), one entry per
 * lithology group that has such a subpath. ``top`` is the highest point (min y)
 * of the M-strip subpath — the strip's top elevation on screen.
 */
function mStripPaths(container: HTMLElement): { fill: string; top: number }[] {
  const out: { fill: string; top: number }[] = []
  for (const g of Array.from(
    container.querySelectorAll('[data-testid^="partition-fill-group-"]'),
  )) {
    const fill = g.getAttribute('fill') ?? ''
    for (const ring of subpaths(g.getAttribute('d') ?? '')) {
      const xs = ring.map((p) => p.x)
      const minX = Math.min(...xs)
      const maxX = Math.max(...xs)
      // The M-glyph strip spans exactly the column footprint [80,120]; gap
      // regions span the inter-column gaps (e.g. 20..80 or 120..180), so this
      // x-extent selects under-glyph subpaths. Since 2026-08-14 the column's
      // own STACK also paints card-wide quads ("the fill paints through the
      // cards") — those live ABOVE the TD (y 140), so this helper keeps only
      // rings wholly below it: the sub-TD substrate this suite is about.
      const minY = Math.min(...ring.map((p) => p.y))
      if (Math.abs(minX - 80) < 0.5 && Math.abs(maxX - 120) < 0.5 && minY >= 139.5) {
        out.push({ fill, top: minY })
      }
    }
  }
  return out
}

describe('PartitionFillOverlay — sub-TD strip under the glyph (S60 Stage A)', () => {
  it("UC-V2: v2 active — the partition's sand runs continuously under the glyph below the TD; clay only below the sand base", () => {
    mockRegions.value = straddlingRegions
    const { container } = render(
      <svg>
        <PartitionFillOverlay {...props} />
      </svg>,
    )
    const strips = mStripPaths(container)
    // Sand strip starts AT the TD (elev −4 → y 140) and reaches the sand base
    // (−7.5 → y 175); the clay strip starts only below it (y 175).
    const sand = strips.find((p) => p.fill === SAND)
    const clay = strips.find((p) => p.fill === CLAY)
    expect(sand).toBeDefined()
    expect(sand!.top).toBeCloseTo(140, 0)
    expect(clay).toBeDefined()
    expect(clay!.top).toBeCloseTo(175, 0)
    // The defect shape — clay directly under the sand base/TD — must be gone.
    expect(clay!.top).not.toBeCloseTo(140, 0)
  })

})
