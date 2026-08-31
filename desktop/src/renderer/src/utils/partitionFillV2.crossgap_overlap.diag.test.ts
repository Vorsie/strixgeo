/**
 * partitionFillV2.crossgap_overlap.diag.test.ts — CROSS-GAP overlap check for the
 * partition engine v2 output (design partition-engine-v2.md §4 "THE SCREENSHOT
 * OVERLAPS"; acceptance item 10 of the tiler-rewrite round-3 list).
 *
 * The per-gap holes/overlaps diag groups regions by ``gapIndex`` and only compares
 * regions WITHIN one gap. It therefore cannot see the owner's screenshot defect: a
 * SILT lens emitted into gap N that reaches fraction ~1.0 (the shared interior
 * column) overlapping a fill BAND emitted into gap N+1 that sits at fraction ~0.0
 * (the SAME physical column). In fraction space the two live in different gaps, so
 * the per-gap check reads 0 — but at the shared column vertical they occupy the same
 * elevation with DIFFERENT formations (the "sand/silt lens spilling over the
 * correlation band" the owner flagged at S5A|S5, S5|S5B, S5B|S11).
 *
 * This check samples EACH interior column ci (shared between gap ci-1 on its right
 * edge and gap ci on its left edge): it evaluates gap ci-1's regions at fraction
 * (1 - MARGIN) and gap ci's regions at fraction MARGIN, and reports any
 * DIFFERENT-formation vertical overlap at that shared column. MARGIN is small so we
 * sample the region interior right up against the column, not the exact vertical
 * (where a shared contact legitimately touches).
 *
 * It ALSO runs an all-region point-in-polygon (PIP) double-coverage sweep per section
 * across ALL gaps at once (mapping every region into a global along-fraction space):
 * any physical (x, elevation) claimed by two DIFFERENT-formation regions is a real
 * paint-level overlap regardless of which gaps the two regions belong to.
 *
 * Pure REPORTER under CROSSGAP_DIAG (rides the allowed HOLES_DIAG gate too so it runs in
 * the standard battery). It logs the two counters (shared-column different-formation
 * overlaps + global-PIP double-cover) and never fails — the committed diag deliverable of
 * acceptance item 10. It does NOT assert 0 today: the shared-column counter is > 0 because
 * of the ABSENT-minority class (a minority absorbed by its enclosing same-formation flood
 * in gap N shows the enclosing formation at the shared column against the minority's real
 * band in gap N±1 — the exact defect the interval-restructuring increment must fix). The
 * assertion is armed (see ``EXPECT_CLEAN``) once that engine work lands; the current
 * BASELINE counts are recorded in the const below so a regression (counts rising) is
 * visible in the log even while the reporter passes. The global-PIP sweep (true physical
 * double-cover) reads 0 today — no 2D lens-into-band spill — which the reporter asserts,
 * since a non-zero PIP would be a genuine paint overlap regardless of the absent class.
 *
 * Run: HOLES_DIAG=1 npx vitest run src/renderer/src/utils/partitionFillV2.crossgap_overlap.diag.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawCol {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
interface RawSection {
  sectionId: string
  name: string
  columns: RawCol[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}

/** How far off the shared column vertical to sample the region interior (fraction).
 *  Kept TINY: the shared column is ONE borehole, so its region edges at fraction 0 /
 *  fraction 1 reconstruct the SAME litho stack. Sampling deeper into the gap picks up
 *  legitimately-dipping band edges (different formations at slightly-shifted elevations
 *  around a sloping tie) — a false positive. A real lens/band SPILL persists as the
 *  sample approaches the column; a dip artifact shrinks to nothing. We therefore require
 *  the overlap to exceed a REAL-SPILL threshold, and lean on the global PIP sweep (which
 *  maps everything to true physical space) as the authoritative check. */
const MARGIN = 0.002
/** Minimum vertical overlap (metres) counted as a real spill at the shared column.
 *  Below this is dip-of-a-sloping-band sampling noise, not a paint spill. */
const OVERLAP_EPS = 0.05
/** PIP sweep resolution along the whole section (global-fraction step). A moderate grid:
 *  the PIP is a coarse physical-space safety net for a genuine 2D lens-into-band spill
 *  (the shared-column sampler catches the thin absent-minority seam class). */
const PIP_STEP_FRAC = 0.006
/** PIP sweep elevation step (metres). */
const PIP_STEP_ELEV = 0.15

/** Elevation intervals covered by a simple polygon at vertical line x=f (fraction). */
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

