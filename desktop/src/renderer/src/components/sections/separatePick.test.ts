// Pure resolution for a "Separate from…" target click (debt #278 R5).
//
// When a Separate is armed on body A and the engineer clicks a fill region, the
// region's layers name the OTHER body. These pins fix the three outcomes the
// arm has to tell apart, in the ruling's own words: "click the other body → the
// two are never one body again"; clicking the SAME body or an unresolvable
// region must stay armed rather than commit a nonsense separation.

import { describe, expect, it } from 'vitest'

import { resolveSeparatePick } from './separatePick'

const arm = { bodyId: 'body-A', anchorLayerId: 'a1' }

describe('resolveSeparatePick', () => {
  it('SP1 — a region of a DIFFERENT body commits (arm anchor, target anchor)', () => {
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['b1', 'body-B'],
      ['b2', 'body-B'],
    ])
    // Target anchor = the FIRST region layer stamped to the resolved target body.
    expect(resolveSeparatePick(arm, ['b1', 'b2'], map)).toEqual({
      kind: 'commit',
      anchorLayerId: 'a1',
      targetAnchorLayerId: 'b1',
    })
  })

  it('SP2 — the SAME body stays armed (no self-separation)', () => {
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['a2', 'body-A'],
    ])
    expect(resolveSeparatePick(arm, ['a1', 'a2'], map)).toEqual({ kind: 'same' })
  })

  it('SP3 — an unresolvable region (no stamped body) stays armed', () => {
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['x1', null],
    ])
    expect(resolveSeparatePick(arm, ['x1'], map)).toEqual({ kind: 'unresolvable' })
  })

  it('SP4 — a region spanning several bodies is unresolvable (stays armed)', () => {
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['b1', 'body-B'],
      ['c1', 'body-C'],
    ])
    expect(resolveSeparatePick(arm, ['b1', 'c1'], map)).toEqual({ kind: 'unresolvable' })
  })

  it('SP5 — fallback paint (no layerIds) is unresolvable', () => {
    const map = new Map<string, string | null>([['a1', 'body-A']])
    expect(resolveSeparatePick(arm, undefined, map)).toEqual({ kind: 'unresolvable' })
  })
})
