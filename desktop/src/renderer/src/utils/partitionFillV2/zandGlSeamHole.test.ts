/**
 * zandGlSeamHole.test.ts — the owner's installer #42 dogfeed (2026-09-16):
 * *"i'm seeing a gap in the pdf export."*
 *
 * On Cross-section 1 (profiel A-A') of the worked example a thin WHITE horizontal sliver appeared
 * at about -4.8 m TAW between GEO-02/145-S13 and S14, exactly where the plain ZAND unit above meets
 * the ZAND (GL:|KL:) unit below — the glauconitic/clayey sand, its own litho formation welded into
 * ONE body mass with the plain sand (one-mass-one-body). It was in the litho-axis 2-D fill (the PDF
 * renders the same partition), NOT a PDF artefact.
 *
 * Mechanism: S13's ZAND (GL:|KL:) TOP is tied to S14's plain-ZAND BASE (a MIXED base<->top tie) and
 * S14's plain-ZAND base IS S14's TD — so the tie is a BOTTOM tie into the shallow test's TD. The
 * deep GL unit's ``bottomTieToTd`` onlap (``drawTermination``, reach 1.0) already fills the whole
 * sub-band interval; but ``emitEnclosingFlood.closeInterval`` also saw that same tie land on both
 * enclosing masses (GL on S13, plain ZAND on S14) and drew a ``declared`` mid-gap FENCE at
 * ``INTERIOR_PINCH_FRACTION``, fencing the onlap at 0.5 and handing the far half back white. That is
 * the exact coverage-hole class ruling 5's TOP-to-TOP restriction cured for the cross-litho seam —
 * here on the honest-meeting path. The fix: a mixed base<->top tie into the shallow TD never
 * justifies the ``declared`` seam.
 *
 * The scan is a PERMANENT gate over EVERY gap of EVERY section of the owner's 2026-09-16 worked
 * example (his ``worked_example_0916.strix``, extracted with ``scratchpad/build_owner_fixture.cjs``).
 * A "defect hole" is an interior coverage gap CAPPED ABOVE by a near-full-width band (fracSpan >=
 * 0.9) — a hole sitting directly under a correlation band. See ``docs/design/section-fill.md``.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../sectionPartition'
import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; name?: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }
type Fixture = { sections: RawSection[]; formationNames: Record<string, string> }

function load(file: string): Fixture {
  return JSON.parse(readFileSync(resolve(HERE, '__fixtures__', file), 'utf8')) as Fixture
}

/** Keep only tests with an elevation and litho, carrying the surviving alongM (mirrors the engine). */
function prepare(sec: RawSection): { columns: PartitionColumn[]; alongM: number[]; names: string[]; edges: CorrelationEdge[] } {
  const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const names = keep.map(({ c }) => c.name ?? c.investigationId.slice(0, 8))
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))
  return { columns, alongM, names, edges }
}

/** Elevation intervals a vertical scan-line at ``frac`` crosses inside one region polygon. */
function crossAt(poly: { fraction: number; elevation: number }[], frac: number): [number, number][] {
  const ys: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    if (a.fraction === b.fraction) continue
    const lo = Math.min(a.fraction, b.fraction), hi = Math.max(a.fraction, b.fraction)
    if (frac < lo || frac > hi) continue
    const t = (frac - a.fraction) / (b.fraction - a.fraction)
    ys.push(a.elevation + t * (b.elevation - a.elevation))
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]])
  return out
}

const fracSpan = (r: SectionRegion): number => {
  const fs = r.polygon.map((p) => p.fraction)
  return Math.max(...fs) - Math.min(...fs)
}

/**
 * The worst interior coverage hole in one gap that is CAPPED ABOVE by a near-full-width band — a
 * hole sitting directly under a correlation band (the "gap in the pdf export" the owner reported).
 * Interior holes bounded above only by narrow floating lenses (an intended-empty wedge above a
 * first-unit-top tie) are excluded — identical predicate to ``bottomTieRenderHole.test.ts``.
 */
