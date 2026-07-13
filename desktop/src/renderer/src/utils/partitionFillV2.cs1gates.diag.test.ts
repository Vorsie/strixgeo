/**
 * CS1 owner-blessed invariant gates run against the V2 engine
 * (``computeSectionFillV2``) — the increment-5 second deliverable
 * (docs/design/partition-engine-v2.md §6). The v1 gate suite
 * (``partitionFill.cs1void`` / ``cs1sandbody`` / ``cs1lensdisjoint`` /
 * ``cs1bandauthority``) asserts the owner's real-data invariants against v1; this
 * file ports the SAME assertion logic and points it at v2 output so v2's readiness
 * against those invariants is honestly reported.
 *
 * The assertions are PORTED VERBATIM (same thresholds, same sampling, same
 * exemptions) — only the engine call changes (``computeSectionFill`` ->
 * ``computeSectionFillV2``). A FAIL here is a FINDING, not a licence to weaken the
 * assertion: either it pins a v1-specific shape the design allows v2 to diverge on
 * (documented in the report), or it is a real v2 defect.
 *
 * Double-gated exactly like the v1 gates: ``CS1_GATE=1`` env var AND the gitignored
 * dev-DB inputs (skip when absent). The CS1-single-section gates read
 * ``scripts/throwaway_cs1_input.json`` (carries per-column ``name`` + real
 * ``along``); the lens-disjoint gate sweeps all 14 sections from
 * ``scripts/diag_allsections_input.json``.
 *
 * Run:  CS1_GATE=1 npx vitest run \
 *         src/renderer/src/utils/partitionFillV2.cs1gates.diag.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  computeBottomTieLine,
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from './partitionFill'
import { computeSectionFillV2 } from './partitionFillV2'
import { findNonLensOverlaps, formatOverlapReports } from './partitionOverlapCheck'
import { inPolygon } from './partitionFillV2.parityCoverage'
import { bandAuthorityOffenders, nonEmptyAlong } from './partitionFillV2.cs1BandAuthority'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const CS1_INPUT = process.env.CS1_INPUT ?? resolve(REPO_ROOT, 'scripts/throwaway_cs1_input.json')
const ALL_INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: PartitionColumn['units']
  name?: string
}
interface RawInput {
  columns: RawColumn[]
  edges: CorrelationEdge[]
  along?: number[]
}

/** ~0.18 m per row over a ~50 m section → a real hole is dozens of cells. */
const CELL_THRESHOLD = 30

/** Elevation intervals covered by a simple polygon at vertical line x=f. */
function coveredIntervals(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    if ((a.fraction <= f && b.fraction > f) || (b.fraction <= f && a.fraction > f)) {
      const t = (f - a.fraction) / (b.fraction - a.fraction)
      ys.push(a.elevation + t * (b.elevation - a.elevation))
    }
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}

/** Load + run v2 on the single-section CS1 input, returning regions + geometry. */
function runCs1(): {
  regions: SectionRegion[]
  columns: PartitionColumn[]
  cols: PartitionColumn[]
  raw: RawInput
  byGap: Map<number, SectionRegion[]>
  /** alongM 1:1 with ``columns`` (the surfaceElevM-filtered list), or undefined. */
  alongM: number[] | undefined
} {
  const raw = JSON.parse(readFileSync(CS1_INPUT, 'utf8')) as RawInput
  const keep = raw.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = raw.along ? keep.map(({ i }) => (raw.along as number[])[i]) : undefined
  const regions = computeSectionFillV2(columns, raw.edges, undefined, alongM)
  const cols = columns.filter((c) => c.units.length > 0)
  const byGap = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    const g = byGap.get(r.gapIndex) ?? []
    g.push(r)
    byGap.set(r.gapIndex, g)
  }
  return { regions, columns, cols, raw, byGap, alongM }
}

