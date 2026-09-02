// The un-join spotlight guard (debt #278 D3).
//
// Hovering "Ontkoppelen van X" carries body X's anchor layer id. The overlay
// dims EVERY fill and lights only what carries that layer — but ONLY when
// SOMETHING carries it: an anchor that surfaces nowhere would dim the whole
// canvas and highlight nothing, which reads as broken (ux-reviewer). Before D3
// the guard looked at between-column regions ONLY, so an anchor that surfaces
// only as an on-column band gave a null guard and lit nothing. The fix: the
// guard also consults the on-column strips.
//
// US1 — an anchor carried ONLY by an on-column strip resolves (the D3 fix).
// US2 — an anchor carried by a between-column region resolves (unchanged).
// US3 — an anchor carried by neither resolves to null (no dim-everything).
// US4 — no highlight resolves to null.

import { describe, expect, it } from 'vitest'

import { resolveHighlightLayer } from './unjoinSpotlight'

describe('resolveHighlightLayer — the un-join spotlight guard (D3)', () => {
  it('US1 — an anchor that surfaces ONLY on a column strip still resolves', () => {
    // No region carries it; a strip does → it must light (the D3 fix).
    expect(resolveHighlightLayer('x', [['a'], ['b']], ['x', 'c'])).toBe('x')
  })

  it('US2 — an anchor carried by a between-column region resolves', () => {
    expect(resolveHighlightLayer('x', [['a', 'x'], ['b']], ['c'])).toBe('x')
  })

  it('US3 — an anchor carried by neither region nor strip resolves to null', () => {
    expect(resolveHighlightLayer('x', [['a'], ['b']], ['c', 'd'])).toBeNull()
  })

  it('US4 — no highlight resolves to null', () => {
    expect(resolveHighlightLayer(null, [['x']], ['x'])).toBeNull()
    expect(resolveHighlightLayer(undefined, [['x']], ['x'])).toBeNull()
  })

  it('US5 — a region set may be undefined (a strip-only / label-less region)', () => {
    expect(resolveHighlightLayer('x', [undefined, ['x']], [])).toBe('x')
  })
})
