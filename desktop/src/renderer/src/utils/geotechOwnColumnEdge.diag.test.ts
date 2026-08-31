/**
 * THE OWN-COLUMN GATE — a test's own log survives at its own column edge.
 *
 * Owner, 2026-08-20, on the sliver his arrow pointed at: *"an onlap can't paint
 * over ground near test itself, it terminates at 0.5 Distance approximately."*
 * A construct is one test's statement about the ground between two tests; it may
 * never reach the facing test and paint over what that test measured. The
 * clause's consequence is checkable in one number: sample a hair into each gap
 * beside every banded column, at the middle of each of that column's own bands,
 * and the paint must be that band's own class.
 *
 * Before the clause: 44 of 1120 samples on the owner's model were painted by the
 * facing test's construct. After it: 0.
 *
 * INPUT      scripts/throwaway_geotech_axis_inputs.json — an UNTRACKED read-only
 *            dump of the owner's dev DB (regenerate with
 *            ``uv run python scripts/dump_geotech_axis_inputs.py``).
 * REPORT     scripts/throwaway_own_column_edge.txt, every run.
 *
 * Dormant unless OWN_EDGE=1:
 *   OWN_EDGE=1 node node_modules/vitest/vitest.mjs run \\
 *     src/renderer/src/utils/geotechOwnColumnEdge.diag.test.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { frameAlignedColumns } from './frameAlignedPartition'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_own_column_edge.txt')

/** How far into the gap the sample sits — a hair off the column itself. */
const EDGE = 0.02
/** Bands thinner than this are below the render's own resolution. */
const MIN_THICKNESS_M = 0.05

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: {
    layerId: string
    topDepthM: number
    baseDepthM: number
    formationId: string
    bodyId: string | null
  }[]
}
interface RawArm {
  columns: RawColumn[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}
interface RawSection extends RawArm {
  name: string
  geotech: RawArm
}

/** Nonzero-winding point-in-polygon (x = fraction, y = elevation). */
function inPolygon(
  px: number,
  py: number,
  poly: readonly { fraction: number; elevation: number }[],
): boolean {
  let wn = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a.elevation <= py) {
      if (
        b.elevation > py &&
        (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation) > 0
      )
        wn++
    } else if (
      b.elevation <= py &&
      (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation) < 0
    )
      wn--
  }
  return wn !== 0
}

function assemble(arm: RawArm): { columns: PartitionColumn[]; alongM: number[] } {
  const paired = arm.columns
    .map((c, i) => ({ c, a: arm.alongM[i] }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .sort((p, q) => p.a - q.a)
  return {
    columns: paired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
    })),
    alongM: paired.map(({ a }) => a),
  }
}

const toEdges = (raw: readonly { a: string; b: string; aSide?: string; bSide?: string }[]): CorrelationEdge[] =>
  raw.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))

describe('own-column edge — a test owns the ground beside itself', () => {
  if (process.env.OWN_EDGE !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set OWN_EDGE=1 with the real dump present)', () => {})
    return
  }
  it('every banded column reads its own classes at its own edge', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      refinementBundle: {
        nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
      }
    }
    const packingClassOf = buildPackingClassOf(Object.entries(raw.refinementBundle.nadMeta))
    const lines: string[] = []
    const offenders: string[] = []
    let checked = 0
    for (const sec of raw.sections) {
      const L = assemble(sec)
      if (L.columns.length < 2) continue
      const G = assemble(sec.geotech)
      const geotechColumns = frameAlignedColumns(
        L.columns,
        new Map(G.columns.map((c) => [c.investigationId, c])),
      )
      const lithoEdges = toEdges(sec.edges)
      const out = computeHierarchicalGeotechFill({
        lithoColumns: L.columns,
        lithoEdges,
        lithoRegions: computeSectionFillActive(L.columns, lithoEdges, undefined, L.alongM),
        geotechColumns,
        geotechEdges: toEdges(sec.geotech.edges),
        alongM: L.alongM,
        packingClassOf,
      })
      const paintAt = (gap: number, f: number, e: number): SectionRegion | null => {
        let hit: SectionRegion | null = null
        for (const r of out.regions) if (r.gapIndex === gap && inPolygon(f, e, r.polygon)) hit = r
        return hit
      }
      let sectionChecked = 0
      let sectionWrong = 0
      for (let ci = 0; ci < geotechColumns.length; ci++) {
        const column = geotechColumns[ci]
        for (const unit of column.units) {
          const top = column.surfaceElevM - unit.topDepthM
          const base = column.surfaceElevM - unit.baseDepthM
          if (top - base < MIN_THICKNESS_M) continue
          const mid = (top + base) / 2
          for (const [gap, f] of [
            [ci - 1, 1 - EDGE],
            [ci, EDGE],
          ] as const) {
            if (gap < 0 || gap + 1 >= geotechColumns.length) continue
            // Out of scope where the facing test carries no bands at all — that
            // ground reads visibly empty by the 2026-08-15 ruling.
            const facing = gap === ci ? ci + 1 : gap
            if ((geotechColumns[facing]?.units.length ?? 0) === 0) continue
            const hit = paintAt(gap, f, mid)
            if (hit === null) continue
            sectionChecked++
            // CLASS identity, not row identity (owner 2026-08-21: one mass one
            // body) — a mass welded across a geological boundary carries ONE
            // of its duplicate formation rows, and beside this test that row
            // may be the far column's. Same class = the test's own reading.
            const clsOf = (id: string): string => packingClassOf.get(id) ?? id
            if (clsOf(hit.formationId) === clsOf(unit.formationId)) continue
            sectionWrong++
            offenders.push(
              `${sec.name} col${ci} gap${gap} f=${f} band ${top.toFixed(2)}..${base.toFixed(2)} ` +
                `${unit.formationId.slice(-6)} painted ${hit.formationId.slice(-6)}`,
            )
          }
        }
      }
      checked += sectionChecked
      lines.push(`${sec.name.padEnd(18)} checked=${sectionChecked} wrong=${sectionWrong}`)
    }
    lines.unshift(`TOTAL checked=${checked} wrong=${offenders.length}`)
    writeFileSync(OUT, [...lines, ...offenders].join('\n') + '\n')
    expect(checked).toBeGreaterThan(500)
    // ZERO offenders. The one documented exception (#273's far half — the
    // col19 ZAND-5 band whose ties cross to col20) DISSOLVED with the
    // 2026-08-21 "one mass one body" ruling: its two rows are both ZAND-5, so
    // under class identity the welded mass painting beside col19 IS the
    // test's own reading, and the tie is no longer inert.
    expect(offenders, `a construct painted over a test's own log; details in ${OUT}`).toEqual([])
  })
})
