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
// The skip half of that did not survive its own dogfeed. Owner, 2026-08-15:
// "wtf are of section skips, this is useless info for the user?" — a column he
// never put on a section is not work he lost, so the sentence stops reporting
// it. The backend keeps logging it at INFO (the audit trail) and the response
// keeps the field (the API contract); only the toast goes quiet.
//
//   SM1  the sentence names the scope that ran
//   SM2  the all-sections press says so too
//   SM3  the off-section skip report is not in the sentence at all
//   SM4  nothing skipped = no mention of skipping at all
//   SM5  step 1 still hands over the next press

import { describe, expect, it } from 'vitest'

import type { SubdivideCptsToastInput } from './subdivideCptsToast'
import { subdivideCptsToast } from './subdivideCptsToast'

const BASE: SubdivideCptsToastInput = {
  scopedToSection: true,
  splitBodyCount: 3,
  oneClassBodyCount: 1,
  boreholeOnlyCount: 0,
  reanchoredTieCount: 0,
  deriveEdges: false,
}

describe('subdivideCptsToast', () => {
  it('SM1: the sentence names the scope that ran', () => {
    expect(subdivideCptsToast(BASE)).toContain('this section')
  })

  it('SM2: the all-sections press says so too', () => {
    expect(subdivideCptsToast({ ...BASE, scopedToSection: false })).toContain('all sections')
  })

  it('SM3: the off-section skip report is not in the sentence at all', () => {
    // Owner (dogfeed 2026-08-15): "wtf are of section skips, this is useless
    // info for the user?" — the columns he never put on a section are not
    // work he lost, so the toast says nothing about them. The backend log and
    // the response field stay; only the sentence drops it.
    //
    // Handed the skip report the response still carries, the sentence must be
    // byte-identical to the one with nothing skipped.
    const withSkips = {
      ...BASE,
      skippedOffSectionCount: 4,
      skippedOffSectionLabels: ['CPT-OFF', 'BH-OFF'],
    } as SubdivideCptsToastInput
    expect(subdivideCptsToast(withSkips)).toBe(subdivideCptsToast(BASE))
    expect(subdivideCptsToast(withSkips)).not.toMatch(/cross-section|left out|skip/i)
  })

  it('SM4: nothing skipped means no mention of skipping at all', () => {
    expect(subdivideCptsToast(BASE)).not.toMatch(/skip/i)
  })

  it('SM5: step 1 still hands over the next press; the combined verb does not', () => {
    expect(subdivideCptsToast(BASE)).toContain('2 · Auto-correlate')
    expect(subdivideCptsToast({ ...BASE, deriveEdges: true })).not.toContain('2 · Auto-correlate')
  })
})
