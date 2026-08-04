/**
 * WHY the geotech render arm draws plain lithology where the build assigns a
 * packing class.
 *
 * The agreement gate (``geotechEngineAgreement.diag.test.ts``) reports a large
 * ``LITHO-FALLBACK/*`` area: polygons ``refineLithoPartition`` tagged
 * ``fallback``, meaning it found no NAD sub-band of the litho region's soil code
 * at that region's elevations anywhere in the section, so it painted the litho
 * region in lithology colour. The build arm has no such state — it partitions the
 * geotech layers directly and every region carries a class. The gate measures the
 * area; it does not say whether the render is right to give up there.
 *
 * This probe answers exactly that, per fallback polygon, by asking what geotech
 * sub-bands actually exist at those elevations:
 *
 *   SOIL-GUARD    bands of a DIFFERENT soil code overlap the region's elevations
 *                 — the two levels disagree about the LITHOLOGY there, and the
 *                 refinement's soil guard (``makeClassSlicesElev``) is what turns
 *                 that disagreement into a fallback;
 *   NO-DATA       no band of ANY soil code overlaps those elevations anywhere in
 *                 the section — the section genuinely has no packing information
 *                 there;
 *   MISSED        bands of the SAME soil code do overlap and the refinement still
 *                 fell back — that would be a defect in the refinement, not a
 *                 data fact.
 *
 * Deliberately INDEPENDENT of the agreement gate: it re-derives the arms from the
 * same extract with its own small helpers rather than importing the gate's, for
 * the same reason the refutation probes do — a shared helper would let one bug
 * agree with itself. The only shared code is the production engine itself.
 *
 * Pure reporter — never fails the suite. Dormant unless ``GEOTECH_FALLBACK=1``.
 *
 * Input: ``scripts/throwaway_geotech_axis_inputs.json``
 * (``uv run python scripts/dump_geotech_axis_inputs.py``, read-only).
 *
 * Run:
 *   cd desktop
 *   GEOTECH_FALLBACK=1 npx vitest run \
 *     src/renderer/src/utils/geotechFallbackCause.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { CorrelationEdge, PartitionColumn } from './partitionFill'
import { computeSectionFillActive } from './partitionEngineSelect'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
} from './refineLithoPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')

/** Elevation slack (metres) the refinement itself uses when testing overlap. */
const OVERLAP_EPS_M = 0.02

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

/** Fixed-width number for a readable column. */
const fmt = (n: number, d = 1): string => n.toFixed(d)

