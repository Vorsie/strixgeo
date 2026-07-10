/**
 * CS1 TIE-CROSS GATE — the fill must stay inside the correlation lines.
 *
 * Owner dogfeed 2026-07-10: below shallow test S8 (TD elev 9.29) the app paints a
 * KLEI wedge that CROSSES cross-lithology surface tie ``019f4657`` (S10 SILT-base
 * 2.51 ↔ a far column at 5.01). The wedge is 100% invented fill (S8 has no data
 * below 9.29), and it ignores the spanning tie — "clay spilling over the
 * correlation band". The dead ``computeSpanningBands`` was meant to own this
 * below-shallow-TD region but is never wired.
 *
 * This gate encodes the owner's rule ("colour between the lines"): NO fill region's
 * interior may be crossed by an approved correlation surface tie. It mirrors the
 * in-app alt-click tie-cross diagnostic, but on the real CS1 input, in the same
 * ``computeSectionFill`` code the app runs (REWRITE_B path).
 *
 * Run:  REWRITE_B=1 CS1_TIECROSS=1 npx vitest run \
 *         src/renderer/src/utils/partitionFill.cs1tiecross.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  computeSectionFill,
  type CorrelationEdge,
  type PartitionColumn,
} from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = process.env.CS1_INPUT ?? resolve(REPO_ROOT, 'scripts/throwaway_cs1_input.json')
const FIXTURE = resolve(REPO_ROOT, 'tests/fixtures/voxel/teststrix_partitions.json')

interface RawUnit {
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
  layerId: string
}
interface RawCol {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
  name?: string
}
interface RawEdge extends CorrelationEdge {
  id?: string
}

/** Winding-number point-in-polygon in (along, elevation) space. */
function inPoly(px: number, py: number, poly: readonly { a: number; e: number }[]): boolean {
  let wn = 0
  for (let i = 0; i < poly.length; i++) {
    const A = poly[i]
    const B = poly[(i + 1) % poly.length]
    const isLeft = (B.a - A.a) * (py - A.e) - (px - A.a) * (B.e - A.e)
    if (A.e <= py) {
      if (B.e > py && isLeft > 0) wn++
    } else if (B.e <= py && isLeft < 0) wn--
  }
  return wn !== 0
}

