/**
 * partitionFillV2.faceLabel8n.test.ts — the owner-pinned ruling-8n FACE-LABELLING gate (CS1 gap1,
 * x=96.96). Real-data, flag-ON.
 *
 * RULING 8n (owner-confirmed verbatim, "yeah just stay inside the lines"): a face's litho comes
 * from the LINE ART, never from an elevation-blind flood sample. A face PAST an onlap apex is the
 * unit being ONLAPPED INTO (the facing unit the follow-the-tie 8m check identifies), and a BAND's
 * litho may NEVER claim a face on the far side of its own band boundary line.
 *
 * THE OWNER FINDING (first FILL dogfeed 2026-07-18, x=96.96, traced in the dump): CS1 gap1
 * (col1 x=96.955 → col2 x=100.137).
 *   col1: SILT [5.39..11.61] / ZAND [4.41..5.39] / KLEI [3.79..4.41] / SILT [2.87..3.79] / ...
 *   col2: SILT [5.023..6.278] / KLEI [3.67..5.023] / ZAND [0.579..3.67] / ...
 *   - The drawn KLEI tie ``4.41↔5.023`` ties col1 KLEI-top (= ZAND-base) to col2 KLEI-top. The
 *     KLEI band ``[3.67..5.023]`` renders full-width ✓.
 *   - col1's top ZAND [4.41..5.39] is base-tied by that KLEI tie → corr 1; following the tie
 *     (base-tied → ABOVE the tie on the facing) the facing is col2 SILT [5.023..6.278] → DIFFERENT
 *     → the ZAND ONLAPS right; the ZAND wedge fills to its apex at f=0.5 ✓.
 *   - The silts (col1 [5.39..11.61] ↔ col2 [5.023..6.278]) are top-tied → the SILT band ✓.
 *   - THE BUG: the wedge PAST the ZAND apex — bounded below by the KLEI tie line (rising 4.41→5.02),
 *     above by the SILT band base (5.39→5.02) — is stamped KLEI (a full-width ``KLEI [4.716..5.39]``
 *     region). But the sand onlaps INTO the SILT, so past the pinch the SILT wraps down onto the KLEI
 *     band's top line. THE FACE MUST BE SILT. KLEI may NEVER claim a face on the far side (above) of
 *     its own band-top/tie line.
 *
 * ROOT: the flood wedge (``emitFloodWedge``, ``floodsw1``) took its label from the facing column at
 * the terminating ZAND's MID-elevation (4.9 → col2 KLEI [3.67..5.023]) instead of the FLOODED
 * (untied) side — for a base-tied onlap the flood fills the TOP side, so the sample must be the
 * facing at the untied TOP contact (5.39 → col2 SILT). This gate pins the acceptance shape and goes
 * RED on the mid-elevation-sample engine.
 *
 * Gate: real-data, flag-ON. Skips cleanly if the diag input is absent.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type PartitionPoint } from './sectionPartition'
import { type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

// Formation ids from the real CS1 extraction (diag_allsections_input.json), owner-traced.
const SILT = '019e940a-4b4e-7806-aa41-5831b60f2e06'
const KLEI = '019e940a-4b50-7f69-af85-2354e519bb43'
// gap18 (x=646.74) formations — VEEN is the thin idx5 lens; ZAND is col19's big [-5.87..7.027]
// unit 78 m away (the phantom "sand adjacency" the s30 facing sample produced).
const VEEN = '019e940a-4b52-7560-bc4d-93ca84512af4'
const ZAND = '019e940a-4b41-7e01-a763-ab030a38d1bc'

// The bug wedge sits between the KLEI tie line (rising 4.41→5.023) and the SILT band base
// (5.39→5.023), PAST the ZAND onlap apex (f≈0.5). Sample a point clearly inside it: near the
// right side (f=0.85), elevation 4.95 — above the KLEI tie there (~4.98? no: tie at f=0.85 is
// 4.41+0.85·(5.023-4.41)=4.93) and below the SILT base there (5.39+0.85·(5.023-5.39)=5.08). Use a
// point robustly inside: f=0.85, e=5.0 (between the tie ~4.93 and the SILT base ~5.08).
const WEDGE_F = 0.85
const WEDGE_E = 5.0

/** Does a simple polygon contain the point (f, e)? Ray-cast in fraction×elevation space. */
function polyContains(poly: readonly PartitionPoint[], f: number, e: number): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].fraction, yi = poly[i].elevation
    const xj = poly[j].fraction, yj = poly[j].elevation
    if ((yi > e) !== (yj > e)) {
      const xCross = xi + ((e - yi) / (yj - yi)) * (xj - xi)
      if (f < xCross) inside = !inside
    }
  }
  return inside
}

/** Elevation intervals a polygon covers along the vertical line at fraction ``f``. */
function coveredIntervals(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const [x1, x2] = [a.fraction, b.fraction]
    if ((x1 <= f && x2 > f) || (x2 <= f && x1 > f)) {
      const t = (f - x1) / (x2 - x1)
      ys.push(a.elevation + t * (b.elevation - a.elevation))
    }
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}

