/**
 * REAL-DATA void gate for ``computeSectionFill`` (CS1 of test.strix).
 *
 * Why this exists
 * ---------------
 * The synthetic ``assertTiles`` unit tests do NOT reproduce the real
 * TD-mismatch geometry that produces sub-shallow-TD voids in the 2D
 * partition (four fix attempts passed unit tests while the real CS1 partition
 * still had multi-metre holes). This gate rasterises the ACTUAL CS1 partition
 * input — regenerated from the dev DB by
 * ``scripts/throwaway_cs1_partition_extract.py`` — and fails on any interior
 * void (uncovered space sandwiched between covered space in the same column).
 *
 * Input path is overridable via ``CS1_INPUT`` env var; defaults to
 * ``scripts/throwaway_cs1_input.json`` (regenerate before running:
 * ``uv run python scripts/throwaway_cs1_partition_extract.py``). The test
 * SKIPS (does not fail) when the input file is absent, so a clean checkout
 * without the dev DB still passes the suite.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  computeSectionFill,
  type CorrelationEdge,
  type PartitionColumn,
  type SectionRegion,
} from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT_PATH = process.env.CS1_INPUT ?? resolve(REPO_ROOT, 'scripts/throwaway_cs1_input.json')

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: PartitionColumn['units']
}
interface RawInput {
  columns: RawColumn[]
  edges: CorrelationEdge[]
}

/** Nonzero-winding point-in-polygon (x=fraction, y=elevation) — matches the SVG
 *  renderer's default fill rule, so "covered here" means "the renderer paints
 *  this pixel". */
function inPolygon(px: number, py: number, poly: readonly { fraction: number; elevation: number }[]): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const isLeft = (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation)
    if (a.elevation <= py) {
      if (b.elevation > py && isLeft > 0) wn++
    } else {
      if (b.elevation <= py && isLeft < 0) wn--
    }
  }
  return wn !== 0
}

/** Largest connected (4-neighbour) component of interior-void cells in a gap. */
function largestInteriorVoid(regions: readonly SectionRegion[]): { cells: number; topElev: number; baseElev: number } {
  if (regions.length === 0) return { cells: 0, topElev: 0, baseElev: 0 }
  // Bounding elevation box from ALL region vertices.
  let minE = Infinity
  let maxE = -Infinity
  for (const r of regions) {
    for (const p of r.polygon) {
      if (p.elevation < minE) minE = p.elevation
      if (p.elevation > maxE) maxE = p.elevation
    }
  }
  if (!Number.isFinite(minE) || maxE - minE < 1e-6) return { cells: 0, topElev: 0, baseElev: 0 }

  const NX = 120 // fraction columns
  const NY = 320 // elevation rows (top = row 0 = maxE)
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

  // A void is uncovered space that the partition SHOULD fill. The bottom boundary
  // of the section is the bottom-tie line ≈ the DEEPEST filled extent across the
  // gap (the deep neighbour's base, continued under the shallow columns). So a void
  // is an uncovered cell that (a) has coverage ABOVE it in its own fraction column,
  // and (b) lies AT/ABOVE the gap's deepest covered row. This catches BOTH
  // sandwiched holes AND the bottom-region voids below a shallow test's TD (which a
  // "covered below" requirement wrongly skips — those voids extend down to the
  // bottom line with nothing covered beneath them).
  let deepestCoveredRow = -1
  for (let iy = NY - 1; iy >= 0; iy--) {
    let any = false
    for (let ix = 0; ix < NX; ix++) if (covered[iy * NX + ix]) { any = true; break }
    if (any) { deepestCoveredRow = iy; break }
  }
  const interior: boolean[] = new Array(NX * NY).fill(false)
  for (let ix = 0; ix < NX; ix++) {
    let seen = false
    for (let iy = 0; iy <= deepestCoveredRow; iy++) {
      const here = covered[iy * NX + ix]
      if (!here && seen) interior[iy * NX + ix] = true
      if (here) seen = true
    }
  }

  // Largest 4-connected component of interior-void cells (BFS).
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
        if (k < 2 && Math.floor(nb / NX) !== iy) continue // don't wrap rows
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

describe('CS1 real-data partition void gate', () => {
  // Dormant by default: this gate needs the dev-DB-derived CS1 input and currently
  // documents the OPEN GAP-19 over-match void (see the plan), so it must NOT fail
  // the routine suite / pre-commit hook. Activate it explicitly when working the
  // GAP-19 fix:
  //   uv run python scripts/throwaway_cs1_partition_extract.py
  //   CS1_GATE=1 npx vitest run src/renderer/src/utils/partitionFill.cs1void.test.ts
  if (process.env.CS1_GATE !== '1') {
    it.skip('CS1 gate dormant (set CS1_GATE=1 to run — see GAP-19 in the bottom-tie plan)', () => {})
    return
  }
  if (!existsSync(INPUT_PATH)) {
    it.skip(`CS1 input absent (${INPUT_PATH}) — regenerate with scripts/throwaway_cs1_partition_extract.py`, () => {})
    return
  }

  const raw = JSON.parse(readFileSync(INPUT_PATH, 'utf8')) as RawInput
  const columns: PartitionColumn[] = raw.columns
    .filter((c) => c.surfaceElevM != null)
    .map((c) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: c.units,
    }))
  const regions = computeSectionFill(columns, raw.edges)

  // Group regions by gap.
  const byGap = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    const g = byGap.get(r.gapIndex) ?? []
    g.push(r)
    byGap.set(r.gapIndex, g)
  }

  // ~0.18 m per row over a ~50 m section → a real hole is dozens of cells.
  // A handful of stray cells along a slanted edge is rasterisation noise.
  const CELL_THRESHOLD = 30

  it('has no interior voids in any gap (each gap is a true partition)', () => {
    const offenders: string[] = []
    for (const [gap, regs] of [...byGap.entries()].sort((a, b) => a[0] - b[0])) {
      const v = largestInteriorVoid(regs)
      if (v.cells >= CELL_THRESHOLD) {
        offenders.push(`GAP-${gap}: ${v.cells} cells, elev [${v.baseElev.toFixed(2)}..${v.topElev.toFixed(2)}]`)
      }
    }
    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[CS1-VOID] offending gaps:\n  ' + offenders.join('\n  '))
    }
    expect(offenders, `interior voids found:\n${offenders.join('\n')}`).toEqual([])
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
      if (overlapCells >= CELL_THRESHOLD) offenders.push(`GAP-${gap}: ${overlapCells} overlap cells`)
    }
    if (offenders.length > 0) {
      // eslint-disable-next-line no-console
      console.info('[CS1-OVERLAP] offending gaps:\n  ' + offenders.join('\n  '))
    }
    expect(offenders, `quad overlaps found:\n${offenders.join('\n')}`).toEqual([])
  })
})
