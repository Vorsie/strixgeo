/**
 * THROWAWAY DIAG — dump one section's litho + direct-geotech partitions
 * (all gaps) for offline per-gap mismatch analysis.
 *
 * Dormant unless SECTION_DUMP=1. Env: SECTION_DUMP_NAME (default
 * "Cross-section 1"), GEOTECH_AXIS_INPUT (input override, same as the
 * consistency gate). Writes scripts/throwaway_section_dump.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { frameAlignedColumns } from './frameAlignedPartition'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = process.env.GEOTECH_AXIS_INPUT
  ? resolve(REPO_ROOT, process.env.GEOTECH_AXIS_INPUT)
  : resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_section_dump.json')

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
      units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
    })),
    alongM: paired.map(({ a }) => a),
  }
}

const dumpRegions = (regs: readonly SectionRegion[]) =>
  regs.map((r) => ({
    gap: r.gapIndex,
    kind: r.kind,
    formationId: r.formationId,
    layerIds: r.layerIds,
    pts: r.polygon.map((p) => [p.fraction, p.elevation] as [number, number]),
  }))

describe('SECTION dump diag', () => {
  if (process.env.SECTION_DUMP !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set SECTION_DUMP=1)', () => {})
    return
  }
  it('dumps both partitions of the named section', () => {
    const name = process.env.SECTION_DUMP_NAME ?? 'Cross-section 1'
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const sec = raw.sections.find((s) => s.name === name)
    if (!sec) throw new Error(`section ${name} not in dump`)
    const empty = new Map<string, BodyBoundaryResponse>()
    const L = assemble(sec)
    const G = assemble(sec.geotech)
    const lithoEdges = toEdges(sec.edges)
    const geoEdges = toEdges(sec.geotech.edges)
    const litho = computeSectionFillActive(
      L.columns,
      lithoEdges,
      deriveSectionApexOverrides(L.columns, lithoEdges, L.alongM, empty),
      L.alongM,
    )
    // The RAW arm — the packing model's own whole-section partition, kept in
    // the dump so a scene can be read against what the engine says before the
    // litho frame confines it.
    const geo = computeSectionFillActive(
      G.columns,
      geoEdges,
      deriveSectionApexOverrides(G.columns, geoEdges, G.alongM, empty),
      G.alongM,
    )
    // What the geotech axis actually draws: densities within lithos.
    const hierarchical = computeHierarchicalGeotechFill({
      lithoColumns: L.columns,
      lithoEdges,
      lithoRegions: litho,
      geotechColumns: frameAlignedColumns(
        L.columns,
        new Map(G.columns.map((c) => [c.investigationId, c])),
      ),
      geotechEdges: geoEdges,
      alongM: L.alongM,
      packingClassOf: buildPackingClassOf(Object.entries(raw.refinementBundle.nadMeta)),
    })
    writeFileSync(
      OUT,
      JSON.stringify({
        name,
        lithoAlongM: L.alongM,
        geoAlongM: G.alongM,
        lithoCols: L.columns.map((c) => c.investigationId),
        geoCols: G.columns.map((c) => c.investigationId),
        nadMeta: raw.refinementBundle.nadMeta,
        lithoSoil: raw.refinementBundle.lithoSoilByFormationId,
        litho: dumpRegions(litho),
        geo: dumpRegions(geo),
        clipped: dumpRegions(hierarchical.regions),
        clippedFallback: dumpRegions(hierarchical.lithoFallback),
        diagnostics: hierarchical.diagnostics,
      }),
    )
    expect(true).toBe(true)
  })
})
