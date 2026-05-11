import { describe, expect, it } from 'vitest'

import { nudgeColumns } from './columnLayout'

describe('nudgeColumns', () => {
  it('returns empty for empty input', () => {
    expect(nudgeColumns([], 10)).toEqual([])
  })

  it('keeps well-spaced columns untouched (no displacement)', () => {
    const result = nudgeColumns(
      [{ id: 'a', trueX: 100 }, { id: 'b', trueX: 200 }],
      20,
    )
    expect(result).toHaveLength(2)
    expect(result[0].nudgedX).toBe(100)
    expect(result[1].nudgedX).toBe(200)
    expect(result.every(r => !r.displaced)).toBe(true)
  })

  it('pushes the second column rightward when too close', () => {
    const result = nudgeColumns(
      [{ id: 'a', trueX: 100 }, { id: 'b', trueX: 105 }],
      20,
    )
    expect(result[0].nudgedX).toBe(100)
    expect(result[0].displaced).toBe(false)
    expect(result[1].nudgedX).toBe(120) // 100 + minGap
    expect(result[1].displaced).toBe(true)
    expect(result[1].trueX).toBe(105) // original position retained
  })

  it('cascades through a dense cluster — each pushed by minGap', () => {
    const result = nudgeColumns(
      [
        { id: 'a', trueX: 100 },
        { id: 'b', trueX: 101 },
        { id: 'c', trueX: 102 },
        { id: 'd', trueX: 103 },
      ],
      20,
    )
    expect(result.map(r => r.nudgedX)).toEqual([100, 120, 140, 160])
    expect(result.map(r => r.displaced)).toEqual([false, true, true, true])
  })

  it('sorts the output by trueX even when input is shuffled', () => {
    const result = nudgeColumns(
      [
        { id: 'right', trueX: 800 },
        { id: 'left', trueX: 100 },
        { id: 'middle', trueX: 400 },
      ],
      50,
    )
    expect(result.map(r => r.item.id)).toEqual(['left', 'middle', 'right'])
  })

  it('a half-pixel jitter does NOT flag as displaced (threshold guard)', () => {
    const result = nudgeColumns(
      [{ id: 'a', trueX: 100 }, { id: 'b', trueX: 100.4 }],
      0.3,
    )
    // Second item nudged to 100.3 (prev + minGap); difference from
    // trueX = 0.1px, below the 0.5px threshold so ``displaced`` is
    // false. Prevents tie-back lines for sub-pixel adjustments.
    expect(result[1].displaced).toBe(false)
  })
})