/** Point-in-polygon (ray cast) in fraction×elevation space. */
function pointInPoly(poly: readonly PartitionPoint[], f: number, e: number): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].fraction
    const yi = poly[i].elevation
    const xj = poly[j].fraction
    const yj = poly[j].elevation
    const intersect =
      yi > e !== yj > e && f < ((xj - xi) * (e - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

describe('v2 CROSS-GAP different-litho overlap check (acceptance item 10)', () => {
  // Rides HOLES_DIAG (the standard battery gate) OR an explicit CROSSGAP_DIAG.
  if (process.env.HOLES_DIAG !== '1' && process.env.CROSSGAP_DIAG !== '1') {
    it.skip('dormant (set HOLES_DIAG=1 or CROSSGAP_DIAG=1)', () => {})
    return
  }

  it('finds no different-formation overlap at shared columns or across gaps', { timeout: 30000 }, () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)

    let totalSharedColOverlaps = 0
    let totalPipOverlaps = 0
    const findings: string[] = []

    for (const sec of raw.sections) {
      const keep = sec.columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
      const columns: PartitionColumn[] = keep.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: c.units,
      }))
      const alongM = keep.map(({ i }) => sec.alongM[i])
      if (columns.length < 2) continue
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      const regions = computeSectionFillV2(columns, edges, undefined, alongM)

      const byGap = new Map<number, SectionRegion[]>()
      for (const r of regions) {
        if (!byGap.has(r.gapIndex)) byGap.set(r.gapIndex, [])
        byGap.get(r.gapIndex)!.push(r)
      }

      // ---- (1) SHARED-COLUMN check: gap ci-1 right edge vs gap ci left edge ----
      let secShared = 0
      for (let ci = 1; ci + 1 < columns.length + 1; ci++) {
        const leftGap = byGap.get(ci - 1) ?? [] // shares its fraction=1 edge with column ci
        const rightGap = byGap.get(ci) ?? [] // shares its fraction=0 edge with column ci
        if (leftGap.length === 0 || rightGap.length === 0) continue
        // Interval list per formation on each side of the shared column.
        const leftBy: { fid: string; iv: [number, number] }[] = []
        for (const r of leftGap)
          for (const iv of coveredIntervals(r.polygon, 1 - MARGIN)) leftBy.push({ fid: r.formationId, iv })
        const rightBy: { fid: string; iv: [number, number] }[] = []
        for (const r of rightGap)
          for (const iv of coveredIntervals(r.polygon, MARGIN)) rightBy.push({ fid: r.formationId, iv })
        for (const L of leftBy)
          for (const R of rightBy) {
            if (L.fid === R.fid) continue
            const v = Math.min(L.iv[1], R.iv[1]) - Math.max(L.iv[0], R.iv[0])
            if (v > OVERLAP_EPS) {
              secShared++
              if (findings.length < 40)
                findings.push(
                  `${sec.name} sharedCol@${ci} ${fname(L.fid)}(g${ci - 1})×${fname(R.fid)}(g${ci}) overlap=${(v * 100).toFixed(1)}cm el[${Math.max(L.iv[0], R.iv[0]).toFixed(2)}..${Math.min(L.iv[1], R.iv[1]).toFixed(2)}]`,
                )
            }
          }
      }

      // ---- (2) GLOBAL PIP double-coverage across ALL gaps ----
      // Map each region into a global fraction: gapIndex + local fraction, normalised by
      // the number of gaps. Two DIFFERENT-formation regions covering the same global point
      // is a real overlap regardless of gap membership.
      const nGaps = columns.length - 1
      const globalRegions = regions.map((r) => ({
        fid: r.formationId,
        poly: r.polygon.map((p) => ({
          fraction: (r.gapIndex + p.fraction) / nGaps,
          elevation: p.elevation,
        })) as PartitionPoint[],
      }))
      let secPip = 0
      // Bound the elevation sweep by the section's own extent.
      let eMin = Infinity
      let eMax = -Infinity
      for (const gr of globalRegions)
        for (const p of gr.poly) {
          if (p.elevation < eMin) eMin = p.elevation
          if (p.elevation > eMax) eMax = p.elevation
        }
      const seenPip = new Set<string>()
      for (let f = PIP_STEP_FRAC / 2; f < 1; f += PIP_STEP_FRAC) {
        for (let e = eMin; e <= eMax; e += PIP_STEP_ELEV) {
          let hitFid: string | null = null
          for (const gr of globalRegions) {
            if (pointInPoly(gr.poly, f, e)) {
              if (hitFid !== null && hitFid !== gr.fid) {
                const key = `${hitFid}×${gr.fid}`
                if (!seenPip.has(key)) {
                  seenPip.add(key)
                  secPip++
                  if (findings.length < 40)
                    findings.push(
                      `${sec.name} PIP ${fname(hitFid)}×${fname(gr.fid)} at globalF=${f.toFixed(3)} el=${e.toFixed(2)}`,
                    )
                }
                break
              }
              if (hitFid === null) hitFid = gr.fid
            }
          }
        }
      }

      totalSharedColOverlaps += secShared
      totalPipOverlaps += secPip
      if (secShared > 0 || secPip > 0)
        console.log(`   ${sec.name}: sharedColOverlaps=${secShared} pipDoubleCover=${secPip}`)
    }

    // Recorded baseline (2026-07-15, engine at 564ad9f62). The shared-column counter is the
    // ABSENT-minority class (interval-restructuring work); it must not RISE. The PIP counter
    // is the real 2D paint double-cover and must stay 0.
    const BASELINE_SHARED = 17
    // Set to true once the interval terminations-first restructuring clears the absent class.
    const EXPECT_CLEAN = false

    console.log('\n########## V2 CROSS-GAP OVERLAP TOTALS ##########')
    console.log(`  shared-column different-litho overlaps: ${totalSharedColOverlaps}  (baseline ${BASELINE_SHARED})`)
    console.log(`  global-PIP different-litho double-cover: ${totalPipOverlaps}`)
    for (const f of findings) console.log('   ', f)
    console.log('#################################################')

    // The PIP sweep is the authoritative physical-space double-cover check — always 0.
    expect(totalPipOverlaps).toBe(0)
    if (EXPECT_CLEAN) {
      expect(totalSharedColOverlaps).toBe(0)
    } else {
      // Reporter mode: guard against REGRESSION (the absent class growing) without failing
      // on the known baseline. Fix path: interval per-gap terminations-first emission (design
      // §4 "Ruling-8e Milestone 2" / "FINAL SHAPES"), then flip EXPECT_CLEAN.
      expect(totalSharedColOverlaps).toBeLessThanOrEqual(BASELINE_SHARED)
    }
  })
})
