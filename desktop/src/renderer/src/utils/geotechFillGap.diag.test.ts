/**
 * THROWAWAY DIAG — why do S10↔S6 packing bands pinch on the geotech axis
 * (dogfeed 2026-08-13: SAND-VD/SAND-MD not connecting, SAND-MD not filling the
 * correlation band, upper silts not merging into S6's big silt)?
 *
 * Dormant unless GAP_DIAG=1. Input: scripts/throwaway_geotech_axis_inputs.json
 * (uv run python scripts/dump_geotech_axis_inputs.py first). Writes
 * scripts/throwaway_gap_diag_report.txt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { makePackingTieCounter, type PackingSpanTieKeys } from './geotechPackingTies'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn } from './partitionFill'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
} from './refineLithoPartition'
import type { BodyBoundaryResponse } from '../api/clients/geology.types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const REPORT = resolve(REPO_ROOT, 'scripts/throwaway_gap_diag_report.txt')

const SECTION = 'Cross-section 1'
const COLS = ['GEO-22/115-S10', 'GEO-10/170-S6', 'GEO-10/171-B6']

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
interface RawEdge {
  a: string
  b: string
  aSide?: string
  bSide?: string
}
interface RawSection {
  sectionId: string
  name: string
  columns: RawColumn[]
  edges: RawEdge[]
  alongM: number[]
  geotech: { columns: RawColumn[]; edges: RawEdge[]; alongM: number[] }
  refinement: {
    geotechLayers: {
      id: string
      investigationId: string
      depth_top_m: number
      depth_base_m: number
      formation_id: string
      body_id: string | null
    }[]
  }
}
interface RawFile {
  investigations: { id: string; name: string }[]
  refinementBundle: {
    nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
    lithoSoilByFormationId: Record<string, string | null>
  }
  sections: RawSection[]
}

const toEdges = (raw: readonly RawEdge[]): CorrelationEdge[] =>
  raw.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))

describe('GAP diag — S10/S6/B6 packing fill (real dev model)', () => {
  if (process.env.GAP_DIAG !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set GAP_DIAG=1 + run dump_geotech_axis_inputs.py)', () => {})
    return
  }

  it('reports spans, ties and emitted polygons at gaps 0 and 1', () => {
    process.env.STRIX_PARTITION_V2 = '1'
    const NL = String.fromCharCode(10)
    const rep: string[] = []
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const nameById = new Map(raw.investigations.map((i) => [i.id, i.name]))
    const idByName = new Map(raw.investigations.map((i) => [i.name, i.id]))
    const sec = raw.sections.find((s) => s.name === SECTION)
    if (!sec) throw new Error(`section ${SECTION} not in dump`)

    const nadMeta = new Map<string, NadFormationMeta>(
      Object.entries(raw.refinementBundle.nadMeta).map(([k, v]) => [
        k,
        { nadClass: v.nadClass, soilCode: v.soilCode },
      ]),
    )
    const lithoSoil = new Map<string, string | null>(
      Object.entries(raw.refinementBundle.lithoSoilByFormationId),
    )
    const clsOf = (fid: string): string => {
      const m = nadMeta.get(fid)
      if (m) return `${m.soilCode ?? '?'}/n${m.nadClass ?? '?'}`
      if (lithoSoil.has(fid)) return `LITHO/${lithoSoil.get(fid) ?? '?'}`
      return `UNKNOWN/${fid.slice(-6)}`
    }

    // ---- litho partition (render arm, harness-identical assembly) ---------
    const paired = sec.columns
      .map((c, i) => ({ c, a: sec.alongM[i] }))
      .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
      .sort((p, q) => p.a - q.a)
    const columns: PartitionColumn[] = paired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
    }))
    const alongM = paired.map(({ a }) => a)
    const lithoEdges = toEdges(sec.edges)
    const overrides = deriveSectionApexOverrides(
      columns,
      lithoEdges,
      alongM,
      new Map<string, BodyBoundaryResponse>(),
      true,
    )
    const regions = computeSectionFillActive(columns, lithoEdges, overrides, alongM)

    // ---- geotech columns ---------------------------------------------------
    const geoByInv = new Map<string, GeotechColumn['units'][number][]>()
    for (const l of sec.refinement.geotechLayers) {
      const arr = geoByInv.get(l.investigationId) ?? []
      arr.push({
        layerId: l.id,
        topDepthM: l.depth_top_m,
        baseDepthM: l.depth_base_m,
        formationId: l.formation_id,
        bodyId: l.body_id ?? null,
      })
      geoByInv.set(l.investigationId, arr)
    }
    const columnOrder = columns.map((c) => c.investigationId)
    const geoColByInv = new Map<string, GeotechColumn>()
    for (const c of columns) {
      geoColByInv.set(c.investigationId, {
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM,
        units: [...(geoByInv.get(c.investigationId) ?? [])].sort(
          (a, b) => a.topDepthM - b.topDepthM,
        ),
      })
    }
    const packingEdges = toEdges(sec.geotech.edges)

    // ---- column stacks -----------------------------------------------------
    const ids = COLS.map((n) => idByName.get(n) ?? '?')
    rep.push(`column order: ${columnOrder.map((c) => nameById.get(c) ?? c.slice(-6)).join(' | ')}`)
    for (const [ci, name] of COLS.entries()) {
      const g = geoColByInv.get(ids[ci])
      rep.push(`${NL}=== ${name} geotech stack (surf ${g?.surfaceElevM.toFixed(2)}) ===`)
      for (const u of g?.units ?? []) {
        rep.push(
          `  ${(g!.surfaceElevM - u.topDepthM).toFixed(2)}..${(g!.surfaceElevM - u.baseDepthM).toFixed(2)}  ` +
            `${clsOf(u.formationId).padEnd(12)} layer=${u.layerId.slice(-6)} body=${u.bodyId?.slice(-6) ?? '-'}`,
        )
      }
    }

    // ---- geotech edges between the three columns ---------------------------
    const layerCol = new Map<string, string>()
    for (const l of sec.refinement.geotechLayers) layerCol.set(l.id, l.investigationId)
    const layerCls = new Map<string, string>()
    const layerElev = new Map<string, string>()
    for (const l of sec.refinement.geotechLayers) {
      layerCls.set(l.id, clsOf(l.formation_id))
      const se = geoColByInv.get(l.investigationId)?.surfaceElevM ?? 0
      layerElev.set(l.id, `${(se - l.depth_top_m).toFixed(2)}..${(se - l.depth_base_m).toFixed(2)}`)
    }
    for (const [li, ri] of [
      [ids[0], ids[1]],
      [ids[1], ids[2]],
    ]) {
      rep.push(
        `${NL}=== geotech edges ${nameById.get(li)} <-> ${nameById.get(ri)} (of ${packingEdges.length} on section) ===`,
      )
      for (const e of packingEdges) {
        const ca = layerCol.get(e.a)
        const cb = layerCol.get(e.b)
        const hit = (ca === li && cb === ri) || (ca === ri && cb === li)
        if (!hit) continue
        rep.push(
          `  ${e.a.slice(-6)}(${layerCls.get(e.a)} ${layerElev.get(e.a)} ${e.aSide}) <-> ` +
            `${e.b.slice(-6)}(${layerCls.get(e.b)} ${layerElev.get(e.b)} ${e.bSide})`,
        )
      }
    }

    // ---- tie-counter over whole-column class runs --------------------------
    const tied = makePackingTieCounter(packingEdges)
    interface Run extends PackingSpanTieKeys {
      cls: string
      soil: string | null
      topElev: number
      baseElev: number
    }
    const runsOf = (invId: string): Run[] => {
      const g = geoColByInv.get(invId)
      if (!g) return []
      const stack = [...g.units].sort((a, b) => a.topDepthM - b.topDepthM)
      const runs: Run[] = []
      for (let i = 0; i < stack.length; i++) {
        const u = stack[i]
        const cls = clsOf(u.formationId)
        const soil = nadMeta.get(u.formationId)?.soilCode ?? null
        const last = runs[runs.length - 1]
        if (last && last.cls === cls) {
          last.baseElev = g.surfaceElevM - u.baseDepthM
          last.baseLayerId = u.layerId
          last.belowLayerId = stack[i + 1]?.layerId ?? null
        } else {
          runs.push({
            cls,
            soil,
            topElev: g.surfaceElevM - u.topDepthM,
            baseElev: g.surfaceElevM - u.baseDepthM,
            topLayerId: u.layerId,
            baseLayerId: u.layerId,
            belowLayerId: stack[i + 1]?.layerId ?? null,
          })
        }
      }
      return runs
    }
    for (const [li, ri] of [
      [ids[0], ids[1]],
      [ids[1], ids[2]],
    ]) {
      rep.push(`${NL}=== tie counts ${nameById.get(li)} <-> ${nameById.get(ri)} (same-class run pairs) ===`)
      for (const a of runsOf(li))
        for (const b of runsOf(ri)) {
          if (a.cls !== b.cls) continue
          const n = tied(a, b)
          rep.push(
            `  ${a.cls.padEnd(12)} L ${a.topElev.toFixed(2)}..${a.baseElev.toFixed(2)} ` +
              `(top=${a.topLayerId.slice(-6)} below=${a.belowLayerId?.slice(-6) ?? 'null'}) | ` +
              `R ${b.topElev.toFixed(2)}..${b.baseElev.toFixed(2)} ` +
              `(top=${b.topLayerId.slice(-6)} below=${b.belowLayerId?.slice(-6) ?? 'null'}) -> ties=${n}`,
          )
        }
    }

    // ---- litho regions + refined polygons at gaps 0/1 ----------------------
    const refined = refineLithoPartition(regions, columnOrder, geoColByInv, nadMeta, lithoSoil, {
      alongM,
      packingEdges,
    })
    for (const gap of [0, 1]) {
      rep.push(`${NL}=== gap ${gap} litho regions ===`)
      for (const r of regions) {
        if (r.gapIndex !== gap) continue
        const es = r.polygon.map((p) => p.elevation)
        rep.push(
          `  kind=${r.kind.padEnd(6)} soil=${lithoSoil.get(r.formationId) ?? '?'} ` +
            `elev=[${Math.min(...es).toFixed(2)}..${Math.max(...es).toFixed(2)}]`,
        )
      }
      rep.push(`${NL}=== gap ${gap} refined polygons ===`)
      const agg = new Map<string, { n: number; area: number; emin: number; emax: number }>()
      for (const p of refined) {
        if (p.gapIndex !== gap) continue
        const key = `${clsOf(p.formationId)} tag=${p.tag} rk=${p.regionKind}`
        let area = 0
        for (let q = 0; q < p.points.length; q++) {
          const b = p.points[(q + 1) % p.points.length]
          area += p.points[q].fraction * b.elevation - b.fraction * p.points[q].elevation
        }
        area = Math.abs(area) / 2
        const es = p.points.map((x) => x.elevation)
        const cur = agg.get(key) ?? { n: 0, area: 0, emin: Infinity, emax: -Infinity }
        cur.n++
        cur.area += area
        cur.emin = Math.min(cur.emin, ...es)
        cur.emax = Math.max(cur.emax, ...es)
        agg.set(key, cur)
      }
      const rows = [...agg.entries()].sort((a, b) => b[1].area - a[1].area)
      for (const [key, v] of rows)
        rep.push(
          `  ${key.padEnd(40)} n=${String(v.n).padStart(3)} area=${v.area.toFixed(3)} ` +
            `elev=[${v.emin.toFixed(2)}..${v.emax.toFixed(2)}]`,
        )
    }

    writeFileSync(REPORT, rep.join(NL))

    // ---- polygon dump for the visual companion -----------------------------
    // Three variants at gaps 0/1:
    //   render  — the shipped render arm (litho partition + fraction refinement)
    //   direct  — the BUILD arm's engine run: computeSectionFill(GEOTECH cols,
    //             GEOTECH edges) — the owner's "same engine, more classes"
    //   fixed   — direct + the 3 restatement edges the derivation fails to
    //             create today (cross-class topmost + base-base), to show what
    //             the fill looks like once the derivation defect is fixed.
    interface DumpPoly {
      cls: string
      kind: string
      pts: [number, number][]
    }
    const dumpRegions = (regs: readonly (typeof regions)[number][]): DumpPoly[][] =>
      [0, 1].map((gap) =>
        regs
          .filter((r) => r.gapIndex === gap)
          .map((r) => ({
            cls: clsOf(r.formationId),
            kind: r.kind,
            pts: r.polygon.map((p) => [p.fraction, p.elevation] as [number, number]),
          })),
      )

    const geoPaired = sec.geotech.columns
      .map((c, i) => ({ c, a: sec.geotech.alongM[i] }))
      .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
      .sort((p, q) => p.a - q.a)
    const geoColumns: PartitionColumn[] = geoPaired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
    }))
    const geoAlongM = geoPaired.map(({ a }) => a)
    const geoOverrides = deriveSectionApexOverrides(
      geoColumns,
      packingEdges,
      geoAlongM,
      new Map<string, BodyBoundaryResponse>(),
      true,
    )
    const direct = computeSectionFillActive(geoColumns, packingEdges, geoOverrides, geoAlongM)

    // The 3 restatements the derivation cannot produce today (by layer suffix).
    const bySuffix = new Map<string, string>()
    for (const l of sec.refinement.geotechLayers) bySuffix.set(l.id.slice(-6), l.id)
    const fixEdges: CorrelationEdge[] = [
      // clay topmost<->topmost, cross-class n23<->n22 (restates the litho clay tie)
      { a: bySuffix.get('72d57f')!, b: bySuffix.get('38255f')!, aSide: 'top', bSide: 'top' },
      // clay base<->base (restates the litho bottom tie, deepest bands)
      { a: bySuffix.get('72d57f')!, b: bySuffix.get('600806')!, aSide: 'base', bSide: 'base' },
      // silt topmost<->topmost, cross-class n14<->n13 (restates the big-silt tie)
      { a: bySuffix.get('359097')!, b: bySuffix.get('0a5f02')!, aSide: 'top', bSide: 'top' },
    ]
    const fixedAll = [...packingEdges, ...fixEdges]
    const fixedOverrides = deriveSectionApexOverrides(
      geoColumns,
      fixedAll,
      geoAlongM,
      new Map<string, BodyBoundaryResponse>(),
      true,
    )
    const fixed = computeSectionFillActive(geoColumns, fixedAll, fixedOverrides, geoAlongM)

    const refinedDump: DumpPoly[][] = [0, 1].map((gap) =>
      refined
        .filter((p) => p.gapIndex === gap)
        .map((p) => ({
          cls: clsOf(p.formationId),
          kind: p.tag,
          pts: p.points.map((q) => [q.fraction, q.elevation] as [number, number]),
        })),
    )
    writeFileSync(
      resolve(REPO_ROOT, 'scripts/throwaway_gap_diag_polys.json'),
      JSON.stringify(
        { render: refinedDump, direct: dumpRegions(direct), fixed: dumpRegions(fixed) },
        null,
        1,
      ),
    )
    expect(true).toBe(true)
  })
})
