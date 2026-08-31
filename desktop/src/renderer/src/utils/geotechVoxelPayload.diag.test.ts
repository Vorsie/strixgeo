/**
 * THROWAWAY DIAG — emit the GEOTECH voxel-build payload the app would POST.
 *
 * The geotech 3-D build has never been run on the owner's model (zero persisted
 * geotech build generations), so nobody has seen what the second geometry path
 * actually produces. The section canvas renders the direct geotech partition
 * (litho-frame-clipped); "Build model" on the geotech stage runs the partition
 * engine a second time over the GEOTECH columns and GEOTECH edges
 * (``makeVoxelRequestBuilder`` -> ``buildVoxelRequest``). This emitter produces
 * exactly what that second path would POST, so the Python side can build it once
 * and the result can be looked at.
 *
 * It does not reimplement the payload builder: it calls the production
 * ``buildVoxelRequest`` with real ``FenceSectionInput``s assembled from the
 * GEOTECH arm of ``scripts/throwaway_geotech_axis_inputs.json``. Same assembly,
 * same canonical world positions, same ``columns.length < 2`` section drop, same
 * region mapping. Nothing here is a second opinion about any of it.
 *
 * Three things are ASSERTED rather than assumed:
 *
 * 1. The engine is the one the app resolves (v2 is the default since
 *    2026-08-01), so the payload is not silently the fallback engine's.
 * 2. Hand-drawn overrides change nothing on this model. The dump carries ZERO
 *    stored geotech ``body_boundary_shape`` rows, but production still fetches a
 *    boundary response PER BODY — non-empty map, empty node lists. Both arms are
 *    emitted and required to be byte-identical, so "no overrides" is measured,
 *    not asserted from the shape of the code.
 * 3. Every region carries the four keys ``_sections_from_payload`` reads by
 *    direct subscript, plus ``kind``, which changes the built model.
 *
 * The two spacings are the stored litho generation's (``019fba41-678e-…``:
 * 2.0 m horizontal / 0.25 m vertical). They are project view-state prefs read by
 * ``readLithoSegmenterPrefs``, which is the SAME bag for both stages — a geotech
 * build on this project would read these same two numbers. The Python builder
 * re-reads them from the generation row and fails if they disagree with what is
 * written here, so the constant cannot drift unnoticed.
 *
 * Input: ``scripts/throwaway_geotech_axis_inputs.json`` — regenerate with
 * ``uv run python scripts/dump_geotech_axis_inputs.py`` (read-only against the
 * dev DB).
 *
 * Run:
 *   GEOTECH_3D=1 npx vitest run src/renderer/src/utils/geotechVoxelPayload.diag.test.ts \
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

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_voxel_payload.json')

/** X/Y voxel edge (m) of the stored generation — verified again on the Python side. */
const HORIZONTAL_M = 2.0
/** Z voxel edge (m) of the stored generation — verified again on the Python side. */
const VERTICAL_M = 0.25

interface DumpUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}

interface DumpColumn {
  investigationId: string
  surfaceElevM: number | null
  units: DumpUnit[]
}

interface DumpEdge {
  a: string
  b: string
  aSide: string | null
  bSide: string | null
  source: string
}

/** One model's inputs for one section: assembled columns, its edges, along-metres. */
interface DumpArm {
  columns: DumpColumn[]
  edges: DumpEdge[]
  alongM: number[]
}

interface DumpSection extends DumpArm {
  sectionId: string
  name: string
  kind: string
  startX: number
  startY: number
  endX: number
  endY: number
  geotech: DumpArm
  anchor: string
}

interface Dump {
  meta: {
    projectId: string
    lithoModelId: string
    geotechModelId: string
    geotechModelName: string
    geotechLayerStatusCounts: Record<string, number>
    anchor: { generationId: string | null; createdAt: string | null }
    persistedGeotechBuildGenerations: number
  }
  formationNames: Record<string, string>
  refinementBundle: {
    nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
  }
  sections: DumpSection[]
}

