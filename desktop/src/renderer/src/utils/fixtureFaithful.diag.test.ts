import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import { computeEngineSnapshot } from './cs1GoldenMaster/engineSnapshot'
import { frameAlignedColumns } from './frameAlignedPartition'
import { computeHierarchicalGeotechFill } from './geotechHierarchicalFill'
import { buildPackingClassOf } from './geotechHierarchicalFill/packingClassOf'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn } from './partitionFill'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const LIVE = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')

/** The anonymised fixture must be the SAME SCENE as the live dump it came from. */
describe('PROBE — is the anonymised CS1 fixture faithful to the live dump?', () => {
  if (process.env.PROBE !== '1' || !existsSync(LIVE)) {
    it.skip('dormant', () => {})
    return
  }
  it('reproduces the live CS1 geometry ring for ring', () => {
    const raw = JSON.parse(readFileSync(LIVE, 'utf8')) as any
    const sec = raw.sections.find((s: any) => s.name === 'Cross-section 1')
    const assemble = (arm: any) => {
      const paired = arm.columns
        .map((c: any, i: number) => ({ c, a: arm.alongM[i] }))
        .filter(({ c }: any) => c.surfaceElevM != null && c.units.length > 0)
        .sort((p: any, q: any) => p.a - q.a)
      return {
        columns: paired.map(({ c }: any) => ({
          investigationId: c.investigationId,
          surfaceElevM: c.surfaceElevM,
          units: [...c.units].sort((a: any, b: any) => a.topDepthM - b.topDepthM),
        })) as PartitionColumn[],
        alongM: paired.map(({ a }: any) => a),
      }
    }
    const toEdges = (es: readonly any[]): CorrelationEdge[] =>
      es.map((e) => ({ a: e.a, b: e.b, aSide: e.aSide ?? 'top', bSide: e.bSide ?? 'top' }))
    const L = assemble(sec)
    const G = assemble(sec.geotech)
    const noB = new Map<string, BodyBoundaryResponse>()
    const litho = computeSectionFillActive(
      L.columns,
      toEdges(sec.edges),
      deriveSectionApexOverrides(L.columns, toEdges(sec.edges), L.alongM, noB),
      L.alongM,
    )
    const live = computeHierarchicalGeotechFill({
      lithoColumns: L.columns,
      lithoEdges: toEdges(sec.edges),
      lithoRegions: litho,
      geotechColumns: frameAlignedColumns(
        L.columns,
        new Map(G.columns.map((c) => [c.investigationId, c])),
      ),
      geotechEdges: toEdges(sec.geotech.edges),
      alongM: L.alongM,
      packingClassOf: buildPackingClassOf(Object.entries(raw.refinementBundle.nadMeta)),
    })

    const round = (n: number): number => Math.round(n * 1e6) / 1e6
    // Compare GEOMETRY only — the ids differ by construction (that is the
    // anonymisation). A ring set that matches proves the fixture is the same
    // scene; the class LABELS are checked separately below via the count of
    // distinct classes per ring.
    const canon = (poly: readonly any[]): string => {
      const pts = poly.map((p: any) => `${round(p.fraction)},${round(p.elevation)}`)
      if (pts.length === 0) return ''
      let st = 0
      for (let i = 1; i < pts.length; i++) if (pts[i] < pts[st]) st = i
      return [...pts.slice(st), ...pts.slice(0, st)].join(' ')
    }
    const rings = (rs: readonly any[]): string[] => rs.map((r) => canon(r.polygon)).sort()
    const fixtureSnap = computeEngineSnapshot()

    expect(fixtureSnap.regions.length, 'region COUNT').toBe(live.regions.length)
    const A = fixtureSnap.regions.map((r) => r.ring).sort()
    const B = rings(live.regions)
    const inB = new Set(B)
    const inA = new Set(A)
    const onlyFixture = A.filter((r) => !inB.has(r))
    const onlyLive = B.filter((r) => !inA.has(r))
    // eslint-disable-next-line no-console
    console.log('only in FIXTURE:', onlyFixture.length, ' only in LIVE:', onlyLive.length)
    for (const r of onlyFixture.slice(0, 6)) console.log('  F+', r)
    for (const r of onlyLive.slice(0, 6)) console.log('  L+', r)
    expect(onlyFixture, 'rings the fixture invents').toEqual([])
    expect(onlyLive, 'rings the fixture loses').toEqual([])
    expect(fixtureSnap.fallback.map((r) => r.ring).sort(), 'every fallback RING').toEqual(
      rings(live.lithoFallback),
    )
    // eslint-disable-next-line no-console
    console.log(
      `FAITHFUL: ${fixtureSnap.regions.length} regions + ${fixtureSnap.fallback.length} fallback rings identical to the live dump`,
    )
  })
})
