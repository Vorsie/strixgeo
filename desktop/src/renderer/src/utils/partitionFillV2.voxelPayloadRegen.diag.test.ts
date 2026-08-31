/**
 * partitionFillV2.voxelPayloadRegen.diag.test.ts — regenerate the voxel-build partition payload
 * from the CURRENT v2 engine (owner 2026-07-26, "we'll do the v2 voxel"). Keeps the captured
 * fixture's section GEOMETRY (world coords / along_m / start-end) and swaps in current-v2 regions,
 * computed in the fixture's OWN column order so `gap_index` aligns with the fixture columns 1:1.
 *
 * This closes the gap that the committed `tests/fixtures/voxel/teststrix_partitions.json` is a
 * STALE capture (predates the current v2 engine) — running `eval_voxel_build.py` against it would
 * verify the labeller/mesher, NOT current-v2 output. This harness rewrites the payload from live
 * v2 so the headless build gate exercises the real engine.
 *
 * DEV DIAGNOSTIC, gated on `VOXEL_REGEN=1` (opt-in; not part of the normal suite). Both inputs are
 * gitignored dev-DB extracts — skips when absent. Output → `scripts/throwaway_v2_partitions.json`.
 *
 * Usage (desktop/):
 *   VOXEL_REGEN=1 npx vitest run src/renderer/src/utils/partitionFillV2.voxelPayloadRegen.diag.test.ts
 * then (repo root):
 *   uv run python scripts/eval_voxel_build.py --fixture scripts/throwaway_v2_partitions.json
 * which builds the real `BuildVoxelLithoModel` use case (rolls back), asserting the model builds,
 * is watertight, and has 0 inter-body overlaps.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it, expect } from 'vitest'
import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '../../../../..')
const DIAG = resolve(REPO, 'scripts/diag_allsections_input.json')
const FIXTURE = resolve(REPO, 'tests/fixtures/voxel/teststrix_partitions.json')
const OUT = resolve(REPO, 'scripts/throwaway_v2_partitions.json')

const enabled = process.env.VOXEL_REGEN === '1' && existsSync(DIAG) && existsSync(FIXTURE)

describe('v2 voxel partition regen', () => {
  const maybe = enabled ? it : it.skip
  maybe('writes current-v2 regions into the captured fixture geometry', () => {
    const diag = JSON.parse(readFileSync(DIAG, 'utf8')) as any
    const fx = JSON.parse(readFileSync(FIXTURE, 'utf8')) as any

    // investigationId -> its diag unit stack (+ surfaceElevM).
    const colByInv = new Map<string, any>()
    for (const s of diag.sections) for (const c of s.columns) if (c.surfaceElevM != null) colByInv.set(c.investigationId, c)
    // Match a fixture section to its diag section by the SET of column investigation ids, to lift
    // that section's correlation edges (the fixture carries no edges, only computed regions).
    const keyOf = (ids: string[]): string => [...ids].sort().join('|')
    const diagByIdSet = new Map<string, any>()
    for (const s of diag.sections) {
      const ids = s.columns.filter((c: any) => c.surfaceElevM != null && c.units.length > 0).map((c: any) => c.investigationId)
      diagByIdSet.set(keyOf(ids), s)
    }

    let matched = 0
    const outSections = fx.sections.map((fs: any) => {
      const fxIds: string[] = fs.columns.map((c: any) => c.investigation_id)
      // PartitionColumn[] in the FIXTURE's column order so gap_index aligns 1:1.
      const columns: PartitionColumn[] = fxIds.map((inv) => {
        const dc = colByInv.get(inv)
        if (!dc) throw new Error(`no diag column for ${inv}`)
        return { investigationId: inv, surfaceElevM: dc.surfaceElevM, units: dc.units }
      })
      const alongM = fs.columns.map((c: any) => Number(c.along_m))
      const ds = diagByIdSet.get(keyOf(fxIds))
      if (!ds) throw new Error(`no diag section matches fixture cols ${keyOf(fxIds).slice(0, 40)}`)
      matched++
      const edges: CorrelationEdge[] = ds.edges.map((e: any) => ({ a: e.a, b: e.b, aSide: e.aSide ?? 'top', bSide: e.bSide ?? 'top' }))
      const prev = setTwoSidedTerminations(true)
      let regions: SectionRegion[]
      try {
        regions = computeSectionFillV2(columns, edges, undefined, alongM)
      } finally {
        setTwoSidedTerminations(prev)
      }
      const outRegions = regions.map((r) => ({
        formation_id: r.formationId,
        body_id: r.bodyId,
        polygon: r.polygon.map((p) => [p.fraction, p.elevation]),
        gap_index: r.gapIndex,
      }))
      return { start_x: fs.start_x, start_y: fs.start_y, end_x: fs.end_x, end_y: fs.end_y, columns: fs.columns, regions: outRegions }
    })

    const nullBodies = outSections.flatMap((s: any) => s.regions).filter((r: any) => r.body_id == null).length
    writeFileSync(OUT, JSON.stringify({ sections: outSections, grid_spacing_m: fx.grid_spacing_m }))
    const totalRegions = outSections.reduce((n: number, s: any) => n + s.regions.length, 0)
    // eslint-disable-next-line no-console
    console.log(`WROTE ${OUT}: ${outSections.length} sections, ${totalRegions} regions, matched=${matched}, null-body regions=${nullBodies}`)
    expect(matched).toBe(fx.sections.length)
    // Every region must carry a body_id — the RegionInput contract the Python builder parses.
    expect(nullBodies).toBe(0)
  })
})
