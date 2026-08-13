/**
 * LITHO-CONSISTENCY GATE — the direct geotech partition may only SUBDIVIDE the
 * litho fill, never redraw it (owner ruling 2026-08-13: "you have to start
 * from the exact litho geometries").
 *
 * Both arms run the SAME engine (``computeSectionFillActive``) on the same
 * section: the litho arm on the litho columns + litho edges, the geotech arm
 * on the geotech bands + geotech ties — the computation the 3-D build and
 * (since the 2026-08-13 swap) the geotech-axis render both use. Every polygon
 * is mapped into (along metres × elevation) with its own arm's column
 * positions, the plane is rastered painter-order (non-lens first, lenses
 * last), and each cell asks ONE question: does the geotech arm put the same
 * SOIL here as the litho arm? Agreement is area-weighted over the
 * litho-covered plane, so the number reads as "the share of the litho fill
 * the geotech fill reproduces".
 *
 * Mechanism, not measurement: the litho geometry is carried down by COMPLETE
 * tie restatement (forced topmost + base↔base — ``geotech_edge_derivation``),
 * so a dropped percentage means restatements are missing or an engine input
 * diverged, and the top clusters name where.
 *
 * INPUT      scripts/throwaway_geotech_axis_inputs.json — an UNTRACKED
 *            read-only dump of the OWNER'S dev DB. Regenerate with:
 *                uv run python scripts/dump_geotech_axis_inputs.py
 *            Missing input FAILS with this recipe — never skips.
 * BASELINE   __fixtures__/geotech_litho_consistency_baseline.json —
 *            committed; records the model ids + per-section agreement.
 *            A run on other ids reports NOT COMPARABLE and enforces nothing.
 *            Freeze/refresh with CONSISTENCY_FREEZE=1 (only commit a refresh
 *            when the numbers IMPROVED — the ratchet direction).
 * REPORT     scripts/throwaway_geotech_litho_consistency.txt, every run.
 *
 * Dormant unless GEOTECH_LITHO_CONSISTENCY=1.
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
// GEOTECH_AXIS_INPUT overrides the dump path for what-if runs (e.g. the
// restatement-rerun predictor feeds an augmented copy); the default is the
// live dump. Enforcement still keys on the model ids inside the file.
const INPUT = process.env.GEOTECH_AXIS_INPUT
  ? resolve(REPO_ROOT, process.env.GEOTECH_AXIS_INPUT)
  : resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const BASELINE = resolve(HERE, '__fixtures__/geotech_litho_consistency_baseline.json')
const REPORT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_litho_consistency.txt')

/** Agreement may drop at most this many percentage points below the baseline
 *  (raster jitter guard — the raster is deterministic, so this is generous). */
const TOLERANCE_PP = 0.1

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
interface RawArm {
  columns: RawColumn[]
  edges: RawEdge[]
  alongM: number[]
}
interface RawSection extends RawArm {
  sectionId: string
  name: string
  geotech: RawArm
}
interface RawFile {
  meta: { projectId: string; lithoModelId: string; geotechModelId: string }
  refinementBundle: {
    nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
    lithoSoilByFormationId: Record<string, string | null>
  }
  sections: RawSection[]
}

interface Baseline {
  lithoModelId: string
  geotechModelId: string
  sections: Record<string, number>
}

const toEdges = (raw: readonly RawEdge[]): CorrelationEdge[] =>
  raw.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))

function assemble(arm: RawArm): { columns: PartitionColumn[]; alongM: number[] } {
  const paired = arm.columns
    .map((c, i) => ({ c, a: arm.alongM[i] }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .sort((p, q) => p.a - q.a)
  return {
    columns: paired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
    })),
    alongM: paired.map(({ a }) => a),
  }
}

/** A painter-ordered polygon in (along metres × elevation). */
interface AlongPoly {
  soil: string
  pts: { x: number; e: number }[]
}

