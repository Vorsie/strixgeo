// What the toolbar says about pending packing ties once steps 2 and 3 are
// section-scoped.
//
// Owner (dogfeed 2026-08-15): "I also see that this is model wide and not per
// section, i don't like that" — steps 2 and 3 follow the open section. Reading
// the menu afterwards he closed the set: "i'm reading divide boreholes (whole
// model), no that should also be section scoped". So step 4 follows it too,
// and its gate counts the ties on the section it divides. The model total is
// still worth showing — on the chip's tooltip, as context — but it no longer
// holds anything shut.
//
//   PS1  the open section's own pending count is what the chip reports
//   PS2  the model total and the other sections live in the chip's tooltip
//   PS3  a clean open section still reads honestly while the model is dirty
//   PS4  the step-4 gate counts THIS section, and stops naming the model
//   PS5  with no section open there is nothing section-shaped to say
//   PS6  a backend with no breakdown falls back to the bare count, never to a lie

import { describe, expect, it } from 'vitest'

import { t } from '../i18n/translate'
import {
  dividePendingTag,
  dividePendingTitle,
  pendingChipLabel,
  pendingChipTitle,
  summarisePendingTies,
} from './geotechPendingScope'

describe('summarisePendingTies', () => {
  it('PS1: the open section is counted separately from the model', () => {
    const scope = summarisePendingTies({
      modelPending: 12,
      pendingBySection: { 'sec-a': 5, 'sec-b': 7 },
      activeSectionId: 'sec-a',
    })
    expect(scope.modelPending).toBe(12)
    expect(scope.sectionPending).toBe(5)
    expect(scope.sectionsWithPending).toBe(2)
    expect(pendingChipLabel(t, scope)).toContain('5')
  })

  it('PS2: the chip tooltip carries the model total the chip itself does not', () => {
    const scope = summarisePendingTies({
      modelPending: 12,
      pendingBySection: { 'sec-a': 5, 'sec-b': 7 },
      activeSectionId: 'sec-a',
    })
    const title = pendingChipTitle(t, scope, 40)
    expect(title).toContain('5')
    expect(title).toContain('12')
    expect(title).toContain('40')
  })

  it('PS3: a clean open section says so while the model is still dirty', () => {
    // The engineer accepted everything he can see; the chip must not read as
    // "you still have work here" when the work is on another section.
    const scope = summarisePendingTies({
      modelPending: 7,
      pendingBySection: { 'sec-b': 7 },
      activeSectionId: 'sec-a',
    })
    expect(scope.sectionPending).toBe(0)
    expect(scope.sectionsWithPending).toBe(1)
    expect(pendingChipLabel(t, scope)).toContain('0')
  })

  it('PS4: the step-4 gate counts THIS section, because that is what it divides', () => {
    // Owner (dogfeed 2026-08-15): "i'm reading divide boreholes (whole model),
    // no that should also be section scoped". Once the press divides one
    // section, a gate quoting the model's total is refusing on evidence this
    // press would not touch — and CS1 could never be finished while CS2 is
    // under review.
    const scope = summarisePendingTies({
      modelPending: 12,
      pendingBySection: { 'sec-a': 5, 'sec-b': 7 },
      activeSectionId: 'sec-a',
    })
    expect(dividePendingTag(t, scope)).toBe('accept 5 on this section')
    const title = dividePendingTitle(t, scope)
    expect(title).toContain('5')
    expect(title).toMatch(/this section/i)
    // And it must stop claiming the whole model has to be clear.
    expect(title).not.toMatch(/every section|whole model/i)
    expect(title).not.toContain('12')
  })

  it('PS4b: one tie left reads in the singular', () => {
    const scope = summarisePendingTies({
      modelPending: 4,
      pendingBySection: { 'sec-a': 1, 'sec-b': 3 },
      activeSectionId: 'sec-a',
    })
    expect(dividePendingTag(t, scope)).toBe('accept 1 on this section')
    expect(dividePendingTitle(t, scope)).toContain('1 packing tie ')
  })

  it('PS4c: a clean open section does not hold step 4 shut at all', () => {
    // The neighbour's 7 proposals are the neighbour's problem now.
    const scope = summarisePendingTies({
      modelPending: 7,
      pendingBySection: { 'sec-b': 7 },
      activeSectionId: 'sec-a',
    })
    expect(scope.sectionPending).toBe(0)
  })

  it('PS5: with no section open the chip falls back to the model total', () => {
    const scope = summarisePendingTies({
      modelPending: 12,
      pendingBySection: { 'sec-a': 5, 'sec-b': 7 },
      activeSectionId: null,
    })
    expect(scope.sectionPending).toBeNull()
    expect(pendingChipLabel(t, scope)).toContain('12')
    expect(pendingChipTitle(t, scope, 40)).toContain('12')
  })

  it('PS6: a breakdown the backend did not send degrades to the bare count', () => {
    // A backend predating the field must not make the toolbar claim "0 sections
    // pending" — that would read as "nothing is blocking you" beside a
    // disabled button.
    const scope = summarisePendingTies({
      modelPending: 12,
      pendingBySection: undefined,
      activeSectionId: 'sec-a',
    })
    expect(scope.sectionPending).toBeNull()
    expect(scope.sectionsWithPending).toBeNull()
    expect(dividePendingTag(t, scope)).toBe('accept 12 first')
    expect(dividePendingTitle(t, scope)).toContain('12')
    expect(pendingChipLabel(t, scope)).toContain('12')
  })
})
