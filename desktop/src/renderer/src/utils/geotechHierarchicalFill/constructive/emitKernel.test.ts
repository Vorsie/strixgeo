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

import * as kernel from './emitKernel'
import { emitFor, massKey, sameMass, type Mass } from './emitKernel'

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

describe('the law weighs masses, never thicknesses', () => {
  // Owner 2026-08-25, on his TS12 scene — a 0.41 m loose sand carrying one tie
  // to a 4.26 m medium-dense sand, where the thin side had been made to stand
  // down: *"no it has one tie on top, so it should onlap that same tie"*. That
  // SUPERSEDES the 2026-08-21 "clearly thicker wins" collision (EK10–EK16 here,
  // and `CLEAR_THICKER_RATIO` / `collision` in the kernel), which is deleted
  // rather than left inert. These two pins are what is left of it: the answer
  // for one tie is `onlap` at any thickness ratio, and the kernel offers no
  // surface through which a thickness could be handed to it.
  it('EK10: one tie, different mass -> onlap, and there is no thickness to pass', () => {
    // The whole of the retired rule was a second input. `emitFor` takes the
    // masses and NOTHING else, so a 10x mismatch and a 1.01x mismatch are the
    // same call and must give the same answer.
    expect(emitFor(SAND_DENSE, [SAND_MEDIUM])).toBe('onlap')
    expect(emitFor(SAND_MEDIUM, [SAND_DENSE])).toBe('onlap')
    expect(emitFor.length, 'emitFor grew a parameter — a thickness gate is back').toBe(2)
  })
  it('EK11: the kernel exports no thickness-weighing rule at all', () => {
    // A structural pin, so a re-introduction under any name is caught here
    // rather than three layers down on real data. The kernel is the law and
    // the law compares *"litho and packing density"* — full stop.
    expect(Object.keys(kernel).sort()).toEqual(['FILL_ORDER', 'emitFor', 'massKey', 'sameMass'])
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
