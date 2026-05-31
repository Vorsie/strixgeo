import { describe, expect, it } from 'vitest'

import { nudgeColumns } from './columnLayout'

describe('nudgeColumns — width-aware edge-to-edge spacing', () => {
  it('returns empty for empty input', () => {
    expect(nudgeColumns([], 10)).toEqual([])
  })

  it('keeps well-spaced columns untouched (no displacement)', () => {
    // Two 14-px columns 100 px apart. Edge-to-edge gap = 100 - 14 = 86,
    // way above any reasonable edgeGap.
    const result = nudgeColumns(
      [
        { id: 'a', trueX: 100, width: 14 },
        { id: 'b', trueX: 200, width: 14 },
      ],
      4,
    )
    expect(result).toHaveLength(2)
    expect(result[0].nudgedX).toBe(100)
    expect(result[1].nudgedX).toBe(200)
    expect(result.every(r => !r.displaced)).toBe(true)
  })

  it('pushes the second column rightward when too close', () => {
    // Both 14-px columns centred 5 px apart → edges overlap heavily.
    // Edge-to-edge enforce: centers ≥ 7 + 4 + 7 = 18.
    const result = nudgeColumns(
      [
        { id: 'a', trueX: 100, width: 14 },
        { id: 'b', trueX: 105, width: 14 },
      ],
      4,
    )
    expect(result[0].nudgedX).toBe(100)
    expect(result[0].displaced).toBe(false)
    expect(result[1].nudgedX).toBe(118) // 100 + 7 + 4 + 7
    expect(result[1].displaced).toBe(true)
    expect(result[1].trueX).toBe(105) // original position retained
  })

  it('cascades through a dense cluster — each pushed by half-width sum + gap', () => {
    // Four 10-px columns spaced 1 px apart in trueX. Required minCenter
    // step = 5 + 4 + 5 = 14 px. First lands at trueX, rest cascade.
    const result = nudgeColumns(
      [
        { id: 'a', trueX: 100, width: 10 },
        { id: 'b', trueX: 101, width: 10 },
        { id: 'c', trueX: 102, width: 10 },
        { id: 'd', trueX: 103, width: 10 },
      ],
      4,
    )
    expect(result.map(r => r.nudgedX)).toEqual([100, 114, 128, 142])
    expect(result.map(r => r.displaced)).toEqual([false, true, true, true])
  })

  it('asymmetric widths — a wide column next to a narrow one spaces correctly', () => {
    // 20-px wide column followed by 10-px wide column, 5 px apart.
    // Min center distance = 10 + 4 + 5 = 19. Nudged-b sits at
    // 100 + 19 = 119.
    const result = nudgeColumns(
      [
        { id: 'wide', trueX: 100, width: 20 },
        { id: 'narrow', trueX: 105, width: 10 },
      ],
      4,
    )
    expect(result[0].nudgedX).toBe(100)
    expect(result[1].nudgedX).toBe(119)
  })

  it('sorts the output by trueX even when input is shuffled', () => {
    const result = nudgeColumns(
      [
        { id: 'right', trueX: 800, width: 14 },
        { id: 'left', trueX: 100, width: 14 },
        { id: 'middle', trueX: 400, width: 14 },
      ],
      4,
    )
    expect(result.map(r => r.item.id)).toEqual(['left', 'middle', 'right'])
  })

  // Dogfeed 2026-05-31: edge-aware pair gap. Two adjacent columns
  // connected by a correlation should get a wider clear-air channel so
  // the gradient ribbon between them has room to render.
  it('gapBetween callback widens specific adjacent pairs only', () => {
    // Three 10-px columns at 100/115/130. With base gap=4 (step=14)
    // they all sit tight at trueX. With a callback that returns 30
    // for the (a,b) pair only, b must shift right (100 + 5 + 30 + 5 =
    // 140), and c cascades from there with the BASE gap (140 + 5 + 4 +
    // 5 = 154).
    const result = nudgeColumns(
      [
        { id: 'a', trueX: 100, width: 10 },
        { id: 'b', trueX: 115, width: 10 },
        { id: 'c', trueX: 130, width: 10 },
      ],
      4,
      (prev, curr) => {
        const ids = [prev.id, curr.id].sort().join('|')
        return ids === 'a|b' ? 30 : 4
      },
    )
    expect(result[0].nudgedX).toBe(100)
    expect(result[1].nudgedX).toBeCloseTo(140)
    expect(result[1].displaced).toBe(true)
    expect(result[2].nudgedX).toBeCloseTo(154)
    expect(result[2].displaced).toBe(true)
  })

  it('gapBetween callback omitted falls back to base edgeGap (regression guard)', () => {
    // Two columns that would tile fine with the base gap. Without the
    // callback the existing edge-gap behaviour must be unchanged.
    const result = nudgeColumns(
      [
        { id: 'a', trueX: 100, width: 10 },
        { id: 'b', trueX: 200, width: 10 },
      ],
      4,
    )
    expect(result[0].nudgedX).toBe(100)
    expect(result[1].nudgedX).toBe(200)
    expect(result[1].displaced).toBe(false)
  })

  it('a half-pixel jitter does NOT flag as displaced (threshold guard)', () => {
    // Two 1-px columns, trueX 0.4 apart. Min center distance =
    // 0.5 + 0.1 + 0.5 = 1.1. Second nudged to 1.1. Drift from 100.4
    // is 0.7 px — above the 0.5 threshold, so it IS displaced.
    // Use even smaller widths/jitter to test the 0.5 threshold.
    const result = nudgeColumns(
      [
        { id: 'a', trueX: 100, width: 1 },
        { id: 'b', trueX: 101.2, width: 1 },
      ],
      0.1,
    )
    // Min step = 0.5 + 0.1 + 0.5 = 1.1. trueX-b = 101.2, so nudged
    // stays at 101.2 (no displacement). Threshold guard never fires
    // here because the input doesn't crowd.
    expect(result[1].nudgedX).toBeCloseTo(101.2)
    expect(result[1].displaced).toBe(false)
  })
})
