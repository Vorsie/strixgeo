/**
 * DATA THAT DISAGREES IS STILL DATA — a carry stops at ANY column that read the
 * band's levels, whatever it read there.
 *
 * Owner ruling, 2026-08-25, shown a band drawn closing TWICE — once in its own
 * gap and again in the gap beyond a column that had measured that ground:
 *
 *   *"that is one easy right, if there is no column then it goes to 0.45 to
 *    column C and it paints over nothing. If there is a column then it goed
 *    0.45 to column B and doesn't paint right of that column"*
 *
 * The precedent is his own donor-walk ruling of 2026-08-18: *"a CPT whose bands
 * DO cover the window blocks the walk even when none of them are this layer's
 * soil — data that disagrees is still data, and borrowing from beyond it would
 * fake continuity through ground it says is something else."*
 *
 * THE DEFECT this pins. ``constructs.ts``'s ``facingHasData`` has always asked
 * the SECTION-WIDE question (``stacks``: every packing band of the column,
 * whatever family owns it), while ``bandContinuation``'s own reading test asked
 * a narrower, family-scoped one. A column carrying sand of another family at the
 * band's levels therefore answered BOTH ways at once: "has data" to the gap the
 * band stands in, which duly closed it there, and "blind" to the carry, which
 * spliced the same band into the gap BEYOND it, where it closed a second time.
 * One band, two closures — the ghost wedge.
 *
 * The three columns mirror the shape the defect was found in (the owner's
 * Cross-section 3, GEO-06/092-S1 → GEO-10/117-B4): the middle test's own sand is
 * cut out of this family by an interbed, so the family reads it as blind while
 * the section knows perfectly well it measured that ground.
 *
 * SCOPE. The genuinely-blind carry is untouched, and BB2 is its control: where a
 * column truly read nothing at the levels, the band still crosses it on the one
 * smooth taper of ``carriedTaper.ts`` (CT1–CT6).
 *
 * @module utils/geotechHierarchicalFill/carriedBandBlocked
 */
import { describe, expect, it } from 'vitest'

import { computeHierarchicalGeotechFill } from './index'
import { column, paintAt, tie, type UnitSpec } from './scene.test-helpers'
import { computeSectionFillActive } from '../partitionEngineSelect'
import type { PartitionColumn, SectionRegion } from '../sectionPartition'

/** The soils. A clay under MID's shallow sand puts MID's deep bands in another family. */
const SAND = 'f-sand'
const CLAY = 'f-clay'

/** The packing classes, in the owner's own vocabulary. */
const NAD_6 = 'g-nad-6'
const NAD_7 = 'g-nad-7'
const FAR_CLASS = 'g-nad-far'
const MID_SHALLOW = 'g-nad-shallow'

/**
 * FAR at x=0, MID at x=90, HOME at x=100 — the proportions ``bandContinuation``'s
 * own scene uses (a wide far gap, a narrow home gap), so a reach measured
 * against FAR instead of MID projects far enough to be unmistakable.
 */
const ALONG_M = [0, 90, 100]

/** The band under test: NAD 6 at elevation 12..8 on HOME, with no packing tie. */
const TARGET: UnitSpec = { layerId: 'G-HOME', formationId: NAD_6, top: 8, base: 12 }

/** Which classes this gap paints anywhere at all. */
function classesInGap(regions: readonly SectionRegion[], gap: number): Set<string> {
  const out = new Set<string>()
  for (const r of regions) if (r.gapIndex === gap) out.add(r.formationId)
  return out
}

/**
 * Build the three-column scene. FAR and HOME are fixed; MID is the variable.
 *
 * @param midLitho MID's litho stack, in metres below its collar.
 * @param midGeotech MID's packing bands, in metres below its collar.
 * @returns The fill's emitted regions.
 */
function scene(
  midLitho: readonly UnitSpec[],
  midGeotech: readonly UnitSpec[],
): readonly SectionRegion[] {
  const lithoColumns: PartitionColumn[] = [
    column('FAR', 20, [{ layerId: 'L-FAR', formationId: SAND, top: 0, base: 20 }]),
    column('MID', 20, midLitho),
    column('HOME', 20, [{ layerId: 'L-HOME', formationId: SAND, top: 0, base: 20 }]),
  ]
  // The family is FAR — MID's SHALLOW sand — HOME. Whatever MID logs below that
  // shallow unit is never correlated in, which is what makes the family's own
  // reading test disagree with the section-wide one.
  const lithoEdges = [tie('L-FAR', 'L-MID-TOP'), tie('L-MID-TOP', 'L-HOME')]
  const geotechColumns: PartitionColumn[] = [
    // FAR reads its whole column — including the target band's 12..8 window, so
    // a carry that ever reached this far would have something to pinch against.
    column('FAR', 20, [{ layerId: 'G-FAR', formationId: FAR_CLASS, top: 0, base: 20 }]),
    column('MID', 20, midGeotech),
    column('HOME', 20, [TARGET]),
  ]
  const lithoRegions = computeSectionFillActive(lithoColumns, lithoEdges, undefined, ALONG_M)
  return computeHierarchicalGeotechFill({
    lithoColumns,
    lithoEdges,
    lithoRegions,
    geotechColumns,
    geotechEdges: [],
    alongM: ALONG_M,
  }).regions
}

