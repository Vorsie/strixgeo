/**
 * bottomTieRenderHole.test.ts — the owner's installer #25 ruling (2026-09-08):
 * *"somehow you introduced a gap in the render, it happens for bottom test correlations."*
 *
 * A BOTTOM-TEST correlation (a base/mixed tie into a shallow test's TD) makes a deep unit's band or
 * onlap fill the sub-TD wedge. Ruling 5's cross-lithology seam (installer #25, `dfa9ad8ec`) wrongly
 * fired on such a MIXED base<->top tie too, splitting the onlap with a mid-gap fence and opening a
 * coverage HOLE below the correlation band (dev Cross-section 1 gap 18 GEO-23/125-S7 -> S6, gap 19
 * S6 -> S5A; owner worked-example Cross-section 2 / Tie-section 4 at the deepest bottom tie).
 *
 * This scan asserts the owner's rule: NO gap in the render under a bottom test correlation. It is a
 * PERMANENT gate over EVERY gap of EVERY section of both real fixtures (the dev project decode + the
 * owner worked example). A "defect hole" is an interior coverage gap CAPPED ABOVE by a near-full-width
 * band (fracSpan >= 0.9) — i.e. a hole sitting directly under a correlation band. That deliberately
 * does NOT flag the intended-EMPTY wedge above a hand-tied first-unit top against a short borehole
 * (ruling 5 part 3, owner-approved) — that wedge is bounded above only by narrow floating lenses, not
 * by a full-width band, so the render is honest there. See ``docs/design/section-fill.md``.
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
 * The worst interior coverage hole in one gap that is CAPPED ABOVE by a near-full-width band — a hole
 * sitting directly under a correlation band (the "gap under a bottom test correlation" the owner
 * reported). Interior holes bounded above only by narrow floating lenses (the intended-empty wedge
 * above a first-unit-top tie) are excluded.
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
      // Capped above by a near-full-width band: a region spanning >= 90% of the gap whose base sits
      // on the top of the hole. That is a correlation band with an uncovered slot beneath it.
      const cappedByBand = regs.some(
        (r) => fracSpan(r) >= 0.9 && crossAt(r.polygon, f).some(([lo]) => Math.abs(lo - holeTop) < 0.02),
      )
      if (cappedByBand) worst = { frac: f, gap: g, lo: merged[k][1], hi: merged[k + 1][0] }
    }
  }
  return worst
}

// A few mm above the 1 mm arrangement snap grid; the smallest real defect measured was 38 mm.
const HOLE_TOL_M = 0.01

// The flag-ON product path is what the app renders (mirrors the conformance gate).
beforeAll(() => setTwoSidedTerminations(true))
afterAll(() => setTwoSidedTerminations(false))

describe("no gap in the render under a bottom test correlation (owner 2026-09-08)", () => {
  for (const file of ['dev_project_sections.json', 'owner_worked_example_sections.json']) {
    const fx = load(file)
    for (const sec of fx.sections) {
      const { columns, alongM, names, edges } = prepare(sec)
      if (columns.length < 2) continue
      it(`${file} / ${sec.name}: every gap is hole-free under its correlation bands`, () => {
        const regions = computeSectionFillV2(columns, edges, undefined, alongM)
        for (let g = 0; g + 1 < columns.length; g++) {
          const w = worstBandCappedHole(regions.filter((r) => r.gapIndex === g))
          expect(
            w.gap,
            `${sec.name} gap ${g} (${names[g]} -> ${names[g + 1]}): hole ${w.gap.toFixed(3)}m under a correlation band at f=${w.frac.toFixed(2)}, elev [${w.lo.toFixed(2)}..${w.hi.toFixed(2)}]`,
          ).toBeLessThan(HOLE_TOL_M)
        }
      })
    }
  }

  it("dev Cross-section 1: the bottom-tie sub-TD wedge under GEO-23/125-S7 -> S6 is filled (no dark rectangle)", () => {
    // The owner's screenshot: a dark uncovered rectangle just under S7's bottom clay, bounded by the
    // dashed blue bottom tie. S7 (TD +4.23) ties its deepest clay base to S6's ZAND top (a bottom
    // tie); the sub-TD wedge below that tie must be filled, not left as a hole.
    const sec = load('dev_project_sections.json').sections.find((s) => s.name === 'Cross-section 1')!
    const { columns, alongM, edges } = prepare(sec)
    const regions = computeSectionFillV2(columns, edges, undefined, alongM)
    const w = worstBandCappedHole(regions.filter((r) => r.gapIndex === 18))
    expect(w.gap, `S7->S6 sub-TD wedge hole ${w.gap.toFixed(3)}m`).toBeLessThan(HOLE_TOL_M)
  })
})
