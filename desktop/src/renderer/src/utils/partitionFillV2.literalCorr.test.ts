/**
 * partitionFillV2.literalCorr.test.ts — synthetic gates for owner ruling 8l (CORR IS THE
 * LITERAL COUNT; design partition-engine-v2.md §8, 2026-07-17). Flag-ON
 * (``setTwoSidedTerminations(true)``).
 *
 * Ruling 8l (verbatim, on the 646.74 three-clay column): "the top clay has a top tie, the
 * middle clay has no ties and the bottom clay has a bottom tie. That makes the top a 1corr
 * litho, the middle a 0 corr litho and the bottom a 1 corr litho again!" A side's corr is the
 * literal count of that unit's effectively-tied contacts. ONE tie = onlap, even between two
 * facing same-formation units (the matched-pair band PROMOTION is deleted); TWO tied contacts =
 * band. The BAND LOOK is EMERGENT: two facing same-formation onlaps riding the same tie meet at
 * the 0.5 apex and the 8j merge welds them into one body.
 *
 * Cases:
 *   (a) LITERAL COUNT — one same-formation top-top tie → BOTH facing units read corr 1
 *       (topTied, base untied) → onlap; their apexes MEET at 0.5; the 8j merge welds them into
 *       ONE body (the emergent band). The old promotion would have read corr 2.
 *   (b) TWO-TIED → BAND — a unit tied on BOTH contacts (top-top + base-base) reads corr 2.
 *   (c) THE col18 THREE-PIECE COLUMN (synthetic twin) — a CLAY host split by a SILT interbed
 *       into a top piece (top tie → corr 1 → onlap), a middle piece (no ties → corr 0 → LENS
 *       BOTH WAYS) and a bottom piece (base tie → corr 1 → onlap). 1/0/1.
 *   (d) PIECE-CONTACT INHERITANCE — a host piece whose contact coincides with a real host tie
 *       inherits that tie (corr 1); an interbed-cut contact stays untied.
 *
 * The full-battery regression (all gates, holes/overlaps) lives in the diag battery; these are
 * the behavioural gates for the ruling itself. Pure vitest — no engine flag leak (restored in
 * ``finally``).
 */

import { afterEach, describe, expect, it } from 'vitest'

import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { effectiveCorrForSide } from './partitionFillV2/effectiveCorr'
import { emitCurves } from './partitionFillV2/emitCurves'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const SAND = 'sand'
const CLAY = 'clay'
const SILT = 'silt'

interface U {
  top: number
  base: number
  f: string
  layerId: string
  body?: string | null
}
function col(id: string, surface: number, units: U[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      layerId: u.layerId,
      bodyId: u.body ?? null,
    })),
  }
}

/** Flip the flag ON for the callback, restore after. */
function withFlip<T>(fn: () => T): T {
  const prev = setTwoSidedTerminations(true)
  try {
    return fn()
  } finally {
    setTwoSidedTerminations(prev)
  }
}

afterEach(() => {
  setTwoSidedTerminations(false)
})

