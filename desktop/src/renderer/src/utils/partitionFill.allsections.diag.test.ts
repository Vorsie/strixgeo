/**
 * THROWAWAY DIAG — all-sections tie-straddle hunt (owner report 2026-07-13:
 * "lithologies are still spilling over correlation bands in the fill").
 *
 * Runs computeSectionFill on EVERY section of the live model (input extracted
 * by scripts/diag_allsections_extract.py) and reports every region whose
 * interior sits on BOTH sides of a cross-lithology surface tie, at two
 * margins: 0.05 m (anything visible) and 0.2 m (the cs1tiecross gate's
 * threshold). Pure reporter — never fails; read the console output.
 *
 * Run: ALLSEC_DIAG=1 npx vitest run src/renderer/src/utils/partitionFill.allsections.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { computeSectionFill, type CorrelationEdge, type PartitionColumn } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

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
interface RawEdge {
  a: string
  b: string
  aSide?: string
  bSide?: string
}
interface RawSection {
  sectionId: string
  name: string
  columns: RawCol[]
  edges: RawEdge[]
  alongM: number[]
}

function inPoly(px: number, py: number, poly: { a: number; e: number }[]): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const A = poly[i]
    const B = poly[(i + 1) % n]
    const isLeft = (B.a - A.a) * (py - A.e) - (px - A.a) * (B.e - A.e)
    if (A.e <= py) {
      if (B.e > py && isLeft > 0) wn++
    } else if (B.e <= py && isLeft < 0) wn--
  }
  return wn !== 0
}

describe('ALL-SECTIONS tie-straddle diagnostic', () => {
  if (process.env.ALLSEC_DIAG !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set ALLSEC_DIAG=1 + run diag_allsections_extract.py)', () => {})
    return
  }

  it('reports every region straddling a cross-litho surface tie', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const fname = (fid: string): string => raw.formationNames[fid] ?? fid.slice(-6)
    const report: string[] = []

    for (const sec of raw.sections) {
      const keep = sec.columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.surfaceElevM != null)
      const columns: PartitionColumn[] = keep.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: c.units,
      }))
      const alongM = keep.map(({ i }) => sec.alongM[i])

      const regions = computeSectionFill(columns, sec.edges as CorrelationEdge[], undefined, alongM)

      const nonEmpty = columns.filter((c) => c.units.length > 0)
      const alongNonEmpty = keep
        .filter(({ c }) => c.units.length > 0)
        .map(({ i }) => sec.alongM[i])

      const layerElev = new Map<
        string,
        { along: number; top: number; base: number; topFid: string; belowFid: string | null }
      >()
      nonEmpty.forEach((c, ci) => {
        const along = alongNonEmpty[ci]
        const sorted = [...c.units].sort((a, b) => a.topDepthM - b.topDepthM)
        for (let i = 0; i < sorted.length; i++) {
          const u = sorted[i]
          layerElev.set(u.layerId, {
            along,
            top: c.surfaceElevM - u.topDepthM,
            base: c.surfaceElevM - u.baseDepthM,
            topFid: u.formationId,
            belowFid: i + 1 < sorted.length ? sorted[i + 1].formationId : null,
          })
        }
      })
      const sideLitho = (
        l: { topFid: string; belowFid: string | null },
        side: string | undefined,
      ): string | null => (side === 'base' ? l.belowFid : l.topFid)

      interface Tie {
        id: string
        a1: number
        e1: number
        a2: number
        e2: number
        exemptFid: string | null
      }
      const ties: Tie[] = []
      for (const e of sec.edges) {
        const la = layerElev.get(e.a)
        const lb = layerElev.get(e.b)
        if (!la || !lb) continue
        const litA = sideLitho(la, e.aSide)
        const litB = sideLitho(lb, e.bSide)
        if (litA === null || litB === null) continue
        // Same-litho tie: the tied band's own formation legitimately touches
        // the line — but any FOREIGN formation straddling it is still spill.
        // exemptFid carries the band formation to skip in the region loop.
        const e1 = e.aSide === 'base' ? la.base : la.top
        const e2 = e.bSide === 'base' ? lb.base : lb.top
        ties.push({
          id: `${e.a.slice(-6)}~${e.b.slice(-6)}${litA === litB ? ' (same-litho)' : ''}`,
          a1: la.along,
          e1,
          a2: lb.along,
          e2,
          exemptFid: litA === litB ? litA : null,
          // A cross-litho tie also legitimately bounds ITS two tied units'
          // formations on either side — but a region of either formation
          // straddling it is still meaningful, so only same-litho exempts.
        })
      }

      const gapAlong: { l: number; r: number }[] = []
      for (let i = 0; i < nonEmpty.length - 1; i++) {
        gapAlong.push({ l: alongNonEmpty[i], r: alongNonEmpty[i + 1] })
      }

      for (const r of regions) {
        const g = gapAlong[r.gapIndex]
        if (!g) continue
        const poly = r.polygon.map((p) => ({
          a: g.l + p.fraction * (g.r - g.l),
          e: p.elevation,
        }))
        const aLo = Math.min(...poly.map((p) => p.a))
        const aHi = Math.max(...poly.map((p) => p.a))
        const eLo = Math.min(...poly.map((p) => p.e))
        const eHi = Math.max(...poly.map((p) => p.e))
        for (const t of ties) {
          if (t.exemptFid !== null && r.formationId === t.exemptFid) continue
          const tLo = Math.min(t.a1, t.a2)
          const tHi = Math.max(t.a1, t.a2)
          const lo = Math.max(aLo, tLo)
          const hi = Math.min(aHi, tHi)
          if (hi <= lo) continue
          for (const margin of [0.05, 0.2]) {
            let above = 0
            let below = 0
            const NA = 16
            const NE = 32
            for (let sa = 0; sa <= NA; sa++) {
              const a = lo + ((hi - lo) * sa) / NA
              const tt = (a - t.a1) / (t.a2 - t.a1 || 1)
              const tieE = t.e1 + tt * (t.e2 - t.e1)
              for (let se = 0; se <= NE; se++) {
                const e = eLo + ((eHi - eLo) * se) / NE
                if (!inPoly(a, e, poly)) continue
                if (e > tieE + margin) above++
                else if (e < tieE - margin) below++
              }
            }
            if (above >= 2 && below >= 2) {
              const src = (r as { debugSrc?: string }).debugSrc ?? '?'
              report.push(
                `${sec.name} gap ${r.gapIndex}: [${src}/${r.kind}] ${fname(r.formationId)} ` +
                  `STRADDLES tie ${t.id} (margin ${margin}: above=${above} below=${below})`,
              )
              break // one margin line per (region, tie) is enough
            }
          }
        }
      }
    }

    // eslint-disable-next-line no-console
    console.error(
      report.length
        ? `\n❌ STRADDLES FOUND (${report.length}):\n  ${report.join('\n  ')}`
        : '\n✅ no cross-litho tie straddles ≥0.05 m on ANY section',
    )
    expect(true).toBe(true)
  })
})
