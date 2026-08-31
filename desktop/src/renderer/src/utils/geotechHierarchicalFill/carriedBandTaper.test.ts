/**
 * ONE SMOOTH TAPER — a carried band never steps at the blind column it crosses.
 *
 * Owner ruling, 2026-08-25, shown a band carried past a column that is blind at
 * its levels — flat at full thickness through the first gap, then starting the
 * next gap already 36 % pinched:
 *
 *   *"option 1, one smooth taper ofcourse, but look at alongM (because a test
 *    is a 1 cm point but on the section it has a width)"*
 *
 * Approved visual: ``blend_viewer/carried_band_choice.html``, panel OPTION 1 —
 * ONE straight taper from the band's own home test to THE SAME apex as today
 * (*"pinches at the same place as today"*), the blind column passed through
 * mid-taper.
 *
 * The alongM caveat is about WHERE the taper starts. A test is a point in
 * reality but occupies a strip of width on the section, and the band must leave
 * its home test at full thickness at the strip's DRAWN EDGE, not at the strip's
 * centre. The renderer already does exactly that: ``PartitionFillOverlay``
 * builds each gap's fraction space as
 * ``leftX = columns[i].rightX`` / ``rightX = columns[i+1].leftX`` — the LEFT
 * column's strip RIGHT edge to the RIGHT column's strip LEFT edge, both
 * ``nudgedX ± width / 2`` in post-spacing screen coordinates
 * (``assemblePlacedPartitionColumns.ts``). So fraction 0 of a gap IS the home
 * column's drawn edge, and a taper anchored at the band's own ``x`` (which maps
 * to fraction 0 in its own gap) leaves the strip edge at full thickness by
 * construction. Nothing is inset here on top of that.
 *
 * SCOPE. Only a CONTINUATION-carried band — one whose facing column is blind at
 * its own levels while a column further out does read them, so its pinch is
 * measured against that further column (``bandContinuation.ts`` /
 * ``terminationRun.ts``). A band that runs flat because it is genuinely tied
 * through, and a band at the run's own edge with nothing beyond it to read,
 * both stay flat — the two controls below.
 *
 * @module utils/geotechHierarchicalFill/carriedBandTaper
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from './index'
import { computeSectionFillActive } from '../partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'

interface UnitSpec {
  layerId: string
  formationId: string
  top: number
  base: number
}

function column(id: string, surface: number, units: readonly UnitSpec[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      topDepthM: u.top,
      baseDepthM: u.base,
      bodyId: null,
    })),
  }
}

const tie = (a: string, b: string, side: 'top' | 'base' = 'top'): CorrelationEdge => ({
  a,
  b,
  aSide: side,
  bSide: side,
})

/**
 * The drawn vertical extent of one class at one along-fraction of one gap — a
 * scanline through every region of that class, exactly as the eye reads the
 * band's thickness there.
 *
 * @returns ``null`` when the class paints nothing on that vertical.
 */
function drawnSpan(
  regions: readonly SectionRegion[],
  gap: number,
  fraction: number,
  formationId: string,
): { top: number; base: number } | null {
  let lo = Infinity
  let hi = -Infinity
  for (const region of regions) {
    if (region.gapIndex !== gap || region.formationId !== formationId) continue
    const ring = region.polygon
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i]
      const b = ring[(i + 1) % ring.length]
      if (a.fraction === b.fraction) continue
      const t = (fraction - a.fraction) / (b.fraction - a.fraction)
      if (t < 0 || t > 1) continue
      const elevation = a.elevation + t * (b.elevation - a.elevation)
      if (elevation < lo) lo = elevation
      if (elevation > hi) hi = elevation
    }
  }
  return lo <= hi ? { top: hi, base: lo } : null
}

/** That extent's thickness, or 0 where the class paints nothing. */
function drawnThickness(
  regions: readonly SectionRegion[],
  gap: number,
  fraction: number,
  formationId: string,
): number {
  const span = drawnSpan(regions, gap, fraction, formationId)
  return span === null ? 0 : span.top - span.base
}

const SAND = 'f-sand'
const TARGET = 'g-target'
const COVER_CLASS = 'g-other'
const DEEP_CLASS = 'g-deep'
const FAR_CLASS = 'g-far'

/** One litho unit, whole column, correlated straight through — the frame. */
const lithoFrame = (
  ids: readonly string[],
): { columns: PartitionColumn[]; edges: CorrelationEdge[] } => ({
  columns: ids.map((id) =>
    column(id, 20, [{ layerId: `L-${id}`, formationId: SAND, top: 0, base: 20 }]),
  ),
  edges: ids.slice(1).map((id, i) => tie(`L-${ids[i]}`, `L-${id}`)),
})

