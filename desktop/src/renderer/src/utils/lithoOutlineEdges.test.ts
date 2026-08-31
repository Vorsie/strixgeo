// The geotech axis draws the litho frame as dark outlines. Owner dogfeed
// 2026-08-18: "i see these weird ass horizontal black lines without meaning
// to the user" / "weird diagonal line" — every internal seam between two
// touching SAME-SOIL litho units (horizontal splits, onlap diagonals,
// termination fans) painted as a near-black line that reads like a litho
// contact. The rule: an outline edge draws only where the SOIL changes or
// at the frame's outer envelope — same-soil internal seams dissolve.
import { describe, expect, it } from 'vitest'

import { lithoOutlineEdges } from './lithoOutlineEdges'
import type { SectionRegion } from './sectionPartition'

const region = (
  formationId: string,
  polygon: { fraction: number; elevation: number }[],
  kind: SectionRegion['kind'] = 'quad',
  gapIndex = 0,
): SectionRegion =>
  ({ gapIndex, kind, formationId, polygon }) as unknown as SectionRegion

const SOILS = new Map<string, string | null>([
  ['sand-a', 'ZAND'],
  ['sand-b', 'ZAND'],
  ['clay-a', 'KLEI'],
  ['lens-sand', 'ZAND'],
  ['lens-clay', 'KLEI'],
])

/**
 * Gap width (m) for the synthetic scenes. The column-line guard is METRIC, so
 * every call has to say how wide its gap is; 100 m is a wide, ordinary gap in
 * which 2 mm is a very small fraction.
 */
const WIDE = (): number => 100

const seg = (a: [number, number], b: [number, number]) => ({ a, b })
const hasSegment = (
  segs: ReturnType<typeof lithoOutlineEdges>,
  want: ReturnType<typeof seg>,
): boolean =>
  segs.some((s) => {
    const pts = [
      [s.a.fraction, s.a.elevation],
      [s.b.fraction, s.b.elevation],
    ]
    const match = (p: number[], q: [number, number]): boolean =>
      Math.abs(p[0] - q[0]) < 1e-9 && Math.abs(p[1] - q[1]) < 1e-9
    return (
      (match(pts[0], want.a) && match(pts[1], want.b)) ||
      (match(pts[0], want.b) && match(pts[1], want.a))
    )
  })

