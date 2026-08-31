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
 * WHAT THE GEOTECH ARM IS (owner dogfeed 2026-08-15). It is assembled on the
 * LITHO FRAME's column axis, an un-banded column (an undivided borehole)
 * contributing an EMPTY stack: the frame splits into runs of consecutive
 * banded columns, each run is partitioned on its own, and its regions come
 * back on the frame's gap axis — so the clip ALWAYS applies and no packing
 * geometry ever crosses a column the model never classified. This is the
 * render's own construction, which is the point: before, the gate clipped
 * unconditionally while the render clipped only when the column sets happened
 * to match, so on a mid-pipeline model the gate reported a fill nobody saw.
 * ``CONSISTENCY_LEGACY=1`` reproduces the old render for a before/after read.
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
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import {
  frameAlignedColumns,
  frameGapRuns,
  shiftRegionGaps,
} from './frameAlignedPartition'
import { selectLithoFallbackRegions, type FallbackPackingBand } from './geotechFillFallback'
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

/**
 * Re-key a geotech region onto the LITHO gap axis by matching the gap's along
 * positions (identical column sets share indices; a subset — undivided
 * boreholes — shifts them). Regions over gaps with no exact litho match are
 * dropped from the clip measurement.
 */
function remapGaps(
  r: SectionRegion,
  fromAlongM: readonly number[],
  toAlongM: readonly number[],
): SectionRegion {
  const x0 = fromAlongM[r.gapIndex]
  const idx = toAlongM.findIndex((x) => Math.abs(x - x0) < 1e-6)
  return idx >= 0 ? { ...r, gapIndex: idx } : { ...r, gapIndex: -999 }
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
        deriveSectionApexOverrides(L.columns, lithoEdges, L.alongM, emptyBoundaries),
        L.alongM,
      )
      const geoEdges = toEdges(sec.geotech.edges)
      const nadSoilCodes = new Map(
        Object.entries(raw.refinementBundle.nadMeta).map(([k, v]) => [k, v.soilCode]),
      )
      // CONSISTENCY_LEGACY=1 reproduces the PRE-2026-08-15 render: the geotech
      // partition on its OWN (banded) column set, and the litho-frame clip
      // applied only when the two column sets happen to match positionally —
      // which an undivided borehole breaks, so the raw partition and the
      // whole-region fallback heuristic rendered instead. Kept as the
      // before-arm of the owner's dogfeed measurement.
      const legacy = process.env.CONSISTENCY_LEGACY === '1'
      // DEFAULT: what the render draws. The geotech partition is assembled on
      // the LITHO FRAME's column axis — an un-banded column contributes an
      // empty stack, so it splits the frame into runs the engine can partition
      // and no packing geometry ever crosses a column the model never
      // classified. Gap indices are the frame's, so the clip always applies.
      const geoRegions = legacy
        ? G.columns.length >= 2
          ? computeSectionFillActive(
              G.columns,
              geoEdges,
              deriveSectionApexOverrides(G.columns, geoEdges, G.alongM, emptyBoundaries),
              G.alongM,
            )
          : []
        : frameGapRuns(
            frameAlignedColumns(L.columns, new Map(G.columns.map((c) => [c.investigationId, c]))),
            L.alongM,
          ).flatMap((run) =>
            shiftRegionGaps(
              computeSectionFillActive(
                run.columns,
                geoEdges,
                deriveSectionApexOverrides(
                  run.columns,
                  geoEdges,
                  run.alongM,
                  emptyBoundaries,
    ),
                run.alongM,
              ),
              run.offset,
            ),
          )

      // The gate measures WHAT THE RENDER DRAWS: the hierarchical fill —
      // densities within lithos, one engine run per litho family, each clipped
      // to its own family's cover (owner ruling 2026-08-18). Its faces live on
      // the LITHO gap axis and its un-classed cover carries litho formations,
      // so both compare through the litho soil map.
      //
      // CONSISTENCY_RAW=1 measures the packing model's own whole-section
      // partition instead, un-confined (what-if analysis of the tie set alone);
      // CONSISTENCY_LEGACY=1 reproduces the pre-2026-08-15 render. Neither is
      // confined any more: the post-hoc clip that used to confine them retired
      // with this construction, and re-deriving it here would be a second copy
      // of a rule that no longer exists.
      const clipped =
        process.env.CONSISTENCY_RAW === '1' || legacy
          ? null
          : ((): { regions: SectionRegion[]; lithoFallback: SectionRegion[] } => {
              const out = computeHierarchicalGeotechFill({
                lithoColumns: L.columns,
                lithoEdges,
                lithoRegions,
                geotechColumns: frameAlignedColumns(
                  L.columns,
                  new Map(G.columns.map((c) => [c.investigationId, c])),
                ),
                geotechEdges: geoEdges,
                alongM: L.alongM,
                packingClassOf: buildPackingClassOf(Object.entries(raw.refinementBundle.nadMeta)),
              })
              return { regions: out.regions, lithoFallback: out.lithoFallback }
            })()
      // The bare ground the "correlate me" texture is drawn over. The clip
      // names it per face; without the clip the render fell back to the
      // whole-region heuristic, which is what the legacy arm reproduces.
      const packingBandsByInv = new Map<string, FallbackPackingBand[]>()
      for (const c of G.columns) {
        packingBandsByInv.set(
          c.investigationId,
          c.units.map((u) => ({
            topElevM: c.surfaceElevM - u.topDepthM,
            baseElevM: c.surfaceElevM - u.baseDepthM,
            soilCode: nadSoilCodes.get(u.formationId) ?? null,
          })),
        )
      }
      const unbandedFaces =
        clipped?.lithoFallback ??
        selectLithoFallbackRegions(
          lithoRegions,
          L.columns.map((c) => c.investigationId),
          packingBandsByInv,
          lithoSoil,
        )
      const lithoPolys = toAlongPolys(lithoRegions, L.alongM, soilOfLitho)
      const geoPolys = clipped
        ? [
            ...toAlongPolys(clipped.regions, L.alongM, soilOfGeo),
            ...toAlongPolys(clipped.lithoFallback, L.alongM, soilOfLitho),
          ]
        : // Render order: the bare ground paints BENEATH the packing fills.
          [
            ...toAlongPolys(unbandedFaces, L.alongM, soilOfLitho),
            ...toAlongPolys(geoRegions, G.alongM, soilOfGeo),
          ]

      // Raster the section plane. Painter order: later polygons overwrite.
      const xs = [
        ...lithoPolys.flatMap((p) => p.pts.map((q) => q.x)),
        ...geoPolys.flatMap((p) => p.pts.map((q) => q.x)),
      ]
      // Elevation window spans the LITHO geometry only, deliberately: the
      // gate judges litho-covered cells, so geotech material outside the
      // litho fill's elevation range is out of scope, not a miss.
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
      const clusters = new Map<
        string,
        { m2: number; eLo: number; eHi: number; xLo: number; xHi: number }
      >()
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
            const cur = clusters.get(key) ?? {
              m2: 0,
              eLo: Infinity,
              eHi: -Infinity,
              xLo: Infinity,
              xHi: -Infinity,
            }
            cur.m2 += cellM2
            cur.eLo = Math.min(cur.eLo, e)
            cur.eHi = Math.max(cur.eHi, e)
            cur.xLo = Math.min(cur.xLo, x)
            cur.xHi = Math.max(cur.xHi, x)
            clusters.set(key, cur)
          }
        }
      }
      const covered = agree + mismatch
      const pct = covered > 0 ? (agree / covered) * 100 : 100
      agreeBySection[sec.name] = pct
      rep.push(
        `${sec.name.padEnd(18)} agree ${pct.toFixed(1)}%  litho-covered ` +
          `${(covered * cellM2).toFixed(0)} m2  mismatch ${(mismatch * cellM2).toFixed(1)} m2` +
          `  packed ${clipped ? clipped.regions.length : geoRegions.length} faces` +
          `  un-banded ${unbandedFaces.length} faces (the "correlate me" texture)`,
      )
      const top = [...clusters.entries()].sort((a, b) => b[1].m2 - a[1].m2).slice(0, 4)
      for (const [key, v] of top) {
        if (v.m2 < 1) continue
        rep.push(
          `    ${key.padEnd(20)} ${v.m2.toFixed(1)} m2  elev [${v.eLo.toFixed(1)}..${v.eHi.toFixed(1)}]` +
            ` along [${v.xLo.toFixed(0)}..${v.xHi.toFixed(0)}]`,
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
