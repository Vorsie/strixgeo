// Pins for the SAMPLE→colour single source of truth — owner ask 2026-08-28,
// verbatim: "can we also make the psd the same colour (sieving hydrometer and
// all dots in the plots above, except for the cpt plots ofcourse)."
//
// The colour must identify ONE SAMPLE, the same colour on the sample's PSD
// curve and on that sample's dots in the scatter panels above — so the key is
// the SAMPLE, never the series index. This module is the one place both
// surfaces resolve that colour, so they cannot disagree.
//
// SCLR1 — the same sample id always yields the same colour (deterministic).
// SCLR2 — a valid ``#rrggbb`` string every time (usable as an SVG stroke/fill).
// SCLR3 — order-independent: the colour of a sample does not depend on which
//         other samples were coloured before it (stable when the pool reorders
//         or gains/loses members).
// SCLR4 — different samples get different colours (the identity is visible).

import { describe, expect, it } from 'vitest'

import { sampleColor } from './sampleColor'

describe('sampleColor — one colour per sample, shared across panels', () => {
  it('SCLR1 — the same sample id always yields the same colour', () => {
    expect(sampleColor('sample-abc')).toBe(sampleColor('sample-abc'))
  })

  it('SCLR2 — the colour is a valid #rrggbb string', () => {
    expect(sampleColor('sample-abc')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('SCLR3 — a sample colour does not depend on colouring order', () => {
    // Colour some other samples first; the answer for our sample must not move.
    sampleColor('other-1')
    sampleColor('other-2')
    const first = sampleColor('sample-xyz')
    sampleColor('other-3')
    expect(sampleColor('sample-xyz')).toBe(first)
  })

  it('SCLR4 — different samples get different colours', () => {
    expect(sampleColor('sample-1')).not.toBe(sampleColor('sample-2'))
  })
})
