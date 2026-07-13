/**
 * THROWAWAY DIAG — A/B PARITY runner for partition engine v2
 * (design doc ``docs/design/partition-engine-v2.md`` §6). Runs BOTH engines on
 * all 14 real sections (REAL alongM) and reports, per section, how v2 differs
 * from v1:
 *
 *   - total v1 area vs total v2 area (shoelace on the fraction×elevation
 *     polygons; unit = fraction·metre, i.e. fraction of gap width × metres of
 *     elevation — NOT physical m²);
 *   - per-GROUP area delta, where a group is ``(gapIndex, formationId, bodyId)``
 *     and can hold several regions per engine (group-total areas compared, not
 *     region counts);
 *   - kind/classification changes (a group quad in v1 but lens in v2, etc.);
 *   - groups present in only ONE engine (with area).
 *
 * Known intentional diff classes labelled where detectable (design §4):
 *   - ``v1-double-paint``  — v1 paints an enclosed lens OVER its matrix band, so
 *     the matrix group is bigger in v1 (space double-counted). v2 emits a
 *     disjoint partition. Heuristic: a v1 lens group's polygon envelope is
 *     contained in this matrix group's fraction/elevation envelope in the same
 *     gap, and v1 > v2 by roughly the lens area. Labelled, not hidden.
 *   - ``v2-vacancy-hole`` — v2 above-TD vacancy closure lands in a parallel
 *     increment (4a); until then v1 has MORE area in the affected gaps. Flagged
 *     when v1 > v2 and the missing area sits above the gap's shallow TD.
 *   - otherwise the delta is reported RAW (real geometry drift to explain).
 *
 * Pure reporter — never fails (``expect(true).toBe(true)``); read the console
 * output. Also writes the full machine-readable diff to
 * ``scripts/diag_parity_v1_v2.json`` (overwritten each run) so diffs can be
 * tracked across increments.
 *
 * Run:
 *   $env:PARITY_DIAG='1'; npx vitest run \
 *     src/renderer/src/utils/partitionFillV2.parity.diag.test.ts \
 *     --disableConsoleIntercept
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
import { unionCoverageArea } from './partitionFillV2.parityCoverage'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const OUT = resolve(REPO_ROOT, 'scripts/diag_parity_v1_v2.json')

/** 1 cm² threshold in fraction·metre space (0.0001). Deltas below this = noise. */
const AREA_EPS = 0.0001

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

/** Shoelace area of a closed ring in (fraction, elevation) space. Always ≥ 0. */
function ringArea(poly: readonly PartitionPoint[]): number {
  const n = poly.length
  if (n < 3) return 0
  let s = 0
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return Math.abs(s) / 2
}

/** Axis-aligned bounding box of a ring in (fraction, elevation) space. */
interface Box {
  fMin: number
  fMax: number
  eMin: number
  eMax: number
}
function ringBox(poly: readonly PartitionPoint[]): Box {
  let fMin = Infinity
  let fMax = -Infinity
  let eMin = Infinity
  let eMax = -Infinity
  for (const p of poly) {
    if (p.fraction < fMin) fMin = p.fraction
    if (p.fraction > fMax) fMax = p.fraction
    if (p.elevation < eMin) eMin = p.elevation
    if (p.elevation > eMax) eMax = p.elevation
  }
  return { fMin, fMax, eMin, eMax }
}
/** Union of two boxes. */
function boxUnion(a: Box, b: Box): Box {
  return {
    fMin: Math.min(a.fMin, b.fMin),
    fMax: Math.max(a.fMax, b.fMax),
    eMin: Math.min(a.eMin, b.eMin),
    eMax: Math.max(a.eMax, b.eMax),
  }
}
/** True when box ``inner`` sits (with a small tolerance) inside box ``outer``. */
function boxContains(outer: Box, inner: Box): boolean {
  const tol = 0.02 // 2 % fraction / 2 cm elevation slack for snap rounding
  return (
    inner.fMin >= outer.fMin - tol &&
    inner.fMax <= outer.fMax + tol &&
    inner.eMin >= outer.eMin - tol &&
    inner.eMax <= outer.eMax + tol
  )
}

