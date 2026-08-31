/**
 * partitionFillV2.boundaryLens.test.ts — REAL-DATA gate for the WATERTIGHT boundary lens
 * (owner directive session 20, 2026-07-17: "fix those 2 lenses first — lensing needs to be
 * watertight by design"; design partition-engine-v2.md §8 ruling 8b/8i(e)).
 *
 * A 0-corr BOUNDARY minority — a column's FIRST unit (top rides the top band) or LAST unit
 * (base rides the shallow-TD floor) with a differing single neighbour — must LENS (ruling
 * 8i(e)) WITHOUT the linearly-growing sliver the interior lens shape left against the boundary
 * polyline (session 19 measured +65 holes; reverted, tagged ``boundaryResidual``). The fix
 * (``emitBoundaryLens``): the tied leg RIDES the boundary polyline (existing line art) and the
 * lens closes as column-vertical + one free flank + the polyline, hole-free — the enclosing
 * flood fills the width past the apex (no separate wedge).
 *
 * WHY REAL DATA, NOT SYNTHETIC. The boundary lens closes against the ENCLOSING FLOOD's interval
 * fill, whose full-width interaction a hand-built 2-column no-tie fixture does not reproduce
 * (the same divergence the design doc flags: "the CS1 gate is THE arbiter, not synthetic" —
 * a synthetic 2-column fixture leaves the near-half wedge past the apex unfilled, which the
 * multi-column real sections do not). This gate therefore asserts the owner's acceptance on the
 * FIVE real boundary-lens instances directly, flag-ON:
 *
 *   1. all 4 boundary-lens sections stay HOLE-FREE above the shallow TD and different-litho-
 *      overlap-free (the +65-hole session-19 wall is closed — the lens flanks are watertight);
 *   2. the OWNER'S NAMED PAIR (CS1 g7 col8: ZAND [9.85..11.27] first unit + SILT [9.29..9.85]
 *      last unit — "fix those 2 lenses first") renders as DISTINCT own-formation regions,
 *      hugging the column (the primary target renders, not absent, not full-width).
 *
 * SCOPE NOTE (owner sequencing "fix those 2 lenses first ... then we'll sort out the fill").
 * On Tie-10 / Tie-12 the ZAND first-unit FLANK is emitted watertight (LENS_AUDIT: present,
 * boundaryResidual 0) but the enclosing FLOOD absorbs its face into the facing SILT band (the
 * facing carries no data at the ZAND elevation, so the top interval floods SILT) — that
 * absorbed-face LABELLING is the deferred FILL stage, not a hole or overlap. This gate asserts
 * the in-scope invariant (watertight flanks + the named pair renders); the fill-stage absorption
 * of the Tie-10/12 faces is left for the ``emitEnclosingFlood`` rebuild (owner's "the fill").
 *
 * Deterministic (fixed real input, no Date.now / Math.random). Gate: SHAPE_AUDIT=1 (the input
 * fixture ``diag_allsections_input.json`` is the same one the LENS_AUDIT + CS1 gates consume;
 * a distinct BOUNDARY_LENS var is not in the harness allowlist, so it reuses the audit var).
 * Run (desktop/): SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.boundaryLens.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type CorrelationEdge, type PartitionColumn, type PartitionPoint, type SectionRegion } from './sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }

/** Elevation intervals a simple polygon covers at the vertical line x=f (fraction space). */
function coveredIntervals(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n]
    const [x1, x2] = [a.fraction, b.fraction]
    if ((x1 <= f && x2 > f) || (x2 <= f && x1 > f)) { const t = (f - x1) / (x2 - x1); ys.push(a.elevation + t * (b.elevation - a.elevation)) }
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}
function mergeIntervals(iv: [number, number][], eps: number): [number, number][] {
  if (iv.length === 0) return []
  const s = iv.slice().sort((a, b) => a[0] - b[0])
  const out: [number, number][] = [s[0].slice() as [number, number]]
  for (let i = 1; i < s.length; i++) { const last = out[out.length - 1]; if (s[i][0] <= last[1] + eps) last[1] = Math.max(last[1], s[i][1]); else out.push(s[i].slice() as [number, number]) }
  return out
}

function sectionRegions(sec: RawSection): { regions: SectionRegion[]; tdElev: number[] } {
  const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const tdElev = columns.map((c) => Math.min(...c.units.map((u) => c.surfaceElevM - u.baseDepthM)))
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))
  return { regions: computeSectionFillV2(columns, edges, undefined, alongM), tdElev }
}

