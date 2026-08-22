// THE LAW, TESTED IN ISOLATION.
//
// Owner, 2026-08-22: "how do we get open terminations for lenses ... how can
// i trust this software if even the basic rules are violated." emitKernel.ts
// is the ONE module that decides 2/1/0 — 27 lines, no geometry, no I/O — and
// until now it had no test file of its own; every check of it ran through the
// full fillGap pipeline, where a geometry bug and a kernel bug look the same
// from outside. This file pins the kernel's own truth table exhaustively
// against the owner's literal sentence, so a kernel regression fails HERE,
// at the one place a human can read the whole law in one screen.
import { describe, expect, it } from 'vitest'

import {
  CLEAR_THICKER_RATIO,
  collision,
  emitFor,
  massKey,
  sameMass,
  type Mass,
} from './emitKernel'

const SAND_DENSE: Mass = { litho: 'ZAND', packing: 'D' }
const SAND_MEDIUM: Mass = { litho: 'ZAND', packing: 'MD' }
const CLAY_STIFF: Mass = { litho: 'KLEI', packing: 'SF' }

describe('sameMass — "same litho and packing density", the one comparison', () => {
  it('EK1: identical litho and packing is the same mass', () => {
    expect(sameMass(SAND_DENSE, { litho: 'ZAND', packing: 'D' })).toBe(true)
  })
  it('EK2: same litho, different packing is NOT the same mass', () => {
    expect(sameMass(SAND_DENSE, SAND_MEDIUM)).toBe(false)
  })
  it('EK3: different litho, same packing token is NOT the same mass', () => {
    expect(sameMass(SAND_DENSE, { litho: 'KLEI', packing: 'D' })).toBe(false)
  })
})

describe('emitFor — "if litho has no ties emit lens"', () => {
  it('EK4: zero far ends is ALWAYS a lens, whatever the own mass', () => {
    expect(emitFor(SAND_DENSE, [])).toBe('lens')
    expect(emitFor(CLAY_STIFF, [])).toBe('lens')
  })
})

describe('emitFor — "follow tie, if litho at other end has same litho and packing density emit nothing. If it is a different litho emit an onlap"', () => {
  it('EK5: one far end, SAME mass -> nothing', () => {
    expect(emitFor(SAND_DENSE, [SAND_DENSE])).toBe('nothing')
  })
  it('EK6: one far end, different packing (same litho) -> onlap', () => {
    expect(emitFor(SAND_DENSE, [SAND_MEDIUM])).toBe('onlap')
  })
  it('EK7: one far end, different litho -> onlap', () => {
    expect(emitFor(SAND_DENSE, [CLAY_STIFF])).toBe('onlap')
  })
})

describe('emitFor — "if a litho has two ties ... emits NOTHING whatever the far ends read" (2026-08-21 ruling)', () => {
  // Exhaustive over the four (sameFar, sameFar) combinations for two tied
  // contacts. The owner's ruling is unconditional: two tied contacts is a
  // band, full stop, never a vertical and never dependent on what either far
  // end reads. Enumerated rather than sampled because the space is only four.
  const ANOTHER_SAND: Mass = { litho: 'ZAND', packing: 'L' }
  const cases: [string, Mass, Mass][] = [
    ['both same as own', SAND_DENSE, SAND_DENSE],
    ['first same, second different', SAND_DENSE, CLAY_STIFF],
    ['first different, second same', CLAY_STIFF, SAND_DENSE],
    ['both different from own, and from EACH OTHER', CLAY_STIFF, ANOTHER_SAND],
  ]
  for (const [label, far1, far2] of cases) {
    it(`EK8 (${label}) -> nothing`, () => {
      expect(emitFor(SAND_DENSE, [far1, far2])).toBe('nothing')
    })
  }
})

describe('massKey — the fill-sweep weld identity', () => {
  it('EK9: two masses key equal iff sameMass would say so', () => {
    expect(massKey(SAND_DENSE)).toBe(massKey({ litho: 'ZAND', packing: 'D' }))
    expect(massKey(SAND_DENSE)).not.toBe(massKey(SAND_MEDIUM))
  })
})

