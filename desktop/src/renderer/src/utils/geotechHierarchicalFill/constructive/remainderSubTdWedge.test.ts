/**
 * *"i don't want the VD sand to spill below that bottom tie"* — and *"why isn't
 * the closest test on section used? it even has a top and bottom tie that unit
 * to the left, so that should be a vertical termination in the middle"*
 * (owner, 2026-08-28, on Cross-section 1 gap 14).
 *
 * ONE SCENE, HIS OWN NUMBERS. GEO-23/125-S8 reads very dense sand down to
 * -3.68, dense sand from there to -4.45 and silt below. GEO-10/170-S10, the
 * test facing it across the 5.3 m gap, STOPS at -3.24 — that is its total
 * depth, it has measured nothing deeper. He drew a tie from S10's base to S8's
 * dense-sand top, which is a real contact, so the dense sand has one tie, the
 * law makes it an onlap and it pinches at the middle of the gap.
 *
 * The wedge left under that pinching base has to belong to somebody. Two of his
 * rules meet on it:
 *
 *  * the very dense sand of GEO-23/125-S9 — a test that does not border this
 *    gap at all, one column further back — was taking it, painted 0.6 m BELOW
 *    the very-dense base he himself tied. A class may never stand on the far
 *    side of a correlation drawn on its own contact, and the last resort of the
 *    ladder dropped every wall including that one.
 *  * the ground is below the facing test's total depth, so no reading over
 *    there disagrees with S8's own. His nearest test holds its own levels to
 *    the middle and stops there, vertically.
 *
 * These pins are those two rules, in his terms, on his numbers.
 */
import { describe, expect, it } from 'vitest'

import { claims, tieElevAt, type BandConstruct, type RunBand, type RunTie } from './constructs'
import { wallsFor, type WallScope } from './ownContactTies'
import { pickRemainder, type RemainderInput } from './remainderLadder'

/** GEO-23/125-S9's very dense sand — one column BEHIND the gap's left test. */
const S9_VD: RunBand = {
  layerId: 'S9-vd',
  formationId: 'ZAND|8',
  bodyId: null,
  top: -1.17,
  base: -4.67,
  ci: 13,
  x: 537.7,
}
/** GEO-23/125-S8's very dense sand — the gap's left test. */
const S8_VD: RunBand = {
  layerId: 'S8-vd',
  formationId: 'ZAND|8',
  bodyId: null,
  top: -1.18,
  base: -3.68,
  ci: 14,
  x: 569.6,
}
/** GEO-23/125-S8's DENSE sand — the band whose base pinches over the wedge. */
const S8_D: RunBand = {
  layerId: 'S8-d',
  formationId: 'ZAND|7',
  bodyId: null,
  top: -3.68,
  base: -4.45,
  ci: 14,
  x: 569.6,
}
/** GEO-10/170-S10's very dense sand — the facing test, and its deepest reading. */
const S10_VD: RunBand = {
  layerId: 'S10-vd',
  formationId: 'ZAND|8',
  bodyId: null,
  top: -1.17,
  base: -3.24,
  ci: 15,
  x: 574.9,
}

/** His MANUAL tie: S10's base (its total depth) to S8's dense-sand top. */
const TIE_TD: RunTie = {
  key: 'tie-s10-base-to-s8-dense-top',
  leftCi: 14,
  rightCi: 15,
  leftX: 569.6,
  rightX: 574.9,
  leftY: -3.68,
  rightY: -3.24,
}
/**
 * His OTHER manual tie, drawn one gap back: it puts GEO-23/125-S9's very-dense
 * BASE on GEO-23/125-S8's very-dense base. It is the line the painted very
 * dense sand contradicts, and it does not cross this gap.
 */
const TIE_BACK: RunTie = {
  key: 'tie-s9-vd-base-to-s8-vd-base',
  leftCi: 13,
  rightCi: 14,
  leftX: 537.7,
  rightX: 569.6,
  leftY: -4.67,
  rightY: -3.68,
}

/** The dense sand's onlap: its top rides his tie, its base closes onto it. */
const ONLAP: BandConstruct = {
  band: S8_D,
  emit: 'onlap',
  apexX: 572.25,
  apexElev: -3.46,
  farX: 574.9,
  topTied: true,
  baseTied: false,
  topAt: (x: number) => tieElevAt(TIE_TD, x),
  baseAt: (x: number) => -4.45 + ((x - 569.6) / (572.25 - 569.6)) * (-3.46 - -4.45),
}

/** The sample the fill actually asked about, and the wedge it sits in. */
const SAMPLE = { x: 571.36, y: -4.132, lo: -4.473, hi: -3.791 }

