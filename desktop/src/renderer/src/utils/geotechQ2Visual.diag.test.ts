/**
 * Q2 VISUAL DUMPER — one-shot throwaway for the 2026-08-04 owner decision
 * "may a region borrow packing from the far side of its gap?"
 *
 * Runs the geotech RENDER arm (the shipped engine, exactly as
 * ``geotechFallbackCause.diag.test.ts`` assembles it) over every section of the
 * real extract and dumps the refined polygons with resolved fill colours to
 * ``scripts/throwaway_q2_render_<variant>.json``. Run once on the clean tree
 * (variant ``today``), once with the borrow patch applied to
 * ``refineLithoPartition.ts`` (variant ``borrow``); the HTML visual aid diffs
 * the two files.
 *
 * Pure reporter — never fails the suite. Dormant unless ``GEOTECH_Q2=1``.
 *
 *   cd desktop
 *   GEOTECH_Q2=1 Q2_VARIANT=today npx vitest run \
 *     src/renderer/src/utils/geotechQ2Visual.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, it } from 'vitest'

import type { CorrelationEdge, PartitionColumn } from './partitionFill'
import { computeSectionFillActive } from './partitionEngineSelect'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
} from './refineLithoPartition'
import { nadClassColor, nadClassName } from './nadClasses'
import { soilStyle } from './soilColors'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')

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
  name: string
  columns: RawColumn[]
  edges: RawEdge[]
  alongM: number[]
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
  refinementBundle: {
    nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
    lithoSoilByFormationId: Record<string, string | null>
  }
  sections: RawSection[]
}

describe('geotech Q2 visual dump', () => {
  it.skipIf(process.env.GEOTECH_Q2 !== '1')('dumps refined render polygons per section', () => {
    if (!existsSync(INPUT)) {
      throw new Error(
        `${INPUT} not found — run 'uv run python scripts/dump_geotech_axis_inputs.py' first.`,
      )
    }
    const variant = process.env.Q2_VARIANT ?? 'today'
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const nadMeta = new Map<string, NadFormationMeta>(
      Object.entries(raw.refinementBundle.nadMeta).map(([k, v]) => [
        k,
        { nadClass: v.nadClass, soilCode: v.soilCode },
      ]),
    )
    const lithoSoil = new Map<string, string | null>(
      Object.entries(raw.refinementBundle.lithoSoilByFormationId),
    )

    const sectionsOut: unknown[] = []
    let totalFallbackM2 = 0

    for (const sec of raw.sections) {
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
      if (columns.length < 2) continue
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))

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
      const geoCols = new Map<string, GeotechColumn>()
      for (const c of columns) {
        geoCols.set(c.investigationId, {
          investigationId: c.investigationId,
          surfaceElevM: c.surfaceElevM,
          units: geoByInv.get(c.investigationId) ?? [],
        })
      }

      const regions = computeSectionFillActive(columns, edges, undefined, alongM)
      const refined = refineLithoPartition(regions, columnOrder, geoCols, nadMeta, lithoSoil)

      let sectionFallbackM2 = 0
      const polys: unknown[] = []
      for (const p of refined) {
        const left = alongM[p.gapIndex]
        const right = alongM[p.gapIndex + 1]
        if (left === undefined || right === undefined || right <= left) continue
        const pts = p.points.map((q) => [
          Number((left + q.fraction * (right - left)).toFixed(3)),
          Number(q.elevation.toFixed(3)),
        ])
        let a2 = 0
        for (let i = 0; i < pts.length; i++) {
          const b = pts[(i + 1) % pts.length]
          a2 += pts[i][0] * b[1] - b[0] * pts[i][1]
        }
        const areaM2 = Math.abs(a2) / 2
        const meta = nadMeta.get(p.formationId)
        const isFallback = p.tag === 'fallback'
        if (isFallback) {
          sectionFallbackM2 += areaM2
          totalFallbackM2 += areaM2
        }
        const soil = isFallback
          ? (lithoSoil.get(p.formationId) ?? null)
          : (meta?.soilCode ?? null)
        polys.push({
          tag: p.tag,
          soil,
          nad: isFallback ? null : (meta?.nadClass ?? null),
          label: isFallback
            ? `${soil ?? '?'} (no packing painted)`
            : `${soil ?? '?'} — ${nadClassName(meta?.nadClass)}`,
          color: isFallback ? soilStyle(soil).fill : nadClassColor(meta?.nadClass),
          areaM2: Number(areaM2.toFixed(2)),
          pts,
        })
      }

      sectionsOut.push({
        name: sec.name,
        alongMinM: Math.min(...alongM),
        alongMaxM: Math.max(...alongM),
        columns: columns.map((c, i) => ({
          inv: c.investigationId,
          alongM: Number(alongM[i].toFixed(2)),
          surfaceElevM: Number(c.surfaceElevM.toFixed(2)),
          classified: (geoCols.get(c.investigationId)?.units.length ?? 0) > 0,
        })),
        fallbackM2: Number(sectionFallbackM2.toFixed(1)),
        polys,
      })
      console.log(`${sec.name}: polys=${polys.length} fallback=${sectionFallbackM2.toFixed(1)} m2`)
    }

    const outPath = resolve(REPO_ROOT, `scripts/throwaway_q2_render_${variant}.json`)
    writeFileSync(
      outPath,
      JSON.stringify({ variant, totalFallbackM2: Number(totalFallbackM2.toFixed(1)), sections: sectionsOut }),
    )
    console.log(`TOTAL fallback ${totalFallbackM2.toFixed(1)} m2 -> ${outPath}`)
  })
})
