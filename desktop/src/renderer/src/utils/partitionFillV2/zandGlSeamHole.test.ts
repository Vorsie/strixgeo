/**
 * zandGlSeamHole.test.ts — the owner's installer #42 dogfeed (2026-09-16):
 * *"i'm seeing a gap in the pdf export."*
 *
 * On Cross-section 1 (profiel A-A') of the worked example a thin WHITE horizontal sliver appeared
 * at about -4.8 m TAW between GEO-02/145-S13 and S14, exactly where the plain ZAND unit above meets
 * the ZAND (GL:|KL:) unit below — the glauconitic/clayey sand, its own litho formation welded into
 * ONE body mass with the plain sand (one-mass-one-body). It was in the litho-axis 2-D fill (the PDF
 * renders the same partition), NOT a PDF artefact.
 *
 * Mechanism: S13's ZAND (GL:|KL:) TOP is tied to S14's plain-ZAND BASE (a MIXED base<->top tie) and
 * S14's plain-ZAND base IS S14's TD — so the tie is a BOTTOM tie into the shallow test's TD. The
 * deep GL unit onlaps that tie; but ``emitEnclosingFlood.closeInterval`` also saw that same tie land
 * on both enclosing masses (GL on S13, plain ZAND on S14) and drew a ``declared`` mid-gap FENCE at
 * ``INTERIOR_PINCH_FRACTION``, fencing the onlap and handing the far half back white. That is the
 * exact coverage-hole class ruling 5's TOP-to-TOP restriction cured for the cross-litho seam — here
 * on the honest-meeting path. The fix: a mixed base<->top tie into the shallow TD never justifies
 * the ``declared`` seam.
 *
 * RE-RULED 2026-09-23 (*"let's go with plain 2 / 1 / 0 everywhere"*): the GL sand onlaps its bottom
 * tie to the HALFWAY point and the space under the tie past its tip is the no-data void by ruling,
 * so the scan measures holes only ABOVE the gap's bottom tie (``gapBottomTie``). The seam-fence
 * defect class — a hole under a correlation band above the bottom tie — stays a red.
 *
 * RE-RULED AGAIN 2026-10-04 (*"as long as the bottom of S11 is not correlated to 19/100-S3 the loop
 * isn't closed and there is nothing to draw"*, section "test"). This gap was the standing exception
 * of 2026-09-23: GEO-02/145-S15 beyond S14 reads the glauconitic sand, so the deep-to-deep substrate
 * carried S13's GL under S14 to it. That substrate is retired — no stored tie closes the GL sand
 * under S14 — so the GL sand onlaps its bottom tie halfway like any other, and the space past the
 * tip is the void the owner accepted (*"unless you tie them"*).
 *
 * The scan is a PERMANENT gate over EVERY gap of EVERY section of the owner's 2026-09-16 worked
 * example (his ``worked_example_0916.strix``, extracted with ``scratchpad/build_owner_fixture.cjs``).
 * A "defect hole" is an interior coverage gap CAPPED ABOVE by a near-full-width band (fracSpan >=
 * 0.9) — a hole sitting directly under a correlation band. See ``docs/design/section-fill.md``.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { HOLE_TOL_M, gapBottomTie, gapScanFloor, loadSections, prepareSection, regionsForLayer, worstBandCappedHole } from './__fixtures__/bandCappedHoleScan'
import { computeSectionFillV2 } from './computeSectionFillV2'
import { INTERIOR_PINCH_FRACTION } from '../sectionPartition'
import { setTwoSidedTerminations } from './tileFlags'

const FIXTURE = 'owner_we_2026-09-16_sections.json'

// The flag-ON product path is what the app renders (mirrors the conformance gate).
beforeAll(() => setTwoSidedTerminations(true))
afterAll(() => setTwoSidedTerminations(false))

describe('the plain sand and the glauconitic sand below it between S13 and S14 (owner 2026-09-16; the sub-TD void re-ruled 2026-09-23)', () => {
  it('Cross-section 1, S13 -> S14: the GL sand onlaps its bottom tie halfway — S15 reading the level no longer carries it', () => {
    const fx = loadSections(FIXTURE)
    const sec = fx.sections.find((s) => s.name === 'Cross-section 1')!
    const { columns, alongM, names, edges } = prepareSection(sec)
    const s13 = names.indexOf('GEO-02/145-S13')
    const s14 = names.indexOf('GEO-02/145-S14')
    // S13 and S14 are adjacent once the empty GEO-67/441 columns between them are dropped.
    expect(s14 - s13, `S13 (idx ${s13}) and S14 (idx ${s14}) must be adjacent after empties drop`).toBe(1)
    const tie = gapBottomTie(columns, edges, s13)
    expect(tie, 'the GL top tied to S14\'s TD is the bottom tie of this gap').not.toBeNull()
    const regions = computeSectionFillV2(columns, edges, undefined, alongM).filter((r) => r.gapIndex === s13)
    // The ~-4.8 m seam sliver (the 2026-09-16 defect) stays closed: no hole under a band above the
    // bottom tie.
    const w = worstBandCappedHole(regions, tie!.elevAt)
    expect(
      w.gap,
      `S13 -> S14 band-capped hole ${w.gap.toFixed(3)}m at f=${w.frac.toFixed(2)}, elev [${w.lo.toFixed(2)}..${w.hi.toFixed(2)}]`,
    ).toBeLessThan(HOLE_TOL_M)
    // S13 is the left (deep) column: the GL sand onlaps to the halfway point of its bottom tie and
    // no further — GEO-02/145-S15 reading the level beyond S14 closes nothing (no tie, no band).
    const gl = regionsForLayer(regions, tie!.deepLayerId)
    expect(gl.length, 'the GL sand is drawn in the gap').toBeGreaterThan(0)
    const reach = Math.max(...gl.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(reach, 'the onlap tip on the bottom tie').toBeCloseTo(INTERIOR_PINCH_FRACTION, 2)
  })

  it('every gap of every section of the 2026-09-16 worked example is hole-free under its correlation bands above the bottom tie', () => {
    const fx = loadSections(FIXTURE)
    for (const sec of fx.sections) {
      const { columns, alongM, names, edges } = prepareSection(sec)
      if (columns.length < 2) continue
      const regions = computeSectionFillV2(columns, edges, undefined, alongM)
      for (let g = 0; g + 1 < columns.length; g++) {
        const w = worstBandCappedHole(regions.filter((r) => r.gapIndex === g), gapScanFloor(columns, edges, g))
        expect(
          w.gap,
          `${sec.name} gap ${g} (${names[g]} -> ${names[g + 1]}): hole ${w.gap.toFixed(3)}m under a band at f=${w.frac.toFixed(2)}, elev [${w.lo.toFixed(2)}..${w.hi.toFixed(2)}]`,
        ).toBeLessThan(HOLE_TOL_M)
      }
    }
  })
})
