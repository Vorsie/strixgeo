/**
 * THE SEAM DRAPE — *"follow the lens flank up to the flat tongue point"*.
 *
 * Owner, 2026-08-25, on Cross-section 3 gap 6 (GEO-05/040-S5 → GEO-06/092-S2):
 * he asked why the dense sand does not *"just follow the lens flank up to the
 * flat tongue point"*, was shown four readings of the same scene, and ruled:
 * *"yes C is the ruling, implement it, looks best in this particular case, make
 * sure you test so it doesn't affect other cases"*.
 *
 * Option C, in his own caption: *"Flat top to the tongue tip, then the boundary
 * follows the silt lens's own flank down to S2. No cliff, no orphan diagonal —
 * the sand drapes the lens."*
 *
 * WHAT MUST NOT MOVE, and it is the same owner from the day before: where the
 * flat half faces nothing but another flat half, *"The different height is
 * acceptable"* — the step stays. The control below pins exactly that, and the
 * near-miss pins that a facing construct OUTSIDE the step's own window changes
 * nothing either.
 *
 * The scenes are his gap 6 reduced: a dense sand whose flat mTAW tongue ends at
 * the seam one contact ABOVE where the same sand resumes on the facing side,
 * with a lens pinching back from that facing test between the two.
 *
 * WHY THE STACKS CARRY A THIN ODD BAND AT EACH COVER EDGE (2026-08-26). The
 * stacked seam is the fallback for an UN-CORRELATED pair of packages — its own
 * module says so: *"i will prolly tie the dense sand on one column to the dense
 * sand on the second column anyway after this fix, but we need a decent
 * fallback"*. Since the cover weld of 2026-08-26 (``coverWeld.ts``) a cover
 * boundary whose far band is the same mass IS a tie, so a reduction whose two
 * stacks happened to share their outermost classes was no longer un-correlated
 * at all: both packages welded open and the gap left this rule's scope, exactly
 * as its docstring says a tied package must. That made every assertion below
 * pass for the wrong reason — the sand wrapped the cover's own lens with no
 * drape drawn anywhere. A half-metre band of a THIRD class at each cover edge
 * restores what the reduction always meant to say, and every assertion is
 * unchanged from the day the owner ruled on them.
 */
import { describe, expect, it } from 'vitest'

import { interiorVerticals } from './onlapClosure'
import { computeHierarchicalGeotechFill } from '../index'
import { column, paintAt, tie } from '../scene.test-helpers'
import { computeSectionFillActive } from '../../partitionEngineSelect'
import type { SectionRegion } from '../../sectionPartition'

const SAND = 'f-sand'
const CLAY = 'f-clay'
const N6 = 'g-zand-6'
const N8 = 'g-zand-8'
const K16 = 'g-silt-16'
/** The two cover-edge classes that keep the packages un-correlated (header). */
const N5 = 'g-zand-5'
const N7 = 'g-zand-7'

/** Without this every band keeps row identity and *"least dense"* has no order. */
const PACKING = new Map<string, string>([
  [N6, 'ZAND|6'],
  [N8, 'ZAND|8'],
  [K16, 'SILT|16'],
  [N5, 'ZAND|5'],
  [N7, 'ZAND|7'],
])

/** Two tests, his own S5 → S2 spacing rebased to 0. */
const PAIR = [0, 69]

/**
 * One scene: A's stack, B's stack, and whatever litho B carries.
 *
 * @param lithoB B's litho units, in metres below a collar at +10.
 * @param geotechA A's packing bands, in metres below the collar.
 * @param geotechB B's packing bands, in metres below the collar.
 * @returns The fill's output.
 */
function scene(
  lithoB: { layerId: string; formationId: string; top: number; base: number }[],
  geotechA: { layerId: string; formationId: string; top: number; base: number }[],
  geotechB: { layerId: string; formationId: string; top: number; base: number }[],
): ReturnType<typeof computeHierarchicalGeotechFill> {
  const lithoColumns = [
    column('A', 10, [{ layerId: 'LA', formationId: SAND, top: 0, base: 14 }]),
    column('B', 10, lithoB),
  ]
  const sands = lithoB.filter((u) => u.formationId === SAND)
  const lithoEdges = [
    tie('LA', sands[0].layerId, 'top', 'top'),
    tie('LA', sands[sands.length - 1].layerId, 'base', 'base'),
  ]
  return computeHierarchicalGeotechFill({
    lithoColumns,
    lithoEdges,
    lithoRegions: computeSectionFillActive(lithoColumns, lithoEdges, undefined, PAIR),
    geotechColumns: [column('A', 10, geotechA), column('B', 10, geotechB)],
    geotechEdges: [],
    alongM: PAIR,
    packingClassOf: PACKING,
  })
}

