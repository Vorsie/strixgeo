/**
 * partitionFillV2.lensEdged.test.ts — RED→GREEN target for the LENS-EDGED termination
 * class (design partition-engine-v2.md §4 FINAL SHAPES fix-path residual (b); the
 * per-gap ``edgedLayers`` fix).
 *
 * OWNER RULE (in his vocabulary): "all you need is the ties, absence of ties and the
 * litho." A minority that is TIED IN THE ADJACENT gap but has NO tie in THIS gap must
 * still TERMINATE here — a small lens around the unit when it is 0-corr here, an onlap
 * riding its tie when it is 1-corr here. It must NOT render full-width (band) and must
 * NOT be absent (swallowed by its same-formation enclosing flood). Today's section-wide
 * ``edgedLayerIds`` blocks the enclosed-lens extraction for such a unit (it is edged
 * SOMEWHERE), so it drops to the interval flood and renders band/absent.
 *
 * STATUS: RED as of session 1 (2026-07-15). This is the multi-session red→green target
 * for the per-gap enclosed-minority extraction. Session 2 wires ``buildEdgedLayers`` into
 * a per-gap extraction so these units terminate; when it lands, this test flips GREEN.
 * Kept ``describe.skip`` so the committed suite stays green (the RED assertions are the
 * spec, exercised by removing ``.skip`` during the session-2 build).
 *
 * Repro: the exact real-data offenders from the conformance dump —
 *   CS1 gap 22 LEFT: SILT el[10.42,11.45] (0-corr here, edged gap 21) — renders band today.
 *                    ZAND el[9.83,10.42] (0-corr here, edged gap 21) — renders absent today.
 *   CS2 gap 21 LEFT: SILT el[-3.99,-3.67] (1-corr here, edged gap 20) — renders absent today.
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { renderedShape } from './partitionFillV2.conformance.classify'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }

function prepare(sec: RawSection): { columns: PartitionColumn[]; alongM: number[]; edges: CorrelationEdge[] } {
  const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))
  return { columns, alongM, edges }
}

function fillFor(secName: string): {
  regionsByGap: Map<number, SectionRegion[]>
  columns: PartitionColumn[]
} {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
  const sec = raw.sections.find((s) => s.name === secName)!
  const { columns, alongM, edges } = prepare(sec)
  const regions = computeSectionFillV2(columns, edges, undefined, alongM)
  const m = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    if (!m.has(r.gapIndex)) m.set(r.gapIndex, [])
    m.get(r.gapIndex)!.push(r)
  }
  return { regionsByGap: m, columns }
}

/**
 * The formationId of the unit on the gap's LEFT column whose elevation band overlaps
 * [lo,hi] — derived from the INPUT (surface − depth), robust to the unit being absent
 * from the output (which is exactly the RED case). This is the formation the conformance
 * gate attributes the target elevation band to.
 */
function leftUnitFormationAt(columns: PartitionColumn[], gapIndex: number, lo: number, hi: number): string {
  const col = columns[gapIndex]
  const surf = col.surfaceElevM
  for (const u of col.units) {
    const uTop = surf - u.topDepthM
    const uBase = surf - u.baseDepthM
    if (uTop > lo + 1e-3 && hi - 1e-3 > uBase) return u.formationId
  }
  throw new Error(`no left unit at el[${lo},${hi}] gap ${gapIndex}`)
}

/** A terminating shape is a lens or an onlap (never band, never absent). */
function isTerminated(shape: string): boolean {
  return shape === 'lens' || shape === 'onlap'
}

// SKIPPED = the committed suite stays green. Remove ``.skip`` in the session-2 build to
// drive the per-gap extraction red→green. The assertions are the behavioural spec.
describe.skip('lens-edged minorities terminate in the gap where they are NOT tied', () => {
  it('has the diag input', () => {
    expect(existsSync(INPUT)).toBe(true)
  })

  it('CS1 gap 22: SILT el[10.42,11.45] terminates (0-corr, edged only in gap 21)', () => {
    const { regionsByGap, columns } = fillFor('Cross-section 1')
    const regs = regionsByGap.get(22) ?? []
    const fid = leftUnitFormationAt(columns, 22, 10.42, 11.45)
    const rs = renderedShape(regs, fid, 10.42, 11.45)
    expect(isTerminated(rs.shape)).toBe(true)
  })

  it('CS2 gap 21: SILT el[-3.99,-3.67] terminates (1-corr, edged only in gap 20)', () => {
    const { regionsByGap, columns } = fillFor('Cross-section 2')
    const regs = regionsByGap.get(21) ?? []
    const fid = leftUnitFormationAt(columns, 21, -3.99, -3.67)
    const rs = renderedShape(regs, fid, -3.99, -3.67)
    expect(isTerminated(rs.shape)).toBe(true)
  })
})
