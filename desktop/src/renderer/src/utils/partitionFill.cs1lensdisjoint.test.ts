/**
 * CS1 LENS-DISJOINT GATE — a lens overlay must never paint over a DIFFERENT
 * formation.
 *
 * Owner dogfeed 2026-07-13 ("sand spilling over the correlation band"): after the
 * carve pass, ``kind='lens'`` overlay regions still overlap DIFFERENT-formation
 * neighbour regions in the same gap — the lens lithology tints through the
 * neighbouring band at 0.62 opacity, violating the true-partition invariant. A
 * lens deliberately overlaps its OWN matrix (same formationId) — that nested-body
 * overlay is legitimate and NOT flagged here. What must never happen is a lens
 * overlapping a region of a DIFFERENT formationId (a ZAND lens over a KLEI band, a
 * SILT lens over a ZAND band).
 *
 * This gate loads every section of the owner's real model
 * (``scripts/diag_allsections_input.json``, 14 sections extracted from the dev DB
 * with real ``alongM`` spacing) and asserts: across ALL sections, NO two regions
 * of DIFFERENT formations in the same gap overlap vertically by more than 1 cm at
 * any sampled along-fraction. It runs the same ``computeSectionFill`` code the app
 * runs, with the real per-section along spacing threaded in (uniform spacing
 * diverges — deep-to-deep substrate).
 *
 * Double-gated like the other CS1 real-data gates: ``CS1_GATE=1`` env var AND the
 * gitignored dev-DB-regenerated input (skip when absent).
 *
 * Run: CS1_GATE=1 npx vitest run \
 *        src/renderer/src/utils/partitionFill.cs1lensdisjoint.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  computeSectionFill,
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
} from './partitionFill'

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
interface RawSection {
  sectionId: string
  name: string
  columns: RawCol[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}

/** Elevation intervals covered by a simple polygon at vertical line x=f (even-odd). */
function coveredIntervals(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const [x1, x2] = [a.fraction, b.fraction]
    if ((x1 <= f && x2 > f) || (x2 <= f && x1 > f)) {
      const t = (f - x1) / (x2 - x1)
      ys.push(a.elevation + t * (b.elevation - a.elevation))
    }
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}

/** Max vertical overlap (m) of two polygons across sampled fractions. */
function maxVertOverlap(a: readonly PartitionPoint[], b: readonly PartitionPoint[]): number {
  let m = 0
  for (let f = 0.02; f < 0.985; f += 0.01) {
    const ia = coveredIntervals(a, f)
    const ib = coveredIntervals(b, f)
    for (const [a1, a2] of ia)
      for (const [b1, b2] of ib) m = Math.max(m, Math.min(a2, b2) - Math.max(a1, b1))
  }
  return m
}

describe('CS1 lens-disjoint gate', () => {
  if (process.env.CS1_GATE !== '1') {
    it.skip('dormant (set CS1_GATE=1)', () => {})
    return
  }
  if (!existsSync(INPUT)) {
    it.skip(`all-sections input absent (${INPUT})`, () => {})
    return
  }

  it('no lens overlaps a different-formation region by > 1 cm in any gap', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)

    // 1 cm — a real paint-level spill is decimetres (0.30–1.29 m on the known
    // failures); 1 cm is comfortably above float/dedup noise and below any genuine
    // spill, so it catches the class without flagging shared-contact hairlines.
    const MAX_OVERLAP_M = 0.01

    const violations: string[] = []
    for (const sec of raw.sections) {
      const keep = sec.columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
      const columns: PartitionColumn[] = keep.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: c.units,
      }))
      // Real along spacing, 1:1 with computeSectionFill's internal non-empty filter.
      const alongM = keep.map(({ i }) => sec.alongM[i])
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      const regions = computeSectionFill(columns, edges, undefined, alongM)

      const byGap = new Map<number, typeof regions>()
      for (const r of regions) {
        if (!byGap.has(r.gapIndex)) byGap.set(r.gapIndex, [])
        byGap.get(r.gapIndex)!.push(r)
      }

      for (const [gi, regs] of byGap) {
        for (let a = 0; a < regs.length; a++) {
          for (let b = a + 1; b < regs.length; b++) {
            // Only DIFFERENT-formation pairs where at least one region is a lens
            // overlay (a same-formation lens-on-its-own-matrix overlay is the
            // legitimate nested-body representation, never flagged).
            if (regs[a].formationId === regs[b].formationId) continue
            if (regs[a].kind !== 'lens' && regs[b].kind !== 'lens') continue
            const v = maxVertOverlap(regs[a].polygon, regs[b].polygon)
            if (v > MAX_OVERLAP_M) {
              violations.push(
                `${sec.name} gap${gi}: ${fname(regs[a].formationId)}(${regs[a].kind})×` +
                  `${fname(regs[b].formationId)}(${regs[b].kind}) maxVertOverlap=${(v * 100).toFixed(1)}cm`,
              )
            }
          }
        }
      }
    }

    if (violations.length) {
      // eslint-disable-next-line no-console
      console.error(`\n❌ LENS-DISJOINT violations (${violations.length}):\n  ${violations.join('\n  ')}`)
    }
    expect(violations).toEqual([])
  })
})
