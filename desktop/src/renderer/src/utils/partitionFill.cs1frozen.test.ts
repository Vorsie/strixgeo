/**
 * ALWAYS-ON real-data regression gate for ``computeSectionFill`` (CS1 frozen
 * slice of test.strix, anonymised).
 *
 * Why this exists
 * ---------------
 * The env-gated ``partitionFill.cs1void.test.ts`` is the project's documented
 * "ARBITER" for the deep-to-deep substrate fill, but it is DOUBLE-gated:
 * ``CS1_GATE=1`` env var AND a gitignored dev-DB-regenerated input — so on a
 * clean checkout / in CI it runs NOTHING (the "synthetic passes while real data
 * breaks" trap, documented in docs/lessons-learned.md lesson #4).
 *
 * This companion loads a COMMITTED, anonymised slice of the same CS1 input
 * (``__fixtures__/cs1_partition_frozen.json``, generated from the dev DB on
 * 2026-07-01 via ``scripts/throwaway_cs1_partition_extract.py`` + anonymised
 * inline) and asserts the four structural invariants WITHOUT any env gate or
 * gitignored-file dependency.  It runs on every ``npm test`` / pre-commit
 * Vitest invocation.
 *
 * Invariants checked (identical to the env-gated test)
 * ------------------------------------------------------
 * 1. Zero interior voids — every gap is a true partition with no uncovered
 *    space sandwiched between covered space.
 * 2. Zero cross-formation overlaps — no two non-lens regions of different
 *    formationId overlap at the same point.
 * 3. Zero quad-on-quad overlaps — no two ``kind='quad'`` regions overlap.
 * 4. Correct lithology below shallow tests — the sub-TD wedge is filled by
 *    the deep neighbour's formation, not a matrix flood.
 *
 * Fixture provenance
 * ------------------
 * Source: Cross-section 1 (CS1) of test.strix, lithostratigraphic model
 * 019e934c…, extracted 2026-07-01.
 * Anonymisation applied:
 *   - investigationId → col-00 … col-23 (sequential, order preserved)
 *   - layerId → lay-000 … lay-141 (sequential, cross-edge references preserved)
 *   - bodyId → body-00 … body-51 (sequential, null stays null)
 *   - formationId → formation-sand / formation-clay / formation-silt /
 *     formation-peat (readable soil names; relative pairings preserved)
 *   - surfaceElevM offset by −12.790 m so the minimum surface = 0.00 m;
 *     topDepthM / baseDepthM are unchanged (already relative).
 *   No Lambert-72 plan coordinates or DOV permkeys were present in the source
 *   input; only internal DB UUIDs and TAW elevations.
 *
 * Keep the env-gated test
 * -----------------------
 * The heavy ``partitionFill.cs1void.test.ts`` (with the GAP-19 over-match note
 * + the toothiness console log) is retained — it exercises the live dev DB
 * and provides diagnostic context when a real CS1 regression is being worked.
 * This file is the always-on companion that catches regressions on a clean
 * checkout where the dev DB is absent.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  computeBottomTieLine,
  computeSectionFill,
  type CorrelationEdge,
  type PartitionColumn,
  type SectionRegion,
} from './partitionFill'
import { findNonLensOverlaps, formatOverlapReports } from './partitionOverlapCheck'

// ---------------------------------------------------------------------------
// Fixture loading
// ---------------------------------------------------------------------------

const HERE = dirname(fileURLToPath(import.meta.url))
// Frozen anonymised real CS1 slice (snapshot 2026-07-01). REGENERATE TRIGGER:
// re-run `scripts/throwaway_cs1_partition_extract.py` + re-anonymise when CS1's
// topology meaningfully changes (many new approved correlations / contact edits),
// or when the env-gated companion (`partitionFill.cs1void.test.ts`, CS1_GATE=1)
// fails on live data while this frozen one passes — that divergence means the
// snapshot has drifted from current CS1 and must be refreshed.
const FIXTURE_PATH = resolve(HERE, './__fixtures__/cs1_partition_frozen.json')

interface FrozenInput {
  columns: Array<{
    investigationId: string
    surfaceElevM: number | null
    units: PartitionColumn['units']
  }>
  edges: CorrelationEdge[]
}

const frozen: FrozenInput = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))

const columns: PartitionColumn[] = frozen.columns
  .filter((c) => c.surfaceElevM != null)
  .map((c) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))

// ---------------------------------------------------------------------------
// Helper: nonzero-winding point-in-polygon (x=fraction, y=elevation).
// Matches the SVG renderer's default fill rule so "covered here" means the
// renderer paints this pixel.
// ---------------------------------------------------------------------------

function inPolygon(
  px: number,
  py: number,
  poly: readonly { fraction: number; elevation: number }[],
): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const isLeft =
      (b.fraction - a.fraction) * (py - a.elevation) -
      (px - a.fraction) * (b.elevation - a.elevation)
    if (a.elevation <= py) {
      if (b.elevation > py && isLeft > 0) wn++
    } else {
      if (b.elevation <= py && isLeft < 0) wn--
    }
  }
  return wn !== 0
}

// ---------------------------------------------------------------------------
// Helper: largest 4-connected interior-void component in a gap's regions.
// An interior-void cell is uncovered space that has coverage ABOVE it in the
// same fraction column, scanned over the FULL elevation box down to
// ``bottomOverride`` (the gap's deep-neighbour base elevation).
// ---------------------------------------------------------------------------

function largestInteriorVoid(
  regions: readonly SectionRegion[],
  bottomOverride?: number,
): { cells: number; topElev: number; baseElev: number } {
  if (regions.length === 0) return { cells: 0, topElev: 0, baseElev: 0 }

  let maxE = -Infinity
  let minVert = Infinity
  for (const r of regions) {
    for (const p of r.polygon) {
      if (p.elevation < minVert) minVert = p.elevation
      if (p.elevation > maxE) maxE = p.elevation
    }
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
      for (const r of regions) {
        if (inPolygon(px, py, r.polygon)) {
          hit = true
          break
        }
      }
      covered[iy * NX + ix] = hit
    }
  }

  // Interior void = uncovered cell that has coverage above it in the same
  // fraction column, scanned down to the full bottom boundary.
  const interior: boolean[] = new Array(NX * NY).fill(false)
  for (let ix = 0; ix < NX; ix++) {
    let seen = false
    for (let iy = 0; iy < NY; iy++) {
      const here = covered[iy * NX + ix]
      if (!here && seen) interior[iy * NX + ix] = true
      if (here) seen = true
    }
  }

  // Largest 4-connected component (BFS).
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
        if (k < 2 && Math.floor(nb / NX) !== iy) continue // no row wrap
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

// ---------------------------------------------------------------------------
// Run computeSectionFill once; all assertions share the output.
// ---------------------------------------------------------------------------

const regions = computeSectionFill(columns, frozen.edges)

// Group regions by gap index.
const byGap = new Map<number, SectionRegion[]>()
for (const r of regions) {
  const g = byGap.get(r.gapIndex) ?? []
  g.push(r)
  byGap.set(r.gapIndex, g)
}

// Per-gap bottom tie-line elevation (for the void gate's lower bound).
const cols = columns.filter((c) => c.units.length > 0)
const baseTiePairs = frozen.edges.filter(
  (e) => e.aSide === 'base' && e.bSide === 'base',
) as { a: string; b: string }[]
const tie = computeBottomTieLine(cols, baseTiePairs)

function gapBottom(g: number): number | undefined {
  const l = tie.tieElev[g]
  const r = tie.tieElev[g + 1]
  if (l === null && r === null) return undefined
  return Math.min(l ?? r!, r ?? l!)
}

// ~0.18 m per row over a ~50 m section. A real void is dozens of cells;
// a handful of stray cells on a slanted edge is rasterisation noise.
const CELL_THRESHOLD = 30

// GAP-19 carries a known pre-existing over-match artefact (a same-formation
// unit on each side matched as a band at very different elevations, leaving a
// void far above the tie line). This is NOT a substrate-pass regression — it
// pre-dates the deep-to-deep substrate feature. Keep the exclusion so the
// gate reports only genuine regressions.
const GAP19_KNOWN_ABOVE_TIE = 19

// ---------------------------------------------------------------------------
// describe block
// ---------------------------------------------------------------------------

describe('CS1 frozen real-data partition gate (always-on)', () => {
  it('fixture is loaded: 24 columns, 142 units, 112 edges', () => {
    expect(frozen.columns).toHaveLength(24)
    const totalUnits = frozen.columns.reduce((s, c) => s + c.units.length, 0)
    expect(totalUnits).toBe(142)
    expect(frozen.edges).toHaveLength(112)
  })

  it('computeSectionFill produces regions in EVERY gap (no vacuous pass)', () => {
    // Teeth: a zero/degenerate output would make every structural test below
    // pass vacuously (empty loops emit no offenders). 24 columns → 23 gaps,
    // all populated, so the engine must emit at least one region per gap.
    expect(regions.length).toBeGreaterThanOrEqual(23)
    // The load-bearing guard: no gap may silently drop ALL its regions, which
    // would make the void/overlap/lithology tests vacuously green for that gap.
    expect(byGap.size).toBe(23)
  })

  it('has no cross-formation overlap in any gap (one lithology per point)', () => {
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
            ...new Set(
              nonLens
                .filter((r) => inPolygon(px, py, r.polygon))
                .map((r) => r.formationId),
            ),
          ]
          if (forms.length >= 2) {
            const key = forms.sort().join('+')
            seen.set(key, (seen.get(key) ?? 0) + 1)
          }
        }
      }
      for (const [key, cells] of seen) {
        if (cells >= CELL_THRESHOLD)
          offenders.push(`GAP-${gap} ${key}: ${cells} cells`)
      }
    }
    expect(offenders, `cross-formation overlaps found:\n${offenders.join('\n')}`).toEqual([])
  })

  it('has no quad-on-quad overlaps in any gap', () => {
    const offenders: string[] = []
    for (const [gap, regs] of [...byGap.entries()].sort((a, b) => a[0] - b[0])) {
      const quads = regs.filter((r) => r.kind === 'quad')
      if (quads.length < 2) continue
      let minE = Infinity
      let maxE = -Infinity
      for (const r of quads) for (const p of r.polygon) {
        if (p.elevation < minE) minE = p.elevation
        if (p.elevation > maxE) maxE = p.elevation
      }
      if (!Number.isFinite(minE) || maxE - minE < 1e-6) continue
      const NX = 120
      const NY = 320
      let overlapCells = 0
      for (let iy = 0; iy < NY; iy++) {
        const py = maxE - ((iy + 0.5) / NY) * (maxE - minE)
        for (let ix = 0; ix < NX; ix++) {
          const px = (ix + 0.5) / NX
          let n = 0
          for (const r of quads) if (inPolygon(px, py, r.polygon)) n++
          if (n >= 2) overlapCells++
        }
      }
      if (overlapCells >= CELL_THRESHOLD)
        offenders.push(`GAP-${gap}: ${overlapCells} overlap cells`)
    }
    expect(offenders, `quad overlaps found:\n${offenders.join('\n')}`).toEqual([])
  })

  it('has zero pairwise non-lens overlap area in any gap (sliver-dense, debt #228)', () => {
    // The raster checks above (120×320 grid, 30-cell floor) are blind to
    // hairline slivers — proven on real CS1 gap 0 (2026-07-06), where the
    // engine emitted raw SILT×ZAND / ZAND×KLEI polygon overlaps thinner than
    // a raster cell. This computes the EXACT pairwise intersection area of
    // every same-gap non-lens pair: a partition must be a partition, so the
    // shared area must be zero (touching edges are fine; area is not).
    const reports = findNonLensOverlaps(regions)
    const lines = formatOverlapReports(reports)
    expect(lines, `sliver overlaps found:\n${lines.join('\n')}`).toEqual([])
  })

  it('has correct lithology below shallow tests (no wrong formation in sub-TD wedge)', () => {
    // For each gap touching a short column (base ≥ 2 m shallower than the
    // other side), samples ~12 points in the sub-TD wedge and confirms the
    // filled formation matches the deep neighbour's formation at that elevation.
    //
    // Exemption: a correlation-driven sloping band may legitimately own a
    // sub-TD point at a different formation than the deep neighbour's flat
    // formation there. The guard: exactly ONE non-lens region covers the
    // point (singleCoverage, the load-bearing clause) AND that formation
    // participates in a cross-column approved edge (banded). A genuine flat
    // flood produces a second covering region or a cross-formation overlap
    // caught by the previous test — so the exemption cannot mask a real bug.

    const surfElev = cols.map((c) => c.surfaceElevM)
    const baseElev = cols.map(
      (c) => c.surfaceElevM - Math.max(...c.units.map((u) => u.baseDepthM)),
    )

    function formationAtElev(colIdx: number, elev: number): string | null {
      const c = cols[colIdx]
      const surf = surfElev[colIdx]
      for (const u of c.units) {
        const top = surf - u.topDepthM
        const base = surf - u.baseDepthM
        if (elev <= top + 1e-6 && elev >= base - 1e-6) return u.formationId
      }
      return null
    }

    function nearBoundary(colIdx: number, elev: number, tol = 0.5): boolean {
      const c = cols[colIdx]
      const surf = surfElev[colIdx]
      for (const u of c.units) {
        const top = surf - u.topDepthM
        const base = surf - u.baseDepthM
        if (Math.abs(elev - top) < tol || Math.abs(elev - base) < tol) return true
      }
      return false
    }

    // Build set of formations that have at least one cross-column approved
    // edge (banded formations — legitimately produce sloping sub-TD coverage).
    const layerToCol = new Map<string, { colIdx: number; formationId: string }>()
    cols.forEach((c, ci) => {
      for (const u of c.units) layerToCol.set(u.layerId, { colIdx: ci, formationId: u.formationId })
    })
    const bandedFormations = new Set<string>()
    for (const e of frozen.edges) {
      const ua = layerToCol.get(e.a)
      const ub = layerToCol.get(e.b)
      if (ua === undefined || ub === undefined) continue
      if (ua.colIdx !== ub.colIdx && ua.formationId === ub.formationId) {
        bandedFormations.add(ua.formationId)
      }
    }

    // Teeth: the lithology exemption is `singleCoverage && banded`. If EVERY
    // formation is banded the exemption becomes vacuous (a single wrong-formation
    // region in a sub-TD wedge would slip through). Currently 3/4 are banded
    // (peat is not). Fail loudly if a future fixture regeneration makes it vacuous.
    const allFormations = new Set(cols.flatMap((c) => c.units.map((u) => u.formationId)))
    expect(
      bandedFormations.size,
      'banded-formation exemption has become vacuous — regenerated fixture is fully correlated',
    ).toBeLessThan(allFormations.size)

    const BAND_TOL = 0.5
    const offenders: string[] = []

    for (let g = 0; g < cols.length - 1; g++) {
      if (g === GAP19_KNOWN_ABOVE_TIE) continue

      const leftBase = baseElev[g]
      const rightBase = baseElev[g + 1]
      const minBase = Math.min(leftBase, rightBase)
      const maxBase = Math.max(leftBase, rightBase)
      if (maxBase - minBase < 2) continue // neither side is meaningfully shallower

      const shallowSide: 0 | 1 = leftBase > rightBase ? 0 : 1
      const deepColIdx = shallowSide === 0 ? g + 1 : g

      const gapRegs = byGap.get(g) ?? []
      const gb = (() => {
        const l = tie.tieElev[g]
        const r = tie.tieElev[g + 1]
        if (l === null && r === null) return null
        return Math.min(l ?? r!, r ?? l!)
      })()
      if (gb === null) continue

      const shallowBase = maxBase
      if (shallowBase <= gb + 1) continue // no wedge to sample

      const sampleFrac = shallowSide === 0 ? 0.1 : 0.9
      const wedgeTop = shallowBase - 0.1
      const wedgeBot = gb + 0.1
      if (wedgeTop <= wedgeBot) continue

      const N = 12
      for (let si = 0; si < N; si++) {
        const t = si / (N - 1)
        const elev = wedgeTop + t * (wedgeBot - wedgeTop)

        const expectedForm = formationAtElev(deepColIdx, elev)
        if (expectedForm === null) continue
        if (nearBoundary(deepColIdx, elev, BAND_TOL)) continue

        const covRegs = gapRegs.filter(
          (r) => r.kind !== 'lens' && inPolygon(sampleFrac, elev, r.polygon),
        )
        if (covRegs.length === 0) continue // void — caught by the coverage test

        const covReg = covRegs[0]
        if (covReg.formationId !== expectedForm) {
          const singleCoverage = covRegs.length === 1
          const banded = bandedFormations.has(covReg.formationId)
          if (singleCoverage && banded) continue // legitimate sloping band
          offenders.push(
            `GAP-${g} @elev ${elev.toFixed(2)} f=${sampleFrac}: ` +
              `got ${covReg.formationId} expected ${expectedForm}`,
          )
        }
      }
    }

    expect(offenders, `lithology mismatches found:\n${offenders.join('\n')}`).toEqual([])
  })
})
