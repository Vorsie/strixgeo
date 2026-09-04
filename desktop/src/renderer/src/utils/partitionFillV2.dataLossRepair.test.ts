/**
 * partitionFillV2.dataLossRepair.test.ts — REAL-SECTION data-loss gate (owner 2026-07-26).
 *
 * THE INVARIANT (ruling 8k, "columns are ground truth"). A drilled unit must render its OWN litho
 * at its OWN column edge. The safe-default post-pass (detectFloodedUnits → forceLensUnits) catches
 * units the enclosing flood would paint a FOREIGN litho and re-runs with them demoted to corr-0 so
 * each draws its own LENS (owner 2026-09-04 "zero ties = lens"; the pre-2026-09-04 form re-emitted an
 * onlap instead). This gate does NOT pin lens-vs-onlap shape — it pins the 8k invariant: the drilled
 * litho survives at its own column, which a lens satisfies. The onlap→lens shape flip is pinned by
 * `partitionFillV2.floodedUnitLensNotOnlap.test.ts`.
 *
 * These 5 real-section units were flooded on the flag-ON engine (region evidence: own column edge
 * rendered a different formation, the unit's own regions absent). Flag-ON path.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type PartitionPoint, type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const INPUT = resolve(HERE, '../../../../..', 'scripts/diag_allsections_input.json')
const present = existsSync(INPUT)

function pip(poly: readonly PartitionPoint[], f: number, e: number): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].fraction, yi = poly[i].elevation, xj = poly[j].fraction, yj = poly[j].elevation
    if (yi > e !== yj > e && f < ((xj - xi) * (e - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// (section, gap, side, litho name, mid-elevation) — the 5 flooded drilled units.
const CASES = [
  { s: 'Tie-section 11', g: 0, side: 'left', litho: 'ZAND', el: 11.36 },
  { s: 'Cross-section 3', g: 6, side: 'left', litho: 'KLEI', el: 12.02 },
  { s: 'Cross-section 3', g: 7, side: 'left', litho: 'ZAND', el: 12.09 },
  { s: 'Cross-section 2', g: 13, side: 'right', litho: 'SILT', el: 4.52 },
  { s: 'Cross-section 2', g: 21, side: 'right', litho: 'ZAND', el: 12.58 },
] as const

describe('safe-default repair: flooded drilled units render their own litho (real data)', () => {
  const maybe = present ? it : it.skip
  for (const c of CASES) {
    maybe(`${c.s} g${c.g} ${c.litho}[${c.side}] renders ${c.litho}, not a foreign litho`, () => {
      const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as any
      const nameOf = (id: string): string => raw.formationNames[id] ?? id.slice(-4)
      const sec = raw.sections.find((s: any) => s.name === c.s)
      const keep = sec.columns.filter((col: any) => col.surfaceElevM != null && col.units.length > 0)
      const columns: PartitionColumn[] = keep.map((col: any) => ({ investigationId: col.investigationId, surfaceElevM: col.surfaceElevM, units: col.units }))
      // Each KEPT column's own along-section position — pair the index to the column that
      // survived the filter, never the first N positions. `keep` drops columns with no surface
      // elevation or no accepted units, which this fixture (regenerated from the live dev DB)
      // regularly contains; taking the first N would hand every kept column its left
      // neighbour's position and silently move the geometry these 5 assertions probe.
      const alongM = sec.columns
        .map((col: any, i: number) => ({ col, i }))
        .filter(({ col }: any) => col.surfaceElevM != null && col.units.length > 0)
        .map(({ i }: any) => sec.alongM[i])
      expect(alongM, 'one along-section position per kept column').toHaveLength(columns.length)
      const edges: CorrelationEdge[] = sec.edges.map((e: any) => ({ a: e.a, b: e.b, aSide: e.aSide ?? 'top', bSide: e.bSide ?? 'top' }))
      const prev = setTwoSidedTerminations(true)
      let regions: SectionRegion[]
      try { regions = computeSectionFillV2(columns, edges, undefined, alongM) } finally { setTwoSidedTerminations(prev) }
      const edgeF = c.side === 'left' ? 0.02 : 0.98
      const cover = regions.filter((r) => r.gapIndex === c.g && pip(r.polygon, edgeF, c.el)).map((r) => nameOf(r.formationId))
      // The drilled litho must be present at its own column edge (ground truth) — never replaced
      // entirely by a foreign litho.
      expect(cover, `${c.litho} must render at its own column edge (drilled ground truth)`).toContain(c.litho)
    })
  }
})
