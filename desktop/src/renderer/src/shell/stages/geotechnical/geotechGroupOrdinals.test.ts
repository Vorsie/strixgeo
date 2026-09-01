// Behavioural net for the manual-group numbering (debt #278 D4).
//
// Owner ruling 2026-08-31, verbatim on the units pane: "Then if you group they
// get like a group 1 in parentheses behind." A "group" is a connected component
// of the manual body-UNION pairs ("Join with…" verb) — two bodies the engineer
// declared to be the SAME. The server issues no group id, so the number is
// derived client-side: union-find over the pairs' body ids, then the components
// numbered deterministically so the same project always reads "group 1" for the
// same set.
//
// These pins are on the pure helper. What the roster renders around a number is
// pinned in the roster / tree tests.

import { describe, expect, it } from 'vitest'

import { geotechGroupOrdinals } from './geotechGroupOrdinals'
import type { GeotechGroupPair } from './geotechGroupOrdinals'

/** One union pair — the two anchors' current bodies. */
function pair(
  bodyA: string | null,
  ordinalA: number | null,
  bodyB: string | null,
  ordinalB: number | null,
): GeotechGroupPair {
  return {
    a: { bodyId: bodyA, bodyOrdinal: ordinalA },
    b: { bodyId: bodyB, bodyOrdinal: ordinalB },
  }
}

describe('geotechGroupOrdinals — connected components of the union pairs (D4)', () => {
  it('G1 — a single pair is one two-member group; both bodies get group 1', () => {
    const groups = geotechGroupOrdinals([pair('x', 0, 'y', 1)])
    expect(groups.get('x')).toBe(1)
    expect(groups.get('y')).toBe(1)
    expect(groups.size).toBe(2)
  })

  it('G2 — a transitive chain A-B, B-C collapses to ONE group of three', () => {
    const groups = geotechGroupOrdinals([pair('a', 0, 'b', 1), pair('b', 1, 'c', 2)])
    expect(groups.get('a')).toBe(1)
    expect(groups.get('b')).toBe(1)
    expect(groups.get('c')).toBe(1)
  })

  it('G3 — two disjoint pairs are two groups, numbered by lowest ordinal first', () => {
    // {p,q} has min ordinal 3, {m,n} has min ordinal 0 → {m,n} is group 1.
    const groups = geotechGroupOrdinals([pair('p', 3, 'q', 4), pair('m', 0, 'n', 1)])
    expect(groups.get('m')).toBe(1)
    expect(groups.get('n')).toBe(1)
    expect(groups.get('p')).toBe(2)
    expect(groups.get('q')).toBe(2)
  })

  it('G4 — numbering is stable regardless of pair input order', () => {
    const a = geotechGroupOrdinals([pair('m', 0, 'n', 1), pair('p', 3, 'q', 4)])
    const b = geotechGroupOrdinals([pair('p', 3, 'q', 4), pair('m', 0, 'n', 1)])
    expect(a.get('m')).toBe(b.get('m'))
    expect(a.get('p')).toBe(b.get('p'))
    expect(a.get('m')).toBe(1)
    expect(a.get('p')).toBe(2)
  })

  it('G5 — a pair with an unstamped (null) body id contributes no group', () => {
    // A union whose anchor has not resolved to a body cannot make a group; the
    // stamped side is a singleton and gets no number.
    const groups = geotechGroupOrdinals([pair('x', 0, null, null)])
    expect(groups.get('x')).toBeUndefined()
    expect(groups.size).toBe(0)
  })

  it('G6 — a body never in any union is absent from the map (singletons get nothing)', () => {
    const groups = geotechGroupOrdinals([pair('a', 0, 'b', 1)])
    expect(groups.get('lonely')).toBeUndefined()
  })

  it('G7 — an empty union list is an empty map, not a crash', () => {
    expect(geotechGroupOrdinals([]).size).toBe(0)
  })

  it('G8 — a self-pair (same body both sides) makes no group', () => {
    const groups = geotechGroupOrdinals([pair('x', 0, 'x', 0)])
    expect(groups.get('x')).toBeUndefined()
    expect(groups.size).toBe(0)
  })

  it('G9 — ties on the min ordinal break by body id, deterministically', () => {
    // Both components share min ordinal 0 → the component whose min id sorts
    // first is group 1.
    const groups = geotechGroupOrdinals([pair('zz', 0, 'zy', 5), pair('aa', 0, 'ab', 5)])
    expect(groups.get('aa')).toBe(1)
    expect(groups.get('zz')).toBe(2)
  })
})
