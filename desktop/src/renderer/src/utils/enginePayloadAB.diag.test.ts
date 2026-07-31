/**
 * THROWAWAY DIAG — emit the voxel-build payload TWICE, once per partition engine.
 *
 * The engine choice is device-local: a fresh install gets v1, and the owner's
 * machine has v2 turned on in Settings. Everything the owner has validated —
 * every dogfeed screenshot, every built model — is therefore v2 output, while the
 * engine a new user's first build would run has been validated by nobody. Closing
 * that gap needs the two payloads side by side, produced from ONE set of real
 * inputs with the engine as the only difference.
 *
 * This emitter does not reimplement the payload builder. It calls the production
 * ``buildVoxelRequest`` with real ``FenceSectionInput``s and flips
 * ``STRIX_PARTITION_V2`` between the two calls, so both arms go through the same
 * assembly, the same canonical world positions, the same no-override base pass,
 * the same hand-drawn override derivation and the same region mapping. Anything
 * that differs between the two files is the engine and nothing else.
 *
 * Two details are load-bearing and are ASSERTED rather than assumed:
 *
 * 1. ``kind`` / ``overlay_tier`` / ``tied_band_base`` / ``tie_clipped`` must
 *    survive into the payload (debt #256). The backend reads all four with
 *    ``.get()`` defaults, so dropping them builds a different model in silence.
 * 2. The emitted world positions must equal the stored generation's, column for
 *    column. They are recomputed here (``projectionFoot`` over the section line),
 *    which is only safe because the section endpoints and the along-positions come
 *    from that same stored generation — so the recomputation has to land back on
 *    the stored values. If it ever does not, the payload describes columns nobody
 *    has built and the run fails loudly instead of writing the file.
 *
 * Input comes from ``scripts/throwaway_engine_ab_inputs.json``; regenerate it with
 * ``uv run python scripts/diag_engine_ab_dump.py`` (read-only against the dev DB).
 *
 * Run:
 *   ENGINE_AB=1 npx vitest run src/renderer/src/utils/enginePayloadAB.diag.test.ts \
 *     --disableConsoleIntercept
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import {
  buildVoxelRequest,
  type RegionInput,
  type VoxelBuildRequest,
} from './buildVoxelRequest'
import type { FenceSectionInput } from './buildProjectFence'
import type { CorrelationEdge } from './partitionFill'
import { isPartitionEngineV2Active } from './partitionEngineSelect'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_engine_ab_inputs.json')
const OUT_V1 = resolve(REPO_ROOT, 'scripts/throwaway_engine_payload_v1.json')
const OUT_V2 = resolve(REPO_ROOT, 'scripts/throwaway_engine_payload_v2.json')

/**
 * Tolerance (metres) for the recomputed-vs-stored world position check. The
 * recomputation runs the same projection arithmetic on the same section line, so
 * agreement should be exact; a millimetre of slack only absorbs the JSON
 * round-trip of the stored value.
 */
const WORLD_TOL_M = 1e-3

interface DumpUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}

interface DumpColumn {
  investigationId: string
  alongM: number
  worldX: number
  worldY: number
  surfaceElevM: number | null
  units: DumpUnit[]
}

interface DumpSection {
  sectionId: string
  name: string
  start_x: number
  start_y: number
  end_x: number
  end_y: number
  columns: DumpColumn[]
  edges: { a: string; b: string; aSide: string | null; bSide: string | null; source: string }[]
  anchorRegionCount: number
}

interface Dump {
  generationId: string
  modelId: string
  builderVersion: string
  horizontalSpacingM: number
  verticalSpacingM: number
  anchor: { sections: number; regions: number; bodies: number; triangles: number }
  formationNames: Record<string, string>
  sections: DumpSection[]
  boundaries: BodyBoundaryResponse[]
}

/**
 * Reshape the dumped sections into the production ``FenceSectionInput`` contract.
 *
 * Every layer is marked accepted because the dump only ever selected accepted
 * rows; the flag exists so ``assembleSectionPartitionInput`` can filter a mixed
 * list, and passing an already-filtered list through it changes nothing.
 *
 * Correlation sides are carried verbatim. Defaulting a missing side to ``top`` is
 * not equivalent — the engine keys top ties, base ties and mixed ties into three
 * different lookups whose band geometry differs — so a null side is left absent
 * and only a real value is passed on.
 *
 * @param dump - The parsed input snapshot.
 * @returns One ``FenceSectionInput`` per dumped section, in dump order.
 */