/** Max vertical overlap (metres) between DIFFERENT-formation regions across a gap's fractions. */
function maxDiffLithoOverlap(regs: readonly SectionRegion[]): number {
  let worst = 0
  for (let f = 0.02; f < 0.985; f += 0.02) {
    for (let a = 0; a < regs.length; a++) {
      for (let b = a + 1; b < regs.length; b++) {
        if (regs[a].formationId === regs[b].formationId) continue
        const ia = coveredIntervals(regs[a].polygon, f)
        const ib = coveredIntervals(regs[b].polygon, f)
        for (const [a1, a2] of ia)
          for (const [b1, b2] of ib) {
            const v = Math.min(a2, b2) - Math.max(a1, b1)
            if (v > worst) worst = v
          }
      }
    }
  }
  return worst
}

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }

afterEach(() => setTwoSidedTerminations(false))

describe('CS1 gap1 face labelling (ruling 8n) — the owner-pinned x=96.96 acceptance case', () => {
  const has = existsSync(INPUT)
  ;(has ? describe : describe.skip)('real CS1 gap1', () => {
    let g1: SectionRegion[] = []
    {
      const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
      const sec = raw.sections.find((s) => s.name === 'Cross-section 1')!
      const keep = sec.columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
      const columns: PartitionColumn[] = keep.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: c.units,
      }))
      const alongM = keep.map(({ i }) => sec.alongM[i])
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      const prev = setTwoSidedTerminations(true)
      try {
        g1 = computeSectionFillV2(columns, edges, undefined, alongM).filter((r) => r.gapIndex === 1)
      } finally {
        setTwoSidedTerminations(prev)
      }
    }

    it('(A) the wedge past the ZAND apex is SILT (the facing unit onlapped into, ruling 8n rule 3)', () => {
      const siltCovers = g1.some(
        (r) => r.formationId === SILT && polyContains(r.polygon, WEDGE_F, WEDGE_E),
      )
      expect(siltCovers, 'SILT covers the wedge past the ZAND apex (5.0 @ f=0.85)').toBe(true)
    })

    it('(B) KLEI does NOT claim the wedge above its own band-top/tie line (ruling 8n rule 4)', () => {
      const kleiCovers = g1.some(
        (r) => r.formationId === KLEI && polyContains(r.polygon, WEDGE_F, WEDGE_E),
      )
      expect(kleiCovers, 'KLEI must NOT cross its band top (4.41→5.023 tie) into the wedge above').toBe(false)
    })
  })
})

