/**
 * GG10-GG13 — clause 4 (section-closure), in the rule's own words: every
 * litho-frame section either appears in the built payload, or was consented
 * out.
 *
 * Written FIRST, before ``sectionClosure.ts`` exists.
 */
import { describe, expect, it } from 'vitest'

import { sectionClosure, type SectionClosureInput } from './sectionClosure'

describe('sectionClosure — no litho frame in this build', () => {
  it('is not-evaluated, with a reason, when the build has no litho frame at all', () => {
    const input: SectionClosureInput = {
      hasFrame: false,
      frameSections: [],
      builtSectionIds: new Set(),
    }
    const clause = sectionClosure(input)
    expect(clause.key).toBe('section-closure')
    expect(clause.status).toBe('not-evaluated')
    expect(clause.entries).toEqual([])
    expect(clause.not_evaluated_reason).toBeTruthy()
  })
})

describe('sectionClosure — a framed build', () => {
  it('passes when every litho-frame section landed in the payload', () => {
    const input: SectionClosureInput = {
      hasFrame: true,
      frameSections: [
        { sectionId: 's1', sectionName: 'Cross-section 1' },
        { sectionId: 's2', sectionName: 'Cross-section 2' },
      ],
      builtSectionIds: new Set(['s1', 's2']),
    }
    const clause = sectionClosure(input)
    expect(clause.status).toBe('pass')
    expect(clause.entries).toEqual([])
  })

  it('fails with exactly one named entry per litho-frame section missing from the payload', () => {
    const input: SectionClosureInput = {
      hasFrame: true,
      frameSections: [
        { sectionId: 's1', sectionName: 'Cross-section 1' },
        { sectionId: 's7', sectionName: 'Tie-section 7' },
      ],
      builtSectionIds: new Set(['s1']), // s7 never made it into the payload
    }
    const clause = sectionClosure(input)
    expect(clause.status).toBe('fail')
    expect(clause.entries).toHaveLength(1)
    const entry = clause.entries[0]
    expect(entry.section_id).toBe('s7')
    expect(entry.section_name).toBe('Tie-section 7')
    expect(entry.label).toContain('Tie-section 7')
  })

  it('passes vacuously when the frame itself names zero sections', () => {
    const input: SectionClosureInput = {
      hasFrame: true,
      frameSections: [],
      builtSectionIds: new Set(),
    }
    const clause = sectionClosure(input)
    expect(clause.status).toBe('pass')
    expect(clause.entries).toEqual([])
  })
})
