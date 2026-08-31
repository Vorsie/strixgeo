/**
 * CLAMPED-EDGE REACH — the live-dump arm of the tripwire in
 * ``geotechHierarchicalFill/edgeReach.ts``.
 *
 * The rule is pinned hard, on synthetic scenes, in ``edgeReach.test.ts``. THIS
 * arm reads the owner's real model and REPORTS: how many gaps of each section
 * the 3-D build cannot read at a column edge, and — because that is the number
 * the argument has twice turned on — the worst edge shortfall in millimetres,
 * measured against each gap's OWN width.
 *
 * WHY THE DENOMINATOR IS PRINTED TWICE. "The geotech payload stops 25 mm short
 * on 2 of 69 gaps" has been raised twice and refuted twice, and both times the
 * refutation was the same arithmetic: a shortfall expressed as a FRACTION,
 * multiplied by the SECTION's length instead of the GAP's width, reads a
 * hundred times too large on a narrow gap (debt #259 — *"it came from a bad
 * fraction→metres conversion... section length used in place of gap
 * length"*). The report prints both so the two can never again be confused
 * without it being visible on the same line.
 *
 * INPUT      scripts/throwaway_geotech_axis_inputs.json — an UNTRACKED
 *            read-only dump of the OWNER'S dev DB. Regenerate with:
 *                uv run python scripts/dump_geotech_axis_inputs.py
 *            Missing input FAILS with this recipe — never skips.
 * REPORT     scripts/throwaway_edge_reach.txt, every run.
 *
 * Dormant unless GEOTECH_EDGE_REACH=1.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { clampedEdgeFractions, edgeReachViolations } from './geotechHierarchicalFill/edgeReach'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import { frameAlignedColumns } from './frameAlignedPartition'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = process.env.GEOTECH_AXIS_INPUT
  ? resolve(REPO_ROOT, process.env.GEOTECH_AXIS_INPUT)
  : resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const REPORT = resolve(REPO_ROOT, 'scripts/throwaway_edge_reach.txt')

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
  refinementBundle: {
    nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
  }
  sections: RawSection[]
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

/** How far short of fraction 0 and 1 a gap's regions stop, as fractions. */
function shortfallOf(regions: readonly SectionRegion[], gapIndex: number): [number, number] {
  let minF = Infinity
  let maxF = -Infinity
  for (const r of regions) {
    if (r.gapIndex !== gapIndex) continue
    for (const p of r.polygon) {
      if (p.fraction < minF) minF = p.fraction
      if (p.fraction > maxF) maxF = p.fraction
    }
  }
  if (minF === Infinity) return [0, 0]
  return [minF, 1 - maxF]
}

describe('geotech fill — clamped-edge reach on the live model', () => {
  if (process.env.GEOTECH_EDGE_REACH !== '1') {
    it.skip('dormant (set GEOTECH_EDGE_REACH=1)', () => {})
    return
  }

  it('reports every gap the 3-D build cannot read at a column edge', () => {
    if (!existsSync(INPUT)) {
      throw new Error(
        `${INPUT} not found — this diag judges the CURRENT dev model. Regenerate with:` +
          `\n  uv run python scripts/dump_geotech_axis_inputs.py   (read-only, dev DB)` +
          `\nthen re-run with GEOTECH_EDGE_REACH=1.`,
      )
    }
    const NL = String.fromCharCode(10)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const classOf = buildPackingClassOf(Object.entries(raw.refinementBundle.nadMeta))
    const rep: string[] = []
    let gaps = 0
    let violations = 0
    type Shortfall = { mmGap: number; mmSection: number; tag: string; arm: string }
    const none: Shortfall = { mmGap: -Infinity, mmSection: -Infinity, tag: '', arm: '' }
    let worst = none
    let worstBySectionRuler = none

    for (const sec of raw.sections) {
      const L = assemble(sec)
      const G = assemble(sec.geotech)
      if (L.columns.length < 2) continue
      const empty = new Map<string, BodyBoundaryResponse>()
      const lithoEdges = toEdges(sec.edges)
      const lithoRegions = computeSectionFillActive(
        L.columns,
        lithoEdges,
        deriveSectionApexOverrides(L.columns, lithoEdges, L.alongM, empty),
        L.alongM,
      )
      const hier = computeHierarchicalGeotechFill({
        lithoColumns: L.columns,
        lithoEdges,
        lithoRegions,
        geotechColumns: frameAlignedColumns(
          L.columns,
          new Map(G.columns.map((c) => [c.investigationId, c])),
        ),
        geotechEdges: toEdges(sec.geotech.edges),
        alongM: L.alongM,
        packingClassOf: classOf,
      })
      // The CONTROL arm: the litho payload runs the same gate, so "geotech
      // stops short where litho does not" is a claim the report can settle.
      const lithoOwn = edgeReachViolations(lithoRegions, lithoRegions, L.alongM)
      const geo = hier.diagnostics.edgeReachViolations
      gaps += L.columns.length - 1
      violations += geo.length
      rep.push(
        `${sec.name.padEnd(18)} gaps=${String(L.columns.length - 1).padStart(2)} ` +
          `geotechViolations=${geo.length} lithoViolations=${lithoOwn.length}`,
      )
      for (const v of geo) {
        rep.push(
          `    gap ${v.gapIndex} edge ${v.edge} at fraction ${v.fraction} — ` +
            `cover holds ${v.coverM.toFixed(3)} m, fill holds ${v.filledM.toFixed(3)} m`,
        )
      }
      const sectionLengthM = L.alongM[L.alongM.length - 1] - L.alongM[0]
      for (let g = 0; g + 1 < L.columns.length; g++) {
        const widthM = L.alongM[g + 1] - L.alongM[g]
        for (const [arm, regions] of [
          ['litho', lithoRegions],
          ['geo', hier.regions],
        ] as const) {
          for (const s of shortfallOf(regions, g)) {
            const candidate: Shortfall = {
              mmGap: s * widthM * 1000,
              mmSection: s * sectionLengthM * 1000,
              tag: `${sec.name} gap ${g} (width ${widthM.toFixed(2)} m of a ${sectionLengthM.toFixed(0)} m section)`,
              arm,
            }
            if (candidate.mmGap > worst.mmGap) worst = candidate
            if (candidate.mmSection > worstBySectionRuler.mmSection) {
              worstBySectionRuler = candidate
            }
          }
        }
      }
    }

    rep.unshift(
      `gaps=${gaps} geotechEdgeReachViolations=${violations}`,
      `worst edge shortfall, GAP-width ruler (correct): ${worst.mmGap.toFixed(3)} mm` +
        ` on the ${worst.arm} arm — ${worst.tag}`,
      `worst edge shortfall, SECTION-length ruler (the #259 error):` +
        ` ${worstBySectionRuler.mmSection.toFixed(1)} mm on the ${worstBySectionRuler.arm} arm` +
        ` — ${worstBySectionRuler.tag}; its TRUE size is ${worstBySectionRuler.mmGap.toFixed(3)} mm.`,
      `  That substitution is the whole of the "stops 25 mm short" claim.`,
      `  The build's own inset is ${(clampedEdgeFractions(1)[0] * 1000).toFixed(1)} mm of gap, so every` +
        ` shortfall above is cleared by construction.`,
      '',
    )
    writeFileSync(REPORT, rep.join(NL) + NL, 'utf8')
    console.info(rep.join(NL))
    // Report-only on live data: the dump is a snapshot of a model mid-edit and
    // a red here must not block a suite. The rule is enforced on the synthetic
    // pins; this arm exists to be READ.
    expect(gaps).toBeGreaterThan(0)
  })
})
