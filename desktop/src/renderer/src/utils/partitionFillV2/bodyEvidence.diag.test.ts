/**
 * THROWAWAY DIAG — which layer groups does the body-recompute evidence see
 * on the real dev model, and why do GEO-22/115-S10's middle silts not join
 * GEO-10/170-S6's big silt (dogfeed 2026-08-12 evening)?
 *
 * Dormant unless BODY_DIAG=1. Input: scripts/diag_allsections_input.json
 * (uv run python scripts/diag_allsections_extract.py first).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { CorrelationEdge, PartitionColumn } from '../sectionPartition'
import { computeSectionFillActiveWithIdentity } from '../partitionEngineSelect'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

const S6_BIG_SILT = '019ea42d-dd95-7bc6-916a-a415d7e196ff' // GEO-10/170-S6 1.52-7.74
const S10_MIDDLE_SILTS = [
  '019ea42d-ddd5-71cf-9f82-aa71c8fb53aa', // 2.52-2.90
  '019ea42d-ddd7-73e1-8930-892ec26f2456', // 4.73-5.35
  '019ea42d-ddd9-78f2-a886-c20030db82af', // 6.59-7.11
]

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawCol {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
interface RawSection {
  sectionId: string
  name: string
  columns: RawCol[]
  edges: CorrelationEdge[]
  alongM: number[]
}

describe('BODY-EVIDENCE diagnostic (real dev model)', () => {
  if (process.env.BODY_DIAG !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set BODY_DIAG=1 + run diag_allsections_extract.py)', () => {})
    return
  }

  it('reports the silt groups + the regions carrying the S10<->S6 connection', () => {
    const NL = String.fromCharCode(10)
    const report: string[] = []
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const interesting = new Set([S6_BIG_SILT, ...S10_MIDDLE_SILTS])

    for (const sec of raw.sections) {
      const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null)
      const columns: PartitionColumn[] = keep.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: c.units,
      }))
      const alongM = keep.map(({ i }) => sec.alongM[i])
      const hasInteresting = columns.some((c) => c.units.some((u) => interesting.has(u.layerId)))
      if (!hasInteresting) continue

      const { regions, groups } = computeSectionFillActiveWithIdentity(
        columns,
        sec.edges,
        undefined,
        alongM,
      )

      // eslint-disable-next-line no-console
      console.log(`\n=== ${sec.name} (${sec.sectionId.slice(0, 8)}) ===`)
      for (const g of groups) {
        const hits = g.filter((l) => interesting.has(l))
        if (hits.length) {
          report.push(`group[${g.length} layers] contains: ${hits.map((h) => h.slice(-6)).join(', ')}`)
        }
      }
      // Every region that names an interesting layer OR is a silt region
      // adjoining them: dump kind + fallback + layerIds so the exclusion is
      // visible.
      for (const r of regions) {
        const withLayers = r as typeof r & { layerIds?: string[]; fallback?: true }
        const names = (withLayers.layerIds ?? []).filter((l) => interesting.has(l))
        if (names.length) {
          report.push(
            `region gap=${r.gapIndex} kind=${r.kind} fallback=${withLayers.fallback ?? false} ` +
              `layers=[${(withLayers.layerIds ?? []).map((l) => l.slice(-6)).join(',')}]`,
          )
        }
      }
      // Also count fallback silt regions per gap, since excluded regions carry
      // the suspicion.
      const fallbackByGap = new Map<number, number>()
      for (const r of regions) {
        const wl = r as typeof r & { fallback?: true }
        if (wl.fallback) fallbackByGap.set(r.gapIndex, (fallbackByGap.get(r.gapIndex) ?? 0) + 1)
      }
      report.push(
        `fallback regions by gap: ${[...fallbackByGap.entries()].map(([g, n]) => `${g}:${n}`).join(' ')}`,
      )

      // FULL dump of the S10-S6 gap: every region between those two columns,
      // whatever its formation, with kind/fallback/layerIds.
      const S10 = '019e932e-7c4a-75e4-bc8c-59ce4ba1231c'
      const S6 = '019e932e-7c3b-7b48-988d-6727fe9e85c9'
      const invIndex = columns.map((c) => c.investigationId)
      const i10 = invIndex.indexOf(S10)
      const i6 = invIndex.indexOf(S6)
      if (i10 >= 0 && i6 >= 0 && Math.abs(i10 - i6) === 1) {
        const gap = Math.min(i10, i6)
        report.push(`--- S10-S6 gap = ${gap} (S10 at ${i10}, S6 at ${i6}) ---`)
        for (const r of regions) {
          if (r.gapIndex !== gap) continue
          const wl = r as typeof r & { layerIds?: string[]; fallback?: true }
          const elevs = r.polygon.map((pt) => pt.elevation)
          report.push(
            `gap-region kind=${r.kind} fallback=${wl.fallback ?? false} ` +
              `formation=${r.formationId.slice(-6)} elev=[${Math.min(...elevs).toFixed(1)}..${Math.max(...elevs).toFixed(1)}] ` +
              `layers=[${(wl.layerIds ?? []).map((l) => l.slice(-6)).join(',')}]`,
          )
        }
      } else {
        report.push(`--- S10 idx=${i10} S6 idx=${i6} (not adjacent here) ---`)
      }
    }
    writeFileSync(resolve(REPO_ROOT, 'scripts/throwaway_body_evidence_report.txt'), report.join(NL))
    expect(true).toBe(true)
  })
})