/** B's litho with the clay that lenses back from B, apex at +4. */
const LITHO_B_WITH_LENS = [
  { layerId: 'LB1', formationId: SAND, top: 0, base: 5 },
  { layerId: 'LBC', formationId: CLAY, top: 5, base: 7 },
  { layerId: 'LB2', formationId: SAND, top: 7, base: 14 },
]

/** B's litho with nothing facing the seam at all. */
const LITHO_B_PLAIN = [{ layerId: 'LB', formationId: SAND, top: 0, base: 14 }]

/** A's stack: medium down to +5, then the dense sand — the flat tongue. */
const A_TONGUE_AT_5 = [
  { layerId: 'GA0', formationId: N5, top: 0, base: 0.5 },
  { layerId: 'GA1', formationId: N6, top: 0.5, base: 5 },
  { layerId: 'GA2', formationId: N8, top: 5, base: 13.5 },
  { layerId: 'GA3', formationId: N7, top: 13.5, base: 14 },
]

/** B's stack around the lens: the dense sand resumes only at +3. */
const B_RESUMES_AT_3_WITH_LENS = [
  { layerId: 'GB1', formationId: N6, top: 0, base: 5 },
  { layerId: 'GBC', formationId: K16, top: 5, base: 7 },
  { layerId: 'GB2', formationId: N8, top: 7, base: 13.5 },
  { layerId: 'GB3', formationId: N6, top: 13.5, base: 14 },
]

/** The same step with no lens in it — B's medium simply runs down to +3. */
const B_RESUMES_AT_3_PLAIN = [
  { layerId: 'GB1', formationId: N6, top: 0, base: 7 },
  { layerId: 'GB2', formationId: N8, top: 7, base: 13.5 },
  { layerId: 'GB3', formationId: N6, top: 13.5, base: 14 },
]

/** The region painted at a point, with a readable failure. */
function classAt(out: { regions: SectionRegion[] }, f: number, e: number): string {
  const region = paintAt(out.regions, 0, f, e)
  expect(region, `nothing is painted at (${f}, ${e})`).not.toBeNull()
  return (region as SectionRegion).formationId
}

/** The single region of one class, with a readable failure. */
function regionOf(out: { regions: SectionRegion[] }, formationId: string): SectionRegion {
  const found = out.regions.filter((r) => r.gapIndex === 0 && r.formationId === formationId)
  expect(found.length, `expected exactly one ${formationId} region, got ${found.length}`).toBe(1)
  return found[0]
}

/** A ring's vertices on the mm grid, for a vertex-presence read. */
function vertices(region: SectionRegion): string[] {
  return region.polygon.map((p) => `${p.fraction.toFixed(3)},${p.elevation.toFixed(2)}`)
}

