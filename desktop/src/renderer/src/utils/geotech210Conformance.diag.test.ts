/**
 * THE 2/1/0 CONFORMANCE GATE — owner ask 2026-08-18 ("how are we still making
 * errors against the 2/1/0 rule ... sure get the systematic fix done").
 *
 * The 2/1/0 rule is the model's law: a band with 2 ties BANDS across its gap,
 * with 1 tie ONLAPS following the tie, with 0 ties closes as a LENS at its own
 * level. Every render defect of the 2026-08-18 dogfeed marathon violated it in
 * a way no existing gate could see: the litho-consistency gate compares SOILS,
 * and all of these were wrong CLASS inside the right soil. This gate checks
 * the rule per BAND on the real model, using the v2 regions' own layer-id
 * attribution:
 *
 *   V-BALLOON  a 0/1-tie band's region grows far taller than the band itself
 *              (the 0.41 m crust that painted 2.8 m; the silt riding a tie).
 *   V-MISSING  a 0/1-tie band emits NOTHING into an adjacent gap — its loop
 *              never closed (the spur-stripped onlap flank).
 *   V-NOSPAN   a band tied >= 2x into a gap does not reach the far column.
 *
 * RATCHET, not absolute truth: the oracle is deliberately coarse (a dipping
 * one-tie onlap can legitimately exceed the height cap by its tie's dip), so
 * violations are COUNTED per section against a frozen baseline and may only
 * shrink. Freeze/refresh with GEOTECH_210_FREEZE=1 — only commit a refresh
 * whose numbers you can explain.
 *
 * Dormant unless GEOTECH_210=1. Env: GEOTECH_AXIS_INPUT (input override,
 * same as the consistency gate). Report: scripts/throwaway_geotech_210.txt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = process.env.GEOTECH_AXIS_INPUT
  ? resolve(REPO_ROOT, process.env.GEOTECH_AXIS_INPUT)
  : resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_210.txt')
const BASELINE = resolve(HERE, '__fixtures__/geotech_210_conformance_baseline.json')

/** A 0/1-tie construct may be this many times taller than its own band. */
const BALLOON_SLACK = 2.0
/** Absolute grace on the balloon cap (m) — snap grain and label strokes. */
const BALLOON_GRACE_M = 0.05
/** How close to the far column a >=2-tie band must reach (fraction). */
const SPAN_REACH = 0.99

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
interface RawArm {
  columns: RawColumn[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}
interface RawSection {
  name: string
  geotech: RawArm
}
interface Violation {
  kind: 'balloon' | 'missing' | 'nospan'
  detail: string
}
type Counts = { balloon: number; missing: number; nospan: number }

function assemble(arm: RawArm): {
  columns: PartitionColumn[]
  alongM: number[]
  edges: CorrelationEdge[]
} {
  const paired = arm.columns
    .map((c, i) => ({ c, a: arm.alongM[i] }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .sort((p, q) => p.a - q.a)
  return {
    columns: paired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...(c.units as PartitionColumn['units'])].sort((a, b) => a.topDepthM - b.topDepthM),
    })),
    alongM: paired.map(({ a }) => a),
    edges: arm.edges.map((e) => ({
      a: e.a,
      b: e.b,
      aSide: (e.aSide ?? 'top') as 'top' | 'base',
      bSide: (e.bSide ?? 'top') as 'top' | 'base',
    })),
  }
}