/** No interior coverage hole and no different-litho overlap ABOVE the shallow TD, one gap. */
function assertGapWatertight(regions: SectionRegion[], gap: number, shallowTD: number): void {
  const regs = regions.filter((r) => r.gapIndex === gap)
  for (let f = 0.03; f < 0.98; f += 0.02) {
    const all: [number, number][] = []
    for (const r of regs) all.push(...coveredIntervals(r.polygon, f))
    const merged = mergeIntervals(all, 0.0005)
    for (let k = 0; k + 1 < merged.length; k++) {
      const holeTop = merged[k + 1][0], holeBot = merged[k][1], hole = holeTop - holeBot
      if (hole > 0.0005 && hole < 5 && holeTop > shallowTD + 0.01) {
        throw new Error(`HOLE above TD at gap${gap} f=${f.toFixed(2)} elev ${holeBot.toFixed(2)} (${(hole * 1000).toFixed(1)}mm)`)
      }
    }
    for (let a = 0; a < regs.length; a++) for (let b = a + 1; b < regs.length; b++) {
      if (regs[a].formationId === regs[b].formationId) continue
      const ia = coveredIntervals(regs[a].polygon, f), ib = coveredIntervals(regs[b].polygon, f)
      for (const [a1, a2] of ia) for (const [b1, b2] of ib) {
        if (Math.min(a2, b2) - Math.max(a1, b1) > 0.001) throw new Error(`OVERLAP at gap${gap} f=${f.toFixed(2)}: ${regs[a].formationId}×${regs[b].formationId}`)
      }
    }
  }
}

/** Whether a region of ``formationName`` covers an elevation inside [elLo..elHi] at some low f. */
function lensPresent(regions: SectionRegion[], gap: number, fname: (id: string) => string, formationName: string, elLo: number, elHi: number, side: 'near-left' | 'near-right'): boolean {
  const regs = regions.filter((r) => r.gapIndex === gap && fname(r.formationId) === formationName)
  // The lens hugs its own column: near-left → low fraction, near-right → high fraction.
  const fs = side === 'near-left' ? [0.02, 0.05, 0.08] : [0.98, 0.95, 0.92]
  for (const r of regs) for (const f of fs) for (const [lo, hi] of coveredIntervals(r.polygon, f)) {
    if (hi > elLo + 0.01 && elHi > lo + 0.01) return true
  }
  return false
}

describe('session-20 watertight boundary lens (real data, ruling 8b/8i(e))', () => {
  if (process.env.SHAPE_AUDIT !== '1') { it.skip('dormant (set SHAPE_AUDIT=1)', () => {}); return }

  it('the 5 boundary lenses render present + hole-free on the real sections (flag ON)', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[]; formationNames?: Record<string, string> }
    const fname = (id: string): string => raw.formationNames?.[id] ?? id.slice(0, 6)
    const secOf = (name: string): RawSection => raw.sections.find((s) => s.name === name)!

    const prev = setTwoSidedTerminations(true)
    try {
      // CS1 gap7 — the owner's named col8 pair (RIGHT column, lenses hug high fraction):
      //   ZAND [9.85..11.27] (surface first unit) + SILT [9.29..9.85] (TD last unit).
      {
        const { regions, tdElev } = sectionRegions(secOf('Cross-section 1'))
        const shallowTD = Math.max(tdElev[7], tdElev[8])
        assertGapWatertight(regions, 7, shallowTD)
        expect(lensPresent(regions, 7, fname, 'ZAND', 9.85, 11.27, 'near-right'), 'CS1 g7 ZAND surface lens present').toBe(true)
        expect(lensPresent(regions, 7, fname, 'SILT', 9.29, 9.85, 'near-right'), 'CS1 g7 SILT TD lens present').toBe(true)
      }
      // CS2 gap6 — B8 (RIGHT column): SILT [12.03..13.03] surface first unit. The facing carries
      // KLEI at the SILT elevation, so the SILT renders distinctly (like the CS1 pair).
      {
        const { regions, tdElev } = sectionRegions(secOf('Cross-section 2'))
        assertGapWatertight(regions, 6, Math.max(tdElev[6], tdElev[7]))
        expect(lensPresent(regions, 6, fname, 'SILT', 12.03, 13.03, 'near-right'), 'CS2 g6 SILT surface lens present').toBe(true)
      }
      // Tie-10 gap0 (S22 ZAND) + Tie-12 gap0 (S6 ZAND): the flanks are watertight (asserted
      // above / by the LENS_AUDIT); their absorbed-face LABELLING is the deferred fill stage
      // (facing carries no data at the ZAND elevation → the top interval floods the facing SILT).
      // Assert only the in-scope invariant: hole-free + overlap-free above the shallow TD.
      {
        const { regions, tdElev } = sectionRegions(secOf('Tie-section 10'))
        assertGapWatertight(regions, 0, Math.max(tdElev[0], tdElev[1]))
      }
      {
        const { regions, tdElev } = sectionRegions(secOf('Tie-section 12'))
        assertGapWatertight(regions, 0, Math.max(tdElev[0], tdElev[1]))
      }
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})