describe('a stacked seam drapes the facing construct instead of cliffing', () => {
  it('SD1: the flat band runs flat to its tongue tip, then follows the lens flank', () => {
    // *"Flat top to the tongue tip, then the boundary follows the silt lens's
    // own flank down to S2. No cliff."* A's dense sand holds +5 flat to the
    // seam; B's resumes at +3; the clay lenses back from B with its apex at +4,
    // strictly between the two. So the dense sand's own far boundary is
    // tip (0.5, +5) -> apex (0.55, +4) -> the flank's own landing (1, +3).
    const out = scene(LITHO_B_WITH_LENS, A_TONGUE_AT_5, B_RESUMES_AT_3_WITH_LENS)
    const dense = regionOf(out, N8)
    expect(
      interiorVerticals(dense.polygon),
      'the dense sand still ends in a cliff at the seam',
    ).toEqual([])
    expect(vertices(dense), 'the boundary does not turn at the flat tongue tip').toContain(
      '0.500,5.00',
    )
    expect(vertices(dense), "the boundary does not join the lens's own apex").toContain('0.550,4.00')
    // ...and the ground under the drape IS the dense sand now. Beside the seam
    // the drape stands at +4.6, and out at f=0.8 at +3.44.
    expect(classAt(out, 0.52, 4.4), 'the ground just under the drape near the seam').toBe(N8)
    expect(classAt(out, 0.8, 3.3), 'the ground under the lens flank out toward B').toBe(N8)
    // ...while the ground ABOVE the drape stays the medium sand it was.
    expect(classAt(out, 0.52, 4.9), 'the ground above the drape near the seam').toBe(N6)
  })

  it('SD2: the lens the boundary follows keeps its own shape, on top of it', () => {
    // *"the sand drapes the lens"* — the drape rides the lens's flank, it does
    // not eat into it. The clay's own triangle is untouched.
    const out = scene(LITHO_B_WITH_LENS, A_TONGUE_AT_5, B_RESUMES_AT_3_WITH_LENS)
    expect(vertices(regionOf(out, K16)).sort(), 'the facing lens lost its own shape').toEqual(
      ['0.550,4.00', '1.000,3.00', '1.000,5.00'].sort(),
    )
  })

  it('SD3: flat facing flat keeps the step — *"The different height is acceptable"*', () => {
    // THE CONTROL. Same two stacks, same +5-to-+3 step at the seam, and nothing
    // facing it. The owner accepted this step on 2026-08-24 and the drape must
    // not reach it: no construct, no join, the vertical stands.
    const out = scene(LITHO_B_PLAIN, A_TONGUE_AT_5, B_RESUMES_AT_3_PLAIN)
    const dense = regionOf(out, N8)
    const verticals = interiorVerticals(dense.polygon)
    expect(verticals.length, 'the accepted step at the seam was removed').toBe(1)
    expect(verticals[0].fraction, 'the accepted step moved off the seam').toBeCloseTo(0.5, 6)
    expect([verticals[0].lo, verticals[0].hi], 'the accepted step changed height').toEqual([3, 5])
    expect(classAt(out, 0.52, 4.0), 'the facing half stopped answering its own hole').toBe(N6)
  })

  it('SD4: a facing construct OUTSIDE the step changes nothing', () => {
    // THE NEAR MISS. The same lens, the same seam — but A's tongue now ends at
    // +3.5, so the step is +3..+3.5 and the lens's apex at +4 stands above it.
    // A construct that does not stand IN the step is not the step's own, and
    // joining to it would invent a boundary the owner never asked for.
    const out = scene(
      LITHO_B_WITH_LENS,
      [
        { layerId: 'GA0', formationId: N5, top: 0, base: 0.5 },
        { layerId: 'GA1', formationId: N6, top: 0.5, base: 6.5 },
        { layerId: 'GA2', formationId: N8, top: 6.5, base: 13.5 },
        { layerId: 'GA3', formationId: N7, top: 13.5, base: 14 },
      ],
      B_RESUMES_AT_3_WITH_LENS,
    )
    const verticals = interiorVerticals(regionOf(out, N8).polygon)
    expect(verticals.length, 'the near-miss step was draped anyway').toBe(1)
    expect([verticals[0].lo, verticals[0].hi], 'the near-miss step changed height').toEqual([3, 3.5])
  })

  it('SD5: two packages that WELD at both cover edges leave this rule behind entirely', () => {
    // The scene the four above used to be, before the cover-edge classes were
    // differentiated (see the header): A's medium and B's medium share the
    // cover top, A's dense and B's dense share the cover base. Since
    // 2026-08-26 each of those pairs is a TIED CONTACT, so both packages emit
    // ``nothing``, span, and take the gap out of the stacked seam's scope —
    // *"tied full-width bands are never touched by it"* (``stackedSeamHalf``).
    //
    // The RESULT is still the shape the owner asked for and there is no cliff:
    // the dense sand is ONE body wrapping the litho lens, whose own triangle is
    // untouched. It reaches that shape by welding rather than by draping.
    const out = scene(
      LITHO_B_WITH_LENS,
      [
        { layerId: 'GA1', formationId: N6, top: 0, base: 5 },
        { layerId: 'GA2', formationId: N8, top: 5, base: 14 },
      ],
      [
        { layerId: 'GB1', formationId: N6, top: 0, base: 5 },
        { layerId: 'GBC', formationId: K16, top: 5, base: 7 },
        { layerId: 'GB2', formationId: N8, top: 7, base: 14 },
      ],
    )
    const dense = regionOf(out, N8)
    expect(interiorVerticals(dense.polygon), 'the welded body ends in a cliff').toEqual([])
    expect(vertices(regionOf(out, K16)).sort(), 'the facing lens lost its own shape').toEqual(
      ['0.550,4.00', '1.000,3.00', '1.000,5.00'].sort(),
    )
    // One body from test to test: the weld is what "emit nothing" means.
    expect(Math.min(...dense.polygon.map((p) => p.fraction))).toBeCloseTo(0, 6)
    expect(Math.max(...dense.polygon.map((p) => p.fraction))).toBeCloseTo(1, 6)
  })
})
