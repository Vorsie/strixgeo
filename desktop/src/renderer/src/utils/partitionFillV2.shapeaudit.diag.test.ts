/**
 * MODEL-WIDE SHAPE AUDIT (throwaway diag, 2026-07-14) — the acceptance instrument
 * that REPLACES the five hand-verified spot-checks for partition engine v2. It scans
 * EVERY region of ALL 14 real sections on BOTH engines and reports, per section/gap:
 *   1. TERMINATION DIFF — per (gap, formation), does the formation reach full width
 *      (both columns) or pinch short (apex fraction)? DIFF = every case where v1 stops
 *      short but v2 runs full-width (the owner complaint class) and vice versa, with
 *      column NAMES so the owner's round-2 spots map directly.
 *   2. SAME-FORMATION OVERLAP — pairwise vertical overlap between SAME-formation
 *      regions in a gap (the diff-litho scan mirrored without the inequality).
 *   3. SUBSTRATE-ABOVE-TIE — for every base-side tie, does any region of the tied
 *      (below-tie) formation paint ABOVE the tie line under either column?
 *   4. SUMMARY per section + grand totals, dumped to scripts/diag_shape_audit.json.
 * Pure reporter — never fails.
 * Run (from desktop/): $env:SHAPE_AUDIT='1'; npx vitest run \
 *   src/renderer/src/utils/partitionFillV2.shapeaudit.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  computeSectionFill,
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from './partitionFill'
import { computeSectionFillV2 } from './partitionFillV2'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const NAMES = resolve(REPO_ROOT, 'scripts/diag_shape_audit_names.json')
const DUMP = resolve(REPO_ROOT, 'scripts/diag_shape_audit.json')

// ---------------------------------------------------------------------------
// Input shapes (mirror the extractor output).
// ---------------------------------------------------------------------------
interface RawUnit {
  layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null
}
interface RawCol {
  investigationId: string; surfaceElevM: number | null; units: RawUnit[]
}
interface RawSection {
  sectionId: string; name: string; columns: RawCol[]; alongM: number[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
}

// ---------------------------------------------------------------------------
// Geometry helpers.
// ---------------------------------------------------------------------------

/** Elevation intervals covered by a simple polygon at vertical line x=f. */
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

/** Fraction extent [min,max] of a polygon ring. */
function fracExtent(poly: readonly PartitionPoint[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of poly) {
    if (p.fraction < lo) lo = p.fraction
    if (p.fraction > hi) hi = p.fraction
  }
  return [lo, hi]
}

/** Elevation extent [min,max] of a polygon ring. */
function elevExtent(poly: readonly PartitionPoint[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of poly) {
    if (p.elevation < lo) lo = p.elevation
    if (p.elevation > hi) hi = p.elevation
  }
  return [lo, hi]
}

const FULL_EPS = 0.02 // within 2% of a column edge counts as "reaches" it.

/**
 * Classify a region's termination: FULL-WIDTH if its polygon reaches both column edges
 * (fraction ~0 AND ~1); else PINCHED, with the apex fraction (far reach from its edge).
 */
function terminationClass(poly: readonly PartitionPoint[]): {
  full: boolean
  fracLo: number
  fracHi: number
  apex: number
} {
  const [lo, hi] = fracExtent(poly)
  const full = lo <= FULL_EPS && hi >= 1 - FULL_EPS
  // apex = how far it reaches from whichever edge it is anchored to (the wider run).
  const apex = lo <= FULL_EPS ? hi : 1 - lo
  return { full, fracLo: lo, fracHi: hi, apex }
}

/**
 * Per-gap, per-formation TERMINATION signature. A formation is "full-width" in a gap
 * if it has ≥1 full-width region there; else "short" (max apex fraction reported).
 * Keyed by formation because the owner's complaint is at the lithology level.
 */
function fullWidthByFormation(regs: SectionRegion[]): Map<string, { full: boolean; maxApex: number }> {
  const m = new Map<string, { full: boolean; maxApex: number }>()
  for (const r of regs) {
    const tc = terminationClass(r.polygon)
    const cur = m.get(r.formationId) ?? { full: false, maxApex: 0 }
    cur.full = cur.full || tc.full
    cur.maxApex = Math.max(cur.maxApex, tc.apex)
    m.set(r.formationId, cur)
  }
  return m
}

// ---------------------------------------------------------------------------
// Section preparation (shared by both engines).
// ---------------------------------------------------------------------------
type LayerInfo = { col: number; formationId: string; baseElev: number; topElev: number }
interface Prepared {
  columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[]; colNames: string[]
  /** layerId -> LayerInfo (for base-tie resolution). */
  layerInfo: Map<string, LayerInfo>
}