describe('lithoOutlineEdges — soil-level dissolve of the litho outline pass', () => {
  it('a seam shared by two same-soil units dissolves; the outer envelope stays', () => {
    const upper = region('sand-a', [
      { fraction: 0, elevation: 5 },
      { fraction: 1, elevation: 5 },
      { fraction: 1, elevation: 10 },
      { fraction: 0, elevation: 10 },
    ])
    const lower = region('sand-b', [
      { fraction: 0, elevation: 0 },
      { fraction: 1, elevation: 0 },
      { fraction: 1, elevation: 5 },
      { fraction: 0, elevation: 5 },
    ])
    const segs = lithoOutlineEdges([upper, lower], SOILS, WIDE)
    expect(hasSegment(segs, seg([0, 5], [1, 5]))).toBe(false)
    expect(hasSegment(segs, seg([0, 10], [1, 10]))).toBe(true)
    expect(hasSegment(segs, seg([0, 0], [1, 0]))).toBe(true)
  })

  it('a column line is never an outline — the unit continues onto the card', () => {
    // Owner, 2026-08-22, on gap 0: "there is a black line between the SF silt
    // on column 0 and the quad to the right of it". A region's edge AT the
    // column has only one owner — the neighbouring gap is keyed separately and
    // the test's own card is not in this pass — so it read as outer envelope
    // and drew. But a column is not a contact: the same unit continues onto
    // the card, which draws itself.
    const band = region('sand-a', [
      { fraction: 0, elevation: 0 },
      { fraction: 1, elevation: 0 },
      { fraction: 1, elevation: 10 },
      { fraction: 0, elevation: 10 },
    ])
    const segs = lithoOutlineEdges([band], SOILS, WIDE)
    expect(hasSegment(segs, seg([0, 0], [0, 10]))).toBe(false)
    expect(hasSegment(segs, seg([1, 0], [1, 10]))).toBe(false)
    // The real envelope — top and bottom — is untouched.
    expect(hasSegment(segs, seg([0, 10], [1, 10]))).toBe(true)
    expect(hasSegment(segs, seg([0, 0], [1, 0]))).toBe(true)
  })

  it('a seam where the soil changes draws exactly once', () => {
    const sand = region('sand-a', [
      { fraction: 0, elevation: 5 },
      { fraction: 1, elevation: 5 },
      { fraction: 1, elevation: 10 },
      { fraction: 0, elevation: 10 },
    ])
    const clay = region('clay-a', [
      { fraction: 0, elevation: 0 },
      { fraction: 1, elevation: 0 },
      { fraction: 1, elevation: 5 },
      { fraction: 0, elevation: 5 },
    ])
    const segs = lithoOutlineEdges([sand, clay], SOILS, WIDE)
    const contact = segs.filter((s) => hasSegment([s], seg([0, 5], [1, 5])))
    expect(contact.length).toBe(1)
  })

  it('a same-soil lens dissolves into its mass; a foreign-soil lens keeps its boundary', () => {
    const hostRing = [
      { fraction: 0, elevation: 0 },
      { fraction: 1, elevation: 0 },
      { fraction: 1, elevation: 10 },
      { fraction: 0.6, elevation: 10 },
      // keyhole down around the lens and back — the enclosing ring carries
      // the lens edges verbatim, exactly as the v2 keyholed annulus does.
      { fraction: 0.6, elevation: 6 },
      { fraction: 0.4, elevation: 6 },
      { fraction: 0.5, elevation: 7 },
      { fraction: 0.6, elevation: 6 },
      { fraction: 0.6, elevation: 10 },
      { fraction: 0, elevation: 10 },
    ]
    const lensRing = [
      { fraction: 0.4, elevation: 6 },
      { fraction: 0.6, elevation: 6 },
      { fraction: 0.5, elevation: 7 },
    ]
    const sameSoil = lithoOutlineEdges(
      [region('sand-a', hostRing), region('lens-sand', lensRing, 'lens')],
      SOILS,
      WIDE,
    )
    expect(hasSegment(sameSoil, seg([0.4, 6], [0.6, 6]))).toBe(false)
    expect(hasSegment(sameSoil, seg([0.4, 6], [0.5, 7]))).toBe(false)

    const foreign = lithoOutlineEdges(
      [region('sand-a', hostRing), region('lens-clay', lensRing, 'lens')],
      SOILS,
      WIDE,
    )
    expect(hasSegment(foreign, seg([0.4, 6], [0.6, 6]))).toBe(true)
    expect(hasSegment(foreign, seg([0.4, 6], [0.5, 7]))).toBe(true)
  })

  it('a lens-only edge never draws by itself', () => {
    const lensRing = [
      { fraction: 0.4, elevation: 6 },
      { fraction: 0.6, elevation: 6 },
      { fraction: 0.5, elevation: 7 },
    ]
    const segs = lithoOutlineEdges([region('lens-clay', lensRing, 'lens')], SOILS, WIDE)
    expect(segs.length).toBe(0)
  })

  it('gaps never dissolve against each other', () => {
    const a = region('sand-a', [
      { fraction: 0, elevation: 0 },
      { fraction: 1, elevation: 0 },
      { fraction: 1, elevation: 5 },
      { fraction: 0, elevation: 5 },
    ])
    const b = region('sand-b', [
      { fraction: 0, elevation: 0 },
      { fraction: 1, elevation: 0 },
      { fraction: 1, elevation: 5 },
      { fraction: 0, elevation: 5 },
    ], 'quad', 1)
    const segs = lithoOutlineEdges([a, b], SOILS, WIDE)
    // Identical coordinates, different gaps: neither cancels the other, so
    // each gap keeps its own edges. TWO apiece, not four — the two vertical
    // ones lie on the column lines, which stopped being contacts (2026-08-22).
    // The invariant under test is the non-cancellation, and it holds.
    expect(segs.filter((s) => s.gapIndex === 0).length).toBe(2)
    expect(segs.filter((s) => s.gapIndex === 1).length).toBe(2)
    expect(hasSegment(segs, seg([0, 5], [1, 5]))).toBe(true)
  })
})