function worstBandCappedHole(regs: readonly SectionRegion[]): { frac: number; gap: number; lo: number; hi: number } {
  let worst = { frac: -1, gap: 0, lo: 0, hi: 0 }
  for (let f = 0.03; f < 0.98; f += 0.01) {
    const ivs: [number, number][] = []
    for (const r of regs) ivs.push(...crossAt(r.polygon, f))
    if (ivs.length === 0) continue
    ivs.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const iv of ivs) {
      const last = merged[merged.length - 1]
      if (last && iv[0] <= last[1] + 5e-3) last[1] = Math.max(last[1], iv[1])
      else merged.push([...iv])
    }
    for (let k = 0; k + 1 < merged.length; k++) {
      const g = merged[k + 1][0] - merged[k][1]
      if (g <= worst.gap) continue
      const holeTop = merged[k + 1][0]
      const cappedByBand = regs.some(
        (r) => fracSpan(r) >= 0.9 && crossAt(r.polygon, f).some(([lo]) => Math.abs(lo - holeTop) < 0.02),
      )
      if (cappedByBand) worst = { frac: f, gap: g, lo: merged[k][1], hi: merged[k + 1][0] }
    }
  }
  return worst
}

// A few mm above the 1 mm arrangement snap grid; the sliver the owner circled measured ~76 mm.
const HOLE_TOL_M = 0.01
const FIXTURE = 'owner_we_2026-09-16_sections.json'

// The flag-ON product path is what the app renders (mirrors the conformance gate).
beforeAll(() => setTwoSidedTerminations(true))
afterAll(() => setTwoSidedTerminations(false))

describe('the plain sand and the glauconitic sand below it leave no gap between S13 and S14 (owner 2026-09-16)', () => {
  it('Cross-section 1: no band-capped hole in the S13 -> S14 gap (the ~-4.8 m sliver is filled)', () => {
    const fx = load(FIXTURE)
    const sec = fx.sections.find((s) => s.name === 'Cross-section 1')!
    const { columns, alongM, names, edges } = prepare(sec)
    const s13 = names.indexOf('GEO-02/145-S13')
    const s14 = names.indexOf('GEO-02/145-S14')
    // S13 and S14 are adjacent once the empty GEO-67/441 columns between them are dropped.
    expect(s14 - s13, `S13 (idx ${s13}) and S14 (idx ${s14}) must be adjacent after empties drop`).toBe(1)
    const regions = computeSectionFillV2(columns, edges, undefined, alongM)
    const w = worstBandCappedHole(regions.filter((r) => r.gapIndex === s13))
    expect(
      w.gap,
      `S13 -> S14 band-capped hole ${w.gap.toFixed(3)}m at f=${w.frac.toFixed(2)}, elev [${w.lo.toFixed(2)}..${w.hi.toFixed(2)}]`,
    ).toBeLessThan(HOLE_TOL_M)
  })

  it('every gap of every section of the 2026-09-16 worked example is hole-free under its correlation bands', () => {
    const fx = load(FIXTURE)
    for (const sec of fx.sections) {
      const { columns, alongM, names, edges } = prepare(sec)
      if (columns.length < 2) continue
      const regions = computeSectionFillV2(columns, edges, undefined, alongM)
      for (let g = 0; g + 1 < columns.length; g++) {
        const w = worstBandCappedHole(regions.filter((r) => r.gapIndex === g))
        expect(
          w.gap,
          `${sec.name} gap ${g} (${names[g]} -> ${names[g + 1]}): hole ${w.gap.toFixed(3)}m under a band at f=${w.frac.toFixed(2)}, elev [${w.lo.toFixed(2)}..${w.hi.toFixed(2)}]`,
        ).toBeLessThan(HOLE_TOL_M)
      }
    }
  })
})
