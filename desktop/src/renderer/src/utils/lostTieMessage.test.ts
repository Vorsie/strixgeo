// A lost accepted tie has to be findable from the message alone.
//
// Audit 2026-08-02: the toast ended with "See the console for which" — an
// accepted correlation the engineer must redraw, with no in-app list, and the
// ids in a console that a packaged build (DevTools disabled, DEBUG stripped)
// never shows.
//
// The rule, in the rule's own words: when the app tells the engineer a tie
// they accepted is gone, it says which borehole and which depth.

import { describe, expect, it } from 'vitest'

import { lostTieMessage, MAX_NAMED_LOST_TIES } from './lostTieMessage'

const TIE_A = 'GEO-22/115-S10 4.20-6.10 m <-> BH-3 4.00-5.90 m'
const TIE_B = 'GEO-10/170-S6 11.00-13.40 m <-> BH-7 10.80-13.10 m'

describe('lostTieMessage', () => {
  it('names the borehole and the depth of a single lost tie', () => {
    const message = lostTieMessage(1, [TIE_A])
    expect(message).toContain('GEO-22/115-S10')
    expect(message).toContain('BH-3')
    expect(message).toContain('4.20-6.10 m')
    expect(message).not.toMatch(/console/i)
  })

  it('reads in the singular for one tie and the plural for two', () => {
    expect(lostTieMessage(1, [TIE_A])).toContain('1 accepted packing tie could not be kept')
    expect(lostTieMessage(2, [TIE_A, TIE_B])).toContain(
      '2 accepted packing ties could not be kept',
    )
  })

  it('names the first few and counts the rest', () => {
    const labels = Array.from({ length: MAX_NAMED_LOST_TIES + 4 }, (_, i) => `tie-${i}`)
    const message = lostTieMessage(labels.length, labels)

    expect(message).toContain('tie-0')
    expect(message).toContain(`tie-${MAX_NAMED_LOST_TIES - 1}`)
    expect(message).not.toContain(`tie-${MAX_NAMED_LOST_TIES}`)
    expect(message).toContain('and 4 more')
  })

  it('falls back to the server log when the backend sent no labels', () => {
    // An older backend has no lost_tie_labels — say so rather than pretend.
    expect(lostTieMessage(3, undefined)).toMatch(/server log/i)
    expect(lostTieMessage(3, [])).toMatch(/server log/i)
  })

  it('counts the remainder off the labels it actually has', () => {
    // 5 losses but only 4 labels: "and 1 more" is what is genuinely unnamed.
    const message = lostTieMessage(5, ['a', 'b', 'c', 'd'])
    expect(message).toContain('and 1 more')
  })
})