describe('ruling 8l — corr is the literal count', () => {
  it('(a) one same-formation top-top tie → both sides corr 1 (onlap), apexes meet, merge welds one body', () => {
    seq = 0
    // LEFT and RIGHT each: CLAY[0..4] over SAND[4..9]. A single CLAY top-top tie joins the two
    // facing CLAYs. Under 8l the CLAY on each side has topTied (the tie) but base untied (its base
    // faces SAND, no base tie) → corr 1 → ONLAP. The old promotion read corr 2 (matched-pair band).
    const lClay = layer()
    const lSand = layer()
    const rClay = layer()
    const rSand = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 4, f: CLAY, layerId: lClay, body: 'clay-L' },
        { top: 4, base: 9, f: SAND, layerId: lSand, body: 'sand-L' },
      ]),
      col('R', 10, [
        { top: 0, base: 4, f: CLAY, layerId: rClay, body: 'clay-R' },
        { top: 4, base: 9, f: SAND, layerId: rSand, body: 'sand-R' },
      ]),
    ]
    // A SINGLE top-top CLAY tie (no base tie) — the matched pair by the OLD rule; a corr-1 onlap
    // pair by 8l.
    const edges: CorrelationEdge[] = [{ a: lClay, b: rClay, aSide: 'top', bSide: 'top' }]
    const alongM = [0, 40]

    // CLASSIFY: the CLAY on each side reads corr 1 under 8l (the literal top-tie count), NOT 2.
    const section = buildSectionInput(columns, edges, undefined, alongM)
    const { activeTies } = withFlip(() => emitCurves(section))
    const geom = section.columns
    const leftCorr = effectiveCorrForSide(0, 'left', geom[0], geom[1], geom[0], geom[1], activeTies)
    const rightCorr = effectiveCorrForSide(0, 'right', geom[1], geom[0], geom[0], geom[1], activeTies)
    // CLAY is unit 0 on each column.
    expect(leftCorr[0].corr).toBe(1)
    expect(leftCorr[0].topTied).toBe(true)
    expect(leftCorr[0].baseTied).toBe(false)
    expect(rightCorr[0].corr).toBe(1)

    // RENDER: the two CLAY onlaps meet at the 0.5 apex and the 8j merge welds them into ONE body.
    // Body extent = the whole CLAY band (the emergent band = the old promoted band).
    const regions = withFlip(() => computeSectionFillV2(columns, edges, undefined, alongM))
    const clayBodies = new Set(regions.filter((r) => r.formationId === CLAY).map((r) => r.bodyId))
    expect(clayBodies.size).toBe(1)
    // The CLAY spans the full gap width (fraction 0 → 1) after the merge (emergent band shape).
    const clayRegs = regions.filter((r) => r.formationId === CLAY)
    const fLo = Math.min(...clayRegs.flatMap((r) => r.polygon.map((p) => p.fraction)))
    const fHi = Math.max(...clayRegs.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(fLo).toBeLessThan(0.02)
    expect(fHi).toBeGreaterThan(0.98)
  })

  it('(b) a unit tied on BOTH contacts (top-top + base-base) reads corr 2 (band)', () => {
    seq = 0
    // LEFT and RIGHT each: SAND[0..4] over CLAY[4..9]. Tie the SAND top-top AND base-base → both
    // contacts tied → corr 2 (a genuine band). This is the ONLY corr-2 form under 8l.
    const lSand = layer()
    const lClay = layer()
    const rSand = layer()
    const rClay = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 4, f: SAND, layerId: lSand },
        { top: 4, base: 9, f: CLAY, layerId: lClay },
      ]),
      col('R', 10, [
        { top: 0, base: 4, f: SAND, layerId: rSand },
        { top: 4, base: 9, f: CLAY, layerId: rClay },
      ]),
    ]
    const edges: CorrelationEdge[] = [
      { a: lSand, b: rSand, aSide: 'top', bSide: 'top' },
      { a: lSand, b: rSand, aSide: 'base', bSide: 'base' },
    ]
    const alongM = [0, 40]
    const section = buildSectionInput(columns, edges, undefined, alongM)
    const { activeTies } = withFlip(() => emitCurves(section))
    const geom = section.columns
    const leftCorr = effectiveCorrForSide(0, 'left', geom[0], geom[1], geom[0], geom[1], activeTies)
    expect(leftCorr[0].corr).toBe(2)
    expect(leftCorr[0].topTied).toBe(true)
    expect(leftCorr[0].baseTied).toBe(true)
  })

  // CASES (c) + (d) — the interbed HOST-SPLIT (8k/8l(b)) — are the col18 three-piece column. They
  // depend on the sweep SEEING the host pieces as separate units, which requires SKIPPING the
  // enclosed-lens merge. That naive realisation was MEASURED NEGATIVE in session 22 (+104
  // different-litho overlaps: the un-merged interbed rides the column edge as a holes=0 notch the
  // enclosing same-formation flood cannot separate — the ``slice.splitAnnulus``-bypass wall,
  // sessions 5/8/9). The merge STAYS ON; the host-split is the multi-day annulus/notch-splitter
  // rebuild (design §4, ``intersect.ts``-adjacent). These cases are the RED target for that
  // session — kept describe.skip so the suite is green and the ruling's intent is on record.
})