/** A ``(gapIndex, formationId, bodyId)`` group's aggregate over one engine. */
interface GroupAgg {
  area: number
  kinds: Set<string>
  box: Box | null
  count: number
}
function emptyAgg(): GroupAgg {
  return { area: 0, kinds: new Set<string>(), box: null, count: 0 }
}
function groupKey(r: SectionRegion): string {
  return `${r.gapIndex}|${r.formationId}|${r.bodyId ?? 'null'}`
}
/** Aggregate regions into ``(gap, formation, body)`` groups. */
function aggregate(regions: SectionRegion[]): Map<string, GroupAgg> {
  const m = new Map<string, GroupAgg>()
  for (const r of regions) {
    const k = groupKey(r)
    let g = m.get(k)
    if (!g) {
      g = emptyAgg()
      m.set(k, g)
    }
    g.area += ringArea(r.polygon)
    g.kinds.add(r.kind)
    g.count++
    const b = ringBox(r.polygon)
    g.box = g.box ? boxUnion(g.box, b) : b
  }
  return m
}

/** Machine-readable per-group diff record. */
interface GroupDiff {
  section: string
  gapIndex: number
  formationId: string
  formationName: string
  bodyId: string | null
  v1Area: number
  v2Area: number
  delta: number // v2 - v1
  v1Kinds: string[]
  v2Kinds: string[]
  kindChanged: boolean
  presence: 'both' | 'v1-only' | 'v2-only'
  label: 'v1-double-paint' | 'v2-vacancy-hole' | 'kind-only' | 'raw'
}

