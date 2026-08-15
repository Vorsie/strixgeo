// What pipeline step 1 tells the engineer it just did.
//
// Owner (dogfeed 2026-08-15): "i want subdivide cpt's also to be section
// scoped, i don't want any cpt's that aren't on any sections to be subdivided
// and included in the model".
//
// Two things follow that the old sentence could not say: WHICH scope ran, and
// that the model deliberately came out smaller. A silently smaller model is
// the kind of thing that gets discovered in an export.
//
//   SM1  the sentence names the scope that ran
//   SM2  the all-sections press says so too
//   SM3  skipped off-section columns are reported, by name
//   SM4  nothing skipped = no mention of skipping at all
//   SM5  step 1 still hands over the next press

import { describe, expect, it } from 'vitest'

import { subdivideCptsToast } from './subdivideCptsToast'

const BASE = {
  scopedToSection: true,
  splitBodyCount: 3,
  oneClassBodyCount: 1,
  boreholeOnlyCount: 0,
  reanchoredTieCount: 0,
  skippedOffSectionCount: 0,
  skippedOffSectionLabels: [] as readonly string[],
  deriveEdges: false,
}

describe('subdivideCptsToast', () => {
  it('SM1: the sentence names the scope that ran', () => {
    expect(subdivideCptsToast(BASE)).toContain('this section')
  })

  it('SM2: the all-sections press says so too', () => {
    expect(subdivideCptsToast({ ...BASE, scopedToSection: false })).toContain('all sections')
  })

  it('SM3: skipped off-section columns are reported, by name', () => {
    const message = subdivideCptsToast({
      ...BASE,
      skippedOffSectionCount: 2,
      skippedOffSectionLabels: ['CPT-OFF', 'BH-OFF'],
    })
    expect(message).toContain('2')
    expect(message).toContain('CPT-OFF')
    expect(message).toContain('BH-OFF')
    // The REASON, not just the fact — otherwise it reads as a failure.
    expect(message).toMatch(/no cross-section|not on (a|any) (cross-)?section/i)
  })

  it('SM3b: a long skip list is truncated rather than dumped', () => {
    const message = subdivideCptsToast({
      ...BASE,
      skippedOffSectionCount: 9,
      skippedOffSectionLabels: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'],
    })
    expect(message).toContain('9')
    expect(message).toContain('A')
    expect(message).not.toContain('I')
    expect(message).toMatch(/more|…/)
  })

  it('SM4: nothing skipped means no mention of skipping at all', () => {
    expect(subdivideCptsToast(BASE)).not.toMatch(/skip/i)
  })

  it('SM5: step 1 still hands over the next press; the combined verb does not', () => {
    expect(subdivideCptsToast(BASE)).toContain('2 · Auto-correlate')
    expect(subdivideCptsToast({ ...BASE, deriveEdges: true })).not.toContain('2 · Auto-correlate')
  })
})
