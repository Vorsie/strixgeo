/**
 * Behaviour tests for the #158 minimum hit-target allocator, in the rule's
 * own words: a thin band borrows click space from fat neighbours; fat bands
 * and thin-vs-thin boundaries stay exactly where they are.
 */

import { describe, expect, it } from 'vitest'

import { allocateMinHitExpansions } from './minHitAllocation'

const MIN = 12

describe('allocateMinHitExpansions', () => {
  it('a fat band gets no expansion', () => {
    const out = allocateMinHitExpansions(
      [
        { top: 0, bottom: 40 },
        { top: 40, bottom: 90 },
      ],
      MIN,
    )
    expect(out).toEqual([
      { growTop: 0, growBottom: 0 },
      { growTop: 0, growBottom: 0 },
    ])
  })

  it('a thin band between fat neighbours borrows half its shortfall from each', () => {
    const out = allocateMinHitExpansions(
      [
        { top: 0, bottom: 40 },
        { top: 40, bottom: 44 }, // 4px thin — wants (12-4)/2 = 4 per side
        { top: 44, bottom: 90 },
      ],
      MIN,
    )
    expect(out[1]).toEqual({ growTop: 4, growBottom: 4 })
    // The donors themselves are untouched (their VISUAL rect never moves; the
    // borrow is an invisible strip on top of them).
    expect(out[0]).toEqual({ growTop: 0, growBottom: 0 })
    expect(out[2]).toEqual({ growTop: 0, growBottom: 0 })
  })

  it('a donor never gives more than its own slack — it must stay comfortable too', () => {
    const out = allocateMinHitExpansions(
      [
        { top: 0, bottom: 13 }, // slack (13-12)/2 = 0.5
        { top: 13, bottom: 15 }, // 2px thin — wants 5 per side
        { top: 15, bottom: 90 },
      ],
      MIN,
    )
    expect(out[1].growTop).toBeCloseTo(0.5)
    expect(out[1].growBottom).toBe(5)
  })

  it('two adjacent thin bands keep their shared boundary — neither can donate', () => {
    const out = allocateMinHitExpansions(
      [
        { top: 0, bottom: 60 },
        { top: 60, bottom: 64 },
        { top: 64, bottom: 68 },
        { top: 68, bottom: 130 },
      ],
      MIN,
    )
    expect(out[1].growBottom).toBe(0)
    expect(out[2].growTop).toBe(0)
    // Each still borrows from its FAT side.
    expect(out[1].growTop).toBe(4)
    expect(out[2].growBottom).toBe(4)
  })

  it('the stack edges are hard walls', () => {
    const out = allocateMinHitExpansions([{ top: 0, bottom: 4 }], MIN)
    expect(out[0]).toEqual({ growTop: 0, growBottom: 0 })
  })
})