function auditSection(sec: RawSection): Violation[] {
  const G = assemble(sec.geotech)
  const empty = new Map<string, BodyBoundaryResponse>()
  const regions = computeSectionFillActive(
    G.columns,
    G.edges,
    deriveSectionApexOverrides(G.columns, G.edges, G.alongM, empty, true),
    G.alongM,
  )

  // layerId → owning column index.
  const columnOf = new Map<string, number>()
  for (let ci = 0; ci < G.columns.length; ci++) {
    for (const u of G.columns[ci].units) columnOf.set(u.layerId, ci)
  }
  // Ties per (layerId, gapIndex): only edges between ADJACENT columns count —
  // a jump tie over a bandless stretch is bridge machinery with its own rules.
  const unitOf = new Map<string, { u: RawUnit; ci: number }>()
  for (let ci = 0; ci < G.columns.length; ci++) {
    for (const u of G.columns[ci].units) unitOf.set(u.layerId, { u: u as RawUnit, ci })
  }
  const surfaceElev = (layer: string): number => {
    const home = unitOf.get(layer)
    return home ? G.columns[home.ci].surfaceElevM : 0
  }
  const tieCount = new Map<string, number>()
  // Per (layerId, gap): the tied LINE as (elev at left column, elev at right column).
  const tieLines = new Map<string, [number, number][]>()
  for (const e of G.edges) {
    const ca = columnOf.get(e.a)
    const cb = columnOf.get(e.b)
    if (ca === undefined || cb === undefined || Math.abs(ca - cb) !== 1) continue
    const gap = Math.min(ca, cb)
    const elevOf = (layer: string, side: 'top' | 'base'): number => {
      const home = unitOf.get(layer)
      if (!home) return 0
      return surfaceElev(layer) - (side === 'top' ? home.u.topDepthM : home.u.baseDepthM)
    }
    const elevA = elevOf(e.a, e.aSide ?? 'top')
    const elevB = elevOf(e.b, e.bSide ?? 'top')
    const left = (columnOf.get(e.a) ?? 0) < (columnOf.get(e.b) ?? 0) ? elevA : elevB
    const right = left === elevA ? elevB : elevA
    for (const layer of [e.a, e.b]) {
      const key = `${layer}|${gap}`
      tieCount.set(key, (tieCount.get(key) ?? 0) + 1)
      const list = tieLines.get(key) ?? []
      list.push([left, right])
      tieLines.set(key, list)
    }
  }
  // Regions per (layerId, gapIndex), via the v2 layer-id attribution.
  const regionsOf = new Map<string, SectionRegion[]>()
  for (const r of regions) {
    for (const layer of r.layerIds ?? []) {
      const key = `${layer}|${r.gapIndex}`
      const list = regionsOf.get(key) ?? []
      list.push(r)
      regionsOf.set(key, list)
    }
  }

  const out: Violation[] = []
  for (let ci = 0; ci < G.columns.length; ci++) {
    const col = G.columns[ci]
    const surf = col.surfaceElevM
    for (const u of col.units) {
      const thickness = u.baseDepthM - u.topDepthM
      const gaps = [ci - 1, ci].filter((g) => g >= 0 && g < G.columns.length - 1)
      for (const gap of gaps) {
        const ties = tieCount.get(`${u.layerId}|${gap}`) ?? 0
        const mine = regionsOf.get(`${u.layerId}|${gap}`) ?? []
        const tag = `${sec.name} col${ci} gap${gap} class=${u.formationId.slice(0, 8)} ` +
          `band ${(surf - u.topDepthM).toFixed(2)}..${(surf - u.baseDepthM).toFixed(2)} ties=${ties}`
        if (ties >= 2) {
          // A twice-tied band BANDS: its fill must reach the far column.
          const wantHigh = gap === ci // band on the LEFT column of the gap reaches right
          let reach = wantHigh ? 0 : 1
          for (const r of mine) {
            for (const p of r.polygon) {
              reach = wantHigh ? Math.max(reach, p.fraction) : Math.min(reach, p.fraction)
            }
          }
          const ok = wantHigh ? reach >= SPAN_REACH : reach <= 1 - SPAN_REACH
          if (!ok) out.push({ kind: 'nospan', detail: `${tag} reach=${reach.toFixed(2)}` })
          continue
        }
        // 0/1-tie constructs pinch at their own level: no region of theirs may
        // grow far taller than the band itself (the balloon family), and the
        // construct must EXIST (the spur-stripped-flank family).
        if (mine.length === 0) {
          out.push({ kind: 'missing', detail: tag })
          continue
        }
        // The allowed envelope: the band's own extent, UNIONED with its tie
        // line evaluated over the region's own fraction reach — a one-tie
        // onlap legitimately spans its tie's dip (it follows the line), but
        // it may never leave [own level ∪ the line], which is exactly what
        // the balloons did (the 0.41 m crust reached the channel floor 1.4 m
        // below its tie's local level).
        const bandTop = surf - u.topDepthM
        const bandBase = surf - u.baseDepthM
        const lines = tieLines.get(`${u.layerId}|${gap}`) ?? []
        for (const r of mine) {
          let lo = Infinity
          let hi = -Infinity
          let f0 = 1
          let f1 = 0
          for (const p of r.polygon) {
            if (p.elevation < lo) lo = p.elevation
            if (p.elevation > hi) hi = p.elevation
            if (p.fraction < f0) f0 = p.fraction
            if (p.fraction > f1) f1 = p.fraction
          }
          let allowLo = bandBase
          let allowHi = bandTop
          for (const [l, rr] of lines) {
            const atF0 = l + f0 * (rr - l)
            const atF1 = l + f1 * (rr - l)
            allowLo = Math.min(allowLo, atF0, atF1)
            allowHi = Math.max(allowHi, atF0, atF1)
          }
          const grace = thickness * (BALLOON_SLACK - 1) + BALLOON_GRACE_M
          if (lo < allowLo - grace || hi > allowHi + grace) {
            out.push({
              kind: 'balloon',
              detail: `${tag} region ${lo.toFixed(2)}..${hi.toFixed(2)} vs envelope ${(allowLo - grace).toFixed(2)}..${(allowHi + grace).toFixed(2)}`,
            })
            break // one balloon per (band, gap) is enough signal
          }
        }
      }
    }
  }
  return out
}

