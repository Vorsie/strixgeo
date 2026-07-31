/**
 * THROWAWAY ADVERSARIAL DIAG — is the partition engine really the ONLY difference
 * between the two arms of ``enginePayloadAB.diag.test.ts``?
 *
 * Two independent suspicions are measured here, neither of which the emitter checks:
 *
 * 1. ORDER / SHARED STATE. The emitter always runs v1 first and v2 second, through one
 *    process, over one shared ``FenceSectionInput[]``. Both engines carry module-level
 *    mutable state. Running the arms in the OPPOSITE order must reproduce the emitter's
 *    two files byte for byte, or the arms are order-dependent.
 * 2. THE OVERRIDE DERIVATION. ``buildVoxelRequest`` passes the engine flag into
 *    ``buildApexOverridesForGaps``, whose contact-override path is v2-ONLY, and derives
 *    ``persistedLensBodies`` from a base pass run with the arm's own engine. So the two
 *    arms can hand the engine a DIFFERENT third argument. This measures the two override
 *    maps and then feeds the v2-derived map to the v1 engine to see whether the
 *    difference is inert or moves the partition.
 *
 * Run:
 *   ENGINE_AB_ADV=1 npx vitest run \
 *     src/renderer/src/utils/enginePayloadAB.adversarial.diag.test.ts --disableConsoleIntercept
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import {
  buildApexOverridesForGaps,
  detectPersistedLensBodies,
  type GapExtent,
} from '../components/sections/apexOverrideWiring'
import { buildVoxelRequest } from './buildVoxelRequest'
import type { FenceSectionInput } from './buildProjectFence'
import type { CorrelationEdge, LensApexOverride, SectionRegion } from './partitionFill'
import { computeSectionFillActive, isPartitionEngineV2Active } from './partitionEngineSelect'
import { assembleSectionsWithCanonical } from './sectionFenceData'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_engine_ab_inputs.json')
const EMITTED_V1 = resolve(REPO_ROOT, 'scripts/throwaway_engine_payload_v1.json')
const EMITTED_V2 = resolve(REPO_ROOT, 'scripts/throwaway_engine_payload_v2.json')

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
  horizontalSpacingM: number
  verticalSpacingM: number
  sections: DumpSection[]
  boundaries: BodyBoundaryResponse[]
}

/**
 * Reshape the dumped sections into ``FenceSectionInput``s — a verbatim copy of the
 * emitter's own ``toFenceSections`` so this harness feeds the identical input.
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
 * Run a callback with the partition engine pinned by environment, restoring after.
 *
 * @param useV2 - ``true`` pins the v2 engine, ``false`` pins v1.
 * @param fn - The callback to run under that pin.
 * @returns Whatever the callback returns.
 */
function withEngine<T>(useV2: boolean, fn: () => T): T {
  const prev = process.env.STRIX_PARTITION_V2
  process.env.STRIX_PARTITION_V2 = useV2 ? '1' : '0'
  try {
    expect(isPartitionEngineV2Active()).toBe(useV2)
    return fn()
  } finally {
    if (prev === undefined) delete process.env.STRIX_PARTITION_V2
    else process.env.STRIX_PARTITION_V2 = prev
  }
}

/** Stable digest of a region list — geometry plus classification, order-insensitive. */
function digest(regions: readonly SectionRegion[]): string {
  const rows = regions
    .map((r) =>
      [
        r.formationId,
        r.bodyId ?? '-',
        r.gapIndex,
        r.kind ?? '-',
        r.overlayTier ?? '-',
        r.polygon.map((p) => `${p.fraction.toFixed(9)},${p.elevation.toFixed(9)}`).join(';'),
      ].join('|'),
    )
    .sort()
  return `${regions.length}#${rows.join('\n').length}#${rows.join('\n').slice(0, 0)}${rows
    .join('\n')
    .split('')
    .reduce((h, ch) => ((h * 31 + ch.charCodeAt(0)) | 0) >>> 0, 7)}`
}

