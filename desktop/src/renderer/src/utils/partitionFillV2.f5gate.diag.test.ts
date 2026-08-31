/**
 * partitionFillV2.f5gate.diag.test.ts — the F5 EMISSION acceptance (S41.b): a sub-TD corr-1
 * unit must ONLAP its resolved bridge tie, not render absent (swallowed by the deep-to-deep
 * substrate flood). The real offender is CS1 gap22 col23 (GEO-10/170-S11 facing) u2 SILT
 * el[-7.53..-6.21]: it sits below col22's TD (elev 8.92), reads corr 1 (its base derived-anchored
 * by the ZAND-top jump-tie bridge below it), and today the sub-TD lens pass drops it (corr !== 0)
 * so it renders ABSENT. The plan resolves its bridge tieRef (S41.b jump-tie resolver); the sub-TD
 * onlap dispatch must draw it.
 *
 * RED-first: proven absent on the pre-fix engine, terminated after. Run with SHAPE_AUDIT=1.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { renderedShape } from './partitionFillV2.conformance.classify'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const RUN = process.env.SHAPE_AUDIT === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }

describe.runIf(RUN)('F5 emission — sub-TD corr-1 onlaps its bridge tie', () => {
  it('CS1 gap22 RIGHT SILT el[-7.53,-6.21] terminates (onlap), not absent', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const sec = raw.sections.find((s) => s.name === 'Cross-section 1')!
    const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    const columns: PartitionColumn[] = keep.map(({ c }) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
    const alongM = keep.map(({ i }) => sec.alongM[i])
    const edges: CorrelationEdge[] = sec.edges.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))

    const prev = setTwoSidedTerminations(true)
    let regs: SectionRegion[]
    try {
      const regions = computeSectionFillV2(columns, edges, undefined, alongM)
      regs = regions.filter((r) => r.gapIndex === 22)
    } finally {
      setTwoSidedTerminations(prev)
    }
    // col23 (right column of gap22) u2 SILT — its formationId.
    const rightCol = columns[23]
    const fid = rightCol.units[2].formationId
    const rs = renderedShape(regs, fid, -7.53, -6.21, 'right')
    // The F5 acceptance: not absent, not band — a genuine termination.
    expect(['lens', 'onlap']).toContain(rs.shape)
  })
})
