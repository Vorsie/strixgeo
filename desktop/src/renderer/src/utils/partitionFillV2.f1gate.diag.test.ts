/**
 * partitionFillV2.f1gate.diag.test.ts — the F1 acceptance (S41.c): a matched-pair BAND's
 * top/base contours RIDE the two actual bracket ties, and no invented same-formation band
 * (from formation-overlap authority) crosses the band diagonally.
 *
 * The real offender is CS1 gap2 (GEO-10/171-B6 ↔ 1411-GEO-23/126-B4). The SILT matched pair
 * (B6 el[5.023..6.278] ↔ B4 el[7.509..13.130]) is tied top-top AND base-base — the top tie is
 * L 6.278 ↔ R 13.130 (a 6.85 m dip), the base tie is L 5.023 ↔ R 7.509. The band's face is
 * bounded EXACTLY by those two ties, so the SILT band spans, at fraction f, the elevation window
 * [5.023 + 2.486·f .. 6.278 + 6.852·f]; the KLEI below (B6 L2 el[3.670..5.023]) stays under the
 * base tie.
 *
 * The DELETED ``emitRuledBands`` pass invented a KLEI band whose base contour rode diagonally
 * from L2-base 3.670 ↔ R1-base 7.130 (formation-overlap authority against HALF the facing run) —
 * crossing the SILT band and collapsing the real SILT base tie to a point. The owner's F1
 * acceptance: "silt quad top = top tie, base = base tie; the clay below intact."
 *
 * RED-first: PROVEN RED on the pre-fix engine (baseline `96e2a531c`) — the two mid-band probes
 * below returned KLEI, not SILT (throwaway `partitionFillV2.throwaway_s41c_dump.diag.test.ts`
 * dump, since removed). GREEN after the pass is deleted (the band rides its two real ties).
 *
 * Run with SHAPE_AUDIT=1.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { inPolygon } from './partitionFillV2.parityCoverage'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const RUN = process.env.SHAPE_AUDIT === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }
interface RawInput { sections: RawSection[]; formationNames: Record<string, string> }

describe.runIf(RUN)('F1 acceptance — CS1 gap2 SILT band rides its two real ties', () => {
  it('B6↔B4: SILT band interior is SILT (top tie ↔ base tie); KLEI below intact; no diagonal cross', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawInput
    const sec = raw.sections.find((s) => s.name === 'Cross-section 1')!
    const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    const columns: PartitionColumn[] = keep.map(({ c }) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
    const alongM = keep.map(({ i }) => sec.alongM[i])
    const edges: CorrelationEdge[] = sec.edges.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))

    // Resolve SILT / KLEI by NAME (robust to formationId churn). B6 = col2, B4 = col3.
    const nameOf = (fid: string): string => raw.formationNames[fid] ?? fid
    const siltId = Object.keys(raw.formationNames).find((k) => raw.formationNames[k] === 'SILT')!
    const kleiId = Object.keys(raw.formationNames).find((k) => raw.formationNames[k] === 'KLEI')!

    const prev = setTwoSidedTerminations(true)
    let regs: SectionRegion[]
    try {
      const regions = computeSectionFillV2(columns, edges, undefined, alongM)
      regs = regions.filter((r) => r.gapIndex === 2)
    } finally {
      setTwoSidedTerminations(prev)
    }

    // Formation covering a probe point (fraction × elevation) in gap2.
    const coverAt = (f: number, e: number): string[] =>
      regs.filter((r) => inPolygon(f, e, r.polygon)).map((r) => nameOf(r.formationId))

    // (1) Just inside the SILT band on the LEFT edge — el 5.5 sits between the base tie (L 5.023)
    //     and the top tie (L 6.278). MUST be SILT. Pre-fix: KLEI (the invented band crossed here).
    expect(coverAt(0.02, 5.5), 'SILT band left-edge interior el 5.5 must be SILT (rides its base tie)').toContain('SILT')
    // (2) Mid-band interior — at f 0.1 the SILT window is [5.27..6.96]; el 6.0 sits inside. MUST be
    //     SILT. Pre-fix: KLEI (the diagonal invented base contour cut across the SILT band here).
    expect(coverAt(0.1, 6.0), 'SILT band interior el 6.0 at f 0.1 must be SILT, not a crossing band').toContain('SILT')
    // (3) The KLEI below the base tie stays intact — el 4.5 on the left (B6 L2 el[3.670..5.023]).
    expect(coverAt(0.02, 4.5), 'KLEI below the SILT base tie must remain KLEI').toContain('KLEI')
    // (4) NO KLEI (or any non-SILT) intrudes into the SILT band interior at the two probes above.
    expect(coverAt(0.02, 5.5), 'no KLEI may cross into the SILT band interior (el 5.5)').not.toContain('KLEI')
    expect(coverAt(0.1, 6.0), 'no KLEI may cross into the SILT band interior (el 6.0)').not.toContain('KLEI')
    // Sanity: the ids resolved (guards a silent formationName rename hiding the assertions).
    expect(nameOf(siltId)).toBe('SILT')
    expect(nameOf(kleiId)).toBe('KLEI')
  })
})