describe('CS1 tie-cross gate', () => {
  if (process.env.CS1_TIECROSS !== '1') {
    it.skip('dormant (set CS1_TIECROSS=1)', () => {})
    return
  }
  if (!existsSync(INPUT)) {
    it.skip(`CS1 input absent (${INPUT})`, () => {})
    return
  }

  it('no fill region is crossed by a correlation surface tie', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { columns: RawCol[]; edges: RawEdge[] }
    const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
      sections: { columns: { investigation_id: string; along_m: number }[] }[]
    }
    const alongById = new Map<string, number>()
    for (const c of fixture.sections[12].columns) alongById.set(c.investigation_id, c.along_m)

    const columns: PartitionColumn[] = raw.columns
      .filter((c) => c.surfaceElevM != null)
      .map((c) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: c.units,
      }))

    // along per NON-EMPTY column, 1:1 with computeSectionFill's internal filter.
    const nonEmpty = columns.filter((c) => c.units.length > 0)
    const alongM = nonEmpty.map((c) => alongById.get(c.investigationId) ?? Number.NaN)
    // Guard: the along mapping must resolve, else the gate is meaningless.
    expect(alongM.every((a) => Number.isFinite(a))).toBe(true)

    const regions = computeSectionFill(columns, raw.edges, undefined, alongM)

    // Column along + per-layer (top/base) elevation, keyed by layerId (== contact id).
    const alongByCol = new Map<string, number>()
    const layerElev = new Map<string, { along: number; top: number; base: number; fid: string }>()
    for (const c of nonEmpty) {
      const along = alongById.get(c.investigationId) ?? Number.NaN
      alongByCol.set(c.investigationId, along)
      for (const u of c.units) {
        layerElev.set(u.layerId, {
          along,
          top: c.surfaceElevM - u.topDepthM,
          base: c.surfaceElevM - u.baseDepthM,
          fid: u.formationId,
        })
      }
    }

    // Gap along-endpoints, 1:1 with gapIndex (between consecutive non-empty columns).
    const gapAlong: { l: number; r: number }[] = []
    for (let i = 0; i < nonEmpty.length - 1; i++) {
      gapAlong.push({ l: alongM[i], r: alongM[i + 1] })
    }

    // CROSS-LITHOLOGY surface ties only — the ones the app renders as ``tie-hit``
    // (CorrelationEdgesOverlay draws them only when lithoA !== lithoB). These are the
    // "same surface, different material" lines the owner sees the fill cross; a
    // same-lithology top-tie is just a band boundary and is expected to touch its
    // band's edge. A tie endpoint sits at the layer's TOP (top side) or BASE (base
    // side) elevation — same anchoring as the overlay's yA/yB.
    interface Tie {
      id: string
      a1: number
      e1: number
      a2: number
      e2: number
    }
    const ties: Tie[] = []
    for (const e of raw.edges) {
      const la = layerElev.get(e.a)
      const lb = layerElev.get(e.b)
      if (!la || !lb) continue
      const e1 = e.aSide === 'base' ? la.base : la.top
      const e2 = e.bSide === 'base' ? lb.base : lb.top
      ties.push({ id: e.id ?? `${e.a.slice(-6)}~${e.b.slice(-6)}`, a1: la.along, e1, a2: lb.along, e2 })
    }

    // A region VIOLATES a tie when it STRADDLES the tie surface — it has interior area
    // clearly ABOVE and clearly BELOW the tie line within the tie's along-span (the
    // clay wedge that sits both sides of the silt-base surface). A band bounded BY a
    // tie sits entirely on one side (its edge lies on the tie) → no straddle.
    const MARGIN = 0.2 // m — ignore near-boundary noise
    const violations: string[] = []
    for (const r of regions) {
      const g = gapAlong[r.gapIndex]
      if (!g) continue
      const poly = r.polygon.map((p) => ({ a: g.l + p.fraction * (g.r - g.l), e: p.elevation }))
      const aLo = Math.min(...poly.map((p) => p.a))
      const aHi = Math.max(...poly.map((p) => p.a))
      const eLo = Math.min(...poly.map((p) => p.e))
      const eHi = Math.max(...poly.map((p) => p.e))
      for (const t of ties) {
        const tLo = Math.min(t.a1, t.a2)
        const tHi = Math.max(t.a1, t.a2)
        const lo = Math.max(aLo, tLo)
        const hi = Math.min(aHi, tHi)
        if (hi <= lo) continue
        // Grid-sample the region interior over the overlap; classify each interior
        // point as above / below the tie line at its along position.
        let above = 0
        let below = 0
        const NA = 12
        const NE = 24
        for (let sa = 0; sa <= NA; sa++) {
          const a = lo + ((hi - lo) * sa) / NA
          const tt = (a - t.a1) / (t.a2 - t.a1 || 1)
          const tieE = t.e1 + tt * (t.e2 - t.e1)
          for (let se = 0; se <= NE; se++) {
            const e = eLo + ((eHi - eLo) * se) / NE
            if (!inPoly(a, e, poly)) continue
            if (e > tieE + MARGIN) above++
            else if (e < tieE - MARGIN) below++
          }
        }
        if (above >= 2 && below >= 2) {
          violations.push(
            `region ${r.formationId.slice(-6)}/${r.kind} gap ${r.gapIndex} STRADDLES tie ${t.id} (above=${above} below=${below})`,
          )
        }
      }
    }

    if (violations.length) {
      // eslint-disable-next-line no-console
      console.error(`\n❌ TIE-CROSS violations (${violations.length}):\n  ${violations.join('\n  ')}`)
    }
    expect(violations).toEqual([])
  })
})