function toFenceSections(dump: Dump): FenceSectionInput[] {
  return dump.sections.map((sec) => {
    const edges: CorrelationEdge[] = sec.edges.map((e) => ({
      a: e.a,
      b: e.b,
      ...(e.aSide ? { aSide: e.aSide as 'top' | 'base' } : {}),
      ...(e.bSide ? { bSide: e.bSide as 'top' | 'base' } : {}),
    }))
    return {
      section: {
        start_x: sec.start_x,
        start_y: sec.start_y,
        end_x: sec.end_x,
        end_y: sec.end_y,
      },
      projectedColumns: sec.columns.map((c) => ({
        investigationId: c.investigationId,
        alongM: c.alongM,
        surfaceElevM: c.surfaceElevM,
      })),
      layers: sec.columns.flatMap((c) =>
        c.units.map((u) => ({
          investigationId: c.investigationId,
          layerId: u.layerId,
          formationId: u.formationId,
          bodyId: u.bodyId,
          topDepthM: u.topDepthM,
          baseDepthM: u.baseDepthM,
          accepted: true,
        })),
      ),
      edges,
    }
  })
}

/**
 * Build one arm's payload with the partition engine pinned by environment.
 *
 * The env override is the only lever touched: it outranks the device-local
 * localStorage pref that jsdom would otherwise expose, so the arm cannot inherit
 * whatever a previous test left behind. The previous value is restored afterwards.
 *
 * @param useV2 - ``true`` to pin the v2 closed-loop engine, ``false`` for v1.
 * @param sections - The shared, already-assembled section inputs.
 * @param dump - The input snapshot (read for the two grid spacings).
 * @param boundaries - Every body's boundary response, as the app fetches them.
 * @returns The payload the frontend would POST with that engine active.
 */
function emitArm(
  useV2: boolean,
  sections: readonly FenceSectionInput[],
  dump: Dump,
  boundaries: ReadonlyMap<string, BodyBoundaryResponse>,
): VoxelBuildRequest {
  const prev = process.env.STRIX_PARTITION_V2
  process.env.STRIX_PARTITION_V2 = useV2 ? '1' : '0'
  try {
    // Guard against a silent mis-pin: everything downstream is meaningless if the
    // selector did not resolve to the engine this arm claims to be testing.
    expect(isPartitionEngineV2Active()).toBe(useV2)
    return buildVoxelRequest(
      sections,
      dump.horizontalSpacingM,
      dump.verticalSpacingM,
      boundaries,
    )
  } finally {
    if (prev === undefined) delete process.env.STRIX_PARTITION_V2
    else process.env.STRIX_PARTITION_V2 = prev
  }
}

/** Count how many regions carry each of the four classification fields. */
function classificationCoverage(regions: readonly RegionInput[]): {
  kind: Record<string, number>
  overlayTier: number
  tiedBandBase: number
  tieClipped: number
} {
  const kind: Record<string, number> = {}
  let overlayTier = 0
  let tiedBandBase = 0
  let tieClipped = 0
  for (const r of regions) {
    kind[r.kind ?? '(absent)'] = (kind[r.kind ?? '(absent)'] ?? 0) + 1
    if (r.overlay_tier !== undefined) overlayTier += 1
    if (r.tied_band_base !== undefined) tiedBandBase += 1
    if (r.tie_clipped !== undefined) tieClipped += 1
  }
  return { kind, overlayTier, tiedBandBase, tieClipped }
}

/** Flatten a payload's regions across all sections, in payload order. */
function allRegions(payload: VoxelBuildRequest): RegionInput[] {
  return payload.sections.flatMap((s) => s.regions)
}

