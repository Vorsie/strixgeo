// desktop/src/renderer/src/utils/tieAutoSuggest.test.ts
import { describe, expect, it } from 'vitest'
import {
  selectNonConflictingTies,
  suggestTieSections,
  type ParallelSection,
  type TieCandidate,
  type TieInvestigation,
} from './tieAutoSuggest'

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

  it('never proposes a tie that passes through fewer than two distinct tests (the rule: you can not correlate with only one test)', () => {
    // Degenerate case: the SAME investigation id sits on two walls (here the
    // one site appears once as a CPT on wall A and once as a borehole on wall
    // C). The sweep would otherwise "tie" a single test to itself — a line
    // that passes through one test. It must not be proposed.
    const wallC: ParallelSection = { id: 'C', start_x: 0, start_y: 180, end_x: 300, end_y: 180, projection_buffer_m: 35 }
    const sameId = suggestTieSections(
      [wallA, wallC],
      [inv('SITE-1', 100, 0)],
      [inv('SITE-1', 100, 180)],
      45,
    )
    expect(sameId).toEqual([])
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

const cand = (
  start: { x: number; y: number },
  end: { x: number; y: number },
  bufferM: number,
  corridorIds: string[],
): TieCandidate => ({
  tie: { members: [], start, end, strikeSpread: 0, bufferM },
  corridorIds: new Set(corridorIds),
  lengthM: Math.hypot(end.x - start.x, end.y - start.y),
})

describe('selectNonConflictingTies', () => {
  it('drops a candidate that would CROSS an accepted tie, keeping the thinner one', () => {
    // The two segments cross at (5,5). c2 has the thinner buffer, so it is
    // taken first; c1 then crosses it and is dropped.
    const c1 = cand({ x: 0, y: 0 }, { x: 10, y: 10 }, 6, [])
    const c2 = cand({ x: 0, y: 10 }, { x: 10, y: 0 }, 5, [])
    const kept = selectNonConflictingTies([c1, c2])
    expect(kept).toHaveLength(1)
    expect(kept[0].bufferM).toBe(5)
  })

  it('drops a candidate that SHARES a test with an accepted tie', () => {
    // Parallel (never cross) but both corridors contain test "t2".
    const c1 = cand({ x: 0, y: 0 }, { x: 10, y: 0 }, 5, ['t1', 't2'])
    const c2 = cand({ x: 0, y: 30 }, { x: 10, y: 30 }, 5, ['t2', 't3'])
    const kept = selectNonConflictingTies([c1, c2])
    expect(kept).toHaveLength(1)
  })

  it('keeps candidates that neither cross nor share a test', () => {
    const c1 = cand({ x: 0, y: 0 }, { x: 10, y: 0 }, 5, ['t1'])
    const c2 = cand({ x: 0, y: 30 }, { x: 10, y: 30 }, 5, ['t2'])
    expect(selectNonConflictingTies([c1, c2])).toHaveLength(2)
  })

  it('returns nothing for no candidates', () => {
    expect(selectNonConflictingTies([])).toEqual([])
  })
})
