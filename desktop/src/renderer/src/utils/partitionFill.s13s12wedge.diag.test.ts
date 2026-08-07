/**
 * THROWAWAY DIAG — owner report 2026-08-07: grey (KLEI) wedge floating ABOVE
 * the accepted KLEI-top tie in the GEO-23/125-S13 ↔ S12 gap on Cross-section 1.
 *
 * The gap's only unmatched contact is the thin ZAND top at 6.91 m on S12
 * (0.71 m sand between SILT and KLEI, no counterpart on S13). This reporter
 * dumps EVERY region in that gap with its provenance and measures how far
 * each formation's fill sits above/below the KLEI-top tie line
 * (S13 8.16 m ↔ S12 7.62 m). Pure reporter — never fails.
 *
 * Run: S13S12_DIAG=1 npx vitest run src/renderer/src/utils/partitionFill.s13s12wedge.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { computeSectionFill, type CorrelationEdge, type PartitionColumn } from './partitionFill'
import { computeSectionFillV2 } from './partitionFillV2/computeSectionFillV2'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

const S13 = '019e932e-7c56-7e1f-9c5c-b9cf19a2e1e3'
const S12 = '019e932e-7c55-7dbb-b43f-f955a469cda5'

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
  edges: (CorrelationEdge & { a: string; b: string })[]
  alongM: number[]
}

describe('S13-S12 grey wedge diagnostic', () => {
  if (process.env.S13S12_DIAG !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set S13S12_DIAG=1 + run diag_allsections_extract.py)', () => {})
    return
  }

  it('dumps every region in the S13-S12 gap with provenance', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const fname = (fid: string): string => raw.formationNames[fid] ?? fid.slice(-6)
    const sec = raw.sections.find((s) => s.name === 'Cross-section 1')!

    const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null)
    const columns: PartitionColumn[] = keep.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: c.units,
    }))
    const alongM = keep.map(({ i }) => sec.alongM[i])

    const engines: [string, typeof computeSectionFill][] = [
      ['v1', computeSectionFill],
      ['v2', computeSectionFillV2],
    ]

    const nonEmpty = keep.filter(({ c }) => c.units.length > 0)
    const idxOf = (inv: string): number =>
      nonEmpty.findIndex(({ c }) => c.investigationId === inv)
    const i13 = idxOf(S13)
    const i12 = idxOf(S12)
    // eslint-disable-next-line no-console
    console.error(`\ncolumn order: S13 at nonEmpty index ${i13}, S12 at ${i12}`)
    const gapIndex = Math.min(i13, i12)
    const leftCol = nonEmpty[gapIndex].c
    const rightCol = nonEmpty[gapIndex + 1].c
    // eslint-disable-next-line no-console
    console.error(
      `gap ${gapIndex}: left=${leftCol.investigationId === S13 ? 'S13' : 'S12'} ` +
        `right=${rightCol.investigationId === S13 ? 'S13' : 'S12'}`,
    )

    // The KLEI-top tie line in (fraction, elevation) space for this gap.
    const elevOf = (col: RawCol, depth: number): number => (col.surfaceElevM as number) - depth
    const kleiTopLeft = elevOf(leftCol, leftCol.investigationId === S13 ? 8.16 : 7.62)
    const kleiTopRight = elevOf(rightCol, rightCol.investigationId === S13 ? 8.16 : 7.62)
    // eslint-disable-next-line no-console
    console.error(
      `KLEI-top tie line: left ${kleiTopLeft.toFixed(3)} -> right ${kleiTopRight.toFixed(3)} (elev m)`,
    )

    for (const [label, engine] of engines) {
      // eslint-disable-next-line no-console
      console.error(`\n=== ${label} ===`)
      const regions = engine(columns, sec.edges, undefined, alongM)
      for (const r of regions) {
        if (r.gapIndex !== gapIndex) continue
        const eLo = Math.min(...r.polygon.map((p) => p.elevation))
        const eHi = Math.max(...r.polygon.map((p) => p.elevation))
        // Only the window around the wedge (KLEI top +/- 2.5 m).
        const winLo = Math.min(kleiTopLeft, kleiTopRight) - 2.5
        const winHi = Math.max(kleiTopLeft, kleiTopRight) + 2.5
        if (eHi < winLo || eLo > winHi) continue
        const src = (r as { debugSrc?: string }).debugSrc ?? '?'
        // Max height of this region ABOVE the tie line, sampled at its vertices.
        let maxAbove = -Infinity
        for (const p of r.polygon) {
          const tieE = kleiTopLeft + p.fraction * (kleiTopRight - kleiTopLeft)
          maxAbove = Math.max(maxAbove, p.elevation - tieE)
        }
        const pts = r.polygon
          .map((p) => `(${p.fraction.toFixed(3)},${p.elevation.toFixed(3)})`)
          .join(' ')
        // eslint-disable-next-line no-console
        console.error(
          `[${src}/${r.kind}] ${fname(r.formationId)} maxAboveTie=${maxAbove.toFixed(3)}m\n  ${pts}`,
        )
      }
    }
    expect(true).toBe(true)
  })
})