/** MID's shallow band — the one that keeps MID a member of the family in every case. */
const MID_TOP_BAND: UnitSpec = { layerId: 'G-MID-TOP', formationId: MID_SHALLOW, top: 0, base: 5 }

describe('a carry stops at any column that read the levels — whatever it read', () => {
  it('BB1: MID read the levels as another class, so NAD 6 closes in gap MID|HOME and paints NOTHING beyond MID', () => {
    // MID's own sand below 5 m is cut out of the family by a clay, and MID HAS
    // divided it — so at the band's 12..8 window MID carries geotech data
    // (NAD 7) that this family cannot see.
    const regions = scene(
      [
        { layerId: 'L-MID-TOP', formationId: SAND, top: 0, base: 5 },
        { layerId: 'L-MID-DEEP', formationId: CLAY, top: 5, base: 20 },
      ],
      [MID_TOP_BAND, { layerId: 'G-MID-DEEP', formationId: NAD_7, top: 5, base: 20 }],
    )

    // *"If there is a column then it goed 0.45 to column B and doesn't paint
    // right of that column"* — MID is that column, gap 0 (FAR|MID) is the ground
    // beyond it, and nothing of the band may reach it.
    expect(
      [...classesInGap(regions, 0)],
      'the band must not appear at all in the gap BEYOND the column that read its levels',
    ).not.toContain(NAD_6)

    // *"...it goed 0.45 to column B"* — the closure it DOES make is the ordinary
    // one, in its own gap, against MID. Gap 1 runs MID (fraction 0) to HOME
    // (fraction 1), so a reach of 0.45 away from HOME apexes at fraction 0.55.
    expect(
      paintAt(regions, 1, 0.95, 10)?.formationId,
      'the band must still be open beside its own test',
    ).toBe(NAD_6)
    expect(
      paintAt(regions, 1, 0.58, 10)?.formationId,
      'just short of the 0.45 apex the band is still open',
    ).toBe(NAD_6)
    expect(
      paintAt(regions, 1, 0.52, 10)?.formationId,
      'just past the 0.45 apex the band has closed',
    ).not.toBe(NAD_6)
  })

  it('BB2 (control): MID read NOTHING there, so the band is carried across it and tapers on — unchanged', () => {
    // MID logs one sand to 20 m but has only been divided over its top 5 m: at
    // the target's levels it read nothing at all, section-wide. This is the case
    // ``carriedTaper.ts`` (CT1–CT6) governs, and it must survive untouched.
    const regions = scene(
      [{ layerId: 'L-MID-TOP', formationId: SAND, top: 0, base: 20 }],
      [MID_TOP_BAND],
    )

    expect(
      [...classesInGap(regions, 0)],
      'a genuinely blind column is passed through — the band reaches the gap beyond it',
    ).toContain(NAD_6)
    // ...and it is still closing while it crosses: one taper, apexing inside the
    // far gap, so the band is present near MID and gone near FAR.
    expect(
      paintAt(regions, 0, 0.95, 10)?.formationId,
      'the carried band is still open where it enters the far gap',
    ).toBe(NAD_6)
    expect(
      paintAt(regions, 0, 0.1, 10)?.formationId,
      "the carried taper has closed well before FAR's own column",
    ).not.toBe(NAD_6)
  })

  it('BB3 (control): MID carries NAD 6 itself at the same levels — ordinary same-class behaviour, untouched', () => {
    // MID's sand IS the family's, and it is divided into a NAD 6 band over the
    // target's own window. Nothing here is a carry at all: two same-class bands
    // face each other and the ground between them is theirs.
    const regions = scene(
      [{ layerId: 'L-MID-TOP', formationId: SAND, top: 0, base: 20 }],
      [MID_TOP_BAND, { layerId: 'G-MID-DEEP', formationId: NAD_6, top: 5, base: 20 }],
    )

    expect(
      paintAt(regions, 1, 0.5, 10)?.formationId,
      'two same-class bands facing each other paint the ground between them',
    ).toBe(NAD_6)
    expect(
      paintAt(regions, 1, 0.05, 10)?.formationId,
      "the same-class mass reaches MID's own column line",
    ).toBe(NAD_6)
  })
})