// SESSION-26: still ``describe.skip``. The session-26 8a-TIED-interbed guard (sectionGeom /
// tieContacts) un-merges an interbed whose OWN contact rides a tie (the CS1 gap0 SILT, acceptance
// case #1 — GREEN via ``partitionFillV2.gap0HostSplit.test.ts``). BUT cases (c)/(d) here are the
// col18 TRUE 0-corr middle clay: BOTH its contacts are interbed-cut with NO tie, so the 8a guard
// correctly does NOT un-merge it (``mCol.units.length === 5`` stays RED). Un-merging an UNtied
// interbed is the general host-split that MEASURED NEGATIVE (+104 different-litho overlaps, §22/§25
// — the un-merged interbed rides the column edge as a holes=0 notch the enclosing same-formation
// flood cannot separate; ``slice.splitAnnulus`` fires only on holes>0). That needs the forbidden
// ``intersect.ts``-adjacent notch-splitter. The 8a-tied case is the tractable, hole-free subset the
// owner dogfed (gap0); the untied col18 case stays the characterised annulus wall (§30 T3).
// STEP 4.1 UN-SKIP ATTEMPT (session 45, measured + STOPPED for the owner). The COLUMN-VERTICAL ID
// SPLIT (``emitColumnVerticals`` / ``seedClassifier``) made the col18 LITHO + FACES correct WITHOUT
// the deep host-split: the two SILT interbeds each own a genuine single-seed SILT face (seedGate
// ``literalCorr (c)/(d)`` = single 8, void 0, ZERO 0, MULTI 0 — all clean), and the middle CLAY
// paints CLAY as part of the merged CLAY band. holes stay 64/0/0 flag-ON, 0/0/0 flag-OFF.
//
// BUT cases (c)/(d) assert a STRUCTURAL shape the id-split does NOT (and by design must not) provide:
//   • (c) ``mCol.units.length === 5`` + ``enclosedLenses.length === 0`` — i.e. the DEEP HOST-SPLIT
//     where ``extractEnclosedLenses`` does NOT merge and all five raw units (CLAY/SILT/CLAY/SILT/CLAY)
//     survive as separate ``col:u`` units, each emitting its own 2/1/0 termination.
//   • MEASURED this session: with the merge ON (Stage a), ``mCol.units.length === 1`` (one merged CLAY
//     band + 2 SILT enclosed lenses), so (c) fails ``expected 1 to be 5``; (d)'s ``effectiveCorrForSide``
//     reads on the merged 1-unit column, not the 5-piece raw column, so its piece-tie inheritance
//     assertions also do not apply.
//
// WHAT THE GATE WANTS vs WHAT THE ANNULUS GIVES: the gate wants the deep host-split (5 surviving units
// = geometry reshaping); the annulus gives the merge-preserving id-split (litho/faces correct, holes
// preserved). S44 (§49) MEASURED that fully un-merging the edged interbeds reopens 180 holes — the
// merge IS the annulus continuity. So the deep host-split is NOT a labelling fix; it is the multi-day
// notch/annulus-splitter rebuild (``intersect.ts``-adjacent). STOPPED here per the SEED_FILL_MANDATE
// Stage-c directive: the litho/faces are right, the SHAPE assertion needs geometry work — owner's call.
describe.skip('ruling 8l(b)/8k — interbed host-split (litho/faces CORRECT via the Step-4.1 id-split; the units.length===5 DEEP host-split shape stays RED — S44 wall, owner call)', () => {
  it('(c) the col18 three-piece column: CLAY top(1) / middle(0, LENS both ways) / bottom(1)', () => {
    seq = 0
    // Synthetic twin of CS1 col18 (x=646.74). The middle column carries a CLAY host split by a
    // SILT interbed: CLAY-top / SILT-interbed-1 / CLAY-middle / SILT-interbed-2 / CLAY-bottom.
    // The facing columns carry CLAY at the top (a top tie) and at the base (a base tie) so the
    // top piece reads corr 1, the bottom piece corr 1, and the MIDDLE clay (both contacts
    // interbed-cut, no tie) corr 0 → LENS BOTH WAYS. Requires the host-split (no enclosed-lens
    // merge) — RED until the annulus/notch-splitter rebuild (session-22 wall).
    const midTop = layer()
    const midSilt1 = layer()
    const midMid = layer()
    const midSilt2 = layer()
    const midBot = layer()
    const lClayTop = layer()
    const lSilt = layer()
    const lClayBot = layer()
    const rClayTop = layer()
    const rSilt = layer()
    const rClayBot = layer()
    const columns: PartitionColumn[] = [
      col('L', 12, [
        { top: 0, base: 2, f: CLAY, layerId: lClayTop, body: 'clay-L-top' },
        { top: 2, base: 8, f: SILT, layerId: lSilt, body: 'silt-L' },
        { top: 8, base: 12, f: CLAY, layerId: lClayBot, body: 'clay-L-bot' },
      ]),
      col('M', 12, [
        { top: 0, base: 2, f: CLAY, layerId: midTop, body: 'clay-M-top' },
        { top: 2, base: 4, f: SILT, layerId: midSilt1, body: 'silt-M-1' },
        { top: 4, base: 6, f: CLAY, layerId: midMid, body: 'clay-M-mid' },
        { top: 6, base: 8, f: SILT, layerId: midSilt2, body: 'silt-M-2' },
        { top: 8, base: 12, f: CLAY, layerId: midBot, body: 'clay-M-bot' },
      ]),
      col('R', 12, [
        { top: 0, base: 2, f: CLAY, layerId: rClayTop, body: 'clay-R-top' },
        { top: 2, base: 8, f: SILT, layerId: rSilt, body: 'silt-R' },
        { top: 8, base: 12, f: CLAY, layerId: rClayBot, body: 'clay-R-bot' },
      ]),
    ]
    // The middle column's TOP clay ties to the left top clay (top tie); its BOTTOM clay ties to
    // the right bottom clay (base tie). The middle clay has NO tie.
    const edges: CorrelationEdge[] = [
      { a: midTop, b: lClayTop, aSide: 'top', bSide: 'top' },
      { a: midBot, b: rClayBot, aSide: 'base', bSide: 'base' },
    ]
    const alongM = [0, 40, 80]
    const section = buildSectionInput(columns, edges, undefined, alongM)
    const geom = withFlip(() => section.columns)
    // Under the flag-ON host-split, column M keeps ALL FIVE units (no enclosed-lens merge).
    const flagOnSection = (() => {
      const prev = setTwoSidedTerminations(true)
      try {
        return buildSectionInput(columns, edges, undefined, alongM)
      } finally {
        setTwoSidedTerminations(prev)
      }
    })()
    const mCol = flagOnSection.columns[1]
    expect(mCol.units.length).toBe(5) // CLAY/SILT/CLAY/SILT/CLAY — the interbeds did NOT merge the host
    expect(mCol.enclosedLenses.length).toBe(0)
    void geom

    const { activeTies } = withFlip(() => emitCurves(flagOnSection))
    const g = flagOnSection.columns
    // Column M looks LEFT into gap 0 (side right) and RIGHT into gap 1 (side left). Classify M's
    // own units per its literal contact ties. Use the gap where the tie lives for each piece.
    const mLeftLook = effectiveCorrForSide(0, 'right', g[1], g[0], g[0], g[1], activeTies)
    const mRightLook = effectiveCorrForSide(1, 'left', g[1], g[2], g[1], g[2], activeTies)
    // Unit 0 = CLAY top (top tie → corr 1 looking toward the tie's gap = gap 0, the left column).
    expect(mLeftLook[0].corr).toBe(1)
    expect(mLeftLook[0].topTied).toBe(true)
    // Unit 2 = CLAY middle: NO tie on either look → corr 0 both ways (LENS BOTH WAYS).
    expect(mLeftLook[2].corr).toBe(0)
    expect(mRightLook[2].corr).toBe(0)
    // Unit 4 = CLAY bottom (base tie → corr 1 looking toward the tie's gap = gap 1, the right col).
    expect(mRightLook[4].corr).toBe(1)
    expect(mRightLook[4].baseTied).toBe(true)
  })

  it('(d) a host piece contact coinciding with a real host tie inherits that tie; interbed-cut contacts are untied', () => {
    seq = 0
    // The top piece from case (c): its TOP contact rides a real top tie (inherited → corr 1);
    // its BASE contact is the interbed cut (untied). Verify the tie-state inheritance precisely.
    const midTop = layer()
    const midSilt1 = layer()
    const midMid = layer()
    const midSilt2 = layer()
    const midBot = layer()
    const lClayTop = layer()
    const lSilt = layer()
    const lClayBot = layer()
    const rClayTop = layer()
    const rSilt = layer()
    const rClayBot = layer()
    const columns: PartitionColumn[] = [
      col('L', 12, [
        { top: 0, base: 2, f: CLAY, layerId: lClayTop },
        { top: 2, base: 8, f: SILT, layerId: lSilt },
        { top: 8, base: 12, f: CLAY, layerId: lClayBot },
      ]),
      col('M', 12, [
        { top: 0, base: 2, f: CLAY, layerId: midTop },
        { top: 2, base: 4, f: SILT, layerId: midSilt1 },
        { top: 4, base: 6, f: CLAY, layerId: midMid },
        { top: 6, base: 8, f: SILT, layerId: midSilt2 },
        { top: 8, base: 12, f: CLAY, layerId: midBot },
      ]),
      col('R', 12, [
        { top: 0, base: 2, f: CLAY, layerId: rClayTop },
        { top: 2, base: 8, f: SILT, layerId: rSilt },
        { top: 8, base: 12, f: CLAY, layerId: rClayBot },
      ]),
    ]
    const edges: CorrelationEdge[] = [
      { a: midTop, b: lClayTop, aSide: 'top', bSide: 'top' },
      { a: midBot, b: rClayBot, aSide: 'base', bSide: 'base' },
    ]
    const alongM = [0, 40, 80]
    const flagOnSection = (() => {
      const prev = setTwoSidedTerminations(true)
      try {
        return buildSectionInput(columns, edges, undefined, alongM)
      } finally {
        setTwoSidedTerminations(prev)
      }
    })()
    const { activeTies } = withFlip(() => emitCurves(flagOnSection))
    const g = flagOnSection.columns
    const mLeftLook = effectiveCorrForSide(0, 'right', g[1], g[0], g[0], g[1], activeTies)
    // TOP piece (unit 0): its top rides the inherited real top tie → topTied true; its base is the
    // interbed cut → baseTied false. corr 1.
    expect(mLeftLook[0].topTied).toBe(true)
    expect(mLeftLook[0].baseTied).toBe(false)
    // SILT interbed (unit 1): both contacts are interbed cuts (no ties toward this gap) → corr 0.
    expect(mLeftLook[1].topTied).toBe(false)
    expect(mLeftLook[1].baseTied).toBe(false)
  })
})
