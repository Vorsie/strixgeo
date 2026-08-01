/**
 * REFUTATION PROBE for the geotech-axis agreement gate's RENDER arm.
 *
 * The gate (``geotechEngineAgreement.diag.test.ts``) derives the render arm's
 * apex overrides from the LITHO model's stored body boundaries. Production's
 * geotech axis cannot do that: ``SectionsCanvas`` clears ``lensBoundaries`` to an
 * empty Map whenever the axis is not lithostratigraphic, and ``SectionPanel``
 * forwards that empty map to ``PartitionFillOverlay``. So the real geotech render
 * derives ZERO overrides.
 *
 * This probe recomputes the render arm both ways and reports whether the
 * difference reaches the geometry. Pure reporter, dormant unless
 * ``GEOTECH_REFUTE=1``.
 *
 * Run:
 *   cd desktop
 *   GEOTECH_REFUTE=1 npx vitest run \
 *     src/renderer/src/utils/geotechRenderArmRefute.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  buildApexOverridesForGaps,
  detectPersistedLensBodies,
  type GapExtent,
} from '../components/sections/apexOverrideWiring'
import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import type {
  CorrelationEdge,
  LensApexOverride,
  PartitionColumn,
  SectionRegion,
} from './partitionFill'
import { computeSectionFillActive, isPartitionEngineV2Active } from './partitionEngineSelect'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')

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
interface RawSection {
  sectionId: string
  name: string
  columns: RawColumn[]
  edges: RawEdge[]
  alongM: number[]
}
interface RawFile {
  bodyBoundaries: { litho: Record<string, BodyBoundaryResponse> }
  sections: RawSection[]
}

/** Mirror of the gate's column assembly, so only the override input differs. */
function assembleColumns(
  cols: readonly RawColumn[],
  alongM: readonly number[],
): { columns: PartitionColumn[]; alongM: number[] } {
  const paired = cols
    .map((c, i) => ({ c, a: alongM[i] }))
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

function toEdges(raw: readonly RawEdge[]): CorrelationEdge[] {
  return raw.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
}

/** The gate's screen-free override derivation, verbatim. */
function deriveOverrides(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  alongM: readonly number[],
  boundaries: ReadonlyMap<string, BodyBoundaryResponse>,
  engineV2: boolean,
): Map<string, LensApexOverride> {
  const gapXs: GapExtent[] = columns
    .slice(0, -1)
    .map((_, i) => ({ leftX: alongM[i], rightX: alongM[i + 1] }))
  const identity = (along: number): number => along
  const persistedLensBodies =
    boundaries.size > 0
      ? detectPersistedLensBodies(
          computeSectionFillActive(columns, edges, undefined, alongM),
          columns,
          boundaries,
          identity,
          gapXs,
        )
      : undefined
  const { apexOverrides } = buildApexOverridesForGaps({
    orderedColumns: columns,
    gapXs,
    boundariesByBodyId: boundaries,
    alongToScreenX: identity,
    screenToLevel: undefined,
    lensDrag: null,
    boundaryDrag: null,
    partitionEngineV2: engineV2,
    persistedLensBodies,
  })
  return apexOverrides
}

/** Shoelace area of a fraction-by-elevation ring, scaled to the gap's metres. */
function ringArea(r: SectionRegion, widthM: number): number {
  const p = r.polygon
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return (Math.abs(s) / 2) * widthM
}

/** Stable signature of one region's geometry + identity. */
function sig(r: SectionRegion): string {
  return (
    `${r.gapIndex}|${r.formationId}|${r.bodyId}|${r.kind}|` +
    r.polygon.map((p) => `${p.fraction.toFixed(6)},${p.elevation.toFixed(4)}`).join(' ')
  )
}

describe('REFUTE — render arm override source', () => {
  if (process.env.GEOTECH_REFUTE !== '1') {
    it.skip('dormant (set GEOTECH_REFUTE=1)', () => {})
    return
  }

  it('compares litho-boundary overrides against the empty map production uses', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const engineV2 = isPartitionEngineV2Active()
    const lithoBoundaries = new Map<string, BodyBoundaryResponse>(
      Object.entries(raw.bodyBoundaries.litho),
    )
    const EMPTY = new Map<string, BodyBoundaryResponse>()

    console.log('')
    console.log('='.repeat(90))
    console.log('RENDER ARM: gate overrides (litho boundaries) vs production geotech axis (empty)')
    console.log(`  engine ${engineV2 ? 'v2' : 'v1'}; litho boundary shapes in dump = ${lithoBoundaries.size}`)
    console.log('='.repeat(90))

    let totalChangedM2 = 0
    let sectionsDiffering = 0
    for (const sec of raw.sections) {
      const L = assembleColumns(sec.columns, sec.alongM)
      if (L.columns.length < 2) continue
      const edges = toEdges(sec.edges)

      const ovGate = deriveOverrides(L.columns, edges, L.alongM, lithoBoundaries, engineV2)
      const ovProd = deriveOverrides(L.columns, edges, L.alongM, EMPTY, engineV2)

      const regGate = computeSectionFillActive(L.columns, edges, ovGate, L.alongM)
      const regProd = computeSectionFillActive(L.columns, edges, ovProd, L.alongM)

      const widthOf = (gi: number): number => {
        const l = L.alongM[gi]
        const r = L.alongM[gi + 1]
        return l === undefined || r === undefined ? 0 : r - l
      }
      const areaBySig = (regs: readonly SectionRegion[]): Map<string, number> => {
        const m = new Map<string, number>()
        for (const r of regs) m.set(sig(r), (m.get(sig(r)) ?? 0) + ringArea(r, widthOf(r.gapIndex)))
        return m
      }
      const A = areaBySig(regGate)
      const B = areaBySig(regProd)
      let changed = 0
      for (const [k, v] of A) if (!B.has(k)) changed += v
      for (const [k, v] of B) if (!A.has(k)) changed += v

      const identical = regGate.length === regProd.length && changed === 0
      if (!identical) sectionsDiffering += 1
      totalChangedM2 += changed

      console.log(
        `  ${sec.name.padEnd(18)} overrides gate=${ovGate.size} prod=${ovProd.size}  ` +
          `regions ${regGate.length} vs ${regProd.length}  ` +
          `geometry ${identical ? 'IDENTICAL' : `DIFFERS — ${changed.toFixed(1)} m2 of regions changed`}`,
      )

      if (!identical) {
        // Net per-FORMATION area shift, which is what the agreement gate's class
        // buckets actually integrate. The signature diff above counts a moved
        // vertex twice; this counts only the area that changes hands.
        const byFormation = (regs: readonly SectionRegion[]): Map<string, number> => {
          const m = new Map<string, number>()
          for (const r of regs) {
            m.set(r.formationId, (m.get(r.formationId) ?? 0) + ringArea(r, widthOf(r.gapIndex)))
          }
          return m
        }
        const fa = byFormation(regGate)
        const fb = byFormation(regProd)
        let netShift = 0
        for (const k of new Set([...fa.keys(), ...fb.keys()])) {
          const d = (fa.get(k) ?? 0) - (fb.get(k) ?? 0)
          netShift += Math.abs(d)
          if (Math.abs(d) > 1) {
            console.log(
              `      formation ${k.slice(0, 8)}  gate ${(fa.get(k) ?? 0).toFixed(1)} m2  ` +
                `prod ${(fb.get(k) ?? 0).toFixed(1)} m2  delta ${d >= 0 ? '+' : ''}${d.toFixed(1)} m2`,
            )
          }
        }
        console.log(
          `      net area changing hands between formations: ${(netShift / 2).toFixed(1)} m2`,
        )
      }
    }

    console.log('')
    console.log(
      `  sections whose RENDERED partition differs: ${sectionsDiffering}; ` +
        `total region area that changes: ${totalChangedM2.toFixed(1)} m2`,
    )
    console.log('='.repeat(90))
    expect(raw.sections.length).toBeGreaterThan(0)
  }, 600_000)
})
