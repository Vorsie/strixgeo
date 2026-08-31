/**
 * partitionFillV2 output-ring SIMPLICITY gate (design partition-engine-v2.md §4,
 * increment-6 defect 3 — "Output-polygon simplicity").
 *
 * EVERY ``SectionRegion.polygon`` v2 emits must be a SIMPLE ring (no two edges
 * cross, no repeated vertex). Downstream consumers — geotech refinement, the voxel
 * builder, DXF export — assume simple rings; the v1 ``slice.keyholePolygon``
 * self-touching keyhole class (and the traced weakly-simple pinch/comb faces) broke
 * that assumption and tripped the sliver gate with false positives. This gate asserts
 * simplicity directly (a segment-intersection sweep + a repeated-vertex scan) on the
 * REAL 14-section input, so a regression to a non-simple ring fails loudly.
 *
 * Gated on the gitignored all-sections dev-DB extract (skips when absent); needs no
 * env var — it is a fast pure-geometry check that belongs in the routine suite once
 * the input is present.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type PartitionPoint } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const ALL_INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: PartitionColumn['units']
}
interface AllInput {
  sections: {
    name: string
    columns: RawColumn[]
    edges: { a: string; b: string; aSide?: string; bSide?: string }[]
    alongM: number[]
  }[]
}

/** Orientation sign of the ordered triple (a, b, c). */
function orient(a: PartitionPoint, b: PartitionPoint, c: PartitionPoint): number {
  const v = (b.fraction - a.fraction) * (c.elevation - a.elevation) - (b.elevation - a.elevation) * (c.fraction - a.fraction)
  return v > 1e-12 ? 1 : v < -1e-12 ? -1 : 0
}

/** Whether the two OPEN segments p1p2 and p3p4 cross transversally. */
function segmentsCross(p1: PartitionPoint, p2: PartitionPoint, p3: PartitionPoint, p4: PartitionPoint): boolean {
  const d1 = orient(p3, p4, p1)
  const d2 = orient(p3, p4, p2)
  const d3 = orient(p1, p2, p3)
  const d4 = orient(p1, p2, p4)
  // Proper crossing only — shared endpoints / collinear touches are allowed (a simple
  // ring's consecutive edges meet at a vertex, and a concave comb may touch an axis).
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** Count proper self-intersections + repeated vertices of a ring. */
function ringDefects(poly: readonly PartitionPoint[]): { crossings: number; repeats: number } {
  const n = poly.length
  let crossings = 0
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue // adjacent wrap edge
      if (segmentsCross(poly[i], poly[(i + 1) % n], poly[j], poly[(j + 1) % n])) crossings++
    }
  }
  const seen = new Set<string>()
  let repeats = 0
  for (const p of poly) {
    const k = `${p.fraction.toFixed(9)}|${p.elevation.toFixed(6)}`
    if (seen.has(k)) repeats++
    seen.add(k)
  }
  return { crossings, repeats }
}

describe('partitionFillV2 — output rings are simple on the real sections', () => {
  if (!existsSync(ALL_INPUT)) {
    it.skip(`all-sections input absent (${ALL_INPUT})`, () => {})
    return
  }
  const raw = JSON.parse(readFileSync(ALL_INPUT, 'utf8')) as AllInput

  it('no output SectionRegion.polygon self-intersects or repeats a vertex', () => {
    const offenders: string[] = []
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
      regions.forEach((r, ri) => {
        const { crossings, repeats } = ringDefects(r.polygon)
        if (crossings > 0 || repeats > 0) {
          offenders.push(
            `${sec.name} region#${ri} gap${r.gapIndex} ${r.kind} ${r.formationId.slice(-6)}: ` +
              `crossings=${crossings} repeats=${repeats} (n=${r.polygon.length})`,
          )
        }
      })
    }
    expect(offenders, `non-simple output rings:\n${offenders.join('\n')}`).toEqual([])
  })
})
