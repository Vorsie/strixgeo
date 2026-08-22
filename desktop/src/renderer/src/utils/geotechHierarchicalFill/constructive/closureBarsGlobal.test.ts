/**
 * Owner code-hunt finding F7, 2026-08-22: ``closureBars`` was computed once
 * PER FAMILY, from that family's own plans only. A band adopted across a
 * family boundary (owner 2026-08-20, "the owner's arrow" — a unit that lost
 * its cover to a same-soil neighbour lends its bands to whoever holds the
 * ground) is a remainder candidate wherever it is lent, but its TRUE
 * closure — computed in the family it actually belongs to — was invisible
 * to the borrowing family's own (separately-scoped) closureBars map, so the
 * borrowing family could hand it unlimited reach past its own true pinch.
 *
 * ``closureBarsFor`` is the extracted mechanism (see ``familyFill.ts``); the
 * fix is that ``index.ts`` now calls it ONCE, over every family's plans
 * flattened together, instead of once per family. This test proves the
 * mechanism directly: a plan-group that never itself closes a band still
 * needs a SECOND group's plans in the same call to see that band's bar.
 */
import { describe, expect, it } from 'vitest'

import { closureBarsFor } from './familyFill'
import type { GapFillInput } from './fillGap'
import type { RunBand, RunColumn } from './constructs'

const band = (layerId: string, formationId: string, top: number, base: number, ci: number, x: number): RunBand => ({
  layerId,
  formationId,
  bodyId: null,
  top,
  base,
  ci,
  x,
})

// A minimal plan carrying only what closureBarsFor reads (run/ties/coverTies)
// — cover/gapPaint/columns are the FILL pass's concern, not this one's.
const minimalPlan = (
  gapIndex: number,
  run: { left: RunColumn; right: RunColumn } | null,
): Omit<GapFillInput, 'closureBars'> => ({
  gapIndex,
  xa: gapIndex * 100,
  xb: gapIndex * 100 + 100,
  cover: [],
  gapPaint: [],
  run,
  ties: [],
  coverTies: [],
  columns: run === null ? [] : [run.left, run.right],
  stacks: new Map(),
  massOf: (b: RunBand) => ({ litho: 'ZAND', packing: b.formationId }),
})

describe('closureBarsFor — a band adopted across a plan boundary is visible only in the union', () => {
  it("CB1 — a family's own call never sees a band whose closure lives in a DIFFERENT family's plans; the union of both does", () => {
    // "Family Y": P carries nothing of this soil, Q carries the sole 0-tie
    // band 'b-lens' — a genuine lens, pinching toward Q's own column.
    const p = band('p-other', 'f-other', 10, 0, 0, 0)
    const bLens = band('b-lens', 'f-dense', 10, 0, 1, 100)
    const familyYPlan = minimalPlan(0, {
      left: { ci: 0, x: 0, bands: [p] },
      right: { ci: 1, x: 100, bands: [bLens] },
    })

    // "Family X": an entirely separate run (R, S), which never touches
    // band 'b-lens' at all — it is the family that would ADOPT it
    // elsewhere, but that adoption is a remainder-candidate concern (the
    // FILL pass's ``columns``/``familyBands``), never a LINES concern here.
    const r = band('r-other', 'f-other', 10, 0, 2, 200)
    const s = band('s-other', 'f-other', 10, 0, 3, 300)
    const familyXPlan = minimalPlan(2, {
      left: { ci: 2, x: 200, bands: [r] },
      right: { ci: 3, x: 300, bands: [s] },
    })

    const massOf = (b: RunBand) => ({ litho: 'ZAND', packing: b.formationId })
    const stacks = new Map<number, readonly RunBand[]>()

    const familyXOnly = closureBarsFor([familyXPlan], stacks, massOf)
    const combined = closureBarsFor([familyYPlan, familyXPlan], stacks, massOf)
    const familyYOnly = closureBarsFor([familyYPlan], stacks, massOf)

    expect(
      familyXOnly.has('b-lens'),
      "the OLD per-family scoping: family X's own plans alone never see band b's true closure",
    ).toBe(false)
    expect(combined.has('b-lens'), 'the union — every family together — sees it').toBe(true)
    expect(combined.get('b-lens')).toEqual(familyYOnly.get('b-lens'))
  })
})