describe('collision — "clearly thicker wins", ratio-gated', () => {
  it('EK10: the documented deletion point is exactly 2', () => {
    // Regression guard on the constant itself: the owner's whole mechanism —
    // "delete the ratio 2 to make it option 1" — depends on this being the
    // ONLY multiplier in the rule. If this drifts, `collision` may still pass
    // its other tests while silently changing the owner's escape hatch.
    expect(CLEAR_THICKER_RATIO).toBe(2)
  })
  it('EK11: strictly more than 2x wins', () => {
    expect(collision(2.01, 1)).toBe('win')
  })
  it('EK12: exactly 2x is NOT clearly thicker — it meets, it does not win', () => {
    // The boundary the owner's ratio actually draws: `mine > theirs * ratio`
    // is a STRICT inequality, so a mass exactly twice as thick as its rival is
    // NOT "clearly thicker" by this rule's own arithmetic. Pinned so a future
    // `>=` "cleanup" is caught immediately instead of silently flipping every
    // exactly-2x collision on real data from "meet" (both onlap, pinch at the
    // middle) to "win" (one side takes the whole tie).
    expect(collision(2, 1)).toBe('meet')
  })
  it('EK13: strictly less than half yields', () => {
    expect(collision(1, 2.01)).toBe('yield')
  })
  it('EK14: within the 2x band on both sides is a meet', () => {
    expect(collision(1.5, 1)).toBe('meet')
    expect(collision(1, 1.5)).toBe('meet')
  })
  it('EK15: equal thickness always meets', () => {
    expect(collision(3, 3)).toBe('meet')
  })
  it('EK16: collision is anti-symmetric — win one way is yield the other, at the same magnitudes', () => {
    // A property, not a single case: for 200 random positive thickness pairs,
    // swapping the arguments never produces the SAME verdict except 'meet'
    // swapping to 'meet'. This catches an accidental one-sided `>=` that
    // would let a pair "win" against itself from both directions.
    let seed = 0x2026_0822
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    for (let i = 0; i < 200; i++) {
      const a = 0.01 + rand() * 20
      const b = 0.01 + rand() * 20
      const forward = collision(a, b)
      const backward = collision(b, a)
      if (forward === 'meet') {
        expect(backward, `a=${a} b=${b}`).toBe('meet')
      } else if (forward === 'win') {
        expect(backward, `a=${a} b=${b}`).toBe('yield')
      } else {
        expect(backward, `a=${a} b=${b}`).toBe('win')
      }
    }
  })
})

describe('emitFor — a deterministic fuzz against a from-scratch reimplementation of the literal sentence', () => {
  // A second, independently-written decoder of the SAME English sentence
  // ("0 ties -> lens; 1 tie -> same emits nothing, different emits onlap; 2
  // ties -> nothing regardless") — not calling emitFor's own code path, so an
  // agreement is real evidence, not a tautology. Random masses, random farEnds
  // length 0-3 (3 is out of the law's stated domain but must not crash or
  // silently misbehave — the two-tie rule says "whatever the far ends read",
  // and this checks that a 3-far-end call, which the law never describes,
  // still returns nothing rather than something undefined-shaped).
  function referenceEmit(own: Mass, farEnds: readonly Mass[]): 'lens' | 'onlap' | 'nothing' {
    if (farEnds.length === 0) return 'lens'
    if (farEnds.length === 1) {
      return farEnds[0].litho === own.litho && farEnds[0].packing === own.packing
        ? 'nothing'
        : 'onlap'
    }
    return 'nothing'
  }
  it('EK17: 500 random (own, farEnds) pairs agree with the reference decoder', () => {
    const LITHOS = ['ZAND', 'KLEI', 'SILT', 'VEEN']
    const PACKINGS = ['L', 'MD', 'D', 'VD', 'SF', 'MF', 'FF', 'F']
    let seed = 0x2f0a19e
    const rand = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff
      return seed / 0x7fffffff
    }
    const randMass = (): Mass => ({
      litho: LITHOS[Math.floor(rand() * LITHOS.length)],
      packing: PACKINGS[Math.floor(rand() * PACKINGS.length)],
    })
    for (let i = 0; i < 500; i++) {
      const own = randMass()
      const n = Math.floor(rand() * 4) // 0..3
      const farEnds = Array.from({ length: n }, randMass)
      expect(emitFor(own, farEnds), JSON.stringify({ own, farEnds })).toBe(
        referenceEmit(own, farEnds),
      )
    }
  })
})