// RULING 8n(b) (owner, 2026-07-18, x=646.74 — "it should be silt and veen in the lens and there is
// no sand adjacency"), UPDATED for RULING 8s (owner, 2026-07-19, "0.45 stands, matrix detours").
// CS1 gap18 (col18 x=646.737 → col19 x=724.83, 78 m away): col18 carries a thin SILT [6.03..5.46]
// over VEEN [5.46..5.05] minority stack, enclosed by KLEI [6.65..6.03] above and KLEI [5.05..4.23]
// below. Both minorities LENS (corr 0). The wrap past each apex is the enclosing KLEI (ruling 8g —
// the matrix flows around the pinch), NOT col19's big ZAND [-5.87..7.027] at those elevations. The
// phantom "sand lens" (the s30 facing sample painting that far ZAND) is gone.
//
// RULING 8s changed the REACH of these two lenses: the facing-sample cap that hugged them near the
// column is DELETED, so a lens keeps 0.45 unless a gap TIE crosses its diamond. The SILT lens
// (mid 5.745, term25/26) crosses NO tie → it opens to the FULL 0.45 (its interior now runs f=0..0.45
// and the KLEI wrap only begins PAST the 0.45 apex). The VEEN lens (mid 5.255, term27/28) IS crossed
// by tie81:18 (KLEI-base 4.23 → ZAND-top 7.027, passing through the VEEN extent) → it STAYS hugged
// near the column (reach ~0.011), so its KLEI wrap begins almost immediately past f≈0.01. The gate
// therefore samples the SILT wrap PAST the 0.45 apex and the VEEN wrap at a small fraction. It pins:
// (a) NO ZAND in the lens elevation band [5.05..6.03] within the wrap window (no sand adjacency),
// (b) the wrap reads KLEI, (c) the lens interiors read SILT and VEEN. Goes RED on the pre-fix engine.
describe('CS1 gap18 lens enclosing matrix (ruling 8n(b) + 8s) — the owner-pinned x=646.74 acceptance case', () => {
  const has = existsSync(INPUT)
  ;(has ? describe : describe.skip)('real CS1 gap18', () => {
    let g18: SectionRegion[] = []
    {
      const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
      const sec = raw.sections.find((s) => s.name === 'Cross-section 1')!
      const keep = sec.columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
      const columns: PartitionColumn[] = keep.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: c.units,
      }))
      const alongM = keep.map(({ i }) => sec.alongM[i])
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      const prev = setTwoSidedTerminations(true)
      try {
        g18 = computeSectionFillV2(columns, edges, undefined, alongM).filter((r) => r.gapIndex === 18)
      } finally {
        setTwoSidedTerminations(prev)
      }
    }

    // Ruling 8s reach: the SILT lens opens to the full 0.45 (no tie crosses it), so its KLEI wrap
    // begins PAST f=0.45 — sample it at f=0.5 (past the SILT apex, still BELOW the rising ZAND-top
    // tie81:18, which reaches e=5.85 only at f≈0.58). RULING 8t (owner, 2026-07-20, "retire the
    // thickness hug, just halve the length to 0.225"): the VEEN lens is crossed by the tie and now
    // HALVES to f≈0.225 (was the ~0.011 thickness hug), so its KLEI wrap begins PAST f≈0.225 —
    // sample at f=0.3/e=5.25 (past the VEEN apex, ABOVE the rising tie81:18 which reaches e≈5.07 at
    // f=0.3, so the point is in the KLEI matrix above the tie). Both points are cleanly inside the
    // KLEI wrap and clear of col19's ZAND triangle.
    const SILT_WRAP_F = 0.5, SILT_WRAP_E = 5.85
    const VEEN_WRAP_F = 0.3, VEEN_WRAP_E = 5.25

    it('(a) NO ZAND covers the lens elevation band past the apexes (no sand adjacency)', () => {
      const zandInSiltBand = g18.some(
        (r) => r.formationId === ZAND && polyContains(r.polygon, SILT_WRAP_F, SILT_WRAP_E),
      )
      const zandInVeenBand = g18.some(
        (r) => r.formationId === ZAND && polyContains(r.polygon, VEEN_WRAP_F, VEEN_WRAP_E),
      )
      expect(zandInSiltBand, 'the far col19 ZAND must NOT fill the SILT-lens wrap (5.85 @ f=0.5)').toBe(false)
      expect(zandInVeenBand, 'the far col19 ZAND must NOT fill the VEEN-lens wrap (5.25 @ f=0.3, ruling 8t)').toBe(false)
    })

    it('(b) the wrap past both apexes reads KLEI (the enclosing matrix, ruling 8g)', () => {
      const kleiSilt = g18.some(
        (r) => r.formationId === KLEI && polyContains(r.polygon, SILT_WRAP_F, SILT_WRAP_E),
      )
      const kleiVeen = g18.some(
        (r) => r.formationId === KLEI && polyContains(r.polygon, VEEN_WRAP_F, VEEN_WRAP_E),
      )
      expect(kleiSilt, 'KLEI wraps the SILT lens past its 0.45 apex (5.85 @ f=0.5)').toBe(true)
      expect(kleiVeen, 'KLEI wraps the VEEN lens past its 8t-halved apex (5.25 @ f=0.3)').toBe(true)
    })

    it('(c) the lens interiors read SILT and VEEN to their apexes (own litho)', () => {
      // Near col18 (small fraction), inside the lens interior, the region is the unit's own litho.
      const siltInterior = g18.some(
        (r) => r.formationId === SILT && polyContains(r.polygon, 0.004, 5.7),
      )
      const veenInterior = g18.some(
        (r) => r.formationId === VEEN && polyContains(r.polygon, 0.004, 5.2),
      )
      expect(siltInterior, 'the SILT lens interior (near col18) reads SILT').toBe(true)
      expect(veenInterior, 'the VEEN lens interior (near col18) reads VEEN').toBe(true)
    })

    // RULING 8n ("stay inside the lines" — a true partition): exactly ONE region may cover any
    // point. The KLEI lens-wrap wedge (correctly relabelled by s31, ruling 8n(b)) descends past
    // its VEEN-base corner toward the gap midpoint, crossing BELOW the given ZAND-top tie
    // (``tie81:18``: col18 KLEI-base 4.23 ↔ col19 ZAND-top 7.027, rising left→right). Past the
    // crossing (x≈673.6, f≈0.34) the KLEI wrap and the ZAND fill BELOW the tie both claim the
    // sliver between the wrap's base flank and the rising tie — a ZAND(quad)×KLEI(quad) double
    // cover (orchestrator-measured maxVertOverlap 4.9 cm). The wrap must STOP at the tie (the tie
    // is given line art bounding the KLEI-below matrix from beneath; ZAND owns below it).
    it('(d) NO different-litho vertical overlap in gap18 (a true partition, ruling 8n)', () => {
      const worst = maxDiffLithoOverlap(g18)
      expect(worst * 100, `max different-litho vertical overlap in gap18 = ${(worst * 100).toFixed(2)} cm`).toBeLessThan(0.1)
    })
  })
})