/**
 * A, B, C left to right. A carries the 0-tie TARGET band at elevation 8..12.
 * B is blind there — its own log stops at elevation 12 — while C reads the whole
 * window, so C, not B, is what the band's pinch measures against.
 *
 * The spacing is deliberately uneven, and that is the point: A→B is 20 m and
 * B→C is 80 m, so the apex (0.45 of the 100 m A→C span, x = 45) lands inside
 * the FAR gap while the blind column B sits at x = 20, well short of it. A band
 * drawn gap-by-gap therefore has to say something about B's own gap that is
 * neither "full thickness" nor "pinched out". Uniform spacing hides the defect
 * completely, which is why the memory rule "partitionfill offline tooling MUST
 * pass real alongM spacing" is load-bearing on this shape.
 *
 * The band ABOVE the target is tied across to B, so it is an open mass that
 * answers the remainder ground on its own. Without it every mass in the gap is
 * closed, the remainder falls back to the target band, and the merge welds the
 * ground above the taper straight back onto it — which measures as a
 * full-thickness band whatever the construct actually drew.
 */
function carriedScene(): { regions: SectionRegion[] } {
  const litho = lithoFrame(['A', 'B', 'C'])
  const geotech: PartitionColumn[] = [
    column('A', 20, [
      { layerId: 'G-A-up', formationId: COVER_CLASS, top: 0, base: 8 },
      { layerId: 'G-A', formationId: TARGET, top: 8, base: 12 },
      { layerId: 'G-A-dn', formationId: DEEP_CLASS, top: 12, base: 20 },
    ]),
    column('B', 20, [{ layerId: 'G-B-up', formationId: COVER_CLASS, top: 0, base: 8 }]),
    column('C', 20, [{ layerId: 'G-C', formationId: FAR_CLASS, top: 0, base: 20 }]),
  ]
  const alongM = [0, 20, 100]
  const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, alongM)
  const out = computeHierarchicalGeotechFill({
    lithoColumns: litho.columns,
    lithoEdges: litho.edges,
    lithoRegions,
    geotechColumns: geotech,
    geotechEdges: [tie('G-A-up', 'G-B-up')],
    alongM,
  })
  return { regions: out.regions }
}

/** Where the band is drawn, in along-metres, for a fraction of either gap. */
const xOfGap0 = (f: number): number => 0 + f * 20
const xOfGap1 = (f: number): number => 20 + f * 80

/**
 * The one straight taper the ruling asks for: full thickness (4 m) at the home
 * test, closing to nothing at the apex the half-length law already puts at
 * x = 45. Written in the ruling's own terms — a straight line from the home
 * test to the same apex as today — not in the engine's.
 */
const RULED_APEX_X = 45
const RULED_HOME_THICKNESS = 4
const ruledThickness = (x: number): number =>
  Math.max(0, RULED_HOME_THICKNESS * (1 - x / RULED_APEX_X))

