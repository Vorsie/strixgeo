// Pure resolution for a "Separate from…" target click (debt #278 R5).
//
// Owner dogfeed 2026-09-01, verbatim: "I always get that is the same body (even
// when i click a different body?)". Separate refused its PRIMARY use case — the
// identity merges leave visually-distinct same-class masses sharing ONE db body,
// and separating one body into two IS the ruling's un-weld case. So a SAME-body
// pick now COMMITS (the backend splits the component with a cannot-link between
// two anchors inside it), a DIFFERENT-body pick COMMITS (a durable keep-apart),
// and only an unresolvable region stays an advisory. The commit carries
// ``sameBody`` so the toast can distinguish "the body was split in two" from
// "they were not connected and will stay apart".

import { describe, expect, it } from 'vitest'

import { resolveSeparatePick } from './separatePick'

const arm = { bodyId: 'body-A', anchorLayerId: 'a1' }

describe('resolveSeparatePick', () => {
  it('SP1 — a region of a DIFFERENT body commits a keep-apart (sameBody false)', () => {
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
      sameBody: false,
    })
  })

  it('SP2 — the SAME body commits a SPLIT (sameBody true, anchor + a distinct region layer)', () => {
    const map = new Map<string, string | null>([
      ['a1', 'body-A'],
      ['a2', 'body-A'],
    ])
    // The armed anchor is a1; the picked region's first stamped layer is a2 —
    // two anchors inside one component, which the backend cuts into two bodies.
    expect(resolveSeparatePick(arm, ['a2', 'a1'], map)).toEqual({
      kind: 'commit',
      anchorLayerId: 'a1',
      targetAnchorLayerId: 'a2',
      sameBody: true,
    })
  })

  it('SP6 — the SAME single anchor at both ends is a no-op self-anchor (stays armed)', () => {
    // A one-region body armed, then clicked on that same patch: the region's only
    // stamped layer is the armed anchor itself, so BOTH separation anchors would
    // be the same layer — the backend 422s (anchor == target). Advise instead of
    // committing a request that cannot succeed; the arm stays live.
    const map = new Map<string, string | null>([['a1', 'body-A']])
    expect(resolveSeparatePick(arm, ['a1'], map)).toEqual({ kind: 'self-anchor' })
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