function toAlongPolys(
  regions: readonly SectionRegion[],
  alongM: readonly number[],
  soilOf: (formationId: string) => string,
): AlongPoly[] {
  const nonLens: AlongPoly[] = []
  const lens: AlongPoly[] = []
  for (const r of regions) {
    const x0 = alongM[r.gapIndex]
    const x1 = alongM[r.gapIndex + 1]
    if (x0 === undefined || x1 === undefined || !(x1 - x0 > 1e-9)) continue
    const poly: AlongPoly = {
      soil: soilOf(r.formationId),
      pts: r.polygon.map((p) => ({ x: x0 + p.fraction * (x1 - x0), e: p.elevation })),
    }
    ;(r.kind === 'lens' ? lens : nonLens).push(poly)
  }
  return [...nonLens, ...lens] // lenses paint last — the render's z-order
}

/** Elevation crossings of the vertical line at ``x`` (half-open rule). */
function crossings(pts: readonly { x: number; e: number }[], x: number): number[] {
  const ys: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
      ys.push(a.e + ((x - a.x) / (b.x - a.x)) * (b.e - a.e))
    }
  }
  return ys.sort((p, q) => p - q)
}

describe('geotech fill — litho-consistency gate', () => {
  if (process.env.GEOTECH_LITHO_CONSISTENCY !== '1') {
    it.skip('dormant (set GEOTECH_LITHO_CONSISTENCY=1)', () => {})
    return
  }

  it('the direct geotech partition reproduces the litho fill, section by section', () => {
    if (!existsSync(INPUT)) {
      throw new Error(
        `${INPUT} not found — this gate judges the CURRENT dev model. Regenerate with:\n` +
          `  uv run python scripts/dump_geotech_axis_inputs.py   (read-only, dev DB)\n` +
          `then re-run with GEOTECH_LITHO_CONSISTENCY=1.`,
      )
    }
    process.env.STRIX_PARTITION_V2 = '1'
    const NL = String.fromCharCode(10)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile

    const nadSoil = new Map(
      Object.entries(raw.refinementBundle.nadMeta).map(([k, v]) => [k, v.soilCode ?? 'UNKNOWN']),
    )
    const lithoSoil = new Map(Object.entries(raw.refinementBundle.lithoSoilByFormationId))
    const soilOfLitho = (fid: string): string => lithoSoil.get(fid) ?? 'UNKNOWN'
    const soilOfGeo = (fid: string): string => nadSoil.get(fid) ?? 'UNKNOWN'

    const rep: string[] = []
    const agreeBySection: Record<string, number> = {}

    for (const sec of raw.sections) {
      const L = assemble(sec)
      const G = assemble(sec.geotech)
      if (L.columns.length < 2) continue
      const emptyBoundaries = new Map<string, BodyBoundaryResponse>()
      const lithoEdges = toEdges(sec.edges)
      const lithoRegions = computeSectionFillActive(
        L.columns,
        lithoEdges,
        deriveSectionApexOverrides(L.columns, lithoEdges, L.alongM, emptyBoundaries, true),
        L.alongM,
      )
      const geoEdges = toEdges(sec.geotech.edges)
      const geoRegions =
        G.columns.length >= 2
          ? computeSectionFillActive(
              G.columns,
              geoEdges,
              deriveSectionApexOverrides(G.columns, geoEdges, G.alongM, emptyBoundaries, true),
              G.alongM,
            )
          : []

      const lithoPolys = toAlongPolys(lithoRegions, L.alongM, soilOfLitho)
      const geoPolys = toAlongPolys(geoRegions, G.alongM, soilOfGeo)

      // Raster the section plane. Painter order: later polygons overwrite.
      const xs = [
        ...lithoPolys.flatMap((p) => p.pts.map((q) => q.x)),
        ...geoPolys.flatMap((p) => p.pts.map((q) => q.x)),
      ]
      const es = lithoPolys.flatMap((p) => p.pts.map((q) => q.e))
      if (xs.length === 0 || es.length === 0) continue
      const xMin = Math.min(...xs)
      const xMax = Math.max(...xs)
      const eMax = Math.max(...es)
      const eMin = Math.min(...es)
      const NX = 400
      const NE = 700
      const cellM2 = ((xMax - xMin) / NX) * ((eMax - eMin) / NE)

      let agree = 0
      let mismatch = 0
      const clusters = new Map<string, { m2: number; eLo: number; eHi: number }>()
      for (let xi = 0; xi < NX; xi++) {
        const x = xMin + ((xi + 0.5) * (xMax - xMin)) / NX
        // Per-column soil at each elevation cell, painter order per arm.
        const paint = (polys: AlongPoly[]): (string | '')[] => {
          const col: (string | '')[] = new Array(NE).fill('')
          for (const p of polys) {
            const ys = crossings(p.pts, x)
            for (let k = 0; k + 1 < ys.length; k += 2) {
              const lo = Math.max(0, Math.ceil(((ys[k] - eMin) / (eMax - eMin)) * NE))
              const hi = Math.min(NE, Math.floor(((ys[k + 1] - eMin) / (eMax - eMin)) * NE))
              for (let r = lo; r < hi; r++) col[r] = p.soil
            }
          }
          return col
        }
        const lc = paint(lithoPolys)
        const gc = paint(geoPolys)
        for (let r = 0; r < NE; r++) {
          if (lc[r] === '') continue // outside the litho fill — not judged
          if (gc[r] === lc[r]) agree++
          else {
            mismatch++
            const key = `${lc[r]} -> ${gc[r] === '' ? '(void)' : gc[r]}`
            const e = eMin + ((r + 0.5) * (eMax - eMin)) / NE
            const cur = clusters.get(key) ?? { m2: 0, eLo: Infinity, eHi: -Infinity }
            cur.m2 += cellM2
            cur.eLo = Math.min(cur.eLo, e)
            cur.eHi = Math.max(cur.eHi, e)
            clusters.set(key, cur)
          }
        }
      }
      const covered = agree + mismatch
      const pct = covered > 0 ? (agree / covered) * 100 : 100
      agreeBySection[sec.name] = pct
      rep.push(
        `${sec.name.padEnd(18)} agree ${pct.toFixed(1)}%  litho-covered ` +
          `${(covered * cellM2).toFixed(0)} m2  mismatch ${(mismatch * cellM2).toFixed(1)} m2`,
      )
      const top = [...clusters.entries()].sort((a, b) => b[1].m2 - a[1].m2).slice(0, 4)
      for (const [key, v] of top) {
        if (v.m2 < 1) continue
        rep.push(
          `    ${key.padEnd(20)} ${v.m2.toFixed(1)} m2  elev [${v.eLo.toFixed(1)}..${v.eHi.toFixed(1)}]`,
        )
      }
    }

    writeFileSync(REPORT, rep.join(NL))
    // eslint-disable-next-line no-console
    console.log(NL + rep.join(NL))

    if (process.env.CONSISTENCY_FREEZE === '1') {
      const frozen: Baseline = {
        lithoModelId: raw.meta.lithoModelId,
        geotechModelId: raw.meta.geotechModelId,
        sections: Object.fromEntries(
          Object.entries(agreeBySection).map(([k, v]) => [k, Number(v.toFixed(2))]),
        ),
      }
      writeFileSync(BASELINE, JSON.stringify(frozen, null, 2))
      // eslint-disable-next-line no-console
      console.log(`baseline frozen: ${BASELINE}`)
      return
    }

    if (!existsSync(BASELINE)) {
      // eslint-disable-next-line no-console
      console.log('no baseline committed — report-only run (freeze with CONSISTENCY_FREEZE=1)')
      expect(Object.keys(agreeBySection).length).toBeGreaterThan(0)
      return
    }
    const baseline = JSON.parse(readFileSync(BASELINE, 'utf8')) as Baseline
    if (
      baseline.lithoModelId !== raw.meta.lithoModelId ||
      baseline.geotechModelId !== raw.meta.geotechModelId
    ) {
      // eslint-disable-next-line no-console
      console.log('NOT COMPARABLE — the baseline was frozen on different model ids; enforcing nothing')
      return
    }
    const regressions: string[] = []
    for (const [name, frozenPct] of Object.entries(baseline.sections)) {
      const now = agreeBySection[name]
      if (now === undefined) {
        regressions.push(`${name}: section missing from this run (baseline ${frozenPct}%)`)
      } else if (now < frozenPct - TOLERANCE_PP) {
        regressions.push(`${name}: ${now.toFixed(2)}% < baseline ${frozenPct}%`)
      }
    }
    expect(regressions, regressions.join('; ')).toEqual([])
  })
})
