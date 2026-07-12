/**
 * CS1 SAND-BODY CLEANLINESS GATE — a correlated body renders as ONE clean body.
 *
 * Owner dogfeed 2026-07-11 (B2 · S7A · S7 · S6): below the sand-top tie the deep
 * sand body is split by a vertical KLEI (clay) quad at the S7A column, the sand
 * pokes above the tie, and the sand is fragmented into span/drape/obs seams. Root
 * cause: ``computeSpanningBands`` linearises a band between its two endpoints and
 * ignores intermediate correlated columns, so the sand-top surface reads ~5.0 m at
 * S7A instead of the true ~4.23 m, disagreeing with the clay band's flat emit base
 * → a void opens below the flat base that clay drapes into (the splitter).
 *
 * The rule (owner's words): "one clean sand body" — below a body's top tie the fill
 * is that body's lithology, contiguous, with NO foreign lithology splitting it. This
 * gate encodes that as a lithology invariant on the real CS1 data: in the sand
 * body's own depth window, every painted point must be the SAND formation.
 *
 * Run:  CS1_GATE=1 npx vitest run \
 *         src/renderer/src/utils/partitionFill.cs1sandbody.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { computeSectionFill, type CorrelationEdge, type PartitionColumn } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT_PATH = process.env.CS1_INPUT ?? resolve(REPO_ROOT, 'scripts/throwaway_cs1_input.json')

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: PartitionColumn['units']
  name?: string
}
interface RawInput {
  columns: RawColumn[]
  edges: CorrelationEdge[]
  along?: number[]
}

/** Nonzero-winding point-in-polygon (x=fraction, y=elevation) — matches the SVG
 *  renderer's default fill rule. */
function inPolygon(px: number, py: number, poly: readonly { fraction: number; elevation: number }[]): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    if (a.elevation <= py) {
      if (b.elevation > py && (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation) > 0) wn++
    } else if (b.elevation <= py && (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation) < 0) wn--
  }
  return wn !== 0
}

describe('CS1 sand-body cleanliness gate', () => {
  if (process.env.CS1_GATE !== '1') {
    it.skip('CS1 gate dormant (set CS1_GATE=1)', () => {})
    return
  }
  if (!existsSync(INPUT_PATH)) {
    it.skip(`CS1 input absent (${INPUT_PATH}) — regenerate with scripts/throwaway_cs1_partition_extract.py`, () => {})
    return
  }

  it('the deep sand body under the sand-top tie contains no foreign lithology (B2→S7A)', () => {
    const raw = JSON.parse(readFileSync(INPUT_PATH, 'utf8')) as RawInput
    const keep = raw.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null)
    const columns: PartitionColumn[] = keep.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: c.units,
    }))
    const alongM = raw.along ? keep.map(({ i }) => (raw.along as number[])[i]) : undefined
    const regions = computeSectionFill(columns, raw.edges, undefined, alongM)

    // computeSectionFill drops empty columns; gap g is between cols[g] and cols[g+1].
    const cols = columns.filter((c) => c.units.length > 0)
    const rawByInv = new Map(keep.map(({ c }) => [c.investigationId, c]))

    // Locate B2 and the SAND formation from the data (no magic strings): B2's
    // DEEPEST unit is the sand matrix; gap 16 is the gap immediately after B2.
    const b2Idx = cols.findIndex((c) => (rawByInv.get(c.investigationId)?.name ?? '').includes('B2'))
    expect(b2Idx).toBeGreaterThanOrEqual(0)
    const b2Units = [...cols[b2Idx].units].sort((a, b) => a.topDepthM - b.topDepthM)
    const sandFid = b2Units[b2Units.length - 1].formationId
    const gap = b2Idx // B2 → next column

    // The sand body's own depth window in this gap: safely below the sand-top tie
    // (~4.24 m, the B2 sand top) and safely above the basal clay top (~-6.6 m).
    // Everything painted here must be the sand formation; any other formation is a
    // body-splitting inclusion (the clay splitter) — the defect the owner flagged.
    const E_TOP = 3.5
    const E_BASE = -5.0
    const gapRegions = regions.filter((r) => r.gapIndex === gap && r.kind !== 'lens')

    const NF = 40 // fraction samples across the gap
    const NE = 24 // elevation samples in the window
    const foreign = new Map<string, number>()
    for (let fi = 1; fi < NF; fi++) {
      const f = fi / NF
      for (let ei = 0; ei <= NE; ei++) {
        const e = E_BASE + ((E_TOP - E_BASE) * ei) / NE
        // Topmost covering region wins (later regions draw on top).
        let coverFid: string | null = null
        for (const r of gapRegions) {
          if (inPolygon(f, e, r.polygon)) coverFid = r.formationId
        }
        if (coverFid !== null && coverFid !== sandFid) {
          foreign.set(coverFid, (foreign.get(coverFid) ?? 0) + 1)
        }
      }
    }

    const report = [...foreign.entries()]
      .map(([fid, n]) => `${fid.slice(-6)} ×${n}`)
      .join(', ')
    // eslint-disable-next-line no-console
    console.error(
      `[sand-body gate] gap ${gap} sand=${sandFid.slice(-6)} window e[${E_BASE}..${E_TOP}] foreign-samples: ${report || 'none'}`,
    )
    expect(report).toBe('')
  })
})
