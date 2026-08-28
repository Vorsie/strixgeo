// Pins for "right-click a PSD curve → go to the sample on a cross-section"
// (owner ask 2026-08-28: "is there a way we can right click a psd curve and go
// to the sample in question on a cross section?").
//
// The two things the ask says must NOT be guessed:
//   * which section to open when the borehole sits on several — the CANONICAL
//     membership rule decides, and when it still yields several we pick
//     deterministically (the first in the section list's order);
//   * what to do when the borehole is on NO section — an honest sentence,
//     mirroring the pending-tie chip's "why you cannot see it".
//
// SSR1 — the section is the first one (in the membership map's order) whose
//        canonical member set contains the borehole.
// SSR2 — a borehole on no section resolves to null (→ the honest toast).
// SSR3 — deterministic: the same borehole always resolves to the same section,
//        and the FIRST wins when several contain it.
// SSR4 — the honest message names the sample (borehole + number + depth) and
//        says it is on no cross-section, plus what to do about it.

import { describe, expect, it } from 'vitest'

import {
  pickSectionForInvestigation,
  sampleNotOnAnySectionMessage,
} from './sampleSectionReveal'

describe('pickSectionForInvestigation — canonical membership, deterministic', () => {
  it('SSR1 — the borehole lands on the section whose member set contains it', () => {
    const bySection = new Map<string, Set<string>>([
      ['sec-A', new Set(['cpt-1', 'bh-9'])],
      ['sec-B', new Set(['cpt-2'])],
    ])
    expect(pickSectionForInvestigation(bySection, 'bh-9')).toBe('sec-A')
  })

  it('SSR2 — a borehole on no section resolves to null', () => {
    const bySection = new Map<string, Set<string>>([
      ['sec-A', new Set(['cpt-1'])],
      ['sec-B', new Set(['cpt-2'])],
    ])
    expect(pickSectionForInvestigation(bySection, 'bh-9')).toBeNull()
  })

  it('SSR3 — the FIRST section in map order wins when several contain it', () => {
    const bySection = new Map<string, Set<string>>([
      ['sec-A', new Set(['bh-9'])],
      ['sec-B', new Set(['bh-9'])],
      ['sec-C', new Set(['bh-9'])],
    ])
    expect(pickSectionForInvestigation(bySection, 'bh-9')).toBe('sec-A')
  })
})

describe('sampleNotOnAnySectionMessage — the honest "cannot see it" line', () => {
  it('SSR4 — names the sample and says it is on no cross-section', () => {
    const msg = sampleNotOnAnySectionMessage({
      boreholeName: 'B7',
      sampleNumber: '3',
      depthTopM: 4.2,
      depthBaseM: 4.7,
    })
    expect(msg).toMatch(/B7/)
    expect(msg).toMatch(/3/)
    expect(msg).toMatch(/cross-section/i)
    // Ends in an action, not just a diagnosis (the pending-tie chip's rule).
    expect(msg).toMatch(/section line|corridor|draw|widen/i)
  })
})