/** Which correlations bound which band's OWN contacts. */
const OWN_CONTACT_TIES = new Map<string, readonly RunTie[]>([
  [S9_VD.layerId, [TIE_BACK]],
  [S8_VD.layerId, [TIE_TD, TIE_BACK]],
  [S8_D.layerId, [TIE_TD, TIE_BACK]],
  [S10_VD.layerId, [TIE_TD]],
])

/** What the facing test measured — his S10 stops at its total depth. */
const FACING_STOPS_AT_ITS_TD: readonly RunBand[] = [S10_VD]
/** The same test, had it kept going through the wedge's levels. */
const FACING_READS_THE_WEDGE: readonly RunBand[] = [
  S10_VD,
  { ...S10_VD, layerId: 'S10-deep', top: -3.24, base: -5.4 },
]

/**
 * One remainder decision on his gap 14.
 *
 * @param facing What the facing test measured (its whole stack).
 * @param bands Which bands of the family exist at all — the wedge pin removes
 *   S8's own dense sand to force the decision down to the last resort.
 * @returns The band the ladder hands the wedge to.
 */
function ask(
  facing: readonly RunBand[],
  bands: readonly RunBand[] = [S9_VD, S8_VD, S8_D, S10_VD],
): RunBand | null {
  const flankBands = bands.filter((b) => b.ci === 14 || b.ci === 15)
  const input: RemainderInput = {
    flankBands,
    familyBands: bands,
    closedAtMiddle: new Set(bands.some((b) => b === S8_D) ? [S8_D.layerId] : []),
    middle: 572.25,
    lo: SAMPLE.lo,
    hi: SAMPLE.hi,
    x: SAMPLE.x,
    y: SAMPLE.y,
    massKeyOf: (b) => b.formationId,
    drawnTies: [TIE_TD],
    closureBars: new Map(),
    shapedByLayer: new Map([[S8_D.layerId, ONLAP]]),
    ownContactTies: OWN_CONTACT_TIES,
    stacks: new Map([
      [13, [S9_VD]],
      [14, [S8_VD, S8_D, { ...S8_D, layerId: 'S8-silt', top: -4.45, base: -6.32 }]],
      [15, facing],
    ]),
  }
  return pickRemainder(input).band
}

describe('the wedge under a pinching base, where the facing test has bottomed out', () => {
  it('TD1 — the nearest test on the section holds the wedge, not a test 33 m away', () => {
    // The scene must be the one he is looking at: the dense sand's own shape has
    // already left this ground, which is why the guard fires on it at all.
    expect(claims(ONLAP, SAMPLE.x, SAMPLE.y), 'the wedge is outside the onlap itself').toBe(false)
    expect(ask(FACING_STOPS_AT_ITS_TD)).toBe(S8_D)
  })

  it('TD2 — where the facing test DID measure this ground, nothing changes', () => {
    // The near-miss. The whole reason the near test may hold its own levels
    // across is that nobody over there can disagree; the moment the facing test
    // has a reading at these levels the ordinary rule stands and the band that
    // pinched away from this ground does not take it back.
    expect(ask(FACING_READS_THE_WEDGE)).not.toBe(S8_D)
  })

  it('TD3 — the very dense sand may never stand below the base he tied it on', () => {
    // Take away S8's own dense sand and the decision falls all the way to the
    // last resort, where the walls are dropped. Even there, GEO-23/125-S9's very
    // dense sand is on the far side of the tie drawn on its own base: he tied
    // that base to S8's very-dense base, and this ground lies under it.
    expect(
      tieElevAt(TIE_BACK, SAMPLE.x) > SAMPLE.y,
      'the scene must put the wedge BELOW his tie',
    ).toBe(true)
    expect(ask(FACING_STOPS_AT_ITS_TD, [S9_VD, S8_VD, S10_VD])).toBeNull()
  })

  it('TD4 — the last resort drops the walls, never a candidate own tied contact', () => {
    // The structural half of TD3. The rung that answers once everything else
    // has declined asks for the ``own-contacts`` scope, and that scope IS the
    // candidate's own boundaries — for GEO-23/125-S9's very dense sand, the tie
    // he drew on its base and nothing else. A rung names a scope, so putting
    // that band back across its own tie would take a new scope meaning "no
    // walls at all", and there is none: every scope answers with lines.
    const source = { drawnTies: [TIE_TD], ownContactTies: OWN_CONTACT_TIES }
    expect(wallsFor('own-contacts', S9_VD, source).map((w) => w.tie)).toEqual([TIE_BACK])
    const scopes: WallScope[] = ['drawn', 'own-contacts']
    for (const scope of scopes) {
      expect(wallsFor(scope, S9_VD, source), `scope ${scope} asked for no walls`).not.toEqual([])
    }
  })
})
