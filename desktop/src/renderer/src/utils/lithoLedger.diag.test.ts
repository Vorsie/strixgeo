/**
 * THROWAWAY DIAG — the LITHO CHANGE LEDGER + coverage reporter.
 *
 * Dumps the litho arm's regions for EVERY section of the live model, plus a
 * per-section holes / different-soil-overlap scan, so an engine change can be
 * diffed region-by-region and every moved region explained.
 *
 * Dormant unless LITHO_LEDGER=1. Env LEDGER_OUT names the output file
 * (default scripts/throwaway_litho_ledger.json).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, PartitionPoint, SectionRegion } from './sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')

/** Even-odd covered elevation intervals of one polygon at fraction ``f``. */
function coveredAt(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a.fraction === b.fraction) continue
    const lo = Math.min(a.fraction, b.fraction)
    const hi = Math.max(a.fraction, b.fraction)
    if (f < lo || f >= hi) continue
    const t = (f - a.fraction) / (b.fraction - a.fraction)
    ys.push(a.elevation + t * (b.elevation - a.elevation))
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}

describe('LITHO ledger diag', () => {
  if (process.env.LITHO_LEDGER !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set LITHO_LEDGER=1)', () => {})
    return
  }
  it('dumps every section litho partition + coverage defects', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as any
    const soil = raw.refinementBundle.lithoSoilByFormationId
    const out: any = { sections: {} }
    for (const sec of raw.sections) {
      const paired = sec.columns
        .map((c: any, i: number) => ({ c, a: sec.alongM[i] }))
        .filter(({ c }: any) => c.surfaceElevM != null && c.units.length > 0)
        .sort((p: any, q: any) => p.a - q.a)
      const columns: PartitionColumn[] = paired.map(({ c }: any) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM,
        units: [...c.units].sort((a: any, b: any) => a.topDepthM - b.topDepthM),
      }))
      if (columns.length < 2) continue
      const alongM: number[] = paired.map(({ a }: any) => a)
      const edges: CorrelationEdge[] = sec.edges.map((e: any) => ({
        a: e.a,
        b: e.b,
        aSide: e.aSide ?? 'top',
        bSide: e.bSide ?? 'top',
      }))
      const empty = new Map<string, BodyBoundaryResponse>()
      const regions: SectionRegion[] = computeSectionFillActive(
        columns,
        edges,
        deriveSectionApexOverrides(columns, edges, alongM, empty),
        alongM,
      )
      // Region dump — sorted so the diff is order-insensitive.
      const dump = regions
        .map(
          (r) =>
            `g${r.gapIndex} ${soil[r.formationId] ?? r.formationId.slice(0, 6)} ${r.kind} ` +
            r.polygon.map((p) => `(${p.fraction.toFixed(3)},${p.elevation.toFixed(3)})`).join(''),
        )
        .sort()
      // Coverage defects per gap: interior holes and different-soil overlaps.
      let holes = 0
      let holeArea = 0
      let overlaps = 0
      let overlapArea = 0
      const byGap = new Map<number, SectionRegion[]>()
      for (const r of regions) {
        const list = byGap.get(r.gapIndex)
        if (list === undefined) byGap.set(r.gapIndex, [r])
        else list.push(r)
      }
      for (const [gap, regs] of byGap) {
        const width = alongM[gap + 1] - alongM[gap]
        const STEP = 0.02
        for (let f = STEP; f < 1 - STEP / 2; f += STEP) {
          const ivs: [number, number][] = []
          for (const r of regs) ivs.push(...coveredAt(r.polygon, f))
          ivs.sort((a, b) => a[0] - b[0])
          const merged: [number, number][] = []
          for (const iv of ivs) {
            const last = merged[merged.length - 1]
            if (last && iv[0] <= last[1] + 5e-4) last[1] = Math.max(last[1], iv[1])
            else merged.push([...iv])
          }
          for (let k = 0; k + 1 < merged.length; k++) {
            const h = merged[k + 1][0] - merged[k][1]
            if (h > 5e-4) {
              holes += 1
              holeArea += h * STEP * width
            }
          }
          for (let a = 0; a < regs.length; a++)
            for (let b = a + 1; b < regs.length; b++) {
              if ((soil[regs[a].formationId] ?? '') === (soil[regs[b].formationId] ?? '')) continue
              for (const [a1, a2] of coveredAt(regs[a].polygon, f))
                for (const [b1, b2] of coveredAt(regs[b].polygon, f)) {
                  const v = Math.min(a2, b2) - Math.max(a1, b1)
                  if (v > 1e-3) {
                    overlaps += 1
                    overlapArea += v * STEP * width
                  }
                }
            }
        }
      }
      out.sections[sec.name] = { regions: dump, holes, holeArea, overlaps, overlapArea }
    }
    writeFileSync(
      resolve(REPO_ROOT, process.env.LEDGER_OUT ?? 'scripts/throwaway_litho_ledger.json'),
      JSON.stringify(out, null, 1),
    )
  })
})
