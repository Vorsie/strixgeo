// desktop/src/renderer/src/utils/tieAutoSuggest.test.ts
import { describe, expect, it } from 'vitest'
import { suggestTieSections, type ParallelSection, type TieInvestigation } from './tieAutoSuggest'

const wallA: ParallelSection = {
  id: 'A', start_x: 0, start_y: 0, end_x: 300, end_y: 0, projection_buffer_m: 35,
}
const wallB: ParallelSection = {
  id: 'B', start_x: 0, start_y: 80, end_x: 300, end_y: 80, projection_buffer_m: 35,
}
const inv = (id: string, x: number, y: number): TieInvestigation => ({ id, location_x: x, location_y: y })

describe('suggestTieSections', () => {
  it('pairs aligned tests across two walls into one tie per rung (the rule: same strike position → one tie)', () => {
    const cpts = [inv('a1', 50, 0), inv('a2', 150, 0), inv('b1', 50, 80), inv('b2', 150, 80)]
    const ties = suggestTieSections([wallA, wallB], cpts, [], 45)
    expect(ties).toHaveLength(2)
    expect(ties[0].members.map(m => m.investigationId).sort()).toEqual(['a1', 'b1'])
    expect(ties[1].members.map(m => m.investigationId).sort()).toEqual(['a2', 'b2'])
  })

  it('never proposes crossing ties (the rule: ties are strike-ordered, no lateral swaps)', () => {
    const cpts = [inv('a_lo', 50, 0), inv('a_hi', 150, 0), inv('b_lo', 50, 80), inv('b_hi', 150, 80)]
    const ties = suggestTieSections([wallA, wallB], cpts, [], 45)
    for (const wallId of ['A', 'B']) {
      const strikes = ties
        .map(t => t.members.find(m => m.sectionId === wallId))
        .filter((m): m is NonNullable<typeof m> => !!m)
        .map(m => m.x)
      const sorted = [...strikes].sort((p, q) => p - q)
      expect(strikes).toEqual(sorted)
    }
  })

  it('puts at most one test per wall in a tie (the rule: ~1 test per section per tie)', () => {
    const cpts = [inv('a1', 50, 0), inv('a2', 60, 0), inv('b1', 55, 80)]
    const ties = suggestTieSections([wallA, wallB], cpts, [], 45)
    for (const t of ties) {
      const perWall = new Map<string, number>()
      for (const m of t.members) perWall.set(m.sectionId, (perWall.get(m.sectionId) ?? 0) + 1)
      for (const count of perWall.values()) expect(count).toBeLessThanOrEqual(1)
    }
  })

  it('leaves an out-of-tolerance test untied rather than forcing a fat tie', () => {
    const cpts = [inv('a1', 50, 0), inv('b_far', 250, 80)]
    const ties = suggestTieSections([wallA, wallB], cpts, [], 45)
    const tied = new Set(ties.flatMap(t => t.members.map(m => m.investigationId)))
    expect(tied.has('a1')).toBe(false)
    expect(tied.has('b_far')).toBe(false)
  })

  it('returns nothing with fewer than two sections', () => {
    expect(suggestTieSections([wallA], [inv('a1', 50, 0)], [], 45)).toEqual([])
  })

  it('forms a 3-wall triplet where all three walls have an aligned test', () => {
    const wallC: ParallelSection = { id: 'C', start_x: 0, start_y: 180, end_x: 300, end_y: 180, projection_buffer_m: 65 }
    const cpts = [inv('a1', 100, 0), inv('b1', 100, 80), inv('c1', 100, 180)]
    const ties = suggestTieSections([wallA, wallB, wallC], cpts, [], 45)
    expect(ties).toHaveLength(1)
    expect(ties[0].members).toHaveLength(3)
  })

  it('prefers the strike-ordered pairing over a nearest-distance crossing', () => {
    // a1 at strike 20, a2 at strike 80 on wall A; b1 at 25, b2 at 75 on wall B.
    // A naive nearest-MAP-distance matcher could pair a1↔b2 / a2↔b1 → a cross.
    // The monotonic sweep must produce a1↔b1 and a2↔b2 (strike order).
    const cpts = [inv('a1', 20, 0), inv('a2', 80, 0), inv('b1', 25, 80), inv('b2', 75, 80)]
    const ties = suggestTieSections([wallA, wallB], cpts, [], 30)
    expect(ties).toHaveLength(2)
    expect(ties[0].members.map(m => m.investigationId).sort()).toEqual(['a1', 'b1'])
    expect(ties[1].members.map(m => m.investigationId).sort()).toEqual(['a2', 'b2'])
  })
})
