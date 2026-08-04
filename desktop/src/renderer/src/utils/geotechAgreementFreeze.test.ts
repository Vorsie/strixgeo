/**
 * Rules of the geotech agreement FREEZE comparator.
 *
 * ``compareToBaseline`` is the arbiter half of the render-vs-build gate: it
 * decides which of a measured run's numbers are evidence against the committed
 * baseline and which are merely printed. The value of the whole gate is that its
 * reds are true, so the not-comparable rules are behaviour, not plumbing, and
 * they are pinned here.
 *
 * The module itself is ``.diag`` (no production path imports it); these tests
 * are ordinary unit tests and always run.
 */

import { describe, expect, it } from 'vitest'

import {
  compareToBaseline,
  TOLERANCE_PCT,
  type AgreementBaseline,
  type BaselineSection,
  type MeasuredSection,
} from './geotechAgreementFreeze.diag'

/** A baseline section whose union is 100 m2, so pct reads directly as area. */
function baseSection(name: string, disagreementPct: number, cols = 4): BaselineSection {
  return {
    name,
    lithoCols: cols,
    geoCols: cols,
    lithoEdges: 10,
    geoEdges: 10,
    disagreementPct,
    agreeM2: 100 - disagreementPct,
    disagreeM2: disagreementPct,
    renderOnlyM2: 0,
    buildOnlyM2: 0,
  }
}

function measure(name: string, disagreementPct: number, cols = 4): MeasuredSection {
  return {
    name,
    lithoCols: cols,
    geoCols: cols,
    lithoEdges: 10,
    geoEdges: 10,
    disagreementPct,
    buckets: {
      agree: 100 - disagreementPct,
      disagree: disagreementPct,
      renderOnly: 0,
      buildOnly: 0,
    },
  }
}

function baseline(sections: BaselineSection[], totalPct: number): AgreementBaseline {
  return {
    frozenAt: '2026-08-04T00:00:00.000Z',
    engine: 'v2',
    lithoModelId: 'litho-1',
    geotechModelId: 'geo-1',
    totalDisagreementPct: totalPct,
    buildableDisagreementPct: totalPct,
    sections,
    note: 'test',
  }
}

const run = (
  measured: MeasuredSection[],
  base: AgreementBaseline,
  totalPct: number,
): ReturnType<typeof compareToBaseline> =>
  compareToBaseline(measured, base, 'litho-1', 'geo-1', 'v2', totalPct, totalPct)

describe('compareToBaseline — what counts as evidence', () => {
  it('fails a section that got worse by more than the tolerance', () => {
    const base = baseline([baseSection('A', 40), baseSection('B', 40)], 40)
    const v = run([measure('A', 40 + TOLERANCE_PCT + 0.1), measure('B', 40)], base, 40.3)
    expect(v.regressions.some((r) => r.startsWith('A '))).toBe(true)
  })

  it('does not fail a section that improved', () => {
    const base = baseline([baseSection('A', 40), baseSection('B', 40)], 40)
    const v = run([measure('A', 30), measure('B', 40)], base, 35)
    expect(v.regressions).toEqual([])
    expect(v.improvements).toHaveLength(1)
  })

  // THE RULE THIS FILE EXISTS FOR. Edit one section in the app, re-dump, and
  // that section is reported as INPUTS MOVED and not enforced — but its
  // movement still lands in the model-wide total. Enforcing the total would
  // fail the run anyway, which is the false red the module's own docstring says
  // it prevents.
  it('does not fail on the model-wide total when a section was excluded as not comparable', () => {
    const base = baseline([baseSection('A', 40), baseSection('B', 40)], 40)
    // A is unchanged and comparable; B gained a column (the user divided a
    // borehole) and jumped 40 -> 90, taking the model-wide total with it.
    const v = run([measure('A', 40), measure('B', 90, 5)], base, 65)
    expect(v.skipped).toEqual(['B'])
    expect(v.regressions).toEqual([])
    expect(v.lines.some((l) => l.includes('ENFORCED TOTAL') && l.includes('excludes B'))).toBe(true)
  })

  it('still fails on the total when every section is comparable and the total rose', () => {
    const base = baseline([baseSection('A', 40), baseSection('B', 40)], 40)
    const v = run([measure('A', 41), measure('B', 41)], base, 41)
    expect(v.skipped).toEqual([])
    expect(v.regressions.some((r) => r.includes('comparable section'))).toBe(true)
  })

  it('enforces nothing when the baseline was frozen on another model', () => {
    const base = baseline([baseSection('A', 40)], 40)
    const v = compareToBaseline([measure('A', 90)], base, 'other-litho', 'geo-1', 'v2', 90, 90)
    expect(v.regressions).toEqual([])
    expect(v.skipped).toEqual(['A'])
  })
})
