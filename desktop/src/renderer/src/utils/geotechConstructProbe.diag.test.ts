/**
 * CONSTRUCT PROBE — dump the fill's own decisions for ONE gap of the real
 * model (owner, 2026-08-21: *"instrument and try again"*). Per (family, gap)
 * run: every band's emit + which contacts counted as tied, every LINE fed to
 * the arrangement, and every face's owner + the tier that decided it.
 *
 * Dormant unless CONSTRUCT_PROBE=1. Env: PROBE_SECTION (default
 * "Cross-section 1"), PROBE_GAP (default 0), GEOTECH_AXIS_INPUT (input
 * override). Report: scripts/throwaway_construct_probe.txt.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { frameAlignedColumns } from './frameAlignedPartition'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { fillGapProbe } from './geotechHierarchicalFill/constructive/fillGapProbe'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = process.env.GEOTECH_AXIS_INPUT
  ? resolve(REPO_ROOT, process.env.GEOTECH_AXIS_INPUT)
  : resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_construct_probe.txt')

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
interface RawSection extends RawArm {
  name: string
  geotech: RawArm
}

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
      units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
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

describe('construct probe — the fill decisions of one gap', () => {
  if (process.env.CONSTRUCT_PROBE !== '1' || !existsSync(INPUT)) {
    it.skip('dormant (set CONSTRUCT_PROBE=1 with the real dump present)', () => {})
    return
  }
  it('dumps constructs, lines and face owners', () => {
    const NL = String.fromCharCode(10)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      refinementBundle: {
        nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
      }
    }
    const sectionName = process.env.PROBE_SECTION ?? 'Cross-section 1'
    const gap = Number(process.env.PROBE_GAP ?? '0')
    const sec = raw.sections.find((s) => s.name === sectionName)
    expect(sec, `section ${sectionName} not in the dump`).toBeDefined()
    const L = assemble(sec as RawSection)
    const G = assemble((sec as RawSection).geotech)
    const empty = new Map<string, BodyBoundaryResponse>()
    const lithoRegions = computeSectionFillActive(
      L.columns,
      L.edges,
      deriveSectionApexOverrides(L.columns, L.edges, L.alongM, empty),
      L.alongM,
    )
    // Band names for the report: layer id → class + elevation window.
    const nad = raw.refinementBundle.nadMeta
    const label = new Map<string, string>()
    for (const c of G.columns) {
      for (const u of c.units) {
        const m = nad[u.formationId]
        label.set(
          u.layerId,
          `${m ? m.soilCode + '-' + m.nadClass : u.formationId.slice(-6)} ` +
            `${(c.surfaceElevM - u.topDepthM).toFixed(2)}..${(c.surfaceElevM - u.baseDepthM).toFixed(2)}` +
            `[${u.layerId.slice(-6)}]`,
        )
      }
    }
    const nm = (layer: string | null): string =>
      layer === null ? '(residual)' : (label.get(layer) ?? layer.slice(-6))

    fillGapProbe.enabled = true
    fillGapProbe.entries.length = 0
    let out!: ReturnType<typeof computeHierarchicalGeotechFill>
    try {
      out = computeHierarchicalGeotechFill({
        lithoColumns: L.columns,
        lithoEdges: L.edges,
        lithoRegions,
        geotechColumns: frameAlignedColumns(
          L.columns,
          new Map(G.columns.map((c) => [c.investigationId, c])),
        ),
        geotechEdges: G.edges,
        alongM: L.alongM,
        packingClassOf: buildPackingClassOf(Object.entries(raw.refinementBundle.nadMeta)),
      })
    } finally {
      fillGapProbe.enabled = false
    }

    const lines: string[] = [`=== ${sectionName} gap ${gap} — per (family, gap) run ===`]
    lines.push('CONFLICTS (crossing ties, both dropped):')
    for (const c of out.conflicts) lines.push('  ' + JSON.stringify(c))
    for (const entry of fillGapProbe.entries) {
      if (entry.gapIndex !== gap) continue
      lines.push(`--- run (cover layers: ${entry.coverLayers.map((l) => l.slice(-6)).join(',')})`)
      lines.push('  CONSTRUCTS:')
      for (const c of entry.constructs) {
        lines.push(
          `    ci${c.ci} ${nm(c.layer)} emit=${c.emit} topTied=${c.topTied} baseTied=${c.baseTied}` +
            (c.extendsToFar === true ? ' EXTENDS_TO_FAR' : ''),
        )
      }
      lines.push('  TIES:')
      for (const t of entry.ties) {
        lines.push(
          `    ci${t.leftCi}@${t.leftY.toFixed(2)} -> ci${t.rightCi}@${t.rightY.toFixed(2)} [${t.key.slice(0, 40)}]`,
        )
      }
      lines.push('  LINES:')
      for (const line of entry.lines) {
        lines.push(
          '    ' + line.map(([f, e]) => `(${f.toFixed(3)},${e.toFixed(3)})`).join(' -> '),
        )
      }
      lines.push('  FACES:')
      for (const f of entry.faces) {
        lines.push(
          `    ${f.role.padEnd(9)} ${nm(f.owner)} sample=(${f.sample[0].toFixed(3)},${f.sample[1].toFixed(3)}) ` +
            `ring=${f.ring.map(([a, b]) => `(${a.toFixed(3)},${b.toFixed(3)})`).join('')}`,
        )
      }
    }
    fillGapProbe.entries.length = 0
    writeFileSync(OUT, lines.join(NL) + NL)
    expect(lines.length).toBeGreaterThan(1)
  })
})
