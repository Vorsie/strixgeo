/**
 * THROWAWAY DIAG — dump one section's HIERARCHICAL geotech fill (the arm the
 * on-screen geotech axis renders), for the brainstorm visual. Mirrors the
 * input assembly of ``geotechLithoConsistency.diag.test.ts`` verbatim.
 *
 * Dormant unless HIER_DUMP=1. Env: HIER_DUMP_NAME (default "Cross-section 1").
 * Input: scripts/throwaway_geotech_axis_inputs.json
 * (``uv run python scripts/dump_geotech_axis_inputs.py`` first).
 * Writes scripts/throwaway_hier_dump.json.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import { frameAlignedColumns } from './frameAlignedPartition'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_hier_dump.json')

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: { topDepthM: number; [k: string]: unknown }[]
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
      units: [...c.units].sort(
        (a, b) => (a.topDepthM as number) - (b.topDepthM as number),
      ),
    })) as unknown as PartitionColumn[],
    alongM: paired.map(({ a }) => a),
  }
}

describe.skipIf(process.env.HIER_DUMP !== '1')('hierarchical fill dump', () => {
  it('dumps the framed geotech fill for one section', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const wanted = process.env.HIER_DUMP_NAME ?? 'Cross-section 1'
    const sec = raw.sections.find((s) => s.name === wanted)
    expect(sec, `section ${wanted} in the inputs`).toBeTruthy()
    if (!sec) return

    const L = assemble(sec)
    const G = assemble(sec.geotech)
    const lithoEdges = toEdges(sec.edges)
    const lithoRegions = computeSectionFillActive(
      L.columns,
      lithoEdges,
      deriveSectionApexOverrides(L.columns, lithoEdges, L.alongM, new Map(), true),
      L.alongM,
    )
    const out = computeHierarchicalGeotechFill({
      lithoColumns: L.columns,
      lithoEdges,
      lithoRegions,
      geotechColumns: frameAlignedColumns(
        L.columns,
        new Map(G.columns.map((c) => [(c as { investigationId: string }).investigationId, c])),
      ),
      geotechEdges: toEdges(sec.geotech.edges),
      alongM: L.alongM,
      packingClassOf: buildPackingClassOf(Object.entries(raw.refinementBundle.nadMeta)),
    })

    // Dump regions whole — the hierarchical SectionRegion's geometry field
    // names differ from the direct dump's, so guessing slims them to nothing.
    const slim = (r: object): object => ({ ...r })

    writeFileSync(
      OUT,
      JSON.stringify(
        {
          name: sec.name,
          alongM: L.alongM,
          cols: L.columns.map((c) => (c as { investigationId: string }).investigationId),
          nadMeta: raw.refinementBundle.nadMeta,
          regions: out.regions.map((r) => slim(r as never)),
          lithoFallback: out.lithoFallback.map((r) => slim(r as never)),
        },
        null,
        1,
      ),
    )
    expect(out.regions.length).toBeGreaterThan(0)
  })
})