describe('a column line is not a contact — snapped, not exact', () => {
  // Owner dogfeed 2026-08-22: *"when i turn on the fill there is a black
  // vertical line top to bottom on the left of every column"*. The
  // column-line guard existed but tested for EXACTLY 0 or 1 (< 1e-9); the
  // v2 engine's own snap leaves a gap's column edges a hair inside it, so
  // every one of those verticals sailed past the guard and drew.
  //
  // MEASURED on the owner's real model, all 14 sections: 465 vertical
  // outline segments, 464 of them at a column edge with a worst offset of
  // 1.228e-3, and the ONE genuine interior vertical at fraction 0.5000 —
  // the law's own mid-gap seam. Four hundred times' separation.
  const ringAt = (f0: number, f1: number) => [
    { fraction: f0, elevation: 0 },
    { fraction: f1, elevation: 0 },
    { fraction: f1, elevation: 5 },
    { fraction: f0, elevation: 5 },
  ]

  it('LO-SNAP1 — a vertical at the REAL snapped column offsets does not draw', () => {
    // 4.9e-5 and 8.9e-5 of a 10 m gap are 0.49 mm and 0.89 mm — both inside
    // the 2 mm metric tolerance.
    const segs = lithoOutlineEdges([region('sand-a', ringAt(0.000049, 0.999911))], SOILS, () => 10)
    const verticals = segs.filter((s) => Math.abs(s.a.fraction - s.b.fraction) < 1e-9)
    expect(verticals, 'the snapped column edges are still column edges').toEqual([])
  })

  it('LO-SNAP2 — the worst offset measured on the real model (1.228e-3) still does not draw', () => {
    // That fraction is 0.5 mm on the 0.407 m gap it was measured on — the same
    // half-snap-cell error, just expressed in a much narrower gap's fractions.
    const segs = lithoOutlineEdges([region('sand-a', ringAt(0.001228, 0.998772))], SOILS, () => 0.407)
    const verticals = segs.filter((s) => Math.abs(s.a.fraction - s.b.fraction) < 1e-9)
    expect(verticals).toEqual([])
  })

  it('LO-SNAP3 — the law\u2019s own mid-gap vertical seam STILL draws (negative control)', () => {
    // Two different soils meeting at the middle: the vertical between them is
    // a real statement and must survive.
    const left = region('sand-a', ringAt(0, 0.5))
    const right = region('clay-a', ringAt(0.5, 1))
    const segs = lithoOutlineEdges([left, right], SOILS, WIDE)
    const midVerticals = segs.filter(
      (s) => Math.abs(s.a.fraction - s.b.fraction) < 1e-9 && Math.abs(s.a.fraction - 0.5) < 1e-9,
    )
    expect(midVerticals.length, 'the mid-gap seam is a real contact').toBeGreaterThan(0)
  })

  it('LO-SNAP4 — a PAIRED STATION gap (42 mm) still suppresses its column verticals', () => {
    // Audit finding, 2026-08-23. partitionFillV2/columnSeparation forces a CPT
    // and a borehole drilled at ONE station apart to MIN_COLUMN_SEPARATION_M
    // (20 mm); the dev model has a 42 mm pair on Tie-section 8. The snap error
    // is a fixed 0.5 mm, so in a 42 mm gap it is 0.012 of the width — PAST the
    // old flat 0.01 fraction guard, which therefore drew the column verticals
    // again and put back the very black line it was written to remove.
    //
    // A metric tolerance does not care how narrow the gap is.
    const offset = 0.0005 / 0.042 // 0.5 mm of a 42 mm gap ≈ 0.0119
    const segs = lithoOutlineEdges(
      [region('sand-a', ringAt(offset, 1 - offset))],
      SOILS,
      () => 0.042,
    )
    const verticals = segs.filter((s) => Math.abs(s.a.fraction - s.b.fraction) < 1e-9)
    expect(verticals, 'a 42 mm paired-station gap is still a column line').toEqual([])
  })

  it('LO-SNAP5 — a WIDE gap does not let the guard eat a real near-column contact', () => {
    // The mirror failure of the same bug: a flat 0.01 fraction was 1.5 m of
    // ground on a 150 m gap. Metric, 0.01 of that gap is 1.5 m — far outside
    // the 2 mm tolerance — so a genuine vertical contact there still draws.
    const left = region('sand-a', ringAt(0, 0.01))
    const right = region('clay-a', ringAt(0.01, 1))
    const segs = lithoOutlineEdges([left, right], SOILS, () => 150)
    const atContact = segs.filter(
      (s) => Math.abs(s.a.fraction - s.b.fraction) < 1e-9 && Math.abs(s.a.fraction - 0.01) < 1e-9,
    )
    expect(atContact.length, 'a soil change 1.5 m from the column is a real contact').toBeGreaterThan(0)
  })
})