describe('2/1/0 conformance gate', () => {
  if (process.env.GEOTECH_210 !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set GEOTECH_210=1)', () => {})
    return
  }
  it('every band obeys 2/1/0, ratcheted against the frozen baseline', () => {
    process.env.STRIX_PARTITION_V2 = '1'
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const perSection: Record<string, Counts> = {}
    const lines: string[] = []
    for (const sec of raw.sections) {
      const violations = auditSection(sec)
      const counts: Counts = { balloon: 0, missing: 0, nospan: 0 }
      for (const v of violations) counts[v.kind]++
      perSection[sec.name] = counts
      lines.push(
        `${sec.name.padEnd(18)} balloon=${counts.balloon} missing=${counts.missing} nospan=${counts.nospan}`,
      )
      for (const v of violations) lines.push(`    [${v.kind}] ${v.detail}`)
    }
    writeFileSync(OUT, lines.join('\n') + '\n')
    console.log(lines.filter((l) => !l.startsWith('    ')).join('\n'))

    if (process.env.GEOTECH_210_FREEZE === '1') {
      writeFileSync(BASELINE, JSON.stringify(perSection, null, 1) + '\n')
      console.log(`froze baseline → ${BASELINE}`)
      expect(true).toBe(true)
      return
    }
    if (!existsSync(BASELINE)) {
      console.log('no baseline committed — report-only run (freeze with GEOTECH_210_FREEZE=1)')
      expect(true).toBe(true)
      return
    }
    const frozen = JSON.parse(readFileSync(BASELINE, 'utf8')) as Record<string, Counts>
    const regressions: string[] = []
    for (const [name, counts] of Object.entries(perSection)) {
      const base = frozen[name]
      if (!base) continue // a new section has no baseline yet
      for (const kind of ['balloon', 'missing', 'nospan'] as const) {
        if (counts[kind] > base[kind]) {
          regressions.push(`${name}: ${kind} ${base[kind]} → ${counts[kind]}`)
        }
      }
    }
    expect(regressions, `2/1/0 violations may only shrink; details in ${OUT}`).toEqual([])
  })
})