describe('CS1 invariant gates — V2 engine', () => {
  if (process.env.CS1_GATE !== '1') {
    it.skip('dormant (set CS1_GATE=1)', () => {})
    return
  }
  if (!existsSync(CS1_INPUT)) {
    it.skip(`CS1 input absent (${CS1_INPUT})`, () => {})
    return
  }

  // ---------------------------------------------------------------------------
  // GATE: cs1void — interior voids (ported from partitionFill.cs1void.test.ts).
  // The gate bottom is the per-gap bottom-tie line; a void is uncovered space with
  // coverage above it, down to that bottom. v2 leaves sub-TD strips empty by design
  // (owner §8 Q3), so this gate is EXPECTED to surface sub-TD voids on v2 — a v1-shape
  // pin, documented in the report, NOT weakened here.
  // ---------------------------------------------------------------------------
  it('cs1void — no interior voids (each gap a true partition down to the tie line)', () => {
    const { cols, raw, byGap } = runCs1()
    const baseTiePairs = raw.edges.filter((e) => e.aSide === 'base' && e.bSide === 'base') as {
      a: string
      b: string
    }[]
    const tie = computeBottomTieLine(cols, baseTiePairs)
    const gapBottom = (g: number): number | undefined => {
      const l = tie.tieElev[g]
      const r = tie.tieElev[g + 1]
      if (l === null && r === null) return undefined
      return Math.min(l ?? r!, r ?? l!)
    }
    const offenders: string[] = []
    for (const [gap, regs] of [...byGap.entries()].sort((a, b) => a[0] - b[0])) {
      const gb = gapBottom(gap)
      const v = largestInteriorVoid(regs, gb)
      if (v.cells >= CELL_THRESHOLD) {
        offenders.push(`GAP-${gap}: ${v.cells} cells, elev [${v.baseElev.toFixed(2)}..${v.topElev.toFixed(2)}]`)
      }
    }
    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[V2-CS1-VOID] offending gaps:\n  ' + offenders.join('\n  '))
    }
    expect(offenders, `interior voids found:\n${offenders.join('\n')}`).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // GATE: cross-formation overlap (ported from cs1void's last case). One lithology
  // per point — the true-partition invariant that MUST hold for v2.
  // ---------------------------------------------------------------------------
  it('cs1void/xform — no cross-formation overlap in any gap (one lithology per point)', () => {
    const { byGap } = runCs1()
    const offenders: string[] = []
    for (const [gap, regs] of [...byGap.entries()].sort((a, b) => a[0] - b[0])) {
      const nonLens = regs.filter((r) => r.kind !== 'lens')
      let minE = Infinity
      let maxE = -Infinity
      for (const r of nonLens) for (const p of r.polygon) {
        if (p.elevation < minE) minE = p.elevation
        if (p.elevation > maxE) maxE = p.elevation
      }
      if (!Number.isFinite(minE) || maxE - minE < 1e-6) continue
      const NX = 120
      const NY = 320
      const seen = new Map<string, number>()
      for (let iy = 0; iy < NY; iy++) {
        const py = maxE - ((iy + 0.5) / NY) * (maxE - minE)
        for (let ix = 0; ix < NX; ix++) {
          const px = (ix + 0.5) / NX
          const forms = [
            ...new Set(nonLens.filter((r) => inPolygon(px, py, r.polygon)).map((r) => r.formationId)),
          ]
          if (forms.length >= 2) {
            const key = forms.sort().join('+')
            seen.set(key, (seen.get(key) ?? 0) + 1)
          }
        }
      }
      for (const [key, cells] of seen) {
        if (cells >= CELL_THRESHOLD) offenders.push(`GAP-${gap} ${key}: ${cells} cells`)
      }
    }
    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[V2-CS1-XFORM] cross-formation overlaps:\n  ' + offenders.join('\n  '))
    }
    expect(offenders, `cross-formation overlaps found:\n${offenders.join('\n')}`).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // GATE: sliver overlap (debt #228) — exact pairwise non-lens overlap area = 0.
  // ---------------------------------------------------------------------------
  it('cs1void/sliver — zero pairwise non-lens overlap area (debt #228)', () => {
    const { regions } = runCs1()
    const reports = findNonLensOverlaps(regions)
    // Diagnostic: split EXACT (genuine simple-polygon overlap — a real partition
    // defect) from SAMPLED (the pair failed to triangulate → a NON-SIMPLE ring, i.e.
    // a keyholed matrix-with-lens-hole from ``slice.keyholePolygon``; its self-touching
    // slit makes the raster fallback report a phantom overlap). A v2 keyhole artifact
    // is NOT a real paint overlap (the even-odd holes diag reads 0), but it IS a
    // non-simple output ring — reported honestly, not silenced.
    const nExact = reports.filter((r) => r.method === 'exact').length
    const nSampled = reports.filter((r) => r.method === 'sampled').length
    const lines = formatOverlapReports(reports)
    if (lines.length > 0) {
      // eslint-disable-next-line no-console
      console.info(
        `[V2-CS1-SLIVER] ${lines.length} overlap pairs (exact=${nExact} real, ` +
          `sampled=${nSampled} keyhole-nonsimple):\n  ` +
          lines.join('\n  '),
      )
    }
    expect(lines, `sliver overlaps found:\n${lines.join('\n')}`).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // GATE: cs1sandbody — the deep sand body under the sand-top tie contains no
  // foreign lithology (ported from partitionFill.cs1sandbody.test.ts).
  // ---------------------------------------------------------------------------
  it('cs1sandbody — deep sand body under the sand-top tie has no foreign lithology (B2→S7A)', () => {
    const { regions, cols, raw } = runCs1()
    const rawByInv = new Map(
      raw.columns.filter((c) => c.surfaceElevM != null).map((c) => [c.investigationId, c]),
    )
    const b2Idx = cols.findIndex((c) => (rawByInv.get(c.investigationId)?.name ?? '').includes('B2'))
    expect(b2Idx).toBeGreaterThanOrEqual(0)
    const b2Units = [...cols[b2Idx].units].sort((a, b) => a.topDepthM - b.topDepthM)
    const sandFid = b2Units[b2Units.length - 1].formationId
    const gap = b2Idx
    const E_TOP = 3.5
    const E_BASE = -5.0
    const gapRegions = regions.filter((r) => r.gapIndex === gap && r.kind !== 'lens')
    const NF = 40
    const NE = 24
    const foreign = new Map<string, number>()
    for (let fi = 1; fi < NF; fi++) {
      const f = fi / NF
      for (let ei = 0; ei <= NE; ei++) {
        const e = E_BASE + ((E_TOP - E_BASE) * ei) / NE
        let coverFid: string | null = null
        for (const r of gapRegions) if (inPolygon(f, e, r.polygon)) coverFid = r.formationId
        if (coverFid !== null && coverFid !== sandFid) foreign.set(coverFid, (foreign.get(coverFid) ?? 0) + 1)
      }
    }
    const report = [...foreign.entries()].map(([fid, n]) => `${fid.slice(-6)} ×${n}`).join(', ')
    // eslint-disable-next-line no-console
    console.info(`[V2-CS1-SANDBODY] gap ${gap} sand=${sandFid.slice(-6)} foreign: ${report || 'none'}`)
    expect(report).toBe('')
  })

  // ---------------------------------------------------------------------------
  // GATE: cs1bandauthority — a correlation band is authoritative; no other
  // lithology may be drawn inside it (ported from partitionFill.cs1bandauthority).
  // ---------------------------------------------------------------------------
  it('cs1bandauthority — no lithology drawn over a correlation band (bands are authoritative)', () => {
    const { regions, cols, columns, raw, alongM } = runCs1()
    // colsAlong is 1:1 with ``cols`` (units>0 within the surfaceElevM-filtered list),
    // built by dropping empty-unit columns from ``columns`` — matching the engine's
    // own non-empty filter + alongM indexing exactly (see the v1 gate).
    const colsAlong = nonEmptyAlong(columns, alongM, cols.length)
    const { authority } = bandAuthorityOffenders(regions, cols, colsAlong, raw.edges)
    if (authority.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[V2-CS1-BAND-AUTHORITY] offending bands:\n  ' + authority.join('\n  '))
    }
    expect(authority, `lithology drawn over a correlation band:\n${authority.join('\n')}`).toEqual([])
  })

  it("cs1bandauthority/edge-on-tie — a band's edges lie ON its tie at intervening columns", () => {
    const { regions, cols, columns, raw, alongM } = runCs1()
    const colsAlong = nonEmptyAlong(columns, alongM, cols.length)
    const { edgeOnTie } = bandAuthorityOffenders(regions, cols, colsAlong, raw.edges)
    if (edgeOnTie.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[V2-CS1-EDGE-ON-TIE] offending band edges:\n  ' + edgeOnTie.join('\n  '))
    }
    expect(edgeOnTie, `band edge crosses its own tie:\n${edgeOnTie.join('\n')}`).toEqual([])
  })

  // ---------------------------------------------------------------------------
  // GATE: cs1lensdisjoint — no lens overlaps a DIFFERENT-formation region by > 1 cm
  // in any gap of any of the 14 sections (ported from
  // partitionFill.cs1lensdisjoint.test.ts — the all-sections sweep).
  // ---------------------------------------------------------------------------
  it('cs1lensdisjoint — no lens overlaps a different-formation region > 1 cm (all 14 sections)', () => {
    if (!existsSync(ALL_INPUT)) {
      // eslint-disable-next-line no-console
      console.info('[V2-CS1-LENSDISJOINT] all-sections input absent — skipped')
      return
    }
    const MAX_OVERLAP_M = 0.01
    const raw = JSON.parse(readFileSync(ALL_INPUT, 'utf8')) as {
      sections: {
        name: string
        columns: RawColumn[]
        edges: { a: string; b: string; aSide?: string; bSide?: string }[]
        alongM: number[]
      }[]
      formationNames: Record<string, string>
    }
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    const maxVertOverlap = (a: readonly PartitionPoint[], b: readonly PartitionPoint[]): number => {
      let m = 0
      for (let f = 0.02; f < 0.985; f += 0.01) {
        const ia = coveredIntervals(a, f)
        const ib = coveredIntervals(b, f)
        for (const [a1, a2] of ia) for (const [b1, b2] of ib) m = Math.max(m, Math.min(a2, b2) - Math.max(a1, b1))
      }
      return m
    }
    const violations: string[] = []
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
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      const regions = computeSectionFillV2(columns, edges, undefined, alongM)
      const byGap = new Map<number, typeof regions>()
      for (const r of regions) {
        if (!byGap.has(r.gapIndex)) byGap.set(r.gapIndex, [])
        byGap.get(r.gapIndex)!.push(r)
      }
      for (const [gi, regs] of byGap) {
        for (let a = 0; a < regs.length; a++) {
          for (let b = a + 1; b < regs.length; b++) {
            if (regs[a].formationId === regs[b].formationId) continue
            if (regs[a].kind !== 'lens' && regs[b].kind !== 'lens') continue
            const v = maxVertOverlap(regs[a].polygon, regs[b].polygon)
            if (v > MAX_OVERLAP_M) {
              violations.push(
                `${sec.name} gap${gi}: ${fname(regs[a].formationId)}(${regs[a].kind})×` +
                  `${fname(regs[b].formationId)}(${regs[b].kind}) maxVertOverlap=${(v * 100).toFixed(1)}cm`,
              )
            }
          }
        }
      }
    }
    if (violations.length) {
      // eslint-disable-next-line no-console
      console.error(`\n[V2-CS1-LENSDISJOINT] violations (${violations.length}):\n  ${violations.join('\n  ')}`)
    }
    expect(violations).toEqual([])
  })
})

/** Largest connected (4-neighbour) interior-void component in a gap (ported). */
function largestInteriorVoid(
  regions: readonly SectionRegion[],
  bottomOverride?: number,
): { cells: number; topElev: number; baseElev: number } {
  if (regions.length === 0) return { cells: 0, topElev: 0, baseElev: 0 }
  let maxE = -Infinity
  let minVert = Infinity
  for (const r of regions) for (const p of r.polygon) {
    if (p.elevation < minVert) minVert = p.elevation
    if (p.elevation > maxE) maxE = p.elevation
  }
  const minE = bottomOverride ?? minVert
  if (!Number.isFinite(minE) || maxE - minE < 1e-6) return { cells: 0, topElev: 0, baseElev: 0 }
  const NX = 120
  const NY = 320
  const covered: boolean[] = new Array(NX * NY).fill(false)
  for (let iy = 0; iy < NY; iy++) {
    const py = maxE - ((iy + 0.5) / NY) * (maxE - minE)
    for (let ix = 0; ix < NX; ix++) {
      const px = (ix + 0.5) / NX
      let hit = false
      for (const r of regions) if (inPolygon(px, py, r.polygon)) { hit = true; break }
      covered[iy * NX + ix] = hit
    }
  }
  const interior: boolean[] = new Array(NX * NY).fill(false)
  for (let ix = 0; ix < NX; ix++) {
    let seen = false
    for (let iy = 0; iy < NY; iy++) {
      const here = covered[iy * NX + ix]
      if (!here && seen) interior[iy * NX + ix] = true
      if (here) seen = true
    }
  }
  const visited: boolean[] = new Array(NX * NY).fill(false)
  let best = { cells: 0, topElev: 0, baseElev: 0 }
  for (let start = 0; start < NX * NY; start++) {
    if (!interior[start] || visited[start]) continue
    const queue = [start]
    visited[start] = true
    let count = 0
    let cTop = -Infinity
    let cBase = Infinity
    while (queue.length > 0) {
      const idx = queue.pop()!
      count++
      const iy = Math.floor(idx / NX)
      const ix = idx % NX
      const py = maxE - ((iy + 0.5) / NY) * (maxE - minE)
      if (py > cTop) cTop = py
      if (py < cBase) cBase = py
      const neighbours = [idx - 1, idx + 1, idx - NX, idx + NX]
      for (let k = 0; k < 4; k++) {
        const nb = neighbours[k]
        if (nb < 0 || nb >= NX * NY) continue
        if (k < 2 && Math.floor(nb / NX) !== iy) continue
        if (interior[nb] && !visited[nb]) {
          visited[nb] = true
          queue.push(nb)
        }
      }
    }
    if (count > best.cells) best = { cells: count, topElev: cTop, baseElev: cBase }
  }
  return best
}