describe('geotech fallback cause', () => {
  it.skipIf(process.env.GEOTECH_FALLBACK !== '1')(
    'classifies every litho-fallback polygon against the packing data that exists',
    () => {
      if (!existsSync(INPUT)) {
        throw new Error(
          `${INPUT} not found — run 'uv run python scripts/dump_geotech_axis_inputs.py' first.`,
        )
      }
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

      let soilGuard = 0
      let noData = 0
      let missed = 0
      let soilGuardArea = 0
      let noDataArea = 0
      let missedArea = 0
      const guardPairs = new Map<string, number>()
      const missedReasons = new Map<string, number>()
      const worst: { section: string; kind: string; soil: string; area: number; note: string }[] = []

      console.log('')
      console.log('='.repeat(96))
      console.log('WHY THE GEOTECH RENDER FALLS BACK TO LITHOLOGY COLOUR')
      console.log('='.repeat(96))

      for (const sec of raw.sections) {
        // Arm assembly (mirrors assembleSectionPartitionInput).
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

        // Every sub-band of the section in ABSOLUTE elevations, so an overlap
        // test needs no column bookkeeping.
        const allBands: { soil: string | null; top: number; base: number; inv: string }[] = []
        for (const c of columns) {
          const g = geoCols.get(c.investigationId)
          if (!g) continue
          for (const u of g.units) {
            allBands.push({
              soil: nadMeta.get(u.formationId)?.soilCode ?? null,
              top: c.surfaceElevM - u.topDepthM,
              base: c.surfaceElevM - u.baseDepthM,
              inv: c.investigationId,
            })
          }
        }

        const regions = computeSectionFillActive(columns, edges, undefined, alongM)
        const refined = refineLithoPartition(regions, columnOrder, geoCols, nadMeta, lithoSoil, {
          alongM,
        })

        // The refinement's own lookup, reproduced so the probe can say WHICH of
        // its conditions declined. Mirrors ``makeClassSlicesElev``'s filter:
        // any overlap of more than 2 cm, restricted to the region's soil code.
        const hasBands = (colIx: number, top: number, base: number, soil: string | null): boolean => {
          if (top - base <= OVERLAP_EPS_M) return false
          const c = columns[colIx]
          if (!c) return false
          const g = geoCols.get(c.investigationId)
          if (!g) return false
          return g.units.some((u) => {
            const meta = nadMeta.get(u.formationId)
            if (soil != null && (meta?.soilCode ?? null) !== soil) return false
            const tE = c.surfaceElevM - u.topDepthM
            const bE = c.surfaceElevM - u.baseDepthM
            return tE > base + OVERLAP_EPS_M && bE < top - OVERLAP_EPS_M
          })
        }
        /** Vertical extent of a region polygon at gap fraction ``f``, or null. */
        const envAt = (
          poly: readonly { fraction: number; elevation: number }[],
          f: number,
        ): [number, number] | null => {
          const hits: number[] = []
          for (let i = 0; i < poly.length; i++) {
            const a = poly[i]
            const b = poly[(i + 1) % poly.length]
            const df = b.fraction - a.fraction
            if (Math.abs(df) < 1e-9) continue
            const t = (f - a.fraction) / df
            if (t >= -1e-9 && t <= 1 + 1e-9) hits.push(a.elevation + t * (b.elevation - a.elevation))
          }
          if (hits.length < 2) return null
          hits.sort((p2, q2) => q2 - p2)
          const parts: [number, number][] = []
          for (let i = 0; i + 1 < hits.length; i += 2) {
            if (hits[i] - hits[i + 1] > 0.02) parts.push([hits[i], hits[i + 1]])
          }
          if (parts.length === 0) return null
          return [parts[0][0], parts[parts.length - 1][1]]
        }

        for (const p of refined) {
          if (p.tag !== 'fallback') continue
          const left = alongM[p.gapIndex]
          const right = alongM[p.gapIndex + 1]
          if (left === undefined || right === undefined || right <= left) continue
          // Shoelace area in (along metres, elevation).
          const pts = p.points.map((q) => ({
            x: left + q.fraction * (right - left),
            e: q.elevation,
          }))
          let a2 = 0
          for (let i = 0; i < pts.length; i++) {
            const b = pts[(i + 1) % pts.length]
            a2 += pts[i].x * b.e - b.x * pts[i].e
          }
          const area = Math.abs(a2) / 2
          const top = Math.max(...pts.map((q) => q.e))
          const base = Math.min(...pts.map((q) => q.e))
          const soil = lithoSoil.get(p.formationId) ?? null

          const overlapping = allBands.filter(
            (b) => b.top > base + OVERLAP_EPS_M && b.base < top - OVERLAP_EPS_M,
          )
          const same = overlapping.filter((b) => b.soil === soil)
          const other = overlapping.filter((b) => b.soil !== soil)
          if (same.length > 0) {
            missed += 1
            missedArea += area
            // Sub-classify against the refinement's OWN sampling: it samples the
            // packing at the region's two gap edges only, and each side's outward
            // scan searches ONE direction (left side leftward, right side
            // rightward). Naming which of those declined is the difference
            // between a window bug and a direction bug.
            // Mirror the production sampling: the two gap edges, falling back to
            // the region's own extent when it touches neither.
            let s0 = envAt(p.points, 0)
            let s1 = envAt(p.points, 1)
            if (s0 === null && s1 === null) {
              const fr = p.points.map((q) => q.fraction)
              s0 = envAt(p.points, Math.min(...fr))
              s1 = envAt(p.points, Math.max(...fr))
            }
            let reason: string
            if (!s0 && !s1) {
              reason = 'no vertical extent anywhere across the region — nothing to sample'
            } else {
              const inWindow = (env: [number, number] | null): number[] =>
                env === null
                  ? []
                  : columns.map((_c, ix) => ix).filter((ix) => hasBands(ix, env[0], env[1], soil))
              const leftHits = inWindow(s0)
              const rightHits = inWindow(s1)
              const leftReach = leftHits.filter((ix) => ix <= p.gapIndex)
              const rightReach = rightHits.filter((ix) => ix >= p.gapIndex + 1)
              if (leftReach.length > 0 || rightReach.length > 0) {
                reason = `refinement SHOULD have found data (cols ${[...leftReach, ...rightReach].join(',')})`
              } else if (leftHits.length > 0 || rightHits.length > 0) {
                reason =
                  `same-soil data exists only on the side the one-directional scan does not ` +
                  `search (cols ${[...new Set([...leftHits, ...rightHits])].join(',')}, gap ` +
                  `${p.gapIndex})`
              } else {
                reason =
                  `no column carries same-soil packing inside the region's EDGE envelopes ` +
                  `(${s0 ? `${fmt(s0[1], 2)}..${fmt(s0[0], 2)}` : 'none'} left, ` +
                  `${s1 ? `${fmt(s1[1], 2)}..${fmt(s1[0], 2)}` : 'none'} right) although ` +
                  `${same.length} overlap its bounding box`
              }
            }
            missedReasons.set(
              reason.split('(')[0].trim(),
              (missedReasons.get(reason.split('(')[0].trim()) ?? 0) + area,
            )
            worst.push({
              section: sec.name,
              kind: 'MISSED',
              soil: soil ?? '?',
              area,
              note: reason,
            })
          } else if (other.length > 0) {
            soilGuard += 1
            soilGuardArea += area
            const soils = [...new Set(other.map((b) => b.soil ?? '?'))].sort().join('+')
            guardPairs.set(`${soil ?? '?'} region over ${soils} packing`, (guardPairs.get(`${soil ?? '?'} region over ${soils} packing`) ?? 0) + area)
            worst.push({
              section: sec.name,
              kind: 'SOIL-GUARD',
              soil: soil ?? '?',
              area,
              note: `only ${soils} bands at ${fmt(base, 2)}..${fmt(top, 2)} m`,
            })
          } else {
            noData += 1
            noDataArea += area
            worst.push({
              section: sec.name,
              kind: 'NO-DATA',
              soil: soil ?? '?',
              area,
              note: `no band of any soil at ${fmt(base, 2)}..${fmt(top, 2)} m`,
            })
          }
        }
      }

      const totalArea = soilGuardArea + noDataArea + missedArea
      console.log(`  fallback polygons: ${soilGuard + noData + missed}, total ${fmt(totalArea)} m2`)
      console.log('')
      console.log(
        `  SOIL-GUARD  ${String(soilGuard).padStart(4)} polys  ${fmt(soilGuardArea).padStart(9)} m2  ` +
          `— packing exists there but of a DIFFERENT soil: the litho region and the geotech ` +
          `bands disagree about the lithology`,
      )
      console.log(
        `  NO-DATA     ${String(noData).padStart(4)} polys  ${fmt(noDataArea).padStart(9)} m2  ` +
          `— no sub-band of any soil overlaps those elevations anywhere in the section`,
      )
      console.log(
        `  MISSED      ${String(missed).padStart(4)} polys  ${fmt(missedArea).padStart(9)} m2  ` +
          `— same-soil packing DOES overlap and the refinement fell back anyway (a defect)`,
      )
      if (missedReasons.size > 0) {
        console.log('')
        console.log('  MISSED breakdown — which of the refinement\'s own samples declined:')
        for (const [k, v] of [...missedReasons.entries()].sort((a, b) => b[1] - a[1])) {
          console.log(`    ${fmt(v).padStart(9)} m2  ${k}`)
        }
      }
      if (guardPairs.size > 0) {
        console.log('')
        console.log('  soil-guard breakdown (litho region soil over the packing soil present):')
        for (const [k, v] of [...guardPairs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
          console.log(`    ${fmt(v).padStart(9)} m2  ${k}`)
        }
      }
      console.log('')
      console.log('  largest individual fallback polygons:')
      for (const w of worst.sort((a, b) => b.area - a.area).slice(0, 15)) {
        console.log(
          `    ${fmt(w.area).padStart(8)} m2  ${w.kind.padEnd(10)} ${w.soil.padEnd(5)} ` +
            `${w.section.padEnd(18)} ${w.note}`,
        )
      }
      console.log('='.repeat(96))
      console.log('')

      expect(soilGuard + noData + missed).toBeGreaterThanOrEqual(0)
    },
    600_000,
  )
})
