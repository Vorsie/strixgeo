/**
 * partitionFillV2.lensReach.test.ts — the ruling-8b lens-reach cap + the ruling-8b
 * CONFLICT-RESOLUTION reach-halving loop (design partition-engine-v2.md §8, 8b).
 *
 * The reach-halving cases encode the owner's rule in HIS vocabulary (2026-07-16 late): "you can
 * just shorten the lenses by half if there is conflict with a tie" — the SEAMS never move, the
 * LENS shrinks. A per-unit lens between two SLOPING brackets that would poke past a bracket at
 * its 8b reach HALVES its reach until the whole lens polygon fits strictly inside the wedge; a
 * lens that cannot fit even at the snap-grid floor degenerates (returns 0 → the caller drops it).
 */

import { describe, expect, it } from 'vitest'

import { fitLensReach, lensReachFraction, lensReachM } from './partitionFillV2/lensReach'

const LENS_PINCH_FRACTION = 0.45

describe('ruling-8b lens reach cap', () => {
  it('a thick unit keeps the flat 0.45 reach (2× thickness ≥ 0.45× gap)', () => {
    // 5 m thick, 4 m gap → 2×5 = 10 ≥ 0.45×4 = 1.8 → capped at 0.45 of the gap.
    expect(lensReachFraction(5, 4)).toBeCloseTo(LENS_PINCH_FRACTION, 6)
  })
  it('a thin unit hugs its column (reach = 2× thickness in metres)', () => {
    // 0.2 m thick, 4 m gap → 2×0.2 = 0.4 m reach → 0.1 of the gap.
    expect(lensReachM(0.2, 4)).toBeCloseTo(0.4, 6)
    expect(lensReachFraction(0.2, 4)).toBeCloseTo(0.1, 6)
  })
})

describe('ruling-8b conflict-resolution — reach-halving between sloping brackets', () => {
  it('a lens that already fits at its 8b reach is NOT shrunk (no conflict → keep the reach)', () => {
    // A thin minority (0.3 m) mid-elevation 6.0, in a barely-sloping wedge (top 6.5→6.4, base
    // 5.5→5.6). At the 8b reach (2×0.3/4 = 0.15) the apex at el 6.0 sits well inside the wedge.
    const f = fitLensReach(0.3, 4, 6.0, 6.5, 5.5, 6.4, 5.6)
    expect(f).toBeCloseTo(lensReachFraction(0.3, 4), 6)
  })

  it('a lens conflicting with a STEEPLY converging bracket HALVES until it fits (seams stay, lens shrinks)', () => {
    // A THIN minority (0.2 m, own top 7.0 base 6.8, mid 6.9) hugging the DESCENDING top bracket
    // (iTop 7.0, facing CONVERGES to el 6.0). At its 8b reach the top bracket at that fraction has
    // already descended below the apex el 6.9 → conflict; the reach must HALVE until the apex sits
    // strictly below the descending top bracket. The result is a smaller, hugging reach — never the
    // full 8b reach — and never 0 (the apex el 6.9 IS inside the wedge near the own column).
    const start = lensReachFraction(0.2, 4) // 2×0.2/4 = 0.1
    const f = fitLensReach(0.2, 4, 6.9, 7.0, 6.0, 6.0, 6.0)
    expect(f).toBeGreaterThan(0) // a lens fits near the own column, below the descended bracket
    expect(f).toBeLessThan(start) // it was shortened (halved) to clear the top bracket
  })

  it('the reach halves MULTIPLE times in a very steep wedge and still emits a (small) lens', () => {
    // A minority hugging the top bracket even more tightly (mid 6.95, iTop 7.0, facing converges to
    // el 4.0 — a very steep descent). Several halvings are needed before the descended bracket
    // clears the apex; the result is a small positive reach (never 0 — the apex IS inside near the
    // own column).
    const f = fitLensReach(0.1, 4, 6.95, 7.0, 5.0, 4.0, 4.0)
    expect(f).toBeGreaterThan(0)
    expect(f).toBeLessThan(0.1) // shortened well below the 8b reach after multiple halvings
  })

  it('a lens whose mid-elevation is OUTSIDE the wedge everywhere degenerates cleanly (returns 0)', () => {
    // The minority mid-elevation 9.0 sits ABOVE the interval top bracket (iTop 7) — it can never
    // fit inside the wedge at ANY reach (the wedge only descends from 7). Return 0 → the caller
    // drops the lens (the segmentDegenerate guard makes it a clean no-op).
    const f = fitLensReach(0.5, 4, 9.0, 7.0, 5.0, 6.0, 5.5)
    expect(f).toBe(0)
  })
})