describe('adversarial: is the engine the only difference?', () => {
  if (process.env.ENGINE_AB_ADV !== '1') {
    it.skip('dormant (set ENGINE_AB_ADV=1)', () => {})
    return
  }

  const dump = JSON.parse(readFileSync(INPUT, 'utf8')) as Dump

  it('reproduces the emitted payloads with the arms run in the OPPOSITE order', () => {
    const sections = toFenceSections(dump)
    const boundaries = new Map<string, BodyBoundaryResponse>(
      dump.boundaries.map((b) => [b.body_id, b]),
    )
    // v2 FIRST this time — the emitter ran v1 first.
    const v2 = withEngine(true, () =>
      buildVoxelRequest(sections, dump.horizontalSpacingM, dump.verticalSpacingM, boundaries),
    )
    const v1 = withEngine(false, () =>
      buildVoxelRequest(sections, dump.horizontalSpacingM, dump.verticalSpacingM, boundaries),
    )

    const emittedV1 = readFileSync(EMITTED_V1, 'utf8')
    const emittedV2 = readFileSync(EMITTED_V2, 'utf8')
    const sameV1 = JSON.stringify(v1, null, 1) === emittedV1
    const sameV2 = JSON.stringify(v2, null, 1) === emittedV2
    console.log(
      `\n    ORDER TEST (v2 first, then v1)\n` +
        `      v1 arm byte-identical to the emitter's file: ${sameV1}\n` +
        `      v2 arm byte-identical to the emitter's file: ${sameV2}\n` +
        `      regions v1=${v1.sections.reduce((n, s) => n + s.regions.length, 0)} ` +
        `v2=${v2.sections.reduce((n, s) => n + s.regions.length, 0)}`,
    )
    expect(sameV1).toBe(true)
    expect(sameV2).toBe(true)
  })

  it('measures the override map each arm hands the engine, and whether it is inert', () => {
    const sections = toFenceSections(dump)
    const boundaries = new Map<string, BodyBoundaryResponse>(
      dump.boundaries.map((b) => [b.body_id, b]),
    )
    const { assembled } = assembleSectionsWithCanonical(sections)

    console.log(`\n    OVERRIDE DERIVATION PER ARM (production wiring, per section)`)
    console.log(
      `      ${'section'.padEnd(20)} ${'ovV1'.padStart(5)} ${'ovV2'.padStart(5)}  keys(v2 only)`,
    )

    let totalV1 = 0
    let totalV2 = 0
    for (let si = 0; si < assembled.length; si += 1) {
      const { input, columns, orderedColumns } = assembled[si]
      const alongM = orderedColumns.map((c) => c.alongM)
      const gapXs: GapExtent[] = orderedColumns
        .slice(0, -1)
        .map((c, i) => ({ leftX: c.alongM, rightX: orderedColumns[i + 1].alongM }))
      const alongIdentity = (along: number): number => along

      const armOverrides = (useV2: boolean): Map<string, LensApexOverride> =>
        withEngine(useV2, () => {
          const persistedLensBodies = detectPersistedLensBodies(
            computeSectionFillActive(columns, input.edges, undefined, alongM),
            columns,
            boundaries,
            alongIdentity,
            gapXs,
          )
          return buildApexOverridesForGaps({
            orderedColumns: columns,
            gapXs,
            boundariesByBodyId: boundaries,
            alongToScreenX: alongIdentity,
            screenToLevel: undefined,
            lensDrag: null,
            boundaryDrag: null,
            partitionEngineV2: useV2,
            persistedLensBodies,
          }).apexOverrides
        })

      const ov1 = armOverrides(false)
      const ov2 = armOverrides(true)
      totalV1 += ov1.size
      totalV2 += ov2.size
      const onlyV2 = [...ov2.keys()].filter((k) => !ov1.has(k))
      console.log(
        `      ${dump.sections[si].name.padEnd(20)} ${String(ov1.size).padStart(5)} ` +
          `${String(ov2.size).padStart(5)}  ${onlyV2.join(', ')}`,
      )

      // Only the section that actually has an override is worth isolating.
      if (ov2.size === 0 && ov1.size === 0) continue

      const v1NoOv = withEngine(false, () =>
        computeSectionFillActive(columns, input.edges, ov1.size ? ov1 : undefined, alongM),
      )
      const v1WithV2Ov = withEngine(false, () =>
        computeSectionFillActive(columns, input.edges, ov2, alongM),
      )
      const v2WithOv = withEngine(true, () =>
        computeSectionFillActive(columns, input.edges, ov2, alongM),
      )
      const v2NoOv = withEngine(true, () =>
        computeSectionFillActive(columns, input.edges, undefined, alongM),
      )
      console.log(
        `\n      ISOLATION on ${dump.sections[si].name}\n` +
          `        v1 with its OWN overrides (${ov1.size})      : ${v1NoOv.length} regions  ${digest(v1NoOv)}\n` +
          `        v1 with the V2 override map (${ov2.size})    : ${v1WithV2Ov.length} regions  ${digest(v1WithV2Ov)}\n` +
          `        -> the v2-derived override is ${digest(v1NoOv) === digest(v1WithV2Ov) ? 'INERT in v1' : 'ACTIVE in v1 (it moves the partition)'}\n` +
          `        v2 with overrides (the arm)          : ${v2WithOv.length} regions  ${digest(v2WithOv)}\n` +
          `        v2 with NO overrides                 : ${v2NoOv.length} regions  ${digest(v2NoOv)}\n` +
          `        -> the override changes v2 by ${v2WithOv.length - v2NoOv.length} region(s), ` +
          `${digest(v2WithOv) === digest(v2NoOv) ? 'geometry unchanged' : 'GEOMETRY CHANGED'}\n`,
      )
    }
    console.log(`      TOTAL override entries: v1 arm=${totalV1}, v2 arm=${totalV2}\n`)
  })
})
