// The geotech axis draws the litho frame as dark outlines. Owner dogfeed
// 2026-08-18: "i see these weird ass horizontal black lines without meaning
// to the user" / "weird diagonal line" — every internal seam between two
// touching SAME-SOIL litho units (horizontal splits, onlap diagonals,
// termination fans) painted as a near-black line that reads like a litho
// contact. The rule: an outline edge draws only where the SOIL changes or
// at the frame's outer envelope — same-soil internal seams dissolve.
import { describe, expect, it } from 'vitest'

import { lithoOutlineEdges } from './lithoOutlineEdges'
import type { SectionRegion } from './partitionFill'

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
    const segs = lithoOutlineEdges([upper, lower], SOILS)
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
    const segs = lithoOutlineEdges([band], SOILS)
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
    const segs = lithoOutlineEdges([sand, clay], SOILS)
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
    )
    expect(hasSegment(sameSoil, seg([0.4, 6], [0.6, 6]))).toBe(false)
    expect(hasSegment(sameSoil, seg([0.4, 6], [0.5, 7]))).toBe(false)

    const foreign = lithoOutlineEdges(
      [region('sand-a', hostRing), region('lens-clay', lensRing, 'lens')],
      SOILS,
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
    const segs = lithoOutlineEdges([region('lens-clay', lensRing, 'lens')], SOILS)
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
    const segs = lithoOutlineEdges([a, b], SOILS)
    // Identical coordinates, different gaps: neither cancels the other, so
    // each gap keeps its own edges. TWO apiece, not four — the two vertical
    // ones lie on the column lines, which stopped being contacts (2026-08-22).
    // The invariant under test is the non-cancellation, and it holds.
    expect(segs.filter((s) => s.gapIndex === 0).length).toBe(2)
    expect(segs.filter((s) => s.gapIndex === 1).length).toBe(2)
    expect(hasSegment(segs, seg([0, 5], [1, 5]))).toBe(true)
  })
})