describe('engine A/B voxel payload emitter', () => {
  if (process.env.ENGINE_AB !== '1') {
    it.skip('dormant (set ENGINE_AB=1)', () => {})
    return
  }

  it('emits one payload per partition engine from the same real inputs', () => {
    expect(existsSync(INPUT)).toBe(true)
    const dump = JSON.parse(readFileSync(INPUT, 'utf8')) as Dump
    const fname = (id: string): string => dump.formationNames[id] ?? id.slice(0, 8)

    const sections = toFenceSections(dump)
    const boundaries = new Map<string, BodyBoundaryResponse>(
      dump.boundaries.map((b) => [b.body_id, b]),
    )
    const drawn = dump.boundaries.filter(
      (b) => b.upper_nodes.length > 0 || b.lower_nodes.length > 0,
    )

    console.log(
      `\n=== ENGINE A/B — model ${dump.modelId}\n` +
        `    anchor generation ${dump.generationId} (${dump.builderVersion}): ` +
        `${dump.anchor.sections} sections, ${dump.anchor.regions} regions, ` +
        `${dump.anchor.bodies} bodies, ${dump.anchor.triangles.toLocaleString()} triangles\n` +
        `    grid ${dump.horizontalSpacingM} m / ${dump.verticalSpacingM} m; ` +
        `${boundaries.size} body boundary response(s), ${drawn.length} hand-drawn\n`,
    )

    const v1 = emitArm(false, sections, dump, boundaries)
    const v2 = emitArm(true, sections, dump, boundaries)

    // ---- the two arms must differ in the regions and NOWHERE else ----
    expect(v2.sections.length).toBe(v1.sections.length)
    expect(v2.grid_spacing_m).toBe(v1.grid_spacing_m)
    expect(v2.horizontal_spacing_m).toBe(v1.horizontal_spacing_m)
    expect(v2.vertical_spacing_m).toBe(v1.vertical_spacing_m)
    for (let i = 0; i < v1.sections.length; i += 1) {
      const a = v1.sections[i]
      const b = v2.sections[i]
      expect([b.start_x, b.start_y, b.end_x, b.end_y]).toEqual([
        a.start_x,
        a.start_y,
        a.end_x,
        a.end_y,
      ])
      expect(b.columns).toEqual(a.columns)
    }

    // ---- world positions must land back on the stored generation's ----
    let worstWorldDelta = 0
    for (let i = 0; i < v1.sections.length; i += 1) {
      const emitted = v1.sections[i].columns
      const stored = dump.sections[i].columns
      expect(emitted.length).toBe(stored.length)
      for (let j = 0; j < emitted.length; j += 1) {
        expect(emitted[j].investigation_id).toBe(stored[j].investigationId)
        worstWorldDelta = Math.max(
          worstWorldDelta,
          Math.abs(emitted[j].world_x - stored[j].worldX),
          Math.abs(emitted[j].world_y - stored[j].worldY),
          Math.abs(emitted[j].along_m - stored[j].alongM),
        )
      }
    }
    console.log(
      `    world/along positions vs the stored generation: worst delta ` +
        `${worstWorldDelta.toExponential(2)} m over ` +
        `${v1.sections.reduce((n, s) => n + s.columns.length, 0)} columns`,
    )
    expect(worstWorldDelta).toBeLessThan(WORLD_TOL_M)

    // ---- per-section region counts ----
    console.log(
      `\n    ${'section'.padEnd(20)} ${'cols'.padStart(4)} ${'v1'.padStart(6)} ` +
        `${'v2'.padStart(6)} ${'Δ'.padStart(6)} ${'anchor'.padStart(7)}`,
    )
    let anchorMismatchSections = 0
    for (let i = 0; i < v1.sections.length; i += 1) {
      const n1 = v1.sections[i].regions.length
      const n2 = v2.sections[i].regions.length
      const anchor = dump.sections[i].anchorRegionCount
      if (n2 !== anchor) anchorMismatchSections += 1
      const flag = n2 === anchor ? ' ' : '!'
      console.log(
        `    ${dump.sections[i].name.padEnd(20)} ` +
          `${String(v1.sections[i].columns.length).padStart(4)} ` +
          `${String(n1).padStart(6)} ${String(n2).padStart(6)} ` +
          `${String(n2 - n1).padStart(6)} ${String(anchor).padStart(7)} ${flag}`,
      )
    }

    const r1 = allRegions(v1)
    const r2 = allRegions(v2)
    const c1 = classificationCoverage(r1)
    const c2 = classificationCoverage(r2)
    console.log(
      `\n    TOTALS  v1 regions=${r1.length}   v2 regions=${r2.length}   ` +
        `Δ=${r2.length - r1.length}   anchor=${dump.anchor.regions}`,
    )
    console.log(
      `    v1 kinds ${JSON.stringify(c1.kind)}  overlay_tier=${c1.overlayTier} ` +
        `tied_band_base=${c1.tiedBandBase} tie_clipped=${c1.tieClipped}`,
    )
    console.log(
      `    v2 kinds ${JSON.stringify(c2.kind)}  overlay_tier=${c2.overlayTier} ` +
        `tied_band_base=${c2.tiedBandBase} tie_clipped=${c2.tieClipped}`,
    )

    // Which lithologies each engine paints, so a count difference can be read as
    // "v2 emits N more sand regions" rather than an anonymous delta.
    const byFormation = (regions: readonly RegionInput[]): Map<string, number> => {
      const m = new Map<string, number>()
      for (const r of regions) m.set(r.formation_id, (m.get(r.formation_id) ?? 0) + 1)
      return m
    }
    const f1 = byFormation(r1)
    const f2 = byFormation(r2)
    const formationIds = [...new Set([...f1.keys(), ...f2.keys()])].sort(
      (a, b) => (f2.get(b) ?? 0) - (f2.get(a) ?? 0),
    )
    console.log(`\n    ${'formation'.padEnd(28)} ${'v1'.padStart(6)} ${'v2'.padStart(6)}`)
    for (const id of formationIds) {
      console.log(
        `    ${fname(id).padEnd(28)} ${String(f1.get(id) ?? 0).padStart(6)} ` +
          `${String(f2.get(id) ?? 0).padStart(6)}`,
      )
    }

    if (r2.length !== dump.anchor.regions) {
      console.log(
        `\n    !! V2 REGION TOTAL DOES NOT MATCH THE ANCHOR: emitted ${r2.length}, ` +
          `stored generation ${dump.generationId} carries ${dump.anchor.regions} ` +
          `(${anchorMismatchSections} of ${v2.sections.length} sections differ).\n` +
          `       The v2 arm is therefore NOT a reproduction of the owner's last build, and ` +
          `any\n       number derived from it describes a different partition. Treat the ` +
          `v1-vs-v2 delta\n       below as valid (both arms share these inputs) but do NOT ` +
          `read the v2 arm as "what\n       the owner has been looking at" until this is ` +
          `explained.\n`,
      )
    } else {
      console.log(
        `\n    v2 region total matches the stored generation exactly (${r2.length}), ` +
          `across all ${v2.sections.length} sections.\n`,
      )
    }

    writeFileSync(OUT_V1, JSON.stringify(v1, null, 1), 'utf8')
    writeFileSync(OUT_V2, JSON.stringify(v2, null, 1), 'utf8')
    console.log(`    wrote ${OUT_V1}`)
    console.log(`    wrote ${OUT_V2}\n`)

    // The payload must be consumable by _sections_from_payload: every section
    // carries the four line coordinates plus columns and regions, every column the
    // four required keys, and every region the four REQUIRED keys read by direct
    // subscript there (formation_id / body_id / polygon / gap_index) plus `kind`,
    // which the engines always set and which changes the built model.
    for (const sec of v2.sections) {
      expect(typeof sec.start_x).toBe('number')
      expect(typeof sec.end_y).toBe('number')
      for (const col of sec.columns) {
        expect(typeof col.investigation_id).toBe('string')
        expect(Number.isFinite(col.along_m)).toBe(true)
        expect(Number.isFinite(col.world_x)).toBe(true)
        expect(Number.isFinite(col.world_y)).toBe(true)
      }
      for (const r of sec.regions) {
        expect(typeof r.formation_id).toBe('string')
        expect('body_id' in r).toBe(true)
        expect(Number.isInteger(r.gap_index)).toBe(true)
        expect(r.polygon.length).toBeGreaterThanOrEqual(3)
        for (const p of r.polygon) expect(p.length).toBe(2)
        expect(r.kind).toBeDefined()
      }
    }
  })
})