describe('v1↔v2 A/B parity diag', () => {
  if (process.env.PARITY_DIAG !== '1') {
    it.skip('dormant (set PARITY_DIAG=1)', () => {})
    return
  }
  it('runs both engines on every section and reports the diff', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)

    // Grand totals.
    let gTotV1 = 0
    let gTotV2 = 0
    let gGroupsOverEps = 0
    let gKindChanges = 0
    let gV1Only = 0
    let gV2Only = 0
    let gDoublePaint = 0
    let gVacancy = 0

    const summaryRows: string[] = []
    const allDiffs: GroupDiff[] = []

    /**
     * Per-section reconciliation: Δ = v1 double-paint + explained + residual.
     *
     *   v1Sum / v2Sum   — Σ of every region's shoelace area (the parity delta lives here).
     *   v1Union/v2Union — PIP union coverage (each cell once). v1Sum − v1Union is the
     *                     v1 DOUBLE-PAINT (lens overlays on their matrix); v2 is a true
     *                     partition so v2Sum ≈ v2Union.
     *   doublePaint     — v1Sum − v1Union (the space v1 counts twice).
     *   coverageDiff    — v1Union − v2Union (real coverage: v2's vacancy holes minus any
     *                     area v2 covers that v1 leaves empty; the "explained items").
     *   residual        — (v2Sum − v1Sum) − (−doublePaint) − coverageDiff, i.e. what the
     *                     double-paint + coverage split does NOT account for. Should be ~0.
     */
    interface Reconciliation {
      section: string
      v1Sum: number
      v2Sum: number
      v1Union: number
      v2Union: number
      doublePaint: number
      coverageDiff: number
      residual: number
    }
    const reconciliations: Reconciliation[] = []

    for (const sec of raw.sections) {
      const keep = sec.columns
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
      const columns: PartitionColumn[] = keep.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        // Thread layerId explicitly — matching + tie logic keys on it in both
        // engines; the RawUnit shape carries it verbatim from the extract.
        units: c.units.map((u) => ({
          layerId: u.layerId,
          topDepthM: u.topDepthM,
          baseDepthM: u.baseDepthM,
          formationId: u.formationId,
          bodyId: u.bodyId,
        })),
      }))
      const alongM = keep.map(({ i }) => sec.alongM[i])
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      // Per-gap shallow-TD elevation (higher of the two bracketing TDs) — used to
      // classify a v1>v2 area gap as above-TD (v2-vacancy) vs sub-TD.
      const tdElev = columns.map((c) =>
        Math.min(...c.units.map((u) => c.surfaceElevM - u.baseDepthM)),
      )
      const shallowTdForGap = (gi: number): number =>
        Math.max(tdElev[gi] ?? -Infinity, tdElev[gi + 1] ?? -Infinity)

      const v1 = computeSectionFill(columns, edges, undefined, alongM)
      const v2 = computeSectionFillV2(columns, edges, undefined, alongM)

      const totV1 = v1.reduce((s, r) => s + ringArea(r.polygon), 0)
      const totV2 = v2.reduce((s, r) => s + ringArea(r.polygon), 0)
      gTotV1 += totV1
      gTotV2 += totV2

      // ---- reconciliation: Δ = v1 double-paint + coverage-diff + residual ----
      const v1Union = unionCoverageArea(v1)
      const v2Union = unionCoverageArea(v2)
      const doublePaint = totV1 - v1Union // space v1 counts twice (lens over matrix)
      const coverageDiff = v1Union - v2Union // real coverage (v2 vacancy holes)
      // Δ (v2Sum − v1Sum) explained as: −doublePaint (v1 has extra double-counted area)
      // − coverageDiff (v2 covers less real space). Residual = the unexplained remainder.
      const residual = totV2 - totV1 - (-doublePaint - coverageDiff)
      reconciliations.push({
        section: sec.name,
        v1Sum: totV1,
        v2Sum: totV2,
        v1Union,
        v2Union,
        doublePaint,
        coverageDiff,
        residual,
      })

      const aggV1 = aggregate(v1)
      const aggV2 = aggregate(v2)

      // Per-gap: collect v1 lens-group envelopes so a matrix group's v1-excess
      // area can be recognised as double-paint (lens box inside matrix box).
      const v1LensBoxesByGap = new Map<number, Box[]>()
      for (const [k, g] of aggV1) {
        if (!g.kinds.has('lens') || !g.box) continue
        const gi = Number(k.split('|')[0])
        if (!v1LensBoxesByGap.has(gi)) v1LensBoxesByGap.set(gi, [])
        v1LensBoxesByGap.get(gi)!.push(g.box)
      }

      const allKeys = new Set<string>([...aggV1.keys(), ...aggV2.keys()])
      let secGroupsOverEps = 0
      let secKindChanges = 0
      let secV1Only = 0
      let secV2Only = 0
      const secDiffs: GroupDiff[] = []

      for (const k of allKeys) {
        const g1 = aggV1.get(k)
        const g2 = aggV2.get(k)
        const [giStr, formationId, bodyStr] = k.split('|')
        const gapIndex = Number(giStr)
        const bodyId = bodyStr === 'null' ? null : bodyStr
        const v1Area = g1?.area ?? 0
        const v2Area = g2?.area ?? 0
        const delta = v2Area - v1Area
        const v1Kinds = g1 ? [...g1.kinds].sort() : []
        const v2Kinds = g2 ? [...g2.kinds].sort() : []
        const presence: GroupDiff['presence'] = !g1 ? 'v2-only' : !g2 ? 'v1-only' : 'both'
        const kindChanged =
          presence === 'both' && v1Kinds.join(',') !== v2Kinds.join(',')

        // Only surface groups that matter: area delta over 1 cm², a kind change,
        // or a one-engine-only group.
        const areaMatters = Math.abs(delta) > AREA_EPS
        if (!areaMatters && !kindChanged && presence === 'both') continue

        // ---- classify the diff ----
        let label: GroupDiff['label'] = 'raw'
        if (presence === 'both' && !areaMatters && kindChanged) {
          label = 'kind-only'
        } else if (delta < -AREA_EPS && g1?.box) {
          // v1 has more area here. Two known benign classes:
          //  (a) v1 double-paint: a v1 lens box in this gap sits inside this
          //      matrix group's envelope (matrix area inflated by the lens).
          //  (b) v2 vacancy hole: the excess area is ABOVE the gap's shallow TD
          //      (v2 vacancy-closure deferred to increment 4a).
          const lensBoxes = v1LensBoxesByGap.get(gapIndex) ?? []
          const isDoublePaint =
            !v1Kinds.includes('lens') &&
            lensBoxes.some((lb) => boxContains(g1.box as Box, lb))
          const shallowTD = shallowTdForGap(gapIndex)
          // The v1 group extends above the shallow TD (its box top is higher).
          const aboveTD = g1.box.eMax > shallowTD + 0.01
          if (isDoublePaint) label = 'v1-double-paint'
          else if (aboveTD) label = 'v2-vacancy-hole'
          else label = 'raw'
        }

        if (areaMatters) secGroupsOverEps++
        if (kindChanged) secKindChanges++
        if (presence === 'v1-only') secV1Only++
        if (presence === 'v2-only') secV2Only++
        if (label === 'v1-double-paint') gDoublePaint++
        if (label === 'v2-vacancy-hole') gVacancy++

        secDiffs.push({
          section: sec.name,
          gapIndex,
          formationId,
          formationName: fname(formationId),
          bodyId,
          v1Area,
          v2Area,
          delta,
          v1Kinds,
          v2Kinds,
          kindChanged,
          presence,
          label,
        })
      }

      secDiffs.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      allDiffs.push(...secDiffs)
      gGroupsOverEps += secGroupsOverEps
      gKindChanges += secKindChanges
      gV1Only += secV1Only
      gV2Only += secV2Only

      // ---- per-section console block ----
      console.log(
        `\n=== ${sec.name}: v1Area=${totV1.toFixed(3)} v2Area=${totV2.toFixed(3)} ` +
          `Δ=${(totV2 - totV1).toFixed(3)} | groups>1cm²=${secGroupsOverEps} ` +
          `kindChanges=${secKindChanges} v1Only=${secV1Only} v2Only=${secV2Only}`,
      )
      for (const d of secDiffs.slice(0, 8)) {
        const cm2 = (d.delta * 10000).toFixed(1) // fraction·m → "cm²"-scale count
        const kindStr = d.kindChanged ? ` kind ${d.v1Kinds}→${d.v2Kinds}` : ''
        console.log(
          `   [${d.label}] gap${d.gapIndex} ${d.formationName} ` +
            `v1=${d.v1Area.toFixed(4)} v2=${d.v2Area.toFixed(4)} Δ=${cm2}cm² ` +
            `(${d.presence})${kindStr}`,
        )
      }
      summaryRows.push(
        `${sec.name.padEnd(18)} v1=${totV1.toFixed(3).padStart(8)} ` +
          `v2=${totV2.toFixed(3).padStart(8)} Δ=${(totV2 - totV1).toFixed(3).padStart(8)} ` +
          `grp>1cm²=${String(secGroupsOverEps).padStart(3)} ` +
          `kind=${String(secKindChanges).padStart(2)} ` +
          `v1only=${String(secV1Only).padStart(2)} v2only=${String(secV2Only).padStart(2)}`,
      )
    }

    // ---- summary table + grand totals ----
    console.log('\n########## PER-SECTION SUMMARY (area unit = fraction·metre) ##########')
    for (const row of summaryRows) console.log(row)
    console.log(
      `\n########## GRAND TOTALS: v1Area=${gTotV1.toFixed(3)} v2Area=${gTotV2.toFixed(3)} ` +
        `Δ=${(gTotV2 - gTotV1).toFixed(3)} (${(((gTotV2 - gTotV1) / gTotV1) * 100).toFixed(1)}%) | ` +
        `groups>1cm²=${gGroupsOverEps} kindChanges=${gKindChanges} ` +
        `v1Only=${gV1Only} v2Only=${gV2Only} | ` +
        `labelled: double-paint=${gDoublePaint} vacancy-hole=${gVacancy} ##########`,
    )

    // ---- per-section reconciliation table (design §6 verification note) ----
    console.log(
      '\n########## RECONCILIATION (fraction·metre): Δ = −doublePaint − coverageDiff + residual ##########',
    )
    console.log(
      'section            v1Sum    v2Sum   v1Union  v2Union  dblPaint  covDiff  Δ(v2-v1)  residual',
    )
    let gDoublePaintArea = 0
    let gCoverageDiff = 0
    let gResidual = 0
    let worstResidual = 0
    for (const r of reconciliations) {
      gDoublePaintArea += r.doublePaint
      gCoverageDiff += r.coverageDiff
      gResidual += r.residual
      if (Math.abs(r.residual) > Math.abs(worstResidual)) worstResidual = r.residual
      console.log(
        `${r.section.padEnd(18)} ${r.v1Sum.toFixed(2).padStart(7)} ${r.v2Sum.toFixed(2).padStart(7)} ` +
          `${r.v1Union.toFixed(2).padStart(7)} ${r.v2Union.toFixed(2).padStart(7)} ` +
          `${r.doublePaint.toFixed(2).padStart(7)} ${r.coverageDiff.toFixed(2).padStart(7)} ` +
          `${(r.v2Sum - r.v1Sum).toFixed(2).padStart(8)} ${r.residual.toFixed(3).padStart(8)}`,
      )
    }
    console.log(
      `\n[reconciliation] Σ doublePaint=${gDoublePaintArea.toFixed(3)} ` +
        `Σ coverageDiff=${gCoverageDiff.toFixed(3)} Σ residual=${gResidual.toFixed(3)} ` +
        `worstSectionResidual=${worstResidual.toFixed(3)} (residual gate: |·|<0.05/section)`,
    )

    // Top-15 largest-magnitude RAW (unexplained) deltas across all sections.
    const rawUnexplained = allDiffs
      .filter((d) => d.label === 'raw' && Math.abs(d.delta) > AREA_EPS)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 15)
    console.log('\n########## TOP UNEXPLAINED (raw) GROUP DELTAS ##########')
    for (const d of rawUnexplained) {
      console.log(
        `   ${d.section} gap${d.gapIndex} ${d.formationName} ` +
          `v1=${d.v1Area.toFixed(4)} v2=${d.v2Area.toFixed(4)} ` +
          `Δ=${(d.delta * 10000).toFixed(1)}cm² (${d.presence})` +
          `${d.kindChanged ? ` kind ${d.v1Kinds}→${d.v2Kinds}` : ''}`,
      )
    }

    // ---- machine-readable dump ----
    const dump = {
      generatedAt: new Date().toISOString(),
      areaUnit: 'fraction·metre (fraction of gap width × metres of elevation)',
      areaEps: AREA_EPS,
      grandTotals: {
        v1Area: gTotV1,
        v2Area: gTotV2,
        delta: gTotV2 - gTotV1,
        groupsOverEps: gGroupsOverEps,
        kindChanges: gKindChanges,
        v1Only: gV1Only,
        v2Only: gV2Only,
        labelledDoublePaint: gDoublePaint,
        labelledVacancyHole: gVacancy,
      },
      reconciliation: reconciliations,
      diffs: allDiffs,
    }
    writeFileSync(OUT, JSON.stringify(dump, null, 2), 'utf8')
    console.log(`\n[parity] wrote ${allDiffs.length} group diffs to ${OUT}`)

    expect(true).toBe(true)
  })
})