function prepare(sec: RawSection, nameOf: (id: string) => string): Prepared {
  const keep = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const colNames = keep.map(({ c }) => nameOf(c.investigationId))
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  const layerInfo = new Map<string, LayerInfo>()
  columns.forEach((c, ci) => {
    for (const u of c.units) {
      layerInfo.set(u.layerId, {
        col: ci,
        formationId: u.formationId,
        baseElev: c.surfaceElevM - u.baseDepthM,
        topElev: c.surfaceElevM - u.topDepthM,
      })
    }
  })
  return { columns, alongM, edges, colNames, layerInfo }
}

// ---------------------------------------------------------------------------
// JSON dump accumulators.
// ---------------------------------------------------------------------------
interface DiffRow {
  section: string; gap: number; colLeft: string; colRight: string; formation: string
  v1Full: boolean; v2Full: boolean; v1Apex: number; v2Apex: number
}
interface OverlapRow {
  section: string; gap: number; engine: 'v1' | 'v2'; formation: string
  kindA: string; kindB: string; maxVertOverlapM: number; atFraction: number
}
interface TieRow {
  section: string; gap: number; engine: 'v1' | 'v2'; formation: string
  column: string; tieElev: number; paintTopElev: number; aboveByM: number
}

describe('v2 model-wide shape audit', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  it('audits termination / same-formation overlap / substrate-above-tie on both engines', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const nameMap: Record<string, string> = existsSync(NAMES)
      ? (JSON.parse(readFileSync(NAMES, 'utf8')) as Record<string, string>)
      : {}
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    const nameOf = (id: string): string => nameMap[id] ?? id.slice(0, 8)

    const diffRows: DiffRow[] = [] // v1-short-v2-full AND v2-short-v1-full
    const overlapRows: OverlapRow[] = []
    const tieRows: TieRow[] = []
    const perSection: Record<string, unknown>[] = []

    let totV1ShortV2Full = 0
    let totV2ShortV1Full = 0
    let totOverlapV1 = 0
    let totOverlapV2 = 0
    let totTieV1 = 0
    let totTieV2 = 0

    for (const sec of raw.sections) {
      const prep = prepare(sec, nameOf)
      const { columns, alongM, edges, colNames, layerInfo } = prep
      if (columns.length < 2) continue

      const r1 = computeSectionFill(columns, edges, undefined, alongM)
      const r2 = computeSectionFillV2(columns, edges, undefined, alongM)

      const gaps1 = groupByGap(r1)
      const gaps2 = groupByGap(r2)
      const allGaps = new Set<number>([...gaps1.keys(), ...gaps2.keys()])

      // ---- 1. TERMINATION DIFF (per gap, per formation) ----
      let secV1ShortV2Full = 0
      let secV2ShortV1Full = 0
      for (const gi of allGaps) {
        const f1 = fullWidthByFormation(gaps1.get(gi) ?? [])
        const f2 = fullWidthByFormation(gaps2.get(gi) ?? [])
        const forms = new Set<string>([...f1.keys(), ...f2.keys()])
        const cl = colNames[gi] ?? `col${gi}`
        const cr = colNames[gi + 1] ?? `col${gi + 1}`
        for (const fid of forms) {
          const a = f1.get(fid)
          const b = f2.get(fid)
          if (!a || !b) continue // formation only present in one engine — not a term diff
          if (!a.full && b.full) {
            secV1ShortV2Full++
            diffRows.push({
              section: sec.name,
              gap: gi,
              colLeft: cl,
              colRight: cr,
              formation: fname(fid),
              v1Full: false,
              v2Full: true,
              v1Apex: round(a.maxApex),
              v2Apex: round(b.maxApex),
            })
          } else if (a.full && !b.full) {
            secV2ShortV1Full++
            diffRows.push({
              section: sec.name,
              gap: gi,
              colLeft: cl,
              colRight: cr,
              formation: fname(fid),
              v1Full: true,
              v2Full: false,
              v1Apex: round(a.maxApex),
              v2Apex: round(b.maxApex),
            })
          }
        }
      }

      // ---- 2. SAME-FORMATION OVERLAP (both engines) ----
      const ov1 = sameFormationOverlaps(gaps1, sec.name, 'v1', fname)
      const ov2 = sameFormationOverlaps(gaps2, sec.name, 'v2', fname)
      overlapRows.push(...ov1, ...ov2)

      // ---- 3. SUBSTRATE-ABOVE-TIE (both engines) ----
      const t1 = substrateAboveTie(gaps1, edges, layerInfo, colNames, sec.name, 'v1', fname)
      const t2 = substrateAboveTie(gaps2, edges, layerInfo, colNames, sec.name, 'v2', fname)
      tieRows.push(...t1, ...t2)

      totV1ShortV2Full += secV1ShortV2Full
      totV2ShortV1Full += secV2ShortV1Full
      totOverlapV1 += ov1.length
      totOverlapV2 += ov2.length
      totTieV1 += t1.length
      totTieV2 += t2.length

      perSection.push({
        section: sec.name,
        cols: columns.length,
        v1Regions: r1.length,
        v2Regions: r2.length,
        v1ShortV2Full: secV1ShortV2Full,
        v2ShortV1Full: secV2ShortV1Full,
        sameFormOverlapV1: ov1.length,
        sameFormOverlapV2: ov2.length,
        substrateAboveTieV1: t1.length,
        substrateAboveTieV2: t2.length,
      })

      console.log(
        `\n=== ${sec.name}: cols=${columns.length} v1reg=${r1.length} v2reg=${r2.length} | ` +
          `v1-short-v2-full=${secV1ShortV2Full} v2-short-v1-full=${secV2ShortV1Full} | ` +
          `sameFormOvl v1=${ov1.length}/v2=${ov2.length} | subAboveTie v1=${t1.length}/v2=${t2.length}`,
      )
      for (const d of diffRows.filter((x) => x.section === sec.name).slice(0, 12)) {
        const tag = d.v2Full ? 'v1SHORT→v2FULL' : 'v1FULL→v2SHORT'
        console.log(
          `   TERM ${tag} gap${d.gap} ${d.colLeft}↔${d.colRight} ${d.formation} ` +
            `v1apex=${d.v1Apex} v2apex=${d.v2Apex}`,
        )
      }
      for (const o of [...ov1, ...ov2].slice(0, 8))
        console.log(
          `   SAMEFORM-OVLP(${o.engine}) gap${o.gap} ${o.formation} ${o.kindA}×${o.kindB} ` +
            `${(o.maxVertOverlapM * 100).toFixed(1)}cm @f=${o.atFraction}`,
        )
      for (const t of [...t1, ...t2].slice(0, 8))
        console.log(
          `   SUB-ABOVE-TIE(${t.engine}) gap${t.gap} ${t.formation} @${t.column} ` +
            `tie=${t.tieElev} paintTop=${t.paintTopElev} above=${(t.aboveByM * 100).toFixed(1)}cm`,
        )
    }

    // ---- 4. SUMMARY + DUMP ----
    const grand = {
      v1ShortV2Full: totV1ShortV2Full,
      v2ShortV1Full: totV2ShortV1Full,
      sameFormOverlapPairsV1: totOverlapV1,
      sameFormOverlapPairsV2: totOverlapV2,
      substrateAboveTieV1: totTieV1,
      substrateAboveTieV2: totTieV2,
    }
    writeFileSync(
      DUMP,
      JSON.stringify(
        {
          generatedFor: '14 real sections, both engines, model-wide shape audit',
          grandTotals: grand,
          perSection,
          terminationDiffs: diffRows,
          sameFormationOverlaps: overlapRows,
          substrateAboveTie: tieRows,
        },
        null,
        1,
      ),
    )

    console.log('\n########## GRAND TOTALS ##########')
    console.log(`  v1-short-v2-full (owner complaint class): ${totV1ShortV2Full}`)
    console.log(`  v2-short-v1-full (regressions the other way): ${totV2ShortV1Full}`)
    console.log(`  same-formation overlap pairs: v1=${totOverlapV1} v2=${totOverlapV2}`)
    console.log(`  substrate-above-tie instances: v1=${totTieV1} v2=${totTieV2}`)
    console.log(`  dumped -> ${DUMP}`)
    console.log('##################################')
    expect(true).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Scan helpers (kept in-file — this is a diag).
// ---------------------------------------------------------------------------

const round = (x: number): number => Math.round(x * 1000) / 1000

function groupByGap(regions: SectionRegion[]): Map<number, SectionRegion[]> {
  const m = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    if (!m.has(r.gapIndex)) m.set(r.gapIndex, [])
    m.get(r.gapIndex)!.push(r)
  }
  return m
}

/**
 * Pairwise vertical overlap between SAME-formation regions in a gap (mirror of the
 * diff-litho scan, dropping the formation inequality). Any pair overlapping >1 mm
 * vertically at any sampled fraction is reported (the owner sees double-painted silt
 * quads at S5/S5a/S5b). Lens regions deliberately overlay their matrix, so a
 * lens×same-formation pair is expected; we keep it but tag the kinds so those are
 * distinguishable from quad×quad double-paint.
 */
function sameFormationOverlaps(
  gaps: Map<number, SectionRegion[]>,
  section: string,
  engine: 'v1' | 'v2',
  fname: (id: string) => string,
): OverlapRow[] {
  const rows: OverlapRow[] = []
  for (const [gi, regs] of gaps) {
    const best = new Map<string, { maxV: number; f: number; kindA: string; kindB: string }>()
    for (let f = 0.02; f < 0.985; f += 0.02) {
      for (let a = 0; a < regs.length; a++) {
        for (let b = a + 1; b < regs.length; b++) {
          if (regs[a].formationId !== regs[b].formationId) continue
          const ia = coveredIntervals(regs[a].polygon, f)
          const ib = coveredIntervals(regs[b].polygon, f)
          for (const [a1, a2] of ia)
            for (const [b1, b2] of ib) {
              const v = Math.min(a2, b2) - Math.max(a1, b1)
              if (v > 0.001) {
                const key = `${fname(regs[a].formationId)}|${regs[a].kind}|${regs[b].kind}`
                const cur = best.get(key)
                if (!cur || v > cur.maxV)
                  best.set(key, { maxV: v, f, kindA: regs[a].kind, kindB: regs[b].kind })
              }
            }
        }
      }
    }
    for (const [key, v] of best) {
      rows.push({
        section,
        gap: gi,
        engine,
        formation: key.split('|')[0],
        kindA: v.kindA,
        kindB: v.kindB,
        maxVertOverlapM: round(v.maxV),
        atFraction: round(v.f),
      })
    }
  }
  return rows
}

/**
 * For every base-side tie in a gap, check whether any region of the tied
 * (below-tie) formation paints space ABOVE the tie line under either bracketing
 * column. The tie line elevation under a column is the base elevation of the tied
 * layer on that column. The tied unit itself occupies [tieElev .. tiedTop]; genuine
 * spill is a same-formation interval that reaches DOWN to the tie (bottom ≤ tie) yet
 * rises ABOVE the tied unit's own top — basal clay painting past the band (owner:
 * 23/126-B2). Excludes the tied unit and shallow bands that never touch the tie.
 */
function substrateAboveTie(
  gaps: Map<number, SectionRegion[]>,
  edges: CorrelationEdge[],
  layerInfo: Map<string, LayerInfo>,
  colNames: string[],
  section: string,
  engine: 'v1' | 'v2',
  fname: (id: string) => string,
): TieRow[] {
  const rows: TieRow[] = []
  const MARGIN = 0.01 // 1 cm — below this is contact-line noise, not spill.
  for (const e of edges) {
    if (e.aSide !== 'base' && e.bSide !== 'base') continue
    const ia = layerInfo.get(e.a)
    const ib = layerInfo.get(e.b)
    if (!ia || !ib) continue
    // The two tied units live on two columns; the gap between them is min(col).
    const lo = Math.min(ia.col, ib.col)
    const hi = Math.max(ia.col, ib.col)
    if (hi - lo !== 1) continue // only adjacent-column ties bracket a single gap.
    const gi = lo
    const regs = gaps.get(gi) ?? []
    // Per-side tie elevation + formation (both ties should share formation, but be safe).
    const sides = [
      { info: ia, frac: ia.col === lo ? 0 : 1 },
      { info: ib, frac: ib.col === lo ? 0 : 1 },
    ]
    for (const { info, frac } of sides) {
      const tieElev = info.baseElev // the tied base = the correlation band elevation.
      const tiedTop = info.topElev // where this tied unit legitimately ends.
      const col = colNames[info.col] ?? `col${info.col}`
      // A near-edge sample fraction (avoid the exact vertical edge where slices vanish).
      const sampleF = frac === 0 ? 0.02 : 0.98
      // Spill = a same-formation interval that sits ON the tie (bottom ≤ tie) yet its
      // TOP rises above the tied unit's own top (basal body painting past the band).
      let worstTop = -Infinity
      for (const r of regs) {
        if (r.formationId !== info.formationId) continue
        for (const [bot, top] of coveredIntervals(r.polygon, sampleF)) {
          if (bot <= tieElev + 0.05 && top > worstTop) worstTop = top
        }
      }
      if (worstTop > tiedTop + MARGIN) {
        rows.push({
          section,
          gap: gi,
          engine,
          formation: fname(info.formationId),
          column: col,
          tieElev: round(tieElev),
          paintTopElev: round(worstTop),
          aboveByM: round(worstTop - tiedTop),
        })
      }
    }
  }
  return rows
}
