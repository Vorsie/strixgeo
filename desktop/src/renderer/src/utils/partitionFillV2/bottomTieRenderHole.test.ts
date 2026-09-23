/**
 * bottomTieRenderHole.test.ts — the owner's installer #25 ruling (2026-09-08):
 * *"somehow you introduced a gap in the render, it happens for bottom test correlations."*
 *
 * A BOTTOM-TEST correlation (a base/mixed tie into a shallow test's TD) makes a deep unit's band or
 * onlap fill the sub-TD wedge. Ruling 5's cross-lithology seam (installer #25, `dfa9ad8ec`) wrongly
 * fired on such a MIXED base<->top tie too, splitting the onlap with a mid-gap fence and opening a
 * coverage HOLE below the correlation band (dev Cross-section 1 gap 18 GEO-23/125-S7 -> S6, gap 19
 * S6 -> S5A; owner worked-example Cross-section 2 / Tie-section 4 at the deepest bottom tie).
 *
 * RE-RULED 2026-09-23 (*"let's go with plain 2 / 1 / 0 everywhere"*): under a bottom tie the deep
 * unit onlaps to the HALFWAY point of the tie and the untied units below it pinch at their own
 * level, so the space under the bottom tie past the tip and the pinch is the no-data void BY RULING.
 * The scan therefore measures each hole only ABOVE the gap's bottom tie (``gapBottomTie``); a gap
 * without one is scanned whole, as before. It stays a PERMANENT gate over EVERY gap of EVERY section
 * of both real fixtures (the dev project decode + the owner worked example): a hole under a
 * correlation band above the bottom tie — the seam-fence defect class — is still a red. A "defect
 * hole" is an interior coverage gap CAPPED ABOVE by a near-full-width band (fracSpan >= 0.9); the
 * intended-EMPTY wedge above a hand-tied first-unit top against a short borehole (ruling 5 part 3) is
 * bounded above only by narrow floating lenses and is not flagged. See ``docs/design/section-fill.md``.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  HOLE_TOL_M,
  coveredHeightBelow,
  gapBottomTie,
  loadSections,
  prepareSection,
  regionsForLayer,
  worstBandCappedHole,
} from './__fixtures__/bandCappedHoleScan'
import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'

// The flag-ON product path is what the app renders (mirrors the conformance gate).
beforeAll(() => setTwoSidedTerminations(true))
afterAll(() => setTwoSidedTerminations(false))

describe('no gap in the render under a bottom test correlation (owner 2026-09-08; the sub-TD void re-ruled 2026-09-23)', () => {
  for (const file of ['dev_project_sections.json', 'owner_worked_example_sections.json']) {
    const fx = loadSections(file)
    for (const sec of fx.sections) {
      const { columns, alongM, names, edges } = prepareSection(sec)
      if (columns.length < 2) continue
      it(`${file} / ${sec.name}: every gap is hole-free under its correlation bands above the bottom tie`, () => {
        const regions = computeSectionFillV2(columns, edges, undefined, alongM)
        for (let g = 0; g + 1 < columns.length; g++) {
          const bottomTie = gapBottomTie(columns, edges, g)
          const w = worstBandCappedHole(regions.filter((r) => r.gapIndex === g), bottomTie?.elevAt)
          expect(
            w.gap,
            `${sec.name} gap ${g} (${names[g]} -> ${names[g + 1]}): hole ${w.gap.toFixed(3)}m under a correlation band at f=${w.frac.toFixed(2)}, elev [${w.lo.toFixed(2)}..${w.hi.toFixed(2)}]`,
          ).toBeLessThan(HOLE_TOL_M)
        }
      })
    }
  }

  it("dev Cross-section 1, GEO-23/125-S7 -> S6: the sub-TD wedge under S7 stays filled — a deeper test beyond S7 reads the sand", () => {
    // The owner's 2026-09-08 screenshot: a dark uncovered rectangle just under S7's bottom clay,
    // bounded by the dashed blue bottom tie. S7 (TD +4.23) ties its deepest clay base to S6's ZAND
    // top (a bottom tie). This is NOT the 2026-09-23 void case: left of S7 (and the blind S7A)
    // 1411-GEO-23/126-B2 reads sand at these levels, so the deep-to-deep substrate carries S6's sand
    // under S7 to it, and the tie rises from S7's TD to the sand top, so the wedge between them is
    // closed by the sand mass. The rectangle stays filled: no hole anywhere in the gap.
    const sec = loadSections('dev_project_sections.json').sections.find((s) => s.name === 'Cross-section 1')!
    const { columns, alongM, names, edges } = prepareSection(sec)
    const g = names.indexOf('GEO-23/125-S7')
    expect(names[g + 1], 'S7 and S6 are adjacent').toBe('GEO-23/125-S6')
    const tie = gapBottomTie(columns, edges, g)
    expect(tie, 'S7 -> S6 carries a bottom tie').not.toBeNull()
    const regions = computeSectionFillV2(columns, edges, undefined, alongM).filter((r) => r.gapIndex === g)
    // S6 is the right column: the sand is carried all the way to S7 (fraction 0).
    const sand = regionsForLayer(regions, tie!.deepLayerId)
    expect(sand.length, 'the tied sand is drawn').toBeGreaterThan(0)
    const reach = Math.min(...sand.flatMap((r) => r.polygon.map((p) => p.fraction)))
    expect(reach, 'the sand reaches S7 on the substrate').toBeLessThan(0.05)
    // Under the tie near S7 the sand is present (the substrate band), not a void.
    const f = 0.2
    expect(coveredHeightBelow(regions, f, tie!.elevAt(f) - 1e-3), 'the substrate fills under the tie').toBeGreaterThan(5)
    // And the whole gap is hole-free under its bands (the 2026-09-08 rectangle stays filled).
    const w = worstBandCappedHole(regions)
    expect(w.gap, `S7->S6 hole ${w.gap.toFixed(3)}m at f=${w.frac.toFixed(2)}`).toBeLessThan(HOLE_TOL_M)
  })
})
