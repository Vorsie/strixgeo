/**
 * DUMP the CPT-only geotech partition "4 · Divide boreholes" reads a borehole
 * off, so the backend measurement can replay the divide against it.
 *
 * Not a gate — it computes nothing and asserts nothing about geology. It exists
 * because the partition is built in the renderer and consumed in Python: the
 * band-count comparison (geometry vs donor rule) cannot run without a real
 * payload, and a synthetic one would measure the wrong thing.
 *
 * Run with ``DIVIDE_DUMP=1``:
 *
 *     DIVIDE_DUMP=1 node node_modules/vitest/vitest.mjs run dividePartitionDump
 *
 * Reads ``scripts/throwaway_geotech_axis_inputs.json`` (refresh it with
 * ``scripts/dump_geotech_axis_inputs.py``) and writes one
 * ``SectionPartitionInput`` per section, keyed by section id.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn } from './sectionPartition'
import { toRegionInputs } from './buildVoxelRequest'

const DUMP_PATH = resolve(__dirname, '../../../../../scripts/throwaway_geotech_axis_inputs.json')
const OUT_PATH = resolve(__dirname, '../../../../../scripts/throwaway_divide_partitions.json')

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
  sectionId: string
  name: string
  startX: number
  startY: number
  endX: number
  endY: number
  geotech: RawArm
}

describe('divide partition dump', () => {
  it('writes the CPT-only geotech partition per section', () => {
    if (process.env.DIVIDE_DUMP !== '1') {
      expect(true).toBe(true)
      return
    }
    expect(existsSync(DUMP_PATH)).toBe(true)
    const raw = JSON.parse(readFileSync(DUMP_PATH, 'utf-8')) as {
      investigations: { id: string; kind: string }[]
      sections: RawSection[]
    }
    // The whole point of the payload: a borehole is a LINE through the gap, not
    // a column that splits it. A divided borehole carries bands, so leaving it
    // in would make the fill treat it as a column.
    const boreholeIds = new Set(
      raw.investigations.filter(i => i.kind !== 'cpt').map(i => i.id),
    )

    const out: Record<string, unknown> = {}
    for (const section of raw.sections) {
      const paired = section.geotech.columns
        .map((c, i) => ({ c, a: section.geotech.alongM[i] }))
        .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
        .filter(({ c }) => !boreholeIds.has(c.investigationId))
        .sort((p, q) => p.a - q.a)
      if (paired.length < 2) continue

      const columns: PartitionColumn[] = paired.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
      }))
      const alongM = paired.map(({ a }) => a)
      const edges: CorrelationEdge[] = section.geotech.edges.map(e => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))

      const regions = computeSectionFillActive(columns, edges, undefined, alongM)
      out[section.sectionId] = {
        start_x: section.startX,
        start_y: section.startY,
        end_x: section.endX,
        end_y: section.endY,
        columns: columns.map((c, i) => ({
          investigation_id: c.investigationId,
          along_m: alongM[i],
          world_x: alongM[i],
          world_y: 0,
        })),
        regions: toRegionInputs(regions),
      }
      // eslint-disable-next-line no-console
      console.info(
        `[divide-dump] ${section.name}: ${columns.length} CPT column(s), ` +
          `${regions.length} region(s), ${edges.length} edge(s)`,
      )
    }
    writeFileSync(OUT_PATH, JSON.stringify(out), 'utf-8')
    expect(Object.keys(out).length).toBeGreaterThan(0)
  })
})
