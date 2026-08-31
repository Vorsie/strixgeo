/**
 * THROWAWAY DIAG — inspect the geotech-axis fill at the S10/S6/B6 gaps
 * (born on the 2026-08-13 dogfeed: SAND-VD/SAND-MD not connecting, SAND-MD
 * not filling the correlation band, upper silts not merging).
 *
 * The fraction-space refinement arm is deleted (#270) — the geotech axis
 * renders the DIRECT partition, so the variants here are direct / fixed /
 * litho only.
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
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn } from './partitionFill'
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

interface GeoStackUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface GeoStack {
  investigationId: string
  surfaceElevM: number
  units: GeoStackUnit[]
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

  it('reports stacks, edges and emitted polygons at gaps 0 and 1', () => {
    const NL = String.fromCharCode(10)
    const rep: string[] = []
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const nameById = new Map(raw.investigations.map((i) => [i.id, i.name]))
    const idByName = new Map(raw.investigations.map((i) => [i.name, i.id]))
    const sec = raw.sections.find((s) => s.name === SECTION)
    if (!sec) throw new Error(`section ${SECTION} not in dump`)

    const nadMeta = new Map(Object.entries(raw.refinementBundle.nadMeta))
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
    )
    const regions = computeSectionFillActive(columns, lithoEdges, overrides, alongM)

    // ---- geotech stacks ----------------------------------------------------
    const geoByInv = new Map<string, GeoStackUnit[]>()
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
    const geoColByInv = new Map<string, GeoStack>()
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
    const columnOrder = columns.map((c) => c.investigationId)
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

    // ---- litho regions at gaps 0/1 -----------------------------------------
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
    }

    writeFileSync(REPORT, rep.join(NL))

    // ---- polygon dump for the visual companion -----------------------------
    // Variants at gaps 0/1:
    //   direct  — the shipped path: computeSectionFill(GEOTECH cols, GEOTECH
    //             edges) — the owner's "same engine, more classes"
    //   fixed   — direct + the 3 restatement edges the derivation could not
    //             create before 2026-08-13 (kept as a what-if reference)
    //   litho   — the litho partition the frame clip holds the fill to
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
    )
    const direct = computeSectionFillActive(geoColumns, packingEdges, geoOverrides, geoAlongM)

    // The 3 restatements the derivation could not produce before 2026-08-13
    // (by layer suffix), kept so the dump still renders the what-if variant.
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
    )
    const fixed = computeSectionFillActive(geoColumns, fixedAll, fixedOverrides, geoAlongM)

    writeFileSync(
      resolve(REPO_ROOT, 'scripts/throwaway_gap_diag_polys.json'),
      JSON.stringify(
        {
          direct: dumpRegions(direct),
          fixed: dumpRegions(fixed),
          litho: dumpRegions(regions),
          alongM,
        },
        null,
        1,
      ),
    )
    expect(true).toBe(true)
  })
})