describe('a carried band draws ONE straight taper from its home test to its apex', () => {
  it('CT1: the FIRST gap tapers — it does not run flat to the blind column', () => {
    // *"one smooth taper ofcourse"*. Today this gap is drawn flat at full
    // thickness all the way to B, and every sample below reads 4 m.
    const { regions } = carriedScene()
    for (const f of [0.25, 0.5, 0.75, 0.95]) {
      expect(
        drawnThickness(regions, 0, f, TARGET),
        `the band's own gap must already be closing at f=${f}`,
      ).toBeCloseTo(ruledThickness(xOfGap0(f)), 2)
    }
  })

  it('CT2: the band passes THROUGH the blind column mid-taper — no step in top or base', () => {
    // *"the blind column passed through mid-taper"*. The two samples straddle
    // B's own strip: the last vertical of its own gap and the first of the
    // next. A test is a point but occupies a width on the section, so the two
    // sit on either side of B's drawn strip and the band must leave one edge at
    // the thickness it enters the other with.
    const { regions } = carriedScene()
    const leaving = drawnSpan(regions, 0, 0.9995, TARGET)
    const arriving = drawnSpan(regions, 1, 0.0005, TARGET)
    expect(leaving, 'the band paints nothing beside the blind column').not.toBeNull()
    expect(arriving, 'the band paints nothing past the blind column').not.toBeNull()
    const before = leaving as { top: number; base: number }
    const after = arriving as { top: number; base: number }
    expect(after.top - before.top, 'the TOP steps at the blind column').toBeCloseTo(0, 2)
    expect(after.base - before.base, 'the BASE steps at the blind column').toBeCloseTo(0, 2)
  })

  it('CT3: the apex is exactly where it is today — the taper is re-anchored, never re-scaled', () => {
    // *"pinches at the same place as today"*. The half-length law measured from
    // the home test stands: 0.45 of the A→C span, x = 45, which is fraction
    // (45-20)/80 = 0.3125 of the far gap. Just inside it the band still paints;
    // just past it, nothing.
    const { regions } = carriedScene()
    const apexFraction = (RULED_APEX_X - 20) / 80
    expect(
      drawnThickness(regions, 1, apexFraction - 0.03, TARGET),
      'the band has already closed BEFORE its apex',
    ).toBeGreaterThan(0)
    expect(
      drawnThickness(regions, 1, apexFraction + 0.03, TARGET),
      'the band still paints PAST its apex',
    ).toBeCloseTo(0, 6)
  })

  it('CT4: both gaps lie on ONE line — the same straight taper, not two shapes', () => {
    // The whole of the ruling in one assertion: sample right across both gaps
    // and every drawn thickness sits on the single line from the home test to
    // the apex.
    const { regions } = carriedScene()
    for (const f of [0.25, 0.6, 0.9]) {
      expect(
        drawnThickness(regions, 0, f, TARGET),
        `first gap, f=${f}, x=${xOfGap0(f)}`,
      ).toBeCloseTo(ruledThickness(xOfGap0(f)), 2)
    }
    for (const f of [0.02, 0.1, 0.25]) {
      expect(
        drawnThickness(regions, 1, f, TARGET),
        `far gap, f=${f}, x=${xOfGap1(f)}`,
      ).toBeCloseTo(ruledThickness(xOfGap1(f)), 2)
    }
  })

  it('CT5 (control): a band tied through the gap stays flat — it is not a taper at all', () => {
    // SCOPE. This band has two tied contacts across its gap, so the law emits
    // nothing and it spans (``emitKernel.ts``). Nothing about carrying a band
    // past a blind column reaches it, and it must still be drawn at its own
    // full thickness the whole way across.
    const litho = lithoFrame(['A', 'B'])
    const stack = (id: string): PartitionColumn =>
      column(id, 20, [
        { layerId: `G-${id}-up`, formationId: COVER_CLASS, top: 0, base: 8 },
        { layerId: `G-${id}`, formationId: TARGET, top: 8, base: 12 },
        { layerId: `G-${id}-dn`, formationId: DEEP_CLASS, top: 12, base: 20 },
      ])
    const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, [0, 100])
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions,
      geotechColumns: [stack('A'), stack('B')],
      geotechEdges: [tie('G-A', 'G-B'), tie('G-A', 'G-B', 'base')],
      alongM: [0, 100],
    })
    for (const f of [0.1, 0.5, 0.9]) {
      expect(
        drawnThickness(out.regions, 0, f, TARGET),
        `a tied-through band must stay at its own thickness (f=${f})`,
      ).toBeCloseTo(4, 2)
    }
  })

  it("CT6 (control): at the run's own edge, with nothing beyond to read, the curtain stays flat", () => {
    // SCOPE, the other side. B is blind at the band's levels AND is the run's
    // own last column — nothing further out reads that ground, so there is no
    // apex to taper toward and today's flat curtain is the final answer
    // (``terminationRun``'s ``reads: false``; the same law EF1 pins in
    // ``extendsToFarCurtain.test.ts``).
    const litho = lithoFrame(['A', 'B'])
    const geotech: PartitionColumn[] = [
      column('A', 20, [
        { layerId: 'G-A-up', formationId: COVER_CLASS, top: 0, base: 8 },
        { layerId: 'G-A', formationId: TARGET, top: 8, base: 12 },
        { layerId: 'G-A-dn', formationId: DEEP_CLASS, top: 12, base: 20 },
      ]),
      column('B', 20, [{ layerId: 'G-B-up', formationId: COVER_CLASS, top: 0, base: 8 }]),
    ]
    const lithoRegions = computeSectionFillActive(litho.columns, litho.edges, undefined, [0, 100])
    const out = computeHierarchicalGeotechFill({
      lithoColumns: litho.columns,
      lithoEdges: litho.edges,
      lithoRegions,
      geotechColumns: geotech,
      geotechEdges: [tie('G-A-up', 'G-B-up')],
      alongM: [0, 100],
    })
    for (const f of [0.1, 0.5, 0.9]) {
      expect(
        drawnThickness(out.regions, 0, f, TARGET),
        `the run-edge curtain must stay at full thickness (f=${f})`,
      ).toBeCloseTo(4, 2)
    }
  })
})