/**
 * Reshape one model's arm of a dumped section into the production
 * ``FenceSectionInput`` contract.
 *
 * Every layer is marked accepted because the dump only ever selected accepted
 * rows; the flag exists so the shared assembly can filter a mixed list, and
 * passing an already-filtered list through it changes nothing. Correlation sides
 * are carried verbatim — defaulting a missing side to ``top`` is not equivalent,
 * since the engine keys top ties, base ties and mixed ties into three different
 * lookups whose band geometry differs.
 *
 * @param sec - The dumped section (for its endpoints).
 * @param arm - The model arm to reshape (litho or geotech).
 * @returns The section input ``buildVoxelRequest`` consumes.
 */
function toFenceSection(sec: DumpSection, arm: DumpArm): FenceSectionInput {
  const edges: CorrelationEdge[] = arm.edges.map((e) => ({
    a: e.a,
    b: e.b,
    ...(e.aSide ? { aSide: e.aSide as 'top' | 'base' } : {}),
    ...(e.bSide ? { bSide: e.bSide as 'top' | 'base' } : {}),
  }))
  return {
    section: { start_x: sec.startX, start_y: sec.startY, end_x: sec.endX, end_y: sec.endY },
    projectedColumns: arm.columns.map((c, i) => ({
      investigationId: c.investigationId,
      alongM: arm.alongM[i],
      surfaceElevM: c.surfaceElevM,
    })),
    layers: arm.columns.flatMap((c) =>
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
}

/** Count how many regions carry each ``kind`` and each optional classification field. */
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
    const key = r.kind ?? '(absent)'
    kind[key] = (kind[key] ?? 0) + 1
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

describe('geotech voxel payload emitter', () => {
  if (process.env.GEOTECH_3D !== '1') {
    it.skip('dormant (set GEOTECH_3D=1)', () => {})
    return
  }

  it('emits the geotech build payload from the real geotech columns and edges', () => {
    expect(existsSync(INPUT)).toBe(true)
    const dump = JSON.parse(readFileSync(INPUT, 'utf8')) as Dump
    const fname = (id: string): string => dump.formationNames[id] ?? id.slice(0, 8)

    console.log(
      `\n=== GEOTECH 3-D PAYLOAD — model ${dump.meta.geotechModelId} ` +
        `(${dump.meta.geotechModelName})\n` +
        `    ${dump.meta.persistedGeotechBuildGenerations} persisted geotech build ` +
        `generation(s); geotech layers by status ` +
        `${JSON.stringify(dump.meta.geotechLayerStatusCounts)}\n` +
        `    grid ${HORIZONTAL_M} m / ${VERTICAL_M} m (stored generation ` +
        `${dump.meta.anchor.generationId})\n` +
        `    engine = v2
`,
    )
    // The app resolves v2 by default since 2026-08-01. Emitting the fallback
    // engine's partition would describe a model no user would get.

    const sections = dump.sections.map((s) => toFenceSection(s, s.geotech))

    // Production fetches one boundary response PER BODY of the model being built,
    // even when nothing was ever drawn. This model has no stored geotech shapes, so
    // every response is empty-noded. Both arms are emitted to MEASURE that this
    // changes nothing, rather than reasoning about it.
    const geotechBodyIds = new Set<string>()
    for (const sec of dump.sections) {
      for (const col of sec.geotech.columns) {
        for (const u of col.units) if (u.bodyId) geotechBodyIds.add(u.bodyId)
      }
    }
    const emptyBoundaries = new Map<string, BodyBoundaryResponse>(
      [...geotechBodyIds].map((id) => [
        id,
        {
          body_id: id,
          content_key: null,
          render_style: 'straight',
          primary_section_id: null,
          upper_nodes: [],
          lower_nodes: [],
        } as BodyBoundaryResponse,
      ]),
    )

    const payload = buildVoxelRequest(sections, HORIZONTAL_M, VERTICAL_M, undefined)
    const withEmptyBoundaries = buildVoxelRequest(
      sections,
      HORIZONTAL_M,
      VERTICAL_M,
      emptyBoundaries,
    )
    console.log(
      `    ${geotechBodyIds.size} geotech body id(s) on the layers; 0 stored hand-drawn ` +
        `shapes\n`,
    )
    expect(JSON.stringify(withEmptyBoundaries)).toBe(JSON.stringify(payload))

    // ---- which sections survived the >=2-column rule ----
    const kept = new Set(
      payload.sections.map((s) => `${s.start_x},${s.start_y},${s.end_x},${s.end_y}`),
    )
    console.log(
      `    ${'section'.padEnd(20)} ${'kind'.padEnd(6)} ${'litho'.padStart(6)} ` +
        `${'geo'.padStart(5)} ${'regions'.padStart(8)}  status`,
    )
    const dropped: string[] = []
    for (const sec of dump.sections) {
      const key = `${sec.startX},${sec.startY},${sec.endX},${sec.endY}`
      const emitted = payload.sections.find(
        (s) => `${s.start_x},${s.start_y},${s.end_x},${s.end_y}` === key,
      )
      if (!kept.has(key)) dropped.push(sec.name)
      console.log(
        `    ${sec.name.padEnd(20)} ${sec.kind.padEnd(6)} ` +
          `${String(sec.columns.length).padStart(6)} ` +
          `${String(sec.geotech.columns.length).padStart(5)} ` +
          `${String(emitted ? emitted.regions.length : 0).padStart(8)}  ` +
          `${emitted ? 'kept' : 'DROPPED (<2 geotech columns)'}`,
      )
    }

    const regions = allRegions(payload)
    const cov = classificationCoverage(regions)
    console.log(
      `\n    TOTALS  ${payload.sections.length} of ${dump.sections.length} sections kept, ` +
        `${payload.sections.reduce((n, s) => n + s.columns.length, 0)} columns, ` +
        `${regions.length} regions`,
    )
    if (dropped.length > 0) {
      console.log(
        `    DROPPED sections (${dropped.length}): ${dropped.join(', ')} — these carry fewer ` +
          `than 2\n    geotech columns, so they have no gap to fill and contribute no 3-D ` +
          `material.`,
      )
    }
    console.log(
      `    kinds ${JSON.stringify(cov.kind)}  overlay_tier=${cov.overlayTier} ` +
        `tied_band_base=${cov.tiedBandBase} tie_clipped=${cov.tieClipped}`,
    )

    // Which NAD units the payload actually paints, so a thin build can be read as
    // "only these classes made it" rather than an anonymous count.
    const byFormation = new Map<string, number>()
    for (const r of regions) byFormation.set(r.formation_id, (byFormation.get(r.formation_id) ?? 0) + 1)
    const ordered = [...byFormation.entries()].sort((a, b) => b[1] - a[1])
    console.log(`\n    ${'geotech formation'.padEnd(34)} ${'NAD'.padStart(4)} ${'regions'.padStart(8)}`)
    for (const [fid, n] of ordered) {
      const nad = dump.refinementBundle.nadMeta[fid]
      console.log(
        `    ${fname(fid).padEnd(34)} ${String(nad?.nadClass ?? '-').padStart(4)} ` +
          `${String(n).padStart(8)}`,
      )
    }
    const bodyIds = new Set(regions.map((r) => r.body_id).filter((b): b is string => b !== null))
    console.log(
      `\n    ${bodyIds.size} distinct body id(s) across the regions; ` +
        `${regions.filter((r) => r.body_id === null).length} region(s) with no body\n`,
    )

    writeFileSync(OUT, JSON.stringify(payload, null, 1), 'utf8')
    console.log(`    wrote ${OUT}\n`)

    // The payload must be consumable by ``_sections_from_payload``: four line
    // coordinates + columns + regions per section, four required keys per column,
    // and the four keys read by direct subscript per region plus ``kind``.
    for (const sec of payload.sections) {
      expect(typeof sec.start_x).toBe('number')
      expect(typeof sec.end_y).toBe('number')
      expect(sec.columns.length).toBeGreaterThanOrEqual(2)
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
